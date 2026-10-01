import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Store } from '@ngrx/store'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatSelectModule } from '@angular/material/select'
import { MatTabsModule } from '@angular/material/tabs'
import { MatCheckboxModule } from '@angular/material/checkbox'
import { take } from 'rxjs'
import { PendingBadgeComponent } from '../shared/pending-badge.component'
import { RouteState } from '../store/route.reducer'
import { selectPendingReviewCount } from '../store/route.selectors'
import * as RouteActions from '../store/route.actions'
import type { ReviewKind, ReviewRecord, ReviewStatus, RoutePackage } from '../types'

@Component({
  selector: 'app-approval',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatTabsModule, MatCheckboxModule, PendingBadgeComponent],
  template: `
    <main class="page">
      <div class="page-head"><div><p class="eyebrow">安全 · 运营 · 应急会签</p><h1>逐区段复核与锁定</h1><p>每条复核/会签锚定封锁快照修订号；快照修订后旧意见立即失效，重做前不计入锁定条件。</p></div><div class="head-actions"><app-pending-badge /><button mat-flat-button color="primary" [disabled]="!canLock()" (click)="lockBaseline()">确认并锁定基线</button></div></div>
      <mat-tab-group>
        <mat-tab [label]="'复核与会签（' + (pendingCount$ | async) + ' 待复核）'"><section class="card comment-list">
          @for (review of reviews; track review.id) {
            <div class="comment" [class.invalid]="!review.valid">
              <div class="comment-head">
                <div><b>{{review.kind}} · {{review.role}} · {{review.author}}</b><small>{{review.segmentId}} {{review.segmentName}} · {{review.id}} · 锚定修订 {{review.revision}}</small></div>
                <span [class.risk-high]="!review.valid">{{review.valid ? review.status : '已失效（封锁修订变化）'}}</span>
              </div>
              <p>{{review.content}}</p>
              @if (!review.valid) {
                <div class="redo">
                  <mat-form-field appearance="outline" subscriptSizing="dynamic" class="redo-input"><mat-label>按当前修订 {{currentRevision}} 重做意见</mat-label><input matInput [(ngModel)]="redoContent[review.id]" [placeholder]="review.content" /></mat-form-field>
                  <button mat-flat-button color="primary" (click)="redo(review)">重做并锚定当前修订</button>
                </div>
              } @else {
                <div class="actions"><button mat-stroked-button color="warn" [disabled]="locked" (click)="resolve(review.id,'已退回')">退回补件</button><button mat-flat-button color="primary" [disabled]="locked" (click)="resolve(review.id,'已接受')">接受条件</button></div>
              }
            </div>
          } @empty { <p class="muted">暂无复核意见。</p> }
        </section></mat-tab>
        <mat-tab label="发表区段意见"><section class="card form-card">
          <div class="two">
            <mat-form-field><mat-label>意见类型</mat-label><mat-select [(ngModel)]="kind">@for (k of kinds; track k) { <mat-option [value]="k">{{k}}</mat-option> }</mat-select></mat-form-field>
            <mat-form-field><mat-label>专业角色</mat-label><mat-select [(ngModel)]="role"><mat-option>安全</mat-option><mat-option>运营</mat-option><mat-option>应急</mat-option></mat-select></mat-form-field>
          </div>
          <div class="two"><mat-form-field><mat-label>运输单</mat-label><mat-select [(ngModel)]="routeId" (ngModelChange)="onRouteChange()">@for (route of routes; track route.id) { <mat-option [value]="route.id">{{route.id}} · {{route.trainCode}}</mat-option> }</mat-select></mat-form-field>
          <mat-form-field><mat-label>区段</mat-label><mat-select [(ngModel)]="segmentId"><mat-option *ngFor="let segment of segments" [value]="segment.id">{{segment.id}} · {{segment.name}}</mat-option></mat-select></mat-form-field></div>
          <mat-form-field class="wide"><mat-label>审批条件与依据</mat-label><textarea matInput rows="5" [(ngModel)]="content" placeholder="明确区段、约束、时限与验收证据"></textarea></mat-form-field>
          <p class="muted">提交后锚定当前封锁修订 {{currentRevision}}；范围再变，本意见将立即失效。</p>
          <button mat-flat-button color="primary" [disabled]="!content.trim() || locked" (click)="addReview()">提交意见</button>
        </section></mat-tab>
        <mat-tab label="锁定前逐项确认"><section class="card checklist">
          @if (route; as r) {
            <div class="lock-head"><h2>{{r.id}} · 修订 {{r.snapshot.revision}}</h2><span class="tag" [class.locked]="r.snapshot.locked">{{r.snapshot.locked ? '🔒 已于 ' + r.snapshot.lockedAt + ' 锁定' : '未锁定'}}</span></div>
            <p class="muted">锁定前必须逐项勾选；只要存在失效/未接受复核、未决冲突或待传巡查单，对应项无法满足。</p>
            @for (item of r.snapshot.checklist; track item.id) {
              <div class="check-row">
                <mat-checkbox [checked]="item.checked" [disabled]="r.snapshot.locked || !checkAvailable(item.id)" (change)="toggle(item.id)">{{item.label}}</mat-checkbox>
                @if (!checkAvailable(item.id)) { <small class="risk-high">当前不满足</small> }
              </div>
            }
            <div class="lock-actions">
              <button mat-flat-button color="primary" [disabled]="!canLock()" (click)="lockBaseline()">{{r.snapshot.locked ? '已锁定' : '全部确认，锁定快照'}}</button>
              @if (r.snapshot.locked) { <button mat-stroked-button (click)="unlock()">解锁并重新确认</button> }
            </div>
          }
        </section></mat-tab>
        <mat-tab label="审计时间线"><section class="card timeline">
          @for (entry of audit; track entry.id) {
            <div><i></i><b>{{entry.at}} · {{entry.text}}</b><p>{{entry.source}} · 修改前记录保留</p></div>
          }
        </section></mat-tab>
      </mat-tab-group>
    </main>
  `,
  styles: [`
    h2{margin:0}.head-actions{display:flex;gap:10px;align-items:center}.comment-list{padding:0}.comment{padding:18px;border-bottom:1px solid #e7ebf1}.comment.invalid{background:#fffbeb;border-left:3px solid #d97706}.comment-head{display:flex;justify-content:space-between;gap:10px}.comment-head small{display:block;color:#7a8798;margin-top:4px}.comment-head span{white-space:nowrap}.comment p{color:#475569}.actions{display:flex;gap:10px}.actions button{margin:8px 8px 0 0}
    .redo{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:8px}.redo-input{flex:1;min-width:240px}.muted{color:#7a8798;font-size:12px}
    .form-card{max-width:780px}.two{display:grid;grid-template-columns:1fr 1fr;gap:14px}.two mat-form-field,.wide{width:100%}
    .checklist{max-width:860px}.lock-head{display:flex;justify-content:space-between;align-items:center}.tag{font-size:12px;padding:3px 10px;border-radius:999px;background:#ecfdf5;color:#047857;font-weight:700}.tag.locked{background:#f1f5f9;color:#475569}
    .check-row{display:flex;justify-content:space-between;align-items:center;padding:10px 4px;border-bottom:1px solid #f1f5f9}.check-row small{font-size:12px}.lock-actions{margin-top:16px;display:flex;gap:10px}
    .timeline{padding:8px 18px}.timeline>div{position:relative;padding:14px 10px 14px 28px;border-left:2px solid #cbd5e1}.timeline i{position:absolute;width:9px;height:9px;border-radius:50%;background:#2563eb;left:-5.5px;top:20px}.timeline p{color:#7a8798;margin:5px 0 0}
    @media(max-width:620px){.two{grid-template-columns:1fr}}
  `],
})
export class ApprovalComponent {
  private readonly store = inject(Store<{ routes: RouteState }>)
  readonly state$ = this.store.select('routes')
  readonly pendingCount$ = this.store.select(selectPendingReviewCount)
  readonly kinds: ReviewKind[] = ['风险复核', '会签']
  kind: ReviewKind = '风险复核'
  role = '安全'
  routeId = ''
  segmentId = ''
  content = ''
  redoContent: Record<string, string> = {}
  routes: RoutePackage[] = []
  reviews: ReviewRecord[] = []
  audit: RouteState['audit'] = []

