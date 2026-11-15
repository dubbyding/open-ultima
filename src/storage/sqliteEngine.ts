/**
 * Thin barrel re-exporting SQLite storage engine APIs from the storage domain.
 */

export type {
  ExpoSqliteDatabaseLike,
  ExpoSqliteModuleLike,
  ExpoSqliteStorageBackendOptions,
  HealthAggregates,
  SqliteDriver,
  SqliteDriverKind,
  SqliteTableName,
} from '../domains/storage/sqlite/index.ts';
export {
  DEFAULT_SQLITE_DB_NAME,
  ExpoSqliteStorageBackend,
  SQLITE_DRIVER_KIND,
  SQLITE_TABLE_NAMES,
  UltimaSqliteDatabase,
  createExpoSqliteDriver,
  createNodeSqliteDriver,
  tryCreateExpoSqliteDriver,
} from '../domains/storage/sqlite/index.ts';
