import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import {
  EQ_FREQUENCIES,
  EQ_GAIN_MAX,
  EQ_GAIN_MIN,
  EQ_PRESETS,
  getFactoryPresetsForProduct,
} from '../../../protocols/ultimaLinkConstants.ts';
import { ANC_MODE } from '../../../storage/offlineStore.ts';
import type {
  AncMode,
  CustomEqProfile,
  OfflineAppState,
  OfflineStore,
} from '../../../storage/offlineStore.ts';
import type {
  BleManagerSnapshot,
  UltimaBleManager,
} from '../../../services/bleManager.ts';
import {
  ActionChip,
  Card,
  PrimaryButton,
  ProgressBar,
  SectionHeader,
  Stepper,
} from '../../shared/theme/primitives.tsx';
import {
  COLORS,
  MONO_FONT,
  RADII,
  SHARED_LAYOUT_STYLES,
  SPACING,
  TYPOGRAPHY,
  clampNumber,
  hex16,
} from '../../shared/theme/tokens.ts';
import type { AccentTone, ActionRunner } from '../../shared/theme/tokens.ts';

export interface AncAndEqSectionProps {
  earbuds: BleManagerSnapshot['earbuds'];
  manager: UltimaBleManager;
  store: OfflineStore;
  storeState: OfflineAppState;
  actions: ActionRunner;
  onStoreChanged: () => void;
}

