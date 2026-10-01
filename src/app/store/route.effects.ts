import { inject, Injectable } from '@angular/core'
import { Actions, createEffect, ofType } from '@ngrx/effects'
import { Store } from '@ngrx/store'
import { catchError, filter, forkJoin, map, merge, mergeMap, of, switchMap, withLatestFrom } from 'rxjs'
import { RouteApiService } from '../services/route-api.service'
import { SnapshotService } from '../services/snapshot.service'
import type { InspectionOrder } from '../types'
import { rid } from '../utils/rail.utils'
import * as RouteActions from './route.actions'
import { selectInspectionOrders, selectOnline } from './route.selectors'

@Injectable()
export class RouteEffects {
  private readonly actions$ = inject(Actions)
  private readonly api = inject(RouteApiService)
  private readonly snapshot = inject(SnapshotService)
  private readonly store = inject(Store)

  loadRoutes$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.loadRoutes),
    switchMap(() => forkJoin([
      this.api.getRoutePackages(),
      of(this.snapshot.getSnapshot()),
      of(this.snapshot.getDraftVersion()),
    ]).pipe(
      map(([routes, persisted, draftVersion]) => RouteActions.loadRoutesSuccess({
        routes,
        blockedSegmentIds: persisted.blockedSegmentIds,
        snapshotVersion: persisted.version,
        draftVersion,
      })),
      catchError((error: unknown) => of(RouteActions.loadRoutesFailure({ error: error instanceof Error ? error.message : '无法读取路径数据' }))),
    )),
  ))

  /** 保存草案：先到生效，后到进冲突待办（乐观并发）。 */
  saveDraft$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.saveDraft),
    mergeMap(({ baseVersion, author, summary }) => this.snapshot.saveDraft(baseVersion, author, summary).pipe(
      map((result) => result.ok
        ? RouteActions.saveDraftSuccess({ version: result.version, savedAt: result.savedAt })
        : RouteActions.saveDraftConflict({
          conflict: {
            id: rid('CF'),
            author,
            baseSnapshotVersion: result.conflict.baseVersion,
            currentSnapshotVersion: result.conflict.currentVersion,
            summary,
            receivedAt: result.conflict.receivedAt,
            status: '待处理',
          },
        })),
    )),
  ))

  /** 新建巡查单：联网立即上传；断网则留在本地队列，待联网后合并。 */
  createInspectionOrder$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.createInspectionOrder),
    withLatestFrom(this.store.select(selectOnline)),
    filter(([, online]) => online),
    mergeMap(([{ order }]) => this.uploadOrder(order)),
  ))

  /** 重试：沿用同一幂等键，服务端返回首次结果，不重复写入。 */
  retryInspectionOrder$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.retryInspectionOrder),
    withLatestFrom(this.store.select(selectInspectionOrders)),
    mergeMap(([{ id }, orders]) => {
      const order = orders.find((item) => item.id === id)
      return order ? this.uploadOrder(order) : of()
    }),
  ))

  /** 联网：缓存队列按原单号合并上传。 */
  flushOnOnline$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.setOnline),
    filter(({ online }) => online),
    withLatestFrom(this.store.select(selectInspectionOrders)),
    mergeMap(([, orders]) => {
      const pending = orders.filter((order) => order.status === '待上传' || order.status === '写入失败')
      return pending.length ? merge(...pending.map((order) => this.uploadOrder(order))) : of()
    }),
  ))

  private uploadOrder(order: InspectionOrder) {
    return this.snapshot.uploadOrder(order).pipe(
      map((result) => RouteActions.uploadInspectionOrderSuccess({
        orderNo: result.orderNo,
        idempotencyKey: result.idempotencyKey,
        merged: result.merged,
      })),
      catchError(() => of(RouteActions.uploadInspectionOrderFailure({ idempotencyKey: order.idempotencyKey }))),
    )
  }
}
