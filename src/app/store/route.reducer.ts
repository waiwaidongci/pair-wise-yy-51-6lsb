import { createReducer, on } from '@ngrx/store'
import type {
  AuditEntry, InspectionSheet, ReviewRecord, RoutePackage, SaveConflict,
} from '../types'
import * as RouteActions from './route.actions'
import {
  buildInitialSnapshot, calcMileage, cloneScope, defaultChecklist, invalidateReviews,
  nextId, now,
} from './snapshot.utils'

export interface RouteState {
  routes: RoutePackage[]
  selectedRouteId: string
  selectedSegmentId: string
  reviews: ReviewRecord[]
  conflicts: SaveConflict[]
  inspections: InspectionSheet[]
  online: boolean
  syncFault: boolean
  audit: AuditEntry[]
  loading: boolean
  error: string
  version: number
}

export interface RootState {
  routes: RouteState
}

const seedReviews: ReviewRecord[] = [
  { id: 'RV-31', routeId: 'HG-260929-018', segmentId: 'S-203', segmentName: '西峡水源保护区段', kind: '会签', role: '安全', author: '韩洁', content: '水源地保护段限速 45 km/h，并要求随车配置吸附围油栏。', status: '待确认', revision: 1, valid: true, updatedAt: '今天 16:42' },
  { id: 'RV-32', routeId: 'HG-260929-018', segmentId: 'S-207', segmentName: '郑州北至商丘区段', kind: '会签', role: '应急', author: '罗晋', content: '长隧道出口需增加 15 分钟现场监护窗口，接受后方可放行。', status: '已接受', revision: 1, valid: true, updatedAt: '今天 16:18' },
  { id: 'RV-33', routeId: 'HG-260930-006', segmentId: 'S-304', segmentName: '三门峡至洛阳区段', kind: '风险复核', role: '运营', author: '闻涛', content: '跨河桥撞击风险按中等级别复核，建议慢行 60 km/h。', status: '已接受', revision: 1, valid: true, updatedAt: '今天 14:20' },
]

export const initialState: RouteState = {
  routes: [],
  selectedRouteId: '',
  selectedSegmentId: '',
  reviews: seedReviews,
  conflicts: [],
  inspections: [],
  online: true,
  syncFault: false,
  audit: [
    { id: 'AU-1', at: '16:42', text: '韩洁新增 S-203 限速与吸附物资会签', source: '安全专业' },
    { id: 'AU-2', at: '16:18', text: '罗晋接受隧道出口监护条件（修订 1）', source: '应急专业' },
    { id: 'AU-3', at: '15:50', text: '系统生成替代路径 R-ALT-02，风险分由 78 降至 71', source: '规则引擎' },
  ],
  loading: false,
  error: '',
  version: 1,
}

const appendAudit = (audit: AuditEntry[], text: string, source: string): AuditEntry[] =>
  [{ id: nextId('AU'), at: now(), text, source }, ...audit].slice(0, 40)

const withRoute = (state: RouteState, routeId: string, fn: (route: RoutePackage) => RoutePackage): RoutePackage[] =>
  state.routes.map((route) => (route.id === routeId ? fn(route) : route))

const changedSegmentIds = (route: RoutePackage, nextScope = route.snapshot.draftScope): string[] =>
  nextScope
    .filter((item) => {
      const prev = route.snapshot.draftScope.find((s) => s.segmentId === item.segmentId)
      return !prev || prev.state !== item.state || prev.speedLimit !== item.speedLimit || prev.reason !== item.reason
    })
    .map((item) => item.segmentId)

