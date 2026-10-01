import { createReducer, on } from '@ngrx/store'
import type {
  ConflictTodo,
  Countersignature,
  InspectionOrder,
  LockItem,
  MileageCalc,
  ReviewComment,
  ReviewTask,
  RoutePackage,
} from '../types'
import {
  buildCountersigns,
  buildMileages,
  buildReviews,
  evaluateLockConditions,
  LOCK_ITEM_LABELS,
} from '../utils/rail.utils'
import * as RouteActions from './route.actions'

export interface RouteState {
  routes: RoutePackage[]
  selectedRouteId: string
  selectedSegmentId: string
  comments: ReviewComment[]
  loading: boolean
  error: string
  version: number

  /** 共用快照版本（封锁范围变更即自增，复核/会签/里程全部锚定它） */
  snapshotVersion: number
  blockedSegmentIds: string[]
  blockageReason: string
  /** 草案版本（乐观并发保存用，先到生效、后到进冲突待办） */
  draftVersion: number

  reviews: ReviewTask[]
  countersigns: Countersignature[]
  mileages: MileageCalc[]

  online: boolean
  conflictTodos: ConflictTodo[]
  inspectionOrders: InspectionOrder[]

  lockItems: LockItem[]
  locked: boolean
  lockedAt: string
  notice: string
}

const initialLockItems: LockItem[] = LOCK_ITEM_LABELS.map((item) => ({ key: item.key, label: item.label, confirmed: false }))

export const initialState: RouteState = {
  routes: [], selectedRouteId: '', selectedSegmentId: '', loading: false, error: '', version: 6,
  snapshotVersion: 1, blockedSegmentIds: [], blockageReason: '', draftVersion: 1,
  reviews: [], countersigns: [], mileages: [],
  online: true, conflictTodos: [], inspectionOrders: [],
  lockItems: initialLockItems, locked: false, lockedAt: '', notice: '',
  comments: [
    { id: 'RV-31', segmentId: 'S-203', role: '安全', author: '韩洁', content: '水源地保护段限速 45 km/h，并要求随车配置吸附围油栏。', status: '待确认' },
    { id: 'RV-32', segmentId: 'S-207', role: '应急', author: '罗晋', content: '长隧道出口需增加 15 分钟现场监护窗口，接受后方可放行。', status: '已接受' },
  ],
}

/** 快照变更后重建派生数据，并清空逐项确认（基线需按新快照重新锁定）。 */
function recomputeDerived(state: RouteState, blockedSegmentIds: string[], snapshotVersion: number) {
  return {
    reviews: buildReviews(state.routes, blockedSegmentIds, snapshotVersion),
    countersigns: buildCountersigns(state.routes, blockedSegmentIds, snapshotVersion),
    mileages: buildMileages(state.routes, blockedSegmentIds, snapshotVersion),
    lockItems: state.lockItems.map((item) => ({ ...item, confirmed: false })),
    locked: false,
    lockedAt: '',
  }
}

