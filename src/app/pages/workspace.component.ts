import { Component, OnInit, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Store } from '@ngrx/store'
import { MatTableModule } from '@angular/material/table'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatSelectModule } from '@angular/material/select'
import { MatProgressBarModule } from '@angular/material/progress-bar'
import { MatDividerModule } from '@angular/material/divider'
import { MatSlideToggleModule } from '@angular/material/slide-toggle'
import { take } from 'rxjs'
import { PendingBadgeComponent } from '../shared/pending-badge.component'
import { RouteState } from '../store/route.reducer'
import { selectPendingConflictCount, selectPendingInspectionCount, selectPendingReviewCount } from '../store/route.selectors'
import * as RouteActions from '../store/route.actions'
import type { BlockScopeItem, InspectionSheet, RoutePackage, ScopeState } from '../types'
import { nextId, now } from '../store/snapshot.utils'

@Component({
  selector: 'app-workspace',
  standalone: true,
  imports: [CommonModule, FormsModule, MatTableModule, MatButtonModule, MatFormFieldModule, MatSelectModule, MatProgressBarModule, MatDividerModule, MatSlideToggleModule, PendingBadgeComponent],
  template: `
    <main class="page">
      <div class="page-head">
        <div><p class="eyebrow">线路封锁 · 共享快照</p><h1>封锁范围与路径编组</h1><p>路径草案、风险复核、会签与里程共用一份封锁快照；范围一变，关联结果立即失效重算。</p></div>
        <div class="head-actions"><app-pending-badge /><button mat-flat-button color="primary" (click)="refresh()">重新校验</button></div>
      </div>
      <div class="grid-4">
        <article class="card metric"><span>待审批路径</span><strong>{{ (state$ | async)?.routes?.length || 0 }}</strong><small>今日新增 2 条</small></article>
        <article class="card metric"><span>待复核项（统一口径）</span><strong class="risk-high">{{ pendingCount$ | async }}</strong><small>失效会签与未接受意见</small></article>
        <article class="card metric"><span>冲突待办</span><strong [class.risk-mid]="(conflictCount$ | async)! > 0">{{ conflictCount$ | async }}</strong><small>后到保存等待调度裁决</small></article>
        <article class="card metric"><span>待传 / 失败巡查单</span><strong [class.risk-mid]="(inspectPending$ | async)! > 0">{{ inspectPending$ | async }}</strong><small>联网后按原单号合并</small></article>
      </div>
      @if ((state$ | async)?.loading) { <mat-progress-bar mode="indeterminate" /> }
      <div class="grid-2">
        <section class="card table-wrap">
          <table mat-table [dataSource]="(state$ | async)?.routes || []">
            <ng-container matColumnDef="id"><th mat-header-cell *matHeaderCellDef>运输单</th><td mat-cell *matCellDef="let row"><b>{{row.id}}</b><small class="block">{{row.updatedAt}}</small></td></ng-container>
            <ng-container matColumnDef="cargo"><th mat-header-cell *matHeaderCellDef>货物 / 车次</th><td mat-cell *matCellDef="let row"><b>{{row.cargo}}</b><small class="block">{{row.hazardClass}} · {{row.trainCode}}</small></td></ng-container>
            <ng-container matColumnDef="route"><th mat-header-cell *matHeaderCellDef>起终点</th><td mat-cell *matCellDef="let row">{{row.origin}} → {{row.destination}}</td></ng-container>
            <ng-container matColumnDef="rev"><th mat-header-cell *matHeaderCellDef>快照修订</th><td mat-cell *matCellDef="let row">v{{row.snapshot.version}} / 修订 {{row.snapshot.revision}} @if (row.snapshot.locked) { <span class="lock">已锁定</span> }</td></ng-container>
            <ng-container matColumnDef="score"><th mat-header-cell *matHeaderCellDef>风险分</th><td mat-cell *matCellDef="let row"><b [class.risk-high]="row.score>=70" [class.risk-mid]="row.score>=45 && row.score<70">{{row.score}}</b> / 100</td></ng-container>
            <ng-container matColumnDef="action"><th mat-header-cell *matHeaderCellDef></th><td mat-cell *matCellDef="let row"><button mat-button color="primary" (click)="select(row)">编辑封锁</button></td></ng-container>
            <tr mat-header-row *matHeaderRowDef="columns"></tr><tr mat-row *matRowDef="let row; columns: columns" [class.selected-row]="row.id === selectedId"></tr>
          </table>

          @if (selectedRoute; as route) {
            <mat-divider />
            <div class="snapshot-panel">
              <div class="snap-head">
                <div><h2>封锁快照 · {{route.id}} / {{route.trainCode}}</h2><small>草案修订 {{route.snapshot.revision}} · 已生效修订 {{route.snapshot.committedRevision}} · 更新于 {{route.snapshot.updatedAt}}</small></div>
                <span class="tag" [class.locked]="route.snapshot.locked">{{route.snapshot.locked ? '🔒 快照只读' : '可编辑'}}</span>
              </div>
              <table class="scope-table">
                <thead><tr><th>区段</th><th>封锁状态</th><th>限速 km/h</th><th>命令 / 事由</th></tr></thead>
                <tbody>
                  @for (item of draftScope; track item.segmentId) {
                    <tr [class.changed]="isChanged(route, item)">
                      <td><b>{{segmentName(route, item.segmentId)}}</b><small class="block">{{item.segmentId}}</small></td>
                      <td>
                        <mat-form-field appearance="outline" subscriptSizing="dynamic">
                          <mat-select [(ngModel)]="item.state" [disabled]="route.snapshot.locked" (ngModelChange)="applyScope()">
                            @for (s of scopeStates; track s) { <mat-option [value]="s">{{s}}</mat-option> }
                          </mat-select>
                        </mat-form-field>
                      </td>
                      <td>
                        <mat-form-field appearance="outline" subscriptSizing="dynamic">
                          <mat-select [(ngModel)]="item.speedLimit" [disabled]="route.snapshot.locked" (ngModelChange)="applyScope()">
                            @for (v of speedOptions; track v) { <mat-option [value]="v">{{v}}</mat-option> }
                          </mat-select>
                        </mat-form-field>
                      </td>
                      <td><input class="reason" [(ngModel)]="item.reason" [disabled]="route.snapshot.locked" (ngModelChange)="applyScope()" placeholder="封锁命令号 / 事由" /></td>
                    </tr>
                  }
                </tbody>
              </table>
              <div class="snapshot-metrics">
                <span>实测里程 <b>{{route.snapshot.mileageKm}} km</b></span>
                <span>封锁 / 慢行折算 <b class="risk-mid">{{route.snapshot.blockedKm}} km</b></span>
                <span>里程状态：{{route.snapshot.mileageStale ? '重算中…' : '已按新范围重算'}}</span>
              </div>
              <div class="save-bar">
                <button mat-flat-button color="primary" [disabled]="route.snapshot.locked" (click)="save('调度甲（本班）')">调度甲保存（基于修订 {{route.snapshot.revision}}）</button>                <button mat-stroked-button [disabled]="route.snapshot.locked" (click)="simulateLateSave()">模拟调度乙晚到保存（基于旧修订）</button>
                <small>先到结果立即生效；后到内容不覆盖，进入右侧冲突待办。</small>
              </div>
            </div>
          }
        </section>

        <aside class="side">
          <section class="card">
            <h2>冲突待办（{{conflictCount$ | async}}）</h2>
            @if (conflicts.length === 0) { <p class="muted">暂无并发保存冲突。</p> }
            @for (conflict of conflicts; track conflict.id) {
              <div class="conflict" [class.done]="conflict.status !== '待处理'">
                <div class="conflict-head"><b>{{conflict.dispatcher}}</b><span>{{conflict.status}}</span></div>
                <p>基于修订 {{conflict.baseRevision}} 保存，当前已生效修订 {{conflict.currentRevision}}。后到内容：</p>
                <ul>
                  @for (item of conflict.scope; track item.segmentId) {
                    <li [class.diff]="differsFromCurrent(item)">{{item.segmentId}} · {{item.state}} · {{item.speedLimit}} km/h <em>{{item.reason}}</em></li>
                  }
                </ul>
                @if (conflict.status === '待处理') {
                  <div class="actions">
                    <button mat-flat-button color="primary" (click)="adopt(conflict.id)">采纳合并（修订再 +1，关联复核失效）</button>
                    <button mat-stroked-button (click)="discard(conflict.id)">放弃（保留先到结果）</button>
                  </div>
                }
              </div>
            }
          </section>

          <section class="card">
            <div class="inspect-head"><h2>离线巡查单</h2><mat-slide-toggle [checked]="(state$ | async)?.syncFault ?? false" (change)="toggleFault($event.checked)" labelPosition="before">模拟联网写入失败</mat-slide-toggle></div>
            <p class="muted">断网期间填写的巡查单暂存本机；联网后按原单号合并，写入失败重试仍沿用首次结果（token 幂等）。</p>
            <div class="inspect-form">
              <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>巡查单号</mat-label><input matInput [(ngModel)]="draftSheet.sheetNo" /></mat-form-field>
              <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>巡查人</mat-label><input matInput [(ngModel)]="draftSheet.inspector" /></mat-form-field>
              <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>区段</mat-label>
                <mat-select [(ngModel)]="draftSheet.segmentId">
                  @for (segment of allSegments; track segment.id) { <mat-option [value]="segment.id">{{segment.id}} · {{segment.name}}</mat-option> }
                </mat-select>
              </mat-form-field>
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="wide"><mat-label>巡查内容</mat-label><textarea matInput rows="2" [(ngModel)]="draftSheet.content"></textarea></mat-form-field>
              <div class="actions">
                <button mat-flat-button color="primary" [disabled]="!canQueue()" (click)="queueSheet()">{{ online ? '填写并上送' : '断网暂存' }}</button>
                <button mat-stroked-button [disabled]="pendingSync === 0" (click)="syncNow()">{{ online ? '立即同步待传单' : '联网并同步' }}</button>
              </div>
            </div>
            @for (sheet of inspections; track sheet.token) {
              <div class="sheet" [class]="'st-' + sheet.statusKey">
                <div class="conflict-head"><b>{{sheet.sheetNo}}</b><span>{{sheet.status}}</span></div>
                <p>{{sheet.segmentId}} · {{sheet.inspector}} · {{sheet.content}}</p>
                <small>token {{sheet.token.slice(-6)}} · 尝试 {{sheet.attempts}} 次 · 同单号已上送 {{mergeCount(sheet.sheetNo)}} 次 · {{sheet.message || '等待联网'}}</small>
                @if (sheet.statusKey === 'failed') { <button mat-stroked-button color="primary" (click)="retry(sheet.token)">重试（同 token）</button> }
              </div>
            }
          </section>
        </aside>
      </div>
    </main>
  `,
  styles: [`
    h2,h3{margin:0 0 10px;font-size:16px}.head-actions{display:flex;gap:10px;align-items:center}
    .table-wrap{overflow:auto}.block{display:block;color:#7a8798;margin-top:3px}.selected-row{background:#eff6ff}
    .lock{color:#15803d;font-size:12px;margin-left:6px;font-weight:700}
    .snapshot-panel{padding:16px 4px 4px}.snap-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px}
    .snap-head small{color:#7a8798}.tag{font-size:12px;padding:3px 10px;border-radius:999px;background:#ecfdf5;color:#047857;font-weight:700}.tag.locked{background:#f1f5f9;color:#475569}
    .scope-table{width:100%;border-collapse:collapse}.scope-table th{text-align:left;color:#667085;font-size:12px;padding:6px 8px;border-bottom:1px solid #e1e7ef}
    .scope-table td{padding:6px 8px;border-bottom:1px solid #f1f5f9;vertical-align:top}.scope-table tr.changed{background:#fffbeb}
    .scope-table mat-form-field{width:110px}.reason{width:100%;border:1px solid #cbd5e1;border-radius:5px;padding:9px}
    .snapshot-metrics{display:flex;gap:22px;padding:10px 8px;color:#475569;font-size:13px}.snapshot-metrics b{font-size:15px;color:#0f172a;margin-left:4px}
    .save-bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px}.save-bar small{color:#7a8798}
    .side{display:flex;flex-direction:column;gap:16px}.muted{color:#7a8798;font-size:12px;margin:6px 0}
    .conflict,.sheet{border:1px solid #e1e7ef;border-left:3px solid #d97706;border-radius:6px;padding:12px;margin:10px 0;background:#fffdf7}
    .conflict.done{opacity:.55;border-left-color:#94a3b8}.conflict-head{display:flex;justify-content:space-between;align-items:center}.conflict-head span{font-size:12px;color:#b45309;font-weight:700}
    .conflict ul{margin:6px 0;padding-left:18px;font-size:13px}.conflict li em{color:#7a8798;font-style:normal}.conflict li.diff{color:#b91c1c;font-weight:600}
    .actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}
    .inspect-head{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px}
    .inspect-form{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:8px 0}.inspect-form .wide{grid-column:1/-1}.inspect-form mat-form-field{width:100%}
    .sheet{border-left-color:#2563eb;background:#f8fafc}.sheet.st-failed{border-left-color:#dc2626;background:#fef2f2}.sheet.st-synced{border-left-color:#15803d;background:#f0fdf4}.sheet small{color:#7a8798}.sheet p{margin:5px 0;font-size:13px}
  `],
})
export class WorkspaceComponent implements OnInit {
  private readonly store = inject(Store<{ routes: RouteState }>)
  readonly state$ = this.store.select('routes')
  readonly columns = ['id', 'cargo', 'route', 'rev', 'score', 'action']
  readonly scopeStates: ScopeState[] = ['封锁', '慢行', '开通']
  readonly speedOptions = ['15', '25', '45', '60', '80', '120']

