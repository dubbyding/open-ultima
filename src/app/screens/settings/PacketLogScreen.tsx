import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, List, Text, TextInput } from 'react-native-paper';

import { CRP_CMD } from '../../../protocols/ultimaFitCrrepa.ts';
import { PACKET_DIRECTION } from '../../../services/bleManager.ts';
import type { PacketLogEntry } from '../../../services/bleManager.ts';
import { M3, MONO_FONT } from '../../../domains/shared/theme/tokens.ts';
import { useApp } from '../../AppContext.tsx';
import { Card, ChoiceTiles, EmptyState, HStack, Muted, Pill, Screen, SectionLabel, useTask } from '../../ui.tsx';
import type { Choice } from '../../ui.tsx';

type Filter = 'all' | 'TX' | 'RX';

const FILTERS: readonly Choice<Filter>[] = [
  { value: 'all', label: 'All' },
  { value: 'TX', label: 'Sent', icon: 'arrow-up' },
  { value: 'RX', label: 'Received', icon: 'arrow-down' },
];

/** Reverse lookup of watch command ids → readable names, e.g. 0x2E → "Query device version". */
const CRP_NAMES: ReadonlyMap<number, string> = (() => {
  const m = new Map<number, string>();
  for (const [key, value] of Object.entries(CRP_CMD as Record<string, number>)) {
    if (typeof value !== 'number' || m.has(value)) continue;
    const words = key.toLowerCase().split('_').join(' ');
    m.set(value, words.charAt(0).toUpperCase() + words.slice(1));
  }
  return m;
})();

function entryTitle(e: PacketLogEntry): string {
  if (e.protocol === 'crrepa' && e.cmd !== undefined) {
    const name = CRP_NAMES.get(e.cmd);
    const hex = `0x${e.cmd.toString(16).toUpperCase().padStart(2, '0')}`;
    return name ? `${name} (${hex})` : `Command ${hex}`;
  }
  return e.label || e.summary;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** Developer view of every message sent to / received from the devices. */
export function PacketLogScreen(): React.ReactElement {
  const { snapshot, manager } = useApp();
  const { busy, run } = useTask();
  const [filter, setFilter] = React.useState<Filter>('all');
  const [rawOpen, setRawOpen] = React.useState(false);
  const [rawTarget, setRawTarget] = React.useState<'earbuds' | 'watch'>('watch');
  const [rawHex, setRawHex] = React.useState('FE EA 10 06 00 61');

  const logs = snapshot.packetLogs;
  const shown = React.useMemo(
    () => [...(filter === 'all' ? logs : logs.filter((p) => p.direction === filter))].reverse().slice(0, 100),
    [logs, filter],
  );
  const sent = logs.filter((p) => p.direction === PACKET_DIRECTION.TX).length;

  return (
    <Screen>
      <HStack>
        <Muted>
          {logs.length} messages · {sent} sent · {logs.length - sent} received
        </Muted>
        <View style={styles.flex} />
        <Button mode="text" icon="delete-sweep-outline" disabled={logs.length === 0} onPress={() => manager.clearPacketLogs()}>
          Clear
        </Button>
      </HStack>
      <ChoiceTiles options={FILTERS} value={filter} columns={3} onChange={setFilter} />

      {shown.length === 0 ? (
        <EmptyState icon="swap-vertical" title="Nothing captured yet" body="Connect your earbuds or watch and messages will appear here live." />
      ) : (
        shown.map((e) => {
          const tx = e.direction === PACKET_DIRECTION.TX;
          return (
            <Card key={e.id}>
              <HStack gap={8}>
                <Pill label={tx ? 'Sent' : 'Received'} tone={tx ? 'cyan' : 'emerald'} icon={tx ? 'arrow-up' : 'arrow-down'} />
                <Muted>
                  {e.target === 'watch' ? 'Watch' : 'Earbuds'} · {e.length ?? e.byteLength} bytes
                </Muted>
                <View style={styles.flex} />
                <Text variant="labelSmall" style={styles.time}>
                  {formatTime(e.timestamp)}
                </Text>
              </HStack>
              <Text variant="titleSmall" style={styles.title}>
                {entryTitle(e)}
              </Text>
              <Text selectable style={styles.hex}>
                {e.hex}
              </Text>
            </Card>
          );
        })
      )}
      {logs.length > shown.length ? <Muted center>Showing the latest {shown.length} messages</Muted> : null}

      <SectionLabel>Advanced</SectionLabel>
      <Card padded={false}>
        <List.Accordion
          title="Send raw bytes"
          description="For protocol testing only"
          expanded={rawOpen}
          onPress={() => setRawOpen((o) => !o)}
          style={styles.accordion}
          titleStyle={styles.title}
          left={(p) => <List.Icon {...p} icon="console" />}
        >
          <View style={styles.rawBody}>
            <ChoiceTiles
              options={[
                { value: 'watch', label: 'Watch', icon: 'watch-variant' },
                { value: 'earbuds', label: 'Earbuds', icon: 'earbuds' },
              ]}
              value={rawTarget}
              onChange={(t) => {
                setRawTarget(t);
                setRawHex(t === 'watch' ? 'FE EA 10 06 00 61' : 'AA00010700');
              }}
            />
            <TextInput
              mode="outlined"
              value={rawHex}
              onChangeText={setRawHex}
              autoCapitalize="characters"
              placeholder="Hex bytes, e.g. FE EA 10 06 00 61"
              style={styles.input}
              contentStyle={styles.mono}
              outlineStyle={styles.inputOutline}
            />
            <Button
              mode="contained"
              icon="send"
              loading={busy('raw')}
              disabled={busy('raw') || rawHex.trim().length === 0}
              onPress={() => void run('raw', () => manager.sendRawHex(rawTarget, rawHex), { success: 'Sent', failure: 'Couldn’t send' })}
            >
              Send
            </Button>
          </View>
        </List.Accordion>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  title: { color: M3.onSurface, marginTop: 8 },
  time: { color: M3.onSurfaceVariant, fontFamily: MONO_FONT },
  hex: { fontFamily: MONO_FONT, fontSize: 12, lineHeight: 18, color: M3.primary, marginTop: 4 },
  accordion: { backgroundColor: M3.surfaceContainer },
  rawBody: { padding: 16, gap: 12 },
  input: { backgroundColor: M3.surfaceContainer },
  inputOutline: { borderRadius: 12 },
  mono: { fontFamily: MONO_FONT },
});