export const routeReducer = createReducer(
  initialState,
  on(RouteActions.loadRoutes, (state) => ({ ...state, loading: true, error: '' })),
  on(RouteActions.loadRoutesSuccess, (state, { routes, blockedSegmentIds, snapshotVersion, draftVersion }) => ({
    ...state,
    loading: false,
    routes,
    blockedSegmentIds,
    snapshotVersion,
    draftVersion,
    selectedRouteId: state.selectedRouteId || routes[0]?.id || '',
    selectedSegmentId: state.selectedSegmentId || routes[0]?.segments[0]?.id || '',
    ...recomputeDerived(state, blockedSegmentIds, snapshotVersion),
  })),
  on(RouteActions.loadRoutesFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(RouteActions.selectRoute, (state, { id }) => ({ ...state, selectedRouteId: id, selectedSegmentId: state.routes.find((route) => route.id === id)?.segments[0]?.id ?? '' })),
  on(RouteActions.selectSegment, (state, { id }) => ({ ...state, selectedSegmentId: id })),
  on(RouteActions.updateSegmentLevel, (state, { id, level }) => ({
    ...state,
    version: state.version + 1,
    routes: state.routes.map((route) => ({ ...route, segments: route.segments.map((segment) => segment.id === id ? { ...segment, level, status: level === '高' ? '需绕行' as const : '待复核' as const } : segment) })),
  })),
  on(RouteActions.addComment, (state, { comment }) => ({ ...state, comments: [comment, ...state.comments] })),
  on(RouteActions.resolveComment, (state, { id, status }) => ({ ...state, comments: state.comments.map((comment) => comment.id === id ? { ...comment, status } : comment) })),
  on(RouteActions.createAlternative, (state) => ({
    ...state,
    version: state.version + 1,
    routes: state.routes.map((route) => route.id === state.selectedRouteId ? { ...route, id: `${route.id}-ALT`, score: Math.max(72, route.score - 2) } : route),
  })),

  // 封锁范围变更：快照版本 +1，复核/会签/里程立即按新快照失效重算
  on(RouteActions.setBlockedSegments, (state, { segmentIds, reason }) => {
    const snapshotVersion = state.snapshotVersion + 1
    return {
      ...state,
      snapshotVersion,
      blockedSegmentIds: segmentIds,
      blockageReason: reason,
      notice: `封锁范围已变更，快照 v${snapshotVersion} 已生效，复核 / 会签 / 里程已全部重算。`,
      ...recomputeDerived(state, segmentIds, snapshotVersion),
    }
  }),

  // 复核确认（仅当前快照可确认；旧快照项保持失效态）
  on(RouteActions.confirmReview, (state, { segmentId }) => ({
    ...state,
    reviews: state.reviews.map((review) =>
      review.segmentId === segmentId && review.snapshotVersion === state.snapshotVersion
        ? { ...review, status: '已确认' as const }
        : review,
    ),
  })),

  // 会签签署（锚定当前快照）
  on(RouteActions.signCountersign, (state, { segmentId, role }) => ({
    ...state,
    countersigns: state.countersigns.map((item) =>
      item.segmentId === segmentId && item.role === role && item.snapshotVersion === state.snapshotVersion
        ? { ...item, status: '已会签' as const }
        : item,
    ),
  })),

  // 先到保存生效：草案版本自增
  on(RouteActions.saveDraftSuccess, (state, { version }) => ({
    ...state,
    draftVersion: version,
    notice: `草案已保存（草案版本 v${version}），先到结果已生效。`,
  })),

  // 后到保存进入冲突待办，不覆盖任何既有结果
  on(RouteActions.saveDraftConflict, (state, { conflict }) => ({
    ...state,
    conflictTodos: [conflict, ...state.conflictTodos],
    notice: `后到保存（${conflict.author}）基于旧草案，已进入冲突待办，未覆盖先到结果。`,
  })),

  on(RouteActions.resolveConflict, (state, { id, decision }) => ({
    ...state,
    conflictTodos: state.conflictTodos.map((item) =>
      item.id === id ? { ...item, status: decision === 'keep-first' ? '已保留先到' as const : '已丢弃' as const } : item,
    ),
  })),

  // 联网状态
  on(RouteActions.setOnline, (state, { online }) => ({
    ...state,
    online,
    notice: online ? '已联网：缓存的巡查单将按原单号合并上传。' : '已断网：新巡查单将缓存本地，联网后自动合并。',
  })),

  // 新建巡查单入队（断网缓存，联网后由 effect 上传）
  on(RouteActions.createInspectionOrder, (state, { order }) => ({
    ...state,
    inspectionOrders: [order, ...state.inspectionOrders],
  })),

  // 上传成功：按原单号合并，沿用首次结果
  on(RouteActions.uploadInspectionOrderSuccess, (state, { orderNo, merged }) => ({
    ...state,
    inspectionOrders: state.inspectionOrders.map((item) =>
      item.orderNo === orderNo
        ? { ...item, status: merged ? '已合并' as const : '已上传' as const, failCount: 0 }
        : item,
    ),
  })),

  // 上传失败：保持同一幂等键，状态置为写入失败，等待重试（不产生新单号）
  on(RouteActions.uploadInspectionOrderFailure, (state, { idempotencyKey }) => ({
    ...state,
    inspectionOrders: state.inspectionOrders.map((item) =>
      item.idempotencyKey === idempotencyKey
        ? { ...item, status: '写入失败' as const, failCount: item.failCount + 1 }
        : item,
    ),
  })),

  on(RouteActions.retryInspectionOrder, (state, { id }) => ({
    ...state,
    inspectionOrders: state.inspectionOrders.map((item) =>
      item.id === id ? { ...item, status: '待上传' as const } : item,
    ),
  })),

  // 锁定前逐项确认：仅当客观条件满足时勾选
  on(RouteActions.confirmLockItem, (state, { key }) => {
    const conditions = evaluateLockConditions(state)
    if (!conditions[key]) return { ...state, notice: '该锁定项条件尚未满足，请先按当前快照完成复核 / 会签 / 里程重算并处理冲突与待传巡查单。' }
    return {
      ...state,
      lockItems: state.lockItems.map((item) => item.key === key ? { ...item, confirmed: true } : item),
      notice: `已确认锁定项：${LOCK_ITEM_LABELS.find((item) => item.key === key)?.label ?? key}。`,
    }
  }),

  on(RouteActions.lockBaseline, (state) => {
    const allConfirmed = state.lockItems.every((item) => item.confirmed)
    if (!allConfirmed) return { ...state, notice: '请先逐项确认全部锁定项，再锁定基线。' }
    return { ...state, locked: true, lockedAt: new Date().toISOString(), notice: '基线已锁定：复核、会签、里程与附件按当前快照只读保存。' }
  }),
  on(RouteActions.lockBaselineSuccess, (state, { lockedAt }) => ({ ...state, locked: true, lockedAt })),
  on(RouteActions.lockBaselineFailure, (state, { reason }) => ({ ...state, notice: reason })),
)
