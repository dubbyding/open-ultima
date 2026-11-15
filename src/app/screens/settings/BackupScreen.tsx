import React from 'react';
import { Share, StyleSheet } from 'react-native';
import { Button, Dialog, Portal, Text, TextInput } from 'react-native-paper';

import { IMPORT_MODE } from '../../../storage/offlineStore.ts';
import { M3 } from '../../../domains/shared/theme/tokens.ts';
import { useApp } from '../../AppContext.tsx';
import { Banner, Card, Muted, Row, RowGroup, Screen, SectionLabel, useTask } from '../../ui.tsx';

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Export, restore and erase the data stored on this phone. */
export function BackupScreen(): React.ReactElement {
  const { store, storeState, onStoreChanged } = useApp();
  const { busy, run } = useTask();
  const [restoreText, setRestoreText] = React.useState('');
  const [restoreOpen, setRestoreOpen] = React.useState(false);
  const [restoreError, setRestoreError] = React.useState<string | null>(null);
  const [confirmErase, setConfirmErase] = React.useState(false);

  const summary = [
    plural(storeState.healthHistory.length, 'day') + ' of health data',
    plural(storeState.pairedDevices.length, 'saved device'),
    plural(storeState.watchAlarms.length, 'alarm'),
    plural(storeState.customEqProfiles.length, 'custom sound profile'),
  ].join(' · ');

  const restore = (): void => {
    setRestoreError(null);
    void run(
      'restore',
      async () => {
        const result = await store.tryImportJson(restoreText, { mode: IMPORT_MODE.MERGE });
        onStoreChanged();
        if (!result.ok) {
          setRestoreError('That doesn’t look like an Ultima Open backup. Paste the full text you exported.');
          throw new Error('Backup not recognised');
        }
        setRestoreText('');
        setRestoreOpen(false);
      },
      { success: 'Backup restored', failure: 'Couldn’t restore' },
    );
  };

  return (
    <Screen>
      <Card>
        <Text variant="titleMedium" style={styles.onSurface}>
          Stored on this phone
        </Text>
        <Muted>{summary}</Muted>
        <Muted>Nothing is uploaded. Export a backup before switching phones.</Muted>
      </Card>

      <SectionLabel>Export</SectionLabel>
      <RowGroup>
        <Row
          icon="export-variant"
          tone="emerald"
          title="Export backup"
          subtitle="Everything: devices, settings, alarms and health history"
          right="chevron"
          disabled={busy('export')}
          onPress={() =>
            void run('export', () => Share.share({ title: 'Ultima Open backup', message: store.exportJson() }), {
              failure: 'Couldn’t export',
            })
          }
        />
        <Row
          icon="file-delimited-outline"
          tone="cyan"
          title="Export health data"
          subtitle="Spreadsheet (CSV) of your daily steps, sleep and heart rate"
          right="chevron"
          disabled={busy('csv') || storeState.healthHistory.length === 0}
          onPress={() =>
            void run('csv', () => Share.share({ title: 'Ultima Open health data', message: store.exportHealthCsv() }), {
              failure: 'Couldn’t export',
            })
          }
        />
      </RowGroup>

      <SectionLabel>Restore</SectionLabel>
      <RowGroup>
        <Row
          icon="backup-restore"
          tone="indigo"
          title="Restore from backup"
          subtitle="Paste a backup you exported earlier. It’s merged with what’s here."
          right={restoreOpen ? null : 'chevron'}
          onPress={() => setRestoreOpen((o) => !o)}
        />
      </RowGroup>
      {restoreOpen ? (
        <Card>
          <TextInput
            mode="outlined"
            multiline
            value={restoreText}
            onChangeText={(t) => {
              setRestoreText(t);
              setRestoreError(null);
            }}
            placeholder="Paste backup text here"
            style={styles.input}
            outlineStyle={styles.inputOutline}
          />
          {restoreError ? <Banner tone="rose" icon="alert-circle-outline" text={restoreError} /> : null}
          <Button
            mode="contained"
            icon="backup-restore"
            disabled={restoreText.trim().length === 0 || busy('restore')}
            loading={busy('restore')}
            onPress={restore}
            style={styles.button}
            contentStyle={styles.buttonContent}
          >
            Restore
          </Button>
        </Card>
      ) : null}

      <SectionLabel>Danger zone</SectionLabel>
      <RowGroup>
        <Row
          icon="delete-forever-outline"
          danger
          title="Erase all data"
          subtitle="Removes saved devices, settings, alarms and health history from this phone"
          disabled={busy('erase')}
          onPress={() => setConfirmErase(true)}
        />
      </RowGroup>

      <Portal>
        <Dialog visible={confirmErase} onDismiss={() => setConfirmErase(false)}>
          <Dialog.Title>Erase all data?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">This can’t be undone. Export a backup first if you might need it.</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirmErase(false)}>Cancel</Button>
            <Button
              textColor={M3.error}
              onPress={() => {
                setConfirmErase(false);
                void run(
                  'erase',
                  async () => {
                    await store.resetAll();
                    onStoreChanged();
                  },
                  { success: 'All data erased', failure: 'Couldn’t erase' },
                );
              }}
            >
              Erase
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  onSurface: { color: M3.onSurface },
  input: { backgroundColor: M3.surfaceContainer, minHeight: 120, maxHeight: 240 },
  inputOutline: { borderRadius: 16 },
  button: { marginTop: 12 },
  buttonContent: { height: 48 },
});
