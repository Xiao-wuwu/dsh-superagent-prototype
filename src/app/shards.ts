/**
 * Router sharding: the scaling path the official design names (article §2.1).
 *
 * The article is explicit that sharding is a continuity/throughput trade-off: a finer split raises Router throughput and
 * lowers cross-shard memory continuity. The one property that must never break is **Thread affinity** — every Trigger of
 * one Thread has to reach the same Router Session, or a single conversation would be handled by two different memories.
 *
 * This module is the placement decision only (pure, testable). Wiring it into trigger dispatch is a separate step, and the
 * feature stays off unless `routerShards` is above one.
 */

/** FNV-1a, 32-bit: small, stable, and independent of the engine's hash implementation. */
export function stableHash(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/** The shard a Thread belongs to. Same key, same shard, for the life of the configuration. */
export const shardOf = (threadKey: string, count: number): number =>
  count <= 1 ? 0 : stableHash(threadKey) % Math.floor(count)

/** The Session ids of one shard set: the base Router keeps its id, extra shards are suffixed. */
export const shardSessionIds = (base: string, count: number): string[] =>
  Array.from({ length: Math.max(1, Math.floor(count)) }, (_, index) => index === 0 ? base : `${base}-shard-${index}`)

/**
 * The Session id a Trigger's Thread belongs to. A Trigger without a Thread (nothing to keep affinity for) lands on the
 * base Router, which is also where every Trigger lands while sharding is off.
 */
export const triggerSessionId = (input: { thread?: string }, base: string, count: number): string => {
  const ids = shardSessionIds(base, count)
  const thread = input.thread
  if (ids.length === 1 || !thread) return base
  return ids[shardOf(thread, ids.length)] ?? base
}

/** How the Triggers of one sample spread over `count` shards: used by tests and by health. */
export const shardLoads = (threadKeys: readonly string[], count: number): number[] => {
  const loads = Array.from({ length: Math.max(1, Math.floor(count)) }, () => 0)
  for (const key of threadKeys) {
    const index = shardOf(key, loads.length)
    loads[index] = (loads[index] ?? 0) + 1
  }
  return loads
}
