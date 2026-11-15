/**
 * SQLite driver interfaces, parameter/row normalization, Expo/Node driver
 * factories, and the `kv_store`-backed `ExpoSqliteStorageBackend`.
 */

import type { StorageBackend } from '../types.ts';
import {
  DEFAULT_SQLITE_DB_NAME,
  KV_STORE_TABLE_DDL,
  SQLITE_DRIVER_KIND,
} from './schema.ts';
import type { SqliteDriverKind } from './schema.ts';

export interface SqliteDriver {
  readonly kind?: SqliteDriverKind;
  exec(sql: string): Promise<void> | void;
  run(sql: string, params?: unknown[]): Promise<void> | void;
  all<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]> | T[];
  close?(): Promise<void> | void;
}

export interface ExpoSqliteDatabaseLike {
  execAsync?(sql: string): Promise<void>;
  runAsync?(sql: string, params?: unknown[]): Promise<unknown>;
  getAllAsync?<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]>;
  closeAsync?(): Promise<void>;
  execSync?(sql: string): void;
  runSync?(sql: string, params?: unknown[]): unknown;
  getAllSync?<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): T[];
  closeSync?(): void;
}

export interface ExpoSqliteModuleLike {
  openDatabaseSync?(dbName: string): ExpoSqliteDatabaseLike;
  openDatabaseAsync?(dbName: string): Promise<ExpoSqliteDatabaseLike>;
}

interface NodeStatementSyncLike {
  run(...params: unknown[]): unknown;
  all(...params: unknown[]): Record<string, unknown>[];
}

interface NodeDatabaseSyncLike {
  exec(sql: string): void;
  prepare(sql: string): NodeStatementSyncLike;
  close(): void;
}

interface NodeSqliteModuleLike {
  DatabaseSync: new (filename: string) => NodeDatabaseSyncLike;
}

export interface ExpoSqliteStorageBackendOptions {
  driver?: SqliteDriver;
  dbName?: string;
}

type SqlParam = null | number | string | bigint | Uint8Array;

function normalizeSqlParams(params?: unknown[]): SqlParam[] {
  if (!params || params.length === 0) return [];
  return params.map((value): SqlParam => {
    if (value === undefined || value === null) return null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (
      typeof value === 'string' ||
      typeof value === 'bigint' ||
      value instanceof Uint8Array
    ) {
      return value;
    }
    return JSON.stringify(value);
  });
}

function normalizeRowObject<T>(row: T): T {
  if (row !== null && typeof row === 'object' && !Array.isArray(row)) {
    return Object.assign({}, row) as T;
  }
  return row;
}

const driverLocks = new WeakMap<SqliteDriver, Promise<void>>();

/** Serializes async operations sharing the same `SqliteDriver` instance. */
export async function withDriverLock<T>(
  driver: SqliteDriver,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = driverLocks.get(driver) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  driverLocks.set(driver, current);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (driverLocks.get(driver) === current) {
      driverLocks.delete(driver);
    }
  }
}

/** Type guard checking whether a value conforms to `SqliteDriver`. */
export function isSqliteDriver(value: unknown): value is SqliteDriver {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<SqliteDriver>;
  return (
    typeof candidate.exec === 'function' &&
    typeof candidate.run === 'function' &&
    typeof candidate.all === 'function'
  );
}

function resolveExpoSqliteModule(): ExpoSqliteModuleLike | null {
  try {
    if (typeof require === 'function') {
      const mod = require('expo-sqlite') as
        | ExpoSqliteModuleLike
        | { default?: ExpoSqliteModuleLike }
        | undefined;
      const candidate =
        mod && typeof mod === 'object' && 'default' in mod && mod.default
          ? mod.default
          : (mod as ExpoSqliteModuleLike | undefined);
      if (
        candidate &&
        (typeof candidate.openDatabaseSync === 'function' ||
          typeof candidate.openDatabaseAsync === 'function')
      ) {
        return candidate;
      }
    }
  } catch {
    // Expected outside Expo / React Native runtimes.
  }
  return null;
}

