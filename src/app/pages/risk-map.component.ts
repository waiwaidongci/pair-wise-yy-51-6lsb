import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Store } from '@ngrx/store'
import { MatButtonModule } from '@angular/material/button'
import { MatSelectModule } from '@angular/material/select'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatCheckboxModule } from '@angular/material/checkbox'
import { MatDividerModule } from '@angular/material/divider'
import maplibregl, { LngLatBounds, Map as MapLibreMap } from 'maplibre-gl'
import type { RoutePackage, RiskSegment } from '../types'
import { RouteState } from '../store/route.reducer'
import { PendingBadgeComponent } from '../shared/pending-badge.component'
import * as RouteActions from '../store/route.actions'

@Component({
  selector: 'app-risk-map',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatSelectModule, MatFormFieldModule, MatCheckboxModule, MatDividerModule, PendingBadgeComponent],
  template: `
    <main class="page">
      <div class="page-head"><div><p class="eyebrow">地理风险叠加 · 快照联动</p><h1>路网与风险图层复核</h1><p>里程测算与封锁快照同源；封锁范围变化后，区段上的复核/会签标记立即转为失效。</p></div><div class="head-actions"><app-pending-badge /><button mat-stroked-button (click)="fitRoute()">定位整条路径</button></div></div>
      <div class="toolbar">
        <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>运输单</mat-label><mat-select [ngModel]="selectedRouteId" (ngModelChange)="selectRoute($event)">@for (route of (state$ | async)?.routes || []; track route.id) { <mat-option [value]="route.id">{{route.id}} · {{route.trainCode}} · 修订 {{route.snapshot.revision}}</mat-option> }</mat-select></mat-form-field>
        <mat-checkbox [(ngModel)]="layers.tunnel" (change)="refreshLayers()">隧道</mat-checkbox><mat-checkbox [(ngModel)]="layers.bridge" (change)="refreshLayers()">桥梁</mat-checkbox><mat-checkbox [(ngModel)]="layers.water" (change)="refreshLayers()">水源地</mat-checkbox><mat-checkbox [(ngModel)]="layers.population" (change)="refreshLayers()">人口密集区</mat-checkbox>
      </div>
      <div class="grid-2">
        <div #mapEl class="map"></div>
        <aside class="card">
          <div class="panel-head"><div><h2>区段风险清单</h2><p>已按风险等级排序 · 与快照修订 {{selectedRoute?.snapshot?.revision}} 对齐</p></div><strong [class.risk-high]="selectedRoute !== undefined && selectedRoute.score >= 70">总风险 {{selectedRoute?.score}}</strong></div>
          @for (segment of selectedRoute?.segments || []; track segment.id) {
            <button class="segment" [class.active]="segment.id === selectedSegmentId" (click)="selectSegment(segment)">
              <span><b>{{segment.name}}</b><small>{{segment.from}} → {{segment.to}} · {{segment.km}} km · {{segment.speed}}</small><em>{{segment.risks.join(' / ')}}</em>
                @if (scopeState(segment.id)) { <small class="scope-state" [class.block]="scopeState(segment.id)==='封锁'" [class.slow]="scopeState(segment.id)==='慢行'">封锁状态：{{scopeState(segment.id)}} · {{scopeLimit(segment.id)}} km/h</small> }
                @if (invalidCount(segment.id) > 0) { <small class="invalid">⚠ {{invalidCount(segment.id)}} 条复核/会签已随修订失效，待重做</small> }
              </span><strong [class.risk-high]="segment.level==='高'" [class.risk-mid]="segment.level==='中'" [class.risk-low]="segment.level==='低'">{{segment.level}}</strong>
            </button>
          }
          <mat-divider />
          <h3>路径测算（来自共享快照）</h3>
          <p>实测里程：<b>{{selectedRoute?.snapshot?.mileageKm ?? '0.0'}} km</b> @if (selectedRoute?.snapshot?.mileageStale) { <span class="recalc">重算中…</span> }</p>
          <p>封锁/慢行折算：{{selectedRoute?.snapshot?.blockedKm ?? '0'}} km</p>
          <p>预计运行：{{estimatedTime}}</p>
          <p>限制区段：{{restrictedCount}} 处</p>
          <p class="snap-line">快照版本 v{{selectedRoute?.snapshot?.version}} · 修订 {{selectedRoute?.snapshot?.revision}} · {{selectedRoute?.snapshot?.updatedAt}}</p>
          <button mat-flat-button color="primary" style="width:100%" (click)="requireAlternative()">要求补充绕行方案</button>
        </aside>
      </div>
    </main>
  `,
  styles: [`
    h2,h3{margin:0 0 10px}.head-actions{display:flex;gap:10px;align-items:center}.panel-head{display:flex;justify-content:space-between}.panel-head p{font-size:12px}
    .segment{width:100%;display:flex;justify-content:space-between;text-align:left;gap:10px;padding:13px;margin:6px 0;border:1px solid #e1e7ef;background:#fff;border-radius:6px;color:inherit;cursor:pointer}.segment.active{border-color:#2563eb;background:#f5f8ff}.segment b,.segment small,.segment em{display:block}.segment small{color:#7a8798;margin:4px 0}.segment em{font-size:12px;color:#475569;font-style:normal}
    .scope-state{color:#475569}.scope-state.block{color:#dc2626;font-weight:700}.scope-state.slow{color:#d97706;font-weight:700}.invalid{color:#dc2626;font-weight:700}
    .recalc{color:#d97706;font-size:12px;margin-left:8px}.snap-line{color:#7a8798;font-size:12px}
  `],
})
export class RiskMapComponent implements AfterViewInit, OnDestroy {
  @ViewChild('mapEl') mapEl!: ElementRef<HTMLDivElement>
  private readonly store = inject(Store<{ routes: RouteState }>)
  readonly state$ = this.store.select('routes')
  private map?: MapLibreMap
  selectedRouteId = ''
  selectedSegmentId = ''
  private reviews: RouteState['reviews'] = []
  layers = { tunnel: true, bridge: true, water: true, population: true }

