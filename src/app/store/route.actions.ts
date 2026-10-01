import { createAction, props } from '@ngrx/store'
import type { ConflictTodo, Countersignature, InspectionOrder, LockItem, ReviewComment, ReviewTask, RoutePackage } from '../types'

export const loadRoutes = createAction('[Route Workbench] Load Routes')
export const loadRoutesSuccess = createAction('[Route API] Load Routes Success', props<{
  routes: RoutePackage[]
  blockedSegmentIds: string[]
  snapshotVersion: number
  draftVersion: number
}>())
export const loadRoutesFailure = createAction('[Route API] Load Routes Failure', props<{ error: string }>())
export const selectRoute = createAction('[Route Workbench] Select Route', props<{ id: string }>())
export const selectSegment = createAction('[Risk Map] Select Segment', props<{ id: string }>())
export const updateSegmentLevel = createAction('[Risk Map] Update Level', props<{ id: string; level: RoutePackage['segments'][number]['level'] }>())
export const addComment = createAction('[Approval] Add Comment', props<{ comment: ReviewComment }>())
export const resolveComment = createAction('[Approval] Resolve Comment', props<{ id: string; status: ReviewComment['status'] }>())
export const createAlternative = createAction('[Risk Map] Create Alternative')

/** 封锁范围变更：快照版本 +1，复核/会签/里程立即按新快照失效重算 */
export const setBlockedSegments = createAction('[Snapshot] Set Blocked Segments', props<{ segmentIds: string[]; reason: string }>())

/** 复核确认（锚定当前快照；快照变更后需重新确认） */
export const confirmReview = createAction('[Approval] Confirm Review', props<{ segmentId: string }>())
/** 会签签署（锚定当前快照） */
export const signCountersign = createAction('[Approval] Sign Countersign', props<{ segmentId: string; role: Countersignature['role'] }>())

/** 保存草案：携带基于的草案版本，先到生效、后到进入冲突待办 */
export const saveDraft = createAction('[Workbench] Save Draft', props<{ baseVersion: number; author: string; summary: string }>())
export const saveDraftSuccess = createAction('[Workbench] Save Draft Success', props<{ version: number; savedAt: string }>())
export const saveDraftConflict = createAction('[Workbench] Save Draft Conflict', props<{ conflict: ConflictTodo }>())
export const resolveConflict = createAction('[Workbench] Resolve Conflict', props<{ id: string; decision: 'keep-first' | 'discard' }>())

/** 联网 / 断网 */
export const setOnline = createAction('[Inspection] Set Online', props<{ online: boolean }>())

/** 新建巡查单（断网缓存，联网后按原单号合并） */
export const createInspectionOrder = createAction('[Inspection] Create Order', props<{ order: InspectionOrder }>())
export const uploadInspectionOrder = createAction('[Inspection] Upload Order', props<{ order: InspectionOrder }>())
export const uploadInspectionOrderSuccess = createAction('[Inspection] Upload Order Success', props<{ orderNo: string; idempotencyKey: string; merged: boolean }>())
export const uploadInspectionOrderFailure = createAction('[Inspection] Upload Order Failure', props<{ idempotencyKey: string }>())
export const retryInspectionOrder = createAction('[Inspection] Retry Order', props<{ id: string }>())

/** 锁定前逐项确认 */
export const confirmLockItem = createAction('[Approval] Confirm Lock Item', props<{ key: LockItem['key'] }>())
export const lockBaseline = createAction('[Approval] Lock Baseline')
export const lockBaselineSuccess = createAction('[Approval] Lock Baseline Success', props<{ lockedAt: string }>())
export const lockBaselineFailure = createAction('[Approval] Lock Baseline Failure', props<{ reason: string }>())
