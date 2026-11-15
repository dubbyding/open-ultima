import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  CASE_GESTURE,
  EARBUD_GESTURE,
  EARBUD_KEY_FUNCTION,
  VOICE_LANGUAGE,
} from '../../../storage/offlineStore.ts';
import type {
  CaseGesture,
  EarbudGesture,
  EarbudKeyFunction,
  VoiceLanguage,
} from '../../../storage/offlineStore.ts';
import type {
  BleManagerSnapshot,
  UltimaBleManager,
} from '../../../services/bleManager.ts';
import {
  ActionChip,
  Card,
  SectionHeader,
  ToggleRow,
} from '../../shared/theme/primitives.tsx';
import {
  COLORS,
  MONO_FONT,
  RADII,
  SHARED_LAYOUT_STYLES,
  SPACING,
  TYPOGRAPHY,
} from '../../shared/theme/tokens.ts';
import type { AccentTone, ActionRunner } from '../../shared/theme/tokens.ts';

export interface FeaturesAndGesturesSectionProps {
  earbuds: BleManagerSnapshot['earbuds'];
  manager: UltimaBleManager;
  actions: ActionRunner;
}

interface KeyFunctionOption {
  code: EarbudKeyFunction;
  label: string;
}

const KEY_FUNCTION_OPTIONS: readonly KeyFunctionOption[] = [
  { code: EARBUD_KEY_FUNCTION.NONE, label: 'None (0x00)' },
  { code: EARBUD_KEY_FUNCTION.PLAY_PAUSE, label: 'Play / Pause (0x07)' },
  { code: EARBUD_KEY_FUNCTION.NEXT, label: 'Next Track (0x04)' },
  { code: EARBUD_KEY_FUNCTION.PREVIOUS, label: 'Prev Track (0x03)' },
  { code: EARBUD_KEY_FUNCTION.VOLUME_UP, label: 'Volume + (0x05)' },
  { code: EARBUD_KEY_FUNCTION.VOLUME_DOWN, label: 'Volume − (0x06)' },
  { code: EARBUD_KEY_FUNCTION.ANC_MODE, label: 'ANC Cycle (0x09)' },
  { code: EARBUD_KEY_FUNCTION.GAME_MODE, label: 'Game Mode (0x08)' },
  { code: EARBUD_KEY_FUNCTION.VOICE_ASSISTANT, label: 'Voice Asst (0x02)' },
  { code: EARBUD_KEY_FUNCTION.RECALL, label: 'Recall (0x01)' },
];

const EARBUD_GESTURES: readonly { key: EarbudGesture; label: string }[] = [
  { key: EARBUD_GESTURE.SINGLE, label: 'Single Tap' },
  { key: EARBUD_GESTURE.DOUBLE, label: 'Double Tap' },
  { key: EARBUD_GESTURE.TRIPLE, label: 'Triple Tap' },
  { key: EARBUD_GESTURE.LONG_PRESS, label: 'Long Press' },
];

const CASE_GESTURES: readonly { key: CaseGesture; label: string }[] = [
  { key: CASE_GESTURE.SINGLE, label: 'Case Single' },
  { key: CASE_GESTURE.DOUBLE, label: 'Case Double' },
  { key: CASE_GESTURE.TRIPLE, label: 'Case Triple' },
  { key: CASE_GESTURE.LONG_PRESS, label: 'Case Long' },
  { key: CASE_GESTURE.ROTATION, label: 'Crown Rotate' },
];

const LANGUAGES: readonly { code: VoiceLanguage; label: string }[] = [
  { code: VOICE_LANGUAGE.EN, label: 'English (EN)' },
  { code: VOICE_LANGUAGE.ZH, label: '中文提示 (ZH)' },
];

function keyFnLabel(code: number | undefined): string {
  const found = KEY_FUNCTION_OPTIONS.find((item) => item.code === code);
  return found ? found.label : `0x${((code ?? 0) & 0xff).toString(16).toUpperCase()}`;
}

