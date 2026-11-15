import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { COLORS, MONO_FONT, RADII } from '../shared/theme/tokens.ts';
import type { CanvasPoint } from './geoMath.ts';
import type {
  Graticules,
  OfflineMapMode,
  ProjectedSegment,
  ScaleBarState,
} from './types.ts';

export interface MapRadarOverlayProps {
  hasContent: boolean;
  mode: OfflineMapMode;
  compact: boolean;
  canvasWidth: number;
  height: number;
  padding: number;
  graticules: Graticules;
  projectedAnchor: CanvasPoint | null;
  radarSightlines: readonly ProjectedSegment[];
  scaleBar: ScaleBarState;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  onNudgePan: (dLatSign: number, dLngSign: number) => void;
}

/** Renders coordinate gridlines, radar range rings, sightlines, compass, scale bar, and zoom/pan HUD. */
export function MapRadarOverlay({
  hasContent,
  mode,
  compact,
  canvasWidth,
  height,
  padding,
  graticules,
  projectedAnchor,
  radarSightlines,
  scaleBar,
  zoom,
  onZoomIn,
  onZoomOut,
  onResetView,
  onNudgePan,
}: MapRadarOverlayProps): React.ReactElement {
  const maxRadarDiam = Math.max(64, Math.min(canvasWidth, height) - padding * 2);

  return (
    <>
      {graticules.horiz.map((g) => (
        <View
          key={g.key}
          pointerEvents="none"
          style={[styles.gridHoriz, { top: g.y }]}
        >
          <Text style={styles.gridLabel}>{g.label}</Text>
        </View>
      ))}
      {graticules.vert.map((g) => (
        <View
          key={g.key}
          pointerEvents="none"
          style={[styles.gridVert, { left: g.x }]}
        >
          {!compact ? (
            <Text style={[styles.gridLabel, styles.gridLabelVert]}>{g.label}</Text>
          ) : null}
        </View>
      ))}

      {hasContent && mode !== 'route' && projectedAnchor
        ? [0.32, 0.64, 0.96].map((factor, idx) => {
            const diam = maxRadarDiam * factor;
            return (
              <View
                key={`ring-${idx}`}
                pointerEvents="none"
                style={[
                  styles.radarRing,
                  {
                    width: diam,
                    height: diam,
                    borderRadius: diam / 2,
                    left: projectedAnchor.x - diam / 2,
                    top: projectedAnchor.y - diam / 2,
                    borderColor:
                      idx === 0
                        ? 'rgba(34, 211, 238, 0.28)'
                        : 'rgba(148, 163, 184, 0.16)',
                  },
                ]}
              />
            );
          })
        : null}

      {hasContent
        ? radarSightlines.map((line) => (
            <View
              key={line.key}
              pointerEvents="none"
              style={[
                styles.sightLine,
                {
                  left: line.mx - line.length / 2,
                  top: line.my - 0.75,
                  width: line.length,
                  backgroundColor: line.color,
                  transform: [{ rotate: `${line.angleRad}rad` }],
                },
              ]}
            />
          ))
        : null}

      <View pointerEvents="none" style={styles.northBadge}>
        <Text style={styles.northBadgeText}>N ↑</Text>
      </View>

      <View pointerEvents="none" style={styles.scaleWrap}>
        <View style={[styles.scaleBar, { width: scaleBar.widthPx }]} />
        <Text style={styles.scaleText}>{scaleBar.label}</Text>
      </View>

      <View style={styles.controlsCol}>
        <View style={styles.zoomBox}>
          <Pressable style={styles.ctrlBtn} onPress={onZoomIn}>
            <Text style={styles.ctrlBtnText}>+</Text>
          </Pressable>
          <View style={styles.ctrlDivider} />
          <Pressable style={styles.ctrlBtn} onPress={onZoomOut}>
            <Text style={styles.ctrlBtnText}>−</Text>
          </Pressable>
          <View style={styles.ctrlDivider} />
          <Pressable style={styles.ctrlBtn} onPress={onResetView}>
            <Text style={styles.ctrlResetText}>{zoom.toFixed(1)}x</Text>
          </Pressable>
        </View>
        {!compact ? (
          <View style={styles.dpadRow}>
            <Pressable style={styles.panMiniBtn} onPress={() => onNudgePan(0, -1)}>
              <Text style={styles.panMiniText}>◀</Text>
            </Pressable>
            <Pressable style={styles.panMiniBtn} onPress={() => onNudgePan(1, 0)}>
              <Text style={styles.panMiniText}>▲</Text>
            </Pressable>
            <Pressable style={styles.panMiniBtn} onPress={() => onNudgePan(-1, 0)}>
              <Text style={styles.panMiniText}>▼</Text>
            </Pressable>
            <Pressable style={styles.panMiniBtn} onPress={() => onNudgePan(0, 1)}>
              <Text style={styles.panMiniText}>▶</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  gridHoriz: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(148, 163, 184, 0.12)',
  },
  gridVert: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(148, 163, 184, 0.12)',
  },
  gridLabel: {
    position: 'absolute',
    left: 4,
    top: 2,
    fontFamily: MONO_FONT,
    fontSize: 9,
    color: 'rgba(148, 163, 184, 0.52)',
  },
  gridLabelVert: { left: 3, top: 24 },
  radarRing: { position: 'absolute', borderWidth: 1, borderStyle: 'dashed' },
  sightLine: { position: 'absolute', height: 1.5, opacity: 0.55 },
  northBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: RADII.sm,
    backgroundColor: 'rgba(10, 13, 20, 0.85)',
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
  },
  northBadgeText: {
    color: COLORS.cyan,
    fontFamily: MONO_FONT,
    fontSize: 10,
    fontWeight: '700',
  },
  scaleWrap: { position: 'absolute', bottom: 8, left: 8, gap: 2 },
  scaleBar: {
    height: 4,
    borderBottomWidth: 1.5,
    borderLeftWidth: 1.5,
    borderRightWidth: 1.5,
    borderColor: COLORS.textPrimary,
  },
  scaleText: { color: COLORS.textSecondary, fontFamily: MONO_FONT, fontSize: 9 },
  controlsCol: {
    position: 'absolute',
    top: 8,
    right: 8,
    alignItems: 'flex-end',
    gap: 6,
  },
  zoomBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: RADII.sm,
    backgroundColor: 'rgba(10, 13, 20, 0.88)',
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    overflow: 'hidden',
  },
  ctrlBtn: { paddingHorizontal: 9, paddingVertical: 5 },
  ctrlBtnText: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '700' },
  ctrlResetText: {
    color: COLORS.cyan,
    fontFamily: MONO_FONT,
    fontSize: 10,
    fontWeight: '700',
  },
  ctrlDivider: { width: 1, height: 18, backgroundColor: COLORS.border },
  dpadRow: { flexDirection: 'row', gap: 3 },
  panMiniBtn: {
    width: 24,
    height: 22,
    borderRadius: 5,
    backgroundColor: 'rgba(10, 13, 20, 0.85)',
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panMiniText: { color: COLORS.textSecondary, fontSize: 9 },
});
