import { useLiveQuery } from 'dexie-react-hooks'
import { syncManager } from '../db/sync'
import { useSyncStatusStore } from '../stores/syncStatusStore'

/**
 * `useLiveQuery` over the local cache that never throws into render: a storage
 * fault (broken store, failed schema upgrade) yields `fallback` and goes through
 * the sync manager's fault handling (reset → rebuild), and the query
 * re-subscribes once the cache is reset. `undefined` while the first read runs.
 */
export function useCacheQuery<T>(querier: () => Promise<T> | T, deps: unknown[], fallback: T): T | undefined {
  const generation = useSyncStatusStore((s) => s.cacheGeneration)
  return useLiveQuery(
    async () => {
      try {
        return await querier()
      } catch (err) {
        void syncManager.reportStorageFault(err)
        return fallback
      }
    },
    [...deps, generation]
  )
}
