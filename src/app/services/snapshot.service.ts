import { Injectable } from '@angular/core'
import { Observable, of, throwError } from 'rxjs'
import { delay } from 'rxjs/operators'
import type { DraftSaveResult, InspectionOrder } from '../types'

const SNAP_KEY = 'rail.snapshot.v1'
const DRAFT_KEY = 'rail.draft.v1'
const ORDERS_KEY = 'rail.orders.v1'
const IDEM_KEY = 'rail.idem.v1'

interface PersistedSnapshot { version: number; blockedSegmentIds: string[]; blockageReason: string }
interface PersistedDraft { version: number }
interface IdemRecord { orderNo: string; uploadedAt: string; firstResult: true }

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
function write(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* 存储不可用时仅内存态 */ }
}

const NETWORK_DELAY = 350

@Injectable({ providedIn: 'root' })
export class SnapshotService {
  /** 演示用：置为 true 后下一次写入模拟网络失败（客户端须用同一幂等键重试） */
  private failNextUpload = false

  setFailNextUpload(value: boolean): void { this.failNextUpload = value }
  get willFailNextUpload(): boolean { return this.failNextUpload }

  /** 读取持久化的封锁快照（首次默认 v1、无封锁）。 */
  getSnapshot(): PersistedSnapshot {
    return read<PersistedSnapshot>(SNAP_KEY, { version: 1, blockedSegmentIds: [], blockageReason: '' })
  }

  /** 持久化封锁快照（范围变更即版本 +1）。 */
  saveSnapshot(blockedSegmentIds: string[], blockageReason: string): PersistedSnapshot {
    const prev = this.getSnapshot()
    const next: PersistedSnapshot = { version: prev.version + 1, blockedSegmentIds, blockageReason }
    write(SNAP_KEY, next)
    return next
  }

  getDraftVersion(): number {
    return read<PersistedDraft>(DRAFT_KEY, { version: 1 }).version
  }

  /**
   * 乐观并发保存：携带基于的草案版本。
   * 先到（base === 当前）生效并自增版本；后到（base 落后）不覆盖，返回冲突。
   */
  saveDraft(baseVersion: number, author: string, summary: string): Observable<DraftSaveResult> {
    const current = this.getDraftVersion()
    const savedAt = new Date().toISOString()
    if (baseVersion === current) {
      write(DRAFT_KEY, { version: current + 1 })
      const ok: DraftSaveResult = { ok: true, version: current + 1, savedAt }
      return of(ok).pipe(delay(NETWORK_DELAY))
    }
    const conflict: DraftSaveResult = {
      ok: false,
      conflict: { baseVersion, currentVersion: current, author, summary, receivedAt: savedAt },
    }
    return of(conflict).pipe(delay(NETWORK_DELAY))
  }

  /**
   * 幂等写入巡查单：
   * - 同一 idempotencyKey 重试，沿用首次结果，不重复写入；
   * - 同一 orderNo 已上传过，按原单号合并，返回首次记录；
   * - failNextUpload 触发一次模拟网络失败（调用方保持同一幂等键重试）。
   */
  uploadOrder(order: InspectionOrder): Observable<{ status: '已上传' | '已合并'; orderNo: string; idempotencyKey: string; merged: boolean; firstResult: boolean }> {
    if (this.failNextUpload) {
      this.failNextUpload = false
      return throwError(() => new Error('NETWORK_WRITE_FAIL')).pipe(delay(NETWORK_DELAY))
    }
    const idem = read<Record<string, IdemRecord>>(IDEM_KEY, {})
    const first = idem[order.idempotencyKey]
    if (first) {
      return of({ status: '已上传' as const, orderNo: first.orderNo, idempotencyKey: order.idempotencyKey, merged: false, firstResult: true }).pipe(delay(NETWORK_DELAY))
    }
    const orders = read<InspectionOrder[]>(ORDERS_KEY, [])
    const existing = orders.find((item) => item.orderNo === order.orderNo && (item.status === '已上传' || item.status === '已合并'))
    if (existing) {
      idem[order.idempotencyKey] = { orderNo: order.orderNo, uploadedAt: existing.uploadedAt ?? new Date().toISOString(), firstResult: true }
      write(IDEM_KEY, idem)
      return of({ status: '已合并' as const, orderNo: order.orderNo, idempotencyKey: order.idempotencyKey, merged: true, firstResult: true }).pipe(delay(NETWORK_DELAY))
    }
    const uploadedAt = new Date().toISOString()
    const stored: InspectionOrder = { ...order, status: '已上传', uploadedAt }
    write(ORDERS_KEY, [stored, ...orders.filter((item) => item.orderNo !== order.orderNo)])
    idem[order.idempotencyKey] = { orderNo: order.orderNo, uploadedAt, firstResult: true }
    write(IDEM_KEY, idem)
    return of({ status: '已上传' as const, orderNo: order.orderNo, idempotencyKey: order.idempotencyKey, merged: false, firstResult: true }).pipe(delay(NETWORK_DELAY))
  }
}
