/**
 * The durable key/value surface the orchestrator depends on (docs/017 P4, article §5).
 *
 * The official design separates stateless compute from state kept in a database. The prototype (and this adaptation) keeps
 * both in one place, so this is only the seam that makes the separation possible later: everything the orchestrator
 * persists goes through `StateStore`, and the default implementation is the local store. No remote backend is
 * implemented, and behaviour is unchanged because the adapter delegates every call.
 */

export interface StateStore {
  /** Reads one value; undefined when the key was never written. */
  get(key: string): unknown
  /** Writes one value; `undefined` deletes, matching the store's own convention. */
  set(key: string, value: unknown): void
  /** Removes one key. */
  delete(key: string): void
  /** Every key with `prefix`, in the store's order. */
  keys(prefix: string): string[]
}

/** The subset of the local store this interface needs, so the adapter is testable without a database. */
export interface LocalStore {
  get(key: string): unknown
  set(key: string, value: unknown): void
  delete(key: string): void
  keys(prefix: string): string[]
}

/**
 * Wraps a local store as a `StateStore`, optionally under a namespace prefix.
 *
 * The prefix is how a Source instance keeps its own cursors and retry tables (§8.3) while sharing one underlying
 * store: every key it reads or writes is scoped, and `keys` strips the prefix again so callers see plain names.
 */
export function stateStoreOf(store: LocalStore, prefix = ''): StateStore {
  const scoped = (key: string): string => prefix + key
  const unscoped = (key: string): string => (prefix && key.startsWith(prefix) ? key.slice(prefix.length) : key)
  return {
    get: key => store.get(scoped(key)),
    set: (key, value) => { if (value === undefined) store.delete(scoped(key)); else store.set(scoped(key), value) },
    delete: key => store.delete(scoped(key)),
    keys: prefixOf => store.keys(scoped(prefixOf)).map(unscoped),
  }
}