export const routeReducer = createReducer(
  initialState,
  on(RouteActions.loadRoutes, (state) => ({ ...state, loading: true, error: '' })),
  on(RouteActions.loadRoutesSuccess, (state, { routes }) => {
    const withSnapshots = routes.map((route) =>
      route.snapshot ? route : { ...route, snapshot: buildInitialSnapshot(route.segments) },
    )
    return {
      ...state,
      loading: false,
      routes: withSnapshots,
      selectedRouteId: state.selectedRouteId || withSnapshots[0]?.id || '',
      selectedSegmentId: state.selectedSegmentId || withSnapshots[0]?.segments[0]?.id || '',
    }
  }),
  on(RouteActions.loadRoutesFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(RouteActions.selectRoute, (state, { id }) => ({
    ...state,
    selectedRouteId: id,
    selectedSegmentId: state.routes.find((route) => route.id === id)?.segments[0]?.id ?? '',
  })),
  on(RouteActions.selectSegment, (state, { id }) => ({ ...state, selectedSegmentId: id })),

  /** 封锁范围一变：修订号 +1，受影响区段的复核/会签立即失效，里程立即重算 */
  on(RouteActions.changeBlockScope, (state, { routeId, items, dispatcher, reason }) => {
    const route = state.routes.find((r) => r.id === routeId)
    if (!route || route.snapshot.locked) return state
    const affected = changedSegmentIds(route, items)
    if (affected.length === 0) return state
    const { mileageKm, blockedKm } = calcMileage(route.segments, items)
    const revision = route.snapshot.revision + 1
    return {
      ...state,
      version: state.version + 1,
      routes: withRoute(state, routeId, (r) => ({
        ...r,
        updatedAt: `今天 ${now()}`,
        snapshot: {
          ...r.snapshot,
          version: r.snapshot.version + 1,
          revision,
          draftScope: cloneScope(items),
          mileageKm,
          blockedKm,
          mileageStale: false,
          updatedAt: now(),
        },
      })),
      reviews: invalidateReviews(state.reviews, affected),
      audit: appendAudit(
        state.audit,
        `${dispatcher} 调整封锁范围（修订 ${revision}）：${affected.map((id) => route.segments.find((s) => s.id === id)?.name ?? id).join('、') || '范围'} ${reason}；关联复核与会签已失效，里程重算为 ${mileageKm} km`,
        '封锁快照',
      ),
    }
  }),
  /** 先到结果生效 */
  on(RouteActions.saveSnapshotSuccess, (state, { routeId, revision, scope, dispatcher }) => ({
    ...state,
    routes: withRoute(state, routeId, (route) => ({
      ...route,
      snapshot: { ...route.snapshot, revision, committedRevision: revision, committedScope: cloneScope(scope), draftScope: cloneScope(scope), updatedAt: now() },
    })),
    audit: appendAudit(state.audit, `${dispatcher} 的保存生效（先到）：封锁快照锁定为修订 ${revision}`, '并发保存'),
  })),
  /** 后到内容进入冲突待办，不覆盖先到结果 */
  on(RouteActions.saveSnapshotConflict, (state, { conflict }) => ({
    ...state,
    conflicts: [conflict, ...state.conflicts],
    audit: appendAudit(
      state.audit,
      `${conflict.dispatcher} 基于修订 ${conflict.baseRevision} 的保存晚到，当前已生效修订 ${conflict.currentRevision}，内容转入冲突待办`,
      '并发保存',
    ),
  })),
  on(RouteActions.adoptConflict, (state, { conflictId, dispatcher }) => {
    const conflict = state.conflicts.find((c) => c.id === conflictId)
    if (!conflict || conflict.status !== '待处理') return state
    const route = state.routes.find((r) => r.id === conflict.routeId)
    if (!route) return state
    const affected = conflict.scope
      .filter((item) => {
        const prev = route.snapshot.committedScope.find((s) => s.segmentId === item.segmentId)
        return !prev || prev.state !== item.state || prev.speedLimit !== item.speedLimit
      })
      .map((item) => item.segmentId)
    const revision = route.snapshot.revision + 1
    const { mileageKm, blockedKm } = calcMileage(route.segments, conflict.scope)
    return {
      ...state,
      conflicts: state.conflicts.map((c) => (c.id === conflictId ? { ...c, status: '已采纳' as const } : c)),
      routes: withRoute(state, conflict.routeId, (r) => ({
        ...r,
        snapshot: {
          ...r.snapshot,
          revision,
          committedRevision: revision,
          draftScope: cloneScope(conflict.scope),
          committedScope: cloneScope(conflict.scope),
          mileageKm,
          blockedKm,
          mileageStale: false,
        },
      })),
      reviews: invalidateReviews(state.reviews, affected),
      audit: appendAudit(state.audit, `冲突待办 ${conflict.id} 经 ${dispatcher} 采纳合并，生效修订 ${revision}`, '冲突待办'),
    }
  }),
  on(RouteActions.discardConflict, (state, { conflictId }) => ({
    ...state,
    conflicts: state.conflicts.map((c) => (c.id === conflictId ? { ...c, status: '已放弃' as const } : c)),
    audit: appendAudit(state.audit, `冲突待办 ${conflictId} 已放弃，先到结果保持生效`, '冲突待办'),
  })),

  on(RouteActions.addReview, (state, { routeId, segmentId, kind, role, content }) => {
    const route = state.routes.find((r) => r.id === routeId)
    if (!route) return state
    const segment = route.segments.find((s) => s.id === segmentId)
    const review: ReviewRecord = {
      id: nextId('RV'),
      routeId,
      segmentId,
      segmentName: segment?.name ?? segmentId,
      kind,
      role,
      author: '当前审阅人',
      content,
      status: '待确认',
      revision: route.snapshot.revision,
      valid: true,
      updatedAt: `今天 ${now()}`,
    }
    return {
      ...state,
      reviews: [review, ...state.reviews],
      audit: appendAudit(state.audit, `新增${kind}（${role}）锚定 ${segmentId} 修订 ${route.snapshot.revision}`, '审批会签'),
    }
  }),
  on(RouteActions.redoReview, (state, { routeId, reviewId, content }) => {
    const route = state.routes.find((r) => r.id === routeId)
    if (!route) return state
    return {
      ...state,
      reviews: state.reviews.map((review) =>
        review.id === reviewId
          ? { ...review, content, status: '待确认' as const, revision: route.snapshot.revision, valid: true, updatedAt: `今天 ${now()}` }
          : review,
      ),
      audit: appendAudit(state.audit, `复核 ${reviewId} 已按修订 ${route.snapshot.revision} 重做`, '审批会签'),
    }
  }),
  on(RouteActions.resolveReview, (state, { reviewId, status }) => ({
    ...state,
    reviews: state.reviews.map((review) =>
      review.id === reviewId && review.valid ? { ...review, status } : review,
    ),
    audit: appendAudit(
      state.audit,
      `会签 ${reviewId} ${status === '已接受' ? '接受' : '退回补件'}`,
      '审批会签',
    ),
  })),

  on(RouteActions.toggleCheckItem, (state, { routeId, itemId }) => ({
    ...state,
    routes: withRoute(state, routeId, (route) => ({
      ...route,
      snapshot: {
        ...route.snapshot,
        checklist: route.snapshot.checklist.map((item) =>
          item.id === itemId ? { ...item, checked: !item.checked } : item,
        ),
      },
    })),
  })),
  on(RouteActions.lockSnapshot, (state, { routeId }) => {
    const route = state.routes.find((r) => r.id === routeId)
    if (!route || route.snapshot.locked) return state
    const allChecked = route.snapshot.checklist.every((item) => item.checked)
    if (!allChecked) return state
    return {
      ...state,
      routes: withRoute(state, routeId, (r) => ({ ...r, snapshot: { ...r.snapshot, locked: true, lockedAt: now() } })),
      audit: appendAudit(state.audit, `封锁快照修订 ${route.snapshot.revision} 经逐项确认后锁定`, '基线锁定'),
    }
  }),
  on(RouteActions.unlockSnapshot, (state, { routeId }) => ({
    ...state,
    routes: withRoute(state, routeId, (route) => ({ ...route, snapshot: { ...route.snapshot, locked: false, lockedAt: '', checklist: route.snapshot.checklist.map((item) => ({ ...item, checked: false })) } })),
    audit: appendAudit(state.audit, '封锁快照已解锁，检查项重置', '基线锁定'),
  })),

  on(RouteActions.createAlternative, (state) => {
    const route = state.routes.find((r) => r.id === state.selectedRouteId)
    if (!route) return state
    const alt: RoutePackage = {
      ...route,
      id: `${route.id}-ALT`,
      score: Math.max(72, route.score - 2),
      updatedAt: `今天 ${now()}`,
      snapshot: { ...buildInitialSnapshot(route.segments), checklist: defaultChecklist() },
    }
    return {
      ...state,
      routes: state.routes.some((r) => r.id === alt.id)
        ? state.routes.map((r) => (r.id === alt.id ? alt : r))
        : [alt, ...state.routes],
      audit: appendAudit(state.audit, `系统生成替代路径 ${alt.id}，风险分由 ${route.score} 降至 ${alt.score}`, '规则引擎'),
    }
  }),

  /** 断网巡查单：仅入队，联网后由 effect 按原单号合并 */
  on(RouteActions.queueInspection, (state, { sheet }) =>
    state.inspections.some((item) => item.token === sheet.token)
      ? state
      : { ...state, inspections: [sheet, ...state.inspections] },
  ),
  on(RouteActions.inspectStatusChanged, (state, { token, status, message }) => ({
    ...state,
    inspections: state.inspections.map((sheet) =>
      sheet.token === token
        ? { ...sheet, status, message: message ?? sheet.message, attempts: status === '同步中' ? sheet.attempts + 1 : sheet.attempts }
        : sheet,
    ),
  })),
  on(RouteActions.inspectSyncSucceeded, (state, { token, merged, message }) => {
    const sheet = state.inspections.find((item) => item.token === token)
    if (!sheet) return state
    return {
      ...state,
      inspections: state.inspections.map((item) =>
        item.token === token ? { ...item, status: '已入库' as const, merged, message } : item,
      ),
      audit: appendAudit(
        state.audit,
        `巡查单 ${sheet.sheetNo}${merged ? ' 按原单号合并' : ''}入库（${sheet.segmentId}）`,
        '离线巡查',
      ),
    }
  }),
  on(RouteActions.inspectSyncFailed, (state, { token, message }) => ({
    ...state,
    inspections: state.inspections.map((sheet) =>
      sheet.token === token ? { ...sheet, status: '写入失败' as const, message } : sheet,
    ),
  })),
  on(RouteActions.hydrateInspections, (state, { sheets }) => ({
    ...state,
    inspections: sheets.length ? sheets : state.inspections,
  })),
  on(RouteActions.setOnline, (state, { online }) => ({ ...state, online })),
  on(RouteActions.setSyncFault, (state, { fault }) => ({ ...state, syncFault: fault })),
)
