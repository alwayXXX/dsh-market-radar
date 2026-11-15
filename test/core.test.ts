import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defaultConfig, instrumentFor, validateConfig } from '../src/config.ts'
import { sourceTime, quoteStatus, scheduledClosed } from '../src/market-time.ts'
import { parseTencent, parseSina, parseGoldSeries, parseTencentSeries, sanitizePoints } from '../src/providers.ts'
import { AlertEngine } from '../src/alerts.ts'
import { RadarEngine } from '../src/engine.ts'
import { snapshotText } from '../src/snapshot.ts'
import type { AlertRule, Instrument, Quote, RadarConfig } from '../src/types.ts'
import type { ConfigStore } from '../src/storage.ts'

const cn = instrumentFor('cn', 'sh600519')
const us = instrumentFor('us', 'AAPL')
const gold = instrumentFor('gold', 'XAU')
const now = Date.parse('2026-11-16T02:00:00Z')
function quote(price: number, at = now, instrument = cn): Quote {
  return { instrument, price, previousClose: 100, change: price - 100, changePercent: price - 100, source: 'test', asOf: new Date(at).toISOString(), receivedAt: new Date(at).toISOString(), status: 'live' }
}
function tencentRow(code: string, name: string, price: string, stamp: string) {
  const f = Array(40).fill(''); f[0] = '1'; f[1] = name; f[3] = price; f[4] = '100'; f[30] = stamp; f[32] = '3'
  return `v_${code}="${f.join('~')}";`
}
test('validates round-trip configuration and explicit market identities', () => {
  const c = defaultConfig(); assert.deepEqual(validateConfig(JSON.parse(JSON.stringify(c))), c)
  assert.throws(() => instrumentFor('cn', '000001'), /前缀/)
  assert.throws(() => instrumentFor('us', 'AAPL,http://bad'), /有效/)
  assert.throws(() => instrumentFor('gold', 'AUUSD'), /XAU/)
  assert.throws(() => validateConfig({ ...c, instruments: [c.instruments[0], c.instruments[0]] }), /重复/)
  assert.throws(() => validateConfig({ ...c, pinned: ['cn:missing'] }), /已有/)
  assert.throws(() => validateConfig({ ...c, alerts: [{ id: 'bad', instrumentId: c.instruments[0].id, kind: 'above', value: -1, enabled: true, cooldownMinutes: 15 }] }), /提醒规则/)
  assert.throws(() => validateConfig({ ...c, version: 2 }), /版本/)
})
test('parses multiple adjacent Tencent rows, rejecting malformed or zero prices', () => {
  const body = tencentRow('sh600519', '贵州茅台', '103', '20261116100000') + tencentRow('usAAPL', '苹果', '105', '2026-11-16 10:00:00')
  const rows = parseTencent(body, [cn, us], now)
  assert.equal(rows.length, 2); assert.equal(rows[0].price, 103); assert.equal(rows[0].changePercent, 3)
  assert.equal(rows[1].asOf, '2026-11-16T15:00:00.000Z')
  assert.equal(parseTencent(tencentRow('sh600519', '坏价格', '0', 'bad'), [cn], now).length, 0)
  assert.equal(parseTencent('v_sh600519="1~truncated";', [cn], now).length, 0)
})
test('gold keeps source units and uses previous close rather than opening price', () => {
  const rows = parseSina('var hq_str_hf_XAU="101,0,101,102,105,99,10:00:00,98,100,0,0,0,2026-11-16,伦敦金";var hq_str_gds_AU9999="501,0,500,501,505,499,10:00:00,490,500,0,0,0,2026-11-16,沪金99";', [gold, instrumentFor('gold', 'AU9999')], now)
  assert.equal(rows.length, 2); assert.equal(rows[0].previousClose, 100); assert.equal(rows[0].changePercent, 1)
  assert.equal(rows[0].instrument.unit, '盎司'); assert.equal(rows[1].instrument.unit, '克')
  assert.equal(rows[1].previousClose, 500)
})
test('indices use points and provider-identified ETFs retain fund units', () => {
  assert.equal(instrumentFor('cn', 'sh000300').unit, '点')
  assert.equal(instrumentFor('cn', 'sz399001').unit, '点')
  assert.equal(instrumentFor('cn', 'sz000001').unit, '股')
  assert.equal(instrumentFor('us', '.INX').unit, '点')
  const body = tencentRow('usVOO', 'ETF', '103', '2026-11-16 10:00:00').replace(/~";/, '~GP-ETF";')
  const [q] = parseTencent(body, [instrumentFor('us', 'VOO')], now)
  assert.equal(q.instrument.unit, '份')
  const config = defaultConfig()
  assert.equal(validateConfig(config).instruments.find(i => i.symbol === 'VOO')?.unit, '份')
})
test('source times follow New York daylight saving time and validate dates', () => {
  assert.equal(sourceTime('20260701100000', 'America/New_York'), '2026-07-01T14:00:00.000Z')
  assert.equal(sourceTime('20261116100000', 'America/New_York'), '2026-11-16T15:00:00.000Z')
  assert.equal(sourceTime('20260230100000', 'Asia/Shanghai'), null)
  assert.equal(sourceTime('20261116250000', 'Asia/Shanghai'), null)
  assert.equal(quoteStatus(cn, new Date(now - 180_000).toISOString(), now), 'delayed')
  assert.equal(quoteStatus(cn, null, now), 'unknown')
  assert.equal(quoteStatus(cn, new Date(now + 300_000).toISOString(), now), 'unknown')
})
test('recurring trading hours handle A-share lunch, US DST, and gold cross-midnight', () => {
  assert.equal(scheduledClosed(cn, Date.parse('2026-11-16T04:00:00Z')), true)
  assert.equal(scheduledClosed(us, Date.parse('2026-07-01T13:45:00Z')), false)
  assert.equal(scheduledClosed(us, Date.parse('2026-11-16T13:45:00Z')), true)
  const au = instrumentFor('gold', 'AU9999')
  assert.equal(scheduledClosed(au, Date.parse('2026-11-13T17:00:00Z')), false)
  assert.equal(scheduledClosed(au, Date.parse('2026-11-15T17:00:00Z')), true)
})
test('minute parsers handle JSONP as data, deduplicate and preserve missing intervals', () => {
  const body = '/*<script>ignored</script>*/var _data=({"minLine_1d":[["10:00","101","0","0","0","2026-11-16 10:00:00"],["10:09","102","0","0","0","2026-11-16 10:09:00"]]});'
  const points = parseGoldSeries(body)
  assert.equal(points.length, 2); assert.equal(points[1].breakBefore, true)
  assert.equal(parseGoldSeries('globalThis.compromised=true;').length, 0)
  const minute = parseTencentSeries({ code: 0, data: { sh600519: { data: { date: '20261116', data: ['1000 101 0', '1001 102 0', 'bad'] } } } }, cn)
  assert.equal(minute.length, 2)
  assert.equal(sanitizePoints([...minute, minute[0], { time: NaN, price: 2 }]).length, 2)
})
const rule: AlertRule = { id: 'r1', instrumentId: cn.id, kind: 'above', value: 110, enabled: true, cooldownMinutes: 15 }
test('alerts require a fresh crossing, respect cooldown and do not repeat a satisfied condition', () => {
  const e = new AlertEngine()
  const run = (price: number, t: number, hidden = false) => e.evaluate([rule], { [cn.id]: quote(price, t) }, t, hidden)
  assert.equal(run(120, now).length, 0)
  assert.equal(run(121, now + 15_000).length, 0)
  assert.equal(run(100, now + 30_000).length, 0)
  assert.equal(run(115, now + 45_000).length, 1)
  assert.equal(run(100, now + 60_000).length, 0)
  assert.equal(run(115, now + 75_000).length, 0)
  assert.equal(run(120, now + 16 * 60_000).length, 0)
})
test('hidden crossings stay muted after restore, stale and reconnect quotes only establish baseline', () => {
  const e = new AlertEngine()
  e.evaluate([rule], { [cn.id]: quote(100) }, now, false)
  assert.equal(e.evaluate([rule], { [cn.id]: quote(115, now + 15_000) }, now + 15_000, true).length, 0)
  assert.equal(e.evaluate([rule], { [cn.id]: quote(116, now + 30_000) }, now + 30_000, false).length, 0)
  assert.equal(e.evaluate([rule], { [cn.id]: { ...quote(100, now + 45_000), status: 'error' } }, now + 45_000, false).length, 0)
  assert.equal(e.evaluate([rule], { [cn.id]: quote(120, now + 60_000) }, now + 60_000, false).length, 0)
  e.reset()
  assert.equal(e.evaluate([rule], { [cn.id]: quote(130, now + 90_000) }, now + 90_000, false).length, 0)
})
test('snapshot carries source and timestamp and does not turn unavailable changes into zero', () => {
  const text = snapshotText([{ ...quote(101), changePercent: null, status: 'delayed' }])
  assert.match(text, /来源：test/); assert.match(text, /源站时间/); assert.match(text, /涨跌幅：未知/); assert.match(text, /报价已延迟/)
})
function memoryStore(initial = defaultConfig()): ConfigStore {
  let config = structuredClone(initial)
  return { load: async () => ({ config: structuredClone(config) }), save: async next => { config = structuredClone(next) } }
}
test('engine isolates failed markets, preserves last quote and rejects stale writes', async () => {
  let fail = false
  const e = new RadarEngine(memoryStore(), {
    quotes: async list => { if (fail && list[0]?.market === 'gold') throw new Error('gold offline'); return list.map(i => quote(101, now, i)) },
    series: async () => [],
  }, () => now)
  await e.refresh(true)
  fail = true
  const state = await e.refresh(true)
  assert.equal(state.quotes['gold:XAU'].price, 101); assert.equal(state.quotes['gold:XAU'].status, 'error')
  assert.notEqual(state.quotes['cn:sh000001'].status, 'error')
  const next = structuredClone(state.config); next.colorMode = 'green-up'
  await e.save(next)
  await assert.rejects(e.save(next), /其他窗口/)
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(state)))
  e.dispose()
})
test('deleting a symbol while a request is in flight does not resurrect it', async () => {
  let release: () => void = () => {}
  const waiting = new Promise<void>(resolve => { release = resolve })
  const e = new RadarEngine(memoryStore(), { quotes: async list => { await waiting; return list.map(i => quote(101, now, i)) }, series: async () => [] }, () => now)
  const flight = e.refresh(true)
  const config = (await e.snapshot()).config
  config.instruments = []; config.pinned = []
  await e.save(config); release()
  const state = await flight
  assert.deepEqual(state.quotes, {})
  e.dispose()
})
test('concurrent clients share one quote request per market, disposal cancels and prevents rescheduling', async () => {
  let calls = 0
  let aborted = false
  let release: () => void = () => {}
  const waiting = new Promise<void>(resolve => { release = resolve })
  const e = new RadarEngine(memoryStore(), { quotes: async (list, signal) => { calls++; signal.addEventListener('abort', () => { aborted = true }, { once: true }); await waiting; return list.map(i => quote(101, now, i)) }, series: async () => [] }, () => now)
  const a = e.refresh(), b = e.refresh()
  await new Promise(r => setImmediate(r))
  assert.equal(calls, 3)
  e.dispose(); release(); await Promise.all([a, b])
  assert.equal(aborted, true)
  await e.refresh(true); assert.equal(calls, 3)
})
test('invalid rule import cannot write a dangling alert or change gold currency', () => {
  const c = defaultConfig()
  assert.throws(() => validateConfig({ ...c, alerts: [{ ...rule, instrumentId: 'missing' }] }), /提醒规则/)
  c.instruments[0].currency = 'CNY'
  const result = validateConfig(c)
  assert.equal(result.instruments[0].currency, 'USD')
})