  constructor() {
    this.state$.subscribe((state: RouteState) => {
      this.routes = state.routes
      this.reviews = state.reviews
      this.audit = state.audit
      if (!this.routeId || !state.routes.some((route) => route.id === this.routeId)) {
        this.routeId = state.selectedRouteId || state.routes[0]?.id || ''
        this.onRouteChange()
      }
    })
  }

  get route(): RoutePackage | undefined { return this.routes.find((item) => item.id === this.routeId) }
  get locked() { return !!this.route?.snapshot.locked }
  get currentRevision() { return this.route?.snapshot.revision ?? 0 }
  get segments() { return this.route?.segments ?? [] }

  onRouteChange() { this.segmentId = this.segments[0]?.id ?? '' }

  addReview() {
    if (!this.routeId || !this.segmentId || !this.content.trim()) return
    this.store.dispatch(RouteActions.addReview({ routeId: this.routeId, segmentId: this.segmentId, kind: this.kind, role: this.role, content: this.content.trim() }))
    this.content = ''
  }
  redo(review: ReviewRecord) {
    const content = (this.redoContent[review.id] || '').trim() || review.content
    this.store.dispatch(RouteActions.redoReview({ routeId: review.routeId, reviewId: review.id, content }))
    this.redoContent[review.id] = ''
  }
  resolve(id: string, status: ReviewStatus) { this.store.dispatch(RouteActions.resolveReview({ reviewId: id, status })) }
  toggle(itemId: string) { if (this.routeId) this.store.dispatch(RouteActions.toggleCheckItem({ routeId: this.routeId, itemId })) }

  /** 各检查项的实时满足条件，和共享快照/待复核口径一致 */
  checkAvailable(itemId: string): boolean {
    const route = this.route
    if (!route) return false
    const routeReviews = this.reviews.filter((review) => review.routeId === route.id)
    switch (itemId) {
      case 'C1':
        return route.snapshot.draftScope.length > 0
      case 'C2':
        return !routeReviews.some((review) => !review.valid)
      case 'C3':
        return routeReviews.length > 0 && routeReviews.every((review) => review.valid && review.status === '已接受')
      case 'C4':
        return !route.snapshot.mileageStale && route.snapshot.mileageKm > 0
      case 'C5': {
        let pendingConflicts = 0
        let pendingSheets = 0
        this.state$.pipe(take(1)).subscribe((state: RouteState) => {
          pendingConflicts = state.conflicts.filter((conflict) => conflict.status === '待处理').length
          pendingSheets = state.inspections.filter((sheet) => sheet.status !== '已入库' && sheet.status !== '同步中').length
        })
        return pendingConflicts === 0 && pendingSheets === 0
      }
      default:
        return true
    }
  }
  canLock() {
    const route = this.route
    return !!route && !route.snapshot.locked && route.snapshot.checklist.every((item) => item.checked && this.checkAvailable(item.id))
  }
  lockBaseline() { if (this.routeId && this.canLock()) this.store.dispatch(RouteActions.lockSnapshot({ routeId: this.routeId })) }
  unlock() { if (this.routeId) this.store.dispatch(RouteActions.unlockSnapshot({ routeId: this.routeId })) }
}
