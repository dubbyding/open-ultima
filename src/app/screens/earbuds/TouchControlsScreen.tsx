import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Button, Dialog, Portal, RadioButton, SegmentedButtons } from 'react-native-paper';

import { EARBUD_GESTURE, EARBUD_KEY_FUNCTION, VOICE_LANGUAGE } from '../../../storage/offlineStore.ts';
import type { EarbudGesture, EarbudKeyFunction, VoiceLanguage } from '../../../storage/offlineStore.ts';
import { M3 } from '../../../domains/shared/theme/tokens.ts';
import { useApp } from '../../AppContext.tsx';
import { ChoiceTiles, Muted, Row, RowGroup, Screen, SectionLabel, useTask } from '../../ui.tsx';
import { EarbudsNotConnectedBanner } from './EarbudsScreen.tsx';

const ACTIONS: readonly { code: EarbudKeyFunction; label: string }[] = [
  { code: EARBUD_KEY_FUNCTION.PLAY_PAUSE, label: 'Play / Pause' },
  { code: EARBUD_KEY_FUNCTION.NEXT, label: 'Next track' },
  { code: EARBUD_KEY_FUNCTION.PREVIOUS, label: 'Previous track' },
  { code: EARBUD_KEY_FUNCTION.VOLUME_UP, label: 'Volume up' },
  { code: EARBUD_KEY_FUNCTION.VOLUME_DOWN, label: 'Volume down' },
  { code: EARBUD_KEY_FUNCTION.ANC_MODE, label: 'Switch noise control' },
  { code: EARBUD_KEY_FUNCTION.GAME_MODE, label: 'Low-latency mode' },
  { code: EARBUD_KEY_FUNCTION.VOICE_ASSISTANT, label: 'Voice assistant' },
  { code: EARBUD_KEY_FUNCTION.RECALL, label: 'Call back last number' },
  { code: EARBUD_KEY_FUNCTION.NONE, label: 'Nothing' },
];

const GESTURES: readonly { key: EarbudGesture; label: string; icon: string }[] = [
  { key: EARBUD_GESTURE.SINGLE, label: 'Single tap', icon: 'gesture-tap' },
  { key: EARBUD_GESTURE.DOUBLE, label: 'Double tap', icon: 'gesture-double-tap' },
  { key: EARBUD_GESTURE.TRIPLE, label: 'Triple tap', icon: 'gesture-tap-button' },
  { key: EARBUD_GESTURE.LONG_PRESS, label: 'Press and hold', icon: 'gesture-tap-hold' },
];

function actionLabel(code: number | undefined): string {
  return ACTIONS.find((a) => a.code === code)?.label ?? 'Custom';
}

export function TouchControlsScreen(): React.ReactElement {
  const { snapshot, manager } = useApp();
  const { run, busy } = useTask();
  const earbuds = snapshot.earbuds;
  const connected = earbuds.connected;
  const [side, setSide] = React.useState<'left' | 'right'>('left');
  const [editing, setEditing] = React.useState<EarbudGesture | null>(null);

  const mapping = side === 'left' ? earbuds.keyMappings.left : earbuds.keyMappings.right;
  // Only offer what these earbuds reported (null = unknown → offer everything).
  const fs = earbuds.featureSupport;
  const gestures = fs && fs.gestures.length > 0 ? GESTURES.filter((g) => fs.gestures.includes(g.key)) : GESTURES;
  const actions = fs ? ACTIONS.filter((a) => fs.keyFunctions.includes(a.code)) : ACTIONS;
  const showLanguage = fs ? fs.language : true;
  const sideName = side === 'left' ? 'left' : 'right';
  const editingLabel = GESTURES.find((g) => g.key === editing)?.label ?? '';

  const choose = (code: EarbudKeyFunction): void => {
    const gesture = editing;
    setEditing(null);
    if (!gesture) return;
    void run(`key-${gesture}`, () => manager.setEarbudsKeyMapping(side, gesture, code), {
      failure: 'Couldn’t change the control',
    });
  };

  const languages = [
    { value: VOICE_LANGUAGE.EN as VoiceLanguage, label: 'English' },
    { value: VOICE_LANGUAGE.ZH as VoiceLanguage, label: 'Chinese' },
  ];

  return (
    <Screen>
      <EarbudsNotConnectedBanner />

      <SegmentedButtons
        value={side}
        onValueChange={(v) => setSide(v as 'left' | 'right')}
        buttons={[
          { value: 'left', label: 'Left earbud', icon: 'alpha-l-circle-outline' },
          { value: 'right', label: 'Right earbud', icon: 'alpha-r-circle-outline' },
        ]}
        style={styles.segment}
      />

      <RowGroup>
        {gestures.map((g) => (
          <Row
            key={g.key}
            icon={g.icon}
            title={g.label}
            subtitle={actionLabel(mapping?.[g.key])}
            right="chevron"
            disabled={!connected || busy(`key-${g.key}`)}
            onPress={() => setEditing(g.key)}
          />
        ))}
      </RowGroup>
      <Muted>Tap or hold the outside of the {sideName} earbud.</Muted>

      {showLanguage ? (
        <>
          <SectionLabel>Voice prompts</SectionLabel>
          <ChoiceTiles
            options={languages}
            value={earbuds.voiceLanguage}
            columns={2}
            disabled={!connected || busy('lang')}
            onChange={(lang) => void run('lang', () => manager.setEarbudsLanguage(lang), { failure: 'Couldn’t change the language' })}
          />
        </>
      ) : null}

      <Portal>
        <Dialog visible={editing !== null} onDismiss={() => setEditing(null)} style={styles.dialog}>
          <Dialog.Title>{`${editingLabel} · ${side === 'left' ? 'Left' : 'Right'}`}</Dialog.Title>
          <Dialog.ScrollArea style={styles.scrollArea}>
            <ScrollView>
              <RadioButton.Group
                value={editing ? String(mapping?.[editing] ?? '') : ''}
                onValueChange={(v) => choose(Number(v) as EarbudKeyFunction)}
              >
                {actions.map((a) => (
                  <RadioButton.Item key={a.code} label={a.label} value={String(a.code)} color={M3.primary} />
                ))}
              </RadioButton.Group>
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setEditing(null)}>Cancel</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  segment: { marginTop: 4 },
  dialog: { backgroundColor: M3.surfaceContainerHigh },
  scrollArea: { maxHeight: 420, paddingHorizontal: 0 },
});
