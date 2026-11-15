import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CONNECTION_MODE } from '../../../services/bleManager.ts';
import type {
  BleManagerSnapshot,
  DiscoveredDevice,
  UltimaBleManager,
} from '../../../services/bleManager.ts';
import {
  ActionChip,
  ActionStatusLine,
  Card,
  Notice,
  OfflineBadge,
  PrimaryButton,
  ProgressBar,
  SectionHeader,
  StatPill,
} from '../../shared/theme/primitives.tsx';
import {
  COLORS,
  MONO_FONT,
  SHARED_LAYOUT_STYLES,
  SPACING,
  TYPOGRAPHY,
  batteryColor,
  hex16,
} from '../../shared/theme/tokens.ts';
import type { ActionRunner } from '../../shared/theme/tokens.ts';

export interface ScannerAndBannerSectionProps {
  snapshot: BleManagerSnapshot;
  manager: UltimaBleManager;
  actions: ActionRunner;
  connectedIds: ReadonlySet<string>;
}

function BatteryCell({
  label,
  level,
  charging,
}: {
  label: string;
  level: number;
  charging: boolean;
}): React.ReactElement {
  const tone = level <= 20 ? 'amber' : 'emerald';
  return (
    <View style={styles.batteryCell}>
      <View style={styles.batteryHeader}>
        <Text style={TYPOGRAPHY.overline}>{label}</Text>
        <Text style={[styles.batteryValue, { color: batteryColor(level) }]}>
          {level}%{charging ? ' ⚡' : ''}
        </Text>
      </View>
      <ProgressBar progress={level / 100} tone={tone} height={6} />
    </View>
  );
}

function platformLabel(platform: number | undefined): string {
  if (platform === undefined) return '—';
  return `0x${platform.toString(16).toUpperCase().padStart(2, '0')}`;
}