  selectedId = ''
  draftScope: BlockScopeItem[] = []
  private baseRevision = 1
  private draftRouteId = ''
  conflicts: RouteState['conflicts'] = []
  inspections: Array<InspectionSheet & { statusKey: string }> = []
  online = true
  pendingSync = 0
  allSegments: RoutePackage['segments'] = []
  draftSheet = { sheetNo: 'XC-1007', inspector: '巡查员 赵启', segmentId: 'S-203', content: 'K1312+400 接触网支柱侵限已处置，限界复测合格。' }

  readonly pendingCount$ = this.store.select(selectPendingReviewCount)
  readonly conflictCount$ = this.store.select(selectPendingConflictCount)
  readonly inspectPending$ = this.store.select(selectPendingInspectionCount)

  get selectedRoute(): RoutePackage | undefined {
    let route: RoutePackage | undefined
    this.state$.pipe(take(1)).subscribe((state: RouteState) => { route = state.routes.find((r) => r.id === state.selectedRouteId) })
    return route
  }

  constructor() {
    this.state$.subscribe((state: RouteState) => {
      this.selectedId = state.selectedRouteId
      this.conflicts = state.conflicts
      this.online = state.online
      this.pendingSync = state.inspections.filter((sheet) => sheet.status === '离线待传' || sheet.status === '写入失败').length
      this.inspections = state.inspections.map((sheet) => ({ ...sheet, statusKey: this.statusKey(sheet.status) }))
      this.allSegments = state.routes.flatMap((route) => route.segments)
      const route = state.routes.find((r) => r.id === state.selectedRouteId)
      if (route && (route.id !== this.draftRouteId || route.snapshot.revision !== this.baseRevision)) {
        this.draftRouteId = route.id
        this.baseRevision = route.snapshot.revision
        this.draftScope = route.snapshot.draftScope.map((item) => ({ ...item }))
      }
      if (!this.draftSheet.segmentId && this.allSegments[0]) this.draftSheet.segmentId = this.allSegments[0].id
    })
  }

