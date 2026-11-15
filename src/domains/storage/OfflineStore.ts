/**
 * Unified local offline persistence store for Ultima Link earbuds & ULTIMA Fit watches.
 */

import { isAsyncStorageBackend, resolveStoreBackendAndSqlite } from './backends.ts';
import {
  computeInMemoryHealthAggregates, exportBackupArchiveJson, exportGpsRoutesToGpx,
  exportHealthHistoryCsv, mergeStates, parseValidatedStateOrArchive, sortGpsRoutes,
  sortHealthHistory, sortPairedDevices, sortWatchAlarms, validateOfflineAppState,
} from './exporters.ts';
import { ExpoSqliteStorageBackend, SQLITE_DRIVER_KIND, UltimaSqliteDatabase } from './sqlite/index.ts';
import { IMPORT_MODE, MAX_WATCH_ALARMS, STORAGE_BACKEND_TYPE } from './types.ts';
import type {
  DailyHealthRecord, DailyHealthRecordInput, EarbudPrefs, EarbudPrefsPatch,
  ExportCsvOptions, ExportJsonOptions, GpsWorkoutRoute, GpsWorkoutRouteInput,
  HealthAggregates, ImportJsonOptions, ImportJsonResult, LastKnownLocation,
  LastKnownLocationInput, OfflineAppState, OfflineStoreOptions, PairedDeviceRecord,
  SaveCustomEqProfileInput, StorageBackend, StorageBackendType, StorageEngineInfo,
  WatchAlarmRecord, WatchSettings, WatchSettingsPatch,
} from './types.ts';
import {
  assertSafeKey, cloneEarbudPrefs, cloneGpsRoute, cloneHealthRecord, cloneLocation,
  cloneOfflineAppState, clonePairedDevice, createDefaultDailyHealthRecord,
  createDefaultEarbudPrefs, createDefaultOfflineAppState, isNonEmptyString,
  isValidIsoDate, validateCustomEqProfile, validateEarbudPrefs, validateGpsRoute,
  validateHealthRecord, validateLocation, validatePairedDevice, validateWatchAlarm,
  validateWatchSettings,
} from './validatorsAndDefaults.ts';

/**
 * Unified local offline persistence store for Ultima Link earbuds & ULTIMA Fit watches.
 */
