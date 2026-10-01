/* 行为验证：封锁快照失效重算 / 先后保存冲突 / 逐项锁定 / 巡查单幂等合并 */
import assert from 'node:assert'
import { routeReducer, type RouteState } from '../src/app/store/route.reducer'
import * as A from '../src/app/store/route.actions'
import { buildInitialSnapshot } from '../src/app/store/snapshot.utils'
import { selectPendingReviewCount } from '../src/app/store/route.selectors'
import { InspectionSyncService } from '../src/app/services/inspection-sync.service'
import type { InspectionSheet, RoutePackage } from '../src/app/types'
import { firstValueFrom } from 'rxjs'

const seedRoute = (): RoutePackage => {
  const segments: RoutePackage['segments'] = [
    { id: 'S-1', name: '甲站—乙站', from: '甲', to: '乙', km: '10', speed: '限速 60', risks: [], level: '中', status: '已确认', coordinates: [[100, 30], [100.1, 30]] },
    { id: 'S-2', name: '乙站—丙站', from: '乙', to: '丙', km: '20', speed: '限速 80', risks: ['水源地'], level: '高', status: '需绕行', coordinates: [[100.1, 30], [100.3, 30]] },
  ]
  return {
    id: 'HG-1', cargo: '甲醇', hazardClass: '3', trainCode: 'X1', origin: '甲', destination: '丙',
    tonnage: 100, wagonCount: 5, permit: 'P', permission: '有效', score: 80, updatedAt: '',
    segments, snapshot: buildInitialSnapshot(segments),
  }
}

let conflictSeq = 0
/** 复刻 route.effects 的 saveSnapshot$：baseRevision 一致先到生效，否则进冲突待办 */
function requestSave(s: RouteState, req: ReturnType<typeof A.saveSnapshotRequested>): RouteState {
  const route = s.routes.find((r) => r.id === req.routeId)!
  if (route.snapshot.revision === req.baseRevision) {
    return routeReducer(s, A.saveSnapshotSuccess({ routeId: req.routeId, revision: req.baseRevision, scope: req.scope, dispatcher: req.dispatcher }))
  }
  return routeReducer(s, A.saveSnapshotConflict({
    conflict: {
      id: `CF-${++conflictSeq}`, routeId: req.routeId, dispatcher: req.dispatcher,
      baseRevision: req.baseRevision, currentRevision: route.snapshot.revision,
      scope: req.scope, reason: req.reason, createdAt: '', status: '待处理',
    },
  }))
}

const reset = (): RouteState => {
  const route = seedRoute()
  return {
    routes: [route], selectedRouteId: route.id, selectedSegmentId: 'S-1',
    reviews: [
      { id: 'R1', routeId: route.id, segmentId: 'S-2', segmentName: '乙站—丙站', kind: '会签', role: '安全', author: '韩', content: '限速45', status: '已接受', revision: 1, valid: true, updatedAt: '' },
      { id: 'R2', routeId: route.id, segmentId: 'S-1', segmentName: '甲站—乙站', kind: '风险复核', role: '运营', author: '闻', content: '正常', status: '已接受', revision: 1, valid: true, updatedAt: '' },
    ],
    conflicts: [], inspections: [], online: true, syncFault: false, audit: [], loading: false, error: '', version: 1,
  }
}
const blockS2 = (s: RouteState) =>
  s.routes[0].snapshot.draftScope.map((i) => i.segmentId === 'S-2' ? { ...i, state: '封锁' as const, speedLimit: '25', reason: '甲' } : { ...i })

// 1) 封锁范围一变：修订+1、受影响区段复核立即失效、里程立即重算
{
  let s = reset()
  const before = s.routes[0].snapshot.mileageKm
  s = routeReducer(s, A.changeBlockScope({ routeId: 'HG-1', items: blockS2(s), dispatcher: '调度甲', reason: '施工封锁' }))
  assert.strictEqual(s.routes[0].snapshot.revision, 2)
  assert.strictEqual(s.reviews.find((r) => r.id === 'R1')!.valid, false, '受影响区段 S-2 的会签立即失效')
  assert.strictEqual(s.reviews.find((r) => r.id === 'R1')!.status, '待确认')
  assert.strictEqual(s.reviews.find((r) => r.id === 'R2')!.valid, true, '未涉及区段 S-1 复核保持有效')
  assert.ok(s.routes[0].snapshot.blockedKm > 0, '封锁里程重算为正值')
  assert.strictEqual(s.routes[0].snapshot.mileageStale, false)
  assert.strictEqual(s.routes[0].snapshot.mileageKm, before, '几何总里程不变')
  assert.ok(s.audit.length >= 1)
  console.log('✔ 封锁范围变更：修订号、失效范围、里程重算')
}

