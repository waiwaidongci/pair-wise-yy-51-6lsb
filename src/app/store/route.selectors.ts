import { createSelector } from '@ngrx/store'
import type { RouteState } from './route.reducer'

/** 待复核数的唯一口径：锚定快照修订号失效 + 未接受，工作台/地图/审批页共用 */
export const selectPendingReviewCount = createSelector(
  (state: { routes: RouteState }) => state.routes,
  (routeState) =>
    routeState.reviews.filter((review) => !review.valid || review.status !== '已接受').length,
)

export const selectInvalidReviewCount = createSelector(
  (state: { routes: RouteState }) => state.routes,
  (routeState) => routeState.reviews.filter((review) => !review.valid).length,
)

export const selectPendingConflictCount = createSelector(
  (state: { routes: RouteState }) => state.routes,
  (routeState) => routeState.conflicts.filter((conflict) => conflict.status === '待处理').length,
)

export const selectPendingInspectionCount = createSelector(
  (state: { routes: RouteState }) => state.routes,
  (routeState) =>
    routeState.inspections.filter((sheet) => sheet.status === '离线待传' || sheet.status === '写入失败').length,
)

export const selectSelectedRoute = createSelector(
  (state: { routes: RouteState }) => state.routes,
  (routeState) => routeState.routes.find((route) => route.id === routeState.selectedRouteId),
)