  ngOnInit() { this.refresh() }
  refresh() { this.store.dispatch(RouteActions.loadRoutes()) }
  select(row: RoutePackage) { this.store.dispatch(RouteActions.selectRoute({ id: row.id })) }

  segmentName(route: RoutePackage, segmentId: string) {
    return route.segments.find((segment) => segment.id === segmentId)?.name ?? segmentId
  }
  isChanged(route: RoutePackage, item: BlockScopeItem) {
    const committed = route.snapshot.committedScope.find((scope) => scope.segmentId === item.segmentId)
    return committed ? committed.state !== item.state || committed.speedLimit !== item.speedLimit : false
  }

  /** 封锁范围一变：立即派发，关联复核/会签失效、里程在 reducer 内同步重算 */
  applyScope() {
    const route = this.selectedRoute
    if (!route || route.snapshot.locked) return
    this.store.dispatch(RouteActions.changeBlockScope({
      routeId: route.id,
      items: this.draftScope.map((item) => ({ ...item })),
      dispatcher: '调度甲（本班）',
      reason: '工作台直接调整封锁范围',
    }))
  }

  save(dispatcher: string) {
    const route = this.selectedRoute
    if (!route) return
    this.store.dispatch(RouteActions.saveSnapshotRequested({
      routeId: route.id,
      dispatcher,
      baseRevision: route.snapshot.revision,
      scope: route.snapshot.draftScope.map((item) => ({ ...item })),
      reason: '正常保存',
    }))
  }

