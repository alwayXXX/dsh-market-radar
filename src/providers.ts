import { quoteStatus, sourceTime, zonedParts } from './market-time.ts'
import { instrumentFor } from './config.ts'
import type { ChartRange, Instrument, Market, PricePoint, PriceSeries, Quote, SeriesGranularity } from './types.ts'

export const NETWORK_DOMAINS = ['qt.gtimg.cn', 'web.ifzq.gtimg.cn', 'hq.sinajs.cn', 'stock2.finance.sina.com.cn', 'query1.finance.yahoo.com', 'www.sge.com.cn']
const numeric = (raw: string | undefined): number | null => raw?.trim() && Number.isFinite(Number(raw)) ? Number(raw) : null
const positive = (raw: string | undefined): number | null => { const n = numeric(raw); return n !== null && n > 0 ? n : null }
export function tencentCode(i: Instrument): string { return i.market === 'us' ? `us${i.symbol}` : i.symbol }

export function parseTencent(body: string, instruments: Instrument[], now = Date.now()): Quote[] {
  const rows = new Map<string, string[]>()
  for (const match of body.matchAll(/\bv_([A-Za-z0-9_.-]+)="([^"\r\n]*)"\s*;/g)) rows.set(match[1], match[2].split('~'))
  return instruments.flatMap(i => {
    const f = rows.get(tencentCode(i))
    if (!f || f.length < 33) return []
    const price = positive(f[3])
    if (price === null || !f[1]?.trim()) return []
    const previousClose = positive(f[4])
    const asOf = sourceTime(f[30], i.market === 'us' ? 'America/New_York' : 'Asia/Shanghai')
    const unit = f.includes('ZS') ? '点' : f.includes('GP-ETF') || (i.market === 'cn' && f[61]?.trim() === 'ETF') ? '份' : i.unit
    const instrument: Instrument = { ...i, name: f[1].replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 80), unit }
    const change = previousClose === null ? null : price - previousClose
    return [{ instrument, price, previousClose, change, changePercent: change === null ? null : change / previousClose! * 100, source: '腾讯财经', asOf, receivedAt: new Date(now).toISOString(), status: quoteStatus(i, asOf, now) }]
  })
}
export function parseSina(body: string, instruments: Instrument[], now = Date.now()): Quote[] {
  const rows = new Map<string, string[]>()
  for (const m of body.matchAll(/\bvar\s+hq_str_([A-Za-z0-9_]+)="([^"\r\n]*)"\s*;/g)) rows.set(m[1], m[2].split(','))
  return instruments.flatMap(i => {
    const f = rows.get(i.symbol === 'XAU' ? 'hf_XAU' : 'gds_AU9999')
    if (!f || f.length < 14) return []
    const price = positive(f[0])
    if (price === null) return []
    const previousClose = positive(f[8])
    const asOf = sourceTime(`${f[12]} ${f[6]}`, 'Asia/Shanghai')
    const change = previousClose === null ? null : price - previousClose
    return [{ instrument: i, price, previousClose, change, changePercent: change === null ? null : change / previousClose! * 100, source: '新浪财经', asOf, receivedAt: new Date(now).toISOString(), status: quoteStatus(i, asOf, now) }]
  })
}
export function sanitizePoints(points: PricePoint[], gapMs = 5 * 60_000, limit = 1600): PricePoint[] {
  const unique = new Map<number, PricePoint>()
  for (const p of points) if (Number.isFinite(p.time) && p.time >= Date.UTC(1900, 0, 1) && Number.isFinite(p.price) && p.price > 0) unique.set(p.time, { ...p })
  const sorted = [...unique.values()].sort((a, b) => a.time - b.time).slice(-limit)
  return sorted.map((p, index) => ({ ...p, ...(index > 0 && p.time - sorted[index - 1].time > gapMs ? { breakBefore: true } : {}) }))
}
export function parseTencentSeries(raw: unknown, i: Instrument): PricePoint[] {
  const root = raw as { code?: number; data?: Record<string, { data?: { date?: string; data?: string[] }; date?: string }> }
  if (root?.code !== 0) return []
  const entry = root.data?.[tencentCode(i)]
  const data = entry?.data
  if (!data || !Array.isArray(data.data)) return []
  const date = data.date ?? entry?.date
  if (typeof date !== 'string' || !/^\d{8}$/.test(date)) return []
  return sanitizePoints(data.data.flatMap(line => {
    if (typeof line !== 'string') return []
    const [time, rawPrice] = line.split(/\s+/)
    if (!/^\d{4}$/.test(time)) return []
    const stamp = sourceTime(`${date}${time}00`, i.market === 'us' ? 'America/New_York' : 'Asia/Shanghai')
    const price = positive(rawPrice)
    return stamp && price !== null ? [{ time: Date.parse(stamp), price }] : []
  }))
}
export function parseGoldSeries(body: string): PricePoint[] {
  // Parse a known JSONP wrapper as JSON; never execute downloaded JavaScript.
  const match = /\bvar\s+_data\s*=\s*\(([\s\S]+)\)\s*;?\s*$/.exec(body)
  if (!match) return []
  const data: unknown = JSON.parse(match[1])
  const rows = (data as { minLine_1d?: unknown[] })?.minLine_1d
  if (!Array.isArray(rows)) return []
  return sanitizePoints(rows.flatMap(row => {
    if (!Array.isArray(row)) return []
    const stampText = row.findLast(v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v))
    const time = typeof stampText === 'string' ? sourceTime(stampText, 'Asia/Shanghai') : null
    const price = positive(row[1])
    return time && price !== null ? [{ time: Date.parse(time), price }] : []
  }))
}
const DAY = 24 * 60 * 60_000
const positiveValue = (value: unknown): number | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const result = Number(value)
  return Number.isFinite(result) && result > 0 ? result : null
}
function dailyTime(date: unknown, zone: string): number | null {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const time = sourceTime(`${date} 00:00:00`, zone)
  return time ? Date.parse(time) : null
}
/** Select calendar months in the instrument's own timezone, not the computer's timezone. */
export function selectDailyRange(points: PricePoint[], range: Exclude<ChartRange, '1d'>, zone: string, now = Date.now()): PricePoint[] {
  const result = sanitizePoints(points.filter(p => p.time <= now), 8 * DAY, 30_000)
  if (range === '5d') return result.slice(-5)
  if (range === 'max') return result
  const local = zonedParts(now, zone)
  if (range === 'ytd') {
    const cutoff = dailyTime(`${local.year}-01-01`, zone)
    return cutoff === null ? [] : result.filter(p => p.time >= cutoff)
  }
  const months = range === '1m' ? 1 : range === '6m' ? 6 : range === '5y' ? 60 : 12
  const targetMonth = new Date(Date.UTC(local.year, local.month - 1 - months, 1))
  const year = targetMonth.getUTCFullYear(), month = targetMonth.getUTCMonth()
  const day = Math.min(local.day, new Date(Date.UTC(year, month + 1, 0)).getUTCDate())
  const cutoff = dailyTime(`${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`, zone)
  return cutoff === null ? [] : result.filter(p => p.time >= cutoff)
}
export function parseTencentFiveDay(raw: unknown, i: Instrument): PricePoint[] {
  const root = raw as { code?: number; data?: Record<string, { data?: { date?: string; data?: string[] }[] }> }
  const days = root?.code === 0 ? root.data?.[tencentCode(i)]?.data : undefined
  if (!Array.isArray(days)) return []
  return sanitizePoints(days.flatMap(day => {
    if (typeof day?.date !== 'string' || !/^\d{8}$/.test(day.date) || !Array.isArray(day.data)) return []
    return day.data.flatMap(row => {
      if (typeof row !== 'string') return []
      const [minute, value] = row.trim().split(/\s+/)
      if (!/^\d{4}$/.test(minute)) return []
      const stamp = sourceTime(`${day.date}${minute}00`, 'Asia/Shanghai'), price = positiveValue(value)
      return stamp && price !== null ? [{ time: Date.parse(stamp), price }] : []
    })
  }))
}
export function parseTencentDaily(raw: unknown, i: Instrument): PricePoint[] {
  const root = raw as { code?: number; data?: Record<string, { day?: unknown[] }> }
  const rows = root?.code === 0 ? root.data?.[tencentCode(i)]?.day : undefined
  if (!Array.isArray(rows)) return []
  return rows.flatMap(row => {
    if (!Array.isArray(row)) return []
    const time = dailyTime(row[0], 'Asia/Shanghai'), price = positiveValue(row[2])
    return time !== null && price !== null ? [{ time, price }] : []
  })
}
export function parseSinaGoldDaily(body: string): PricePoint[] {
  // The response is JSON inside a JSONP wrapper; it must never be evaluated.
  const match = /\bvar\s+_data\s*=\s*\(([\s\S]+)\)\s*;?\s*$/.exec(body)
  if (!match) return []
  const rows: unknown = JSON.parse(match[1])
  if (!Array.isArray(rows)) return []
  return rows.flatMap(row => {
    const time = dailyTime(row?.date, 'Asia/Shanghai'), price = positiveValue(row?.close)
    return time !== null && price !== null ? [{ time, price }] : []
  })
}
export function parseSgeDaily(raw: unknown): PricePoint[] {
  const rows = (raw as { time?: unknown[] })?.time
  if (!Array.isArray(rows)) return []
  return rows.flatMap(row => {
    if (!Array.isArray(row)) return []
    const time = dailyTime(row[0], 'Asia/Shanghai'), price = positiveValue(row[2])
    return time !== null && price !== null ? [{ time, price }] : []
  })
}
export function yahooSymbol(i: Instrument): string | null {
  if (i.market !== 'us') return null
  if (i.symbol === '.INX') return '^GSPC'
  return /^[A-Z][A-Z0-9-]*$/.test(i.symbol) ? i.symbol : null
}
export function parseYahooSeries(raw: unknown, symbol: string, daily: boolean): PricePoint[] {
  const result = (raw as { chart?: { result?: Array<{ meta?: { symbol?: string; currency?: string; exchangeTimezoneName?: string; dataGranularity?: string }; timestamp?: unknown[]; indicators?: { quote?: Array<{ close?: unknown[] }> } }> } })?.chart?.result?.[0]
  if (result?.meta?.symbol?.toUpperCase() !== symbol.toUpperCase() || result.meta.currency !== 'USD' || result.meta.exchangeTimezoneName !== 'America/New_York' || result.meta.dataGranularity !== (daily ? '1d' : '5m')) return []
  const times = result.timestamp, prices = result.indicators?.quote?.[0]?.close
  if (!Array.isArray(times) || !Array.isArray(prices)) return []
  let missing = false
  const points: PricePoint[] = []
  for (let n = 0; n < times.length; n++) {
    const seconds = times[n], price = positiveValue(prices[n])
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || price === null) { missing = true; continue }
    const time = seconds * 1000
    points.push({ time, price, ...(missing && points.length ? { breakBefore: true } : {}) })
    missing = false
  }
  return sanitizePoints(points, daily ? 8 * DAY : 5 * 60_000, daily ? 30_000 : 1600)
}
export interface HistoricalSeries { points: PricePoint[]; source: string; granularity: SeriesGranularity; note?: string }
export interface MarketProvider {
  quotes(instruments: Instrument[], signal: AbortSignal): Promise<Quote[]>
  series(instrument: Instrument, signal: AbortSignal): Promise<PricePoint[]>
  history?(instrument: Instrument, range: Exclude<ChartRange, '1d'>, signal: AbortSignal): Promise<HistoricalSeries>
}
export class PublicMarketProvider implements MarketProvider {
  constructor(private fetcher: typeof fetch = fetch, private now: () => number = Date.now) {}
  private async text(url: string, signal: AbortSignal, body?: string, maxBytes = 2_000_000): Promise<string> {
    if (!NETWORK_DOMAINS.includes(new URL(url).hostname)) throw new Error('行情地址不在允许列表')
    const response = await this.fetcher(url, { method: body === undefined ? 'GET' : 'POST', body, headers: { Referer: url.includes('sge.com.cn') ? 'https://www.sge.com.cn/' : 'https://finance.sina.com.cn/', 'User-Agent': 'DSH-Market-Radar/0.1', ...(body === undefined ? {} : { 'Content-Type': 'application/x-www-form-urlencoded' }) }, signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]), redirect: 'error' })
    if (!response.ok) throw new Error(`行情服务暂不可用（HTTP ${response.status}）`)
    const reader = response.body?.getReader()
    if (!reader) throw new Error('行情服务返回空响应')
    const chunks: Uint8Array[] = []
    let length = 0
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        length += value.byteLength
        if (length > maxBytes) throw new Error('行情响应超过大小限制')
        chunks.push(value)
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    const utf8 = /utf-?8/i.test(response.headers.get('content-type') ?? '') || /(?:yahoo|sge)\.com/.test(new URL(url).hostname)
    return new TextDecoder(utf8 ? 'utf-8' : 'gb18030').decode(bytes)
  }
  async quotes(instruments: Instrument[], signal: AbortSignal): Promise<Quote[]> {
    if (!instruments.length) return []
    const gold = instruments[0].market === 'gold'
    const query = gold ? instruments.map(i => i.symbol === 'XAU' ? 'hf_XAU' : 'gds_AU9999').join(',') : instruments.map(tencentCode).join(',')
    const url = gold ? `https://hq.sinajs.cn/list=${query}` : `https://qt.gtimg.cn/q=${query}`
    const body = await this.text(url, signal)
    return gold ? parseSina(body, instruments) : parseTencent(body, instruments)
  }
  async series(i: Instrument, signal: AbortSignal): Promise<PricePoint[]> {
    if (i.market === 'gold') {
      if (i.symbol !== 'XAU') return []
      return parseGoldSeries(await this.text('https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_data=/GlobalFuturesService.getGlobalFuturesMinLine?symbol=XAU&type=1', signal))
    }
    const method = i.market === 'us' ? 'UsMinute' : 'minute'
    const text = await this.text(`https://web.ifzq.gtimg.cn/appstock/app/${method}/query?code=${tencentCode(i)}`, signal)
    return parseTencentSeries(JSON.parse(text), i)
  }
  async history(i: Instrument, range: Exclude<ChartRange, '1d'>, signal: AbortSignal): Promise<HistoricalSeries> {
    if (i.market === 'cn') {
      if (range === '5d') {
        const raw = await this.text(`https://web.ifzq.gtimg.cn/appstock/app/day/query?code=${tencentCode(i)}`, signal)
        return { points: parseTencentFiveDay(JSON.parse(raw), i), source: '腾讯财经', granularity: 'minute', note: '最近 5 个交易日分时' }
      }
      const count = range === 'max' ? 2000 : range === '5y' ? 1500 : 320
      const all: PricePoint[] = []
      let end = '', partial = false
      for (let page = 0; page < (range === 'max' ? 8 : 1); page++) {
        try {
          const raw = await this.text(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${tencentCode(i)},day,,${end},${count},none`, signal)
          const points = sanitizePoints(parseTencentDaily(JSON.parse(raw), i), 8 * DAY, 30_000)
          if (!points.length) { if (page > 0) partial = true; break }
          if (all.length && points[0].time >= Math.min(...all.map(p => p.time))) { partial = true; break }
          all.push(...points)
          if (range !== 'max' || points.length < count) break
          if (page === 7) { partial = true; break }
          const p = zonedParts(points[0].time, 'Asia/Shanghai')
          end = new Date(Date.UTC(p.year, p.month - 1, p.day - 1)).toISOString().slice(0, 10)
        } catch (error) {
          if (!all.length || signal.aborted) throw error
          partial = true; break
        }
      }
      return { points: selectDailyRange(all, range, 'Asia/Shanghai', this.now()), source: '腾讯财经', granularity: 'daily', note: `日线收盘价 · 未复权；当日数据可能未收盘${partial ? '；更早数据暂未获取' : ''}` }
    }
    if (i.market === 'us') {
      const symbol = yahooSymbol(i)
      if (!symbol) throw new Error('该美股代码暂不支持历史走势')
      const period = range === '5d' ? '5d' : range === '1m' ? '1mo' : range === '6m' ? '6mo' : range === 'ytd' ? 'ytd' : range === '5y' ? '5y' : '1y'
      const daily = range !== '5d'
      const query = range === 'max' ? `period1=-2208988800&period2=${Math.ceil(this.now() / 1000) + 86400}&interval=1d` : `range=${period}&interval=${daily ? '1d' : '5m'}`
      const raw = await this.text(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${query}`, signal, undefined, range === 'max' ? 5_000_000 : 2_000_000)
      const parsed = parseYahooSeries(JSON.parse(raw), symbol, daily)
      return { points: daily ? selectDailyRange(parsed, range, 'America/New_York', this.now()) : parsed.filter(p => p.time <= this.now()), source: 'Yahoo Finance', granularity: daily ? 'daily' : 'five-minute', note: daily ? '日线 close · 复权口径以来源为准；当日数据可能未收盘' : '最近 5 个交易日 · 5 分钟采样' }
    }
    if (i.symbol === 'XAU') {
      const body = await this.text('https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_data=/GlobalFuturesService.getGlobalFuturesDailyKLine?symbol=XAU', signal)
      return { points: selectDailyRange(parseSinaGoldDaily(body), range, 'Asia/Shanghai', this.now()), source: '新浪财经 XAU', granularity: 'daily', note: '日线收盘点；当日数据可能未收盘' }
    }
    const body = await this.text('https://www.sge.com.cn/graph/Dailyhq', signal, 'instid=Au99.99')
    return { points: selectDailyRange(parseSgeDaily(JSON.parse(body)), range, 'Asia/Shanghai', this.now()), source: '上海黄金交易所 Au99.99', granularity: 'daily', note: '日线收盘点；当日数据可能未收盘' }
  }
  async resolve(market: Market, symbol: string, signal: AbortSignal): Promise<Instrument> {
    const instrument = instrumentFor(market, symbol)
    const [q] = await this.quotes([instrument], signal)
    if (!q) throw new Error('未找到该标的，请核对市场和代码，或稍后重试')
    return q.instrument
  }
}
export function sampledSeries(i: Instrument, points: PricePoint[], quote?: Quote): PriceSeries {
  return { instrumentId: i.id, range: '1d', points: sanitizePoints(points), previousClose: quote?.previousClose ?? null, source: quote?.source ?? '运行期间采样', coverage: 'sampled', granularity: 'sampled', updatedAt: new Date().toISOString() }
}
