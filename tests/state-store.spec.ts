// The state-store seam (docs/017 P4): the interface a future remote store would implement, and its local adapter.
import { expect, it } from 'vitest'
import { stateStoreOf, type LocalStore } from '../src/app/state-store.ts'

const memory = (): LocalStore & { data: Map<string, unknown> } => {
  const data = new Map<string, unknown>()
  return {
    data,
    get: key => data.get(key),
    set: (key, value) => { data.set(key, value) },
    delete: key => { data.delete(key) },
    keys: prefix => [...data.keys()].filter(key => key.startsWith(prefix)),
  }
}

it('delegates reads and writes to the local store unchanged', () => {
  const store = memory()
  const state = stateStoreOf(store)
  state.set('github.since', '2026-11-01')
  expect(state.get('github.since')).toBe('2026-11-01')
  expect(store.data.get('github.since')).toBe('2026-11-01')
  // Writing undefined deletes, matching the store's convention.
  state.set('github.since', undefined)
  expect(state.get('github.since')).toBeUndefined()
  expect(store.data.has('github.since')).toBe(false)
})

it('namespaces every key under a prefix and strips it again for callers', () => {
  const store = memory()
  const one = stateStoreOf(store, 'team-a:')
  const two = stateStoreOf(store, 'team-b:')
  one.set('since', 'a')
  two.set('since', 'b')
  expect(store.data.get('team-a:since')).toBe('a')
  expect(store.data.get('team-b:since')).toBe('b')
  // Each instance sees only its own keys, with the prefix removed.
  expect(one.keys('')).toEqual(['since'])
  expect(two.keys('')).toEqual(['since'])
  expect(one.get('since')).toBe('a')
  one.delete('since')
  expect(one.get('since')).toBeUndefined()
  expect(two.get('since')).toBe('b')
})

it('filters keys by prefix after scoping, so a caller passes plain names', () => {
  const store = memory()
  const state = stateStoreOf(store, 'x:')
  state.set('github:1:cursor', 'c1')
  state.set('github:2:cursor', 'c2')
  state.set('feishu:cursor', 'f')
  expect(state.keys('github:')).toEqual(['github:1:cursor', 'github:2:cursor'])
  expect(state.keys('feishu:')).toEqual(['feishu:cursor'])
})
