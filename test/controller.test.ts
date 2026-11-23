import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RadarController } from '../src/controller.ts'
import { defaultConfig } from '../src/config.ts'
import type { RadarApi, RadarSnapshot } from '../src/types.ts'
function apiFixture() {
  let snapshot: RadarSnapshot = { config: defaultConfig(), quotes: {}, alerts: [], updatedAt: '' }
  const api: RadarApi = {
    snapshot: async () => structuredClone(snapshot),
    save: async config => { snapshot = { ...snapshot, config: { ...structuredClone(config), revision: snapshot.config.revision + 1 } }; return structuredClone(snapshot) },
    resolve: async () => { throw new Error('unused') }, candidates: async () => [], acknowledgeAlerts: async () => structuredClone(snapshot), series: async () => { throw new Error('unused') },
    marketEvents: async () => ({ events: [], unavailable: [] }), marketEventPreview: async () => ({ summary: '', outlook: '' }), economicIndicators: async () => ({ indicators: [], unavailable: [] }), economicIndicatorPreview: async () => ({ summary: '', outlook: '' }), refresh: async () => structuredClone(snapshot), visibility: async () => {},
  }
  return { api, read: () => structuredClone(snapshot) }
}
test('rapid hide/restore retains the latest intent while older saves finish', async t => {
  const { api, read } = apiFixture()
  const originalSave = api.save
  let release: () => void = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  let calls = 0
  api.save = async config => { if (++calls === 1) await gate; return originalSave(config) }
  const controller = new RadarController(api)
  t.after(() => controller.dispose())
  await controller.poll()
  const hide = controller.toggleHidden()
  assert.equal(controller.hidden, true)
  await new Promise(resolve => setImmediate(resolve))
  const restore = controller.toggleHidden()
  assert.equal(controller.hidden, false)
  const unexpected: boolean[] = []
  const off = controller.subscribe(() => { unexpected.push(controller.hidden) })
  release(); await Promise.all([hide, restore]); off()
  assert.equal(read().config.hidden, false)
  assert.equal(controller.hidden, false)
  assert.ok(unexpected.every(value => value === false))
  assert.equal(controller.getSnapshot().busy, false)
})
test('an older poll response cannot undo a successful configuration write', async t => {
  const { api, read } = apiFixture()
  const controller = new RadarController(api)
  t.after(() => controller.dispose())
  await controller.poll()
  const previous = read()
  let release: (value: RadarSnapshot) => void = () => {}
  api.snapshot = () => new Promise(resolve => { release = resolve })
  const stalePoll = controller.poll()
  await controller.save(c => { c.colorMode = 'green-up' })
  release(previous); await stalePoll
  assert.equal(controller.getSnapshot().snapshot.config.colorMode, 'green-up')
  assert.equal(controller.getSnapshot().snapshot.config.revision, 1)
})
test('hiding remains immediate when local persistence is unavailable', async t => {
  const { api } = apiFixture()
  api.save = async () => { throw new Error('read-only storage') }
  const controller = new RadarController(api)
  t.after(() => controller.dispose())
  await controller.poll()
  controller.setOpen(true)
  await controller.toggleHidden()
  assert.equal(controller.hidden, true)
  assert.equal(controller.getSnapshot().open, false)
  assert.match(controller.getSnapshot().error, /read-only/)
})
test('an older poll cannot restore unread alerts after acknowledgement', async t => {
  const { api, read } = apiFixture()
  const event = { id: 'one', ruleId: 'r', instrumentId: 'gold:XAU', text: 'test', at: '2026-11-16T00:00:00Z' }
  const old = { ...read(), alerts: [event], alertsRevision: 1 }
  api.snapshot = async () => structuredClone(old)
  const controller = new RadarController(api)
  t.after(() => controller.dispose())
  await controller.poll()
  let release: (value: RadarSnapshot) => void = () => {}
  api.snapshot = () => new Promise(resolve => { release = resolve })
  const pending = controller.poll()
  api.acknowledgeAlerts = async () => ({ ...old, alerts: [{ ...event, read: true }], alertsRevision: 2 })
  await controller.acknowledgeAlerts(['one'])
  release(old); await pending
  assert.equal(controller.getSnapshot().snapshot.alerts[0].read, true)
})
test('a restarted host can reset the transient alert list and revision', async t => {
  const { api, read } = apiFixture()
  const old = { ...read(), alerts: [{ id: 'one', ruleId: 'r', instrumentId: 'gold:XAU', text: 'test', at: '' }], alertsRevision: 5, alertsEpoch: 'before' }
  api.snapshot = async () => structuredClone(old)
  const controller = new RadarController(api)
  t.after(() => controller.dispose())
  await controller.poll()
  api.snapshot = async () => ({ ...old, alerts: [], alertsRevision: 0, alertsEpoch: 'after' })
  await controller.poll()
  assert.deepEqual(controller.getSnapshot().snapshot.alerts, [])
})
test('a late response from the previous host does not restore old alerts', async t => {
  const { api, read } = apiFixture()
  const old = { ...read(), alerts: [{ id: 'one', ruleId: 'r', instrumentId: 'gold:XAU', text: 'test', at: '' }], alertsRevision: 5, alertsEpoch: 'before' }
  api.snapshot = async () => structuredClone(old)
  const controller = new RadarController(api)
  t.after(() => controller.dispose())
  await controller.poll()
  let release: (value: RadarSnapshot) => void = () => {}
  api.snapshot = () => new Promise(resolve => { release = resolve })
  const pending = controller.poll()
  api.acknowledgeAlerts = async () => ({ ...old, alerts: [], alertsRevision: 0, alertsEpoch: 'after' })
  await controller.acknowledgeAlerts([])
  release(old); await pending
  assert.deepEqual(controller.getSnapshot().snapshot.alerts, [])
})
