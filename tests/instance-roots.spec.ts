// Per-instance workspace and Session roots (docs/015 §5): the default instance keeps DSH's shared roots byte for byte.
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { expect, it } from 'vitest'
import { DATA_HOME_ENV, dataHomeProblem, defaultStateDir, dshHome, instanceRoots } from '../src/app/instance-roots.ts'

const home = resolve('C:/dsh-home')

it('keeps the default instance on DSH\'s shared roots, exactly as before this change', () => {
  const roots = instanceRoots(defaultStateDir(home), home)
  // `dshHomePath('storages')` and `dshHomePath('sessions')` are these two strings: the same home, joined and resolved.
  expect(roots.storages).toBe(join(resolve(home), 'storages'))
  expect(roots.sessions).toBe(join(resolve(home), 'sessions'))
  expect(roots).toEqual({ storages: join(home, 'storages'), sessions: join(home, 'sessions'), scoped: false })
})

it('moves both roots under a state directory that is not the profile default', () => {
  const stateDir = resolve('C:/dsh-state/team-b')
  expect(instanceRoots(stateDir, home)).toEqual({
    storages: join(stateDir, 'storages'),
    sessions: join(stateDir, 'sessions'),
    scoped: true,
  })
})

it('treats the profile default as the same directory whatever the separator or trailing slash', () => {
  expect(instanceRoots(`${defaultStateDir(home)}${sep}`, home).scoped).toBe(false)
})

it('warns only when a non-default instance would still read the shared roots', () => {
  const stateDir = resolve('C:/dsh-state/team-b')
  expect(dataHomeProblem(defaultStateDir(home), { DSH_HOME: home })).toBeUndefined()
  expect(dataHomeProblem(stateDir, { DSH_HOME: home })).toContain(`${DATA_HOME_ENV} is not set`)
  expect(dataHomeProblem(stateDir, { DSH_HOME: home, [DATA_HOME_ENV]: '   ' })).toContain(`${DATA_HOME_ENV} is not set`)
  expect(dataHomeProblem(stateDir, { DSH_HOME: home, [DATA_HOME_ENV]: stateDir })).toBeUndefined()
  expect(dataHomeProblem(stateDir, { DSH_HOME: home, [DATA_HOME_ENV]: resolve('C:/dsh-state/team-c') }))
    .toContain(`set to ${resolve('C:/dsh-state/team-c')}`)
})

it('resolves the harness home with the same precedence and blank-override rule as dshHomePath', () => {
  expect(dshHome({ DSH_HOME: 'C:/custom-home' })).toBe(resolve('C:/custom-home'))
  expect(dshHome({ DSH_HOME: '' })).toBe(resolve(join(homedir(), '.dsh')))
  expect(dshHome({ DSH_HOME: '   ' })).toBe(resolve(join(homedir(), '.dsh')))
  expect(dshHome({})).toBe(resolve(join(homedir(), '.dsh')))
})
