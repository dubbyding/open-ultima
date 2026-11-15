import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  COLORS,
  MONO_FONT,
  RADII,
  SPACING,
  formatTimeAgo,
} from '../shared/theme/tokens.ts';
import {
  compassBearingDegrees,
  formatCompassCardinal,
  formatDistanceMeters,
  formatPaceMinPerKm,
  haversineDistanceMeters,
} from './geoMath.ts';
import type { GeoPoint } from './geoMath.ts';
import { formatDurationClock, getPinPalette } from './types.ts';
import type {
  BearingRow,
  OfflineMapPin,
  OfflineMapRoute,
  RouteElevationStats,
} from './types.ts';

export interface MapPinLegendAndStatsProps {
  compact: boolean;
  bearingRows: readonly BearingRow[];
  selectedPin: OfflineMapPin | null;
  radarAnchor: GeoPoint | null;
  activeRoute: OfflineMapRoute | null;
  routeElevationStats: RouteElevationStats | null;
  onSelectPin: (pin: OfflineMapPin) => void;
}

/** Renders pin distance/bearing cards, compact selected pin caption, and active route stats. */
export function MapPinLegendAndStats({
  compact,
  bearingRows,
  selectedPin,
  radarAnchor,
  activeRoute,
  routeElevationStats,
  onSelectPin,
}: MapPinLegendAndStatsProps): React.ReactElement {
  const routeStats = activeRoute
    ? [
        { label: 'DISTANCE', value: formatDistanceMeters(activeRoute.distanceMeters) },
        {
          label: 'PACE',
          value: formatPaceMinPerKm(activeRoute.distanceMeters, activeRoute.durationSec),
        },
        { label: 'DURATION', value: formatDurationClock(activeRoute.durationSec) },
        {
          label: 'ELEV GAIN',
          value: routeElevationStats ? `+${Math.round(routeElevationStats.gain)} m` : '—',
        },
        {
          label: 'AVG / MAX HR',
          value: activeRoute.avgHeartRateBpm
            ? `${activeRoute.avgHeartRateBpm}/${activeRoute.maxHeartRateBpm ?? activeRoute.avgHeartRateBpm} bpm`
            : '—',
        },
        { label: 'POINTS', value: String(activeRoute.waypoints.length) },
      ]
    : [];

  return (
    <>
      {!compact && bearingRows.length > 0 ? (
        <View style={styles.readoutGrid}>
          {bearingRows.map(({ pin, dist, deg, dir }) => {
            const pal = getPinPalette(pin.role, pin.color);
            return (
              <Pressable
                key={`bearing-${pin.id}`}
                onPress={() => onSelectPin(pin)}
                style={[
                  styles.bearingCard,
                  selectedPin?.id === pin.id && styles.bearingCardSelected,
                ]}
              >
                <View style={styles.bearingHeader}>
                  <View style={[styles.swatchDot, { backgroundColor: pal.bg }]} />
                  <Text style={styles.bearingTitle} numberOfLines={1}>
                    {pin.label}
                  </Text>
                </View>
                <Text style={styles.bearingMetric}>
                  {formatDistanceMeters(dist)} · {Math.round(deg)}° {dir}
                </Text>
                <Text style={styles.bearingCoords}>
                  {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}
                </Text>
                {pin.savedAt ? (
                  <Text style={styles.bearingNote} numberOfLines={1}>
                    {pin.note ? `${pin.note} · ` : ''}
                    {formatTimeAgo(pin.savedAt)}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {compact && selectedPin ? (
        <Text style={styles.compactCaption} numberOfLines={1}>
          📍 {selectedPin.label}: {selectedPin.lat.toFixed(5)},{' '}
          {selectedPin.lng.toFixed(5)}
          {radarAnchor
            ? ` · ${formatDistanceMeters(haversineDistanceMeters(radarAnchor, selectedPin))} ${formatCompassCardinal(compassBearingDegrees(radarAnchor, selectedPin))}`
            : ''}
        </Text>
      ) : null}

      {!compact && activeRoute ? (
        <View style={styles.routeStatsWrap}>
          {routeStats.map((stat) => (
            <View key={stat.label} style={styles.routeStatBox}>
              <Text style={styles.routeStatLabel}>{stat.label}</Text>
              <Text style={styles.routeStatVal}>{stat.value}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  readoutGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  bearingCard: {
    flexGrow: 1,
    minWidth: 138,
    padding: SPACING.sm,
    borderRadius: RADII.sm,
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 2,
  },
  bearingCardSelected: { borderColor: COLORS.cyan, backgroundColor: COLORS.cyanDim },
  bearingHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatchDot: { width: 8, height: 8, borderRadius: 4 },
  bearingTitle: {
    color: COLORS.textPrimary,
    fontSize: 12,
    fontWeight: '700',
    flexShrink: 1,
  },
  bearingMetric: {
    color: COLORS.cyan,
    fontFamily: MONO_FONT,
    fontSize: 11,
    fontWeight: '700',
  },
  bearingCoords: {
    color: COLORS.textSecondary,
    fontFamily: MONO_FONT,
    fontSize: 10,
  },
  bearingNote: { color: COLORS.textMuted, fontSize: 10 },
  compactCaption: {
    color: COLORS.textSecondary,
    fontFamily: MONO_FONT,
    fontSize: 11,
  },
  routeStatsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  routeStatBox: {
    flexGrow: 1,
    minWidth: 94,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs + 2,
    borderRadius: RADII.sm,
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  routeStatLabel: {
    color: COLORS.textMuted,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  routeStatVal: {
    color: COLORS.textPrimary,
    fontFamily: MONO_FONT,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
});
