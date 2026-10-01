import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Store } from '@ngrx/store'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatSelectModule } from '@angular/material/select'
import { MatTabsModule } from '@angular/material/tabs'
import { MatChipsModule } from '@angular/material/chips'
import { MatIconModule } from '@angular/material/icon'
import { MatDividerModule } from '@angular/material/divider'
import { RouteState } from '../store/route.reducer'
import * as RouteActions from '../store/route.actions'
import {
  selectAllLockConfirmed,
  selectComments,
  selectCountersigns,
  selectLocked,
  selectLockedAt,
  selectLockRows,
  selectNotice,
  selectPendingReviewCount,
  selectReviews,
  selectSnapshotVersion,
} from '../store/route.selectors'
import type { Countersignature, LockItem, RoutePackage } from '../types'

@Component({
  selector: 'app-approval',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatTabsModule, MatChipsModule, MatIconModule, MatDividerModule],
  template: `
    <main class="page">
      <div class="page-head">
        <div><p class="eyebrow">安全 · 运营 · 应急会签</p><h1>逐区段审批与退回</h1><p>每条意见锚定运输区段，原记录不可覆盖，所有确认写入审计时间线。</p></div>
        <div class="head-actions">
          <mat-chip highlighted>待复核 {{ pendingReviewCount$ | async }}（三页一致）</mat-chip>
          @if (locked$ | async) { <mat-chip class="locked-chip">基线已锁定 · {{ lockedAt$ | async }}</mat-chip> }
          <button mat-flat-button color="primary" [disabled]="(allConfirmed$ | async) === false || (locked$ | async)" (click)="lockBaseline()">确认并锁定基线</button>
        </div>
      </div>

      @if (notice$ | async; as notice) { <div class="notice">{{ notice }}</div> }

      <section class="card lock-card">
        <div class="lock-head"><h2>锁定前逐项确认</h2><small>全部条件满足并逐项确认后才可锁定；快照一旦变更，确认自动失效需重来。</small></div>
        <div class="lock-rows">
          @for (row of lockRows$ | async; track row.key) {
            <div class="lock-row" [class.confirmed]="row.confirmed">
              <mat-icon>{{ row.confirmed ? 'check_circle' : 'radio_button_unchecked' }}</mat-icon>
              <span class="lock-label">{{ row.label }}</span>
              <span class="lock-met" [class.met]="row.met">{{ row.met ? '条件满足' : '未满足' }}</span>
              <button mat-stroked-button [disabled]="!row.met || row.confirmed || (locked$ | async)" (click)="confirm(row.key)">确认此项</button>
            </div>
          }
        </div>
      </section>

      <mat-tab-group>
        <mat-tab label="待处理意见"><section class="card comment-list">
          @for (comment of (comments$ | async) || []; track comment.id) {
            <div class="comment"><div class="comment-head"><div><b>{{comment.role}} · {{comment.author}}</b><small>{{comment.segmentId}} · {{comment.id}}</small></div><span>{{comment.status}}</span></div><p>{{comment.content}}</p>
            <div class="actions"><button mat-stroked-button color="warn" (click)="resolve(comment.id,'已退回')">退回补件</button><button mat-flat-button color="primary" (click)="resolve(comment.id,'已接受')">接受条件</button></div></div>
          }
        </section></mat-tab>

        <mat-tab label="复核与会签">
          <section class="card review-list">
            <h3>区段复核（锚定快照 v{{ snapshotVersion$ | async }}）</h3>
            @for (review of reviews$ | async; track review.id) {
              <div class="review-row">
                <span><b>{{ review.segmentId }}</b><small>{{ review.routeId }} · 快照 v{{ review.snapshotVersion }}</small></span>
                <mat-chip [class.risk-high]="review.status==='待复核'" [class.risk-low]="review.status==='已确认'">{{ review.status }}</mat-chip>
                <button mat-stroked-button [disabled]="review.status==='已确认' || review.snapshotVersion !== (snapshotVersion$ | async)" (click)="confirmReview(review.segmentId)">确认复核</button>
              </div>
            }
            <mat-divider />
            <h3>逐角色会签（锚定快照 v{{ snapshotVersion$ | async }}）</h3>
            @for (c of countersigns$ | async; track c.id) {
              <div class="review-row">
                <span><b>{{ c.segmentId }} · {{ c.role }}</b><small>{{ c.routeId }} · 快照 v{{ c.snapshotVersion }}</small></span>
                <mat-chip [class.risk-low]="c.status==='已会签'" [class.risk-mid]="c.status==='待会签'">{{ c.status }}</mat-chip>
                <button mat-stroked-button [disabled]="c.status==='已会签' || c.snapshotVersion !== (snapshotVersion$ | async)" (click)="sign(c.segmentId, c.role)">签署</button>
              </div>
            }
          </section>
        </mat-tab>

        <mat-tab label="发表区段意见"><section class="card form-card">
          <div class="two"><mat-form-field><mat-label>专业角色</mat-label><mat-select [(ngModel)]="role"><mat-option>安全</mat-option><mat-option>运营</mat-option><mat-option>应急</mat-option></mat-select></mat-form-field><mat-form-field><mat-label>区段</mat-label><mat-select [(ngModel)]="segmentId"><mat-option *ngFor="let segment of segments" [value]="segment.id">{{segment.id}} · {{segment.name}}</mat-option></mat-select></mat-form-field></div>
          <mat-form-field class="wide"><mat-label>审批条件与依据</mat-label><textarea matInput rows="5" [(ngModel)]="content" placeholder="明确区段、约束、时限与验收证据"></textarea></mat-form-field>
          <button mat-flat-button color="primary" [disabled]="!content.trim()" (click)="addComment()">提交意见</button>
        </section></mat-tab>

        <mat-tab label="审计时间线"><section class="card timeline">
          <div><i></i><b>16:42 · 韩洁新增 S-203 限速与吸附物资要求</b><p>安全专业 · 修改前记录保留</p></div>
          <div><i></i><b>16:18 · 罗晋接受隧道出口监护条件</b><p>应急专业 · 审批意见已签章</p></div>
          <div><i></i><b>15:50 · 系统生成替代路径 R-ALT-02</b><p>规则引擎 · 风险分由 78 降至 71</p></div>
        </section></mat-tab>
      </mat-tab-group>
    </main>
  `,
  styles: [`
    h2,h3{margin:0 0 12px}.comment-list{padding:0}.comment{padding:18px;border-bottom:1px solid #e7ebf1}.comment-head{display:flex;justify-content:space-between}.comment-head small{display:block;color:#7a8798;margin-top:4px}.comment p{color:#475569}.actions{display:flex;gap:10px}.actions button{margin:8px 8px 0 0}.form-card{max-width:780px}.two{display:grid;grid-template-columns:1fr 1fr;gap:14px}.two mat-form-field,.wide{width:100%}.timeline{padding:8px 18px}.timeline>div{position:relative;padding:14px 10px 14px 28px;border-left:2px solid #cbd5e1}.timeline i{position:absolute;width:9px;height:9px;border-radius:50%;background:#2563eb;left:-5.5px;top:20px}.timeline p{color:#7a8798;margin:5px 0 0}
    @media(max-width:620px){.two{grid-template-columns:1fr}}
    .head-actions{display:flex;gap:10px;align-items:center}.locked-chip{background:#dcfce7;color:#15803d}
    .notice{background:#eff6ff;border:1px solid #bfdbfe;color:#1e3a8a;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:13px}
    .lock-card{margin-bottom:14px}.lock-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}.lock-head h2{margin:0;font-size:16px}.lock-head small{color:#7a8798}
    .lock-rows{display:flex;flex-direction:column;gap:8px;margin-top:12px}.lock-row{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid #e1e7ef;border-radius:6px}.lock-row mat-icon{color:#cbd5e1}.lock-row.confirmed mat-icon{color:#15803d}.lock-label{flex:1;font-size:14px}.lock-met{font-size:12px;color:#b91c1c}.lock-met.met{color:#15803d}
    .review-list h3{margin:14px 0 8px;font-size:15px}.review-row{display:flex;align-items:center;gap:12px;padding:10px 4px;border-bottom:1px solid #edf0f5}.review-row span{flex:1}.review-row small{display:block;color:#7a8798;font-size:12px}
  `],
})
export class ApprovalComponent {
  private readonly store = inject(Store<{ routes: RouteState }>)
  readonly comments$ = this.store.select(selectComments)
  readonly reviews$ = this.store.select(selectReviews)
  readonly countersigns$ = this.store.select(selectCountersigns)
  readonly lockRows$ = this.store.select(selectLockRows)
  readonly allConfirmed$ = this.store.select(selectAllLockConfirmed)
  readonly locked$ = this.store.select(selectLocked)
  readonly lockedAt$ = this.store.select(selectLockedAt)
  readonly notice$ = this.store.select(selectNotice)
  readonly pendingReviewCount$ = this.store.select(selectPendingReviewCount)
  readonly snapshotVersion$ = this.store.select(selectSnapshotVersion)

  role = '安全'
  segmentId = 'S-203'
  content = ''
  segments: RouteState['routes'][number]['segments'] = []
  constructor() { this.store.select('routes').subscribe((state) => { this.segments = state.routes.flatMap((route: RoutePackage) => route.segments) }) }
  addComment() { this.store.dispatch(RouteActions.addComment({ comment: { id: `RV-${Date.now().toString().slice(-4)}`, segmentId: this.segmentId, role: this.role, author: '当前审阅人', content: this.content, status: '待确认' } })); this.content = '' }
  resolve(id: string, status: '已接受' | '已退回') { this.store.dispatch(RouteActions.resolveComment({ id, status })) }
  confirmReview(segmentId: string) { this.store.dispatch(RouteActions.confirmReview({ segmentId })) }
  sign(segmentId: string, role: Countersignature['role']) { this.store.dispatch(RouteActions.signCountersign({ segmentId, role })) }
  confirm(key: LockItem['key']) { this.store.dispatch(RouteActions.confirmLockItem({ key })) }
  lockBaseline() { this.store.dispatch(RouteActions.lockBaseline()) }
}
