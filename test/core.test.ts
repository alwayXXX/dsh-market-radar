import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defaultConfig, instrumentFor, validateConfig } from '../src/config.ts'
import { sourceTime, quoteStatus, scheduledClosed } from '../src/market-time.ts'
import { parseTencent, parseSina, parseGoldSeries, parseTencentSeries, sanitizePoints } from '../src/providers.ts'
import { AlertEngine } from '../src/alerts.ts'
import { RadarEngine } from '../src/engine.ts'
import { formatPrice, quoteTooltip, snapshotText } from '../src/snapshot.ts'
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
  const rows = parseSina('var hq_str_hf_XAU="101,0,101,102,105,99,10:00:00,100,98,0,0,0,2026-11-16,伦敦金";var hq_str_gds_AU9999="501,0,500,501,505,499,10:00:00,500,490,0,0,0,2026-11-16,沪金99";', [gold, instrumentFor('gold', 'AU9999')], now)
  assert.equal(rows.length, 2); assert.equal(rows[0].previousClose, 100); assert.equal(rows[0].changePercent, 1)
  assert.equal(rows[0].instrument.unit, '盎司'); assert.equal(rows[1].instrument.unit, '克')
  assert.equal(rows[1].previousClose, 500)
  const [missing] = parseSina('var hq_str_hf_XAU="101,0,101,102,105,99,10:00:00,,98,0,0,0,2026-11-16,伦敦金";', [gold], now)
  assert.equal(missing.previousClose, null); assert.equal(missing.changePercent, null)
})
test('indices use points and provider-identified ETFs retain fund units', () => {
  assert.equal(instrumentFor('cn', 'sh000300').unit, '点')
  assert.equal(instrumentFor('cn', 'sz399001').unit, '点')
  assert.equal(instrumentFor('cn', 'sz000001').unit, '股')
  assert.equal(instrumentFor('us', '.INX').unit, '点')
  const body = tencentRow('usVOO', 'ETF', '103', '2026-11-16 10:00:00').replace(/~";/, '~GP-ETF";')
  const [q] = parseTencent(body, [instrumentFor('us', 'VOO')], now)
  assert.equal(q.instrument.unit, '份')
  const fields = Array(88).fill(''); fields[1] = '沪深300ETF华泰柏瑞'; fields[3] = '4.083'; fields[4] = '4.114'; fields[30] = '20261116100000'; fields[61] = 'ETF'
  const [cnEtf] = parseTencent(`v_sh510300="${fields.join('~')}";`, [instrumentFor('cn', 'sh510300')], now)
  assert.equal(cnEtf.instrument.unit, '份')
  assert.equal(formatPrice(cnEtf.price), '4.083')
  assert.equal(formatPrice(693.38), '693.38')
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
test('configuration retains legacy absolute and directional percentage alerts', () => {
  const config = defaultConfig()
  config.alerts = (['move', 'move_up', 'move_down'] as const).map((kind, index) => ({
    id: `move-${index}`, instrumentId: cn.id, kind, value: 3, enabled: true, cooldownMinutes: 15,
  }))
  config.instruments.push(cn)
  assert.deepEqual(validateConfig(JSON.parse(JSON.stringify(config))).alerts, config.alerts)
  assert.throws(() => validateConfig({ ...config, alerts: [{ ...config.alerts[1], value: -3 }] }), /提醒规则/)
})
test('directional percentage alerts fire only when their own signed threshold is crossed', () => {
  const up: AlertRule = { ...rule, id: 'up', kind: 'move_up', value: 3, cooldownMinutes: 1 }
  const down: AlertRule = { ...rule, id: 'down', kind: 'move_down', value: 3, cooldownMinutes: 1 }
  const engine = new AlertEngine()
  const run = (price: number, seconds: number, hidden = false) => {
    const time = now + seconds * 1000
    return engine.evaluate([up, down], { [cn.id]: quote(price, time) }, time, hidden)
  }
  assert.equal(run(104, 0).length, 0, 'first quote establishes a baseline')
  assert.equal(run(100, 15).length, 0)
  const downEvent = run(97, 30)
  assert.deepEqual(downEvent.map(e => e.ruleId), ['down'])
  assert.match(downEvent[0].text, /跌幅达到 -3%/)
  assert.equal(run(96, 45).length, 0, 'a sustained condition must not repeat')
  assert.equal(run(100, 60).length, 0)
  const upEvent = run(103, 75)
  assert.deepEqual(upEvent.map(e => e.ruleId), ['up'])
  assert.match(upEvent[0].text, /涨幅达到 \+3%/)
  assert.equal(run(100, 90).length, 0)
  assert.equal(run(103, 105).length, 0, 'cooldown applies independently to each rule')
})
test('legacy absolute percentage alerts still work in both directions', () => {
  const legacy: AlertRule = { ...rule, kind: 'move', value: 3, cooldownMinutes: 1 }
  const engine = new AlertEngine()
  const run = (price: number, seconds: number) => {
    const time = now + seconds * 1000
    return engine.evaluate([legacy], { [cn.id]: quote(price, time) }, time, false)
  }
  assert.equal(run(100, 0).length, 0)
  assert.equal(run(103, 15).length, 1)
  assert.equal(run(100, 30).length, 0)
  assert.equal(run(97, 90).length, 1)
})
test('directional alerts stay muted while hidden and rebaseline after missing data', () => {
  const up: AlertRule = { ...rule, kind: 'move_up', value: 3, cooldownMinutes: 1 }
  const engine = new AlertEngine()
  const run = (q: Quote, seconds: number, hidden = false) => engine.evaluate([up], { [cn.id]: q }, now + seconds * 1000, hidden)
  assert.equal(run(quote(100, now), 0).length, 0)
  assert.equal(run(quote(103, now + 15_000), 15, true).length, 0)
  assert.equal(run(quote(104, now + 30_000), 30).length, 0, 'hidden crossing is not replayed')
  assert.equal(run({ ...quote(100, now + 45_000), changePercent: null }, 45).length, 0)
  assert.equal(run(quote(104, now + 60_000), 60).length, 0, 'missing value forces a new baseline')
  assert.equal(run(quote(100, now + 75_000), 75).length, 0)
  assert.equal(run(quote(103, now + 90_000), 90).length, 1)
})
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
test('a changed price with the same source timestamp can cross once without replaying hidden events', () => {
  const e = new AlertEngine()
  const run = (price: number, seconds: number, hidden = false) => e.evaluate([rule], { [cn.id]: quote(price, now) }, now + seconds * 1000, hidden)
  assert.equal(run(100, 0).length, 0)
  assert.equal(run(115, 15).length, 1, 'crossing on a minute-precision timestamp is detected')
  assert.equal(run(115, 30).length, 0, 'repeated identical quote is ignored')
  assert.equal(run(100, 45).length, 0)
  assert.equal(run(115, 60).length, 0, 'cooldown still applies')
  const hidden = new AlertEngine()
  assert.equal(hidden.evaluate([rule], { [cn.id]: quote(100, now) }, now, false).length, 0)
  assert.equal(hidden.evaluate([rule], { [cn.id]: quote(115, now) }, now + 15_000, true).length, 0)
  assert.equal(hidden.evaluate([rule], { [cn.id]: quote(116, now) }, now + 30_000, false).length, 0)
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
test('a multi-instrument snapshot preserves the order, units, source and status of each quote', () => {
  const text = snapshotText([
    { ...quote(101, now, gold), source: '新浪财经', status: 'live' },
    { ...quote(99, now, us), source: '腾讯财经', status: 'delayed' },
  ])
  assert.ok(text.indexOf(gold.symbol) < text.indexOf(us.symbol))
  assert.match(text, /101 USD\/盎司/)
  assert.match(text, /99 USD\/股/)
  assert.match(text, /来源：新浪财经/)
  assert.match(text, /来源：腾讯财经/)
  assert.match(text, /报价已延迟/)
})
test('ticker tooltip identifies the source, market timezone and missing data', () => {
  const value = quoteTooltip('茅台', { ...quote(101), source: '腾讯财经', status: 'delayed' })
  assert.match(value, /报价已延迟/); assert.match(value, /来源：腾讯财经/); assert.match(value, /2026\/11\/16 10:00:00（北京时间）/)
  assert.match(quoteTooltip('苹果', { ...quote(101, now, us), asOf: null }), /源站时间：未知/)
  assert.match(quoteTooltip('茅台', undefined, 'offline'), /连接失败/)
})
function memoryStore(initial = defaultConfig()): ConfigStore {
  let config = structuredClone(initial)
  return { load: async () => ({ config: structuredClone(config) }), save: async next => { config = structuredClone(next) } }
}
test('six-digit A-share lookup retains distinct valid exchange identities', async () => {
  let requested: string[] = []
  const e = new RadarEngine(memoryStore(), { quotes: async list => {
    requested = list.map(i => i.symbol)
    return list.filter(i => i.symbol !== 'bj000001').map(i => ({ ...quote(101, now, i), instrument: { ...i, name: i.symbol === 'sh000001' ? '上证指数' : '平安银行' } }))
  }, series: async () => [] }, () => now)
  try {
    const candidates = await e.candidates('000001')
    assert.deepEqual(requested, ['sh000001', 'sz000001', 'bj000001'])
    assert.deepEqual(candidates.map(i => [i.symbol, i.name]), [['sh000001', '上证指数'], ['sz000001', '平安银行']])
    await assert.rejects(() => e.candidates('sh000001'), /六位/)
  } finally { e.dispose() }
})
test('acknowledging selected alerts preserves other events and configured rules', async () => {
  const config = defaultConfig(), instrument = config.instruments.find(i => i.id === 'cn:sh000001')!
  config.alerts = [{ ...rule, instrumentId: instrument.id, cooldownMinutes: 1 }]
  let time = now, price = 100
  const e = new RadarEngine(memoryStore(config), { quotes: async list => list.map(i => quote(price, time, i)), series: async () => [] }, () => time)
  try {
    await e.refresh(true); time += 15_000; price = 115
    const first = await e.refresh(true)
    assert.equal(first.alerts.length, 1)
    time += 15_000; price = 100; await e.refresh(true)
    time += 60_000; price = 115; const second = await e.refresh(true)
    assert.equal(second.alerts.length, 2)
    const acknowledged = await e.acknowledgeAlerts([first.alerts[0].id])
    assert.equal(acknowledged.alerts.find(a => a.id === first.alerts[0].id)?.read, true)
    assert.notEqual(acknowledged.alerts[0].id, first.alerts[0].id)
    assert.notEqual(acknowledged.alerts[0].read, true)
    assert.equal(acknowledged.config.alerts.length, 1)
    assert.ok((acknowledged.alertsRevision ?? 0) > (second.alertsRevision ?? 0))
  } finally { e.dispose() }
})
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
  fail = false
  const recovered = await e.refresh(true)
  assert.notEqual(recovered.quotes['gold:XAU'].status, 'error')
  assert.equal(recovered.errors?.['gold:XAU'], undefined)
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
