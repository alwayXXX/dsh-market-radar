import { fetchFeed } from './market-events.ts'
import type { EconomicIndicator, EconomicIndicatorId, EconomicIndicatorsResult } from './types.ts'

const SERIES = { payroll: 'CES0000000001', cpi: 'CUUR0000SA0' } as const

function monthKey(year: number, month: number): string {
  const date = new Date(Date.UTC(year, month - 1, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

export function parseBlsIndicator(raw: string, id: EconomicIndicatorId, fetchedAt: string): EconomicIndicator {
  const result: unknown = JSON.parse(raw)
  if (!result || typeof result !== 'object') throw new Error('经济数据格式无效')
  const record = result as { status?: unknown; Results?: { series?: { seriesID?: unknown; data?: unknown }[] } }
  const series = record.Results?.series
  if (record.status !== 'REQUEST_SUCCEEDED' || !Array.isArray(series) || series.length !== 1 || series[0].seriesID !== SERIES[id] || !Array.isArray(series[0].data)) throw new Error('经济数据不可用')
  const observations = new Map<string, number | null>()
  for (const item of series[0].data) {
    if (!item || typeof item !== 'object') continue
    const row = item as { year?: unknown; period?: unknown; value?: unknown }
    if (typeof row.year !== 'string' || !/^\d{4}$/.test(row.year) || typeof row.period !== 'string' || !/^M(0[1-9]|1[0-2])$/.test(row.period)) continue
    const period = `${row.year}-${row.period.slice(1)}`
    if (observations.has(period)) throw new Error('经济数据月份重复')
    const value = typeof row.value === 'string' && /^\d+(?:\.\d+)?$/.test(row.value) ? Number(row.value) : null
    observations.set(period, value !== null && Number.isFinite(value) && value > 0 ? value : null)
  }
  const latest = [...observations.keys()].filter(key => observations.get(key) !== null).sort().at(-1)
  if (!latest) throw new Error('没有可用的经济数据')
  const [year, month] = latest.split('-').map(Number)
  const calculate = (period: string): number | null => {
    const current = observations.get(period)
    const [y, m] = period.split('-').map(Number)
    const prior = observations.get(monthKey(y, id === 'payroll' ? m - 1 : m - 12))
    if (current == null || prior == null) return null
    return id === 'payroll' ? (current - prior) / 10 : (current / prior - 1) * 100
  }
  const history = Array.from({ length: 8 }, (_, index) => {
    const period = monthKey(year, month - 7 + index)
    return { period, value: calculate(period) }
  })
  return { id, period: latest, value: calculate(latest), previous: calculate(monthKey(year, month - 1)), history, fetchedAt }
}

export class EconomicIndicatorsFeed {
  private pending?: Promise<EconomicIndicatorsResult>
  private cached?: { value: EconomicIndicatorsResult; expires: number }

  constructor(private signal: AbortSignal, private fetcher: typeof fetch = fetch, private now = Date.now) {}

  load(): Promise<EconomicIndicatorsResult> {
    if (this.cached && this.now() < this.cached.expires) return Promise.resolve(this.cached.value)
    return this.pending ??= this.refresh().finally(() => { this.pending = undefined })
  }

  private async refresh(): Promise<EconomicIndicatorsResult> {
    const ids: EconomicIndicatorId[] = ['payroll', 'cpi']
    const fetchedAt = new Date(this.now()).toISOString()
    const results = await Promise.allSettled(ids.map(async id => {
      const url = `https://api.bls.gov/publicAPI/v1/timeseries/data/${SERIES[id]}`
      return parseBlsIndicator(await fetchFeed(this.fetcher, url, this.signal), id, fetchedAt)
    }))
    const indicators: EconomicIndicator[] = []
    const unavailable: EconomicIndicatorId[] = []
    results.forEach((result, index) => result.status === 'fulfilled' ? indicators.push(result.value) : unavailable.push(ids[index]))
    const value = { indicators, unavailable }
    this.cached = unavailable.length ? undefined : { value, expires: this.now() + 4 * 3_600_000 }
    return value
  }
}
