/**
 * Keeps saved earbuds + watch connected: pings live links on an interval and
 * reconnects (by saved device id, no scan) after unexpected drops.
 *
 * Two reconnect strategies:
 *  - 'retry'   (Android): bounded-timeout connect attempts with exponential
 *              backoff, driven by the ping timer (kept alive in background by
 *              a foreground service).
 *  - 'pending' (iOS):     one outstanding connect with no timeout. Core
 *              Bluetooth completes it whenever the device is back in range,
 *              even while the app is suspended, so no polling is needed.
 */

export type KeptDeviceKind = 'earbuds' | 'watch';
export type ReconnectStrategy = 'retry' | 'pending';

export type KeeperLinkState =
  /** No saved device of this kind, keep-alive off, or user disconnected manually. */
  | 'idle'
  | 'connected'
  /** Waiting for backoff before the next attempt. */
  | 'waiting'
  | 'reconnecting';

export interface KeeperLinkStatus {
  readonly state: KeeperLinkState;
  readonly deviceId: string | null;
  readonly lastPingAt: number | null;
  readonly rssi: number | null;
  readonly nextAttemptAt: number | null;
  readonly failedAttempts: number;
}

export interface KeeperStatus {
  readonly enabled: boolean;
  readonly earbuds: KeeperLinkStatus;
  readonly watch: KeeperLinkStatus;
}

export interface KeeperHost {
  /** Saved device id the user expects to be connected, or null. */
  getTargetId(kind: KeptDeviceKind): string | null;
  isConnected(kind: KeptDeviceKind): boolean;
  isConnecting(kind: KeptDeviceKind): boolean;
  /** Full connect + protocol handshake. Must reject on failure. */
  reconnect(kind: KeptDeviceKind, deviceId: string, persistent: boolean): Promise<void>;
  /** Radio round-trip on a live link; returns RSSI (dBm) or null. Rejects if the link is dead. */
  ping(kind: KeptDeviceKind): Promise<number | null>;
  onStatusChanged(): void;
}

export interface KeeperOptions {
  strategy?: ReconnectStrategy;
  pingIntervalMs?: number;
  minBackoffMs?: number;
  maxBackoffMs?: number;
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

interface LinkRuntime {
  suppressed: boolean;
  inFlight: boolean;
  pinging: boolean;
  failedAttempts: number;
  nextAttemptAt: number | null;
  lastPingAt: number | null;
  rssi: number | null;
}

const KINDS: readonly KeptDeviceKind[] = ['earbuds', 'watch'];

export class ConnectionKeeper {
  private readonly host: KeeperHost;
  private readonly strategy: ReconnectStrategy;
  private readonly pingIntervalMs: number;
  private readonly minBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly now: () => number;
  private readonly setIntervalFn: (fn: () => void, ms: number) => unknown;
  private readonly clearIntervalFn: (handle: unknown) => void;
  private readonly setTimeoutFn: (fn: () => void, ms: number) => unknown;
  private readonly clearTimeoutFn: (handle: unknown) => void;
  private timer: unknown = null;
  private kick: unknown = null;
  private running = false;
  private readonly links: Record<KeptDeviceKind, LinkRuntime> = {
    earbuds: freshLink(),
    watch: freshLink(),
  };

  constructor(host: KeeperHost, options: KeeperOptions = {}) {
    this.host = host;
    this.strategy = options.strategy ?? 'retry';
    this.pingIntervalMs = options.pingIntervalMs ?? 30_000;
    this.minBackoffMs = options.minBackoffMs ?? 5_000;
    this.maxBackoffMs = options.maxBackoffMs ?? 120_000;
    this.now = options.now ?? Date.now;
    this.setIntervalFn = options.setInterval ?? ((fn, ms) => setInterval(fn, ms));
    this.clearIntervalFn = options.clearInterval ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
    this.setTimeoutFn = options.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimeoutFn = options.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = this.setIntervalFn(() => { void this.tick(); }, this.pingIntervalMs);
    this.scheduleKick(0);
    this.host.onStatusChanged();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer !== null) this.clearIntervalFn(this.timer);
    if (this.kick !== null) this.clearTimeoutFn(this.kick);
    this.timer = null;
    this.kick = null;
    for (const kind of KINDS) {
      this.links[kind].nextAttemptAt = null;
      this.links[kind].failedAttempts = 0;
    }
    this.host.onStatusChanged();
  }