function formatFreqLabel(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}k` : `${hz}`;
}

const ANC_MODES: readonly { mode: AncMode; label: string; tone: AccentTone }[] = [
  { mode: ANC_MODE.OFF, label: 'Normal (Off)', tone: 'neutral' },
  { mode: ANC_MODE.ANC, label: 'ANC Active', tone: 'cyan' },
  { mode: ANC_MODE.TRANSPARENCY, label: 'Transparency', tone: 'emerald' },
];

const MODEL_PRESET_BUTTONS: readonly { label: string; name: string; gains: readonly number[] }[] = [
  { label: 'Prime1 / Default Sig', name: 'Signature (Default)', gains: EQ_PRESETS.SIGNATURE_SOUND },
  { label: 'BOOM 311 Sig', name: 'Signature (311)', gains: EQ_PRESETS.SIGNATURE_SOUND_311 },
  { label: 'Bluetrum Sig', name: 'Signature (BT)', gains: EQ_PRESETS.SIGNATURE_SOUND_BT },
  { label: 'BOOM 311 Bal', name: 'Balance (311)', gains: EQ_PRESETS.BALANCE_SOUND_311 },
  { label: 'Bluetrum Bal', name: 'Balance (BT)', gains: EQ_PRESETS.BALANCE_SOUND_BT },
];

/** Renders ANC mode/depth controls and the 10-band EQ studio with offline custom curves. */
export function AncAndEqSection({
  earbuds,
  manager,
  store,
  storeState,
  actions,
  onStoreChanged,
}: AncAndEqSectionProps): React.ReactElement {
  const connected = earbuds.connected;
  const pid = earbuds.pid ?? 0x0001;
  const factoryPresets = getFactoryPresetsForProduct(pid);
  const [draftGains, setDraftGains] = React.useState<number[]>(() => [...earbuds.eqGains]);
  const [customProfileName, setCustomProfileName] = React.useState('My Ultima Curve');

  React.useEffect(() => {
    setDraftGains([...earbuds.eqGains]);
  }, [earbuds.eqGains]);

  const applyPresetCurve = (
    name: string,
    gains: readonly number[],
    modeByte?: number,
  ): void => {
    const next = [...gains];
    setDraftGains(next);
    if (connected) {
      actions.run(`Apply EQ: ${name}`, () => manager.setEarbudsEq(next, name, modeByte));
    }
  };

  const adjustBandGain = (bandIndex: number, delta: number): void => {
    const next = draftGains.map((g, idx) =>
      idx === bandIndex ? clampNumber(g + delta, EQ_GAIN_MIN, EQ_GAIN_MAX) : g,
    );
    setDraftGains(next);
    if (connected) {
      actions.run(
        `EQ ${formatFreqLabel(EQ_FREQUENCIES[bandIndex] ?? 1000)}Hz`,
        () => manager.setEarbudsEq(next, 'Custom'),
      );
    }
  };

  const handleSaveCustomEq = (): void => {
    const cleanName = customProfileName.trim() || 'Custom Curve';
    const id = `eq_${cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${Date.now()}`;
    actions.run(`Save EQ "${cleanName}"`, async () => {
      await store.saveCustomEqProfile({ id, name: cleanName, gains: [...draftGains] });
      onStoreChanged();
      if (connected) await manager.setEarbudsEq([...draftGains], cleanName);
    });
  };

  const handleLoadCustomEq = (profile: CustomEqProfile): void => {
    setCustomProfileName(profile.name);
    applyPresetCurve(profile.name, profile.gains);
  };

  const handleDeleteCustomEq = (profileId: string, name: string): void => {
    actions.run(`Delete EQ "${name}"`, async () => {
      await store.deleteCustomEqProfile(profileId);
      onStoreChanged();
    });
  };

  return (
    <>
      <SectionHeader
        style={SHARED_LAYOUT_STYLES.sectionGap}
        overline="Acoustic Control"
        title="ANC & Ambient Gain"
        subtitle="Bluetrum CMD 0x09/0x27 & Jieli RCSP ANC attribute"
      />
      <Card>
        <View style={SHARED_LAYOUT_STYLES.chipRow}>
          {ANC_MODES.map((item) => (
            <ActionChip
              key={item.mode}
              label={item.label}
              active={earbuds.ancMode === item.mode}
              tone={item.tone}
              disabled={!connected}
              onPress={() =>
                actions.run(`ANC Mode -> ${item.label}`, () =>
                  manager.setEarbudsAncMode(item.mode),
                )
              }
              style={SHARED_LAYOUT_STYLES.flexOne}
            />
          ))}
        </View>
        <View style={SHARED_LAYOUT_STYLES.divider} />
        <Stepper
          label="ANC Depth Gain"
          value={earbuds.ancGain}
          min={0}
          max={earbuds.ancGainMax || 10}
          disabled={!connected}
          tone="cyan"
          format={(v) => `${v} / ${earbuds.ancGainMax || 10}`}
          onChange={(next) =>
            actions.run(`ANC Gain ${next}`, () => manager.setEarbudsAncGain(next))
          }
        />
        <Stepper
          label="Transparency Gain"
          value={earbuds.transparencyGain}
          min={0}
          max={earbuds.transparencyGainMax || 10}
          disabled={!connected}
          tone="emerald"
          format={(v) => `${v} / ${earbuds.transparencyGainMax || 10}`}
          onChange={(next) =>
            actions.run(`Transparency Gain ${next}`, () =>
              manager.setEarbudsTransparencyGain(next),
            )
          }
        />
      </Card>

      <SectionHeader
        style={SHARED_LAYOUT_STYLES.sectionGap}
        overline="10-Band Equalizer (31 Hz – 16 kHz)"
        title={`Active Preset: ${earbuds.eqPresetName}`}
        subtitle={
          earbuds.eqCrcHex
            ? `Jieli CRC16-XMODEM: 0x${earbuds.eqCrcHex.toUpperCase()} · Mode 0x${earbuds.eqModeByte.toString(16).toUpperCase()}`
            : `Mode 0x${earbuds.eqModeByte.toString(16).toUpperCase()} · Range ${EQ_GAIN_MIN}..+${EQ_GAIN_MAX} dB`
        }
      />
      <Card>
        <Text style={TYPOGRAPHY.overline}>Factory Ultima Presets (PID {hex16(pid)})</Text>
        <View style={SHARED_LAYOUT_STYLES.chipWrap}>
          <ActionChip
            label="Signature Sound"
            active={earbuds.eqPresetName === 'Signature Sound'}
            tone="cyan"
            onPress={() => applyPresetCurve('Signature Sound', factoryPresets.signatureSound)}
          />
          <ActionChip
            label="Balance Sound"
            active={earbuds.eqPresetName === 'Balance Sound'}
            tone="emerald"
            onPress={() => applyPresetCurve('Balance Sound', factoryPresets.balanceSound)}
          />
          <ActionChip
            label="Flat (0 dB)"
            active={earbuds.eqPresetName === 'Flat'}
            tone="neutral"
            onPress={() => applyPresetCurve('Flat', factoryPresets.flat, 0)}
          />
        </View>

        <Text style={[TYPOGRAPHY.overline, styles.subGroupLabel]}>
          Model-Specific Factory Reference Curves
        </Text>
        <View style={SHARED_LAYOUT_STYLES.chipWrap}>
          {MODEL_PRESET_BUTTONS.map((btn) => (
            <ActionChip
              key={btn.label}
              label={btn.label}
              compact
              tone="indigo"
              onPress={() => applyPresetCurve(btn.name, btn.gains)}
            />
          ))}
        </View>

        <View style={SHARED_LAYOUT_STYLES.divider} />
        <View style={styles.eqBandsContainer}>
          {EQ_FREQUENCIES.map((freq, idx) => {
            const gain = draftGains[idx] ?? 0;
            const norm = (gain - EQ_GAIN_MIN) / (EQ_GAIN_MAX - EQ_GAIN_MIN);
            return (
              <View key={freq} style={styles.eqBandRow}>
                <Text style={styles.eqFreqText}>{formatFreqLabel(freq)} Hz</Text>
                <ActionChip
                  label="−"
                  compact
                  tone="neutral"
                  disabled={gain <= EQ_GAIN_MIN}
                  onPress={() => adjustBandGain(idx, -1)}
                />
                <View style={SHARED_LAYOUT_STYLES.flexOne}>
                  <ProgressBar
                    progress={norm}
                    tone={gain > 0 ? 'cyan' : gain < 0 ? 'amber' : 'neutral'}
                    height={8}
                  />
                </View>
                <ActionChip
                  label="+"
                  compact
                  tone="cyan"
                  disabled={gain >= EQ_GAIN_MAX}
                  onPress={() => adjustBandGain(idx, 1)}
                />
                <Text style={styles.eqGainValue}>
                  {gain > 0 ? `+${gain}` : `${gain}`} dB
                </Text>
              </View>
            );
          })}
        </View>

        <View style={SHARED_LAYOUT_STYLES.rowButtons}>
          <PrimaryButton
            label="Send Curve to Earbuds"
            tone="cyan"
            compact
            disabled={!connected}
            onPress={() =>
              actions.run('Send 10-band EQ', () =>
                manager.setEarbudsEq([...draftGains], customProfileName || 'Custom'),
              )
            }
          />
          <PrimaryButton
            label="Zero All Bands"
            tone="neutral"
            compact
            onPress={() => applyPresetCurve('Flat', EQ_PRESETS.FLAT, 0)}
          />
        </View>

        <View style={SHARED_LAYOUT_STYLES.divider} />
        <Text style={TYPOGRAPHY.overline}>
          Offline Custom EQ Profiles ({storeState.customEqProfiles.length})
        </Text>
        <View style={SHARED_LAYOUT_STYLES.inputRow}>
          <TextInput
            value={customProfileName}
            onChangeText={setCustomProfileName}
            placeholder="Custom EQ profile name"
            placeholderTextColor={COLORS.textMuted}
            style={SHARED_LAYOUT_STYLES.textInput}
          />
          <PrimaryButton label="Save to Store" tone="emerald" compact onPress={handleSaveCustomEq} />
        </View>
        {storeState.customEqProfiles.length === 0 ? (
          <Text style={TYPOGRAPHY.caption}>
            No custom profiles saved yet. Adjust bands above and tap Save to Store.
          </Text>
        ) : (
          <View style={styles.savedEqList}>
            {storeState.customEqProfiles.map((prof) => (
              <View key={prof.id} style={styles.savedEqItem}>
                <View style={styles.savedEqMeta}>
                  <Text style={TYPOGRAPHY.cardTitle}>{prof.name}</Text>
                  <Text style={styles.savedEqGains}>
                    [{prof.gains.map((g) => (g > 0 ? `+${g}` : `${g}`)).join(', ')}] dB
                  </Text>
                </View>
                <View style={SHARED_LAYOUT_STYLES.rowButtons}>
                  <ActionChip label="Load" compact tone="cyan" onPress={() => handleLoadCustomEq(prof)} />
                  <ActionChip
                    label="Delete"
                    compact
                    tone="rose"
                    onPress={() => handleDeleteCustomEq(prof.id, prof.name)}
                  />
                </View>
              </View>
            ))}
          </View>
        )}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  subGroupLabel: { marginTop: SPACING.md },
  eqBandsContainer: { gap: SPACING.xs },
  eqBandRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: 2 },
  eqFreqText: { width: 54, fontSize: 11, fontFamily: MONO_FONT, color: COLORS.textSecondary },
  eqGainValue: {
    width: 50,
    textAlign: 'right',
    fontSize: 11,
    fontFamily: MONO_FONT,
    color: COLORS.textPrimary,
  },
  savedEqList: { gap: SPACING.sm, marginTop: SPACING.sm },
  savedEqItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
    padding: SPACING.sm,
    borderRadius: RADII.sm,
    backgroundColor: COLORS.surfaceWell,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  savedEqMeta: { flex: 1, gap: 2 },
  savedEqGains: { fontSize: 10, fontFamily: MONO_FONT, color: COLORS.textSecondary },
});
