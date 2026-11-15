import assert from 'node:assert/strict'
import { PublicMarketProvider } from '../src/providers.ts'
import { defaultConfig } from '../src/config.ts'
const provider = new PublicMarketProvider()
const config = defaultConfig()
for (const market of ['gold', 'cn', 'us'] as const) {
  const group = config.instruments.filter(i => i.market === market)
  const quotes = await provider.quotes(group, AbortSignal.timeout(15_000))
  assert.equal(quotes.length, group.length, `${market}: all default instruments resolve`)
  for (const q of quotes) {
    assert.ok(q.price > 0); assert.ok(q.asOf); assert.ok(q.instrument.name)
    const points = await provider.series(q.instrument, AbortSignal.timeout(15_000))
    console.log(`${q.instrument.id}: ${q.status}; source=${q.source}; asOf=${q.asOf}; historyPoints=${points.length}`)
    if (q.instrument.symbol !== 'AU9999') assert.ok(points.length > 0, `${q.instrument.id}: minute history`)
  }
}