  get selectedRoute(): RoutePackage | undefined { let route: RoutePackage | undefined; this.state$.subscribe((state) => { route = state.routes.find((item: RoutePackage) => item.id === state.selectedRouteId) }).unsubscribe(); return route }
  get estimatedTime() {
    const route = this.selectedRoute
    if (!route) return '0 分钟'
    return `${Math.round(route.snapshot.mileageKm / 55 * 60 + this.restrictedCount * 8)} 分钟`
  }
  get restrictedCount() {
    const scope = this.selectedRoute?.snapshot.draftScope ?? []
    return scope.filter((item) => item.state !== '开通').length
  }

  constructor() {
    this.state$.subscribe((state) => {
      this.selectedRouteId = state.selectedRouteId
      this.selectedSegmentId = state.selectedSegmentId
      this.reviews = state.reviews
      if (this.map) this.drawRoute()
    })
  }
  ngAfterViewInit() {
    this.map = new maplibregl.Map({
      container: this.mapEl.nativeElement,
      style: { version: 8, sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap' } }, layers: [{ id: 'osm', type: 'raster', source: 'osm' }] },
      center: [112.2, 34.5], zoom: 5,
    })
    this.map.addControl(new maplibregl.NavigationControl(), 'top-right')
    this.map.on('load', () => { this.addRiskLayers(); this.drawRoute() })
  }
  ngOnDestroy() { this.map?.remove() }
  selectRoute(id: string) { this.store.dispatch(RouteActions.selectRoute({ id })) }
  selectSegment(segment: RiskSegment) { this.store.dispatch(RouteActions.selectSegment({ id: segment.id })); this.map?.flyTo({ center: segment.coordinates[0], zoom: 8 }) }
  requireAlternative() { this.store.dispatch(RouteActions.createAlternative()) }
  fitRoute() { if (!this.map || !this.selectedRoute) return; const bounds = new LngLatBounds(); this.selectedRoute.segments.flatMap((segment) => segment.coordinates).forEach((point) => bounds.extend(point)); this.map.fitBounds(bounds, { padding: 50 }) }
  refreshLayers() { for (const [id, visible] of Object.entries(this.layers)) { if (this.map?.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none') } }

  scopeState(segmentId: string) { return this.selectedRoute?.snapshot.draftScope.find((item) => item.segmentId === segmentId)?.state }
  scopeLimit(segmentId: string) { return this.selectedRoute?.snapshot.draftScope.find((item) => item.segmentId === segmentId)?.speedLimit }
  invalidCount(segmentId: string) {
    const routeId = this.selectedRouteId
    return this.reviews.filter((review) => review.routeId === routeId && review.segmentId === segmentId && !review.valid).length
  }

  private addRiskLayers() {
    const features: GeoJSON.Feature<GeoJSON.Point>[] = [
      { type: 'Feature', properties: { kind: 'tunnel' }, geometry: { type: 'Point', coordinates: [114.3, 35.2] } },
      { type: 'Feature', properties: { kind: 'bridge' }, geometry: { type: 'Point', coordinates: [116.1, 34.2] } },
      { type: 'Feature', properties: { kind: 'water' }, geometry: { type: 'Point', coordinates: [110.4, 34.8] } },
      { type: 'Feature', properties: { kind: 'population' }, geometry: { type: 'Point', coordinates: [118.0, 35.8] } },
    ]
    const colors: Record<string, string> = { tunnel: '#4f46e5', bridge: '#d97706', water: '#0891b2', population: '#dc2626' }
    Object.entries(colors).forEach(([kind, color]) => {
      this.map?.addSource(kind, { type: 'geojson', data: { type: 'FeatureCollection', features: features.filter((feature) => feature.properties?.['kind'] === kind) } })
      this.map?.addLayer({ id: kind, type: 'circle', source: kind, paint: { 'circle-radius': 10, 'circle-color': color, 'circle-opacity': .75, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } })
    })
  }
  private drawRoute() {
    if (!this.map?.isStyleLoaded() || !this.selectedRoute) return
    if (this.map.getLayer('route-line')) { this.map.removeLayer('route-line'); this.map.removeSource('route') }
    this.map.addSource('route', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: this.selectedRoute.segments.map((segment) => segment.coordinates) } } })
    this.map.addLayer({ id: 'route-line', type: 'line', source: 'route', paint: { 'line-color': '#2563eb', 'line-width': 4, 'line-opacity': .9 } })
  }
}
