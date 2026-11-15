import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';

import { COLORS, RADII, SPACING, TYPOGRAPHY } from '../shared/theme/tokens.ts';
import {
  compassBearingDegrees,
  computeGeoBounds,
  formatCompassCardinal,
  formatDistanceMeters,
  formatPaceMinPerKm,
  haversineDistanceMeters,
  isValidGpsCoordinate,
  projectLatLngToCanvas,
  totalPathDistanceMeters,
} from './geoMath.ts';
import type { GeoPoint } from './geoMath.ts';
import { MapPinLegendAndStats } from './MapPinLegendAndStats.tsx';
import { MapRadarOverlay } from './MapRadarOverlay.tsx';
import { MapRouteAndPinsLayer } from './MapRouteAndPinsLayer.tsx';
import {
  buildBearingRows,
  buildGraticules,
  buildRadarSightlines,
  buildRouteGraphics,
  computeRouteElevationStats,
  computeScaleBar,
} from './types.ts';
import type { OfflineMapCanvasProps, OfflineMapPin } from './types.ts';

export {
  compassBearingDegrees,
  computeGeoBounds,
  formatCompassCardinal,
  formatDistanceMeters,
  formatPaceMinPerKm,
  haversineDistanceMeters,
  isValidGpsCoordinate,
  projectLatLngToCanvas,
  totalPathDistanceMeters,
};
export type {
  OfflineMapCanvasProps,
  OfflineMapMode,
  OfflineMapPin,
  OfflineMapPinRole,
  OfflineMapRoute,
  OfflineMapWaypoint,
} from './types.ts';

