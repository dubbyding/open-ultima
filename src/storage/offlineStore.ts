/**
 * Thin barrel re-exporting offline persistence storage APIs from the storage domain.
 */

export * from '../domains/storage/types.ts';
export {
  MemoryStorageBackend,
  createDefaultStorageBackend,
} from '../domains/storage/backends.ts';
export {
  createDefaultDailyHealthRecord,
  createDefaultEarbudPrefs,
  createDefaultOfflineAppState,
  createDefaultWatchSettings,
} from '../domains/storage/validatorsAndDefaults.ts';
export { OfflineStore } from '../domains/storage/OfflineStore.ts';
