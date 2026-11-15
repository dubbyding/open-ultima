/**
 * One-way export of everything stored on the phone to a Google Sheet in the
 * user's Drive, one tab per table. Sign-in uses Google's Android account
 * picker with the narrow `drive.file` scope: the app can only see the
 * spreadsheet it created. Each sync rewrites the tabs from local data.
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type * as GoogleSigninModule from '@react-native-google-signin/google-signin';
import type { OfflineAppState } from '../storage/types.ts';
import { buildSheetTables } from './tables.ts';
import type { SheetTable } from './tables.ts';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://sheets.googleapis.com/v4/spreadsheets';
const STATE_KEY = 'ultima.googleSheets.v1';
const TITLE = 'Ultima Open';

export interface SheetsSyncState {
  enabled: boolean;
  account: string | null;
  spreadsheetId: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  rows: number;
}

const emptyState = (): SheetsSyncState => ({ enabled: false, account: null, spreadsheetId: null, lastSyncAt: null, lastError: null, rows: 0 });

export function spreadsheetUrl(id: string): string {
  return `https://docs.google.com/spreadsheets/d/${id}/edit`;
}

type GS = typeof GoogleSigninModule;
let gsModule: GS | null | undefined;
/** Loaded on first use so a build without the native module still starts. */
function gs(): GS {
  if (gsModule === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      gsModule = require('@react-native-google-signin/google-signin') as GS;
    } catch {
      gsModule = null;
    }
  }
  if (!gsModule) throw new Error('Google sign-in isn’t in this build of the app. Rebuild and reinstall it.');
  return gsModule;
}

let configured = false;
function configure(): void {
  if (configured) return;
  const { GoogleSignin } = gs();
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  GoogleSignin.configure({ scopes: [SCOPE], ...(Platform.OS === 'ios' && iosClientId ? { iosClientId } : {}) });
  configured = true;
}

class SheetsExporter {
  private state: SheetsSyncState = emptyState();
  private loaded: Promise<void> | null = null;
  private running: Promise<number> | null = null;
  private readonly listeners = new Set<() => void>();
  syncing = false;

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  getState(): SheetsSyncState {
    return this.state;
  }

  load(): Promise<void> {
    this.loaded ??= (async () => {
      try {
        const raw = await AsyncStorage.getItem(STATE_KEY);
        if (raw) this.state = { ...emptyState(), ...(JSON.parse(raw) as Partial<SheetsSyncState>) };
      } catch {
        // Start fresh.
      }
      this.emit();
    })();
    return this.loaded;
  }

  private async update(patch: Partial<SheetsSyncState>): Promise<void> {
    this.state = { ...this.state, ...patch };
    this.emit();
    await AsyncStorage.setItem(STATE_KEY, JSON.stringify(this.state)).catch(() => undefined);
  }

  async connect(): Promise<void> {
    configure();
    const { GoogleSignin, isErrorWithCode, isSuccessResponse, statusCodes } = gs();
    if (Platform.OS === 'ios' && !process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID) {
      throw new Error('Add EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID to .env and rebuild to sign in on iPhone.');
    }
    if (Platform.OS === 'android') await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    let res;
    try {
      res = await GoogleSignin.signIn();
    } catch (err) {
      if (isErrorWithCode(err) && err.code === statusCodes.IN_PROGRESS) throw new Error('Sign-in already open.');
      if (isErrorWithCode(err) && err.code === 'DEVELOPER_ERROR') {
        throw new Error('Google sign-in isn’t set up for this app yet (Android OAuth client with this app’s SHA-1).');
      }
      throw err;
    }
    if (!isSuccessResponse(res)) throw new Error('Sign-in cancelled.');
    if (!res.data.scopes.includes(SCOPE)) {
      const added = await GoogleSignin.addScopes({ scopes: [SCOPE] });
      if (!added) throw new Error('Allow access to the Ultima Open spreadsheet to continue.');
    }
    await this.update({ enabled: true, account: res.data.user.email, lastError: null });
  }

