import { createFeatureSelector, createSelector } from '@ngrx/store'
import type { RouteState } from './route.reducer'
import { evaluateLockConditions, pendingReviewCount } from '../utils/rail.utils'

export const selectRouteState = createFeatureSelector<RouteState>('routes')

export const selectRoutes = createSelector(selectRouteState, (state) => state.routes)
export const selectSelectedRouteId = createSelector(selectRouteState, (state) => state.selectedRouteId)
export const selectSelectedSegmentId = createSelector(selectRouteState, (state) => state.selectedSegmentId)
export const selectComments = createSelector(selectRouteState, (state) => state.comments)
export const selectLoading = createSelector(selectRouteState, (state) => state.loading)
export const selectNotice = createSelector(selectRouteState, (state) => state.notice)

export const selectSnapshotVersion = createSelector(selectRouteState, (state) => state.snapshotVersion)
export const selectBlockedSegmentIds = createSelector(selectRouteState, (state) => state.blockedSegmentIds)
export const selectBlockageReason = createSelector(selectRouteState, (state) => state.blockageReason)
export const selectDraftVersion = createSelector(selectRouteState, (state) => state.draftVersion)

export const selectReviews = createSelector(selectRouteState, (state) => state.reviews)
export const selectCountersigns = createSelector(selectRouteState, (state) => state.countersigns)
export const selectMileages = createSelector(selectRouteState, (state) => state.mileages)

export const selectOnline = createSelector(selectRouteState, (state) => state.online)
export const selectConflictTodos = createSelector(selectRouteState, (state) => state.conflictTodos)
export const selectInspectionOrders = createSelector(selectRouteState, (state) => state.inspectionOrders)

export const selectLockItems = createSelector(selectRouteState, (state) => state.lockItems)
export const selectLocked = createSelector(selectRouteState, (state) => state.locked)
export const selectLockedAt = createSelector(selectRouteState, (state) => state.lockedAt)

/** 待复核数：工作台 / 地图 / 审批页共用同一口径（当前快照下未确认的复核）。 */
export const selectPendingReviewCount = createSelector(selectReviews, selectSnapshotVersion, (reviews, version) => pendingReviewCount(reviews, version))

/** 当前快照下的里程测算（地图页展示，非当前快照即视为失效）。 */
export const selectCurrentMileages = createSelector(selectMileages, selectSnapshotVersion, (mileages, version) =>
  mileages.filter((mileage) => mileage.snapshotVersion === version),
)

export const selectOpenConflictCount = createSelector(selectConflictTodos, (todos) => todos.filter((todo) => todo.status === '待处理').length)
export const selectPendingOfflineCount = createSelector(selectInspectionOrders, (orders) =>
  orders.filter((order) => order.status === '待上传' || order.status === '写入失败').length,
)

export const selectLockConditions = createSelector(selectRouteState, (state) => evaluateLockConditions(state))
export const selectAllLockConfirmed = createSelector(selectLockItems, (items) => items.every((item) => item.confirmed))

/** 锁定清单行（条件是否满足 + 是否已逐项确认），供审批页直接渲染。 */
export const selectLockRows = createSelector(selectLockItems, selectLockConditions, (items, conditions) =>
  items.map((item) => ({
    key: item.key,
    label: item.label,
    confirmed: item.confirmed,
    met: conditions[item.key],
  })),
)

/** 许可缺失数（工作台指标卡专用）。 */
export const selectPermissionMissingCount = createSelector(selectRoutes, (routes) =>
  routes.filter((route) => route.permission !== '有效').length,
)
