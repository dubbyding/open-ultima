import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorageBackend, OfflineStore } from '../../../src/storage/offlineStore.ts';
import { ConnectionKeeper } from '../../../src/domains/bluetooth/controllers/connectionKeeper.ts';
import type { KeeperHost, KeptDeviceKind } from '../../../src/domains/bluetooth/controllers/connectionKeeper.ts';
import { createTestRig, flushBle } from '../../fixtures/fakeBlePlx.ts';

// ---------------------------------------------------------------------------
// 10. Background keep-alive & auto-reconnect
// ---------------------------------------------------------------------------

function manualClock() {
  let now = 1_000_000;
  return {
    now: () => now,
    advance: (ms: number) => { now += ms; },
    // Timers are driven manually through keeper.tick() in unit tests.
    setInterval: () => 1,
    clearInterval: () => undefined,
    setTimeout: () => 2,
    clearTimeout: () => undefined,
  };
}

function fakeHost(overrides: Partial<KeeperHost> = {}) {
  const state = { connected: { earbuds: false, watch: false } as Record<KeptDeviceKind, boolean> };
  const calls: Array<{ kind: KeptDeviceKind; id: string; persistent: boolean }> = [];
  const pings: KeptDeviceKind[] = [];
  let failNext = 0;
  const host: KeeperHost = {
    getTargetId: (kind) => (kind === 'earbuds' ? 'buds-1' : null),
    isConnected: (kind) => state.connected[kind],
    isConnecting: () => false,
    reconnect: async (kind, id, persistent) => {
      calls.push({ kind, id, persistent });
      if (failNext > 0) { failNext -= 1; throw new Error('timeout'); }
      state.connected[kind] = true;
    },
    ping: async (kind) => { pings.push(kind); return -55; },
    onStatusChanged: () => undefined,
    ...overrides,
  };
  return { host, state, calls, pings, failTimes: (n: number) => { failNext = n; } };
}

test('10.1 ConnectionKeeper retry strategy: reconnects saved device, backs off exponentially, pings live links', async () => {
  const clock = manualClock();
  const h = fakeHost();
  const keeper = new ConnectionKeeper(h.host, { ...clock, strategy: 'retry', minBackoffMs: 5_000, maxBackoffMs: 20_000 });
  keeper.start();
  h.failTimes(3);

  await keeper.tick();
  assert.deepEqual(h.calls.at(-1), { kind: 'earbuds', id: 'buds-1', persistent: false });
  assert.equal(keeper.getStatus().earbuds.state, 'waiting');
  assert.equal(keeper.getStatus().earbuds.nextAttemptAt, clock.now() + 5_000);
  assert.equal(keeper.getStatus().watch.state, 'idle', 'no saved watch → nothing to keep alive');

  await keeper.tick(); // still inside backoff window
  assert.equal(h.calls.length, 1);

  clock.advance(5_000);
  await keeper.tick(); // 2nd failure → 10s
  assert.equal(keeper.getStatus().earbuds.nextAttemptAt, clock.now() + 10_000);
  clock.advance(10_000);
  await keeper.tick(); // 3rd failure → 20s (capped)
  assert.equal(keeper.getStatus().earbuds.nextAttemptAt, clock.now() + 20_000);

  clock.advance(20_000);
  await keeper.tick(); // succeeds
  assert.equal(h.calls.length, 4);
  assert.equal(keeper.getStatus().earbuds.state, 'connected');
  assert.equal(keeper.getStatus().earbuds.failedAttempts, 0);

  await keeper.tick(); // connected → ping
  assert.deepEqual(h.pings, ['earbuds']);
  assert.equal(keeper.getStatus().earbuds.rssi, -55);
  keeper.stop();
  assert.equal(keeper.getStatus().enabled, false);
});

