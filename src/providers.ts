import { quoteStatus, sourceTime } from './market-time.ts'
import { instrumentFor } from './config.ts'
import type { Instrument, Market, PricePoint, PriceSeries, Quote } from './types.ts'

export const NETWORK_DOMAINS = ['qt.gtimg.cn', 'web.ifzq.gtimg.cn', 'hq.sinajs.cn', 'stock2.finance.sina.com.cn']
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
    const unit = f.includes('ZS') ? '点' : f.includes('GP-ETF') ? '份' : i.unit
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
export function sanitizePoints(points: PricePoint[]): PricePoint[] {
  const unique = new Map<number, PricePoint>()
  for (const p of points) if (Number.isFinite(p.time) && p.time > 0 && Number.isFinite(p.price) && p.price > 0) unique.set(p.time, { ...p })
  const sorted = [...unique.values()].sort((a, b) => a.time - b.time).slice(-1600)
  return sorted.map((p, index) => ({ ...p, ...(index > 0 && p.time - sorted[index - 1].time > 5 * 60_000 ? { breakBefore: true } : {}) }))
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
export interface MarketProvider {
  quotes(instruments: Instrument[], signal: AbortSignal): Promise<Quote[]>
  series(instrument: Instrument, signal: AbortSignal): Promise<PricePoint[]>
}
export class PublicMarketProvider implements MarketProvider {
  constructor(private fetcher: typeof fetch = fetch) {}
  private async text(url: string, signal: AbortSignal): Promise<string> {
    if (!NETWORK_DOMAINS.includes(new URL(url).hostname)) throw new Error('行情地址不在允许列表')
    const response = await this.fetcher(url, { headers: { Referer: 'https://finance.sina.com.cn/', 'User-Agent': 'DSH-Market-Radar/0.1' }, signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]), redirect: 'error' })
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
        if (length > 2_000_000) throw new Error('行情响应超过大小限制')
        chunks.push(value)
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return new TextDecoder(/utf-?8/i.test(response.headers.get('content-type') ?? '') ? 'utf-8' : new URL(url).hostname.includes('sina') ? 'gb18030' : 'gb18030').decode(bytes)
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
  async resolve(market: Market, symbol: string, signal: AbortSignal): Promise<Instrument> {
    const instrument = instrumentFor(market, symbol)
    const [q] = await this.quotes([instrument], signal)
    if (!q) throw new Error('未找到该标的，请核对市场和代码，或稍后重试')
    return q.instrument
  }
}
export function sampledSeries(i: Instrument, points: PricePoint[], quote?: Quote): PriceSeries {
  return { instrumentId: i.id, points: sanitizePoints(points), previousClose: quote?.previousClose ?? null, source: quote?.source ?? '运行期间采样', coverage: 'sampled', updatedAt: new Date().toISOString() }
}