function resolveCaseFn(rawCaseEntry: unknown): number {
  if (typeof rawCaseEntry === 'number') return rawCaseEntry;
  if (
    typeof rawCaseEntry === 'object' &&
    rawCaseEntry !== null &&
    'keyFunction' in rawCaseEntry &&
    typeof (rawCaseEntry as { keyFunction: unknown }).keyFunction === 'number'
  ) {
    return (rawCaseEntry as { keyFunction: number }).keyFunction;
  }
  return EARBUD_KEY_FUNCTION.NONE;
}

/** Renders DSP/hardware toggle switches, voice prompt language, and L/R/Case gesture remapper. */
export function FeaturesAndGesturesSection({
  earbuds,
  manager,
  actions,
}: FeaturesAndGesturesSectionProps): React.ReactElement {
  const connected = earbuds.connected;
  const [activeKeyTab, setActiveKeyTab] = React.useState<'left' | 'right' | 'case'>('left');

  const capabilityRows: ReadonlyArray<{
    label: string;
    subtitle: string;
    value: boolean;
    badge?: string;
    tone: AccentTone;
    actionName: string;
    apply: (next: boolean) => Promise<void>;
  }> = [
    {
      label: 'Game Mode (Low Latency)',
      subtitle: 'Bluetrum 0x08 WorkMode / Jieli Low-Latency mode',
      value: earbuds.gameMode,
      badge: 'DSP',
      tone: 'amber',
      actionName: 'Game Mode',
      apply: (next) => manager.setEarbudsGameMode(next),
    },
    {
      label: 'Spatial Audio / 3D Sound',
      subtitle: 'Immersive head-stage virtualization (CMD 0x2B)',
      value: earbuds.spatialAudio,
      badge: '3D',
      tone: 'indigo',
      actionName: 'Spatial Audio',
      apply: (next) => manager.setEarbudsSpatialAudio(next),
    },
    {
      label: 'LDAC Hi-Res Codec',
      subtitle: '990 kbps high-resolution Bluetooth audio (CMD 0x28)',
      value: earbuds.ldac,
      badge: 'LDAC',
      tone: 'cyan',
      actionName: 'LDAC',
      apply: (next) => manager.setEarbudsLdac(next),
    },
    {
      label: 'In-Ear Wearing Detection',
      subtitle: 'Auto pause/resume when earbuds are removed (CMD 0x0C)',
      value: earbuds.inEarDetect,
      tone: 'emerald',
      actionName: 'In-Ear Detection',
      apply: (next) => manager.setEarbudsInEarDetect(next),
    },
    {
      label: 'Multipoint Dual Connect',
      subtitle: 'Simultaneous two-host Bluetooth connection (CMD 0x1E)',
      value: earbuds.dualConnect,
      tone: 'cyan',
      actionName: 'Dual Connect',
      apply: (next) => manager.setEarbudsDualConnect(next),
    },
    {
      label: 'Earbud Status LED',
      subtitle: 'Toggle physical indicator LEDs on earbuds/case (CMD 0x0D)',
      value: earbuds.ledOn,
      tone: 'emerald',
      actionName: 'LED',
      apply: (next) => manager.setEarbudsLed(next),
    },
  ];

  return (
    <>
      <SectionHeader
        style={SHARED_LAYOUT_STYLES.sectionGap}
        overline="DSP & Hardware Switches"
        title="Device Capabilities"
        subtitle="Persisted per-device in OfflineStore and written over BLE"
      />
      <Card>
        {capabilityRows.map((row) => (
          <ToggleRow
            key={row.label}
            label={row.label}
            subtitle={row.subtitle}
            value={row.value}
            disabled={!connected}
            badge={row.badge}
            tone={row.tone}
            onValueChange={(next) =>
              actions.run(`${row.actionName} ${next ? 'ON' : 'OFF'}`, () => row.apply(next))
            }
          />
        ))}
        <View style={SHARED_LAYOUT_STYLES.divider} />
        <Text style={TYPOGRAPHY.overline}>Voice Prompt Language (CMD 0x0B)</Text>
        <View style={SHARED_LAYOUT_STYLES.chipRow}>
          {LANGUAGES.map((lang) => (
            <ActionChip
              key={lang.code}
              label={lang.label}
              active={earbuds.voiceLanguage === lang.code}
              disabled={!connected}
              tone="cyan"
              onPress={() =>
                actions.run(`Voice language -> ${lang.label}`, () =>
                  manager.setEarbudsLanguage(lang.code),
                )
              }
              style={SHARED_LAYOUT_STYLES.flexOne}
            />
          ))}
        </View>
      </Card>

      <SectionHeader
        style={SHARED_LAYOUT_STYLES.sectionGap}
        overline="Touch & Crown Controls"
        title="L / R / Case Gesture Remapper"
        subtitle="Remap Single, Double, Triple, Long Press, and Case Crown Rotation"
      />
      <Card>
        <View style={SHARED_LAYOUT_STYLES.chipRow}>
          {(
            [
              { key: 'left', label: 'Left Earbud', tone: 'cyan' },
              { key: 'right', label: 'Right Earbud', tone: 'indigo' },
              { key: 'case', label: 'Smart Case', tone: 'amber' },
            ] as const
          ).map((tab) => (
            <ActionChip
              key={tab.key}
              label={tab.label}
              active={activeKeyTab === tab.key}
              tone={tab.tone}
              onPress={() => setActiveKeyTab(tab.key)}
              style={SHARED_LAYOUT_STYLES.flexOne}
            />
          ))}
        </View>

        <View style={styles.gestureList}>
          {activeKeyTab === 'case'
            ? CASE_GESTURES.map((g) => {
                const currentFn = resolveCaseFn(earbuds.keyMappings.caseKeys?.[g.key]);
                return (
                  <View key={g.key} style={styles.gestureBlock}>
                    <View style={styles.gestureHeader}>
                      <Text style={TYPOGRAPHY.cardTitle}>{g.label}</Text>
                      <Text style={styles.gestureCurrent}>{keyFnLabel(currentFn)}</Text>
                    </View>
                    <View style={SHARED_LAYOUT_STYLES.chipWrap}>
                      {KEY_FUNCTION_OPTIONS.map((opt) => (
                        <ActionChip
                          key={opt.code}
                          label={opt.label}
                          compact
                          active={currentFn === opt.code}
                          disabled={!connected}
                          tone="amber"
                          onPress={() =>
                            actions.run(`${g.label} -> ${opt.label}`, () =>
                              manager.setEarbudsCaseKeyMapping(g.key, opt.code),
                            )
                          }
                        />
                      ))}
                    </View>
                  </View>
                );
              })
            : EARBUD_GESTURES.map((g) => {
                const sideMap =
                  activeKeyTab === 'left'
                    ? earbuds.keyMappings.left
                    : earbuds.keyMappings.right;
                const currentFn = sideMap[g.key] ?? EARBUD_KEY_FUNCTION.NONE;
                return (
                  <View key={g.key} style={styles.gestureBlock}>
                    <View style={styles.gestureHeader}>
                      <Text style={TYPOGRAPHY.cardTitle}>
                        {activeKeyTab === 'left' ? 'Left' : 'Right'} · {g.label}
                      </Text>
                      <Text style={styles.gestureCurrent}>{keyFnLabel(currentFn)}</Text>
                    </View>
                    <View style={SHARED_LAYOUT_STYLES.chipWrap}>
                      {KEY_FUNCTION_OPTIONS.map((opt) => (
                        <ActionChip
                          key={opt.code}
                          label={opt.label}
                          compact
                          active={currentFn === opt.code}
                          disabled={!connected}
                          tone={activeKeyTab === 'left' ? 'cyan' : 'indigo'}
                          onPress={() =>
                            actions.run(`${activeKeyTab} ${g.label} -> ${opt.label}`, () =>
                              manager.setEarbudsKeyMapping(activeKeyTab, g.key, opt.code),
                            )
                          }
                        />
                      ))}
                    </View>
                  </View>
                );
              })}
        </View>
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  gestureList: { gap: SPACING.md, marginTop: SPACING.md },
  gestureBlock: {
    padding: SPACING.md,
    backgroundColor: COLORS.surfaceWell,
    borderRadius: RADII.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: SPACING.xs,
  },
  gestureHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  gestureCurrent: { fontSize: 11, fontFamily: MONO_FONT, color: COLORS.cyan },
});
