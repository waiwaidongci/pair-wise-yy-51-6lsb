import { length, lineString } from '@turf/turf'
import type { BlockScopeItem, ReviewRecord, RiskSegment, RoutePackage, ScopeState, Snapshot } from '../types'

let seq = 0
export const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(seq++).toString(36)}`

export const now = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export const scopeKey = (items: BlockScopeItem[]) =>
  items
    .map((item) => `${item.segmentId}:${item.state}:${item.speedLimit}`)
    .sort()
    .join('|')

export const sameScope = (a: BlockScopeItem[], b: BlockScopeItem[]) => scopeKey(a) === scopeKey(b)

export function calcMileage(segments: RiskSegment[], scope: BlockScopeItem[]): { mileageKm: number; blockedKm: number } {
  let mileageKm = 0
  let blockedKm = 0
  segments.forEach((segment) => {
    const item = scope.find((s) => s.segmentId === segment.id)
    const km = length(lineString(segment.coordinates), { units: 'kilometers' })
    mileageKm += km
    if (item?.state === '封锁') {
      blockedKm += km
    } else if (item?.state === '慢行') {
      blockedKm += km * 0.5
    }
  })
  return { mileageKm: round1(mileageKm), blockedKm: round1(blockedKm) }
}

export const round1 = (n: number) => Math.round(n * 10) / 10

/** 只有封锁范围实际发生变化的区段，其复核/会签才失效；其余区段意见继续有效，修订号仅作锚定追溯 */
export function invalidateReviews(
  reviews: ReviewRecord[],
  changedSegmentIds: string[],
): ReviewRecord[] {
  return reviews.map((review) =>
    changedSegmentIds.includes(review.segmentId)
      ? { ...review, valid: false, status: '待确认' as const }
      : review,
  )
}

export function buildInitialSnapshot(segments: RiskSegment[]): Snapshot {
  const draftScope: BlockScopeItem[] = segments.map((segment, index) => ({
    segmentId: segment.id,
    state: (index === 1 ? '封锁' : index === 2 ? '慢行' : '开通') as ScopeState,
    speedLimit: segment.speed.replace('限速 ', ''),
    reason: index === 1 ? '集中修施工封锁' : index === 2 ? '桥梁群慢行' : '',
  }))
  const { mileageKm, blockedKm } = calcMileage(segments, draftScope)
  return {
    version: 1,
    revision: 1,
    committedRevision: 1,
    draftScope,
    committedScope: cloneScope(draftScope),
    mileageKm,
    blockedKm,
    mileageStale: false,
    locked: false,
    lockedAt: '',
    updatedAt: now(),
    checklist: defaultChecklist(),
  }
}

export const defaultChecklist = () => [
  { id: 'C1', label: '封锁范围与调度命令一致，起止里程核对无误', checked: false },
  { id: 'C2', label: '失效的风险复核已按新封锁范围重做', checked: false },
  { id: 'C3', label: '安全 / 运营 / 应急会签全部有效接受', checked: false },
  { id: 'C4', label: '里程与限速重算结果已复核', checked: false },
  { id: 'C5', label: '冲突待办与离线巡查单均已合并处理', checked: false },
]

export const cloneScope = (items: BlockScopeItem[]): BlockScopeItem[] => items.map((item) => ({ ...item }))

export function patchRoute(route: RoutePackage, patch: Partial<RoutePackage>): RoutePackage {
  return { ...route, ...patch }
}
