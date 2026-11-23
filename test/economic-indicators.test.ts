import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EconomicIndicatorsFeed, parseBlsIndicator } from '../src/economic-indicators.ts'

const payload = (seriesID: string, data: { year: string; period: string; value: string }[]) => JSON.stringify({ status: 'REQUEST_SUCCEEDED', Results: { series: [{ seriesID, data }] } })
const fetched = '2026-11-23T12:00:00.000Z'

test('nonfarm cards use consecutive revised levels and convert thousands into ten-thousands', () => {
  const body = payload('CES0000000001', [
    { year: '2026', period: 'M01', value: '150160' },
    { year: '2025', period: 'M12', value: '150000' },
    { year: '2025', period: 'M11', value: '150050' },
    { year: '2025', period: 'M13', value: '999999' },
  ])
  const value = parseBlsIndicator(body, 'payroll', fetched)
  assert.equal(value.period, '2026-01')
  assert.equal(value.value, 16)
  assert.equal(value.previous, -5)
  assert.deepEqual(value.history.at(-1), { period: '2026-01', value: 16 })
})

test('CPI uses the same month of the prior year and keeps a missing base unavailable', () => {
  const body = payload('CUUR0000SA0', [
    { year: '2026', period: 'M10', value: '337.511' },
    { year: '2026', period: 'M09', value: '336.940' },
    { year: '2025', period: 'M10', value: '-' },
    { year: '2025', period: 'M09', value: '324.800' },
  ])
  const value = parseBlsIndicator(body, 'cpi', fetched)
  assert.equal(value.period, '2026-10')
  assert.equal(value.value, null)
  assert.ok(Math.abs(value.previous! - 3.73768) < 0.001)
  assert.equal(value.history.at(-1)?.value, null)
})

test('economic sources fail independently, share concurrent work and can retry failures', async () => {
  let requests = 0
  let cpiAvailable = false
  const fetcher: typeof fetch = async url => {
    requests++
    if (String(url).includes('CES0000000001')) return new Response(payload('CES0000000001', [
      { year: '2026', period: 'M10', value: '159293' }, { year: '2026', period: 'M09', value: '159128' },
    ]))
    return cpiAvailable ? new Response(payload('CUUR0000SA0', [
      { year: '2026', period: 'M10', value: '337.511' }, { year: '2025', period: 'M10', value: '-' },
    ])) : new Response('blocked', { status: 403 })
  }
  const feed = new EconomicIndicatorsFeed(new AbortController().signal, fetcher, () => Date.parse(fetched))
  const first = feed.load()
  assert.equal(feed.load(), first)
  assert.deepEqual((await first).unavailable, ['cpi'])
  assert.equal(requests, 2)
  cpiAvailable = true
  const result = await feed.load()
  assert.deepEqual(result.unavailable, [])
  assert.equal(result.indicators[0].value, 16.5)
  assert.equal(result.indicators[1].value, null)
  await feed.load()
  assert.equal(requests, 4)
})

test('economic data reject errors, mismatched series and duplicate months', () => {
  assert.throws(() => parseBlsIndicator('{"status":"REQUEST_NOT_PROCESSED"}', 'cpi', fetched))
  assert.throws(() => parseBlsIndicator(payload('CES0000000001', []), 'cpi', fetched))
  const row = { year: '2026', period: 'M10', value: '100' }
  assert.throws(() => parseBlsIndicator(payload('CUUR0000SA0', [row, row]), 'cpi', fetched), /重复/)
})
