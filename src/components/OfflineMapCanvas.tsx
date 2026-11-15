/**
 * Thin re-export barrel preserving legacy `src/components/OfflineMapCanvas.tsx` imports.
 */
export {
  OfflineMapCanvas,
  compassBearingDegrees,
  computeGeoBounds,
  formatCompassCardinal,
  formatDistanceMeters,
  formatPaceMinPerKm,
  haversineDistanceMeters,
  isValidGpsCoordinate,
  projectLatLngToCanvas,
  totalPathDistanceMeters,
} from '../domains/map/OfflineMapCanvas.tsx';
export type {
  OfflineMapCanvasProps,
  OfflineMapMode,
  OfflineMapPin,
  OfflineMapPinRole,
  OfflineMapRoute,
  OfflineMapWaypoint,
} from '../domains/map/OfflineMapCanvas.tsx';
