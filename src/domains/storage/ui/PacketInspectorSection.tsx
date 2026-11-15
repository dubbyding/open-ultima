import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { PACKET_DIRECTION } from '../../../services/bleManager.ts';
import type {
  BleManagerSnapshot,
  PacketLogEntry,
  PacketProtocol,
  UltimaBleManager,
} from '../../../services/bleManager.ts';
import {
  ActionChip,
  ActionStatusLine,
  Card,
  PrimaryButton,
  SectionHeader,
  StatPill,
} from '../../shared/theme/primitives.tsx';
import {
  COLORS,
  MONO_FONT,
  RADII,
  SHARED_LAYOUT_STYLES,
  SPACING,
  TYPOGRAPHY,
  getTonePalette,
  hex8,
} from '../../shared/theme/tokens.ts';
import type { AccentTone, ActionRunner } from '../../shared/theme/tokens.ts';

export interface PacketInspectorSectionProps {
  snapshot: BleManagerSnapshot;
  manager: UltimaBleManager;
  actions: ActionRunner;
}

type TargetFilter = 'all' | 'TX' | 'RX';

const SAMPLE_EARBUDS_HEX = 'AA00010700';
const SAMPLE_WATCH_HEX = 'FE EA 10 06 00 61';

function protocolTone(protocol: PacketProtocol): AccentTone {
  switch (protocol) {
    case 'bluetrum':
      return 'cyan';
    case 'jieli':
      return 'emerald';
    case 'crrepa':
      return 'indigo';
    case 'adv':
    default:
      return 'amber';
  }
}

