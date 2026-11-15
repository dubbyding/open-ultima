import { COLORS } from '../shared/theme/tokens.ts';
import {
  compassBearingDegrees,
  formatCompassCardinal,
  formatDistanceMeters,
  haversineDistanceMeters,
  isValidGpsCoordinate,
  projectLatLngToCanvas,
} from './geoMath.ts';
import type {
  CanvasPoint,
  CanvasProjectionOptions,
  GeoPoint,
} from './geoMath.ts';

export type OfflineMapMode = 'radar' | 'route' | 'combined';

export type OfflineMapPinRole =
  | 'user'
  | 'left_earbud'
  | 'right_earbud'
  | 'case'
  | 'watch'
  | 'history';

export interface OfflineMapPin {
  id: string;
  label: string;
  shortTag?: string;
  lat: number;
  lng: number;
  role?: OfflineMapPinRole;
  note?: string;
  savedAt?: number;
  color?: string;
}

export interface OfflineMapWaypoint {
  lat: number;
  lng: number;
  timestamp: string;
  heartRateBpm?: number;
  elevationMeters?: number;
}

export interface OfflineMapRoute {
  id: string;
  name: string;
  activityType: string;
  startedAt: string;
  endedAt: string;
  distanceMeters: number;
  durationSec: number;
  caloriesKcal: number;
  avgHeartRateBpm?: number;
  maxHeartRateBpm?: number;
  elevationGainMeters?: number;
  waypoints: readonly OfflineMapWaypoint[];
}

export interface OfflineMapCanvasProps {
  mode?: OfflineMapMode;
  title?: string;
  pins?: readonly OfflineMapPin[];
  userLocation?: { lat: number; lng: number; label?: string } | null;
  routes?: readonly OfflineMapRoute[];
  activeRouteId?: string;
  height?: number;
  compact?: boolean;
  emptyMessage?: string;
  onPinPress?: (pin: OfflineMapPin) => void;
}

export interface ProjectedSegment {
  key: string;
  mx: number;
  my: number;
  length: number;
  angleRad: number;
  color: string;
}

export interface ProjectedPin {
  pin: OfflineMapPin;
  pos: CanvasPoint;
}

export interface ActiveWaypointPoint {
  wp: OfflineMapWaypoint;
  x: number;
  y: number;
  idx: number;
}

export interface BearingRow {
  pin: OfflineMapPin;
  dist: number;
  deg: number;
  dir: string;
}

export interface Graticules {
  horiz: Array<{ key: string; y: number; label: string }>;
  vert: Array<{ key: string; x: number; label: string }>;
}

export interface PinPalette {
  bg: string;
  border: string;
  text: string;
  tag: string;
}

export interface ScaleBarState {
  widthPx: number;
  label: string;
}

export interface RouteElevationStats {
  minElev: number;
  maxElev: number;
  gain: number;
}

/** Returns marker colors and default tag letter for a map pin role. */
export function getPinPalette(
  role?: OfflineMapPinRole,
  overrideColor?: string,
): PinPalette {
  if (overrideColor) {
    return { bg: overrideColor, border: COLORS.white, text: COLORS.bg, tag: '•' };
  }
  switch (role) {
    case 'user':
      return { bg: COLORS.white, border: COLORS.indigo, text: COLORS.bg, tag: 'U' };
    case 'left_earbud':
      return { bg: COLORS.cyan, border: COLORS.white, text: COLORS.bg, tag: 'L' };
    case 'right_earbud':
      return { bg: COLORS.emerald, border: COLORS.white, text: COLORS.bg, tag: 'R' };
    case 'case':
      return { bg: COLORS.amber, border: COLORS.white, text: COLORS.bg, tag: 'C' };
    case 'watch':
      return { bg: COLORS.rose, border: COLORS.white, text: COLORS.bg, tag: 'W' };
    case 'history':
    default:
      return { bg: COLORS.indigo, border: COLORS.textPrimary, text: COLORS.white, tag: 'H' };
  }
}

export function segmentColorForWaypoint(
  wp: OfflineMapWaypoint,
  avgHr: number | undefined,
  isActive: boolean,
): string {
  if (!isActive) return 'rgba(129, 140, 248, 0.35)';
  if (wp.heartRateBpm !== undefined && avgHr !== undefined) {
    if (wp.heartRateBpm >= avgHr + 12) return COLORS.rose;
    if (wp.heartRateBpm >= avgHr + 3) return COLORS.amber;
    return COLORS.cyan;
  }
  return COLORS.cyan;
}

export function formatDurationClock(totalSec: number): string {
  const safe = Math.max(0, Math.round(totalSec));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hrs > 0) return `${hrs}h ${String(mins).padStart(2, '0')}m`;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/** Projects all route polylines and active route waypoints onto canvas space. */
