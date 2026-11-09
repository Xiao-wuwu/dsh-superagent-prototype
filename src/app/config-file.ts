/**
 * Declarative settings: a reviewable JSON or YAML document that a team keeps under version control and that the
 * runtime applies at startup, so Sources, Policy, Execution and Prompts are diffable instead of living only in a
 * panel. Omitted blocks keep whatever the panel already stored, which makes a partial file a safe overlay.
 *
 * The extension picks the reader: `.yaml` and `.yml` go through the small YAML subset in `./config-yaml.ts`, and
 * everything else is JSON. Both readers produce a plain object and then take the same merge and validation path, so
 * `$prune` and every Settings rule behave identically in either format.
 */
import { existsSync, readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { SettingsSchema } from '../policy.ts'
import { parseYaml, YamlError } from './config-yaml.ts'

type Settings = ReturnType<typeof SettingsSchema.parse>
export type DeclarativeLoad = { settings: Settings } | { error: string }
export type DeclarativeFormat = 'json' | 'yaml'
type Lines = (path: string) => number | undefined

const EXTENSIONS = ['.yaml', '.yml', '.json'] as const

const describe = (error: unknown): string => error instanceof Error ? error.message : String(error)
const withoutExtension = (path: string): string => {
  const extension = extname(path)
  return extension ? path.slice(0, -extension.length) : path
}

const issues = (error: { issues: readonly { path: PropertyKey[]; message: string }[] }, lineAt?: Lines): string =>
  error.issues.map(issue => {
    const path = issue.path.map(String).join('.') || '(root)'
    const line = lineAt?.(path)
    return path + (line === undefined ? '' : ' (line ' + line + ')') + ': ' + issue.message
  }).join('; ')

/** The reader a path names; only `.yaml` and `.yml` are YAML, everything else is JSON. */
export function declarativeFormat(path: string): DeclarativeFormat {
  const extension = extname(path).toLowerCase()
  return extension === '.yaml' || extension === '.yml' ? 'yaml' : 'json'
}

/**
 * Paths a save may produce next to the configured file: the file itself, and the same stem with any extension the
 * loader accepts. The directory watcher reloads on any of them, so a `.json` file swapped for a `.yaml` one still
 * applies without a restart.
 */
export function declarativeFileNames(path: string): string[] {
  const stem = withoutExtension(path)
  return [...new Set([path, ...EXTENSIONS.map(extension => stem + extension)])]
}

/**
 * The file to read: the configured path when it exists, otherwise the same stem with an accepted extension. The
 * explicit path wins when several exist, so nothing silently switches formats behind the operator's back.
 */
export function resolveDeclarativePath(path: string): string {
  if (existsSync(path)) return path
  const stem = withoutExtension(path)
  for (const extension of EXTENSIONS) {
    const candidate = stem + extension
    if (candidate !== path && existsSync(candidate)) return candidate
  }
  return path
}

/**
 * Merge the declared blocks over the current settings. `sources` and `policy` merge key by key, so a file that
 * only declares the GitHub Source leaves an installed Feishu Source alone, and a Policy file that only names the
 * GitHub allow list keeps the Feishu part.
 */
export function mergeDeclarative(current: Settings, declared: unknown, lineAt?: Lines): Settings {
  // Directives start with `$` and are read before validation, because the settings schema is strict and knows
  // nothing about them. `$prune` names what must disappear: a file that only adds and overrides cannot undo a
  // Source an earlier file declared, which would leave a stale instance in the stored settings forever.
  const raw = (declared ?? {}) as Record<string, unknown>
  const prune = (raw.$prune ?? {}) as { sources?: string[] }
  const declaredBlocks = Object.fromEntries(Object.entries(raw).filter(([name]) => !name.startsWith('$')))
  const parsed = SettingsSchema.partial().safeParse(declaredBlocks)
  if (!parsed.success) throw new Error(issues(parsed.error, lineAt))
  const data = parsed.data as Record<string, unknown>
  const merged = { ...current, ...data } as Settings
  const sources = { ...current.sources } as Record<string, unknown>
  for (const id of prune.sources ?? []) delete sources[id]
  merged.sources = { ...sources, ...(data.sources as object ?? {}) } as Settings['sources']
  if (data.policy) merged.policy = { ...current.policy, ...(data.policy as object) } as Settings['policy']
  // Parse again so cross-block invariants (a Source kind whose config a Policy part names) are checked once merged.
  try {
    return SettingsSchema.parse(merged)
  } catch (error) {
    throw new Error(issues(error as { issues: readonly { path: PropertyKey[]; message: string }[] }, lineAt))
  }
}

/** A YAML refusal carries its position; any other failure is already descriptive. */
const describeYaml = (error: unknown): string =>
  error instanceof YamlError ? 'line ' + error.line + ', column ' + error.column + ': ' + error.message : describe(error)

/** Read and merge one declarative settings file; every failure is reported as text for the operator, never thrown. */
export function loadDeclarative(path: string, current: Settings): DeclarativeLoad {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    return { error: 'The declarative settings file could not be read (' + path + '): ' + describe(error) }
  }
  let declared: unknown
  let lineAt: Lines | undefined
  if (declarativeFormat(path) === 'yaml') {
    try {
      const parsed = parseYaml(text)
      declared = parsed.value
      lineAt = parsed.lineAt
    } catch (error) {
      return { error: 'The declarative settings file is not valid YAML (' + path + '): ' + describeYaml(error) }
    }
  } else {
    try {
      declared = JSON.parse(text)
    } catch (error) {
      return { error: 'The declarative settings file is not valid JSON (' + path + '): ' + describe(error) }
    }
  }
  try {
    return { settings: mergeDeclarative(current, declared, lineAt) }
  } catch (error) {
    return { error: 'The declarative settings file is invalid (' + path + '): ' + describe(error) }
  }
}
