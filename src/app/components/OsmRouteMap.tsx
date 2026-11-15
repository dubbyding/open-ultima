import React from 'react';
import { StyleSheet, View } from 'react-native';
import * as Location from 'expo-location';
import { Camera, CircleLayer, LineLayer, MapView, ShapeSource } from '@maplibre/maplibre-react-native';

import { M3 } from '../../domains/shared/theme/tokens.ts';
import type { GpsWaypoint } from '../../domains/storage/types.ts';

/**
 * OpenStreetMap raster tiles drawn by MapLibre (open source, no key).
 * Override the tile server with EXPO_PUBLIC_OSM_TILE_URL ({z}/{x}/{y} template).
 */
const TILE_URL = process.env.EXPO_PUBLIC_OSM_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

const STYLE = {
  version: 8,
  sources: {
    osm: { type: 'raster', tiles: [TILE_URL], tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap contributors' },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#1d2425' } },
    // Dim the light OSM style so it sits in the app's dark theme.
    { id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-brightness-max': 0.72, 'raster-saturation': -0.35, 'raster-contrast': 0.05 } },
  ],
};

export function OsmRouteMap({ points, live, height }: { points: readonly GpsWaypoint[]; live: boolean; height: number }): React.ReactElement {
  const coords = React.useMemo(() => points.map((p) => [p.lng, p.lat] as [number, number]), [points]);
  const [lastKnown, setLastKnown] = React.useState<[number, number] | null>(null);
  React.useEffect(() => {
    if (!live || coords.length > 0) return;
    void Location.getLastKnownPositionAsync().then((p) => p && setLastKnown([p.coords.longitude, p.coords.latitude])).catch(() => undefined);
  }, [live, coords.length]);
  const last = coords[coords.length - 1];

  const line = React.useMemo<GeoJSON.Feature>(
    () => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords.length > 1 ? coords : [] } }),
    [coords],
  );
  const ends = React.useMemo<GeoJSON.FeatureCollection>(() => {
    const features: GeoJSON.Feature[] = [];
    if (coords.length > 0 && !live) features.push({ type: 'Feature', properties: { kind: 'start' }, geometry: { type: 'Point', coordinates: coords[0]! } });
    if (last) features.push({ type: 'Feature', properties: { kind: live ? 'me' : 'end' }, geometry: { type: 'Point', coordinates: last } });
    return { type: 'FeatureCollection', features };
  }, [coords, last, live]);

  const bounds = React.useMemo(() => {
    if (coords.length < 2) return undefined;
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const [lng, lat] of coords) { w = Math.min(w, lng); e = Math.max(e, lng); s = Math.min(s, lat); n = Math.max(n, lat); }
    return { ne: [e, n] as [number, number], sw: [w, s] as [number, number] };
  }, [coords]);

  return (
    <View style={[styles.wrap, { height }]}>
      <MapView style={StyleSheet.absoluteFill} mapStyle={STYLE} logoEnabled={false} attributionEnabled attributionPosition={{ bottom: 6, right: 8 }} compassEnabled={false} pitchEnabled={false}>
        {live || !bounds ? (
          <Camera centerCoordinate={last ?? lastKnown ?? [0, 20]} zoomLevel={last ? 16 : lastKnown ? 15 : 1} animationDuration={500} animationMode="easeTo" />
        ) : (
          <Camera bounds={bounds} padding={{ paddingTop: 40, paddingBottom: 40, paddingLeft: 40, paddingRight: 40 }} animationDuration={0} />
        )}
        <ShapeSource id="route" shape={line}>
          <LineLayer id="route-line" style={{ lineColor: M3.primary, lineWidth: 5, lineCap: 'round', lineJoin: 'round' }} />
        </ShapeSource>
        <ShapeSource id="ends" shape={ends}>
          <CircleLayer
            id="ends-dot"
            style={{
              circleRadius: ['match', ['get', 'kind'], 'me', 8, 7],
              circleColor: ['match', ['get', 'kind'], 'start', '#4CAF50', 'end', '#EF5350', M3.primary],
              circleStrokeColor: '#ffffff',
              circleStrokeWidth: 2,
            }}
          />
        </ShapeSource>
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 20, overflow: 'hidden', backgroundColor: M3.surfaceContainer },
});
