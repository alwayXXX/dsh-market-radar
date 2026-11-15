import assert from 'node:assert/strict'
import { defaultConfig } from '../src/config.ts'
import { PublicMarketProvider } from '../src/providers.ts'

const provider = new PublicMarketProvider()
const ranges = ['5d', '1m', '6m', 'ytd', '1y', '5y', 'max'] as const
let failures = 0
for (const instrument of defaultConfig().instruments) {
  for (const range of ranges) {
    try {
      const result = await provider.history(instrument, range, AbortSignal.timeout(15_000))
      assert.ok(result.points.length > (range === '5d' ? 3 : 10), 'too few history points')
      assert.ok(result.points.every((p, n) => p.price > 0 && (n === 0 || p.time > result.points[n - 1].time)), 'invalid prices or ordering')
      const first = result.points[0], last = result.points.at(-1)!
      if (range === '1y') assert.ok(last.time - first.time > 300 * 86_400_000, 'year history is truncated')
      if (range === '5y' || range === 'max') assert.ok(last.time - first.time > 4 * 365 * 86_400_000, 'long history is truncated')
      console.log(`PASS ${instrument.id} ${range}: ${result.points.length} ${result.granularity} points, ${new Date(first.time).toISOString()} to ${new Date(last.time).toISOString()}, ${result.source}`)
    } catch (error) {
      failures++
      console.error(`FAIL ${instrument.id} ${range}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
if (failures) process.exitCode = 1