  async disconnect(): Promise<void> {
    configure();
    const { GoogleSignin, isErrorWithCode, isSuccessResponse, statusCodes } = gs();
    await GoogleSignin.revokeAccess().catch(() => undefined);
    await GoogleSignin.signOut().catch(() => undefined);
    // Keep the spreadsheet id so reconnecting the same account keeps writing to the same file.
    await this.update({ enabled: false, account: null, lastError: null });
  }

  private async token(): Promise<string> {
    configure();
    const { GoogleSignin, isErrorWithCode, isSuccessResponse, statusCodes } = gs();
    if (!GoogleSignin.hasPreviousSignIn()) throw new Error('Sign in to Google again.');
    if (!GoogleSignin.getCurrentUser()) {
      const silent = await GoogleSignin.signInSilently();
      if (silent.type !== 'success') throw new Error('Sign in to Google again.');
    }
    return (await GoogleSignin.getTokens()).accessToken;
  }

  private async api<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
    const token = await this.token();
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    if (res.status === 401 && !retried) {
      await gs().GoogleSignin.clearCachedAccessToken(token);
      return this.api<T>(path, init, true);
    }
    const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; status?: string } };
    if (!res.ok) {
      const e = new Error(json.error?.message ?? `Google Sheets error ${res.status}`) as Error & { status?: number };
      e.status = res.status;
      throw e;
    }
    return json;
  }

  /** Finds or creates the spreadsheet and makes sure every tab exists. */
  private async ensureSpreadsheet(titles: readonly string[]): Promise<string> {
    if (this.state.spreadsheetId) {
      try {
        const meta = await this.api<{ sheets: { properties: { title: string } }[] }>(
          `/${this.state.spreadsheetId}?fields=sheets.properties.title`,
        );
        const have = new Set(meta.sheets.map((s) => s.properties.title));
        const missing = titles.filter((t) => !have.has(t));
        if (missing.length > 0) {
          await this.api(`/${this.state.spreadsheetId}:batchUpdate`, {
            method: 'POST',
            body: JSON.stringify({ requests: missing.map((title) => ({ addSheet: { properties: { title } } })) }),
          });
        }
        return this.state.spreadsheetId;
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status !== 404 && status !== 403) throw err;
        // The file was deleted or belongs to another account: start a new one.
      }
    }
    const created = await this.api<{ spreadsheetId: string }>('', {
      method: 'POST',
      body: JSON.stringify({ properties: { title: TITLE }, sheets: titles.map((title) => ({ properties: { title } })) }),
    });
    await this.update({ spreadsheetId: created.spreadsheetId });
    return created.spreadsheetId;
  }

  private async write(id: string, tables: readonly SheetTable[]): Promise<number> {
    const range = (t: SheetTable): string => `'${t.title.replace(/'/g, "''")}'`;
    await this.api(`/${id}/values:batchClear`, { method: 'POST', body: JSON.stringify({ ranges: tables.map(range) }) });
    await this.api(`/${id}/values:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({
        valueInputOption: 'RAW',
        data: tables.map((t) => ({ range: `${range(t)}!A1`, values: t.rows })),
      }),
    });
    return tables.reduce((n, t) => n + Math.max(0, t.rows.length - 1), 0);
  }

  /** Rewrites every tab from local data. Concurrent calls share one run. */
  sync(state: OfflineAppState): Promise<number> {
    this.running ??= (async () => {
      await this.load();
      if (!this.state.enabled) return 0;
      this.syncing = true;
      this.emit();
      try {
        const tables = buildSheetTables(state);
        const id = await this.ensureSpreadsheet(tables.map((t) => t.title));
        const rows = await this.write(id, tables);
        await this.update({ lastSyncAt: new Date().toISOString(), lastError: null, rows });
        return rows;
      } catch (err) {
        await this.update({ lastError: err instanceof Error ? err.message : String(err) });
        throw err;
      } finally {
        this.syncing = false;
        this.running = null;
        this.emit();
      }
    })();
    return this.running;
  }
}

export const sheetsExporter = new SheetsExporter();
