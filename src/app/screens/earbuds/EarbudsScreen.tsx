import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Text } from 'react-native-paper';

import { EQ_PRESETS, getFactoryPresetsForProduct } from '../../../protocols/ultimaLinkConstants.ts';
import { ANC_MODE, DEVICE_KIND } from '../../../storage/offlineStore.ts';
import type { AncMode, PairedDeviceRecord } from '../../../storage/offlineStore.ts';
import { M3 } from '../../../domains/shared/theme/tokens.ts';
import { useApp } from '../../AppContext.tsx';
import {
  Banner,
  Battery,
  Card,
  ChoiceTiles,
  EmptyState,
  Gap,
  HStack,
  LevelPicker,
  Pill,
  Row,
  RowGroup,
  Screen,
  SectionLabel,
  SwitchRow,
  useTask,
} from '../../ui.tsx';
import type { Choice } from '../../ui.tsx';

// ---------------------------------------------------------------------------
// Shared earbuds helpers (used by the earbuds detail screens too)
// ---------------------------------------------------------------------------

/** Most recently used saved earbuds, if any. */
export function useSavedEarbuds(): PairedDeviceRecord | null {
  const { storeState } = useApp();
  return React.useMemo(() => {
    const saved = storeState.pairedDevices
      .filter((d) => d.kind === DEVICE_KIND.EARBUDS)
      .sort((a, b) => b.lastConnectedAt - a.lastConnectedAt);
    return saved[0] ?? null;
  }, [storeState.pairedDevices]);
}

/** Reconnect to the saved earbuds, or open Add device when none are saved. */
export function useConnectEarbuds(): { connect: () => void; connecting: boolean; label: string } {
  const { snapshot, manager } = useApp();
  const navigation = useNavigation();
  const saved = useSavedEarbuds();
  const { run, busy } = useTask();
  const keeperState = snapshot.keepAlive.earbuds.state;
  const connecting = snapshot.earbuds.connecting || busy('connect') || keeperState === 'reconnecting';
  const connect = React.useCallback(() => {
    if (!saved) {
      navigation.navigate('AddDevice');
      return;
    }
    void run('connect', () => manager.connectDevice(saved.id), {
      failure: `Couldn't connect to ${saved.name}`,
    });
  }, [saved, navigation, run, manager]);
  return { connect, connecting, label: saved ? `Reconnect ${saved.name}` : 'Add earbuds' };
}

/** Banner shown on earbud detail screens while disconnected. */
export function EarbudsNotConnectedBanner(): React.ReactElement | null {
  const { snapshot } = useApp();
  const { connect, connecting } = useConnectEarbuds();
  if (snapshot.earbuds.connected) return null;
  return (
    <Banner
      tone="amber"
      icon="earbuds-off-outline"
      text={connecting ? 'Connecting to your earbuds…' : 'Earbuds aren’t connected.'}
      action={connecting ? undefined : { label: 'Connect', onPress: connect }}
    />
  );
}

export interface FactoryPreset {
  key: string;
  label: string;
  gains: readonly number[];
}

/** The factory sound presets for the connected model, with friendly names. */
export function factoryPresetsFor(pid: number | null | undefined): FactoryPreset[] {
  const p = getFactoryPresetsForProduct(pid ?? 0x0001);
  return [
    { key: 'Signature', label: 'Signature', gains: p.signatureSound },
    { key: 'Balanced', label: 'Balanced', gains: p.balanceSound },
    { key: 'Flat', label: 'Flat', gains: p.flat ?? EQ_PRESETS.FLAT },
  ];
}

