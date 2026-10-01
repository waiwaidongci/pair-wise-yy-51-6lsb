import { Component, OnInit, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { RouterLink } from '@angular/router'
import { Store } from '@ngrx/store'
import { MatTableModule } from '@angular/material/table'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatSelectModule } from '@angular/material/select'
import { MatProgressBarModule } from '@angular/material/progress-bar'
import { MatDividerModule } from '@angular/material/divider'
import { MatChipsModule } from '@angular/material/chips'
import { RouteState } from '../store/route.reducer'
import * as RouteActions from '../store/route.actions'
import {
  selectDraftVersion,
  selectLoading,
  selectNotice,
  selectOnline,
  selectOpenConflictCount,
  selectPendingReviewCount,
  selectPermissionMissingCount,
  selectRoutes,
  selectSelectedRouteId,
  selectSnapshotVersion,
} from '../store/route.selectors'
import type { RoutePackage } from '../types'

@Component({
  selector: 'app-workspace',
  standalone: true,
  imports: [CommonModule, RouterLink, MatTableModule, MatButtonModule, MatFormFieldModule, MatSelectModule, MatProgressBarModule, MatDividerModule, MatChipsModule],
  template: `
    <main class="page">
      <div class="page-head"><div><p class="eyebrow">运输许可与路径编组</p><h1>危险货物运输路径审批</h1><p>核对货物类别、编组、许可与区段约束，生成可比较的候选路径。</p></div><div><button mat-stroked-button (click)="createAlternative()">生成替代方案</button> <button mat-flat-button color="primary" (click)="refresh()">重新校验</button></div></div>

      @if (notice$ | async; as notice) { <div class="notice">{{ notice }}</div> }
      @if ((loading$ | async)) { <mat-progress-bar mode="indeterminate" /> }

      <div class="grid-4">
        <article class="card metric"><span>待审批路径</span><strong>{{ (routes$ | async)?.length || 0 }}</strong><small>今日新增 2 条</small></article>
        <article class="card metric"><span>待复核数（三页一致）</span><strong class="risk-high">{{ pendingReviewCount$ | async }}</strong><small>工作台 · 地图 · 审批同口径</small></article>
        <article class="card metric"><span>许可缺失</span><strong class="risk-mid">{{ permissionMissingCount$ | async }}</strong><small>不得进入审批通过态</small></article>
        <article class="card metric"><span>当前共用快照</span><strong>v{{ snapshotVersion$ | async }}</strong><small>草案 v{{ draftVersion$ | async }} · 复核/会签/里程同锚</small></article>
      </div>

      <section class="card save-bar">
        <div><h2>协同保存（先到生效，后到进冲突待办）</h2><p>两位调度基于同一份草案先后保存：先到结果写入，后到内容不覆盖、自动进入冲突待办。</p></div>
        <div class="save-actions">
          <button mat-stroked-button color="primary" (click)="saveDraft()">保存草案（调度员 · 韩洁）</button>
          <button mat-flat-button color="primary" (click)="saveDraftStale()">模拟另一调度员延迟保存（罗洁 · 旧快照）</button>
          <a mat-stroked-button routerLink="/inspection">冲突待办 @if (openConflictCount$ | async; as n) { @if (n > 0) { <mat-chip highlighted>{{ n }}</mat-chip> } }</a>
          <span class="online" [class.offline]="(online$ | async) === false">{{ (online$ | async) ? '在线' : '断网' }}</span>
        </div>
      </section>

      <div class="grid-2">
        <section class="card table-wrap">
          <div class="toolbar"><mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>货物类别</mat-label><mat-select><mat-option>全部类别</mat-option><mat-option>第 3 类 易燃液体</mat-option><mat-option>第 8 类 腐蚀品</mat-option></mat-select></mat-form-field><mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>审批状态</mat-label><mat-select><mat-option>全部状态</mat-option><mat-option>待安全复核</mat-option><mat-option>待应急复核</mat-option></mat-select></mat-form-field><span class="spacer"></span><button mat-stroked-button>导出审批包</button></div>
          <table mat-table [dataSource]="(routes$ | async) || []">
            <ng-container matColumnDef="id"><th mat-header-cell *matHeaderCellDef>运输单</th><td mat-cell *matCellDef="let row"><b>{{row.id}}</b><small class="block">{{row.updatedAt}}</small></td></ng-container>
            <ng-container matColumnDef="cargo"><th mat-header-cell *matHeaderCellDef>货物 / 车次</th><td mat-cell *matCellDef="let row"><b>{{row.cargo}}</b><small class="block">{{row.hazardClass}} · {{row.trainCode}}</small></td></ng-container>
            <ng-container matColumnDef="route"><th mat-header-cell *matHeaderCellDef>起终点</th><td mat-cell *matCellDef="let row">{{row.origin}} → {{row.destination}}</td></ng-container>
            <ng-container matColumnDef="permission"><th mat-header-cell *matHeaderCellDef>许可</th><td mat-cell *matCellDef="let row"><span [class.risk-high]="row.permission!=='有效'">{{row.permission}}</span></td></ng-container>
            <ng-container matColumnDef="score"><th mat-header-cell *matHeaderCellDef>风险分</th><td mat-cell *matCellDef="let row"><b [class.risk-high]="row.score>=70" [class.risk-mid]="row.score>=45 && row.score<70">{{row.score}}</b> / 100</td></ng-container>
            <ng-container matColumnDef="action"><th mat-header-cell *matHeaderCellDef></th><td mat-cell *matCellDef="let row"><button mat-button color="primary" (click)="select(row)">审核</button></td></ng-container>
            <tr mat-header-row *matHeaderRowDef="columns"></tr><tr mat-row *matRowDef="let row; columns: columns" [class.selected-row]="row.id === (selectedRouteId$ | async)"></tr>
          </table>
        </section>
        <aside class="card">
          <h2>规则引擎结论</h2>
          @for (route of (routes$ | async) || []; track route.id) {
            <div class="rule" [class.active]="route.id === (selectedRouteId$ | async)"><div><b>{{route.trainCode}}</b><span>{{route.segments.length}} 个运行区段</span></div><strong [class.risk-high]="route.score >= 70" [class.risk-mid]="route.score < 70">{{route.score >= 70 ? '高风险' : '需复核' }}</strong></div>
          }
          <mat-divider />
          <h3>强制校验项</h3>
          <p>✓ 罐车编组隔离与押运资质</p><p class="risk-high">! S-203 水源地保护段缺少属地放行函</p><p>✓ 替代路径具备接卸条件</p>
          <button mat-flat-button color="primary" style="width:100%" (click)="createAlternative()">要求补充替代方案</button>
        </aside>
      </div>
    </main>
  `,
  styles: [`
    h2,h3{margin:0 0 12px}.table-wrap{overflow:auto}.block{display:block;color:#7a8798;margin-top:3px}.selected-row{background:#eff6ff}.rule{display:flex;justify-content:space-between;padding:13px 0;border-bottom:1px solid #edf0f5}.rule span{display:block;color:#7a8798;font-size:12px;margin-top:4px}.rule.active{padding-left:10px;border-left:3px solid #2563eb}.rule strong{font-size:12px}.toolbar{margin-bottom:10px}.toolbar mat-form-field{width:160px}
    .notice{background:#eff6ff;border:1px solid #bfdbfe;color:#1e3a8a;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:13px}
    .save-bar{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:16px;flex-wrap:wrap}.save-bar h2{margin:0 0 4px;font-size:16px}.save-bar p{margin:0;color:#667085;font-size:13px}
    .save-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.save-actions a{display:inline-flex;align-items:center;gap:6px}.online{font-size:12px;color:#15803d;font-weight:700}.online.offline{color:#b91c1c}
  `],
})
export class WorkspaceComponent implements OnInit {
  private readonly store = inject(Store<{ routes: RouteState }>)
  readonly routes$ = this.store.select(selectRoutes)
  readonly loading$ = this.store.select(selectLoading)
  readonly notice$ = this.store.select(selectNotice)
  readonly pendingReviewCount$ = this.store.select(selectPendingReviewCount)
  readonly permissionMissingCount$ = this.store.select(selectPermissionMissingCount)
  readonly snapshotVersion$ = this.store.select(selectSnapshotVersion)
  readonly draftVersion$ = this.store.select(selectDraftVersion)
  readonly openConflictCount$ = this.store.select(selectOpenConflictCount)
  readonly online$ = this.store.select(selectOnline)
  readonly selectedRouteId$ = this.store.select(selectSelectedRouteId)
  readonly columns = ['id', 'cargo', 'route', 'permission', 'score', 'action']

  ngOnInit() { this.refresh() }
  refresh() { this.store.dispatch(RouteActions.loadRoutes()) }
  select(row: RoutePackage) { this.store.dispatch(RouteActions.selectRoute({ id: row.id })) }
  createAlternative() { this.store.dispatch(RouteActions.createAlternative()) }
  saveDraft() {
    this.store.select(selectDraftVersion).subscribe((version) => {
      this.store.dispatch(RouteActions.saveDraft({ baseVersion: version, author: '调度员 · 韩洁', summary: '路径草案 v' + version + '：维持 S-203 绕行与限速 45。' }))
    }).unsubscribe()
  }
  saveDraftStale() {
    this.store.select(selectDraftVersion).subscribe((version) => {
      this.store.dispatch(RouteActions.saveDraft({ baseVersion: Math.max(0, version - 1), author: '调度员 · 罗洁', summary: '路径草案（旧快照）：调整 S-207 会签顺序。' }))
    }).unsubscribe()
  }
}