function resolveNodeSqliteModule(): NodeSqliteModuleLike | null {
  try {
    if (typeof process !== 'undefined') {
      const proc = process as unknown as {
        getBuiltinModule?: (id: string) => unknown;
      };
      if (typeof proc.getBuiltinModule === 'function') {
        const builtinId = ['node', 'sqlite'].join(':');
        const mod = proc.getBuiltinModule(builtinId) as
          | NodeSqliteModuleLike
          | undefined;
        if (mod && typeof mod.DatabaseSync === 'function') {
          return mod;
        }
      }
    }
  } catch {
    // Expected outside Node 22.5+ / Node 24.
  }
  return null;
}

/**
 * Creates a `SqliteDriver` backed by `expo-sqlite` (`openDatabaseSync` or
 * `openDatabaseAsync`). Throws if `expo-sqlite` is unavailable.
 */
export function createExpoSqliteDriver(
  dbName: string = DEFAULT_SQLITE_DB_NAME,
  expoSqliteModule?: ExpoSqliteModuleLike,
): SqliteDriver {
  const mod = expoSqliteModule ?? resolveExpoSqliteModule();
  if (!mod) {
    throw new Error('expo-sqlite module is not available in this runtime');
  }

  let dbPromise: Promise<ExpoSqliteDatabaseLike> | null = null;
  if (typeof mod.openDatabaseSync === 'function') {
    dbPromise = Promise.resolve(mod.openDatabaseSync(dbName));
  } else if (typeof mod.openDatabaseAsync !== 'function') {
    throw new Error(
      'expo-sqlite does not expose openDatabaseSync or openDatabaseAsync',
    );
  }

  const getDb = async (): Promise<ExpoSqliteDatabaseLike> => {
    if (!dbPromise) {
      dbPromise = mod.openDatabaseAsync!(dbName).catch((err: unknown) => {
        dbPromise = null;
        throw err;
      });
    }
    return dbPromise;
  };

  return {
    kind: SQLITE_DRIVER_KIND.EXPO_SQLITE,
    async exec(sql: string): Promise<void> {
      const db = await getDb();
      if (typeof db.execAsync === 'function') {
        await db.execAsync(sql);
      } else if (typeof db.execSync === 'function') {
        db.execSync(sql);
      } else {
        throw new Error('expo-sqlite database missing execAsync/execSync');
      }
    },
    async run(sql: string, params?: unknown[]): Promise<void> {
      const db = await getDb();
      const bound = normalizeSqlParams(params);
      if (typeof db.runAsync === 'function') {
        await db.runAsync(sql, bound);
      } else if (typeof db.runSync === 'function') {
        db.runSync(sql, bound);
      } else {
        throw new Error('expo-sqlite database missing runAsync/runSync');
      }
    },
    async all<T = Record<string, unknown>>(
      sql: string,
      params?: unknown[],
    ): Promise<T[]> {
      const db = await getDb();
      const bound = normalizeSqlParams(params);
      if (typeof db.getAllAsync === 'function') {
        return (await db.getAllAsync<T>(sql, bound)).map(normalizeRowObject);
      }
      if (typeof db.getAllSync === 'function') {
        return db.getAllSync<T>(sql, bound).map(normalizeRowObject);
      }
      throw new Error('expo-sqlite database missing getAllAsync/getAllSync');
    },
    async close(): Promise<void> {
      if (!dbPromise) return;
      const db = await dbPromise;
      dbPromise = null;
      if (typeof db.closeAsync === 'function') {
        await db.closeAsync();
      } else if (typeof db.closeSync === 'function') {
        db.closeSync();
      }
    },
  };
}

/**
 * Attempts to instantiate an `expo-sqlite` driver, returning `null` outside
 * React Native / Expo runtimes.
 */
export function tryCreateExpoSqliteDriver(
  dbName: string = DEFAULT_SQLITE_DB_NAME,
): SqliteDriver | null {
  try {
    const mod = resolveExpoSqliteModule();
    return mod ? createExpoSqliteDriver(dbName, mod) : null;
  } catch {
    return null;
  }
}

