/**
 * Public exports for the SQLite storage submodule.
 */

export type { HealthAggregates } from '../types.ts';
export {
  DEFAULT_SQLITE_DB_NAME,
  PREF_KEY_EARBUD_PREFS,
  PREF_KEY_WATCH_SETTINGS,
  SQLITE_DRIVER_KIND,
  SQLITE_SCHEMA_DDL,
  SQLITE_TABLE_NAMES,
} from './schema.ts';
export type { SqliteDriverKind, SqliteTableName } from './schema.ts';
export {
  ExpoSqliteStorageBackend,
  createExpoSqliteDriver,
  createNodeSqliteDriver,
  isSqliteDriver,
  tryCreateExpoSqliteDriver,
  tryCreateNodeSqliteDriver,
  withDriverLock,
} from './drivers.ts';
export type {
  ExpoSqliteDatabaseLike,
  ExpoSqliteModuleLike,
  ExpoSqliteStorageBackendOptions,
  SqliteDriver,
} from './drivers.ts';
export { UltimaSqliteDatabase } from './UltimaSqliteDatabase.ts';
