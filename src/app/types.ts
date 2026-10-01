export type RiskLevel = '高' | '中' | '低'
export type SegmentStatus = '待复核' | '已确认' | '需绕行'
export type ScopeState = '封锁' | '慢行' | '开通'

export interface RiskSegment {
  id: string
  name: string
  from: string
  to: string
  km: string
  speed: string
  risks: string[]
  level: RiskLevel
  status: SegmentStatus
  coordinates: [number, number][]
}

export type ReviewKind = '风险复核' | '会签'
export type ReviewStatus = '待确认' | '已接受' | '已退回'

/** 复核 / 会签条目必须锚定生成时的封锁快照修订号，修订号落后即失效重算 */
export interface ReviewRecord {
  id: string
  routeId: string
  segmentId: string
  segmentName: string
  kind: ReviewKind
  role: string
  author: string
  content: string
  status: ReviewStatus
  revision: number
  valid: boolean
  updatedAt: string
}

export interface BlockScopeItem {
  segmentId: string
  state: ScopeState
  speedLimit: string
  reason: string
}

export interface LockCheckItem {
  id: string
  label: string
  checked: boolean
}

/** 路径草案、风险复核、会签共用的同一份封锁快照 */
export interface Snapshot {
  version: number
  revision: number
  committedRevision: number
  draftScope: BlockScopeItem[]
  committedScope: BlockScopeItem[]
  mileageKm: number
  blockedKm: number
  mileageStale: boolean
  locked: boolean
  lockedAt: string
  checklist: LockCheckItem[]
  updatedAt: string
}

export interface RoutePackage {
  id: string
  cargo: string
  hazardClass: string
  trainCode: string
  origin: string
  destination: string
  tonnage: number
  wagonCount: number
  permit: string
  permission: '有效' | '缺失' | '待补充'
  score: number
  updatedAt: string
  segments: RiskSegment[]
  snapshot: Snapshot
}

/** 后到调度的保存进入冲突待办，先到结果已生效 */
export interface SaveConflict {
  id: string
  routeId: string
  dispatcher: string
  baseRevision: number
  currentRevision: number
  scope: BlockScopeItem[]
  reason: string
  createdAt: string
  status: '待处理' | '已采纳' | '已放弃'
}

export interface AuditEntry {
  id: string
  at: string
  text: string
  source: string
}

export type InspectionStatus = '离线待传' | '同步中' | '已入库' | '写入失败'

/** 断网巡查单：按原单号合并；clientToken 保证写入失败重试沿用首次结果 */
export interface InspectionSheet {
  token: string
  sheetNo: string
  routeId: string
  segmentId: string
  inspector: string
  content: string
  createdAt: string
  status: InspectionStatus
  attempts: number
  merged: boolean
  message: string
}