/**
 * Creates a `SqliteDriver` backed by Node 24's built-in `node:sqlite`
 * (`DatabaseSync`), defaulting to `':memory:'`.
 */
export function createNodeSqliteDriver(
  filename: string = ':memory:',
): SqliteDriver {
  const mod = resolveNodeSqliteModule();
  if (!mod) {
    throw new Error('node:sqlite built-in module is not available');
  }
  const db = new mod.DatabaseSync(filename);
  let closed = false;

  return {
    kind: SQLITE_DRIVER_KIND.NODE_SQLITE,
    exec(sql: string): void {
      db.exec(sql);
    },
    run(sql: string, params?: unknown[]): void {
      db.prepare(sql).run(...normalizeSqlParams(params));
    },
    all<T = Record<string, unknown>>(
      sql: string,
      params?: unknown[],
    ): T[] {
      return db
        .prepare(sql)
        .all(...normalizeSqlParams(params))
        .map((row) => normalizeRowObject(row) as T);
    },
    close(): void {
      if (!closed) {
        closed = true;
        db.close();
      }
    },
  };
}

/** Attempts to instantiate a `node:sqlite` driver, returning `null` if absent. */
export function tryCreateNodeSqliteDriver(
  filename: string = ':memory:',
): SqliteDriver | null {
  try {
    return resolveNodeSqliteModule() ? createNodeSqliteDriver(filename) : null;
  } catch {
    return null;
  }
}

/**
 * Key-value `StorageBackend` backed by SQLite `kv_store` table.
 */
export class ExpoSqliteStorageBackend implements StorageBackend {
  private readonly driver: SqliteDriver;
  private tableReady: boolean = false;
  private initPromise: Promise<void> | null = null;

  constructor(
    driverOrOptionsOrDbName?:
      | SqliteDriver
      | ExpoSqliteStorageBackendOptions
      | string,
  ) {
    if (isSqliteDriver(driverOrOptionsOrDbName)) {
      this.driver = driverOrOptionsOrDbName;
    } else if (typeof driverOrOptionsOrDbName === 'string') {
      this.driver = createExpoSqliteDriver(driverOrOptionsOrDbName);
    } else if (driverOrOptionsOrDbName?.driver) {
      this.driver = driverOrOptionsOrDbName.driver;
    } else {
      this.driver = createExpoSqliteDriver(
        driverOrOptionsOrDbName?.dbName ?? DEFAULT_SQLITE_DB_NAME,
      );
    }
  }

  getDriver(): SqliteDriver {
    return this.driver;
  }

  getDriverKind(): SqliteDriverKind {
    return this.driver.kind ?? SQLITE_DRIVER_KIND.EXPO_SQLITE;
  }

  private async ensureKvTable(): Promise<void> {
    if (this.tableReady) return;
    if (!this.initPromise) {
      this.initPromise = withDriverLock(this.driver, async () => {
        if (this.tableReady) return;
        await this.driver.exec(KV_STORE_TABLE_DDL);
        this.tableReady = true;
      }).catch((err: unknown) => {
        this.initPromise = null;
        throw err;
      });
    }
    await this.initPromise;
  }

  async getItem(key: string): Promise<string | null> {
    await this.ensureKvTable();
    return withDriverLock(this.driver, async () => {
      const rows = await this.driver.all<{ value: string }>(
        'SELECT value FROM kv_store WHERE key = ? LIMIT 1;',
        [key],
      );
      const val = rows[0]?.value;
      return typeof val === 'string' ? val : null;
    });
  }

  async setItem(key: string, value: string): Promise<void> {
    await this.ensureKvTable();
    await withDriverLock(this.driver, async () => {
      await this.driver.run(
        `INSERT INTO kv_store (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at;`,
        [key, value, Date.now()],
      );
    });
  }

  async removeItem(key: string): Promise<void> {
    await this.ensureKvTable();
    await withDriverLock(this.driver, async () => {
      await this.driver.run('DELETE FROM kv_store WHERE key = ?;', [key]);
    });
  }
}