export function sameGains(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// ---------------------------------------------------------------------------

const NOISE_OPTIONS: readonly Choice<AncMode>[] = [
  { value: ANC_MODE.OFF, label: 'Off', icon: 'volume-high' },
  { value: ANC_MODE.ANC, label: 'Cancel', icon: 'headphones' },
  { value: ANC_MODE.TRANSPARENCY, label: 'Aware', icon: 'ear-hearing' },
];

const NOISE_HELP: Record<AncMode, string> = {
  off: 'Normal listening, no noise processing.',
  anc: 'Blocks out background noise around you.',
  transparency: 'Lets outside sound in so you can hear what’s around you.',
};

export function EarbudsScreen(): React.ReactElement {
  const { snapshot, manager, storeState } = useApp();
  const navigation = useNavigation();
  const { run, busy } = useTask();
  const { connect, connecting, label } = useConnectEarbuds();
  const earbuds = snapshot.earbuds;

  if (!earbuds.connected) {
    return (
      <Screen>
        {!snapshot.bleAvailable ? (
          <Banner tone="rose" icon="bluetooth-off" text="Bluetooth is off or unavailable. Turn it on to connect." />
        ) : null}
        <EmptyState
          icon="earbuds"
          title={connecting ? 'Connecting…' : 'Connect your earbuds'}
          body={
            connecting
              ? 'Keep the case open and close to your phone.'
              : 'Open the charging case near your phone so your earbuds can be found.'
          }
          action={{ label: connecting ? 'Connecting…' : label, onPress: connect, icon: 'bluetooth-connect', loading: connecting }}
          secondary={label.startsWith('Reconnect') ? { label: 'Add different earbuds', onPress: () => navigation.navigate('AddDevice') } : undefined}
        />
      </Screen>
    );
  }

  const presets = factoryPresetsFor(earbuds.pid);
  const custom = storeState.customEqProfiles;
  const presetChoices: Choice<string>[] = [
    ...presets.map((p) => ({ value: `f:${p.key}`, label: p.label })),
    ...custom.slice(0, 3).map((c) => ({ value: `c:${c.id}`, label: c.name })),
  ];
  // Jieli Signature/Balance are tunings inside the earbuds; they report them by name, not as gains.
  const namedPreset =
    earbuds.eqPresetName === 'Signature Sound' ? 'Signature' : earbuds.eqPresetName === 'Balance Sound' ? 'Balanced' : null;
  const activePreset =
    presets.find((p) => p.key === namedPreset) ?? presets.find((p) => sameGains(p.gains, earbuds.eqGains)) ?? null;
  const activeCustom = activePreset ? null : custom.find((c) => sameGains(c.gains, earbuds.eqGains)) ?? null;
  const selectedPreset = activePreset ? `f:${activePreset.key}` : activeCustom ? `c:${activeCustom.id}` : null;
  const soundName = activePreset?.label ?? activeCustom?.name ?? (earbuds.eqPresetName || 'Custom');

  const applyPreset = (value: string): void => {
    if (value.startsWith('f:')) {
      const p = presets.find((x) => `f:${x.key}` === value);
      if (p) void run('eq', () => manager.setEarbudsEq([...p.gains], p.label), { failure: 'Couldn’t change the sound' });
    } else {
      const c = custom.find((x) => `c:${x.id}` === value);
      if (c) void run('eq', () => manager.setEarbudsEq([...c.gains], c.name), { failure: 'Couldn’t change the sound' });
    }
  };

  const mode = earbuds.ancMode;
  const caps = earbuds.capacities;
  const fs = earbuds.featureSupport;
  const noiseOptions = NOISE_OPTIONS.filter(
    (o) => !fs || o.value === ANC_MODE.OFF || (o.value === ANC_MODE.ANC ? fs.anc : fs.transparency),
  );
  const showNoise = fs ? fs.anc || fs.transparency : !(caps && !caps.anc);
  const showLevels = fs ? fs.ancLevels : true;

  const features: {
    key: string;
    title: string;
    subtitle: string;
    icon: string;
    value: boolean;
    supported: boolean;
    apply: (next: boolean) => Promise<void>;
  }[] = [
    { key: 'game', title: 'Low-latency mode', subtitle: 'Less audio delay for games and video', icon: 'gamepad-variant-outline', value: earbuds.gameMode, supported: fs ? fs.gameMode : true, apply: (n) => manager.setEarbudsGameMode(n) },
    { key: 'spatial', title: 'Spatial audio', subtitle: 'Wider, more immersive sound', icon: 'surround-sound', value: earbuds.spatialAudio, supported: fs ? fs.spatialAudio : caps ? caps.soundEffect3d : true, apply: (n) => manager.setEarbudsSpatialAudio(n) },
    { key: 'ldac', title: 'High-quality audio (LDAC)', subtitle: 'Better sound on supported phones; uses more battery', icon: 'music-note-eighth', value: earbuds.ldac, supported: fs ? fs.ldac : true, apply: (n) => manager.setEarbudsLdac(n) },
    { key: 'inear', title: 'Auto-pause when removed', subtitle: 'Pauses when you take an earbud out', icon: 'pause-circle-outline', value: earbuds.inEarDetect, supported: fs ? fs.inEarDetect : true, apply: (n) => manager.setEarbudsInEarDetect(n) },
    { key: 'dual', title: 'Connect to two devices', subtitle: 'Stay connected to a phone and a laptop at once', icon: 'devices', value: earbuds.dualConnect, supported: fs ? fs.dualConnect : caps ? caps.multipoint : true, apply: (n) => manager.setEarbudsDualConnect(n) },
    { key: 'led', title: 'Indicator light', subtitle: 'Status light on the earbuds and case', icon: 'led-on', value: earbuds.ledOn, supported: fs ? fs.led : true, apply: (n) => manager.setEarbudsLed(n) },
  ];

  const name = earbuds.name || earbuds.deviceName || 'Earbuds';
  const b = earbuds.battery;
  const pct = (v: number | undefined): number | null => (v === undefined || v < 0 || v > 100 ? null : v);

  return (
    <Screen refreshing={busy('refresh')} onRefresh={() => void run('refresh', () => manager.refreshEarbudsInfo(), { failure: 'Couldn’t refresh' })}>
      <Card>
        <HStack>
          <View style={styles.flex1}>
            <Text variant="titleLarge" style={styles.onSurface} numberOfLines={1}>
              {name}
            </Text>
            {earbuds.product?.name && earbuds.product.name !== name ? (
              <Text variant="bodyMedium" style={styles.muted}>
                {earbuds.product.name}
              </Text>
            ) : null}
          </View>
          <Pill label="Connected" tone="emerald" />
        </HStack>
        <Gap size={16} />
        <HStack style={styles.batteries}>
          <Battery label="Left" percent={pct(b?.left ?? earbuds.leftBattery)} charging={b?.leftCharging ?? earbuds.leftCharging} />
          <Battery label="Right" percent={pct(b?.right ?? earbuds.rightBattery)} charging={b?.rightCharging ?? earbuds.rightCharging} />
          {/* Jieli earbuds report the case as 0 when it's closed or out of range. */}
          <Battery
            label="Case"
            percent={(b?.case ?? earbuds.caseBattery) === 0 && !(b?.caseCharging ?? earbuds.caseCharging) ? null : pct(b?.case ?? earbuds.caseBattery)}
            charging={b?.caseCharging ?? earbuds.caseCharging}
          />
        </HStack>
      </Card>

      {!showNoise ? null : (
        <>
          <SectionLabel>Noise control</SectionLabel>
          <Card>
            <ChoiceTiles
              options={noiseOptions}
              value={mode}
              columns={noiseOptions.length === 2 ? 2 : 3}
              disabled={busy('anc')}
              onChange={(next) => void run('anc', () => manager.setEarbudsAncMode(next), { failure: 'Couldn’t change noise control' })}
            />
            <Gap size={8} />
            <Text variant="bodyMedium" style={styles.muted}>
              {NOISE_HELP[mode]}
            </Text>
            {showLevels && mode === ANC_MODE.ANC && earbuds.ancGainMax > 0 ? (
              <>
                <Gap size={12} />
                <LevelPicker
                  label="Strength"
                  value={earbuds.ancGain}
                  max={earbuds.ancGainMax}
                  onChange={(n) => void run('ancGain', () => manager.setEarbudsAncGain(n), { failure: 'Couldn’t change strength' })}
                />
              </>
            ) : null}
            {showLevels && mode === ANC_MODE.TRANSPARENCY && earbuds.transparencyGainMax > 0 ? (
              <>
                <Gap size={12} />
                <LevelPicker
                  label="Outside sound"
                  value={earbuds.transparencyGain}
                  max={earbuds.transparencyGainMax}
                  onChange={(n) => void run('awareGain', () => manager.setEarbudsTransparencyGain(n), { failure: 'Couldn’t change level' })}
                />
              </>
            ) : null}
          </Card>
        </>
      )}

      <SectionLabel action={{ label: 'Customize', onPress: () => navigation.navigate('Equalizer') }}>Sound</SectionLabel>
      <Card>
        <Text variant="bodyMedium" style={styles.muted}>
          Now playing with
        </Text>
        <Text variant="titleMedium" style={styles.onSurface}>
          {soundName}
        </Text>
        <Gap size={12} />
        <ChoiceTiles options={presetChoices} value={selectedPreset} onChange={applyPreset} columns={3} disabled={busy('eq')} />
      </Card>

      <SectionLabel>Features</SectionLabel>
      <RowGroup>
        {features
          .filter((f) => f.supported)
          .map((f) => (
            <SwitchRow
              key={f.key}
              icon={f.icon}
              title={f.title}
              subtitle={f.subtitle}
              value={f.value}
              disabled={busy(f.key)}
              onValueChange={(next) => void run(f.key, () => f.apply(next), { failure: `Couldn’t change ${f.title.toLowerCase()}` })}
            />
          ))}
      </RowGroup>

      <SectionLabel>More</SectionLabel>
      <RowGroup>
        <Row icon="gesture-tap" title="Touch controls" subtitle="Choose what taps and holds do" right="chevron" onPress={() => navigation.navigate('TouchControls')} />
        <Row icon="map-marker-radius-outline" tone="amber" title="Find my earbuds" subtitle="Play a sound to locate them" right="chevron" onPress={() => navigation.navigate('FindEarbuds')} />
        <Row icon="information-outline" tone="indigo" title="About earbuds" subtitle="Name, firmware, reset" right="chevron" onPress={() => navigation.navigate('EarbudsAbout')} />
      </RowGroup>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  onSurface: { color: M3.onSurface },
  muted: { color: M3.onSurfaceVariant },
  batteries: { justifyContent: 'space-between', paddingRight: 8 },
});
