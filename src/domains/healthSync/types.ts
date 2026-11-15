import type { DaySample, WorkoutSample } from './samples.ts';

export type HealthTargetId = 'healthConnect' | 'appleHealth' | 'strava';

/** What one outside app accepts and how to write to it. */
export interface HealthTarget {
  readonly id: HealthTargetId;
  readonly name: string;
  /** Kinds this target stores; everything else is skipped. */
  readonly kinds: ReadonlySet<DaySample['kind'] | 'workout'>;
  /** Apple Health can't update a sample, so only finished days go there. */
  readonly finishedDaysOnly: boolean;
  /** Installed / configured on this phone. Returns a reason when not. */
  availability(): Promise<{ ok: true } | { ok: false; reason: string; action?: 'install' | 'configure' }>;
  isConnected(): Promise<boolean>;
  /** Asks the user for access (permissions sheet or sign-in). Resolves true when granted. */
  connect(): Promise<boolean>;
  disconnect(): Promise<void>;
  /**
   * Writes samples and returns the keys it stored. `versions` is the record
   * version to write per key (increasing, so re-sent keys replace the earlier
   * record); `sentBefore` lists keys the outside app already has.
   */
  write(samples: readonly (DaySample | WorkoutSample)[], ctx: WriteContext): Promise<string[]>;
}

export interface WriteContext {
  versions: ReadonlyMap<string, number>;
  sentBefore: ReadonlySet<string>;
}

export interface TargetSyncState {
  enabled: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  lastCount: number;
}

export interface HealthSyncLedger {
  version: 1;
  targets: Record<HealthTargetId, TargetSyncState & { sent: Record<string, { f: string; v: number }> }>;
}

/** Version for a re-sent key: increasing, so Health Connect replaces the older record. */
export function nextVersion(previous: number | undefined, nowMs: number = Date.now()): number {
  return Math.max(Math.floor(nowMs / 1000), (previous ?? 0) + 1);
}
