import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import type {
  BleManagerSnapshot,
  UltimaBleManager,
} from '../../../services/bleManager.ts';
import { OfflineMapCanvas } from '../../map/OfflineMapCanvas.tsx';
import type { OfflineMapPin } from '../../map/types.ts';
import {
  ActionChip,
  Card,
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
} from '../../shared/theme/tokens.ts';
import type { ActionRunner } from '../../shared/theme/tokens.ts';

export interface FindMyEarbudsSectionProps {
  earbuds: BleManagerSnapshot['earbuds'];
  earbudMapPins: readonly OfflineMapPin[];
  manager: UltimaBleManager;
  actions: ActionRunner;
  onStoreChanged: () => void;
}

/** Renders Bluetooth rename, Find-My buzzer, offline L/R/Case radar pinning, and factory reset. */
export function FindMyEarbudsSection({
  earbuds,
  earbudMapPins,
  manager,
  actions,
  onStoreChanged,
}: FindMyEarbudsSectionProps): React.ReactElement {
  const connected = earbuds.connected;
  const [renameText, setRenameText] = React.useState(earbuds.name);
  const [pinNote, setPinNote] = React.useState(
    earbuds.lastKnownLocation?.note ?? 'Desk / Studio Case Drop',
  );
  const [pinLatText, setPinLatText] = React.useState(
    earbuds.lastKnownLocation ? String(earbuds.lastKnownLocation.lat) : '27.7172',
  );
  const [pinLngText, setPinLngText] = React.useState(
    earbuds.lastKnownLocation ? String(earbuds.lastKnownLocation.lng) : '85.3240',
  );
  const [selectedPinTarget, setSelectedPinTarget] = React.useState<
    'all' | 'left' | 'right' | 'case'
  >('all');

  React.useEffect(() => {
    if (earbuds.connected) setRenameText(earbuds.name);
  }, [earbuds.connected, earbuds.name]);

  const userRadarAnchor = React.useMemo(() => {
    const refLoc = earbuds.lastKnownLocation ?? earbuds.sideLocations.casePin;
    if (!refLoc) return null;
    const parsedLat = Number.parseFloat(pinLatText);
    const parsedLng = Number.parseFloat(pinLngText);
    if (
      Number.isFinite(parsedLat) &&
      Number.isFinite(parsedLng) &&
      (Math.abs(parsedLat - refLoc.lat) > 0.00005 ||
        Math.abs(parsedLng - refLoc.lng) > 0.00005)
    ) {
      return { lat: parsedLat, lng: parsedLng, label: 'Phone Reference' };
    }
    return {
      lat: Number((refLoc.lat - 0.00032).toFixed(6)),
      lng: Number((refLoc.lng - 0.00028).toFixed(6)),
      label: 'Phone Anchor',
    };
  }, [earbuds.lastKnownLocation, earbuds.sideLocations.casePin, pinLatText, pinLngText]);

  return (
    <>
      <SectionHeader
        style={SHARED_LAYOUT_STYLES.sectionGap}
        overline="Device Identity & Find My"
        title="Rename, Buzzer & Location Pin"
        subtitle="100% local Find-My pin note + BLE buzzer ring"
      />
      <Card style={styles.cardStack}>
        <Text style={TYPOGRAPHY.overline}>Bluetooth Name (CMD 0x1D)</Text>
        <View style={SHARED_LAYOUT_STYLES.inputRow}>
          <TextInput
            value={renameText}
            onChangeText={setRenameText}
            placeholder="New Bluetooth name"
            placeholderTextColor={COLORS.textMuted}
            style={SHARED_LAYOUT_STYLES.textInput}
          />
          <PrimaryButton
            label="Rename"
            tone="cyan"
            compact
            disabled={!connected || renameText.trim().length === 0}
            onPress={() =>
              actions.run(`Rename to "${renameText.trim()}"`, () =>
                manager.renameEarbuds(renameText.trim()),
              )
            }
          />
        </View>

        <View style={SHARED_LAYOUT_STYLES.divider} />
        <View style={styles.cardHeaderRow}>
          <View style={SHARED_LAYOUT_STYLES.flexOne}>
            <Text style={TYPOGRAPHY.cardTitle}>Find My Earbuds Buzzer</Text>
            <Text style={TYPOGRAPHY.caption}>
              Emits high-frequency locator tone from earbuds (CMD 0x1A / Jieli SearchDev)
            </Text>
          </View>
          <PrimaryButton
            label={earbuds.finding ? 'Stop Buzzer' : 'Ring Earbuds'}
            tone={earbuds.finding ? 'rose' : 'amber'}
            compact
            disabled={!connected}
            onPress={() =>
              actions.run(
                earbuds.finding ? 'Stop buzzer' : 'Ring earbuds',
                () => manager.findEarbuds(!earbuds.finding),
              )
            }
          />
        </View>

        <View style={SHARED_LAYOUT_STYLES.divider} />
        <Text style={TYPOGRAPHY.overline}>Offline Find-My Location Pin</Text>
        {earbuds.lastKnownLocation ? (
          <Text style={TYPOGRAPHY.caption}>
            Saved: 📍 {earbuds.lastKnownLocation.lat.toFixed(4)},{' '}
            {earbuds.lastKnownLocation.lng.toFixed(4)} — &ldquo;
            {earbuds.lastKnownLocation.note}&rdquo; (
            {formatTimeAgo(earbuds.lastKnownLocation.savedAt)})
          </Text>
        ) : (
          <Text style={TYPOGRAPHY.caption}>
            No location pin recorded for current earbuds yet.
          </Text>
        )}

        <OfflineMapCanvas
          mode="radar"
          title="Offline Find-My Compass Radar"
          pins={earbudMapPins}
          userLocation={userRadarAnchor}
          height={235}
          emptyMessage="Tap Save Location Pin below to plot Left Bud, Right Bud & Case offline."
        />

        <View style={SHARED_LAYOUT_STYLES.chipWrap}>
          {(
            [
              { key: 'all', label: 'Pin Whole Set', tone: 'cyan' },
              { key: 'left', label: 'Pin Left Bud (L)', tone: 'cyan' },
              { key: 'right', label: 'Pin Right Bud (R)', tone: 'emerald' },
              { key: 'case', label: 'Pin Case (C)', tone: 'amber' },
            ] as const
          ).map((target) => (
            <ActionChip
              key={target.key}
              label={target.label}
              tone={target.tone}
              active={selectedPinTarget === target.key}
              onPress={() => setSelectedPinTarget(target.key)}
            />
          ))}
        </View>
        <TextInput
          value={pinNote}
          onChangeText={setPinNote}
          placeholder="Location note (e.g. Backpack front pocket)"
          placeholderTextColor={COLORS.textMuted}
          style={SHARED_LAYOUT_STYLES.textInput}
        />
        <View style={SHARED_LAYOUT_STYLES.inputRow}>
          <TextInput
            value={pinLatText}
            onChangeText={setPinLatText}
            placeholder="Latitude"
            placeholderTextColor={COLORS.textMuted}
            keyboardType="numeric"
            style={[SHARED_LAYOUT_STYLES.textInput, styles.coordInput]}
          />
          <TextInput
            value={pinLngText}
            onChangeText={setPinLngText}
            placeholder="Longitude"
            placeholderTextColor={COLORS.textMuted}
            keyboardType="numeric"
            style={[SHARED_LAYOUT_STYLES.textInput, styles.coordInput]}
          />
          <PrimaryButton
            label="Pin Location"
            tone="emerald"
            compact
            onPress={() =>
              actions.run('Pin earbuds location', async () => {
                const lat = Number.parseFloat(pinLatText);
                const lng = Number.parseFloat(pinLngText);
                const resolvedLat = Number.isFinite(lat) ? lat : 27.7172;
                const resolvedLng = Number.isFinite(lng) ? lng : 85.324;
                const noteText = pinNote.trim() || 'Pinned in Audio Studio';
                if (selectedPinTarget === 'all') {
                  await manager.pinLastKnownEarbudsLocation(
                    noteText,
                    Number.isFinite(lat) ? lat : undefined,
                    Number.isFinite(lng) ? lng : undefined,
                  );
                } else {
                  await manager.pinEarbudSideLocation(
                    selectedPinTarget,
                    noteText,
                    resolvedLat,
                    resolvedLng,
                  );
                }
                onStoreChanged();
              })
            }
          />
        </View>

        <View style={SHARED_LAYOUT_STYLES.divider} />
        <View style={styles.cardHeaderRow}>
          <View style={SHARED_LAYOUT_STYLES.flexOne}>
            <Text style={TYPOGRAPHY.cardTitle}>Factory Reset Earbuds</Text>
            <Text style={TYPOGRAPHY.caption}>
              Restores default EQ, ANC, and touch mappings on earbuds (CMD 0x24)
            </Text>
          </View>
          <PrimaryButton
            label="Factory Reset"
            tone="rose"
            compact
            disabled={!connected}
            onPress={() =>
              actions.run('Factory Reset Earbuds', () => manager.factoryResetEarbuds())
            }
          />
        </View>
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  cardStack: { gap: SPACING.sm },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.md,
  },
  coordInput: { fontFamily: MONO_FONT },
});
