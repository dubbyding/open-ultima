import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type {
  BleManagerSnapshot,
  UltimaBleManager,
} from '../../../services/bleManager.ts';
import type {
  OfflineAppState,
  OfflineStore,
  PairedDeviceRecord,
} from '../../../storage/offlineStore.ts';
import { OfflineMapCanvas } from '../../map/OfflineMapCanvas.tsx';
import type { OfflineMapPin } from '../../map/types.ts';
import {
  Card,
  OfflineBadge,
  PrimaryButton,
  SectionHeader,
} from '../../shared/theme/primitives.tsx';
import {
  COLORS,
  MONO_FONT,
  SHARED_LAYOUT_STYLES,
  SPACING,
  TYPOGRAPHY,
  formatTimeAgo,
  hex16,
} from '../../shared/theme/tokens.ts';
import type { ActionRunner } from '../../shared/theme/tokens.ts';

export interface PairedAndMapSectionProps {
  snapshot: BleManagerSnapshot;
  manager: UltimaBleManager;
  store: OfflineStore;
  storeState: OfflineAppState;
  actions: ActionRunner;
  connectedIds: ReadonlySet<string>;
  onStoreChanged: () => void;
}

/** Builds combined hub radar pins including Left/Right earbuds, Case (`hub-case-pin`), Watch, and paired history. */
export function buildHubMapPins(
  snapshot: BleManagerSnapshot,
  pairedDevices: readonly PairedDeviceRecord[],
): OfflineMapPin[] {
  return [
    ...(snapshot.earbuds.sideLocations.left
      ? [
          {
            id: 'hub-left-bud',
            label: `${snapshot.earbuds.name} Left`,
            shortTag: 'L',
            lat: snapshot.earbuds.sideLocations.left.lat,
            lng: snapshot.earbuds.sideLocations.left.lng,
            role: 'left_earbud' as const,
            note: snapshot.earbuds.sideLocations.left.note,
            savedAt: snapshot.earbuds.sideLocations.left.savedAt,
          },
        ]
      : []),
    ...(snapshot.earbuds.sideLocations.right
      ? [
          {
            id: 'hub-right-bud',
            label: `${snapshot.earbuds.name} Right`,
            shortTag: 'R',
            lat: snapshot.earbuds.sideLocations.right.lat,
            lng: snapshot.earbuds.sideLocations.right.lng,
            role: 'right_earbud' as const,
            note: snapshot.earbuds.sideLocations.right.note,
            savedAt: snapshot.earbuds.sideLocations.right.savedAt,
          },
        ]
      : []),
    ...(snapshot.earbuds.sideLocations.casePin
      ? [
          {
            id: 'hub-case-pin',
            label: `${snapshot.earbuds.name} Case`,
            shortTag: 'C',
            lat: snapshot.earbuds.sideLocations.casePin.lat,
            lng: snapshot.earbuds.sideLocations.casePin.lng,
            role: 'case' as const,
            note: snapshot.earbuds.sideLocations.casePin.note,
            savedAt: snapshot.earbuds.sideLocations.casePin.savedAt,
          },
        ]
      : []),
    ...(snapshot.watch.lastKnownLocation
      ? [
          {
            id: 'hub-live-watch',
            label: snapshot.watch.name,
            shortTag: 'W',
            lat: snapshot.watch.lastKnownLocation.lat,
            lng: snapshot.watch.lastKnownLocation.lng,
            role: 'watch' as const,
            note: snapshot.watch.lastKnownLocation.note,
            savedAt: snapshot.watch.lastKnownLocation.savedAt,
          },
        ]
      : []),
    ...pairedDevices
      .filter(
        (d) =>
          Boolean(d.lastKnownLocation) &&
          d.id !== snapshot.earbuds.deviceId &&
          d.id !== snapshot.watch.deviceId &&
          !(
            snapshot.earbuds.sideLocations.casePin &&
            d.lastKnownLocation!.savedAt ===
              snapshot.earbuds.sideLocations.casePin.savedAt
          ) &&
          !(
            snapshot.watch.lastKnownLocation &&
            d.lastKnownLocation!.savedAt ===
              snapshot.watch.lastKnownLocation.savedAt
          ),
      )
      .map(
        (d): OfflineMapPin => ({
          id: `hub-paired-${d.id}`,
          label: d.name,
          shortTag: d.kind === 'watch' ? 'W' : 'H',
          lat: d.lastKnownLocation!.lat,
          lng: d.lastKnownLocation!.lng,
          role: d.kind === 'watch' ? 'watch' : 'history',
          note: d.lastKnownLocation!.note,
          savedAt: d.lastKnownLocation!.savedAt,
        }),
      ),
  ];
}