/** 100% offline vector canvas for Find-My compass radar and CRREPA GPS route playback. */
export function OfflineMapCanvas({
  mode = 'combined',
  title,
  pins = [],
  userLocation = null,
  routes = [],
  activeRouteId,
  height = 250,
  compact = false,
  emptyMessage = 'No offline coordinates or GPS routes recorded yet.',
  onPinPress,
}: OfflineMapCanvasProps): React.ReactElement {
  const [canvasWidth, setCanvasWidth] = useState<number>(320);
  const [zoom, setZoom] = useState<number>(1);
  const [panLat, setPanLat] = useState<number>(0);
  const [panLng, setPanLng] = useState<number>(0);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);

  const validPins = useMemo(
    () => pins.filter((p) => isValidGpsCoordinate(p.lat, p.lng)),
    [pins],
  );
  const hasValidUser = Boolean(
    userLocation && isValidGpsCoordinate(userLocation.lat, userLocation.lng),
  );
  const activeRoute = useMemo(() => {
    if (routes.length === 0) return null;
    if (activeRouteId) return routes.find((r) => r.id === activeRouteId) ?? routes[0]!;
    return routes[0]!;
  }, [routes, activeRouteId]);

  const allGeoPoints = useMemo(() => {
    const pts: GeoPoint[] = [];
    if (hasValidUser && userLocation) {
      pts.push({ lat: userLocation.lat, lng: userLocation.lng });
    }
    for (const pin of validPins) pts.push({ lat: pin.lat, lng: pin.lng });
    for (const route of routes) {
      for (const wp of route.waypoints) {
        if (isValidGpsCoordinate(wp.lat, wp.lng)) pts.push({ lat: wp.lat, lng: wp.lng });
      }
    }
    return pts;
  }, [hasValidUser, userLocation, validPins, routes]);

  const baseBounds = useMemo(
    () => computeGeoBounds(allGeoPoints, mode === 'radar' ? 0.0008 : 0.0025),
    [allGeoPoints, mode],
  );
  const viewCenterLat = baseBounds.centerLat + panLat;
  const viewCenterLng = baseBounds.centerLng + panLng;
  const effLatSpan = baseBounds.latSpan / zoom;
  const effLngSpan = baseBounds.lngSpan / zoom;

  const viewportRef = useRef({ width: canvasWidth, height, effLatSpan, effLngSpan });
  viewportRef.current = { width: canvasWidth, height, effLatSpan, effLngSpan };
  const panStartRef = useRef({ lat: 0, lng: 0 });
  const currentPanRef = useRef({ lat: panLat, lng: panLng });
  currentPanRef.current = { lat: panLat, lng: panLng };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, g) =>
          Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4,
        onPanResponderGrant: () => {
          panStartRef.current = { ...currentPanRef.current };
        },
        onPanResponderMove: (_, g) => {
          const vp = viewportRef.current;
          const usableW = Math.max(40, vp.width - 48);
          const usableH = Math.max(40, vp.height - 48);
          setPanLat(panStartRef.current.lat + (g.dy / usableH) * vp.effLatSpan);
          setPanLng(panStartRef.current.lng - (g.dx / usableW) * vp.effLngSpan);
        },
      }),
    [],
  );

  const padding = compact ? 18 : 26;
  const projectionOpts = useMemo(
    () => ({
      centerLat: viewCenterLat,
      centerLng: viewCenterLng,
      latSpan: baseBounds.latSpan,
      lngSpan: baseBounds.lngSpan,
      width: canvasWidth,
      height,
      padding,
      zoom,
    }),
    [viewCenterLat, viewCenterLng, baseBounds.latSpan, baseBounds.lngSpan, canvasWidth, height, padding, zoom],
  );

  const radarAnchor: GeoPoint | null = useMemo(() => {
    if (hasValidUser && userLocation) return { lat: userLocation.lat, lng: userLocation.lng };
    const anchorPin =
      validPins.find((p) => p.role === 'case' || p.role === 'watch') ?? validPins[0];
    return anchorPin ? { lat: anchorPin.lat, lng: anchorPin.lng } : null;
  }, [hasValidUser, userLocation, validPins]);

  const projectedAnchor = useMemo(
    () => (radarAnchor ? projectLatLngToCanvas(radarAnchor, projectionOpts) : null),
    [radarAnchor, projectionOpts],
  );
  const projectedPins = useMemo(
    () => validPins.map((pin) => ({ pin, pos: projectLatLngToCanvas(pin, projectionOpts) })),
    [validPins, projectionOpts],
  );
  const projectedUser = useMemo(
    () => (hasValidUser && userLocation ? projectLatLngToCanvas(userLocation, projectionOpts) : null),
    [hasValidUser, userLocation, projectionOpts],
  );
  const routeGraphics = useMemo(
    () => buildRouteGraphics(routes, activeRoute, projectionOpts),
    [routes, activeRoute, projectionOpts],
  );
  const radarSightlines = useMemo(
    () => buildRadarSightlines(mode, projectedAnchor, projectedPins, radarAnchor),
    [mode, projectedAnchor, projectedPins, radarAnchor],
  );
  const viewportMetersWidth = useMemo(
    () =>
      haversineDistanceMeters(
        { lat: viewCenterLat, lng: viewCenterLng - effLngSpan / 2 },
        { lat: viewCenterLat, lng: viewCenterLng + effLngSpan / 2 },
      ),
    [viewCenterLat, viewCenterLng, effLngSpan],
  );
  const scaleBar = useMemo(
    () => computeScaleBar(viewportMetersWidth, canvasWidth, padding),
    [viewportMetersWidth, canvasWidth, padding],
  );
  const graticules = useMemo(
    () => buildGraticules(effLatSpan, effLngSpan, viewCenterLat, viewCenterLng, projectionOpts),
    [effLatSpan, effLngSpan, viewCenterLat, viewCenterLng, projectionOpts],
  );
  const bearingRows = useMemo(
    () => buildBearingRows(radarAnchor, validPins, mode),
    [radarAnchor, validPins, mode],
  );
  const routeElevationStats = useMemo(
    () => computeRouteElevationStats(activeRoute),
    [activeRoute],
  );
  const selectedPin = useMemo(
    () => validPins.find((p) => p.id === selectedPinId) ?? validPins[0] ?? null,
    [validPins, selectedPinId],
  );

  const handleLayout = (event: LayoutChangeEvent): void => {
    const nextW = Math.round(event.nativeEvent.layout.width);
    if (nextW > 0 && nextW !== canvasWidth) setCanvasWidth(nextW);
  };
  const handleSelectPin = (pin: OfflineMapPin): void => {
    setSelectedPinId(pin.id);
    onPinPress?.(pin);
  };

  const hasContent = allGeoPoints.length > 0;
  return (
    <View style={styles.wrapper}>
      {title ? (
        <View style={styles.headerRow}>
          <Text style={TYPOGRAPHY.overline}>{title}</Text>
          <View style={styles.offlineTag}>
            <View style={styles.offlineDot} />
            <Text style={styles.offlineTagText}>100% OFFLINE VECTOR</Text>
          </View>
        </View>
      ) : null}

      <View
        style={[styles.canvas, { height }]}
        onLayout={handleLayout}
        {...panResponder.panHandlers}
      >
        <MapRouteAndPinsLayer
          hasContent={hasContent}
          emptyMessage={emptyMessage}
          routeSegments={routeGraphics.segments}
          activeWaypoints={routeGraphics.activeWaypoints}
          projectedUser={projectedUser}
          projectedPins={projectedPins}
          selectedPin={selectedPin}
          onSelectPin={handleSelectPin}
        />
        <MapRadarOverlay
          hasContent={hasContent}
          mode={mode}
          compact={compact}
          canvasWidth={canvasWidth}
          height={height}
          padding={padding}
          graticules={graticules}
          projectedAnchor={projectedAnchor}
          radarSightlines={radarSightlines}
          scaleBar={scaleBar}
          zoom={zoom}
          onZoomIn={() => setZoom((z) => Math.min(16, Number((z * 1.5).toFixed(2))))}
          onZoomOut={() => setZoom((z) => Math.max(0.4, Number((z / 1.5).toFixed(2))))}
          onResetView={() => {
            setZoom(1);
            setPanLat(0);
            setPanLng(0);
          }}
          onNudgePan={(dLatSign, dLngSign) => {
            setPanLat((p) => p + dLatSign * effLatSpan * 0.22);
            setPanLng((p) => p + dLngSign * effLngSpan * 0.22);
          }}
        />
      </View>

      <MapPinLegendAndStats
        compact={compact}
        bearingRows={bearingRows}
        selectedPin={selectedPin}
        radarAnchor={radarAnchor}
        activeRoute={activeRoute}
        routeElevationStats={routeElevationStats}
        onSelectPin={handleSelectPin}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: SPACING.sm },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
  },
  offlineTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    borderRadius: RADII.pill,
    backgroundColor: COLORS.emeraldDim,
    borderWidth: 1,
    borderColor: COLORS.emeraldBorder,
  },
  offlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.emerald },
  offlineTagText: {
    color: COLORS.emerald,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  canvas: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: RADII.md,
    backgroundColor: COLORS.surfaceWell,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
  },
});
