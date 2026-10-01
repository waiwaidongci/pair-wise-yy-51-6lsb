import { createAction, props } from '@ngrx/store'
import type {
  AuditEntry, BlockScopeItem, InspectionSheet, InspectionStatus,
  ReviewKind, ReviewStatus, RoutePackage, SaveConflict,
} from '../types'

export const loadRoutes = createAction('[Route Workbench] Load Routes')
export const loadRoutesSuccess = createAction('[Route API] Load Routes Success', props<{ routes: RoutePackage[] }>())
export const loadRoutesFailure = createAction('[Route API] Load Routes Failure', props<{ error: string }>())

export const selectRoute = createAction('[Route Workbench] Select Route', props<{ id: string }>())
export const selectSegment = createAction('[Risk Map] Select Segment', props<{ id: string }>())

/** 封锁范围变更：关联复核、会签与里程立即失效 */
export const changeBlockScope = createAction(
  '[Workbench] Change Block Scope',
  props<{ routeId: string; items: BlockScopeItem[]; dispatcher: string; reason: string }>(),
)
/** 调度保存：先到生效，后到进冲突待办 */
export const saveSnapshotRequested = createAction(
  '[Workbench] Save Snapshot Requested',
  props<{ routeId: string; dispatcher: string; baseRevision: number; scope: BlockScopeItem[]; reason: string }>(),
)
export const saveSnapshotSuccess = createAction(
  '[Snapshot] Save Snapshot Success',
  props<{ routeId: string; revision: number; scope: BlockScopeItem[]; dispatcher: string }>(),
)
export const saveSnapshotConflict = createAction('[Snapshot] Save Snapshot Conflict', props<{ conflict: SaveConflict }>())
export const adoptConflict = createAction('[Workbench] Adopt Conflict', props<{ conflictId: string; dispatcher: string }>())
export const discardConflict = createAction('[Workbench] Discard Conflict', props<{ conflictId: string }>())

/** 复核 / 会签：失效条目必须重做 */
export const addReview = createAction(
  '[Approval] Add Review',
  props<{ routeId: string; segmentId: string; kind: ReviewKind; role: string; content: string }>(),
)
export const redoReview = createAction('[Approval] Redo Review', props<{ routeId: string; reviewId: string; content: string }>())
export const resolveReview = createAction('[Approval] Resolve Review', props<{ reviewId: string; status: ReviewStatus }>())

/** 锁定前逐项确认 */
export const toggleCheckItem = createAction('[Approval] Toggle Check Item', props<{ routeId: string; itemId: string }>())
export const lockSnapshot = createAction('[Approval] Lock Snapshot', props<{ routeId: string }>())
export const unlockSnapshot = createAction('[Approval] Unlock Snapshot', props<{ routeId: string }>())

export const createAlternative = createAction('[Risk Map] Create Alternative')

/** 断网巡查单 */
export const queueInspection = createAction('[Inspection] Queue', props<{ sheet: InspectionSheet }>())
export const syncInspectionsRequested = createAction('[Inspection] Sync Requested')
export const inspectStatusChanged = createAction('[Inspection] Status Changed', props<{ token: string; status: InspectionStatus; message?: string }>())
export const inspectSyncSucceeded = createAction(
  '[Inspection API] Sync Succeeded',
  props<{ token: string; merged: boolean; message: string }>(),
)
export const inspectSyncFailed = createAction('[Inspection API] Sync Failed', props<{ token: string; message: string }>())
export const setOnline = createAction('[Inspection] Set Online', props<{ online: boolean }>())
export const setSyncFault = createAction('[Inspection] Set Simulated Write Fault', props<{ fault: boolean }>())
export const hydrateInspections = createAction('[Inspection] Hydrate', props<{ sheets: InspectionSheet[] }>())

export const auditAppended = createAction('[Audit] Appended', props<{ entry: AuditEntry }>())
