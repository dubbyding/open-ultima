export { CONNECTION_MODE, PACKET_DIRECTION, PACKET_PROTOCOL } from './types.ts';
export type {
  BleManagerSnapshot,
  BlePlxCharacteristicLike,
  BlePlxDeviceLike,
  BlePlxManagerLike,
  BlePlxSubscriptionLike,
  ConnectionMode,
  DeviceGeoPin,
  DiscoveredDevice,
  EarbudSideLocations,
  EarbudsBatteryState,
  EarbudsLiveKeyMappings,
  EarbudsLiveState,
  PacketDirection,
  PacketLogEntry,
  PacketProtocol,
  WatchBloodPressureLiveState,
  WatchHeartRateLiveState,
  WatchLiveState,
  WatchNotificationRecord,
  WatchSleepLiveState,
  WatchSpO2LiveState,
  WatchStressLiveState,
} from './types.ts';
export { EQ_FREQUENCIES, UltimaBleManager } from './UltimaBleManager.ts';
export { LiveBleAdapter, loadBlePlxModule } from './controllers/liveBleAdapter.ts';
export { EarbudsController } from './controllers/earbudsController.ts';
export { WatchController } from './controllers/watchController.ts';
export { SimBluetrumEarbuds } from './simulators/simBluetrumEarbuds.ts';
export { SimJieliEarbuds } from './simulators/simJieliEarbuds.ts';
export { SimCrrepaWatch } from './simulators/simCrrepaWatch.ts';
export {
  SIM_EARBUDS_FIXTURES,
  SIM_WATCH_FIXTURES,
  buildSimulatedDiscovery,
} from './simulators/simDiscovery.ts';
export type { SimEarbudsFixture, SimWatchFixture } from './simulators/simDiscovery.ts';