  /** User pressed Disconnect: don't fight them by reconnecting. */
  suppress(kind: KeptDeviceKind): void {
    const link = this.links[kind];
    link.suppressed = true;
    link.nextAttemptAt = null;
    link.failedAttempts = 0;
    this.host.onStatusChanged();
  }

  /** User connected (or chose a device) again: resume keeping it alive. */
  resume(kind: KeptDeviceKind): void {
    const link = this.links[kind];
    link.suppressed = false;
    link.failedAttempts = 0;
    link.nextAttemptAt = null;
    this.host.onStatusChanged();
  }

  /** Link dropped without the user asking: reconnect soon. */
  notifyUnexpectedDisconnect(kind: KeptDeviceKind): void {
    const link = this.links[kind];
    if (!this.running || link.suppressed) return;
    link.nextAttemptAt = this.now() + 1_000;
    this.host.onStatusChanged();
    this.scheduleKick(1_000);
  }

  /** Re-evaluate immediately (e.g. app returned to foreground or Bluetooth turned on). */
  poke(): void {
    if (!this.running) return;
    for (const kind of KINDS) {
      const link = this.links[kind];
      if (!link.suppressed && !link.inFlight) link.nextAttemptAt = null;
    }
    this.scheduleKick(0);
  }

  getStatus(): KeeperStatus {
    return { enabled: this.running, earbuds: this.linkStatus('earbuds'), watch: this.linkStatus('watch') };
  }

  /** One evaluation pass for both device kinds. Exposed for tests. */
  async tick(): Promise<void> {
    if (!this.running) return;
    await Promise.all(KINDS.map((kind) => this.tickKind(kind)));
  }

  private async tickKind(kind: KeptDeviceKind): Promise<void> {
    const link = this.links[kind];
    if (this.host.isConnected(kind)) {
      link.failedAttempts = 0;
      link.nextAttemptAt = null;
      if (link.pinging) return;
      link.pinging = true;
      try {
        link.rssi = await this.host.ping(kind);
        link.lastPingAt = this.now();
      } catch {
        // Dead link — the GATT disconnect callback will report it; nothing to do here.
      } finally {
        link.pinging = false;
        this.host.onStatusChanged();
      }
      return;
    }

    const targetId = this.host.getTargetId(kind);
    if (!targetId || link.suppressed || link.inFlight || this.host.isConnecting(kind)) return;
    if (link.nextAttemptAt !== null && this.now() < link.nextAttemptAt) return;

    const persistent = this.strategy === 'pending';
    link.inFlight = true;
    link.nextAttemptAt = null;
    this.host.onStatusChanged();
    try {
      await this.host.reconnect(kind, targetId, persistent);
      link.failedAttempts = 0;
    } catch {
      link.failedAttempts += 1;
      const backoff = Math.min(this.maxBackoffMs, this.minBackoffMs * 2 ** Math.min(10, link.failedAttempts - 1));
      link.nextAttemptAt = this.now() + backoff;
      if (this.running) this.scheduleKick(backoff);
    } finally {
      link.inFlight = false;
      this.host.onStatusChanged();
    }
  }

  private scheduleKick(delayMs: number): void {
    if (!this.running) return;
    if (this.kick !== null) this.clearTimeoutFn(this.kick);
    this.kick = this.setTimeoutFn(() => {
      this.kick = null;
      void this.tick();
    }, delayMs);
  }

  private linkStatus(kind: KeptDeviceKind): KeeperLinkStatus {
    const link = this.links[kind];
    const targetId = this.host.getTargetId(kind);
    let state: KeeperLinkState;
    if (this.host.isConnected(kind)) state = 'connected';
    else if (!this.running || link.suppressed || !targetId) state = 'idle';
    else if (link.inFlight || this.host.isConnecting(kind)) state = 'reconnecting';
    else state = 'waiting';
    return {
      state,
      deviceId: targetId,
      lastPingAt: link.lastPingAt,
      rssi: link.rssi,
      nextAttemptAt: state === 'waiting' ? link.nextAttemptAt : null,
      failedAttempts: link.failedAttempts,
    };
  }
}

function freshLink(): LinkRuntime {
  return { suppressed: false, inFlight: false, pinging: false, failedAttempts: 0, nextAttemptAt: null, lastPingAt: null, rssi: null };
}
