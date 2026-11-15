/**
 * `UltimaSqliteDatabase` relational + KV SQLite engine class.
 */

import type {
  DailyHealthRecord,
  GpsWorkoutRoute,
  HealthAggregates,
  OfflineAppState,
} from '../types.ts';
import {
  isSqliteDriver,
  tryCreateExpoSqliteDriver,
  tryCreateNodeSqliteDriver,
  withDriverLock,
} from './drivers.ts';
import type { SqliteDriver } from './drivers.ts';
import {
  getTableRowCountsFromSqlite,
  loadAppStateFromSqlite,
  queryGpsRouteWithWaypointsFromSqlite,
  queryHealthAggregatesFromSqlite,
  queryHealthDateRangeFromSqlite,
  syncAppStateToSqlite,
} from './queries.ts';
import {
  DEFAULT_SQLITE_DB_NAME,
  SQLITE_DRIVER_KIND,
  SQLITE_SCHEMA_DDL,
} from './schema.ts';
import type { SqliteDriverKind } from './schema.ts';

/**
 * Relational + KV SQLite engine managing normalized tables, indexes, atomic
 * transactions, and SQL aggregate analytics for Ultima Open.
 */
export class UltimaSqliteDatabase {
  private readonly driver: SqliteDriver;
  private schemaReady: boolean = false;
  private initPromise: Promise<void> | null = null;

  constructor(driverOrDbName?: SqliteDriver | string) {
    if (isSqliteDriver(driverOrDbName)) {
      this.driver = driverOrDbName;
    } else {
      const name =
        typeof driverOrDbName === 'string'
          ? driverOrDbName
          : DEFAULT_SQLITE_DB_NAME;
      const expoDriver = tryCreateExpoSqliteDriver(name);
      if (expoDriver) {
        this.driver = expoDriver;
      } else {
        const nodeDriver = tryCreateNodeSqliteDriver(
          typeof driverOrDbName === 'string' ? driverOrDbName : ':memory:',
        );
        if (!nodeDriver) {
          throw new Error(
            'No SQLite driver available (neither expo-sqlite nor node:sqlite)',
          );
        }
        this.driver = nodeDriver;
      }
    }
  }

  getDriver(): SqliteDriver {
    return this.driver;
  }

  getDriverKind(): SqliteDriverKind {
    return this.driver.kind ?? SQLITE_DRIVER_KIND.CUSTOM;
  }

  /**
   * Creates all relational and KV tables, foreign keys, and indexes if missing.
   */
  async initSchema(): Promise<void> {
    if (this.schemaReady) return;
    if (!this.initPromise) {
      this.initPromise = withDriverLock(this.driver, async () => {
        if (this.schemaReady) return;
        await this.driver.exec(SQLITE_SCHEMA_DDL);
        this.schemaReady = true;
      }).catch((err: unknown) => {
        this.initPromise = null;
        throw err;
      });
    }
    await this.initPromise;
  }

  /**
   * Atomically synchronizes all normalized relational tables from `OfflineAppState`
   * inside a SQLite transaction, rolling back cleanly on any failure.
   */
  async syncFromAppState(state: OfflineAppState): Promise<void> {
    await this.initSchema();
    await withDriverLock(this.driver, () => syncAppStateToSqlite(this.driver, state));
  }

  /**
   * Reconstructs `OfflineAppState` from normalized SQLite tables, falling back
   * to `fallbackState` for unpopulated fields or an unseeded database.
   */
  async loadIntoAppState(
    fallbackState?: OfflineAppState,
  ): Promise<OfflineAppState> {
    await this.initSchema();
    return withDriverLock(this.driver, () =>
      loadAppStateFromSqlite(this.driver, fallbackState),
    );
  }

  /**
   * Queries daily health records within `[startDate, endDate]` inclusive,
   * ordered chronologically ascending via SQL index `idx_daily_health_date`.
   */
  async queryHealthDateRange(
    startDate: string,
    endDate: string,
  ): Promise<DailyHealthRecord[]> {
    await this.initSchema();
    return withDriverLock(this.driver, () =>
      queryHealthDateRangeFromSqlite(this.driver, startDate, endDate),
    );
  }

  /**
   * Computes health aggregate metrics directly in SQL via `COUNT`, `SUM`, and `AVG`.
   */
  async queryHealthAggregates(
    startDate?: string,
    endDate?: string,
  ): Promise<HealthAggregates> {
    await this.initSchema();
    return withDriverLock(this.driver, () =>
      queryHealthAggregatesFromSqlite(this.driver, startDate, endDate),
    );
  }

  /**
   * Queries a single GPS workout route together with its ordered `gps_waypoints`
   * using the `idx_gps_waypoints_route` index.
   */
  async queryGpsRouteWithWaypoints(
    routeId: string,
  ): Promise<GpsWorkoutRoute | null> {
    await this.initSchema();
    return withDriverLock(this.driver, () =>
      queryGpsRouteWithWaypointsFromSqlite(this.driver, routeId),
    );
  }

  /**
   * Returns current row counts for every documented SQLite table.
   */
  async getTableRowCounts(): Promise<Record<string, number>> {
    await this.initSchema();
    return withDriverLock(this.driver, () =>
      getTableRowCountsFromSqlite(this.driver),
    );
  }

  async close(): Promise<void> {
    if (typeof this.driver.close === 'function') {
      await withDriverLock(this.driver, async () => {
        await this.driver.close!();
      });
    }
  }
}
