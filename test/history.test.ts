import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defaultConfig, instrumentFor } from '../src/config.ts'
import { RadarEngine } from '../src/engine.ts'
import { sourceTime } from '../src/market-time.ts'
import { parseSgeDaily, parseSinaGoldDaily, parseTencentDaily, parseTencentFiveDay, parseYahooSeries, PublicMarketProvider, selectDailyRange, yahooSymbol, type MarketProvider } from '../src/providers.ts'
import type { ConfigStore } from '../src/storage.ts'

const cn = instrumentFor('cn', 'sh600519')
const us = instrumentFor('us', 'VOO')
const at = (stamp: string, zone = 'Asia/Shanghai') => Date.parse(sourceTime(stamp, zone)!)

test('Tencent history verifies symbol, reads unadjusted close, and keeps trading-session gaps', () => {
  const data = { code: 0, data: { sh600519: { data: [
    { date: '20261113', data: ['0930 100', '0931 101'] },
    { date: '20261112', data: ['1459 98', '1500 99'] },
  ] } } }
  const points = parseTencentFiveDay(data, cn)
  assert.deepEqual(points.map(p => p.price), [98, 99, 100, 101])
  assert.equal(points[2].breakBefore, true)
  assert.equal(points[2].time, at('20261113093000'))
  assert.equal(parseTencentFiveDay(data, instrumentFor('cn', 'sz000001')).length, 0)
  assert.deepEqual(parseTencentDaily({ code: 0, data: { sh600519: { day: [['2026-11-13', '99', '101', '102']] } } }, cn).map(p => p.price), [101])
  assert.equal(parseTencentDaily({ code: 0, data: { sh600519: { qfqday: [['2026-11-13', '99', '101']] } } }, cn).length, 0)
})

test('gold histories parse inert data with distinct USD and CNY sources', () => {
  const xau = parseSinaGoldDaily('/*<script>ignored</script>*/var _data=([{"date":"2026-11-13","close":"3879.92"}]);')
  const au = parseSgeDaily({ time: [['2026-11-13', 847.8, 837.55, 829.98, 857.8]] })
  assert.deepEqual(xau.map(p => p.price), [3879.92])
  assert.deepEqual(au.map(p => p.price), [837.55])
  assert.equal(xau[0].time, at('20261113000000'))
  assert.equal(parseSinaGoldDaily('globalThis.invalid=true;').length, 0)
  assert.equal(parseSgeDaily({ time: [['bad', 847, 837], ['2026-11-13', 847, 0]] }).length, 0)
})

test('calendar ranges use local dates, clamp month ends and reject future data', () => {
  const points = ['20260731000000', '20260830000000', '20260831000000', '20260930000000', '20261001000000'].map((stamp, n) => ({ time: at(stamp), price: n + 1 }))
  const result = selectDailyRange(points, '1m', 'Asia/Shanghai', at('20260930120000'))
  assert.deepEqual(result.map(p => p.price), [2, 3, 4])
  const five = selectDailyRange([...points, ...[1, 2, 3].map(day => ({ time: at(`2026100${day}000000`), price: 10 + day }))], '5d', 'Asia/Shanghai', at('20261004120000'))
  assert.equal(five.length, 5)
  assert.ok(five.every((p, i) => i === 0 || p.time > five[i - 1].time))
  const acrossYears = ['20251231000000', '20260101000000', '20261113000000', '20270101000000'].map((stamp, n) => ({ time: at(stamp), price: n + 1 }))
  assert.deepEqual(selectDailyRange(acrossYears, 'ytd', 'Asia/Shanghai', at('20261116120000')).map(p => p.price), [2, 3])
  const old = [{ time: Date.parse('1960-01-01T12:00:00Z'), price: 1 }, ...acrossYears]
  assert.equal(selectDailyRange(old, 'max', 'Asia/Shanghai', at('20261116120000'))[0].time, old[0].time)
})

