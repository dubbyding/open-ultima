/**
 * Storage backends (`MemoryStorageBackend`, `AsyncStorage` adapter,
 * `createDefaultStorageBackend`, and OfflineStore backend/SQLite wiring).
 */

import {
  ExpoSqliteStorageBackend,
  UltimaSqliteDatabase,
  tryCreateExpoSqliteDriver,
} from './sqlite/index.ts';
import { DEFAULT_STORAGE_KEY } from './types.ts';
import type { OfflineStoreOptions, StorageBackend } from './types.ts';

/** Deterministic in-memory StorageBackend fallback for Node and tests. */
export class MemoryStorageBackend implements StorageBackend {
  private readonly store: Map<string, string>;

  constructor(initialEntries?: Record<string, string>) {
    this.store = new Map<string, string>();
    if (initialEntries) {
      for (const [key, value] of Object.entries(initialEntries)) {
        this.store.set(key, value);
      }
    }
  }

  async getItem(key: string): Promise<string | null> {
    return this.store.has(key) ? (this.store.get(key) ?? null) : null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  keys(): string[] {
    return Array.from(this.store.keys());
  }
}

const asyncStorageBackends = new WeakSet<StorageBackend>();

interface AsyncStorageLike {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** Returns true if `backend` wraps React Native AsyncStorage. */
export function isAsyncStorageBackend(backend: StorageBackend): boolean {
  return asyncStorageBackends.has(backend);
}

/**
 * Resolves `expo-sqlite` first (when running inside Expo / React Native),
 * then `@react-native-async-storage/async-storage`, otherwise falls back safely
 * to an in-memory `MemoryStorageBackend`.
 */
export function createDefaultStorageBackend(): StorageBackend {
  const sqliteDriver = tryCreateExpoSqliteDriver();
  if (sqliteDriver) return new ExpoSqliteStorageBackend(sqliteDriver);
  try {
    if (typeof require === 'function') {
      const mod = require('@react-native-async-storage/async-storage') as
        | AsyncStorageLike
        | { default?: AsyncStorageLike }
        | undefined;
      const candidate =
        mod && typeof mod === 'object' && 'default' in mod && mod.default
          ? mod.default
          : (mod as AsyncStorageLike | undefined);
      if (
        candidate &&
        typeof candidate.getItem === 'function' &&
        typeof candidate.setItem === 'function' &&
        typeof candidate.removeItem === 'function'
      ) {
        const asyncBackend: StorageBackend = {
          getItem: (key: string) => candidate.getItem(key),
          setItem: (key: string, value: string) => candidate.setItem(key, value),
          removeItem: (key: string) => candidate.removeItem(key),
        };
        asyncStorageBackends.add(asyncBackend);
        return asyncBackend;
      }
    }
  } catch {
    // Expected in Node.js or environments without React Native native modules.
  }
  return new MemoryStorageBackend();
}

/** Resolves `backend`, `storageKey`, and optional relational `sqliteDb` for `OfflineStore`. */
export function resolveStoreBackendAndSqlite(
  backendOrOptions?: StorageBackend | OfflineStoreOptions,
  storageKey?: string,
): { backend: StorageBackend; storageKey: string; sqliteDb: UltimaSqliteDatabase | null } {
  if (backendOrOptions && typeof (backendOrOptions as StorageBackend).getItem === 'function') {
    const backend = backendOrOptions as StorageBackend;
    const sqliteDb =
      backend instanceof ExpoSqliteStorageBackend
        ? new UltimaSqliteDatabase(backend.getDriver())
        : null;
    return { backend, storageKey: storageKey ?? DEFAULT_STORAGE_KEY, sqliteDb };
  }
  const opts = backendOrOptions as OfflineStoreOptions | undefined;
  const resolvedKey = opts?.storageKey ?? storageKey ?? DEFAULT_STORAGE_KEY;
  if (opts?.backend) {
    const sqliteDb =
      opts.sqliteDb ??
      (opts.backend instanceof ExpoSqliteStorageBackend
        ? new UltimaSqliteDatabase(opts.backend.getDriver())
        : null);
    return { backend: opts.backend, storageKey: resolvedKey, sqliteDb };
  }
  if (opts?.sqliteDb) {
    return {
      backend: new ExpoSqliteStorageBackend(opts.sqliteDb.getDriver()),
      storageKey: resolvedKey,
      sqliteDb: opts.sqliteDb,
    };
  }
  const backend = createDefaultStorageBackend();
  const sqliteDb =
    backend instanceof ExpoSqliteStorageBackend
      ? new UltimaSqliteDatabase(backend.getDriver())
      : null;
  return { backend, storageKey: resolvedKey, sqliteDb };
}