export class OfflineStore {
  private readonly backend: StorageBackend;
  private readonly storageKey: string;
  private readonly sqliteDb: UltimaSqliteDatabase | null;
  private state: OfflineAppState;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    backendOrOptions?: StorageBackend | OfflineStoreOptions,
    storageKey?: string,
  ) {
    const resolved = resolveStoreBackendAndSqlite(backendOrOptions, storageKey);
    this.backend = resolved.backend;
    this.storageKey = resolved.storageKey;
    this.sqliteDb = resolved.sqliteDb;
    this.state = createDefaultOfflineAppState();
  }

  private mustValidate<T>(item: T | null, errors: string[], fallbackMsg: string): T {
    if (!item) throw new Error(errors[0] ?? fallbackMsg);
    return item;
  }

  private async commitAndReturn(): Promise<OfflineAppState> {
    await this.save();
    return this.getState();
  }

  /** Loads and validates persisted state from the storage backend. */
  async load(): Promise<OfflineAppState> {
    try {
      const raw = await this.backend.getItem(this.storageKey);
      if (raw === null || raw.trim().length === 0) {
        if (this.sqliteDb) {
          await this.sqliteDb.initSchema();
          const sqlState = await this.sqliteDb.loadIntoAppState();
          const validated = validateOfflineAppState(sqlState, []);
          this.state = validated ? cloneOfflineAppState(validated) : createDefaultOfflineAppState();
        } else {
          this.state = createDefaultOfflineAppState();
        }
        return this.getState();
      }
      const { state } = parseValidatedStateOrArchive(raw);
      this.state = state ? cloneOfflineAppState(state) : createDefaultOfflineAppState();
      if (this.sqliteDb) {
        await this.sqliteDb.initSchema();
        const counts = await this.sqliteDb.getTableRowCounts();
        const relationalRows =
          (counts.paired_devices ?? 0) + (counts.custom_eq_profiles ?? 0) +
          (counts.daily_health_records ?? 0) + (counts.gps_workout_routes ?? 0) +
          (counts.watch_alarms ?? 0);
        const hasEntities =
          this.state.pairedDevices.length > 0 || this.state.customEqProfiles.length > 0 ||
          this.state.healthHistory.length > 0 || this.state.gpsRoutes.length > 0 ||
          this.state.watchAlarms.length > 0 || Object.keys(this.state.earbudPrefs).length > 0;
        if (relationalRows === 0 && hasEntities) {
          await this.sqliteDb.syncFromAppState(cloneOfflineAppState(this.state));
        }
      }
    } catch {
      this.state = createDefaultOfflineAppState();
    }
    return this.getState();
  }

  /** Persists the current in-memory state to the storage backend. */
  async save(): Promise<void> {
    const snapshot = cloneOfflineAppState(this.state);
    const serialized = JSON.stringify(snapshot);
    const task = this.writeChain.then(async () => {
      await this.backend.setItem(this.storageKey, serialized);
      if (this.sqliteDb) await this.sqliteDb.syncFromAppState(snapshot);
    });
    this.writeChain = task.catch(() => undefined);
    return task;
  }

  /** Returns the attached relational SQLite database engine, or `null`. */
  getSqliteDb(): UltimaSqliteDatabase | null {
    return this.sqliteDb;
  }

  /** Reports the active persistence backend type and relational SQLite status. */
  getStorageEngineInfo(): StorageEngineInfo {
    let backendType: StorageBackendType = STORAGE_BACKEND_TYPE.MEMORY;
    if (this.backend instanceof ExpoSqliteStorageBackend) {
      backendType =
        this.backend.getDriverKind() === SQLITE_DRIVER_KIND.NODE_SQLITE
          ? STORAGE_BACKEND_TYPE.NODE_SQLITE
          : STORAGE_BACKEND_TYPE.EXPO_SQLITE;
    } else if (isAsyncStorageBackend(this.backend)) {
      backendType = STORAGE_BACKEND_TYPE.ASYNC_STORAGE;
    }
    return { backendType, relationalTablesActive: this.sqliteDb !== null };
  }

  /** Queries daily health records within `[startDate, endDate]` inclusive. */
  async queryHealthDateRange(startDate: string, endDate: string): Promise<DailyHealthRecord[]> {
    await this.writeChain;
    if (this.sqliteDb) return this.sqliteDb.queryHealthDateRange(startDate, endDate);
    return sortHealthHistory(
      this.state.healthHistory.filter((day) => day.date >= startDate && day.date <= endDate),
    ).map(cloneHealthRecord);
  }

  /** Queries aggregate health stats (directly via SQL when SQLite is active). */
  async queryHealthAggregates(startDate?: string, endDate?: string): Promise<HealthAggregates> {
    await this.writeChain;
    if (this.sqliteDb) return this.sqliteDb.queryHealthAggregates(startDate, endDate);
    return computeInMemoryHealthAggregates(this.state.healthHistory, startDate, endDate);
  }

  /** Returns a defensive snapshot of the current offline state. */
  getState(): OfflineAppState {
    return cloneOfflineAppState(this.state);
  }

  /** Inserts or updates a paired Link earbuds or Fit watch record. */
  async upsertPairedDevice(device: PairedDeviceRecord): Promise<OfflineAppState> {
    const errors: string[] = [];
    const validated = this.mustValidate(
      validatePairedDevice(device, 'device', errors),
      errors,
      'Invalid paired device record',
    );
    const existing = this.state.pairedDevices.find((d) => d.id === validated.id);
    const nextRecord = clonePairedDevice(validated);
    if (existing) {
      if (nextRecord.lastKnownLocation === undefined && existing.lastKnownLocation !== undefined) {
        nextRecord.lastKnownLocation = cloneLocation(existing.lastKnownLocation);
      }
      if (nextRecord.chip === undefined && existing.chip !== undefined) nextRecord.chip = existing.chip;
      if (nextRecord.pid === undefined && existing.pid !== undefined) nextRecord.pid = existing.pid;
      if (nextRecord.mac === undefined && existing.mac !== undefined) nextRecord.mac = existing.mac;
    }
    const others = this.state.pairedDevices.filter((d) => d.id !== validated.id);
    this.state.pairedDevices = sortPairedDevices([...others, nextRecord]);
    return this.commitAndReturn();
  }

  /** Removes a paired device and its saved earbud preferences if present. */
  async removePairedDevice(deviceId: string): Promise<OfflineAppState> {
    assertSafeKey(deviceId, 'deviceId');
    this.state.pairedDevices = this.state.pairedDevices.filter((d) => d.id !== deviceId);
    delete this.state.earbudPrefs[deviceId];
    return this.commitAndReturn();
  }

  /** Updates or clears the offline Find-My last-seen location pin for a device. */
  async setLastKnownLocation(
    deviceId: string,
    location: LastKnownLocationInput | null,
  ): Promise<OfflineAppState> {
    assertSafeKey(deviceId, 'deviceId');
    const idx = this.state.pairedDevices.findIndex((d) => d.id === deviceId);
    if (idx === -1) throw new Error(`Paired device not found: ${deviceId}`);

    const updated = clonePairedDevice(this.state.pairedDevices[idx]!);
    if (location === null) {
      delete updated.lastKnownLocation;
    } else {
      const normalized: LastKnownLocation = {
        lat: location.lat, lng: location.lng, note: location.note ?? '', savedAt: location.savedAt ?? Date.now(),
      };
      const errors: string[] = [];
      updated.lastKnownLocation = this.mustValidate(
        validateLocation(normalized, 'location', errors),
        errors,
        'Invalid lastKnownLocation',
      );
    }
    this.state.pairedDevices[idx] = updated;
    return this.commitAndReturn();
  }

  /** Returns saved preferences for an earbuds device, or default preferences. */
  getEarbudPrefs(deviceId: string): EarbudPrefs {
    assertSafeKey(deviceId, 'deviceId');
    const existing = this.state.earbudPrefs[deviceId];
    return existing ? cloneEarbudPrefs(existing) : createDefaultEarbudPrefs();
  }

  /** Merges and persists per-device earbud preferences and key mappings. */
  async updateEarbudPrefs(deviceId: string, patch: EarbudPrefsPatch): Promise<OfflineAppState> {
    assertSafeKey(deviceId, 'deviceId');
    const current = this.state.earbudPrefs[deviceId] ?? createDefaultEarbudPrefs();
    const mergedCandidate: EarbudPrefs = {
      ancMode: patch.ancMode ?? current.ancMode,
      ancGain: patch.ancGain ?? current.ancGain,
      transparencyGain: patch.transparencyGain ?? current.transparencyGain,
      gameMode: patch.gameMode ?? current.gameMode,
      spatialAudio: patch.spatialAudio ?? current.spatialAudio,
      ldac: patch.ldac ?? current.ldac,
      inEarDetect: patch.inEarDetect ?? current.inEarDetect,
      dualConnect: patch.dualConnect ?? current.dualConnect,
      ledOn: patch.ledOn ?? current.ledOn,
      voiceLanguage: patch.voiceLanguage ?? current.voiceLanguage,
      customBtName: patch.customBtName !== undefined ? patch.customBtName : current.customBtName,
      keyMappings: {
        left: { ...current.keyMappings.left, ...(patch.keyMappings?.left ?? {}) },
        right: { ...current.keyMappings.right, ...(patch.keyMappings?.right ?? {}) },
        caseKeys: { ...current.keyMappings.caseKeys, ...(patch.keyMappings?.caseKeys ?? {}) },
      },
    };
    const errors: string[] = [];
    this.state.earbudPrefs[deviceId] = this.mustValidate(
      validateEarbudPrefs(mergedCandidate, 'earbudPrefs', errors),
      errors,
      'Invalid earbud preferences',
    );
    return this.commitAndReturn();
  }

  /** Saves or updates a custom 10-band EQ profile. */
  async saveCustomEqProfile(profile: SaveCustomEqProfileInput): Promise<OfflineAppState> {
    assertSafeKey(profile.id, 'profile.id');
    const existingIdx = this.state.customEqProfiles.findIndex((p) => p.id === profile.id);
    const createdAt =
      profile.createdAt ?? (existingIdx >= 0 ? this.state.customEqProfiles[existingIdx]!.createdAt : Date.now());
    const errors: string[] = [];
    const validated = this.mustValidate(
      validateCustomEqProfile({ id: profile.id, name: profile.name, gains: profile.gains, createdAt }, 'profile', errors),
      errors,
      'Invalid custom EQ profile',
    );
    if (existingIdx >= 0) this.state.customEqProfiles[existingIdx] = validated;
    else this.state.customEqProfiles.push(validated);
    return this.commitAndReturn();
  }

  /** Deletes a custom EQ profile by ID. */
  async deleteCustomEqProfile(profileId: string): Promise<OfflineAppState> {
    assertSafeKey(profileId, 'profileId');
    this.state.customEqProfiles = this.state.customEqProfiles.filter((p) => p.id !== profileId);
    return this.commitAndReturn();
  }

  /** Inserts or merges a daily smartwatch health record by YYYY-MM-DD date. */
  async upsertHealthDay(record: DailyHealthRecordInput): Promise<OfflineAppState> {
    if (!isValidIsoDate(record.date)) throw new Error(`Invalid health record date '${String(record.date)}'`);
    const existing = this.state.healthHistory.find((d) => d.date === record.date);
    const base = existing ? cloneHealthRecord(existing) : createDefaultDailyHealthRecord(record.date);
    const candidate: DailyHealthRecord = {
      ...base,
      ...record,
      date: record.date,
      hrSamples: record.hrSamples !== undefined ? [...record.hrSamples] : base.hrSamples,
      stepBuckets48: record.stepBuckets48 !== undefined ? [...record.stepBuckets48] : base.stepBuckets48,
      sleepSegments: record.sleepSegments !== undefined ? record.sleepSegments.map((x) => ({ ...x })) : base.sleepSegments,
    };
    if (candidate.stepBuckets48 === undefined) delete candidate.stepBuckets48;
    if (candidate.sleepSegments === undefined) delete candidate.sleepSegments;
    const errors: string[] = [];
    const validated = this.mustValidate(
      validateHealthRecord(candidate, 'healthRecord', errors),
      errors,
      'Invalid health day record',
    );
    const others = this.state.healthHistory.filter((d) => d.date !== validated.date);
    this.state.healthHistory = sortHealthHistory([...others, validated]);
    return this.commitAndReturn();
  }

  /** Replaces saved watch alarms (up to 8 slots, IDs 0..7). */
  async setWatchAlarms(alarms: WatchAlarmRecord[]): Promise<OfflineAppState> {
    if (!Array.isArray(alarms)) throw new Error('alarms must be an array');
    if (alarms.length > MAX_WATCH_ALARMS) throw new Error(`alarms cannot exceed ${MAX_WATCH_ALARMS} items`);
    const errors: string[] = [];
    const validatedList: WatchAlarmRecord[] = [];
    const seenIds = new Set<number>();
    for (let i = 0; i < alarms.length; i++) {
      const validated = this.mustValidate(
        validateWatchAlarm(alarms[i], `alarms[${i}]`, errors),
        errors,
        'Invalid watch alarm',
      );
      if (seenIds.has(validated.id)) throw new Error(`Duplicate watch alarm id: ${validated.id}`);
      seenIds.add(validated.id);
      validatedList.push(validated);
    }
    this.state.watchAlarms = sortWatchAlarms(validatedList);
    return this.commitAndReturn();
  }

  /** Merges and persists watch settings, reminder schedules, and notification rules. */
  async updateWatchSettings(patch: WatchSettingsPatch): Promise<OfflineAppState> {
    const current = this.state.watchSettings;
    const candidate: WatchSettings = {
      goalSteps: patch.goalSteps ?? current.goalSteps,
      is24Hour: patch.is24Hour ?? current.is24Hour,
      quickView: patch.quickView ?? current.quickView,
      watchFaceId: patch.watchFaceId ?? current.watchFaceId,
      imperialUnits: patch.imperialUnits ?? current.imperialUnits,
      languageId: patch.languageId ?? current.languageId,
      sedentaryReminder: patch.sedentaryReminder ?? current.sedentaryReminder,
      hrIntervalMinutes: patch.hrIntervalMinutes ?? current.hrIntervalMinutes,
      drinkReminderPeriod: { ...current.drinkReminderPeriod, ...(patch.drinkReminderPeriod ?? {}) },
      notificationRules: { ...current.notificationRules, ...(patch.notificationRules ?? {}) },
    };
    const errors: string[] = [];
    this.state.watchSettings = this.mustValidate(
      validateWatchSettings(candidate, 'watchSettings', errors),
      errors,
      'Invalid watch settings',
    );
    return this.commitAndReturn();
  }

  /** Resets all offline state to clean factory defaults and clears storage. */
  async resetAll(): Promise<OfflineAppState> {
    this.state = createDefaultOfflineAppState();
    const emptySnapshot = cloneOfflineAppState(this.state);
    const task = this.writeChain.then(async () => {
      await this.backend.removeItem(this.storageKey);
      if (this.sqliteDb) await this.sqliteDb.syncFromAppState(emptySnapshot);
    });
    this.writeChain = task.catch(() => undefined);
    await task;
    return this.getState();
  }

  /** Exports a pretty-printed, deterministic JSON backup archive string. */
  exportJson(options?: ExportJsonOptions): string {
    return exportBackupArchiveJson(this.state, options);
  }

  /** Validates backup JSON strictly and merges/restores state with diagnostics. */
  async tryImportJson(jsonText: string, options?: ImportJsonOptions): Promise<ImportJsonResult> {
    try {
      const { state: parsedState, errors } = parseValidatedStateOrArchive(jsonText);
      if (!parsedState || errors.length > 0) {
        return {
          ok: false,
          errors: errors.length > 0 ? errors : ['Invalid backup payload'],
          state: this.getState(),
        };
      }
      const mode = options?.mode ?? IMPORT_MODE.MERGE;
      this.state =
        mode === IMPORT_MODE.REPLACE
          ? cloneOfflineAppState(parsedState)
          : mergeStates(this.state, parsedState);
      await this.save();
      return { ok: true, errors: [], state: this.getState() };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unexpected import failure';
      return { ok: false, errors: [message], state: this.getState() };
    }
  }

  /** Validates backup JSON strictly and merges/restores state without throwing. */
  async importJson(jsonText: string, options?: ImportJsonOptions): Promise<OfflineAppState> {
    return (await this.tryImportJson(jsonText, options)).state;
  }

  /** Exports healthHistory as clean RFC-4180 CSV ordered chronologically by date. */
  exportHealthCsv(options?: ExportCsvOptions): string {
    return exportHealthHistoryCsv(this.state.healthHistory, options);
  }

  getGpsRoutes(): GpsWorkoutRoute[] {
    return (this.state.gpsRoutes ?? []).map(cloneGpsRoute);
  }

  async saveGpsRoute(input: GpsWorkoutRouteInput): Promise<OfflineAppState> {
    const errors: string[] = [];
    const candidate = {
      ...input,
      name: isNonEmptyString(input.name)
        ? input.name.trim()
        : `${isNonEmptyString(input.activityType) ? input.activityType.trim() : 'workout'} (${String(input.startedAt).slice(0, 10)})`,
      endedAt: input.endedAt ?? input.startedAt,
    };
    const validated = this.mustValidate(
      validateGpsRoute(candidate, 'gpsRoute', errors),
      errors,
      'Invalid GPS workout route',
    );
    const nextRoutes = (this.state.gpsRoutes ?? []).filter((r) => r.id !== validated.id);
    nextRoutes.push(validated);
    this.state.gpsRoutes = sortGpsRoutes(nextRoutes);
    return this.commitAndReturn();
  }

  async deleteGpsRoute(routeId: string): Promise<OfflineAppState> {
    const before = (this.state.gpsRoutes ?? []).length;
    const filtered = (this.state.gpsRoutes ?? []).filter((r) => r.id !== routeId);
    if (filtered.length !== before) {
      this.state.gpsRoutes = filtered;
      await this.save();
    }
    return this.getState();
  }

  /** Exports one or all stored outdoor GPS workout routes as standard GPX 1.1 XML. */
  exportGpx(routeId?: string): string {
    return exportGpsRoutesToGpx(this.state.gpsRoutes ?? [], routeId);
  }
}