function formatTimeMs(epochMs: number): string {
  const dt = new Date(epochMs);
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  const ss = String(dt.getSeconds()).padStart(2, '0');
  const ms = String(dt.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

/** Renders live TX/RX hex packet stream, directional filter, and raw hex frame injector. */
export function PacketInspectorSection({
  snapshot,
  manager,
  actions,
}: PacketInspectorSectionProps): React.ReactElement {
  const [directionFilter, setDirectionFilter] = React.useState<TargetFilter>('all');
  const [rawTarget, setRawTarget] = React.useState<'earbuds' | 'watch'>('earbuds');
  const [rawHexInput, setRawHexInput] = React.useState<string>(SAMPLE_EARBUDS_HEX);

  const filteredLogs = React.useMemo(() => {
    const list =
      directionFilter === 'all'
        ? snapshot.packetLogs
        : snapshot.packetLogs.filter((p) => p.direction === directionFilter);
    return [...list].reverse();
  }, [snapshot.packetLogs, directionFilter]);

  const txCount = snapshot.packetLogs.filter((p) => p.direction === PACKET_DIRECTION.TX).length;
  const rxCount = snapshot.packetLogs.filter((p) => p.direction === PACKET_DIRECTION.RX).length;

  const renderPacketRow = (entry: PacketLogEntry): React.ReactElement => {
    const isTx = entry.direction === PACKET_DIRECTION.TX;
    const dirPalette = getTonePalette(isTx ? 'cyan' : 'emerald');
    const protoPalette = getTonePalette(protocolTone(entry.protocol));

    return (
      <View key={entry.id} style={styles.packetRow}>
        <View style={styles.packetHeader}>
          <View style={styles.packetBadges}>
            <View
              style={[
                styles.badge,
                { backgroundColor: dirPalette.bg, borderColor: dirPalette.border },
              ]}
            >
              <Text style={[styles.badgeText, { color: dirPalette.fg }]}>
                [{entry.direction}]
              </Text>
            </View>
            <View
              style={[
                styles.badge,
                { backgroundColor: protoPalette.bg, borderColor: protoPalette.border },
              ]}
            >
              <Text style={[styles.badgeText, { color: protoPalette.fg }]}>
                {entry.protocol.toUpperCase()}
              </Text>
            </View>
            <Text style={styles.byteLengthText}>
              {entry.length ?? entry.byteLength} B
            </Text>
            {entry.cmd !== undefined ? (
              <Text style={styles.byteLengthText}>CMD {hex8(entry.cmd)}</Text>
            ) : null}
          </View>
          <Text style={styles.timestampText}>{formatTimeMs(entry.timestamp)}</Text>
        </View>
        <Text style={TYPOGRAPHY.cardTitle}>
          {entry.label || entry.summary}{' '}
          <Text style={TYPOGRAPHY.caption}>
            ({entry.deviceName || entry.target})
          </Text>
        </Text>
        <Text selectable style={styles.hexDump}>
          {entry.hex}
        </Text>
      </View>
    );
  };

  return (
    <>
      <SectionHeader
        overline="Protocol Diagnostics"
        title="Live TX / RX Hex Packet Inspector"
        subtitle="Inspect Bluetrum ABMate, Jieli RCSP, CRREPA 0xFEEA, and BLE ADV frames in real time"
        right={
          <PrimaryButton
            label="Clear Logs"
            tone="rose"
            compact
            disabled={snapshot.packetLogs.length === 0}
            onPress={() => manager.clearPacketLogs()}
          />
        }
      />

      <ActionStatusLine status={actions.status} />

      <Card>
        <View style={SHARED_LAYOUT_STYLES.statGrid}>
          <StatPill label="Total Frames" value={String(snapshot.packetLogs.length)} tone="neutral" />
          <StatPill label="TX Frames" value={String(txCount)} tone="cyan" />
          <StatPill label="RX Frames" value={String(rxCount)} tone="emerald" />
        </View>

        <View style={SHARED_LAYOUT_STYLES.divider} />
        <Text style={TYPOGRAPHY.overline}>Raw Hex Frame Injector</Text>
        <View style={SHARED_LAYOUT_STYLES.chipRow}>
          <ActionChip
            label="Target: Earbuds"
            active={rawTarget === 'earbuds'}
            tone="cyan"
            onPress={() => {
              setRawTarget('earbuds');
              setRawHexInput(SAMPLE_EARBUDS_HEX);
            }}
            style={SHARED_LAYOUT_STYLES.flexOne}
          />
          <ActionChip
            label="Target: Watch"
            active={rawTarget === 'watch'}
            tone="indigo"
            onPress={() => {
              setRawTarget('watch');
              setRawHexInput(SAMPLE_WATCH_HEX);
            }}
            style={SHARED_LAYOUT_STYLES.flexOne}
          />
        </View>
        <View style={[SHARED_LAYOUT_STYLES.inputRow, styles.topGap]}>
          <TextInput
            value={rawHexInput}
            onChangeText={setRawHexInput}
            placeholder="Hex bytes (e.g. FE EA 10 06 00 61)"
            placeholderTextColor={COLORS.textMuted}
            autoCapitalize="characters"
            style={[SHARED_LAYOUT_STYLES.textInput, styles.monoInput]}
          />
          <PrimaryButton
            label="Send Hex"
            tone="cyan"
            compact
            onPress={() =>
              actions.run(`Raw Hex TX -> ${rawTarget}`, () =>
                manager.sendRawHex(rawTarget, rawHexInput),
              )
            }
          />
        </View>

        <View style={SHARED_LAYOUT_STYLES.divider} />
        <View style={styles.filterRow}>
          <Text style={TYPOGRAPHY.overline}>Frame Log ({filteredLogs.length} shown)</Text>
          <View style={styles.filterChips}>
            {(['all', 'TX', 'RX'] as const).map((f) => (
              <ActionChip
                key={f}
                label={f === 'all' ? 'All' : `[${f}]`}
                compact
                active={directionFilter === f}
                tone={f === 'TX' ? 'cyan' : f === 'RX' ? 'emerald' : 'neutral'}
                onPress={() => setDirectionFilter(f)}
              />
            ))}
          </View>
        </View>

        {filteredLogs.length === 0 ? (
          <Text style={TYPOGRAPHY.caption}>
            No packets captured yet. Scan or connect a device in the Hub tab to watch live binary
            frames.
          </Text>
        ) : (
          <View style={styles.packetList}>{filteredLogs.slice(0, 60).map(renderPacketRow)}</View>
        )}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  topGap: { marginTop: SPACING.sm },
  monoInput: { fontFamily: MONO_FONT },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
  },
  filterChips: { flexDirection: 'row', gap: SPACING.xs },
  packetList: { gap: SPACING.sm, marginTop: SPACING.sm },
  packetRow: {
    padding: SPACING.md,
    borderRadius: RADII.md,
    backgroundColor: COLORS.surfaceWell,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 4,
  },
  packetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
  },
  packetBadges: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: RADII.sm, borderWidth: 1 },
  badgeText: { fontSize: 10, fontWeight: '700', fontFamily: MONO_FONT },
  byteLengthText: { fontSize: 10, fontFamily: MONO_FONT, color: COLORS.textSecondary },
  timestampText: { fontSize: 10, fontFamily: MONO_FONT, color: COLORS.textMuted },
  hexDump: { fontSize: 11, fontFamily: MONO_FONT, color: COLORS.cyan, lineHeight: 16 },
});
