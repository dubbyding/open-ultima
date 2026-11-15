import { BLUETRUM_UUIDS, DEVICE_CHIP, EQ_FREQUENCIES, JIELI_UUIDS, getProductById } from '../../protocols/ultimaLinkConstants.ts';
import type { DeviceChip } from '../../protocols/ultimaLinkConstants.ts';
import { bytesToHex, hexToBytes } from '../../protocols/ultimaLinkAdvParser.ts';
import {
  CRREPA_UUIDS, CRP_CMD, buildCrpFrame, encodeGoalSteps, encodeMetricSystem, encodeQueryNewAlarms,
  encodeQuickView, encodeSedentaryReminder, encodeSendLocalLocation, encodeSyncStepsAndSleep,
  encodeTimeSystem, encodeTimingHeartRateInterval, encodeWatchFace, encodeWatchLanguage,
} from '../../protocols/ultimaFitCrrepa.ts';
import { DEVICE_KIND, OfflineStore, createDefaultEarbudPrefs } from '../../storage/offlineStore.ts';
import type { EarbudPrefsPatch, WatchAlarmRecord, WatchSettingsPatch } from '../../storage/offlineStore.ts';
import {
  PACKET_DIRECTION, PACKET_PROTOCOL, cloneEarbudKeyMappings, cloneGpsRoutes,
  createEmptyEarbudsState, createEmptyWatchState, deriveEarbudSideLocations,
  hydrateEarbudsFromStore, hydrateWatchFromStore, syncEarbudsState, syncWatchState,
} from './types.ts';
import type {
  BleManagerSnapshot, BlePlxManagerLike, DeviceGeoPin, DiscoveredDevice,
  EarbudsLiveState, PacketDirection, PacketLogEntry, PacketProtocol, WatchLiveState,
} from './types.ts';
import { LiveBleAdapter, clampInt } from './controllers/liveBleAdapter.ts';
import { decodeStepInfo } from '../watch/protocol/timeAndActivity.ts';
import {
  JIELI_AUTH_OK, JIELI_AUTH_RESET_FLAG, isJieliAuthMessage, isJieliAuthOk, jieliAuthChallenge, jieliAuthResponse,
} from '../audio/jieli/auth.ts';
import { EarbudsController } from './controllers/earbudsController.ts';
import type { EarbudsTransportHost } from './controllers/earbudsController.ts';
import { WatchController } from './controllers/watchController.ts';
import { ConnectionKeeper } from './controllers/connectionKeeper.ts';
import type { KeptDeviceKind, KeeperStatus, ReconnectStrategy } from './controllers/connectionKeeper.ts';
import type { WatchTransportHost } from './controllers/watchController.ts';

const MAX_PACKET_LOGS = 250;

/** Coordinates live BLE discovery, GATT connections, protocol controllers, and offline persistence. */
export class UltimaBleManager {
  private readonly store: OfflineStore;
  private readonly liveAdapter: LiveBleAdapter;
  private readonly earbudsController = new EarbudsController();
  private readonly watchController: WatchController;
  private readonly listeners = new Set<(snapshot: BleManagerSnapshot) => void>();

  private initialized = false;
  private bleAvailable: boolean;
  private scanning = false;
  private lastError: string | null = null;
  private discovered: DiscoveredDevice[] = [];
  private earbuds: EarbudsLiveState;
  private watch: WatchLiveState;
  private packetLogs: PacketLogEntry[] = [];
  private packetCounter = 0;

  private readonly ensurePermissions: () => Promise<boolean>;
  private readonly keeper: ConnectionKeeper;

  constructor(store?: OfflineStore, options?: {
    liveBleManager?: BlePlxManagerLike;
    liveGpsSyncTimeoutMs?: number;
    /** Platform runtime-permission gate run before scan/connect (Android 12+ BLUETOOTH_SCAN/CONNECT). */
    ensurePermissions?: () => Promise<boolean>;
    /** 'retry' (Android, timed attempts + backoff) or 'pending' (iOS, OS-held connect without timeout). */
    reconnectStrategy?: ReconnectStrategy;
    keepAlivePingMs?: number;
    /** iOS Core Bluetooth state-restoration key (see LiveBleAdapterOptions). */
    restoreStateIdentifier?: string;
    /**
     * Phone-side "find my earbuds" sound. Ultima Link plays a looping tone at full
     * media volume through the connected earbuds instead of a firmware command
     * (Jieli earbuds ignore SearchDev). Returns false when the platform can't.
     */
    findSound?: { start(): boolean; stop(): void };
  }) {
    this.findSound = options?.findSound ?? null;
    this.store = store ?? new OfflineStore();
    this.ensurePermissions = options?.ensurePermissions ?? (async () => true);
    this.liveAdapter = new LiveBleAdapter(
      options?.liveBleManager,
      options?.restoreStateIdentifier ? { restoreStateIdentifier: options.restoreStateIdentifier } : {},
    );
    this.keeper = new ConnectionKeeper(
      {
        getTargetId: (kind) => this.keepAliveTargetId(kind),
        isConnected: (kind) => (kind === 'earbuds' ? this.earbuds.connected : this.watch.connected),
        isConnecting: (kind) => (kind === 'earbuds' ? this.earbuds.connecting : this.watch.connecting),
        reconnect: async (_kind, deviceId, persistent) => {
          // Background attempts shouldn't overwrite the user-facing error banner.
          const prevError = this.lastError;
          try {
            await this.connectInternal(deviceId, persistent);
          } catch (err) {
            this.lastError = prevError;
            this.emit();
            throw err;
          }
        },
        ping: (kind) => (kind === 'earbuds' ? this.liveAdapter.pingEarbuds() : this.liveAdapter.pingWatch()),
        onStatusChanged: () => this.emit(),
      },
      {
        strategy: options?.reconnectStrategy ?? 'retry',
        ...(options?.keepAlivePingMs !== undefined ? { pingIntervalMs: options.keepAlivePingMs } : {}),
      },
    );
    this.bleAvailable = this.liveAdapter.isAvailable();
    this.watchController = new WatchController(options?.liveGpsSyncTimeoutMs ?? 8000);
    this.earbuds = createEmptyEarbudsState();
    this.watch = createEmptyWatchState(this.store.getState().watchSettings);
  }