function Fact({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): React.ReactElement {
  return (
    <View style={styles.fact}>
      <Text style={TYPOGRAPHY.overline}>{label}</Text>
      <Text style={mono ? styles.factValueMono : styles.factValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function DeviceFacts({ device }: { device: DiscoveredDevice }): React.ReactElement {
  if (device.kind === 'earbuds') {
    const productName = device.productName ?? device.product?.name;
    const edrMac = device.edrMac ?? device.mac;
    return (
      <View style={styles.factGrid}>
        <Fact label="PID" value={hex16(device.pid)} />
        <Fact label="Product" value={productName ?? 'Unknown SKU'} />
        <Fact
          label="Chip"
          value={
            device.chip === 'BT'
              ? 'BT (Bluetrum)'
              : device.chip === 'JL'
                ? 'JL (Jieli)'
                : '—'
          }
        />
        <Fact label="EDR MAC" value={edrMac ?? '—'} mono />
        {device.license ? <Fact label="License" value={device.license} mono /> : null}
        {device.bid !== undefined ? <Fact label="BID" value={hex16(device.bid)} /> : null}
      </View>
    );
  }
  const crpFw = device.crpFirmware ?? device.firmwareType;
  const crpPlat = device.crpPlatform ?? device.platform;
  const crpChip = device.crpChipId ?? device.chipId;
  const crpMask = device.crpFunctionMask ?? device.functionMask;
  const watchMac = device.edrMac ?? device.mac;
  return (
    <View style={styles.factGrid}>
      <Fact label="CRREPA FW" value={crpFw ?? '—'} mono />
      <Fact label="Platform" value={platformLabel(crpPlat)} mono />
      <Fact label="Chip ID" value={crpChip !== undefined ? hex16(crpChip) : '—'} mono />
      <Fact
        label="Fn Mask"
        value={crpMask !== undefined ? `0x${crpMask.toString(16).toUpperCase()}` : '—'}
        mono
      />
      <Fact label="EDR MAC" value={watchMac ?? '—'} mono />
    </View>
  );
}

/** Renders connection mode switcher, simultaneous device status cards, and BLE advertisement scanner. */
export function ScannerAndBannerSection({
  snapshot,
  manager,
  actions,
  connectedIds,
}: ScannerAndBannerSectionProps): React.ReactElement {
  const { earbuds, watch } = snapshot;
  const isLive = snapshot.mode === CONNECTION_MODE.LIVE_BLE;

  return (
    <>
      <SectionHeader
        overline="Device Hub"
        title="Connection mode"
        subtitle="Simulator runs real protocol frames against a built-in virtual Ultima Link + ULTIMA Fit."
      />
      <Card>
        <View style={styles.modeRow}>
          <ActionChip
            label="Simulator"
            active={!isLive}
            tone="cyan"
            onPress={() => manager.setMode(CONNECTION_MODE.SIMULATOR)}
            style={SHARED_LAYOUT_STYLES.flexOne}
          />
          <ActionChip
            label="Live BLE"
            active={isLive}
            tone="indigo"
            onPress={() => manager.setMode(CONNECTION_MODE.LIVE_BLE)}
            style={SHARED_LAYOUT_STYLES.flexOne}
          />
        </View>
        {isLive && !snapshot.bleAvailable ? (
          <Notice text="react-native-ble-plx native module is unavailable in this build (e.g. Expo Go). Use a dev build, or switch to Simulator." />
        ) : null}
        {snapshot.lastError ? <Notice tone="rose" text={snapshot.lastError} /> : null}
      </Card>

      <SectionHeader
        style={SHARED_LAYOUT_STYLES.sectionGap}
        title="Simultaneous connections"
        subtitle="Earbuds and watch stay connected at the same time."
      />
      <Card tone={earbuds.connected ? 'cyan' : undefined}>
        <View style={styles.cardTop}>
          <View style={styles.cardTitleBlock}>
            <Text style={TYPOGRAPHY.overline}>Ultima Link</Text>
            <Text style={TYPOGRAPHY.cardTitle}>{earbuds.name}</Text>
            <Text style={TYPOGRAPHY.caption}>
              {earbuds.connected
                ? `Connected · ${earbuds.chip ?? '?'} · FW ${earbuds.firmwareVersion ?? '—'}`
                : earbuds.connecting
                  ? 'Connecting…'
                  : 'Not connected'}
            </Text>
          </View>
          {earbuds.connected ? (
            <ActionChip
              label="Disconnect"
              compact
              tone="rose"
              active
              onPress={() => actions.run('Disconnect earbuds', () => manager.disconnectEarbuds())}
            />
          ) : null}
        </View>
        {earbuds.connected ? (
          <View style={styles.batteryRow}>
            <BatteryCell label="Left" level={earbuds.battery.left} charging={earbuds.battery.leftCharging} />
            <BatteryCell label="Right" level={earbuds.battery.right} charging={earbuds.battery.rightCharging} />
            <BatteryCell label="Case" level={earbuds.battery.case} charging={earbuds.battery.caseCharging} />
          </View>
        ) : null}
      </Card>

      <Card tone={watch.connected ? 'indigo' : undefined} style={SHARED_LAYOUT_STYLES.cardGap}>
        <View style={styles.cardTop}>
          <View style={styles.cardTitleBlock}>
            <Text style={TYPOGRAPHY.overline}>ULTIMA Fit</Text>
            <Text style={TYPOGRAPHY.cardTitle}>{watch.name}</Text>
            <Text style={TYPOGRAPHY.caption}>
              {watch.connected
                ? `Connected · FW ${watch.firmwareType ?? '—'}${watch.firmwareVersion ? ` ${watch.firmwareVersion}` : ''}`
                : watch.connecting
                  ? 'Connecting…'
                  : 'Not connected'}
            </Text>
          </View>
          {watch.connected ? (
            <ActionChip
              label="Disconnect"
              compact
              tone="rose"
              active
              onPress={() => actions.run('Disconnect watch', () => manager.disconnectWatch())}
            />
          ) : null}
        </View>
        {watch.connected ? (
          <View style={styles.batteryRow}>
            <BatteryCell label="Watch" level={watch.batteryPercent} charging={false} />
            <StatPill label="Steps" value={String(watch.steps)} tone="indigo" />
          </View>
        ) : null}
      </Card>

      <SectionHeader
        style={SHARED_LAYOUT_STYLES.sectionGap}
        title="Scan"
        subtitle="Advertisements are decoded locally (PID, chip, EDR MAC, license / CRREPA FW)."
        right={
          <PrimaryButton
            label={snapshot.scanning ? 'Stop scan' : 'Scan'}
            tone={snapshot.scanning ? 'amber' : 'cyan'}
            compact
            onPress={() =>
              snapshot.scanning
                ? manager.stopScan()
                : actions.run('Scan', () => manager.startScan())
            }
          />
        }
      />
      <ActionStatusLine status={actions.status} />
      {snapshot.scanning ? <Notice tone="cyan" text="Scanning for Ultima devices…" /> : null}
      {snapshot.discovered.length === 0 && !snapshot.scanning ? (
        <Card>
          <Text style={TYPOGRAPHY.caption}>
            No devices discovered yet. Tap Scan to look for earbuds and watches.
          </Text>
        </Card>
      ) : null}
      <View style={styles.list}>
        {snapshot.discovered.map((device) => {
          const connected = connectedIds.has(device.id);
          return (
            <Card key={device.id} tone={connected ? 'emerald' : undefined} style={styles.deviceCard}>
              <View style={styles.cardTop}>
                <View style={styles.cardTitleBlock}>
                  <Text style={TYPOGRAPHY.cardTitle} numberOfLines={1}>
                    {device.name}
                  </Text>
                  <Text style={TYPOGRAPHY.caption}>
                    {device.kind === 'earbuds' ? 'Ultima Link earbuds' : 'ULTIMA Fit watch'} ·{' '}
                    {device.protocol.toUpperCase()} · {device.rssi} dBm
                    {device.isSimulated ? ' · simulated' : ''}
                  </Text>
                </View>
                {device.offlineVerified ? <OfflineBadge compact /> : null}
              </View>
              <DeviceFacts device={device} />
              {device.rawAdvHex.length > 0 ? (
                <Text style={styles.advHex} numberOfLines={2}>
                  ADV {device.rawAdvHex}
                </Text>
              ) : null}
              <View style={SHARED_LAYOUT_STYLES.rowButtons}>
                {connected ? (
                  <PrimaryButton
                    label="Disconnect"
                    tone="rose"
                    compact
                    onPress={() =>
                      actions.run('Disconnect', () =>
                        device.kind === 'earbuds'
                          ? manager.disconnectEarbuds()
                          : manager.disconnectWatch(),
                      )
                    }
                  />
                ) : (
                  <PrimaryButton
                    label="Connect"
                    tone={device.kind === 'earbuds' ? 'cyan' : 'indigo'}
                    compact
                    onPress={() =>
                      actions.run(`Connect ${device.name}`, () => manager.connectDevice(device.id))
                    }
                  />
                )}
              </View>
            </Card>
          );
        })}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  modeRow: { flexDirection: 'row', gap: SPACING.sm },
  list: { gap: SPACING.md },
  deviceCard: { gap: SPACING.md },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: SPACING.md,
  },
  cardTitleBlock: { flex: 1, gap: 2 },
  factGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.md },
  fact: { minWidth: 96, flexGrow: 1, flexBasis: '45%', gap: 2 },
  factValue: { fontSize: 13, fontWeight: '600', color: COLORS.textPrimary },
  factValueMono: { fontSize: 12, fontFamily: MONO_FONT, color: COLORS.textPrimary },
  advHex: { fontSize: 10, fontFamily: MONO_FONT, color: COLORS.textMuted },
  batteryRow: { flexDirection: 'row', gap: SPACING.md, marginTop: SPACING.md },
  batteryCell: { flex: 1, gap: 4 },
  batteryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  batteryValue: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
