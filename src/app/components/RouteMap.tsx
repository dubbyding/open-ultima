import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import * as Location from 'expo-location';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import type { Region } from 'react-native-maps';
import { Icon, Text } from 'react-native-paper';

import { M3 } from '../../domains/shared/theme/tokens.ts';
import type { GpsWaypoint } from '../../domains/storage/types.ts';

/**
 * Map provider, chosen in .env (see app.config.js):
 *   EXPO_PUBLIC_MAP_PROVIDER=osm    → OpenStreetMap via MapLibre (free, no key) — the default
 *   EXPO_PUBLIC_MAP_PROVIDER=google → Google Maps on Android (needs EXPO_PUBLIC_GOOGLE_MAPS_API_KEY),
 *                                     Apple Maps on iPhone (free, no key)
 */
export const MAP_PROVIDER: 'osm' | 'google' = process.env.EXPO_PUBLIC_MAP_PROVIDER === 'google' ? 'google' : 'osm';
const hasMapsKey = Platform.OS !== 'android' || Boolean(process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY);

/** Google's "night" style trimmed to the essentials, matching the app's dark theme. */
const DARK_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#1d2425' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8a9a9c' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1d2425' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2f3a3c' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3d4b4d' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e1a24' }] },
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#1f2e26' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];

function regionFor(points: readonly GpsWaypoint[]): Region | undefined {
  if (points.length === 0) return undefined;
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng);
  }
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(0.004, (maxLat - minLat) * 1.4),
    longitudeDelta: Math.max(0.004, (maxLng - minLng) * 1.4),
  };
}

export function RouteMap({
  points,
  live = false,
  height = 260,
}: {
  points: readonly GpsWaypoint[];
  /** Follow the current position instead of framing the whole route. */
  live?: boolean;
  height?: number;
}): React.ReactElement {
  if (MAP_PROVIDER === 'osm') {
    const Osm = osmMap();
    if (!Osm) return <MapMissing height={height} text="The map isn’t in this build of the app. Rebuild and reinstall it." />;
    return <Osm points={points} live={live} height={height} />;
  }
  return <GoogleRouteMap points={points} live={live} height={height} />;
}

type OsmMap = typeof import('./OsmRouteMap.tsx').OsmRouteMap;
let osmModule: OsmMap | null | undefined;
/** MapLibre is loaded on first use so a build without it still starts. */
function osmMap(): OsmMap | null {
  if (osmModule === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      osmModule = (require('./OsmRouteMap.tsx') as { OsmRouteMap: OsmMap }).OsmRouteMap;
    } catch {
      osmModule = null;
    }
  }
  return osmModule;
}

function MapMissing({ height, text }: { height: number; text: string }): React.ReactElement {
  return (
    <View style={[styles.placeholder, { height }]}>
      <Icon source="map-outline" size={32} color={M3.onSurfaceVariant} />
      <Text variant="bodyMedium" style={styles.placeholderText}>
        {text}
      </Text>
    </View>
  );
}

function GoogleRouteMap({ points, live, height }: { points: readonly GpsWaypoint[]; live: boolean; height: number }): React.ReactElement {
  const ref = React.useRef<MapView>(null);
  const coords = React.useMemo(() => points.map((p) => ({ latitude: p.lat, longitude: p.lng })), [points]);
  const last = coords[coords.length - 1];

  React.useEffect(() => {
    if (!ref.current || coords.length === 0) return;
    if (live && last) ref.current.animateCamera({ center: last, zoom: 17 }, { duration: 500 });
    else if (!live && coords.length > 1) {
      ref.current.fitToCoordinates(coords, { edgePadding: { top: 40, right: 40, bottom: 40, left: 40 }, animated: false });
    }
  }, [coords, last, live]);

  // Before the first fix, start near the phone's last known position instead of the whole world.
  React.useEffect(() => {
    if (!live || coords.length > 0) return;
    let cancelled = false;
    void Location.getLastKnownPositionAsync().then((pos) => {
      if (!cancelled && pos && ref.current) {
        ref.current.animateCamera({ center: { latitude: pos.coords.latitude, longitude: pos.coords.longitude }, zoom: 15 }, { duration: 0 });
      }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [live, coords.length]);

  if (!hasMapsKey) {
    return (
      <View style={[styles.placeholder, { height }]}>
        <Icon source="map-outline" size={32} color={M3.onSurfaceVariant} />
        <Text variant="bodyMedium" style={styles.placeholderText}>
          Set EXPO_PUBLIC_GOOGLE_MAPS_API_KEY in .env and rebuild, or use EXPO_PUBLIC_MAP_PROVIDER=osm.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, { height }]}>
      <MapView
        ref={ref}
        style={StyleSheet.absoluteFill}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        customMapStyle={DARK_STYLE}
        userInterfaceStyle="dark"
        initialRegion={regionFor(points)}
        showsUserLocation={live}
        showsMyLocationButton={false}
        toolbarEnabled={false}
        pitchEnabled={false}
      >
        {coords.length > 1 ? <Polyline coordinates={coords} strokeColor={M3.primary} strokeWidth={5} lineJoin="round" lineCap="round" /> : null}
        {!live && coords.length > 0 ? <Marker coordinate={coords[0]!} pinColor="green" title="Start" /> : null}
        {!live && last && coords.length > 1 ? <Marker coordinate={last} pinColor="red" title="Finish" /> : null}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 20, overflow: 'hidden', backgroundColor: M3.surfaceContainer },
  placeholder: {
    borderRadius: 20, backgroundColor: M3.surfaceContainer, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24,
  },
  placeholderText: { color: M3.onSurfaceVariant, textAlign: 'center' },
});
