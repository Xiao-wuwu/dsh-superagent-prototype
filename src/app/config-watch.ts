/**
 * Watch the declarative settings file so a saved edit is applied without restarting the service.
 *
 * The watcher listens on the **parent directory**, not on the file: editors write a temporary file and rename it
 * over the target, which invalidates a handle on the old inode and would leave a file watcher silently dead. A
 * directory watcher keeps firing across that rename, and the basename filter keeps unrelated neighbours out.
 */
import { watch, type FSWatcher } from 'node:fs'
import { basename, dirname } from 'node:path'

export type DeclarativeWatcher = { close(): void }

/** Repeated events (one save can emit several) collapse into one callback after the quiet period. */
const DEFAULT_DEBOUNCE_MS = 250

/**
 * `onChange` runs once per settled change of any of `path`'s names — the configured file and the extensions the
 * loader accepts for the same stem, so saving a `.yaml` next to a `.json` configuration still reloads. A directory
 * that cannot be watched (missing, no permission) yields a watcher that does nothing and closes cleanly: the
 * declarative file is fail-open by design, and a watcher failure must never be louder than the setting it was
 * meant to reload.
 */
export function watchDeclarative(
  path: string | string[],
  onChange: () => void,
  options: { debounceMs?: number } = {},
): DeclarativeWatcher {
  const paths = Array.isArray(path) ? path : [path]
  const directory = dirname(paths[0]!)
  const names = new Set(paths.map(name => basename(name)))
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS
  let timer: NodeJS.Timeout | undefined
  let watcher: FSWatcher | undefined
  let closed = false

  const close = (): void => {
    if (closed) return
    closed = true
    if (timer) { clearTimeout(timer); timer = undefined }
    watcher?.close()
    watcher = undefined
  }

  try {
    watcher = watch(directory, { persistent: false }, (_event, changed) => {
      if (closed) return
      if (changed && !names.has(String(changed))) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        if (!closed) onChange()
      }, debounceMs)
    })
  } catch {
    // Unwatchable directory: keep the service running on the settings it already has.
    return { close }
  }
  watcher.on('error', () => { close() })

  return { close }
}