  /** 模拟另一调度基于旧修订号的晚到保存：先让本班范围产生修订2，再以邻台身份提交修订1的旧内容 */
  simulateLateSave() {
    const route = this.selectedRoute
    if (!route) return
    // 邻台手上的旧范围（修订 1）：S-203 主张慢行
    const staleScope = route.snapshot.draftScope.map((item) =>
      item.segmentId === 'S-203' ? { ...item, state: '慢行' as ScopeState, speedLimit: '25', reason: '调度乙：改为慢行不放行封锁' } : { ...item },
    )
    // 当前修订为 1 时，先让本班的一个不同调整生效（修订 2），保证邻台必然晚到
    if (route.snapshot.revision <= 1) {
      this.store.dispatch(RouteActions.changeBlockScope({
        routeId: route.id,
        items: route.snapshot.draftScope.map((item) =>
          item.segmentId === 'S-207' ? { ...item, reason: '调度命令 4711：桥梁群追加监护' } : { ...item }),
        dispatcher: '调度甲（本班）',
        reason: '本班先于邻台完成修订',
      }))
    }
    this.store.dispatch(RouteActions.saveSnapshotRequested({
      routeId: route.id,
      dispatcher: '调度乙（邻台）',
      baseRevision: 1,
      scope: staleScope,
      reason: '邻台基于修订 1 的晚到保存',
    }))
  }

