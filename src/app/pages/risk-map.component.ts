import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Store } from '@ngrx/store'
import { MatButtonModule } from '@angular/material/button'
import { MatSelectModule } from '@angular/material/select'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatCheckboxModule } from '@angular/material/checkbox'
import { MatInputModule } from '@angular/material/input'
import { MatDividerModule } from '@angular/material/divider'
import { MatChipsModule } from '@angular/material/chips'
import maplibregl, { LngLatBounds, Map as MapLibreMap } from 'maplibre-gl'
import type { Countersignature, ReviewTask, RoutePackage, RiskSegment } from '../types'
import { RouteState } from '../store/route.reducer'
import * as RouteActions from '../store/route.actions'
import { pendingReviewCount } from '../utils/rail.utils'

@Component({
  selector: 'app-risk-map',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatSelectModule, MatFormFieldModule, MatCheckboxModule, MatInputModule, MatDividerModule, MatChipsModule],
  template: `
    <main class="page">
      <div class="page-head"><div><p class="eyebrow">地理风险叠加</p><h1>路网与风险图层复核</h1><p>比较候选路径，定位桥梁、隧道、水源地、人口密集区与限速区段。</p></div><button mat-stroked-button (click)="fitRoute()">定位整条路径</button></div>

      <section class="card blockage-card">
        <div class="blockage-head">
          <div><h2>封锁范围（生成共用快照）</h2><p>勾选封锁区段并应用：快照版本 +1，关联复核、会签、里程立即失效重算。</p></div>
          <mat-chip highlighted>当前快照 v{{ snapshotVersion }}</mat-chip>
        </div>
        <div class="blockage-grid">
          @for (segment of allSegments; track segment.id) {
            <mat-checkbox [checked]="isBlockedDraft(segment.id)" (change)="toggleBlockedDraft(segment.id, $event.checked)">{{ segment.id }} · {{ segment.name }}</mat-checkbox>
          }
        </div>
        <div class="blockage-apply">
          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="reason"><mat-label>封锁原因 / 调度命令号</mat-label><input matInput [(ngModel)]="blockageReason" placeholder="如：水害封锁 调度命令 2026-0930-07" /></mat-form-field>
          <button mat-flat-button color="primary" (click)="applyBlockage()">应用封锁范围并生成快照</button>
        </div>
      </section>

      <div class="toolbar">
        <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>运输单</mat-label><mat-select [ngModel]="selectedRouteId" (ngModelChange)="selectRoute($event)">@for (route of routes; track route.id) { <mat-option [value]="route.id">{{route.id}} · {{route.trainCode}}</mat-option> }</mat-select></mat-form-field>
        <mat-checkbox [(ngModel)]="layers.tunnel" (change)="refreshLayers()">隧道</mat-checkbox><mat-checkbox [(ngModel)]="layers.bridge" (change)="refreshLayers()">桥梁</mat-checkbox><mat-checkbox [(ngModel)]="layers.water" (change)="refreshLayers()">水源地</mat-checkbox><mat-checkbox [(ngModel)]="layers.population" (change)="refreshLayers()">人口密集区</mat-checkbox>
        <span class="spacer"></span><mat-chip>待复核 {{ pendingReviewCount }}（三页一致）</mat-chip>
      </div>
      <div class="grid-2">
        <div #mapEl class="map"></div>
        <aside class="card">
          <div class="panel-head"><div><h2>区段风险清单</h2><p>已按风险等级排序</p></div><strong [class.risk-high]="selectedRoute !== undefined && selectedRoute.score >= 70">总风险 {{selectedRoute?.score}}</strong></div>
          @for (segment of selectedRoute?.segments || []; track segment.id) {
            <div class="segment" [class.active]="segment.id === selectedSegmentId" (click)="selectSegment(segment)">
              <span><b>{{segment.name}}</b><small>{{segment.from}} → {{segment.to}} · {{segment.km}} km · {{segment.speed}}</small><em>{{segment.risks.join(' / ')}}</em>
                <span class="status-line">
                  <mat-chip [class.risk-high]="reviewOf(segment.id)?.status==='待复核'" [class.risk-low]="reviewOf(segment.id)?.status==='已确认'">复核 · {{ reviewOf(segment.id)?.status || '—' }}</mat-chip>
                  @for (c of countersignsOf(segment.id); track c.role) {
                    <mat-chip [class.risk-low]="c.status==='已会签'" [class.risk-mid]="c.status==='待会签'" (click)="sign(segment.id, c.role); $event.stopPropagation()">{{ c.role }} · {{ c.status }}</mat-chip>
                  }
                </span>
              </span>
              <strong [class.risk-high]="segment.level==='高'" [class.risk-mid]="segment.level==='中'" [class.risk-low]="segment.level==='低'">{{segment.level}}</strong>
            </div>
          }
          <mat-divider />
          <h3>路径测算 <small class="snap-tag">已按快照 v{{ snapshotVersion }} 重算</small></h3>
          @if (currentMileage; as mileage) {
            <p>实测里程：{{ mileage.km }} km</p><p>预计运行：{{ mileage.estimatedMinutes }} 分钟</p><p>限制区段：{{ mileage.restrictedCount }} 处</p>
          } @else {
            <p class="risk-mid">里程尚未按当前快照重算…</p>
          }
          <button mat-flat-button color="primary" style="width:100%" (click)="requireAlternative()">要求补充绕行方案</button>
        </aside>
      </div>
    </main>
  `,
  styles: [`
    h2,h3{margin:0 0 10px}.panel-head{display:flex;justify-content:space-between}.segment{width:100%;display:flex;justify-content:space-between;text-align:left;gap:10px;padding:13px;margin:6px 0;border:1px solid #e1e7ef;background:#fff;border-radius:6px;color:inherit;cursor:pointer}.segment.active{border-color:#2563eb;background:#f5f8ff}.segment b,.segment small,.segment em{display:block}.segment small{color:#7a8798;margin:4px 0}.segment em{font-size:12px;color:#475569;font-style:normal}
    .blockage-card{margin-bottom:14px}.blockage-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.blockage-head h2{margin:0 0 4px;font-size:16px}.blockage-head p{margin:0;color:#667085;font-size:13px}.blockage-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px;margin:12px 0}.blockage-apply{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.blockage-apply .reason{flex:1;min-width:240px}
    .status-line{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.status-line mat-chip{cursor:pointer;font-size:11px;min-height:24px}.snap-tag{color:#2563eb;font-size:12px;font-weight:600}
  `],
})
export class RiskMapComponent implements AfterViewInit, OnDestroy {
  @ViewChild('mapEl') mapEl!: ElementRef<HTMLDivElement>
  private readonly store = inject(Store<{ routes: RouteState }>)
  private map?: MapLibreMap
  routes: RoutePackage[] = []
  selectedRouteId = ''
  selectedSegmentId = ''
  snapshotVersion = 1
  blockedSegmentIds: string[] = []
  reviews: ReviewTask[] = []
  countersigns: Countersignature[] = []
  mileages: { routeId: string; km: number; estimatedMinutes: number; restrictedCount: number; snapshotVersion: number }[] = []
  pendingReviewCount = 0
  layers = { tunnel: true, bridge: true, water: true, population: true }
  blockageDraft: string[] = []
  blockageReason = ''
  private lastBlockedKey = ''

