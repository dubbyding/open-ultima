import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, IconButton, Text, TextInput } from 'react-native-paper';

import { EQ_FREQUENCIES, EQ_GAIN_MAX, EQ_GAIN_MIN } from '../../../protocols/ultimaLinkConstants.ts';
import { M3 } from '../../../domains/shared/theme/tokens.ts';
import { useApp } from '../../AppContext.tsx';
import { Card, ChoiceTiles, Gap, HStack, Muted, Row, RowGroup, Screen, SectionLabel, useFeedback, useTask } from '../../ui.tsx';
import type { Choice } from '../../ui.tsx';
import { EarbudsNotConnectedBanner, factoryPresetsFor, sameGains } from './EarbudsScreen.tsx';

function freqLabel(hz: number): string {
  return hz >= 1000 ? `${hz / 1000} kHz` : `${hz} Hz`;
}

function clamp(v: number): number {
  return Math.max(EQ_GAIN_MIN, Math.min(EQ_GAIN_MAX, v));
}

/** Centered bar: grows right for boost, left for cut. */
function GainBar({ gain }: { gain: number }): React.ReactElement {
  const g = clamp(gain);
  const half = Math.abs(g) / EQ_GAIN_MAX / 2; // fraction of total width
  return (
    <View style={styles.barTrack}>
      <View style={styles.barCenter} />
      <View
        style={[
          styles.barFill,
          {
            width: `${half * 100}%`,
            left: g >= 0 ? '50%' : `${(0.5 - half) * 100}%`,
            backgroundColor: g >= 0 ? M3.primary : M3.tertiary,
          },
        ]}
      />
    </View>
  );
}

export function EqualizerScreen(): React.ReactElement {
  const { snapshot, manager, store, storeState, onStoreChanged } = useApp();
  const { run, busy } = useTask();
  const { show } = useFeedback();
  const earbuds = snapshot.earbuds;
  const connected = earbuds.connected;
  const presets = factoryPresetsFor(earbuds.pid);
  const custom = storeState.customEqProfiles;

  const [gains, setGains] = React.useState<number[]>(() => [...earbuds.eqGains]);
  const [name, setName] = React.useState('');
  React.useEffect(() => {
    setGains([...earbuds.eqGains]);
  }, [earbuds.eqGains]);

  const apply = (next: number[], label: string): void => {
    setGains(next);
    if (connected) void run('eq', () => manager.setEarbudsEq(next, label), { failure: 'Couldn’t update the equalizer' });
  };

  const presetChoices: Choice<string>[] = presets.map((p) => ({ value: p.key, label: p.label }));
  const selected = presets.find((p) => sameGains(p.gains, gains))?.key ?? null;

  const save = (): void => {
    const clean = name.trim() || `My sound ${custom.length + 1}`;
    const id = `eq_${clean.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${Date.now()}`;
    void run(
      'save',
      async () => {
        await store.saveCustomEqProfile({ id, name: clean, gains: [...gains] });
        onStoreChanged();
        setName('');
        if (connected) await manager.setEarbudsEq([...gains], clean);
      },
      { success: `Saved “${clean}”`, failure: 'Couldn’t save preset' },
    );
  };

  return (
    <Screen>
      <EarbudsNotConnectedBanner />

      <SectionLabel>Start from a preset</SectionLabel>
      <ChoiceTiles
        options={presetChoices}
        value={selected}
        columns={3}
        disabled={!connected}
        onChange={(key) => {
          const p = presets.find((x) => x.key === key);
          if (p) apply([...p.gains].map(clamp), p.label);
        }}
      />

      <SectionLabel action={{ label: 'Reset to flat', onPress: () => apply(gains.map(() => 0), 'Flat') }}>Adjust</SectionLabel>
      <Card padded={false}>
        <View style={[styles.bands, !connected ? styles.disabled : null]}>
          {EQ_FREQUENCIES.map((hz, i) => {
            const g = gains[i] ?? 0;
            return (
              <HStack key={hz} gap={4}>
                <Text variant="labelLarge" style={styles.freq}>
                  {freqLabel(hz)}
                </Text>
                <IconButton
                  icon="minus"
                  size={18}
                  disabled={!connected || g <= EQ_GAIN_MIN}
                  onPress={() => apply(gains.map((v, j) => (j === i ? clamp(v - 1) : v)), 'Custom')}
                  accessibilityLabel={`Lower ${freqLabel(hz)}`}
                />
                <GainBar gain={g} />
                <IconButton
                  icon="plus"
                  size={18}
                  disabled={!connected || g >= EQ_GAIN_MAX}
                  onPress={() => apply(gains.map((v, j) => (j === i ? clamp(v + 1) : v)), 'Custom')}
                  accessibilityLabel={`Raise ${freqLabel(hz)}`}
                />
                <Text variant="labelLarge" style={styles.db}>
                  {g > 0 ? `+${g}` : g} dB
                </Text>
              </HStack>
            );
          })}
        </View>
      </Card>
      <Muted>Left side is bass, right side is treble. Changes play on your earbuds right away.</Muted>

      <SectionLabel>Save as preset</SectionLabel>
      <Card>
        <TextInput mode="outlined" label="Preset name" value={name} onChangeText={setName} placeholder="e.g. Running" />
        <Gap size={12} />
        <Button mode="contained" icon="content-save-outline" onPress={save} loading={busy('save')} contentStyle={styles.button}>
          Save
        </Button>
      </Card>

      {custom.length > 0 ? (
        <>
          <SectionLabel>Your presets</SectionLabel>
          <RowGroup>
            {custom.map((p) => (
              <Row
                key={p.id}
                icon={sameGains(p.gains, gains) ? 'check-circle' : 'tune-variant'}
                title={p.name}
                subtitle={sameGains(p.gains, gains) ? 'In use' : 'Tap to use'}
                onPress={() => {
                  setGains([...p.gains]);
                  if (connected) apply([...p.gains], p.name);
                  else show('Connect your earbuds to use this preset.');
                }}
                right={
                  <IconButton
                    icon="delete-outline"
                    onPress={() =>
                      void run(
                        `del-${p.id}`,
                        async () => {
                          await store.deleteCustomEqProfile(p.id);
                          onStoreChanged();
                        },
                        { success: `Deleted “${p.name}”`, failure: 'Couldn’t delete preset' },
                      )
                    }
                    accessibilityLabel={`Delete ${p.name}`}
                  />
                }
              />
            ))}
          </RowGroup>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  bands: { paddingVertical: 8, paddingHorizontal: 8 },
  disabled: { opacity: 0.4 },
  freq: { width: 56, color: M3.onSurface, textAlign: 'right' },
  db: { width: 52, color: M3.onSurfaceVariant, textAlign: 'right' },
  barTrack: { flex: 1, height: 10, borderRadius: 5, backgroundColor: M3.surfaceContainerHighest, overflow: 'hidden' },
  barCenter: { position: 'absolute', left: '50%', width: 2, marginLeft: -1, top: 0, bottom: 0, backgroundColor: M3.outline },
  barFill: { position: 'absolute', top: 0, bottom: 0, borderRadius: 5 },
  button: { height: 48 },
});