export function buildRouteGraphics(
  routes: readonly OfflineMapRoute[],
  activeRoute: OfflineMapRoute | null,
  projectionOpts: CanvasProjectionOptions,
): { segments: ProjectedSegment[]; activeWaypoints: ActiveWaypointPoint[] } {
  const segments: ProjectedSegment[] = [];
  const activeWaypoints: ActiveWaypointPoint[] = [];

  for (const route of routes) {
    const isActive = !activeRoute || route.id === activeRoute.id;
    const validWps = route.waypoints.filter((w) => isValidGpsCoordinate(w.lat, w.lng));
    let prevPt: CanvasPoint | null = null;
    for (let i = 0; i < validWps.length; i++) {
      const wp = validWps[i]!;
      const pt = projectLatLngToCanvas(wp, projectionOpts);
      if (isActive) activeWaypoints.push({ wp, x: pt.x, y: pt.y, idx: i });
      if (prevPt !== null) {
        const dx = pt.x - prevPt.x;
        const dy = pt.y - prevPt.y;
        const len = Math.hypot(dx, dy);
        if (len >= 1) {
          segments.push({
            key: `${route.id}-seg-${i}`,
            mx: (prevPt.x + pt.x) / 2,
            my: (prevPt.y + pt.y) / 2,
            length: len,
            angleRad: Math.atan2(dy, dx),
            color: segmentColorForWaypoint(wp, route.avgHeartRateBpm, isActive),
          });
        }
      }
      prevPt = pt;
    }
  }
  return { segments, activeWaypoints };
}

/** Builds sightline vectors connecting the radar anchor to each projected pin. */
export function buildRadarSightlines(
  mode: OfflineMapMode,
  projectedAnchor: CanvasPoint | null,
  projectedPins: readonly ProjectedPin[],
  radarAnchor: GeoPoint | null,
): ProjectedSegment[] {
  if (mode === 'route' || !projectedAnchor || !radarAnchor) return [];
  return projectedPins
    .filter(
      ({ pin }) =>
        Math.abs(pin.lat - radarAnchor.lat) > 1e-8 ||
        Math.abs(pin.lng - radarAnchor.lng) > 1e-8,
    )
    .map(({ pin, pos }) => {
      const dx = pos.x - projectedAnchor.x;
      const dy = pos.y - projectedAnchor.y;
      return {
        key: `sight-${pin.id}`,
        mx: (projectedAnchor.x + pos.x) / 2,
        my: (projectedAnchor.y + pos.y) / 2,
        length: Math.hypot(dx, dy),
        angleRad: Math.atan2(dy, dx),
        color: getPinPalette(pin.role, pin.color).bg,
      };
    })
    .filter((s) => s.length >= 4);
}

/** Computes a snapped map scale bar width and formatted metric label. */
export function computeScaleBar(
  viewportMetersWidth: number,
  canvasWidth: number,
  padding: number,
): ScaleBarState {
  const quarterMeters = Math.max(1, viewportMetersWidth * 0.28);
  const niceSteps = [2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
  let chosen = niceSteps[0]!;
  for (const step of niceSteps) {
    if (step <= quarterMeters * 1.25) chosen = step;
  }
  const pxWidth =
    viewportMetersWidth > 0
      ? Math.max(
          26,
          Math.min(
            canvasWidth * 0.35,
            (chosen / viewportMetersWidth) * (canvasWidth - padding * 2),
          ),
        )
      : 48;
  return { widthPx: pxWidth, label: formatDistanceMeters(chosen) };
}

/** Computes horizontal latitude and vertical longitude coordinate gridlines. */
export function buildGraticules(
  effLatSpan: number,
  effLngSpan: number,
  viewCenterLat: number,
  viewCenterLng: number,
  projectionOpts: CanvasProjectionOptions,
): Graticules {
  const latStep = effLatSpan / 4;
  const lngStep = effLngSpan / 4;
  return {
    horiz: [-1, 0, 1].map((i) => {
      const lat = viewCenterLat + i * latStep;
      const y = projectLatLngToCanvas({ lat, lng: viewCenterLng }, projectionOpts).y;
      return { key: `lat-${i}`, y, label: `${lat.toFixed(4)}°` };
    }),
    vert: [-1, 0, 1].map((i) => {
      const lng = viewCenterLng + i * lngStep;
      const x = projectLatLngToCanvas({ lat: viewCenterLat, lng }, projectionOpts).x;
      return { key: `lng-${i}`, x, label: `${lng.toFixed(4)}°` };
    }),
  };
}

/** Computes Haversine distance and compass bearing rows from the radar anchor. */
export function buildBearingRows(
  radarAnchor: GeoPoint | null,
  validPins: readonly OfflineMapPin[],
  mode: OfflineMapMode,
): BearingRow[] {
  if (!radarAnchor || mode === 'route') return [];
  return validPins.map((pin) => {
    const dist = haversineDistanceMeters(radarAnchor, pin);
    const deg = compassBearingDegrees(radarAnchor, pin);
    return { pin, dist, deg, dir: formatCompassCardinal(deg) };
  });
}

/** Summarizes min/max elevation and total elevation gain for a GPS route. */
export function computeRouteElevationStats(
  activeRoute: OfflineMapRoute | null,
): RouteElevationStats | null {
  if (!activeRoute) return null;
  const elevs = activeRoute.waypoints
    .map((w) => w.elevationMeters)
    .filter((v): v is number => typeof v === 'number');
  if (elevs.length === 0) return null;
  return {
    minElev: Math.min(...elevs),
    maxElev: Math.max(...elevs),
    gain:
      activeRoute.elevationGainMeters ??
      Math.max(0, Math.max(...elevs) - Math.min(...elevs)),
  };
}
