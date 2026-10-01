import { Component, inject } from '@angular/core'
import { AsyncPipe } from '@angular/common'
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router'
import { Store } from '@ngrx/store'
import { MatToolbarModule } from '@angular/material/toolbar'
import { MatButtonModule } from '@angular/material/button'
import { MatChipsModule } from '@angular/material/chips'
import { RouteState } from './store/route.reducer'
import { selectOnline, selectOpenConflictCount, selectPendingOfflineCount, selectPendingReviewCount, selectSnapshotVersion } from './store/route.selectors'

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [AsyncPipe, RouterOutlet, RouterLink, RouterLinkActive, MatToolbarModule, MatButtonModule, MatChipsModule],
  template: `
    <mat-toolbar class="topbar">
      <div class="brand"><span>铁</span><div><b>危险货物运输审批台</b><small>RAIL HAZMAT CONTROL</small></div></div>
      <nav><a mat-button routerLink="/workspace" routerLinkActive="active">路径编组</a><a mat-button routerLink="/risk-map" routerLinkActive="active">风险地图</a><a mat-button routerLink="/approval" routerLinkActive="active">多角色审批</a><a mat-button routerLink="/inspection" routerLinkActive="active">巡查与冲突 @if ((openConflictCount$ | async) || 0; as n) { @if (n > 0) { <span class="badge">{{ n }}</span> } }</a></nav>
      <span class="spacer"></span>
      <mat-chip [class.offline]="(online$ | async) === false">{{ (online$ | async) ? '在线' : '断网' }} · 快照 v{{ snapshotVersion$ | async }}</mat-chip>
      <mat-chip highlighted>待复核 {{ pendingReviewCount$ | async }} · 待传 {{ pendingOfflineCount$ | async }}</mat-chip>
      <button mat-flat-button color="primary">提交审批</button>
    </mat-toolbar>
    <router-outlet />
  `,
  styles: [`
    .topbar{height:68px;background:#0f172a;color:#fff;padding:0 22px;position:sticky;top:0;z-index:700}
    .brand{display:flex;align-items:center;gap:11px;min-width:260px}.brand>span{width:36px;height:36px;border-radius:7px;background:#2563eb;display:grid;place-items:center;font-weight:800}.brand b,.brand small{display:block}.brand small{font-size:9px;color:#94a3b8;letter-spacing:1px;margin-top:2px}
    nav{display:flex;gap:4px}nav a{color:#cbd5e1}nav a.active{background:#1e293b;color:#fff}
    .badge{display:inline-grid;place-items:center;min-width:18px;height:18px;padding:0 5px;margin-left:4px;border-radius:9px;background:#dc2626;color:#fff;font-size:11px;font-weight:700}
    mat-chip.offline{background:#7f1d1d;color:#fff}
    @media(max-width:900px){.topbar{height:auto;min-height:64px;padding:10px;flex-wrap:wrap}.brand{min-width:210px}nav{order:3;width:100%}.brand small,.topbar mat-chip{display:none}}
  `],
})
export class AppComponent {
  private readonly store = inject(Store<{ routes: RouteState }>)
  readonly online$ = this.store.select(selectOnline)
  readonly snapshotVersion$ = this.store.select(selectSnapshotVersion)
  readonly pendingReviewCount$ = this.store.select(selectPendingReviewCount)
  readonly pendingOfflineCount$ = this.store.select(selectPendingOfflineCount)
  readonly openConflictCount$ = this.store.select(selectOpenConflictCount)
}
