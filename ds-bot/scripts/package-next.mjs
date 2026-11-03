// Build the separately identified Next plugin without changing the upstream source identity.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const plugin = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const destination = resolve(process.argv[2] ?? join(plugin, '..', 'artifacts-local'))
const staging = mkdtempSync(join(tmpdir(), 'ds-bot-next-package-'))
const npmScript = process.env.npm_execpath ?? (process.platform === 'win32' ? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js') : undefined)

function run(command, args) {
  const result = spawnSync(command, args, { cwd: staging, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed with status ${result.status}`)
}

try {
  for (const name of ['package.json', 'README.md', 'LICENSE', 'NOTICE', 'index.js', 'cordis.patch.yml', 'web-search.js', 'office.js', 'src', 'scripts', 'node_modules']) {
    const source = join(plugin, name)
    if (!existsSync(source)) throw new Error(`Missing ${name}; install build dependencies first`)
    cpSync(source, join(staging, name), { recursive: true, dereference: true })
  }
  const packageFile = join(staging, 'package.json')
  const pkg = JSON.parse(readFileSync(packageFile, 'utf8'))
  pkg.name = 'ds-bot-next'
  pkg.description = 'DS Bot Next: an independently maintained DS Bot fork for DeepSeek Harness'
  writeFileSync(packageFile, `${JSON.stringify(pkg, null, 2)}\n`)

  const patchFile = join(staging, 'cordis.patch.yml')
  const patch = readFileSync(patchFile, 'utf8').replaceAll('name: ds-bot/web-search', 'name: ds-bot-next/web-search').replaceAll('name: ds-bot\n', 'name: ds-bot-next\n')
  if (!patch.includes('name: ds-bot-next') || !patch.includes('name: ds-bot-next/web-search')) throw new Error('Could not assign Next bundle identity')
  writeFileSync(patchFile, patch)

  const builderFile = join(staging, 'scripts/build-client.mjs')
  const builder = readFileSync(builderFile, 'utf8')
  const factory = "id: \\'ds-bot\\'"
  if (builder.split(factory).length !== 2) throw new Error('Could not identify the client factory declaration')
  writeFileSync(builderFile, builder.replace(factory, "id: \\'ds-bot-next\\'"))
  const stylesFile = join(staging, 'src/client/styles.js')
  const styles = readFileSync(stylesFile, 'utf8')
  if (!styles.includes("const PLUGIN_ID = 'ds-bot'")) throw new Error('Could not identify the client style identity')
  writeFileSync(stylesFile, styles.replace("const PLUGIN_ID = 'ds-bot'", "const PLUGIN_ID = 'ds-bot-next'"))
  run(process.execPath, ['scripts/build-client.mjs'])
  const client = readFileSync(join(staging, 'client.js'), 'utf8')
  if (!client.includes("id: 'ds-bot-next'") || client.includes("id: 'ds-bot'")) throw new Error('Client factory identity is not isolated')
  mkdirSync(destination, { recursive: true })
  const pack = ['pack', '--ignore-scripts', '--pack-destination', destination]
  if (npmScript) run(process.execPath, [npmScript, ...pack])
  else run('npm', pack)
} finally {
  rmSync(staging, { recursive: true, force: true })
}
