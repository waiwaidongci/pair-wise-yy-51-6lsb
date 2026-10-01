import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router'
import { MatToolbarModule } from '@angular/material/toolbar'
import { MatButtonModule } from '@angular/material/button'
import { MatChipsModule } from '@angular/material/chips'
import { Store } from '@ngrx/store'
import { take } from 'rxjs'
import { PendingBadgeComponent } from './shared/pending-badge.component'
import * as RouteActions from './store/route.actions'
import type { RouteState } from './store/route.reducer'

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, CommonModule, MatToolbarModule, MatButtonModule, MatChipsModule, PendingBadgeComponent],
  template: `
    <mat-toolbar class="topbar">
      <div class="brand"><span>铁</span><div><b>危险货物运输审批台</b><small>RAIL HAZMAT CONTROL</small></div></div>
      <nav><a mat-button routerLink="/workspace" routerLinkActive="active">封锁与路径</a><a mat-button routerLink="/risk-map" routerLinkActive="active">风险地图</a><a mat-button routerLink="/approval" routerLinkActive="active">多角色审批</a></nav>
      <span class="spacer"></span>
      <app-pending-badge />
      <button mat-stroked-button class="net" [class.offline]="(state$ | async)?.online === false" (click)="toggleOnline()">
        {{ (state$ | async)?.online ? '🟢 调度网在线' : '🔴 已断网（巡查单暂存）' }}
      </button>
      <mat-chip highlighted>协同在线 8</mat-chip>
    </mat-toolbar>
    <router-outlet />
  `,
  styles: [`
    .topbar{height:68px;background:#0f172a;color:#fff;padding:0 22px;position:sticky;top:0;z-index:700;gap:10px}
    .brand{display:flex;align-items:center;gap:11px;min-width:260px}.brand>span{width:36px;height:36px;border-radius:7px;background:#2563eb;display:grid;place-items:center;font-weight:800}.brand b,.brand small{display:block}.brand small{font-size:9px;color:#94a3b8;letter-spacing:1px;margin-top:2px}
    nav{display:flex;gap:4px}nav a{color:#cbd5e1}nav a.active{background:#1e293b;color:#fff}
    .net{color:#fff;border-color:#334155;background:#111c30;font-size:12px}.net.offline{border-color:#dc2626;color:#fecaca}
    @media(max-width:1020px){.topbar{height:auto;min-height:64px;padding:10px;flex-wrap:wrap}.brand{min-width:210px}nav{order:3;width:100%}.brand small,.topbar mat-chip{display:none}}
  `],
})
export class AppComponent {
  private readonly store = inject(Store<{ routes: RouteState }>)
  readonly state$ = this.store.select('routes')
  toggleOnline() {
    this.state$.pipe(take(1)).subscribe((state) =>
      this.store.dispatch(RouteActions.setOnline({ online: !state.online })),
    )
  }
}
