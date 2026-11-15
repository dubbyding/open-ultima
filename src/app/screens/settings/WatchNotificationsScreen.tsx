import React from 'react';
import { StyleSheet } from 'react-native';
import { Button, TextInput } from 'react-native-paper';

import { CRP_MESSAGE_TYPE } from '../../../protocols/ultimaFitCrrepa.ts';
import { M3 } from '../../../domains/shared/theme/tokens.ts';
import { useApp } from '../../AppContext.tsx';
import { Banner, Card, ChoiceTiles, Muted, Row, RowGroup, Screen, SectionLabel, timeAgo, useTask } from '../../ui.tsx';
import type { Choice } from '../../ui.tsx';

const APPS: readonly Choice<number>[] = [
  { value: CRP_MESSAGE_TYPE.CALL, label: 'Phone', icon: 'phone' },
  { value: CRP_MESSAGE_TYPE.SMS, label: 'Messages', icon: 'message-text' },
  { value: CRP_MESSAGE_TYPE.WHATSAPP, label: 'WhatsApp', icon: 'whatsapp' },
  { value: CRP_MESSAGE_TYPE.INSTAGRAM, label: 'Instagram', icon: 'instagram' },
  { value: CRP_MESSAGE_TYPE.TELEGRAM, label: 'Telegram', icon: 'send' },
  { value: CRP_MESSAGE_TYPE.MESSENGER, label: 'Messenger', icon: 'facebook-messenger' },
  { value: CRP_MESSAGE_TYPE.GMAIL, label: 'Gmail', icon: 'gmail' },
  { value: CRP_MESSAGE_TYPE.SLACK, label: 'Slack', icon: 'slack' },
  { value: CRP_MESSAGE_TYPE.DISCORD, label: 'Discord', icon: 'discord' },
  { value: CRP_MESSAGE_TYPE.YOUTUBE, label: 'YouTube', icon: 'youtube' },
  { value: CRP_MESSAGE_TYPE.CALENDAR_GOOGLE, label: 'Calendar', icon: 'calendar' },
  { value: CRP_MESSAGE_TYPE.OTHER, label: 'Other', icon: 'apps' },
];

function appLabel(code: number): string {
  return APPS.find((a) => a.value === code)?.label ?? 'App';
}

/** Sends a test notification so the user can check their watch shows them. */
export function WatchNotificationsScreen(): React.ReactElement {
  const { snapshot, manager } = useApp();
  const { busy, run } = useTask();
  const watch = snapshot.watch;
  const [app, setApp] = React.useState<number>(CRP_MESSAGE_TYPE.WHATSAPP);
  const [text, setText] = React.useState('Hello from Ultima Open');
  const last = watch.lastNotification;

  return (
    <Screen>
      {!watch.connected ? <Banner icon="watch-variant" text="Connect your watch to send a test notification." /> : null}
      <Muted>Send a test notification to check your watch shows them. Pick which app it should look like it came from.</Muted>

      <SectionLabel>App</SectionLabel>
      <Card>
        <ChoiceTiles options={APPS} value={app} columns={2} onChange={setApp} />
      </Card>

      <SectionLabel>Message</SectionLabel>
      <TextInput
        mode="outlined"
        value={text}
        onChangeText={setText}
        placeholder="Type a short message"
        maxLength={120}
        multiline
        outlineStyle={styles.inputOutline}
        style={styles.input}
      />

      <Button
        mode="contained"
        icon="send"
        disabled={!watch.connected || text.trim().length === 0 || busy('send')}
        loading={busy('send')}
        onPress={() =>
          void run('send', () => manager.pushWatchNotification(app, text.trim()), {
            success: 'Sent. Check your watch.',
            failure: 'Couldn’t send the notification',
          })
        }
        contentStyle={styles.buttonContent}
        style={styles.button}
      >
        Send to watch
      </Button>

      {last ? (
        <>
          <SectionLabel>Last sent</SectionLabel>
          <RowGroup>
            <Row
              icon={APPS.find((a) => a.value === last.messageType)?.icon ?? 'bell-outline'}
              tone="indigo"
              title={`“${last.text}”`}
              subtitle={`${appLabel(last.messageType)} · ${timeAgo(last.sentAt) ?? ''}`}
            />
          </RowGroup>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: { backgroundColor: M3.surfaceContainer },
  inputOutline: { borderRadius: 16 },
  button: { marginTop: 8 },
  buttonContent: { height: 52 },
});
