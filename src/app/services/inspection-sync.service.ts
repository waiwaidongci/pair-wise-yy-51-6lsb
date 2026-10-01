import { Observable, of, throwError } from 'rxjs'
import { delay } from 'rxjs/operators'
import type { InspectionSheet } from '../types'

interface ServerRecord {
  sheetNo: string
  tokens: string[]
  firstToken: string
  storedContent: string
  storedAt: string
}

/**
 * 模拟服务端：
 * - 以巡查单原单号 sheetNo 为主键，同号补传走合并而不是新建；
 * - 以客户端 token 做幂等：写入失败后重试仍返回首次处理结果，服务端只认首次内容；
 * - merge 表示本次是否并入了已有单号。
 */
/** 无构造依赖，直接以单例使用，避免纯逻辑测试引入 Angular DI */
export class InspectionSyncService {
  private readonly records = new Map<string, ServerRecord>()
  private readonly tokenOutcomes = new Map<string, { ok: boolean; message: string; merged: boolean }>()

  reset() {
    this.records.clear()
    this.tokenOutcomes.clear()
  }

  submit(sheet: InspectionSheet, writeFault: boolean): Observable<{ merged: boolean; message: string }> {
    // 该 token 已到达过服务端：重试时无论网络如何，一律回放首次结果（幂等）
    const known = this.tokenOutcomes.get(sheet.token)
    if (known) {
      return known.ok
        ? of({ merged: known.merged, message: known.message }).pipe(delay(420))
        : throwError(() => new Error(known.message)).pipe(delay(420))
    }

    if (writeFault) {
      // 请求未到达服务端：结果尚未确定，稍后重试可以成功
      return throwError(() => new Error('链路写入失败（服务端未受理），请联网后重试')).pipe(delay(500))
    }

    const existing = this.records.get(sheet.sheetNo)
    let merged: boolean
    let message: string
    if (existing) {
      merged = true
      existing.tokens.push(sheet.token)
      message = `已按原单号 ${sheet.sheetNo} 合并（沿用首次结果，共 ${existing.tokens.length} 次上送）`
    } else {
      merged = false
      this.records.set(sheet.sheetNo, {
        sheetNo: sheet.sheetNo,
        tokens: [sheet.token],
        firstToken: sheet.token,
        storedContent: sheet.content,
        storedAt: sheet.createdAt,
      })
      message = `巡查单 ${sheet.sheetNo} 首次入库成功`
    }
    const outcome = { ok: true, message, merged }
    this.tokenOutcomes.set(sheet.token, outcome)
    return of({ merged, message }).pipe(delay(600))
  }
}
