import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Store } from '@ngrx/store'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatSelectModule } from '@angular/material/select'
import { MatSlideToggleModule } from '@angular/material/slide-toggle'
import { MatChipsModule } from '@angular/material/chips'
import { MatIconModule } from '@angular/material/icon'
import { MatTableModule } from '@angular/material/table'
import { MatDividerModule } from '@angular/material/divider'
import { RouteState } from '../store/route.reducer'
import * as RouteActions from '../store/route.actions'
import {
  selectConflictTodos,
  selectInspectionOrders,
  selectOnline,
  selectRoutes,
  selectSnapshotVersion,
} from '../store/route.selectors'
import { SnapshotService } from '../services/snapshot.service'
import type { InspectionOrder, RoutePackage } from '../types'
import { idempotencyKey, rid } from '../utils/rail.utils'

@Component({
  selector: 'app-inspection',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatSlideToggleModule, MatChipsModule, MatIconModule, MatTableModule, MatDividerModule],
  template: `
    <main class="page">
      <div class="page-head"><div><p class="eyebrow">断网巡查 · 冲突待办</p><h1>巡查单联网合并与冲突处置</h1><p>断网缓存、联网后按原单号合并；写入失败重试沿用首次结果，不重复、不覆盖。</p></div>
        <div class="head-actions">
          <mat-slide-toggle [checked]="(online$ | async)" (change)="toggleOnline($event.checked)">{{ (online$ | async) ? '在线' : '断网' }}</mat-slide-toggle>
          <mat-slide-toggle [checked]="failNext" (change)="toggleFail($event.checked)">模拟下次写入失败</mat-slide-toggle>
        </div>
      </div>

      <div class="grid-2">
        <section class="card form-card">
          <h2>新建巡查单</h2>
          <div class="two">
            <mat-form-field><mat-label>原单号</mat-label><input matInput [(ngModel)]="orderNo" /></mat-form-field>
            <mat-form-field><mat-label>线路</mat-label><mat-select [(ngModel)]="formRouteId" (ngModelChange)="onRouteChange($event)"><mat-option *ngFor="let route of routes" [value]="route.id">{{ route.id }} · {{ route.trainCode }}</mat-option></mat-select></mat-form-field>
          </div>
          <mat-form-field class="wide"><mat-label>区段</mat-label><mat-select [(ngModel)]="formSegmentId"><mat-option *ngFor="let segment of formSegments" [value]="segment.id">{{ segment.id }} · {{ segment.name }}</mat-option></mat-select></mat-form-field>
          <mat-form-field class="wide"><mat-label>巡查情况与处置建议</mat-label><textarea matInput rows="4" [(ngModel)]="content" placeholder="现场核查情况、限速或加固建议"></textarea></mat-form-field>
          <button mat-flat-button color="primary" [disabled]="!content.trim()" (click)="submit()">
            {{ (online$ | async) ? '上传巡查单' : '缓存巡查单（联网后合并）' }}
          </button>
          <p class="hint">幂等键在断网时生成并全程不变；写入失败后重试仍沿用首次结果。</p>
        </section>

        <section class="card">
          <h2>冲突待办（后到内容不覆盖先到结果）</h2>
          @if ((conflictTodos$ | async)?.length === 0) { <p class="empty">暂无冲突待办。</p> }
          @for (todo of conflictTodos$ | async; track todo.id) {
            <div class="conflict">
              <div class="conflict-head"><b>{{ todo.author }}</b><mat-chip [class.risk-mid]="todo.status==='待处理'" [class.risk-low]="todo.status!=='待处理'">{{ todo.status }}</mat-chip></div>
              <p>{{ todo.summary }}</p>
              <small>基于草案 v{{ todo.baseSnapshotVersion }} → 先到为 v{{ todo.currentSnapshotVersion }} · {{ todo.receivedAt | date:'HH:mm:ss' }}</small>
              @if (todo.status === '待处理') {
                <div class="actions">
                  <button mat-stroked-button color="primary" (click)="resolve(todo.id,'keep-first')">保留先到结果</button>
                  <button mat-stroked-button (click)="resolve(todo.id,'discard')">丢弃后到内容</button>
                </div>
              }
            </div>
          }
        </section>
      </div>

      <section class="card queue-card">
        <h2>巡查单队列</h2>
        <table mat-table [dataSource]="(orders$ | async) || []">
          <ng-container matColumnDef="orderNo"><th mat-header-cell *matHeaderCellDef>原单号</th><td mat-cell *matCellDef="let row"><b>{{ row.orderNo }}</b><small class="block">{{ row.id }}</small></td></ng-container>
          <ng-container matColumnDef="segment"><th mat-header-cell *matHeaderCellDef>区段</th><td mat-cell *matCellDef="let row">{{ row.segmentId }}<small class="block">{{ row.routeId }}</small></td></ng-container>
          <ng-container matColumnDef="content"><th mat-header-cell *matHeaderCellDef>巡查情况</th><td mat-cell *matCellDef="let row">{{ row.content }}<small class="block idem">幂等键 {{ row.idempotencyKey }}</small></td></ng-container>
          <ng-container matColumnDef="status"><th mat-header-cell *matHeaderCellDef>状态</th><td mat-cell *matCellDef="let row"><mat-chip [class.risk-mid]="row.status==='待上传' || row.status==='写入失败'" [class.risk-low]="row.status==='已上传' || row.status==='已合并'">{{ row.status }}@if (row.failCount > 0) { · 重试 {{ row.failCount }} }</mat-chip></td></ng-container>
          <ng-container matColumnDef="action"><th mat-header-cell *matHeaderCellDef></th><td mat-cell *matCellDef="let row">@if (row.status === '写入失败') { <button mat-stroked-button color="primary" (click)="retry(row)">重试（同幂等键）</button> }</td></ng-container>
          <tr mat-header-row *matHeaderRowDef="columns"></tr><tr mat-row *matRowDef="let row; columns: columns"></tr>
        </table>
      </section>
    </main>
  `,
  styles: [`
    h2{margin:0 0 12px;font-size:16px}.block{display:block;color:#7a8798;margin-top:3px}.empty{color:#7a8798}
    .head-actions{display:flex;gap:18px;align-items:center}.form-card .wide{width:100%}.two{display:grid;grid-template-columns:1fr 1fr;gap:14px}.two mat-form-field{width:100%}
    .hint{color:#7a8798;font-size:12px;margin:10px 0 0}.conflict{border:1px solid #e1e7ef;border-left:3px solid #d97706;border-radius:6px;padding:12px;margin-bottom:10px}.conflict-head{display:flex;justify-content:space-between;align-items:center}.conflict p{margin:6px 0}.conflict small{color:#7a8798}.actions{margin-top:8px}.actions button{margin-right:8px}
    .queue-card{margin-top:16px}.idem{font-family:ui-monospace,monospace;font-size:11px;color:#94a3b8}
  `],
})
export class InspectionComponent {
  private readonly store = inject(Store<{ routes: RouteState }>)
  private readonly snapshotService = inject(SnapshotService)
  readonly online$ = this.store.select(selectOnline)
  readonly routes$ = this.store.select(selectRoutes)
  readonly orders$ = this.store.select(selectInspectionOrders)
  readonly conflictTodos$ = this.store.select(selectConflictTodos)
  readonly snapshotVersion$ = this.store.select(selectSnapshotVersion)
  readonly columns = ['orderNo', 'segment', 'content', 'status', 'action']

