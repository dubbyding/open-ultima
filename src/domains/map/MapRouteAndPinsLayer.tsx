import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { COLORS, SPACING } from '../shared/theme/tokens.ts';
import type { CanvasPoint } from './geoMath.ts';
import { getPinPalette } from './types.ts';
import type {
  ActiveWaypointPoint,
  OfflineMapPin,
  ProjectedPin,
  ProjectedSegment,
} from './types.ts';

export interface MapRouteAndPinsLayerProps {
  hasContent: boolean;
  emptyMessage: string;
  routeSegments: readonly ProjectedSegment[];
  activeWaypoints: readonly ActiveWaypointPoint[];
  projectedUser: CanvasPoint | null;
  projectedPins: readonly ProjectedPin[];
  selectedPin: OfflineMapPin | null;
  onSelectPin: (pin: OfflineMapPin) => void;
}

/** Renders projected GPS trajectory segments, start/finish markers, user dot, and device pins. */
export function MapRouteAndPinsLayer({
  hasContent,
  emptyMessage,
  routeSegments,
  activeWaypoints,
  projectedUser,
  projectedPins,
  selectedPin,
  onSelectPin,
}: MapRouteAndPinsLayerProps): React.ReactElement {
  return (
    <>
      {hasContent
        ? routeSegments.map((seg) => (
            <View
              key={seg.key}
              pointerEvents="none"
              style={[
                styles.routeSegment,
                {
                  left: seg.mx - seg.length / 2,
                  top: seg.my - 1.75,
                  width: seg.length + 1,
                  backgroundColor: seg.color,
                  transform: [{ rotate: `${seg.angleRad}rad` }],
                },
              ]}
            />
          ))
        : null}

      {hasContent && activeWaypoints.length > 0
        ? activeWaypoints.map((pt, idx, arr) => {
            const isStart = idx === 0;
            const isEnd = idx === arr.length - 1;
            if (!isStart && !isEnd && idx % 3 !== 0) return null;
            if (isStart || isEnd) {
              return (
                <View
                  key={`wp-marker-${idx}`}
                  pointerEvents="none"
                  style={[
                    styles.routeEndMarker,
                    {
                      left: pt.x - 9,
                      top: pt.y - 9,
                      backgroundColor: isStart ? COLORS.emerald : COLORS.rose,
                    },
                  ]}
                >
                  <Text style={styles.routeEndMarkerText}>
                    {isStart ? 'S' : 'F'}
                  </Text>
                </View>
              );
            }
            return (
              <View
                key={`wp-dot-${idx}`}
                pointerEvents="none"
                style={[styles.waypointDot, { left: pt.x - 2.5, top: pt.y - 2.5 }]}
              />
            );
          })
        : null}

      {hasContent && projectedUser ? (
        <View
          pointerEvents="none"
          style={[
            styles.userMarker,
            { left: projectedUser.x - 9, top: projectedUser.y - 9 },
          ]}
        >
          <View style={styles.userMarkerInner} />
        </View>
      ) : null}

      {hasContent
        ? projectedPins.map(({ pin, pos }) => {
            const pal = getPinPalette(pin.role, pin.color);
            const isSelected = selectedPin?.id === pin.id;
            const tag = pin.shortTag ?? pal.tag;
            return (
              <Pressable
                key={pin.id}
                onPress={() => onSelectPin(pin)}
                style={[
                  styles.pinMarker,
                  {
                    left: pos.x - 13,
                    top: pos.y - 13,
                    backgroundColor: pal.bg,
                    borderColor: isSelected ? COLORS.white : pal.border,
                    borderWidth: isSelected ? 2.5 : 1.5,
                  },
                ]}
              >
                <Text style={[styles.pinTag, { color: pal.text }]}>{tag}</Text>
              </Pressable>
            );
          })
        : null}

      {!hasContent ? (
        <View style={styles.emptyOverlay}>
          <Text style={styles.emptyText}>{emptyMessage}</Text>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  routeSegment: { position: 'absolute', height: 3.5, borderRadius: 2 },
  routeEndMarker: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  routeEndMarkerText: { color: COLORS.bg, fontSize: 10, fontWeight: '800' },
  waypointDot: {
    position: 'absolute',
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: COLORS.textPrimary,
    opacity: 0.8,
  },
  userMarker: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(129, 140, 248, 0.35)',
    borderWidth: 1.5,
    borderColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userMarkerInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.white,
  },
  pinMarker: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinTag: { fontSize: 11, fontWeight: '800' },
  emptyOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.xl,
  },
  emptyText: { color: COLORS.textMuted, fontSize: 12, textAlign: 'center' },
});
