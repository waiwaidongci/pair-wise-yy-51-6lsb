export type RiskLevel = '高' | '中' | '低'

export interface RiskSegment {
  id: string
  name: string
  from: string
  to: string
  km: string
  speed: string
  risks: string[]
  level: RiskLevel
  status: '待复核' | '已确认' | '需绕行'
  coordinates: [number, number][]
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
}

export interface ReviewComment {
  id: string
  segmentId: string
  role: string
  author: string
  content: string
  status: '待确认' | '已接受' | '已退回'
}

/** 共用快照：复核、会签、里程全部锚定同一个 snapshotVersion */
export interface SnapshotState {
  version: number
  blockedSegmentIds: string[]
  blockageReason: string
}

/** 复核任务（随封锁快照失效重算） */
export interface ReviewTask {
  id: string
  routeId: string
  segmentId: string
  status: '待复核' | '已确认'
  snapshotVersion: number
}

/** 会签记录（随封锁快照失效重算） */
export interface Countersignature {
  id: string
  routeId: string
  segmentId: string
  role: '安全' | '运营' | '应急'
  status: '待会签' | '已会签' | '已退回'
  snapshotVersion: number
}

/** 里程测算（随封锁快照失效重算） */
export interface MileageCalc {
  routeId: string
  km: number
  estimatedMinutes: number
  restrictedCount: number
  snapshotVersion: number
}

/** 冲突待办：后到的保存不覆盖先到结果，进入此队列 */
export interface ConflictTodo {
  id: string
  author: string
  baseSnapshotVersion: number
  currentSnapshotVersion: number
  summary: string
  receivedAt: string
  status: '待处理' | '已保留先到' | '已丢弃'
}

/** 巡查单：断网缓存、联网按原单号合并，写入失败重试沿用首次结果 */
export interface InspectionOrder {
  id: string
  orderNo: string
  routeId: string
  segmentId: string
  content: string
  author: string
  status: '待上传' | '写入失败' | '已上传' | '已合并'
  idempotencyKey: string
  snapshotVersion: number
  createdAt: string
  uploadedAt?: string
  failCount: number
}

/** 锁定前逐项确认项 */
export type LockKey = 'reviews' | 'countersigns' | 'mileages' | 'conflicts' | 'offline'
export interface LockItem {
  key: LockKey
  label: string
  confirmed: boolean
}

/** 保存草案的乐观并发结果 */
export type DraftSaveResult =
  | { ok: true; version: number; savedAt: string }
  | { ok: false; conflict: { baseVersion: number; currentVersion: number; author: string; summary: string; receivedAt: string } }