  async init(): Promise<void> {
    const state = await this.store.load();
    this.earbuds = hydrateEarbudsFromStore(state);
    this.watch = hydrateWatchFromStore(state);
    this.initialized = true;
    this.emit();
  }

  getSnapshot(): BleManagerSnapshot {
    return {
      initialized: this.initialized, bleAvailable: this.bleAvailable,
      scanning: this.scanning, lastError: this.lastError, discovered: [...this.discovered],
      earbuds: syncEarbudsState(this.earbuds), watch: syncWatchState(this.watch),
      packetLogs: [...this.packetLogs], storeState: this.store.getState(),
      keepAlive: this.keeper.getStatus(),
    };
  }

  /** Starts pinging live links and auto-reconnecting saved earbuds/watch. */
  startKeepAlive(): void { this.keeper.start(); }
  stopKeepAlive(): void { this.keeper.stop(); }
  /** Re-run reconnect checks now (app foregrounded, Bluetooth turned back on…). */
  pokeKeepAlive(): void { this.keeper.poke(); }

  subscribe(listener: (snapshot: BleManagerSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  async startScan(): Promise<DiscoveredDevice[]> {
    this.stopScan();
    this.lastError = null;
    await this.requirePermissions();
    this.discovered = [];
    this.scanning = true;
    this.emit();

    return this.liveAdapter.runScan({
      getDiscovered: () => this.discovered,
      onDevicesUpdated: (devices) => { this.discovered = devices; this.emit(); },
      onFirstAdvPacket: (parsed, rawAdv) => this.logPacket(PACKET_DIRECTION.RX, PACKET_PROTOCOL.ADV, parsed.id, parsed.name, rawAdv, `ADV ${parsed.name} (${parsed.protocol})`),
      onComplete: () => { this.scanning = false; this.emit(); },
      onError: (msg) => { this.bleAvailable = this.liveAdapter.isAvailable(); this.scanning = false; this.lastError = msg; this.emit(); },
    });
  }

  stopScan(): void {
    this.liveAdapter.stopScan(this.discovered);
    const wasScanning = this.scanning;
    this.scanning = false;
    if (wasScanning) this.emit();
  }

  /**
   * Connects earbuds already paired in the phone's Bluetooth settings. They often
   * stop advertising once connected for audio, so they never show up in a scan.
   */
  async connectPairedEarbuds(address: string, name: string): Promise<void> {
    if (!this.discovered.some((d) => d.id === address)) {
      this.discovered = [...this.discovered, {
        id: address, name, kind: DEVICE_KIND.EARBUDS, rssi: -60, protocol: PACKET_PROTOCOL.ADV,
        mac: address, edrMac: address, offlineVerified: false, rawAdvHex: '',
      }];
    }
    await this.connectDevice(address);
  }

  async connectDevice(deviceId: string): Promise<void> {
    const kind = await this.connectInternal(deviceId, false);
    this.keeper.resume(kind);
  }

  private async connectInternal(deviceId: string, persistent: boolean): Promise<KeptDeviceKind> {
    this.stopScan();
    this.lastError = null;
    await this.requirePermissions();
    const device = this.resolveDeviceForConnect(deviceId);
    if (!device) {
      const msg = `Device not found: ${deviceId}`;
      this.lastError = msg;
      this.emit();
      throw new Error(msg);
    }
    if (device.kind === DEVICE_KIND.EARBUDS) {
      if (this.earbuds.connected && this.earbuds.deviceId !== device.id) await this.teardownEarbuds();
      await this.connectEarbudsDevice(device, persistent);
      return 'earbuds';
    }
    if (this.watch.connected && this.watch.deviceId !== device.id) await this.teardownWatch();
    await this.connectWatchDevice(device, persistent);
    return 'watch';
  }

  /** User-initiated: also pauses auto-reconnect for earbuds until the next manual connect. */
  async disconnectEarbuds(): Promise<void> {
    this.keeper.suppress('earbuds');
    if (this.earbuds.connecting && this.earbuds.deviceId) await this.liveAdapter.cancelPendingConnect(this.earbuds.deviceId);
    await this.teardownEarbuds();
  }

  /** User-initiated: also pauses auto-reconnect for the watch until the next manual connect. */
  async disconnectWatch(): Promise<void> {
    this.keeper.suppress('watch');
    if (this.watch.connecting && this.watch.deviceId) await this.liveAdapter.cancelPendingConnect(this.watch.deviceId);
    await this.teardownWatch();
  }

  private async teardownEarbuds(): Promise<void> {
    await this.liveAdapter.disconnectEarbuds();
    const prevLoc = this.earbuds.lastKnownLocation ?? this.store.getState().pairedDevices.find((d) => d.kind === DEVICE_KIND.EARBUDS)?.lastKnownLocation ?? null;
    this.earbudsController.resetReassembler();
    this.earbuds = syncEarbudsState({ ...createEmptyEarbudsState(), lastKnownLocation: prevLoc ? { ...prevLoc } : null });
    this.emit();
  }

  private async teardownWatch(): Promise<void> {
    await this.liveAdapter.disconnectWatch();
    this.watchController.resetAll();
    const storeState = this.store.getState();
    const pairedWatch = storeState.pairedDevices.find((d) => d.id === this.watch.deviceId || d.kind === DEVICE_KIND.WATCH);
    const fallbackLoc = pairedWatch?.lastKnownLocation ?? this.watch.lastKnownLocation;
    this.watch = syncWatchState({
      ...createEmptyWatchState(storeState.watchSettings), alarms: storeState.watchAlarms.map((a) => ({ ...a })),
      lastKnownLocation: fallbackLoc ? { ...fallbackLoc } : null, gpsRoutes: cloneGpsRoutes(storeState.gpsRoutes ?? []),
    });
    this.emit();
  }

  // Earbuds Controls
  /** Pending Jieli challenge/response exchange (see `audio/jieli/auth.ts`). */
  private jieliAuth: { challenge: Uint8Array; finish: (ok: boolean) => void } | null = null;

  /**
   * Jieli earbuds ignore every command until this two-way handshake passes,
   * which is why battery, EQ and every other control stayed silent.
   */
  private authenticateJieli(timeoutMs = 3000, maxAttempts = 3): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let attempts = 0;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let done = false;
      const finish = (ok: boolean): void => {
        if (done) return;
        done = true;
        if (timer !== null) clearTimeout(timer);
        this.jieliAuth = null;
        resolve(ok);
      };
      const start = async (): Promise<void> => {
        if (done) return;
        attempts += 1;
        const challenge = jieliAuthChallenge();
        this.jieliAuth = { challenge, finish };
        try {
          await this.sendJieliAuth(JIELI_AUTH_RESET_FLAG, 'Unlock: start');
          await new Promise((r) => setTimeout(r, 50));
          await this.sendJieliAuth(challenge, 'Unlock: challenge');
        } catch {
          finish(false);
          return;
        }
        timer = setTimeout(() => { if (attempts < maxAttempts) void start(); else finish(false); }, timeoutMs);
      };
      void start();
    });
  }

  private async sendJieliAuth(bytes: Uint8Array, summary: string): Promise<void> {
    this.logPacket(PACKET_DIRECTION.TX, PACKET_PROTOCOL.JIELI, this.earbuds.deviceId ?? 'earbuds', this.earbuds.name, bytes, summary);
    await this.liveAdapter.writeEarbudsBytes(DEVICE_CHIP.JL, bytes);
  }

  private handleJieliAuthMessage(bytes: Uint8Array): void {
    const id = this.earbuds.deviceId ?? 'earbuds';
    const pending = this.jieliAuth;
    if (isJieliAuthOk(bytes)) {
      this.logPacket(PACKET_DIRECTION.RX, PACKET_PROTOCOL.JIELI, id, this.earbuds.name, bytes, 'Unlock: accepted');
      pending?.finish(true);
      return;
    }
    if (bytes[0] === 0x01) {
      // The earbuds' answer to our challenge. The official SDK checks it before saying "pass".
      const expected = pending ? jieliAuthResponse(pending.challenge) : null;
      const matches = !!expected && expected.every((b, i) => b === bytes[i]);
      this.logPacket(PACKET_DIRECTION.RX, PACKET_PROTOCOL.JIELI, id, this.earbuds.name, bytes, matches ? 'Unlock: earbuds answered' : 'Unlock: unexpected answer');
      void this.sendJieliAuth(JIELI_AUTH_OK, 'Unlock: answer OK').catch(() => pending?.finish(false));
      return;
    }
    // 0x00 + 16 random bytes: the earbuds' challenge to us.
    this.logPacket(PACKET_DIRECTION.RX, PACKET_PROTOCOL.JIELI, id, this.earbuds.name, bytes, 'Unlock: earbuds challenge');
    void this.sendJieliAuth(jieliAuthResponse(bytes), 'Unlock: our answer').catch(() => pending?.finish(false));
  }

  async refreshEarbudsInfo(): Promise<void> { await this.earbudsController.refreshInfo(this.createEarbudsHost(), this.requireEarbudsConnected()); }
  async setEarbudsAncMode(mode: 'off' | 'anc' | 'transparency'): Promise<void> { await this.runEarbudsAction((c) => this.earbudsController.setAncMode(this.createEarbudsHost(), c, mode), () => ({ ancMode: this.earbuds.ancMode })); }
  async setEarbudsAncGain(gain: number): Promise<void> { await this.runEarbudsAction((c) => this.earbudsController.setAncGain(this.createEarbudsHost(), c, gain), () => ({ ancGain: this.earbuds.ancGain })); }
  async setEarbudsTransparencyGain(gain: number): Promise<void> { await this.runEarbudsAction((c) => this.earbudsController.setTransparencyGain(this.createEarbudsHost(), c, gain), () => ({ transparencyGain: this.earbuds.transparencyGain })); }
  async setEarbudsEq(gains: number[], presetName: string, presetModeByte?: number): Promise<void> { await this.earbudsController.setEq(this.createEarbudsHost(), this.requireEarbudsConnected(), gains, presetName, presetModeByte); }
  async setEarbudsGameMode(enabled: boolean): Promise<void> { await this.runEarbudsAction((c) => this.earbudsController.setGameMode(this.createEarbudsHost(), c, enabled), () => ({ gameMode: this.earbuds.gameMode })); }
  async setEarbudsSpatialAudio(enabled: boolean): Promise<void> { await this.runEarbudsAction((c) => this.earbudsController.setSpatialAudio(this.createEarbudsHost(), c, enabled), () => ({ spatialAudio: this.earbuds.spatialAudio })); }
  async setEarbudsLdac(enabled: boolean): Promise<void> { await this.runEarbudsAction((c) => this.earbudsController.setLdac(this.createEarbudsHost(), c, enabled), () => ({ ldac: this.earbuds.ldac })); }
  async setEarbudsInEarDetect(enabled: boolean): Promise<void> { await this.runEarbudsAction((c) => this.earbudsController.setInEarDetect(this.createEarbudsHost(), c, enabled), () => ({ inEarDetect: this.earbuds.inEarDetect })); }
  async setEarbudsDualConnect(enabled: boolean): Promise<void> { await this.runEarbudsAction((c) => this.earbudsController.setDualConnect(this.createEarbudsHost(), c, enabled), () => ({ dualConnect: this.earbuds.dualConnect })); }
  async setEarbudsLed(enabled: boolean): Promise<void> { await this.runEarbudsAction((c) => this.earbudsController.setLed(this.createEarbudsHost(), c, enabled), () => ({ ledOn: this.earbuds.ledOn })); }
  async setEarbudsLanguage(lang: 'en' | 'zh'): Promise<void> { await this.runEarbudsAction((c) => this.earbudsController.setLanguage(this.createEarbudsHost(), c, lang), () => ({ voiceLanguage: this.earbuds.voiceLanguage })); }
  async setEarbudsKeyMapping(side: 'left' | 'right', gesture: 'single' | 'double' | 'triple' | 'longPress', fnCode: number): Promise<void> {
    const safeFn = clampInt(fnCode, 0, 9) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
    await this.runEarbudsAction((c) => this.earbudsController.setKeyMapping(this.createEarbudsHost(), c, side, gesture, safeFn), () => ({ keyMappings: { [side]: { [gesture]: safeFn } } }));
  }
  async setEarbudsCaseKeyMapping(gesture: 'single' | 'double' | 'triple' | 'longPress' | 'rotation', fnCode: number): Promise<void> {
    const safeFn = clampInt(fnCode, 0, 255);
    await this.runEarbudsAction((c) => this.earbudsController.setCaseKeyMapping(this.createEarbudsHost(), c, gesture, safeFn), () => ({ keyMappings: { caseKeys: { [gesture]: { keyFunction: safeFn, callControl: 0 } } } }));
  }

  async renameEarbuds(name: string): Promise<void> {
    const chip = this.requireEarbudsConnected();
    const trimmed = name.trim();
    if (trimmed.length === 0) throw new RangeError('Earbuds Bluetooth name cannot be empty');
    await this.earbudsController.rename(this.createEarbudsHost(), chip, trimmed);
    const deviceId = this.earbuds.deviceId;
    if (deviceId) {
      await this.store.updateEarbudPrefs(deviceId, { customBtName: this.earbuds.name });
      await this.store.upsertPairedDevice({
        id: deviceId, name: this.earbuds.name, kind: DEVICE_KIND.EARBUDS, chip,
        ...(this.earbuds.pid !== null ? { pid: this.earbuds.pid } : {}),
        ...(this.earbuds.mac !== null ? { mac: this.earbuds.mac } : {}), lastConnectedAt: Date.now(),
      });
      this.emit();
    }
  }

  private readonly findSound: { start(): boolean; stop(): void } | null;
  async findEarbuds(enable: boolean): Promise<void> {
    const chip = this.requireEarbudsConnected();
    if (chip === DEVICE_CHIP.JL && this.findSound) {
      if (enable && !this.findSound.start()) throw new Error('Couldn’t play the sound on this phone.');
      if (!enable) this.findSound.stop();
      this.earbuds = syncEarbudsState({ ...this.earbuds, finding: enable, findingActive: enable });
      this.emit();
      return;
    }
    await this.earbudsController.find(this.createEarbudsHost(), chip, enable);
  }

  async pinLastKnownEarbudsLocation(note: string, lat?: number, lng?: number): Promise<void> {
    const { targetId, existingPaired } = await this.ensurePairedTarget(DEVICE_KIND.EARBUDS, 'No earbuds connected or paired to pin location');
    const resolvedLat = lat ?? this.earbuds.lastKnownLocation?.lat ?? existingPaired?.lastKnownLocation?.lat ?? 0;
    const resolvedLng = lng ?? this.earbuds.lastKnownLocation?.lng ?? existingPaired?.lastKnownLocation?.lng ?? 0;
    const saved = (await this.store.setLastKnownLocation(targetId, { lat: resolvedLat, lng: resolvedLng, note })).pairedDevices.find((d) => d.id === targetId)?.lastKnownLocation ?? null;
    this.earbuds = syncEarbudsState({ ...this.earbuds, lastKnownLocation: saved ? { ...saved } : null, sideLocations: deriveEarbudSideLocations(saved) });
    this.emit();
  }

  async pinEarbudSideLocation(side: 'left' | 'right' | 'case', note: string, lat: number, lng: number): Promise<void> {
    const { targetId } = await this.ensurePairedTarget(DEVICE_KIND.EARBUDS, 'No earbuds connected or paired to pin side location');
    const saved = (await this.store.setLastKnownLocation(targetId, { lat, lng, note })).pairedDevices.find((d) => d.id === targetId)?.lastKnownLocation ?? null;
    const prev = deriveEarbudSideLocations(this.earbuds.lastKnownLocation ?? saved, this.earbuds.sideLocations);
    const pin: DeviceGeoPin = { lat, lng, note, savedAt: Date.now() + 1, role: side === 'left' ? 'left_earbud' : side === 'right' ? 'right_earbud' : 'case' };
    const sideLocations = { left: side === 'left' ? pin : prev.left, right: side === 'right' ? pin : prev.right, casePin: side === 'case' ? pin : prev.casePin };
    this.earbuds = syncEarbudsState({ ...this.earbuds, lastKnownLocation: saved ? { ...saved } : null, sideLocations });
    this.emit();
  }

  async factoryResetEarbuds(): Promise<void> {
    await this.earbudsController.factoryReset(this.createEarbudsHost(), this.requireEarbudsConnected());
    if (this.earbuds.deviceId) await this.store.updateEarbudPrefs(this.earbuds.deviceId, { ...createDefaultEarbudPrefs(), customBtName: this.earbuds.name });
    this.emit();
  }

  // Watch Controls
  async syncWatchAll(): Promise<void> { this.requireWatchConnected(); await this.watchController.syncAll(this.createWatchHost()); }
  async syncWatchTime(): Promise<void> { this.requireWatchConnected(); await this.watchController.syncTime(this.createWatchHost()); }
  async syncWatchGpsRoutes(): Promise<void> { this.requireWatchConnected(); await this.watchController.syncGpsRoutes(this.createWatchHost()); }
  async deleteWatchGpsRoute(routeId: string): Promise<void> {
    const state = await this.store.deleteGpsRoute(routeId);
    this.watch = syncWatchState({ ...this.watch, gpsRoutes: state.gpsRoutes });
    this.emit();
  }
  /** Mirrors a phone-recorded workout on the watch so it measures heart rate and records the session too. */
  async startWatchWorkout(type: number): Promise<void> { this.requireWatchConnected(); await this.watchController.training(this.createWatchHost(), { start: type }); }
  async setWatchWorkoutState(state: 'pause' | 'resume' | 'stop'): Promise<void> { this.requireWatchConnected(); await this.watchController.training(this.createWatchHost(), state); }
  async measureWatchHeartRate(start: boolean): Promise<void> { this.requireWatchConnected(); await this.watchController.measureVital(this.createWatchHost(), 'hr', start); }
  async measureWatchSpO2(start: boolean): Promise<void> { this.requireWatchConnected(); await this.watchController.measureVital(this.createWatchHost(), 'spo2', start); }
  async measureWatchBloodPressure(start: boolean): Promise<void> { this.requireWatchConnected(); await this.watchController.measureVital(this.createWatchHost(), 'bp', start); }
  async queryWatchStress(): Promise<void> { this.requireWatchConnected(); await this.watchController.queryStress(this.createWatchHost()); }
  async setWatchGoalSteps(steps: number): Promise<void> { const s = clampInt(steps, 1000, 100000); await this.runWatchSetting(encodeGoalSteps(s), `SetGoalSteps (${s})`, { goalSteps: s }); }
  async setWatchTimeFormat(is24Hour: boolean): Promise<void> { await this.runWatchSetting(encodeTimeSystem(is24Hour), `SetTimeSystem (${is24Hour ? '24h' : '12h'})`, { is24Hour }); }
  async setWatchQuickView(enabled: boolean): Promise<void> { await this.runWatchSetting(encodeQuickView(enabled), `SetQuickView (${enabled})`, { quickView: enabled }); }
  async setWatchFace(faceId: number): Promise<void> { const f = clampInt(faceId, 0, 255); await this.runWatchSetting(encodeWatchFace(f), `SetWatchFace (${f})`, { watchFaceId: f }); }
  async setWatchUnits(imperial: boolean): Promise<void> { await this.runWatchSetting(encodeMetricSystem(imperial), `SetUnits (${imperial ? 'imperial' : 'metric'})`, { imperialUnits: imperial }); }
  async setWatchLanguage(languageId: number): Promise<void> { const l = clampInt(languageId, 0, 255); await this.runWatchSetting(encodeWatchLanguage(l), `SetWatchLanguage (${l})`, { languageId: l }); }
  async setWatchSedentaryReminder(enabled: boolean): Promise<void> { await this.runWatchSetting(encodeSedentaryReminder(enabled), `SetSedentaryReminder (${enabled})`, { sedentaryReminder: enabled }); }
  async setWatchHrInterval(minutes: number): Promise<void> {
    const units = hrIntervalUnits(minutes);
    await this.runWatchSetting(encodeTimingHeartRateInterval(units), `SetHrInterval (${units * 5}m)`, { hrIntervalMinutes: units * 5 });
  }
  async setWatchDrinkReminder(period: { enabled: boolean; startHour: number; startMinute: number; endHour: number; endMinute: number }): Promise<void> {
    const frame = buildCrpFrame(CRP_CMD.SET_DRINK_WATER_REMINDER, Uint8Array.of(
      period.enabled ? 1 : 0, clampInt(period.startHour, 0, 23), clampInt(period.startMinute, 0, 59), clampInt(period.endHour, 0, 23), clampInt(period.endMinute, 0, 59),
    ));
    await this.runWatchSetting(frame, `SetDrinkReminder (${period.enabled ? 'on' : 'off'})`, { drinkReminderPeriod: { enabled: period.enabled, startHour: clampInt(period.startHour, 0, 23), startMinute: clampInt(period.startMinute, 0, 59), endHour: clampInt(period.endHour, 0, 23), endMinute: clampInt(period.endMinute, 0, 59) } });
  }
  async saveWatchAlarm(alarm: WatchAlarmRecord): Promise<void> { this.requireWatchConnected(); await this.watchController.saveAlarm(this.createWatchHost(), alarm); }
  async deleteWatchAlarm(id: number): Promise<void> { this.requireWatchConnected(); await this.watchController.deleteAlarm(this.createWatchHost(), id); }
  async pushWatchNotification(messageType: number, text: string): Promise<void> { this.requireWatchConnected(); await this.watchController.pushNotification(this.createWatchHost(), messageType, text); }
  async findWatch(): Promise<void> { this.requireWatchConnected(); await this.watchController.findWatch(this.createWatchHost()); }

  async pinLastKnownWatchLocation(note: string, lat?: number, lng?: number): Promise<void> {
    const { targetId, existingPaired } = await this.ensurePairedTarget(DEVICE_KIND.WATCH, 'No watch connected or paired to pin location');
    const latestRoutePt = this.watch.gpsRoutes[0]?.waypoints[Math.max(0, this.watch.gpsRoutes[0]!.waypoints.length - 1)] ?? null;
    const resolvedLat = lat ?? this.watch.lastKnownLocation?.lat ?? existingPaired?.lastKnownLocation?.lat ?? latestRoutePt?.lat ?? 27.7172;
    const resolvedLng = lng ?? this.watch.lastKnownLocation?.lng ?? existingPaired?.lastKnownLocation?.lng ?? latestRoutePt?.lng ?? 85.324;
    if (this.watch.connected) await this.watchController.sendFrame(this.createWatchHost(), encodeSendLocalLocation(resolvedLat, resolvedLng), 'SendLocalLocation (0xB3 0x04)');
    const updatedState = await this.store.setLastKnownLocation(targetId, { lat: resolvedLat, lng: resolvedLng, note });
    const saved = updatedState.pairedDevices.find((d) => d.id === targetId)?.lastKnownLocation ?? null;
    this.watch = syncWatchState({ ...this.watch, lastKnownLocation: saved ? { ...saved } : null });
    this.emit();
  }

  async sendRawHex(target: 'earbuds' | 'watch', hexPayload: string): Promise<void> {
    const bytes = hexToBytes(hexPayload);
    if (bytes.length === 0) throw new RangeError('Raw hex payload cannot be empty');
    if (target === 'earbuds') {
      const chip = this.requireEarbudsConnected();
      this.logPacket(PACKET_DIRECTION.TX, chip === DEVICE_CHIP.BT ? PACKET_PROTOCOL.BLUETRUM : PACKET_PROTOCOL.JIELI, this.earbuds.deviceId ?? 'earbuds', this.earbuds.name, bytes, `Raw TX (${bytes.length} B)`);
      await this.liveAdapter.writeEarbudsBytes(chip, bytes);
      return;
    }
    this.requireWatchConnected();
    this.logPacket(PACKET_DIRECTION.TX, PACKET_PROTOCOL.CRREPA, this.watch.deviceId ?? 'watch', this.watch.name, bytes, `Raw TX (${bytes.length} B)`);
    await this.liveAdapter.writeWatchBytes(bytes);
  }

  clearPacketLogs(): void { this.packetLogs = []; this.emit(); }
  destroy(): void { this.keeper.stop(); this.stopScan(); this.teardownConnectionsSync(); this.liveAdapter.destroy(); }

  /** Device to keep connected: the active one, else the most recently connected saved device of that kind. */
  private keepAliveTargetId(kind: KeptDeviceKind): string | null {
    const active = kind === 'earbuds' ? this.earbuds.deviceId : this.watch.deviceId;
    if (active) return active;
    const saved = this.store.getState().pairedDevices
      .filter((d) => d.kind === kind)
      .sort((a, b) => (b.lastConnectedAt ?? 0) - (a.lastConnectedAt ?? 0));
    return saved[0]?.id ?? null;
  }

  private resolveDeviceForConnect(deviceId: string): DiscoveredDevice | undefined {
    const existing = this.discovered.find((d) => d.id === deviceId);
    if (existing) return existing;
    const paired = this.store.getState().pairedDevices.find((d) => d.id === deviceId);
    if (!paired) return undefined;
    const isWatch = paired.kind === DEVICE_KIND.WATCH;
    return {
      id: paired.id, name: paired.name, kind: paired.kind, rssi: -60,
      protocol: isWatch ? PACKET_PROTOCOL.CRREPA : paired.chip === DEVICE_CHIP.JL ? PACKET_PROTOCOL.JIELI : PACKET_PROTOCOL.BLUETRUM,
      ...(paired.mac !== undefined ? { mac: paired.mac, edrMac: paired.mac } : {}),
      ...(paired.chip !== undefined ? { chip: paired.chip } : {}),
      ...(paired.pid !== undefined ? { pid: paired.pid, productName: paired.name } : {}),
      offlineVerified: true, rawAdvHex: '',
    };
  }

  private async connectEarbudsDevice(device: DiscoveredDevice, persistent = false): Promise<void> {
    // Devices picked from Android's paired list carry no advertisement, so the chip is detected after connecting.
    const chipHint: DeviceChip | null = device.chip ?? device.product?.chip ??
      (device.protocol === PACKET_PROTOCOL.BLUETRUM ? DEVICE_CHIP.BT : device.protocol === PACKET_PROTOCOL.JIELI ? DEVICE_CHIP.JL : null);
    let chip: DeviceChip = chipHint ?? DEVICE_CHIP.BT;
    const product = device.product ?? (device.pid !== undefined ? getProductById(device.pid) : undefined) ?? null;
    this.earbudsController.resetReassembler();
    const storeState = this.store.getState();
    const pairedRecord = storeState.pairedDevices.find((d) => d.id === device.id);
    this.earbuds = syncEarbudsState({
      ...createEmptyEarbudsState(), connecting: true, deviceId: device.id, name: device.name, deviceName: device.name,
      chip, pid: device.pid ?? product?.id ?? null, productId: device.pid ?? product?.id ?? 0, mac: device.mac ?? device.edrMac ?? null,
      product, firmwareVersion: '',
      ...(pairedRecord?.lastKnownLocation ? { lastKnownLocation: { ...pairedRecord.lastKnownLocation } } : {}),
    });
    this.emit();

    const host = this.createEarbudsHost();
    try {
      chip = await this.liveAdapter.connectEarbuds(device.id, chipHint, {
        onChipDetected: (detected) => { chip = detected; this.earbuds = syncEarbudsState({ ...this.earbuds, chip: detected }); },
        onRxBytes: (b) => {
          if (chip === DEVICE_CHIP.BT) { this.earbudsController.handleBluetrumRxBytes(host, b); return; }
          if (isJieliAuthMessage(b)) { this.handleJieliAuthMessage(b); return; }
          this.earbudsController.handleJieliRxBytes(host, b);
        },
        onDisconnected: () => { this.earbuds = syncEarbudsState({ ...this.earbuds, connected: false, connecting: false }); this.emit(); this.keeper.notifyUnexpectedDisconnect('earbuds'); },
        onError: (msg) => { this.bleAvailable = this.liveAdapter.isAvailable(); this.lastError = msg; this.emit(); },
      }, persistent);
    } catch (err) {
      this.earbuds = syncEarbudsState({ ...this.earbuds, connected: false, connecting: false });
      this.lastError = err instanceof Error ? err.message : String(err);
      this.emit();
      throw err;
    }

    this.earbuds = syncEarbudsState({ ...this.earbuds, chip, connected: true, connecting: false, lastSyncedAt: Date.now() });
    await this.store.upsertPairedDevice({
      id: device.id, name: this.earbuds.name, kind: DEVICE_KIND.EARBUDS, chip,
      ...(this.earbuds.pid !== null ? { pid: this.earbuds.pid } : {}), ...(this.earbuds.mac !== null ? { mac: this.earbuds.mac } : {}), lastConnectedAt: Date.now(),
    });
    if (chip === DEVICE_CHIP.JL) {
      const unlocked = await this.authenticateJieli();
      if (!unlocked) {
        this.lastError = 'The earbuds didn’t accept the app. Battery and controls may not update — reconnect to try again.';
        this.emit();
      }
    }
    await this.refreshEarbudsInfo();
    if (this.earbuds.deviceId) {
      await this.store.updateEarbudPrefs(this.earbuds.deviceId, {
        ancMode: this.earbuds.ancMode, ancGain: this.earbuds.ancGain, transparencyGain: this.earbuds.transparencyGain,
        gameMode: this.earbuds.gameMode, spatialAudio: this.earbuds.spatialAudio, ldac: this.earbuds.ldac,
        inEarDetect: this.earbuds.inEarDetect, dualConnect: this.earbuds.dualConnect, ledOn: this.earbuds.ledOn,
        voiceLanguage: this.earbuds.voiceLanguage, customBtName: this.earbuds.name, keyMappings: cloneEarbudKeyMappings(this.earbuds.keyMappings),
      });
    }
    this.emit();
  }

  private async connectWatchDevice(device: DiscoveredDevice, persistent = false): Promise<void> {
    const storeState = this.store.getState();
    const pairedWatchRecord = storeState.pairedDevices.find((d) => d.id === device.id);
    this.watchController.resetForConnect();
    this.watch = syncWatchState({
      ...createEmptyWatchState(storeState.watchSettings), connecting: true, deviceId: device.id, name: device.name, deviceName: device.name,
      mac: device.mac ?? device.edrMac ?? null, firmwareType: device.firmwareType ?? device.crpFirmware ?? '',
      platform: device.platform ?? device.crpPlatform ?? null, chipId: device.chipId ?? device.crpChipId ?? null,
      functionMask: device.functionMask ?? device.crpFunctionMask ?? 0, alarms: storeState.watchAlarms.map((a) => ({ ...a })),
      lastKnownLocation: pairedWatchRecord?.lastKnownLocation ? { ...pairedWatchRecord.lastKnownLocation } : null,
      gpsRoutes: cloneGpsRoutes(storeState.gpsRoutes ?? []),
    });
    this.emit();

    const liveHost = this.createWatchHost();
    try {
      await this.liveAdapter.connectWatch(device.id, {
        onCrrepaRxBytes: (b) => { void this.watchController.handleRxBytesAndFollowups(liveHost, b).catch(() => undefined); },
        onBatteryPercent: (percent) => { this.watch = syncWatchState({ ...this.watch, batteryPercent: percent }); this.emit(); },
        onStepBytes: (bytes) => {
          const info = decodeStepInfo(bytes);
          if (!info) return;
          this.watch = syncWatchState({ ...this.watch, steps: info.steps, distanceMeters: info.distanceMeters, caloriesKcal: info.caloriesKcal, lastSyncedAt: Date.now() });
          this.emit();
        },
        onFirmwareRevision: (revision) => { this.watch = syncWatchState({ ...this.watch, firmwareVersion: revision }); this.emit(); },
        onDisconnected: () => { this.watchController.resetForLiveDisconnect(); this.watch = syncWatchState({ ...this.watch, connected: false, connecting: false, gpsSyncing: false }); this.emit(); this.keeper.notifyUnexpectedDisconnect('watch'); },
        onError: (msg) => { this.bleAvailable = this.liveAdapter.isAvailable(); this.lastError = msg; this.emit(); },
      }, persistent);
    } catch (err) {
      this.watch = syncWatchState({ ...this.watch, connected: false, connecting: false });
      this.lastError = err instanceof Error ? err.message : String(err);
      this.emit();
      throw err;
    }

    this.watch = syncWatchState({ ...this.watch, connected: true, connecting: false, lastSyncedAt: Date.now() });
    await this.store.upsertPairedDevice({
      id: device.id, name: this.watch.name, kind: DEVICE_KIND.WATCH, ...(this.watch.mac !== null ? { mac: this.watch.mac } : {}), lastConnectedAt: Date.now(),
    });
    const host = this.createWatchHost();
    await this.watchController.syncTime(host);
    await this.watchController.sendSequence(host, encodeSyncStepsAndSleep(), 'SyncStepsAndSleep');
    await this.watchController.sendFrame(host, encodeQueryNewAlarms(), 'QueryNewAlarms (0xB9)');
    await this.watchController.syncExtendedVitals(host);
    await this.watchController.persistHealthDay(host);
    this.emit();
  }

  private async ensurePairedTarget(kind: 'earbuds' | 'watch', errorMsg: string) {
    const state = this.store.getState();
    const active = kind === DEVICE_KIND.EARBUDS ? this.earbuds : this.watch;
    const targetId = active.deviceId ?? state.pairedDevices.find((d) => d.kind === kind)?.id ?? null;
    if (!targetId) throw new Error(errorMsg);
    const existingPaired = state.pairedDevices.find((d) => d.id === targetId);
    if (!existingPaired) {
      const chipPatch = kind === DEVICE_KIND.EARBUDS ? { ...(this.earbuds.chip !== null ? { chip: this.earbuds.chip } : {}), ...(this.earbuds.pid !== null ? { pid: this.earbuds.pid } : {}) } : {};
      await this.store.upsertPairedDevice({ id: targetId, name: active.name, kind, ...chipPatch, ...(active.mac !== null ? { mac: active.mac } : {}), lastConnectedAt: Date.now() });
    }
    return { targetId, existingPaired };
  }

  private async runEarbudsAction(fn: (chip: DeviceChip) => Promise<void>, pickPatch: () => EarbudPrefsPatch): Promise<void> {
    await fn(this.requireEarbudsConnected());
    if (!this.earbuds.deviceId) return;
    await this.store.updateEarbudPrefs(this.earbuds.deviceId, pickPatch());
    this.emit();
  }

  /**
   * Sends a setting and applies it locally. Real watches don't echo SET commands,
   * so the new value is stored as soon as the write succeeds (a later query reply
   * from the watch still overrides it).
   */
  private async runWatchSetting(frame: Uint8Array, summary: string, patch: WatchSettingsPatch): Promise<void> {
    this.requireWatchConnected();
    await this.watchController.sendFrame(this.createWatchHost(), frame, summary);
    this.watch = syncWatchState({ ...this.watch, settings: { ...this.watch.settings, ...patch } as WatchLiveState['settings'] });
    await this.store.updateWatchSettings(patch);
    this.emit();
  }

  private async requirePermissions(): Promise<void> {
    let granted = false;
    try { granted = await this.ensurePermissions(); } catch { granted = false; }
    if (!granted) {
      const msg = 'Bluetooth permission denied. Allow Nearby devices (and Location) for Ultima Open in system settings.';
      this.lastError = msg;
      this.emit();
      throw new Error(msg);
    }
  }

  private requireEarbudsConnected(): DeviceChip {
    if (!this.earbuds.connected || !this.earbuds.deviceId || !this.earbuds.chip) throw new Error('Earbuds are not connected');
    return this.earbuds.chip;
  }
  private requireWatchConnected(): void {
    if (!this.watch.connected || !this.watch.deviceId) throw new Error('Smartwatch is not connected');
  }
  private createEarbudsHost(): EarbudsTransportHost {
    return {
      getState: () => this.earbuds, setState: (next) => { this.earbuds = next; },
      writeLiveBytes: (chip, bytes) => this.liveAdapter.writeEarbudsBytes(chip, bytes),
      logPacket: (dir, proto, id, name, b, sum, cmd) => this.logPacket(dir, proto, id, name, b, sum, cmd),
      setError: (msg) => { this.lastError = msg; }, emit: () => this.emit(),
    };
  }
  private createWatchHost(): WatchTransportHost {
    return {
      getState: () => this.watch, setState: (next) => { this.watch = next; },
      writeLiveBytes: (bytes) => this.liveAdapter.writeWatchBytes(bytes),
      logPacket: (dir, proto, id, name, b, sum, cmd) => this.logPacket(dir, proto, id, name, b, sum, cmd),
      getStore: () => this.store, emit: () => this.emit(),
    };
  }
  private logPacket(direction: PacketDirection, protocol: PacketProtocol, deviceId: string, deviceName: string, bytes: Uint8Array, summary: string, cmd?: number): void {
    this.packetCounter += 1;
    const target: 'earbuds' | 'watch' = protocol === PACKET_PROTOCOL.CRREPA || deviceId.toLowerCase().includes('watch') ? 'watch' : 'earbuds';
    const uuid = protocol === PACKET_PROTOCOL.BLUETRUM ? BLUETRUM_UUIDS.NOTIFY_WRITE
      : protocol === PACKET_PROTOCOL.JIELI ? (direction === PACKET_DIRECTION.TX ? JIELI_UUIDS.WRITE : JIELI_UUIDS.NOTIFY)
        : protocol === PACKET_PROTOCOL.CRREPA ? (direction === PACKET_DIRECTION.TX ? CRREPA_UUIDS.FEE2 : CRREPA_UUIDS.FEE1) : undefined;
    this.packetLogs.push({
      id: `pkt-${this.packetCounter}`, timestamp: Date.now(), direction, target, protocol, deviceId, deviceName,
      summary, label: summary, hex: bytesToHex(bytes, ' '), byteLength: bytes.length, length: bytes.length,
      ...(cmd !== undefined ? { cmd } : {}), ...(uuid !== undefined ? { uuid } : {}),
    });
    if (this.packetLogs.length > MAX_PACKET_LOGS) this.packetLogs = this.packetLogs.slice(-MAX_PACKET_LOGS);
  }
  private teardownConnectionsSync(): void {
    this.liveAdapter.teardownConnectionsSync();
    this.earbudsController.resetReassembler(); this.watchController.resetAll();
    this.earbuds = syncEarbudsState(createEmptyEarbudsState());
    this.watch = syncWatchState(createEmptyWatchState(this.watch.settings));
  }
  private emit(): void {
    if (this.listeners.size === 0) return;
    const snap = this.getSnapshot();
    for (const listener of this.listeners) listener(snap);
  }
}
export { EQ_FREQUENCIES };

/** Timing heart-rate values the watch accepts, in 5-minute units (official app: 5/10/20/30 min). */
export const WATCH_HR_INTERVAL_MINUTES = [5, 10, 20, 30] as const;

/** Maps minutes to the nearest supported 5-minute unit (1, 2, 4 or 6); 0 = off. */
export function hrIntervalUnits(minutes: number): number {
  if (!(minutes > 0)) return 0;
  const nearest = WATCH_HR_INTERVAL_MINUTES.reduce((best, m) => (Math.abs(m - minutes) < Math.abs(best - minutes) ? m : best));
  return nearest / 5;
}
