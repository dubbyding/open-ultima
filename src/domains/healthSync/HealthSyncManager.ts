/**
 * Sends stored watch data to the health apps the user switched on, once per
 * change. A small ledger (AsyncStorage) remembers what each app already has.
 */
import type { DailyHealthRecord, GpsWorkoutRoute } from '../storage/types.ts';
import { daySamples, isFinishedDay, workoutSample } from './samples.ts';
import type { DaySample, WorkoutSample } from './samples.ts';
import { nextVersion } from './types.ts';
import type { HealthSyncLedger, HealthTarget, HealthTargetId, TargetSyncState } from './types.ts';

export interface LedgerStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const LEDGER_KEY = 'ultima.healthSync.v1';
/** Don't push more than this many days back on the first sync. */
const BACKFILL_DAYS = 30;

const emptyTarget = (): HealthSyncLedger['targets'][HealthTargetId] => ({ enabled: false, lastSyncAt: null, lastError: null, lastCount: 0, sent: {} });

export interface HealthSyncSnapshot {
  targets: Record<HealthTargetId, TargetSyncState & { syncing: boolean }>;
}

export class HealthSyncManager {
  private ledger: HealthSyncLedger = {
    version: 1,
    targets: { healthConnect: emptyTarget(), appleHealth: emptyTarget(), strava: emptyTarget() },
  };
  private loaded: Promise<void> | null = null;
  private readonly syncing = new Set<HealthTargetId>();
  private readonly listeners = new Set<() => void>();

  private readonly targets: readonly HealthTarget[];
  private readonly storage: LedgerStorage;
  private readonly data: () => { healthHistory: readonly DailyHealthRecord[]; gpsRoutes: readonly GpsWorkoutRoute[] };
  private readonly now: () => Date;

  constructor(
    targets: readonly HealthTarget[],
    storage: LedgerStorage,
    data: () => { healthHistory: readonly DailyHealthRecord[]; gpsRoutes: readonly GpsWorkoutRoute[] },
    now: () => Date = () => new Date(),
  ) {
    this.targets = targets;
    this.storage = storage;
    this.data = data;
    this.now = now;
  }

  target(id: HealthTargetId): HealthTarget | undefined {
    return this.targets.find((t) => t.id === id);
  }

  list(): readonly HealthTarget[] {
    return this.targets;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  load(): Promise<void> {
    this.loaded ??= (async () => {
      try {
        const raw = await this.storage.getItem(LEDGER_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as HealthSyncLedger;
        if (parsed?.version !== 1) return;
        for (const id of Object.keys(this.ledger.targets) as HealthTargetId[]) {
          const t = parsed.targets?.[id];
          if (t) this.ledger.targets[id] = { ...emptyTarget(), ...t, sent: { ...(t.sent ?? {}) } };
        }
      } catch {
        // A corrupt ledger only means data is re-sent; Health Connect dedupes by id.
      }
      this.emit();
    })();
    return this.loaded;
  }

  private async save(): Promise<void> {
    await this.storage.setItem(LEDGER_KEY, JSON.stringify(this.ledger));
  }

  snapshot(): HealthSyncSnapshot {
    const out = {} as HealthSyncSnapshot['targets'];
    for (const [id, t] of Object.entries(this.ledger.targets) as [HealthTargetId, HealthSyncLedger['targets'][HealthTargetId]][]) {
      out[id] = { enabled: t.enabled, lastSyncAt: t.lastSyncAt, lastError: t.lastError, lastCount: t.lastCount, syncing: this.syncing.has(id) };
    }
    return { targets: out };
  }

  async setEnabled(id: HealthTargetId, enabled: boolean): Promise<void> {
    await this.load();
    const target = this.target(id);
    if (!target) throw new Error('Not available on this phone.');
    if (enabled) {
      const avail = await target.availability();
      if (!avail.ok) throw new Error(avail.reason);
      if (!(await target.isConnected()) && !(await target.connect())) throw new Error('Access wasn’t allowed.');
    } else {
      await target.disconnect().catch(() => undefined);
    }
    this.ledger.targets[id] = { ...this.ledger.targets[id], enabled, lastError: null };
    await this.save();
    this.emit();
    if (enabled) await this.sync(id);
  }

  /** Everything this target should hold, minus what it already has unchanged. */
  pending(id: HealthTargetId): (DaySample | WorkoutSample)[] {
    const target = this.target(id);
    if (!target) return [];
    const now = this.now();
    const cutoff = new Date(now.getTime() - BACKFILL_DAYS * 86_400_000).toISOString().slice(0, 10);
    const { healthHistory, gpsRoutes } = this.data();
    const all: (DaySample | WorkoutSample)[] = [];
    for (const day of healthHistory) {
      if (day.date < cutoff) continue;
      if (target.finishedDaysOnly && !isFinishedDay(day.date, now)) continue;
      all.push(...daySamples(day, now));
    }
    for (const r of gpsRoutes) {
      if (r.startedAt.slice(0, 10) < cutoff) continue;
      const w = workoutSample(r);
      if (w) all.push(w);
    }
    const sent = this.ledger.targets[id].sent;
    return all.filter((s) => target.kinds.has(s.kind) && sent[s.key]?.f !== s.fingerprint && !(target.finishedDaysOnly && sent[s.key]));
  }

  async sync(id: HealthTargetId): Promise<number> {
    await this.load();
    const target = this.target(id);
    const state = this.ledger.targets[id];
    if (!target || !state.enabled || this.syncing.has(id)) return 0;
    this.syncing.add(id);
    this.emit();
    try {
      const todo = this.pending(id);
      const nowMs = this.now().getTime();
      const versions = new Map(todo.map((s) => [s.key, nextVersion(state.sent[s.key]?.v, nowMs)] as const));
      const sentBefore = new Set(Object.keys(state.sent));
      const stored = todo.length > 0 ? await target.write(todo, { versions, sentBefore }) : [];
      const byKey = new Map(todo.map((s) => [s.key, s]));
      for (const key of stored) {
        const s = byKey.get(key);
        if (s) state.sent[key] = { f: s.fingerprint, v: versions.get(key)! };
      }
      state.lastSyncAt = this.now().toISOString();
      state.lastError = stored.length < todo.length ? `${todo.length - stored.length} item(s) couldn’t be sent` : null;
      state.lastCount = stored.length;
      return stored.length;
    } catch (err) {
      state.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      this.syncing.delete(id);
      await this.save().catch(() => undefined);
      this.emit();
    }
  }

  /** Background-friendly: syncs every enabled target, never throws. */
  async syncAll(): Promise<void> {
    await this.load();
    for (const t of this.targets) {
      if (this.ledger.targets[t.id].enabled) await this.sync(t.id).catch(() => undefined);
    }
  }
}