  routes: RoutePackage[] = []
  formSegments: RoutePackage['segments'] = []
  orderNo = ''
  formRouteId = ''
  formSegmentId = ''
  content = ''
  failNext = false

  constructor() {
    this.routes$.subscribe((routes) => {
      this.routes = routes
      if (!this.formRouteId && routes.length) {
        this.formRouteId = routes[0].id
        this.onRouteChange(this.formRouteId)
      }
      if (!this.orderNo) this.orderNo = `XC-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${String(Math.floor(Math.random() * 90) + 10)}`
    })
  }

  onRouteChange(routeId: string) {
    this.formSegments = this.routes.find((route) => route.id === routeId)?.segments ?? []
    this.formSegmentId = this.formSegments[0]?.id ?? ''
  }

  toggleOnline(checked: boolean) { this.store.dispatch(RouteActions.setOnline({ online: checked })) }
  toggleFail(checked: boolean) { this.failNext = checked; this.snapshotService.setFailNextUpload(checked) }

  submit() {
    const order: InspectionOrder = {
      id: rid('TMP'),
      orderNo: this.orderNo.trim() || `XC-${Date.now().toString().slice(-6)}`,
      routeId: this.formRouteId,
      segmentId: this.formSegmentId,
      content: this.content.trim(),
      author: '外勤巡查 · 当前',
      status: '待上传',
      idempotencyKey: idempotencyKey(),
      snapshotVersion: this.snapshotVersionSnapshot(),
      createdAt: new Date().toISOString(),
      failCount: 0,
    }
    this.store.dispatch(RouteActions.createInspectionOrder({ order }))
    this.content = ''
  }

  private snapshotVersionSnapshot(): number {
    let version = 1
    this.store.select(selectSnapshotVersion).subscribe((value) => { version = value }).unsubscribe()
    return version
  }

  retry(order: InspectionOrder) { this.store.dispatch(RouteActions.retryInspectionOrder({ id: order.id })) }
  resolve(id: string, decision: 'keep-first' | 'discard') { this.store.dispatch(RouteActions.resolveConflict({ id, decision })) }
}