test('Yahoo verifies identity, USD and timezone, and preserves missing 5 minute points', () => {
  const start = at('20261116100000', 'America/New_York') / 1000
  const result = { chart: { result: [{ meta: { symbol: 'VOO', currency: 'USD', exchangeTimezoneName: 'America/New_York', dataGranularity: '5m' }, timestamp: [start, start + 300, start + 600], indicators: { quote: [{ close: [100, null, 102] }] } }] } }
  const points = parseYahooSeries(result, 'VOO', false)
  assert.equal(points.length, 2); assert.equal(points[1].breakBefore, true)
  assert.equal(parseYahooSeries(result, 'AAPL', false).length, 0)
  result.chart.result[0].meta.currency = 'CNY'
  assert.equal(parseYahooSeries(result, 'VOO', false).length, 0)
  result.chart.result[0].meta.currency = 'USD'; result.chart.result[0].meta.dataGranularity = '1mo'
  assert.equal(parseYahooSeries(result, 'VOO', false).length, 0)
  assert.equal(yahooSymbol(us), 'VOO'); assert.equal(yahooSymbol(instrumentFor('us', '.INX')), '^GSPC')
  assert.equal(yahooSymbol(instrumentFor('us', '.OTHER')), null)
  const historical = { chart: { result: [{ meta: { symbol: '^GSPC', currency: 'USD', exchangeTimezoneName: 'America/New_York', dataGranularity: '1d' }, timestamp: [-1325583000], indicators: { quote: [{ close: [17.66] }] } }] } }
  assert.ok(parseYahooSeries(historical, '^GSPC', true)[0].time < 0)
})

test('Tencent Max follows historical pages and retains their earliest dates', async () => {
  const end = Date.UTC(2026, 10, 13)
  const dates = Array.from({ length: 2000 }, (_, index) => new Date(end - (1999 - index) * 86_400_000).toISOString().slice(0, 10))
  const expectedEnd = new Date(end - 2000 * 86_400_000).toISOString().slice(0, 10)
  const urls: string[] = []
  const fetcher: typeof fetch = async input => {
    const url = String(input); urls.push(url)
    const rows = urls.length === 1 ? dates.map(date => [date, '99', '100']) : [[expectedEnd, '89', '90']]
    return new Response(JSON.stringify({ code: 0, data: { sh600519: { day: rows } } }))
  }
  const result = await new PublicMarketProvider(fetcher, () => at('20261116120000')).history(cn, 'max', AbortSignal.timeout(10_000))
  assert.equal(urls.length, 2)
  assert.ok(urls[1].includes(`day,,${expectedEnd},2000,none`))
  assert.equal(result.points.length, 2001)
  assert.equal(result.points[0].price, 90)
})

test('engine caches each range independently and never substitutes samples for long history', async () => {
  const config = defaultConfig()
  const store: ConfigStore = { async load() { return { config } }, async save() {} }
  let calls = 0
  const provider: MarketProvider = {
    async quotes() { return [] },
    async series() { return [{ time: at('20261113100000'), price: 100 }] },
    async history(_i, range) { calls++; if (range === '1y') throw new Error('离线'); return { points: [{ time: at('20261112000000'), price: 90 }], source: 'test', granularity: 'daily' } },
  }
  const engine = new RadarEngine(store, provider, () => at('20261116100000'))
  try {
    const id = config.instruments[0].id
    assert.equal((await engine.series(id)).range, '1d')
    assert.equal((await engine.series(id, '5d')).points[0].price, 90)
    assert.equal((await engine.series(id, '5d')).source, 'test')
    assert.equal(calls, 1)
    const unavailable = await engine.series(id, '1y')
    assert.equal(unavailable.points.length, 0); assert.match(unavailable.error!, /离线/)
    assert.equal(unavailable.previousClose, null); assert.equal(calls, 2)
    await assert.rejects(() => engine.series(id, 'bad' as never), /时间范围/)
  } finally { engine.dispose() }
})
