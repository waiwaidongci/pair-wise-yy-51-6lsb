import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { Store } from '@ngrx/store'
import { MatChipsModule } from '@angular/material/chips'
import { selectPendingReviewCount } from '../store/route.selectors'

/** 工作台、地图、审批页共用同一选择器，显示相同的待复核数 */
@Component({
  selector: 'app-pending-badge',
  standalone: true,
  imports: [CommonModule, MatChipsModule],
  template: `
    <mat-chip-set class="pending-chip" aria-label="待复核数">
      <mat-chip highlighted [class.zero]="(count$ | async) === 0">
        待复核 <b>{{ count$ | async }}</b>
      </mat-chip>
    </mat-chip-set>
  `,
  styles: [`
    .pending-chip { display: inline-flex; }
    mat-chip { font-weight: 600; background: #fef2f2; color: #b91c1c; border-radius: 999px; min-height: 30px; }
    mat-chip.zero { background: #ecfdf5; color: #047857; }
    mat-chip b { margin-left: 4px; font-size: 15px; }
  `],
})
export class PendingBadgeComponent {
  private readonly store = inject(Store)
  readonly count$ = this.store.select(selectPendingReviewCount)
}