test('10.2 ConnectionKeeper pending strategy (iOS) issues persistent connects; manual disconnect suppresses until resume', async () => {
  const clock = manualClock();
  const h = fakeHost();
  const keeper = new ConnectionKeeper(h.host, { ...clock, strategy: 'pending' });
  keeper.start();

  keeper.suppress('earbuds');
  await keeper.tick();
  assert.equal(h.calls.length, 0, 'suppressed device must not be reconnected');
  assert.equal(keeper.getStatus().earbuds.state, 'idle');

  keeper.resume('earbuds');
  await keeper.tick();
  assert.deepEqual(h.calls, [{ kind: 'earbuds', id: 'buds-1', persistent: true }]);
  keeper.stop();
});

test('10.3 UltimaBleManager keep-alive auto-reconnects after link loss, retries while out of range, and respects manual disconnect', async () => {
  const store = new OfflineStore({ backend: new MemoryStorageBackend() });
  const { manager, radio } = createTestRig(store, { keepAlivePingMs: 60_000 });
  await manager.init();
  await manager.connectDevice('sim-earbuds-xh68b');
  await manager.connectDevice('sim-watch-magic');
  manager.startKeepAlive();
  await flushBle();
  assert.equal(manager.getSnapshot().keepAlive.enabled, true);
  assert.equal(manager.getSnapshot().keepAlive.earbuds.state, 'connected');

  // Watch walks out of range: link drops, first reconnect attempt times out.
  radio.setInRange('sim-watch-magic', false);
  radio.dropLink('sim-watch-magic');
  assert.equal(manager.getSnapshot().watch.connected, false);
  await new Promise((r) => setTimeout(r, 1_100));
  await flushBle();
  const watchStatus = manager.getSnapshot().keepAlive.watch;
  assert.equal(watchStatus.state, 'waiting');
  assert.equal(watchStatus.failedAttempts, 1);
  assert.equal(manager.getSnapshot().lastError, null, 'background retries must not raise the error banner');
  const lastCall = radio.connectCalls.at(-1)!;
  assert.equal(lastCall.deviceId, 'sim-watch-magic');
  assert.ok(lastCall.options?.timeout, 'Android-style retry uses a bounded connect timeout');

  // Back in range: poke (app foregrounded) reconnects immediately, by saved id, without scanning.
  radio.setInRange('sim-watch-magic', true);
  manager.pokeKeepAlive();
  await flushBle(10);
  assert.equal(manager.getSnapshot().watch.connected, true);
  assert.equal(manager.getSnapshot().keepAlive.watch.state, 'connected');
  assert.equal(manager.getSnapshot().earbuds.connected, true, 'earbuds untouched throughout');

  // Manual disconnect: keeper must not reconnect.
  await manager.disconnectEarbuds();
  manager.pokeKeepAlive();
  await flushBle(10);
  assert.equal(manager.getSnapshot().earbuds.connected, false);
  assert.equal(manager.getSnapshot().keepAlive.earbuds.state, 'idle');

  manager.destroy();
  assert.equal(manager.getSnapshot().keepAlive.enabled, false);
});

test('10.4 Fresh app start reconnects saved devices directly by id (iOS pending connect completes when device returns)', async () => {
  const backend = new MemoryStorageBackend();
  const firstStore = new OfflineStore({ backend });
  const first = createTestRig(firstStore);
  await first.manager.init();
  await first.manager.connectDevice('sim-watch-magic');
  first.manager.destroy();

  const store = new OfflineStore({ backend });
  const { manager, radio } = createTestRig(store, { reconnectStrategy: 'pending' });
  await manager.init();
  radio.setInRange('sim-watch-magic', false);
  manager.startKeepAlive();
  await flushBle(10);

  assert.equal(manager.getSnapshot().discovered.length, 0, 'no scan needed to reconnect a saved device');
  assert.equal(manager.getSnapshot().keepAlive.watch.state, 'reconnecting', 'pending connect held open');
  assert.equal(radio.connectCalls.at(-1)?.options?.timeout, undefined, 'iOS-style connect has no timeout');

  radio.setInRange('sim-watch-magic', true);
  await flushBle(20);
  assert.equal(manager.getSnapshot().watch.connected, true);
  assert.equal(manager.getSnapshot().watch.deviceId, 'sim-watch-magic');
  manager.destroy();
});
