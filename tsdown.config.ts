import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { defineConfig } from 'tsdown'
// The client module id has to be the package name: a host composes client modules by package name, and
// DSH's desktop build rejects a bare id while the CLI host happened to tolerate it. Derive it here so the
// banner cannot drift from `package.json` again; `tests/client-module-id.spec.ts` asserts the built file.
const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { name: string }
// `?raw` imports a file as its text, as Vite and vitest do; tsdown refuses `.css` ids without @tsdown/css, so this loads them.
const raw = { name: 'raw',
  resolveId: (source: string, importer?: string) => source.endsWith('?raw') && importer ? resolve(dirname(importer), source) : undefined,
  load: (id: string) => id.endsWith('?raw') ? { code: `export default ${JSON.stringify(readFileSync(id.slice(0, -4), 'utf8'))}`, moduleType: 'js' as const }
    : undefined }
export default defineConfig([
  // zod and proper-lockfile (with its three) are bundled so `lib` needs nothing but the host's own packages and node
  // builtins: a plugin installed as a linked local directory gets no dependencies installed for it, and
  // `tests/release-invariants.spec.ts` fails if a built file ever imports anything outside that set.
  { entry: { index: 'src/index.ts', 'github-watch': 'src/sources/github.ts', 'feishu-watch': 'src/sources/feishu.ts', 'inbox-watch': 'src/sources/inbox.ts',
    'filewatch-watch': 'src/sources/filewatch.ts', 'instances-view': 'src/app/instances-view.ts' }, outDir: 'lib', format: 'esm', fixedExtension: false, platform: 'node', target: 'es2024', dts: true, clean: true,
    deps: { neverBundle: [/^@deepseek-ai\//], alwaysBundle: ['zod', 'proper-lockfile', 'graceful-fs', 'retry', 'signal-exit'] } },
  { entry: { client: 'src/client/index.tsx' }, outDir: 'lib', format: 'cjs', platform: 'browser', dts: false, clean: false, plugins: [raw],
    deps: { neverBundle: ['react', 'react/jsx-runtime', 'react-dom'] },
    outputOptions: { entryFileNames: 'client.js', banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, factory: (require) => {`, footer: 'return module.exports; } });', intro: 'var module = { exports: {} }; var exports = module.exports;' } },
])