// 2) 两个调度先后保存：先到生效，后到进冲突待办不覆盖；可采纳/放弃
{
  let s = reset()
  const first = blockS2(s)
  s = routeReducer(s, A.changeBlockScope({ routeId: 'HG-1', items: first, dispatcher: '调度甲', reason: '甲' }))
  const rev2 = s.routes[0].snapshot.revision
  s = requestSave(s, A.saveSnapshotRequested({ routeId: 'HG-1', dispatcher: '调度甲', baseRevision: rev2, scope: first, reason: '甲' }))
  assert.strictEqual(s.routes[0].snapshot.committedScope.find((i) => i.segmentId === 'S-2')!.state, '封锁')
  assert.strictEqual(s.conflicts.length, 0)

  const late = s.routes[0].snapshot.committedScope.map((i) => i.segmentId === 'S-2' ? { ...i, state: '慢行' as const, speedLimit: '45', reason: '乙晚到' } : { ...i })
  s = requestSave(s, A.saveSnapshotRequested({ routeId: 'HG-1', dispatcher: '调度乙', baseRevision: rev2 - 1, scope: late, reason: '乙晚到' }))
  assert.strictEqual(s.conflicts.length, 1)
  assert.strictEqual(s.conflicts[0].status, '待处理')
  assert.strictEqual(s.routes[0].snapshot.committedScope.find((i) => i.segmentId === 'S-2')!.state, '封锁', '后到不得覆盖先到')

  s = routeReducer(s, A.adoptConflict({ conflictId: s.conflicts[0].id, dispatcher: '调度甲' }))
  assert.strictEqual(s.routes[0].snapshot.committedScope.find((i) => i.segmentId === 'S-2')!.state, '慢行')
  assert.strictEqual(s.routes[0].snapshot.revision, rev2 + 1)
  assert.strictEqual(s.reviews.find((r) => r.id === 'R1')!.valid, false, '采纳冲突内容同样使受影响复核失效')
  console.log('✔ 并发保存：先到生效 / 后到冲突待办 / 采纳合并')

  let s2 = reset()
  const first2 = blockS2(s2)
  s2 = routeReducer(s2, A.changeBlockScope({ routeId: 'HG-1', items: first2, dispatcher: '甲', reason: '' }))
  s2 = requestSave(s2, A.saveSnapshotRequested({ routeId: 'HG-1', dispatcher: '甲', baseRevision: s2.routes[0].snapshot.revision, scope: first2, reason: '' }))
  s2 = requestSave(s2, A.saveSnapshotRequested({ routeId: 'HG-1', dispatcher: '乙', baseRevision: 1, scope: first2 }))
  s2 = routeReducer(s2, A.discardConflict({ conflictId: s2.conflicts[0].id }))
  assert.strictEqual(s2.conflicts[0].status, '已放弃')
  assert.strictEqual(s2.routes[0].snapshot.committedScope.find((i) => i.segmentId === 'S-2')!.state, '封锁')
  console.log('✔ 放弃冲突：先到结果保持生效')
}

// 3) 失效重做 + 锁定前逐项确认
{
  let s = reset()
  s = routeReducer(s, A.changeBlockScope({ routeId: 'HG-1', items: blockS2(s), dispatcher: '甲', reason: '' }))
  assert.strictEqual(selectPendingReviewCount({ routes: s }), 1)

  s = routeReducer(s, A.resolveReview({ reviewId: 'R1', status: '已接受' }))
  assert.strictEqual(s.reviews.find((r) => r.id === 'R1')!.status, '待确认', '失效条目不可接受')
  s = routeReducer(s, A.redoReview({ routeId: 'HG-1', reviewId: 'R1', content: '重做意见' }))
  assert.strictEqual(s.reviews.find((r) => r.id === 'R1')!.revision, 2)
  s = routeReducer(s, A.resolveReview({ reviewId: 'R1', status: '已接受' }))
  assert.strictEqual(s.reviews.find((r) => r.id === 'R1')!.status, '已接受')
  assert.strictEqual(selectPendingReviewCount({ routes: s }), 0)

  s = routeReducer(s, A.lockSnapshot({ routeId: 'HG-1' }))
  assert.strictEqual(s.routes[0].snapshot.locked, false, '检查项未全勾选不得锁定')
  for (const item of s.routes[0].snapshot.checklist) s = routeReducer(s, A.toggleCheckItem({ routeId: 'HG-1', itemId: item.id }))
  s = routeReducer(s, A.lockSnapshot({ routeId: 'HG-1' }))
  assert.strictEqual(s.routes[0].snapshot.locked, true, '逐项确认后锁定')
  const rev = s.routes[0].snapshot.revision
  s = routeReducer(s, A.changeBlockScope({ routeId: 'HG-1', items: blockS2(s).map((i) => ({ ...i, speedLimit: '15' })), dispatcher: 'x', reason: 'y' }))
  assert.strictEqual(s.routes[0].snapshot.revision, rev, '锁定后快照只读')
  console.log('✔ 失效重做、统一待复核口径、逐项确认后锁定且只读')
}

// 4) 离线巡查单：原单号合并 + token 幂等（失败重试沿用首次结果）
{
  const svc = new InspectionSyncService()
  const mk = (token: string, content: string): InspectionSheet => ({
    token, sheetNo: 'XC-1', routeId: 'HG-1', segmentId: 'S-2', inspector: '赵', content,
    createdAt: '10:00', status: '离线待传', attempts: 0, merged: false, message: '',
  })
  const r1 = await firstValueFrom(svc.submit(mk('TK-1', '首次内容'), false))
  assert.strictEqual(r1.merged, false)
  const r2 = await firstValueFrom(svc.submit(mk('TK-2', '联网后补传'), false))
  assert.strictEqual(r2.merged, true, '同单号补传按原单号合并')

  await assert.rejects(firstValueFrom(svc.submit(mk('TK-3', '故障期内容'), true)), /未受理/)
  const r3 = await firstValueFrom(svc.submit(mk('TK-3', '故障期内容'), false))
  assert.ok(r3.merged, '同 token 重试成功，并入 XC-1 既有记录')
  const r3again = await firstValueFrom(svc.submit(mk('TK-3', '被篡改的重试'), true))
  assert.strictEqual(r3again.message, r3.message, '已受理 token 再次重试沿用首次结果')
  assert.strictEqual(r3again.merged, r3.merged)
  console.log('✔ 离线巡查单：原单号合并 / 写入失败重试幂等')
}

console.log('\nALL TESTS PASSED')
