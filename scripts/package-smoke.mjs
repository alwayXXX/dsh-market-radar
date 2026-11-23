import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, mkdtemp, realpath, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import vm from 'node:vm'
import { webcrypto } from 'node:crypto'
const root = process.cwd()
const manager = process.env.npm_execpath
assert.ok(manager, 'Run with pnpm smoke:package')
await mkdir(join(root, '.fixture'), { recursive: true })
const work = await mkdtemp(join(root, '.fixture', 'install-'))
function run(args, cwd = root) {
  const p = spawnSync(process.execPath, [manager, ...args], { cwd, encoding: 'utf8' })
  if (p.status !== 0) throw new Error(`${args.join(' ')}\n${p.stdout}\n${p.stderr}`)
  return p.stdout
}
// A separate destination permits testing an unreleased build without overwriting a released archive.
const packDir = process.env.RADAR_PACK_DIR ? resolve(root, process.env.RADAR_PACK_DIR) : join(root, 'dist')
await mkdir(packDir, { recursive: true })
run(['pack', '--pack-destination', packDir])
const projectManifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const tarball = join(packDir, `${projectManifest.name}-${projectManifest.version}.tgz`)
await writeFile(join(work, 'package.json'), JSON.stringify({ name: 'market-radar-package-check', version: '0.0.0', private: true }))
// Prevent the throwaway install from becoming an importer in the project lockfile.
await writeFile(join(work, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
run(['--store-dir', join(root, '.cache/pnpm-store'), '--cache-dir', join(root, '.cache/pnpm-cache'), 'add', '--ignore-scripts', tarball], work)
const req = createRequire(join(work, 'package.json'))
const manifestFile = req.resolve('dsh-market-radar/package.json')
assert.notEqual(await realpath(dirname(manifestFile)), await realpath(root))
const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
assert.equal(manifest.dsh.client.platform, 'web')
assert.deepEqual((await readdir(dirname(manifestFile))).sort(), ['LICENSE', 'README.md', 'assets', 'cordis.patch.yml', 'lib', 'package.json'])
assert.deepEqual((await readdir(join(dirname(manifestFile), 'assets'))).sort(), ['icon.svg'])
assert.deepEqual((await readdir(join(dirname(manifestFile), 'lib'))).sort(), ['client.js', 'index.js'])
const host = await import(pathToFileURL(req.resolve('dsh-market-radar')).href)
assert.equal(typeof host.apply, 'function')
const rootRequire = createRequire(join(root, 'package.json'))
const { Context } = await import(pathToFileURL(rootRequire.resolve('@deepseek-ai/cordis')).href)
const context = new Context()
host.apply(context, { dataDir: join(work, 'data') })
await context.fiber.dispose()
const serviceContext = new Context()
const service = new host.MarketRadarService(serviceContext, { async series(instrumentId, range) { return { instrumentId, range } }, async candidates(symbol) { return [symbol] }, async acknowledgeAlerts(ids) { return ids }, async marketEvents() { return { events: [], unavailable: ['bls'] } }, async economicIndicators() { return { indicators: [], unavailable: ['cpi'] } }, async economicIndicatorPreview(id, fetchedAt) { return { id, fetchedAt } } })
assert.deepEqual(await service.series('gold:XAU', 'max'), { instrumentId: 'gold:XAU', range: 'max' })
assert.deepEqual(await service.candidates('000001'), ['000001'])
assert.deepEqual(await service.acknowledgeAlerts(['event-1']), ['event-1'])
assert.deepEqual(await service.marketEvents(), { events: [], unavailable: ['bls'] })
assert.deepEqual(await service.economicIndicators(), { indicators: [], unavailable: ['cpi'] })
assert.deepEqual(await service.economicIndicatorPreview('payroll', '2026-11-23T00:00:00Z'), { id: 'payroll', fetchedAt: '2026-11-23T00:00:00Z' })
await serviceContext.fiber.dispose()
let client
const styles = new Set(), slots = new Set(), slotComponents = new Map(), listeners = new Set(), commands = new Map(), effects = []
const xau = { id: 'gold:XAU', market: 'gold', symbol: 'XAU', name: '国际现货金', currency: 'USD', unit: '盎司' }
let remoteSnapshot = { config: { version: 1, revision: 0, hidden: false, instruments: [xau], alerts: [], pinned: [xau.id], colorMode: 'red-up' }, quotes: { [xau.id]: { instrument: xau, price: 100, previousClose: 99, change: 1, changePercent: 1, source: '测试来源', asOf: '2026-11-16T04:42:00Z', receivedAt: '2026-11-16T04:42:30Z', status: 'live' } }, alerts: [{ id: 'event-1', ruleId: 'r', instrumentId: xau.id, text: '测试提醒', at: '2026-11-16T04:42:30Z' }], updatedAt: '' }
const document = { head: { append(style) { styles.add(style) } }, createElement() { return { dataset: {}, remove() { styles.delete(this) } } }, addEventListener(name) { listeners.add(name) }, removeEventListener(name) { listeners.delete(name) } }
const clientBundle = await readFile(join(dirname(manifestFile), 'lib/client.js'), 'utf8')
assert.doesNotMatch(clientBundle, /Ctrl\s*\+\s*Alt\s*\+\s*M/i, 'client must not display the removed shortcut')
assert.doesNotMatch(clientBundle, /Command\s*\+\s*Option\s*\+\s*M/i, 'client must not display the removed macOS shortcut')
vm.runInNewContext(clientBundle, {
  window: { __ModuleLoader__: { load({ id, factory }) { assert.equal(id, 'dsh-market-radar'); client = factory(name => { assert.ok(['react', 'react/jsx-runtime'].includes(name)); return rootRequire(name) }) } } },
  document, crypto: webcrypto, AbortController, setTimeout, clearTimeout, structuredClone,
})
let observedSeriesCall
const adapter = client.createRpcApi({ connection: { rpc: { async call(channel, endpoint, payload) { observedSeriesCall = { channel, endpoint, payload }; return { ok: true, value: { range: payload.args.range } } } } } }, new AbortController().signal)
assert.equal((await adapter.series('gold:XAU', 'ytd')).range, 'ytd')
assert.equal(observedSeriesCall.endpoint, 'marketRadar/series')
assert.equal(observedSeriesCall.payload.args.instrumentId, 'gold:XAU')
assert.equal(observedSeriesCall.payload.args.range, 'ytd')
await adapter.candidates('000001')
assert.equal(observedSeriesCall.endpoint, 'marketRadar/candidates')
assert.equal(observedSeriesCall.payload.args.symbol, '000001')
await adapter.acknowledgeAlerts(['event-1'])
assert.equal(observedSeriesCall.endpoint, 'marketRadar/acknowledgeAlerts')
assert.equal(observedSeriesCall.payload.args.ids[0], 'event-1')
await adapter.marketEvents()
assert.equal(observedSeriesCall.endpoint, 'marketRadar/marketEvents')
assert.equal(Object.keys(observedSeriesCall.payload.args).length, 0)
await adapter.economicIndicators()
assert.equal(observedSeriesCall.endpoint, 'marketRadar/economicIndicators')
assert.equal(Object.keys(observedSeriesCall.payload.args).length, 0)
await adapter.economicIndicatorPreview('payroll', '2026-11-23T00:00:00Z')
assert.equal(observedSeriesCall.endpoint, 'marketRadar/economicIndicatorPreview')
assert.equal(observedSeriesCall.payload.args.id, 'payroll')
assert.equal(observedSeriesCall.payload.args.fetchedAt, '2026-11-23T00:00:00Z')
client.apply({ effect(fn) { effects.push(fn()) }, shortcuts: { register(command) { commands.set(command.id, command); return () => commands.delete(command.id) } }, slots: { inject(name, fn) { effects.push(fn()) }, register(spec, component) { slots.add(spec.name); slotComponents.set(spec.name, component); return () => slots.delete(spec.name) } }, connection: { rpc: { async call(channel, endpoint, payload) {
  if (endpoint.endsWith('/save')) remoteSnapshot = { ...remoteSnapshot, config: { ...structuredClone(payload.args.config), revision: remoteSnapshot.config.revision + 1 } }
  return { ok: true, value: endpoint.endsWith('/snapshot') || endpoint.endsWith('/save') ? structuredClone(remoteSnapshot) : null }
} } } })
assert.equal(styles.size, 1); assert.equal(slots.size, 3); assert.equal(commands.size, 1)
assert.equal(commands.get('market-radar.toggle-visibility').defaults['desktop:windows'].code, 'F9')
assert.deepEqual(Array.from(commands.get('market-radar.toggle-visibility').defaults['desktop:windows'].modifiers), ['primary', 'shift'])
await new Promise(resolve => setImmediate(resolve))
const { createElement } = rootRequire('react')
const { renderToStaticMarkup } = rootRequire('react-dom/server')
const tickerMarkup = renderToStaticMarkup(createElement(slotComponents.get('shell.bottom')))
assert.match(tickerMarkup, /测试来源/)
assert.match(tickerMarkup, /2026\/11\/16 12:42:00/)
assert.match(tickerMarkup, /1 条未读提醒/)
commands.get('market-radar.toggle-visibility').resolve().run()
await new Promise(resolve => setImmediate(resolve))
assert.equal(remoteSnapshot.config.hidden, true, 'native command action hides through the actual client RPC adapter')
commands.get('market-radar.toggle-visibility').resolve().run()
await new Promise(resolve => setImmediate(resolve))
assert.equal(remoteSnapshot.config.hidden, false, 'native command action restores through the actual client RPC adapter')
for (const dispose of effects.reverse()) if (typeof dispose === 'function') dispose()
await new Promise(resolve => setImmediate(resolve))
assert.equal(styles.size, 0); assert.equal(slots.size, 0); assert.equal(listeners.size, 0); assert.equal(commands.size, 0)
console.log('PASS: independent tarball install; Host cleanup; three slots, native command hide/restore RPC and client cleanup.')
console.log(tarball)