/** Renders the offline last-seen radar map and saved paired device cards with pin/forget controls. */
export function PairedAndMapSection({
  snapshot,
  manager,
  store,
  storeState,
  actions,
  connectedIds,
  onStoreChanged,
}: PairedAndMapSectionProps): React.ReactElement {
  const pairedDevices = storeState.pairedDevices;
  const hubPins = React.useMemo(
    () => buildHubMapPins(snapshot, pairedDevices),
    [snapshot, pairedDevices],
  );

  return (
    <>
      <SectionHeader
        style={SHARED_LAYOUT_STYLES.sectionGap}
        title="Saved paired devices"
        subtitle={`${pairedDevices.length} stored on this phone only`}
      />
      <Card style={SHARED_LAYOUT_STYLES.cardGap}>
        <OfflineMapCanvas
          mode="combined"
          compact
          height={180}
          title="Last-Seen Offline Device Radar"
          routes={storeState.gpsRoutes.slice(0, 1)}
          pins={hubPins}
          emptyMessage="Pin your earbuds or watch location or sync a GPS route to view all offline pins here."
        />
      </Card>
      {pairedDevices.length === 0 ? (
        <Card>
          <Text style={TYPOGRAPHY.caption}>
            Connect a device to save it here with its last-seen location pin.
          </Text>
        </Card>
      ) : null}
      <View style={styles.list}>
        {pairedDevices.map((device) => {
          const loc = device.lastKnownLocation;
          const connected = connectedIds.has(device.id);
          return (
            <Card key={device.id} style={styles.deviceCard}>
              <View style={styles.cardTop}>
                <View style={styles.cardTitleBlock}>
                  <Text style={TYPOGRAPHY.cardTitle} numberOfLines={1}>
                    {device.name}
                  </Text>
                  <Text style={TYPOGRAPHY.caption}>
                    {device.kind === 'earbuds'
                      ? `Earbuds${device.chip ? ` · ${device.chip}` : ''}${
                          device.pid !== undefined ? ` · PID ${hex16(device.pid)}` : ''
                        }`
                      : 'Watch'}
                    {device.mac ? ` · ${device.mac}` : ''}
                  </Text>
                  <Text style={TYPOGRAPHY.caption}>
                    Last connected {formatTimeAgo(device.lastConnectedAt)}
                  </Text>
                </View>
                {connected ? <OfflineBadge label="Connected" compact /> : null}
              </View>
              <View style={styles.pinBox}>
                <Text style={TYPOGRAPHY.overline}>Find-My location pin (offline)</Text>
                {loc ? (
                  <>
                    <Text style={styles.pinCoords}>
                      📍 {loc.lat.toFixed(5)}, {loc.lng.toFixed(5)}
                    </Text>
                    <Text style={TYPOGRAPHY.body}>
                      {loc.note.length > 0 ? loc.note : 'No note'}
                    </Text>
                    <Text style={TYPOGRAPHY.caption}>Saved {formatTimeAgo(loc.savedAt)}</Text>
                  </>
                ) : (
                  <Text style={TYPOGRAPHY.caption}>
                    No pin saved. Drop one from the Audio tab.
                  </Text>
                )}
              </View>
              <View style={SHARED_LAYOUT_STYLES.rowButtons}>
                {!connected ? (
                  <PrimaryButton
                    label="Connect"
                    compact
                    onPress={() =>
                      actions.run(`Connect ${device.name}`, () =>
                        manager.connectDevice(device.id),
                      )
                    }
                  />
                ) : null}
                {loc ? (
                  <PrimaryButton
                    label="Clear pin"
                    tone="amber"
                    compact
                    onPress={() =>
                      actions.run('Clear pin', async () => {
                        await store.setLastKnownLocation(device.id, null);
                        onStoreChanged();
                      })
                    }
                  />
                ) : null}
                <PrimaryButton
                  label="Forget"
                  tone="rose"
                  compact
                  onPress={() =>
                    actions.run('Forget device', async () => {
                      if (connected) {
                        if (device.kind === 'earbuds') await manager.disconnectEarbuds();
                        else await manager.disconnectWatch();
                      }
                      await store.removePairedDevice(device.id);
                      onStoreChanged();
                    })
                  }
                />
              </View>
            </Card>
          );
        })}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  list: { gap: SPACING.md },
  deviceCard: { gap: SPACING.md },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: SPACING.md,
  },
  cardTitleBlock: { flex: 1, gap: 2 },
  pinBox: {
    backgroundColor: COLORS.surfaceWell,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    gap: 3,
  },
  pinCoords: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.amber,
    fontFamily: MONO_FONT,
  },
});
