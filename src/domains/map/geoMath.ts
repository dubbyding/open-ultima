/**
 * Pure geographic / geodesic math helpers for the 100% offline vector map,
 * Find-My compass radar, and GPS workout trajectory renderer.
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface GeoBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  centerLat: number;
  centerLng: number;
  latSpan: number;
  lngSpan: number;
}

export interface CanvasProjectionOptions {
  centerLat: number;
  centerLng: number;
  latSpan: number;
  lngSpan: number;
  width: number;
  height: number;
  padding?: number;
  zoom?: number;
}

export interface CanvasPoint {
  x: number;
  y: number;
}

const EARTH_RADIUS_METERS = 6_371_000;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const COMPASS_8_CARDINALS = [
  'N',
  'NE',
  'E',
  'SE',
  'S',
  'SW',
  'W',
  'NW',
] as const;

/**
 * Returns true if coordinates represent a valid WGS-84 point (excluding CRREPA
 * sentinel values `(200, 200)` no-signal and `(0, 0)` pause).
 */
export function isValidGpsCoordinate(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return false;
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return false;
  }
  if (lat === 0 && lng === 0) {
    return false;
  }
  return true;
}

/**
 * Computes great-circle distance in meters between two WGS-84 coordinates
 * using the Haversine formula (`R = 6,371,000 m`).
 */
export function haversineDistanceMeters(a: GeoPoint, b: GeoPoint): number {
  if (
    !Number.isFinite(a.lat) ||
    !Number.isFinite(a.lng) ||
    !Number.isFinite(b.lat) ||
    !Number.isFinite(b.lng)
  ) {
    return 0;
  }
  if (a.lat === b.lat && a.lng === b.lng) {
    return 0;
  }

  const lat1 = a.lat * DEG_TO_RAD;
  const lat2 = b.lat * DEG_TO_RAD;
  const dLat = (b.lat - a.lat) * DEG_TO_RAD;
  const dLng = (b.lng - a.lng) * DEG_TO_RAD;

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  const clampedH = Math.min(1, Math.max(0, h));
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(clampedH));
}

/**
 * Sums great-circle segment lengths across an ordered sequence of valid GPS
 * coordinates (ignoring CRREPA pause/no-signal sentinel entries).
 */
export function totalPathDistanceMeters(points: readonly GeoPoint[]): number {
  let total = 0;
  let prev: GeoPoint | null = null;
  for (const pt of points) {
    if (!isValidGpsCoordinate(pt.lat, pt.lng)) {
      continue;
    }
    if (prev !== null) {
      total += haversineDistanceMeters(prev, pt);
    }
    prev = pt;
  }
  return total;
}

/**
 * Computes initial forward compass bearing (azimuth) from `from` to `to` in
 * degrees clockwise from True North (`[0, 360)`).
 */
export function compassBearingDegrees(from: GeoPoint, to: GeoPoint): number {
  if (
    !Number.isFinite(from.lat) ||
    !Number.isFinite(from.lng) ||
    !Number.isFinite(to.lat) ||
    !Number.isFinite(to.lng)
  ) {
    return 0;
  }
  if (from.lat === to.lat && from.lng === to.lng) {
    return 0;
  }

  const lat1 = from.lat * DEG_TO_RAD;
  const lat2 = to.lat * DEG_TO_RAD;
  const dLng = (to.lng - from.lng) * DEG_TO_RAD;

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  if (y === 0 && x === 0) {
    return 0;
  }

  const rawDeg = Math.atan2(y, x) * RAD_TO_DEG;
  return ((rawDeg % 360) + 360) % 360;
}

/** Maps a compass bearing in degrees to an 8-point cardinal label (`N`..`NW`). */
export function formatCompassCardinal(bearingDegrees: number): string {
  if (!Number.isFinite(bearingDegrees)) {
    return 'N';
  }
  const normalized = ((bearingDegrees % 360) + 360) % 360;
  const idx = Math.round(normalized / 45) % COMPASS_8_CARDINALS.length;
  return COMPASS_8_CARDINALS[idx] ?? 'N';
}

