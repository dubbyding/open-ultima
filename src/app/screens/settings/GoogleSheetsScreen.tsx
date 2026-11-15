import React from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';

import { M3 } from '../../../domains/shared/theme/tokens.ts';
import { sheetsExporter, spreadsheetUrl } from '../../../domains/sheets/googleSheets.ts';
import { buildSheetTables } from '../../../domains/sheets/tables.ts';
import { useApp } from '../../AppContext.tsx';
import { Banner, Card, HStack, IconBadge, Muted, Row, RowGroup, Screen, SectionLabel, timeAgo, useTask } from '../../ui.tsx';

export function useSheetsState(): ReturnType<typeof sheetsExporter.getState> & { syncing: boolean } {
  const [, force] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    void sheetsExporter.load();
    return sheetsExporter.subscribe(force);
  }, []);
  return { ...sheetsExporter.getState(), syncing: sheetsExporter.syncing };
}

export function GoogleSheetsScreen(): React.ReactElement {
  const { storeState } = useApp();
  const { run, busy } = useTask();
  const s = useSheetsState();
  const tables = React.useMemo(() => buildSheetTables(storeState), [storeState]);
  const syncing = s.syncing || busy('sync');

  const syncNow = (): void =>
    void run('sync', async () => {
      await sheetsExporter.sync(storeState);
    }, { success: 'Sheet updated', failure: 'Couldn’t update the sheet' });

  return (
    <Screen>
      <Card>
        <HStack align="flex-start">
          <IconBadge icon="google-spreadsheet" tone="emerald" size={48} />
          <View style={styles.flex1}>
            <Text variant="titleMedium" style={styles.title}>
              Copy your data to Google Sheets
            </Text>
            <Muted>
              The app keeps a spreadsheet called “Ultima Open” in your Google Drive, one tab per table. It’s updated from this phone
              automatically; edits made in the sheet aren’t read back and get replaced on the next update.
            </Muted>
          </View>
        </HStack>
      </Card>

      {s.enabled ? (
        <>
          <RowGroup>
            <Row icon="account-circle-outline" tone="neutral" title={s.account ?? 'Google account'} subtitle="Signed in" />
            {s.spreadsheetId ? (
              <Row
                icon="open-in-new"
                tone="emerald"
                title="Open spreadsheet"
                subtitle={s.lastSyncAt ? `Updated ${timeAgo(Date.parse(s.lastSyncAt))} · ${s.rows} rows` : 'Not updated yet'}
                right="chevron"
                onPress={() => void Linking.openURL(spreadsheetUrl(s.spreadsheetId!))}
              />
            ) : null}
          </RowGroup>
          {s.lastError ? <Banner tone="rose" icon="alert-circle-outline" text={s.lastError} /> : null}
          <Button mode="contained" icon="sync" loading={syncing} disabled={syncing} contentStyle={styles.btn} onPress={syncNow}>
            {syncing ? 'Updating…' : 'Update now'}
          </Button>
          <Button
            textColor={M3.error}
            onPress={() => void run('off', () => sheetsExporter.disconnect(), { success: 'Signed out of Google', failure: 'Couldn’t sign out' })}
          >
            Stop and sign out
          </Button>
        </>
      ) : (
        <>
          {s.lastError ? <Banner tone="rose" icon="alert-circle-outline" text={s.lastError} /> : null}
          <Button
            mode="contained"
            icon="google"
            loading={busy('connect')}
            disabled={busy('connect')}
            contentStyle={styles.btn}
            onPress={() =>
              void run('connect', async () => {
                await sheetsExporter.connect();
                await sheetsExporter.sync(storeState);
              }, { success: 'Spreadsheet created', failure: 'Couldn’t connect Google' })
            }
          >
            Connect Google account
          </Button>
          <Muted center>Ultima Open can only see the spreadsheet it creates — nothing else in your Drive.</Muted>
        </>
      )}

      <SectionLabel>Tabs</SectionLabel>
      <RowGroup>
        {tables.map((t) => (
          <Row key={t.title} icon="table" tone="neutral" title={t.title} subtitle={`${Math.max(0, t.rows.length - 1)} rows`} />
        ))}
      </RowGroup>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1, gap: 4 },
  title: { color: M3.onSurface },
  btn: { height: 52 },
});