  get allSegments(): RiskSegment[] { return this.routes.flatMap((route) => route.segments) }
  get selectedRoute(): RoutePackage | undefined { return this.routes.find((route) => route.id === this.selectedRouteId) }
  get currentMileage() { return this.mileages.find((m) => m.routeId === this.selectedRouteId && m.snapshotVersion === this.snapshotVersion) }

  constructor() {
    this.store.select('routes').subscribe((state) => {
      this.routes = state.routes
      this.selectedRouteId = state.selectedRouteId
      this.selectedSegmentId = state.selectedSegmentId
      this.snapshotVersion = state.snapshotVersion
      this.blockedSegmentIds = state.blockedSegmentIds
      this.reviews = state.reviews
      this.countersigns = state.countersigns
      this.mileages = state.mileages
      this.pendingReviewCount = pendingReviewCount(state.reviews, state.snapshotVersion)
      const key = state.blockedSegmentIds.slice().sort().join(',')
      if (key !== this.lastBlockedKey) { this.blockageDraft = [...state.blockedSegmentIds]; this.lastBlockedKey = key }
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

  isBlockedDraft(id: string): boolean { return this.blockageDraft.includes(id) }
  toggleBlockedDraft(id: string, checked: boolean) {
    this.blockageDraft = checked ? [...this.blockageDraft, id] : this.blockageDraft.filter((item) => item !== id)
  }
  applyBlockage() {
    this.store.dispatch(RouteActions.setBlockedSegments({ segmentIds: [...this.blockageDraft], reason: this.blockageReason.trim() || '封锁范围调整' }))
  }
  reviewOf(segmentId: string) { return this.reviews.find((review) => review.segmentId === segmentId && review.snapshotVersion === this.snapshotVersion) }
  countersignsOf(segmentId: string) { return this.countersigns.filter((c) => c.segmentId === segmentId && c.snapshotVersion === this.snapshotVersion) }
  sign(segmentId: string, role: Countersignature['role']) { this.store.dispatch(RouteActions.signCountersign({ segmentId, role })) }

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
    this.drawBlocked()
  }
  private drawBlocked() {
    if (!this.map?.isStyleLoaded()) return
    if (this.map.getLayer('blocked-line')) { this.map.removeLayer('blocked-line'); this.map.removeSource('blocked') }
    if (!this.selectedRoute) return
    const blocked = this.selectedRoute.segments.filter((segment) => this.blockedSegmentIds.includes(segment.id))
    if (blocked.length === 0) return
    this.map.addSource('blocked', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: blocked.map((segment) => segment.coordinates) } } })
    this.map.addLayer({ id: 'blocked-line', type: 'line', source: 'blocked', paint: { 'line-color': '#dc2626', 'line-width': 5, 'line-dasharray': [2, 2], 'line-opacity': .95 } })
  }
}