  adopt(conflictId: string) { this.store.dispatch(RouteActions.adoptConflict({ conflictId, dispatcher: '调度甲（本班）' })) }
  discard(conflictId: string) { this.store.dispatch(RouteActions.discardConflict({ conflictId })) }
  differsFromCurrent(item: BlockScopeItem) {
    const route = this.selectedRoute
    if (!route) return false
    const current = route.snapshot.committedScope.find((scope) => scope.segmentId === item.segmentId)
    return current ? current.state !== item.state || current.speedLimit !== item.speedLimit : true
  }

  canQueue() { return this.draftSheet.sheetNo.trim() && this.draftSheet.inspector.trim() && this.draftSheet.content.trim() }
  queueSheet() {
    const route = this.selectedRoute
    const sheet: InspectionSheet = {
      token: nextId('TK'),
      sheetNo: this.draftSheet.sheetNo.trim(),
      routeId: route?.id ?? this.stateValue.routes[0]?.id ?? '',
      segmentId: this.draftSheet.segmentId,
      inspector: this.draftSheet.inspector.trim(),
      content: this.draftSheet.content.trim(),
      createdAt: now(),
      status: '离线待传',
      attempts: 0,
      merged: false,
      message: this.online ? '等待上送' : '断网暂存本机',
    }
    this.store.dispatch(RouteActions.queueInspection({ sheet }))
    this.draftSheet = { ...this.draftSheet, content: '' }
    if (this.online) this.store.dispatch(RouteActions.syncInspectionsRequested())
  }
  syncNow() {
    if (!this.online) this.store.dispatch(RouteActions.setOnline({ online: true }))
    else this.store.dispatch(RouteActions.syncInspectionsRequested())
  }
  retry(token: string) {
    this.store.dispatch(RouteActions.inspectStatusChanged({ token, status: '离线待传', message: '准备用同一 token 重试' }))
    this.store.dispatch(RouteActions.syncInspectionsRequested())
  }
  toggleFault(fault: boolean) { this.store.dispatch(RouteActions.setSyncFault({ fault })) }

  /** 同单号已成功上送（不同 token）的次数：>=2 即发生过断网补传合并 */
  mergeCount(sheetNo: string) {
    return this.inspections.filter((sheet) => sheet.sheetNo === sheetNo && sheet.status === '已入库').length
  }

  private statusKey(status: InspectionSheet['status']) {
    if (status === '已入库') return 'synced'
    if (status === '写入失败') return 'failed'
    if (status === '同步中') return 'syncing'
    return 'pending'
  }
  private get stateValue(): RouteState {
    let value!: RouteState
    this.state$.pipe(take(1)).subscribe((state) => { value = state })
    return value
  }
}
