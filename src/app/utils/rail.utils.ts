import { length, lineString } from '@turf/turf'
import type { Countersignature, InspectionOrder, LockItem, MileageCalc, ReviewTask, RoutePackage } from '../types'

/** 生成客户端临时 id */
export function rid(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 7)
  const tail = Date.now().toString(36).slice(-4)
  return `${prefix}-${rand}${tail}`
}

/** 生成稳定的幂等键（断网重试全程不变） */
export function idempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `IDEM-${crypto.randomUUID()}`
  return `IDEM-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * 依据封锁范围重建复核任务。
 * 封锁区段或高风险区段 -> 待复核；其余 -> 已确认。全部锚定同一快照版本。
 * （封锁区段另需安全/运营/应急逐角色会签，见 buildCountersigns。）
 */
export function buildReviews(routes: RoutePackage[], blockedSegmentIds: string[], snapshotVersion: number): ReviewTask[] {
  const blocked = new Set(blockedSegmentIds)
  const reviews: ReviewTask[] = []
  for (const route of routes) {
    for (const segment of route.segments) {
      const status: ReviewTask['status'] = blocked.has(segment.id) || segment.level === '高' ? '待复核' : '已确认'
      reviews.push({ id: `REV-${segment.id}`, routeId: route.id, segmentId: segment.id, status, snapshotVersion })
    }
  }
  return reviews
}

/** 依据封锁范围重建会签：封锁或高风险区段需安全/运营/应急逐角色会签。 */
export function buildCountersigns(routes: RoutePackage[], blockedSegmentIds: string[], snapshotVersion: number): Countersignature[] {
  const blocked = new Set(blockedSegmentIds)
  const roles = ['安全', '运营', '应急'] as const
  const countersigns: Countersignature[] = []
  for (const route of routes) {
    for (const segment of route.segments) {
      if (!blocked.has(segment.id) && segment.level !== '高') continue
      for (const role of roles) {
        countersigns.push({ id: `CS-${segment.id}-${role}`, routeId: route.id, segmentId: segment.id, role, status: '待会签', snapshotVersion })
      }
    }
  }
  return countersigns
}

/** 依据当前快照重算里程（Turf 实测），并标记受限区段数与预计运行时分。 */
export function buildMileages(routes: RoutePackage[], blockedSegmentIds: string[], snapshotVersion: number): MileageCalc[] {
  const blocked = new Set(blockedSegmentIds)
  return routes.map((route) => {
    const km = length(lineString(route.segments.flatMap((segment) => segment.coordinates)), { units: 'kilometers' })
    const restrictedCount = route.segments.filter((segment) => blocked.has(segment.id)).length
    const estimatedMinutes = Math.round((km / 55) * 60 + restrictedCount * 8)
    return { routeId: route.id, km: Math.round(km * 10) / 10, estimatedMinutes, restrictedCount, snapshotVersion }
  })
}

/** 待复核数：仅统计当前快照下未确认的复核（工作台/地图/审批页共用同一口径）。 */
export function pendingReviewCount(reviews: ReviewTask[], snapshotVersion: number): number {
  return reviews.filter((review) => review.snapshotVersion === snapshotVersion && review.status === '待复核').length
}

export interface LockConditions {
  reviews: boolean
  countersigns: boolean
  mileages: boolean
  conflicts: boolean
  offline: boolean
}

/** 锁定前逐项确认的客观条件（全部派生自当前快照，避免各页口径不一）。 */
export function evaluateLockConditions(state: {
  reviews: ReviewTask[]
  countersigns: Countersignature[]
  mileages: MileageCalc[]
  conflictTodos: { status: string }[]
  inspectionOrders: InspectionOrder[]
  snapshotVersion: number
}): LockConditions {
  const current = (item: { snapshotVersion: number }) => item.snapshotVersion === state.snapshotVersion
  return {
    reviews: state.reviews.length > 0 && state.reviews.every((r) => current(r) && r.status === '已确认'),
    countersigns: state.countersigns.length > 0 && state.countersigns.every((c) => current(c) && c.status === '已会签'),
    mileages: state.mileages.length > 0 && state.mileages.every((m) => current(m)),
    conflicts: state.conflictTodos.every((t) => t.status !== '待处理'),
    offline: state.inspectionOrders.every((o) => o.status === '已上传' || o.status === '已合并'),
  }
}

export const LOCK_ITEM_LABELS: { key: keyof LockConditions; label: string }[] = [
  { key: 'reviews', label: '区段复核已逐项确认' },
  { key: 'countersigns', label: '安全 / 运营 / 应急会签已签署' },
  { key: 'mileages', label: '里程测算已按当前快照重算' },
  { key: 'conflicts', label: '冲突待办已处理，后到内容未覆盖先到结果' },
  { key: 'offline', label: '断网巡查单已按原单号合并上传' },
]
