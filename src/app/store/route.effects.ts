import { inject, Injectable } from '@angular/core'
import { Actions, createEffect, ofType } from '@ngrx/effects'
import { Store } from '@ngrx/store'
import { catchError, filter, from, map, mergeMap, of, switchMap, tap, withLatestFrom } from 'rxjs'
import { RouteApiService } from '../services/route-api.service'
import { InspectionSyncService } from '../services/inspection-sync.service'
import type { InspectionSheet } from '../types'
import * as RouteActions from './route.actions'
import { RouteState } from './route.reducer'
import { nextId } from './snapshot.utils'

const STORAGE_KEY = 'rail-inspection-sheets-v1'

@Injectable()
export class RouteEffects {
  private readonly actions$ = inject(Actions)
  private readonly api = inject(RouteApiService)
  private readonly sync = new InspectionSyncService()
  private readonly store = inject(Store<{ routes: RouteState }>)

  loadRoutes$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.loadRoutes),
    switchMap(() => this.api.getRoutePackages().pipe(
      map((routes) => RouteActions.loadRoutesSuccess({ routes })),
      catchError((error: unknown) => of(RouteActions.loadRoutesFailure({ error: error instanceof Error ? error.message : '无法读取路径数据' }))),
    )),
  ))

  /** 启动时恢复断网期间滞留本地的巡查单 */
  hydrateInspections$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.loadRoutesSuccess),
    map(() => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        const sheets = (raw ? JSON.parse(raw) as InspectionSheet[] : [])
        return RouteActions.hydrateInspections({ sheets })
      } catch {
        return RouteActions.hydrateInspections({ sheets: [] })
      }
    }),
  ))

  /**
   * 两个调度先后保存：baseRevision 与当前修订号一致 => 先到生效；
   * 落后 => 后到内容不覆盖，整体进入冲突待办。
   */
  saveSnapshot$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.saveSnapshotRequested),
    withLatestFrom(this.store.select('routes')),
    switchMap(([action, state]: [ReturnType<typeof RouteActions.saveSnapshotRequested>, RouteState]) => {
      const { routeId, dispatcher, baseRevision, scope, reason } = action
      const route = state.routes.find((item) => item.id === routeId)
      if (!route) return of()
      if (route.snapshot.revision === baseRevision) {
        return of(RouteActions.saveSnapshotSuccess({ routeId, revision: baseRevision, scope, dispatcher }))
      }
      return of(RouteActions.saveSnapshotConflict({
        conflict: {
          id: nextId('CF'),
          routeId,
          dispatcher,
          baseRevision,
          currentRevision: route.snapshot.revision,
          scope,
          reason,
          createdAt: new Date().toISOString(),
          status: '待处理',
        },
      }))
    }),
  ))

  /** 恢复联网或手动触发时，只上送「离线待传 / 写入失败」的巡查单，逐单串行避免乱序 */
  syncInspections$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.syncInspectionsRequested, RouteActions.setOnline),
    withLatestFrom(this.store.select('routes')),
    filter(([, state]) => state.online),
    switchMap(([, state]: [unknown, RouteState]) => {
      const pending = state.inspections.filter((sheet: InspectionSheet) => sheet.status === '离线待传' || sheet.status === '写入失败')
      return from(pending).pipe(
        mergeMap((sheet) => {
          this.store.dispatch(RouteActions.inspectStatusChanged({ token: sheet.token, status: '同步中' }))
          return this.sync.submit(sheet, state.syncFault).pipe(
            map(({ merged, message }) => RouteActions.inspectSyncSucceeded({ token: sheet.token, merged, message })),
            catchError((error: unknown) => of(RouteActions.inspectSyncFailed({
              token: sheet.token,
              message: error instanceof Error ? error.message : '写入失败，等待重试',
            }))),
          )
        }, 1),
      )
    }),
  ))

  /** 离线巡查单持久化到本机，刷新/重启后仍按原单号继续合并 */
  persistInspections$ = createEffect(() => this.actions$.pipe(
    ofType(
      RouteActions.queueInspection,
      RouteActions.inspectStatusChanged,
      RouteActions.inspectSyncSucceeded,
      RouteActions.inspectSyncFailed,
      RouteActions.hydrateInspections,
    ),
    withLatestFrom(this.store.select('routes')),
    tap(([, state]: [unknown, RouteState]) => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.inspections)) } catch { /* 存储不可用时忽略 */ }
    }),
  ), { dispatch: false })
}
