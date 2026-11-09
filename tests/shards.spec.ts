// Router sharding (docs/017 P2, article §2.1): placement that keeps every Thread on one Router Session.
import { expect, it } from 'vitest'
import { shardLoads, shardOf, shardSessionIds, stableHash, triggerSessionId } from '../src/app/shards.ts'

it('keeps the same Thread on the same shard, whatever the count it is asked with', () => {
  // Affinity is the invariant: one conversation must never be split across two Router memories.
  for (const key of ['github:7', 'github:12', 'feishu:om_abc', 'mail:thread/9']) {
    expect(shardOf(key, 4)).toBe(shardOf(key, 4))
    expect(shardOf(key, 1)).toBe(0)
  }
  // A stable hash does not depend on the engine.
  expect(stableHash('github:7')).toBe(stableHash('github:7'))
  expect(stableHash('a')).not.toBe(stableHash('b'))
})

it('names one Session per shard, keeping the base Router id for shard 0', () => {
  expect(shardSessionIds('orchestrator-abc', 1)).toEqual(['orchestrator-abc'])
  expect(shardSessionIds('orchestrator-abc', 3)).toEqual(['orchestrator-abc', 'orchestrator-abc-shard-1', 'orchestrator-abc-shard-2'])
  // A nonsense count still yields at least the base Session.
  expect(shardSessionIds('orchestrator-abc', 0)).toEqual(['orchestrator-abc'])
})

it('routes a Trigger by its Thread, and sends a Threadless Trigger to the base Router', () => {
  const base = 'orchestrator-abc'
  expect(triggerSessionId({ thread: 'github:7' }, base, 1)).toBe(base)
  expect(triggerSessionId({}, base, 4)).toBe(base)
  const id = triggerSessionId({ thread: 'github:7' }, base, 4)
  expect(shardSessionIds(base, 4)).toContain(id)
  // The same Thread always reaches the same Session.
  expect(triggerSessionId({ thread: 'github:7' }, base, 4)).toBe(id)
})

it('spreads a sample of Threads across the shards without losing any', () => {
  const keys = Array.from({ length: 200 }, (_, index) => `github:${index}`)
  const loads = shardLoads(keys, 4)
  expect(loads.reduce((sum, load) => sum + load, 0)).toBe(keys.length)
  // Every shard gets some work on a sample this size; a single shard taking everything would mean a broken hash.
  expect(loads.filter(load => load > 0).length).toBe(4)
})