/** Formats a meter distance concisely (`48 m` or `3.42 km`). */
export function formatDistanceMeters(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) {
    return '0 m';
  }
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(2)} km`;
}

/** Formats pace in `mm:ss /km` from distance and elapsed duration. */
export function formatPaceMinPerKm(
  distanceMeters: number,
  durationSec: number,
): string {
  if (
    !Number.isFinite(distanceMeters) ||
    !Number.isFinite(durationSec) ||
    distanceMeters < 10 ||
    durationSec <= 0
  ) {
    return '--:-- /km';
  }
  const secPerKm = durationSec / (distanceMeters / 1000);
  const mins = Math.floor(secPerKm / 60);
  const secs = Math.round(secPerKm % 60);
  if (secs >= 60) {
    return `${mins + 1}:00 /km`;
  }
  return `${mins}:${String(secs).padStart(2, '0')} /km`;
}

/**
 * Computes a padded bounding box around valid GPS points so single-point and
 * short-radius maps still render cleanly with balanced lat/lng spans.
 */
export function computeGeoBounds(
  points: readonly GeoPoint[],
  minSpanDeg = 0.0025,
): GeoBounds {
  const valid = points.filter((p) => isValidGpsCoordinate(p.lat, p.lng));
  if (valid.length === 0) {
    return {
      minLat: -minSpanDeg / 2,
      maxLat: minSpanDeg / 2,
      minLng: -minSpanDeg / 2,
      maxLng: minSpanDeg / 2,
      centerLat: 0,
      centerLng: 0,
      latSpan: minSpanDeg,
      lngSpan: minSpanDeg,
    };
  }

  let minLat = valid[0]!.lat;
  let maxLat = valid[0]!.lat;
  let minLng = valid[0]!.lng;
  let maxLng = valid[0]!.lng;

  for (const pt of valid) {
    if (pt.lat < minLat) minLat = pt.lat;
    if (pt.lat > maxLat) maxLat = pt.lat;
    if (pt.lng < minLng) minLng = pt.lng;
    if (pt.lng > maxLng) maxLng = pt.lng;
  }

  const centerLat = (minLat + maxLat) / 2;
  const centerLng = (minLng + maxLng) / 2;
  const cosLat = Math.max(0.2, Math.cos(centerLat * DEG_TO_RAD));

  const rawLatSpan = maxLat - minLat;
  const rawLngSpan = maxLng - minLng;
  // Aspect-equalized span at centerLat with headroom
  const targetLatSpan = Math.max(
    rawLatSpan * 1.25,
    rawLngSpan * cosLat * 1.25,
    minSpanDeg,
  );
  const targetLngSpan = Math.max(
    rawLngSpan * 1.25,
    targetLatSpan / cosLat,
    minSpanDeg / cosLat,
  );

  return {
    minLat: centerLat - targetLatSpan / 2,
    maxLat: centerLat + targetLatSpan / 2,
    minLng: centerLng - targetLngSpan / 2,
    maxLng: centerLng + targetLngSpan / 2,
    centerLat,
    centerLng,
    latSpan: targetLatSpan,
    lngSpan: targetLngSpan,
  };
}

/**
 * Projects a WGS-84 coordinate onto a 2D map viewport using local tangent
 * (cos-corrected equirectangular) projection.
 */
export function projectLatLngToCanvas(
  point: GeoPoint,
  options: CanvasProjectionOptions,
): CanvasPoint {
  const padding = options.padding ?? 24;
  const zoom = Math.max(0.25, options.zoom ?? 1);
  const innerW = Math.max(1, options.width - padding * 2);
  const innerH = Math.max(1, options.height - padding * 2);
  const effLatSpan = Math.max(1e-6, options.latSpan / zoom);
  const effLngSpan = Math.max(1e-6, options.lngSpan / zoom);

  const normX = (point.lng - options.centerLng) / effLngSpan + 0.5;
  const normY = 0.5 - (point.lat - options.centerLat) / effLatSpan;

  return {
    x: padding + normX * innerW,
    y: padding + normY * innerH,
  };
}
