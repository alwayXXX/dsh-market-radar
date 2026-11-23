import { sourceTime, zonedParts } from './market-time.ts'
import type { MarketEvent, MarketEventSource, MarketEventsResult } from './types.ts'

const FED_FEED = 'https://www.federalreserve.gov/feeds/press_monetary.xml'
const BLS_FEED = 'https://www.bls.gov/schedule/news_release/bls.ics'
const CPI_SCHEDULE = 'https://www.bls.gov/schedule/news_release/cpi.htm'
const NY_FED_CALENDARS = 'https://www.newyorkfed.org/research/calendars/'
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAY_MS = 86_400_000
const MAX_FEED_BYTES = 256 * 1024

function decodeEntities(value: string): string {
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
  return value.replace(/&(amp|lt|gt|quot|apos|#\d{1,7}|#x[\da-fA-F]{1,6});/g, (match, entity: string) => {
    if (!entity.startsWith('#')) return entities[entity]
    const code = entity.startsWith('#x') ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1))
    return code >= 32 && code <= 0x10ffff ? String.fromCodePoint(code) : match
  }).trim()
}

function rssField(item: string, tag: 'title' | 'link' | 'pubDate'): string {
  const value = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i').exec(item)?.[1]?.trim() ?? ''
  const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(value)
  return decodeEntities(cdata?.[1] ?? value)
}

export function parseFedArticle(html: string): string {
  const article = /<div\b[^>]*\bid=["']article["'][^>]*>[\s\S]*?<div\b[^>]*\bclass=["']col-xs-12 col-sm-8 col-md-8["'][^>]*>([\s\S]*?)<div\b[^>]*\bclass=["']col-xs-12 col-sm-4/i.exec(html)?.[1]
  if (!article) throw new Error('无法读取公告正文')
  const clean = article.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
  const paragraphs = [...clean.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map(match => decodeEntities(match[1].replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ')).replace(/\s+/g, ' ').trim())
    .filter(text => text.length >= 50 && !/^For release at\b/i.test(text))
  if (!paragraphs.length) throw new Error('公告正文暂不可读')
  return paragraphs.join('\n\n').slice(0, 20_000)
}

export function fedMinutesLink(html: string): string | null {
  const article = /<div\b[^>]*\bid=["']article["'][^>]*>([\s\S]*?)<div\b[^>]*\bid=["']lastUpdate["']/i.exec(html)?.[1]
  const path = article && /href=["'](\/monetarypolicy\/fomcminutes\d{8}\.htm)["']/i.exec(article)?.[1]
  return path ? `https://www.federalreserve.gov${path}` : null
}

export function parseFedMinutes(html: string): string {
  const article = /<div\b[^>]*\bid=["']article["'][^>]*>([\s\S]*?)<div\b[^>]*\bid=["']lastUpdate["']/i.exec(html)?.[1]
  if (!article) throw new Error('无法读取会议纪要正文')
  const clean = article.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
  const text = [...clean.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map(match => decodeEntities(match[1].replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ')).replace(/\s+/g, ' ').trim())
    .filter(value => value.length >= 50).join('\n\n')
  if (!text) throw new Error('会议纪要正文暂不可读')
  return text.length > 20_000 ? `${text.slice(0, 9000)}\n\n[中间内容已省略]\n\n${text.slice(-11_000)}` : text
}

export function parseFedAnnouncements(xml: string): MarketEvent[] {
  if (!/<rss\b[^>]*>/i.test(xml) || !/<\/rss>\s*$/i.test(xml)) throw new Error('无效的美联储 RSS')
  const events = new Map<string, MarketEvent>()
  for (const [item] of xml.matchAll(/<item\b[^>]*>[\s\S]*?<\/item>/gi)) {
    const title = rssField(item, 'title').replace(/\s+/g, ' ')
    const url = URL.parse(rssField(item, 'link'))
    const date = Date.parse(rssField(item, 'pubDate'))
    if (!title || title.length > 300 || !Number.isFinite(date) || !url || url.origin !== 'https://www.federalreserve.gov' ||
        url.username || url.password || !url.pathname.startsWith('/newsevents/pressreleases/')) continue
    events.set(url.href, { title, at: new Date(date).toISOString(), url: url.href, source: 'fed', kind: 'published' })
  }
  if (!events.size && /<item\b/i.test(xml)) throw new Error('美联储 RSS 没有可读的公告')
  return [...events.values()]
}

export function parseCpiSchedule(ical: string): MarketEvent[] {
  const text = ical.trim().replace(/\r?\n[ \t]/g, '')
  if (!/^BEGIN:VCALENDAR\r?\n/.test(text) || !/\r?\nEND:VCALENDAR$/.test(text)) throw new Error('无效的美国 CPI 日历')
  const events = new Map<string, MarketEvent>()
  for (const [, entry] of text.matchAll(/^BEGIN:VEVENT\r?\n([\s\S]*?)^END:VEVENT\r?$/gm)) {
    if (!/^SUMMARY:Consumer Price Index\r?$/im.test(entry) || /^STATUS:CANCELLED\r?$/im.test(entry)) continue
    const eastern = /^DTSTART;TZID=(?:US-Eastern|America\/New_York):(\d{8}T\d{6})\r?$/im.exec(entry)
    const utc = /^DTSTART:(\d{8}T\d{6})Z\r?$/im.exec(entry)
    const at = eastern ? sourceTime(eastern[1], 'America/New_York') : utc ? sourceTime(utc[1], 'UTC') : null
    if (at) events.set(at, { title: '美国消费者价格指数（CPI）', at, url: CPI_SCHEDULE, source: 'bls', kind: 'scheduled' })
  }
  if (!events.size) throw new Error('日历没有可读的 CPI 日程')
  return [...events.values()]
}

function nyFedMonthUrl(year: number, month: number): string {
  const abbreviated = MONTH_NAMES[month - 1].slice(0, 3).toLowerCase()
  return `${NY_FED_CALENDARS}i-${abbreviated}${String(year).slice(-2)}.html`
}

function parseNyFedCpi(html: string, year: number, month: number): MarketEvent[] {
  if (!html.includes(`${MONTH_NAMES[month - 1]} ${year}`)) throw new Error('纽约联储日历的月份不匹配')
  const events: MarketEvent[] = []
  // The calendar marks its weekday cells with somatdR and prints Eastern time after each release title.
  for (const [, day, cell] of html.matchAll(/<td\b[^>]*\bclass="[^"]*\bsomatdR\b[^"]*"[^>]*>\s*<div\b[^>]*>\s*(\d{1,2})\b([\s\S]*?)<\/td>/gi)) {
    const match = />\s*Consumer Price Index\s*<\/a>\s*<br\s*\/?>\s*\((\d{2}):(\d{2})\)/i.exec(cell)
    if (!match) continue
    const date = `${year}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`
    const at = sourceTime(`${date} ${match[1]}:${match[2]}:00`, 'America/New_York')
    if (at) events.push({ title: '美国消费者价格指数（CPI）', at, url: nyFedMonthUrl(year, month), source: 'nyfed', kind: 'scheduled' })
  }
  return events
}

export async function fetchFeed(fetcher: typeof fetch, url: string, signal: AbortSignal): Promise<string> {
  const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) })
  if (!response.ok || !response.body) throw new Error('资讯源暂不可用')
  let bytes = 0
  let text = ''
  const decoder = new TextDecoder()
  for await (const chunk of response.body) {
    bytes += chunk.byteLength
    if (bytes > MAX_FEED_BYTES) throw new Error('资讯源响应超过大小限制')
    text += decoder.decode(chunk, { stream: true })
  }
  return text + decoder.decode()
}

export class MarketEventFeed {
  private pending?: Promise<MarketEventsResult>
  private cached?: { value: MarketEventsResult; expires: number }
  private lastCpi?: { event: MarketEvent; checkedAt: number }

  constructor(private signal: AbortSignal, private fetcher: typeof fetch = fetch, private now = Date.now) {}

  load(): Promise<MarketEventsResult> {
    if (this.cached && this.now() < this.cached.expires) return Promise.resolve(this.cached.value)
    return this.pending ??= this.refresh().finally(() => { this.pending = undefined })
  }

  private async cpiSchedule(): Promise<MarketEvent[]> {
    try {
      return parseCpiSchedule(await fetchFeed(this.fetcher, BLS_FEED, this.signal))
    } catch (blsError) {
      if (this.signal.aborted) throw blsError
      const now = this.now()
      const { year, month } = zonedParts(now, 'America/New_York')
      const signal = AbortSignal.any([this.signal, AbortSignal.timeout(6_000)])
      const current = await fetchFeed(this.fetcher, nyFedMonthUrl(year, month), signal)
      const currentEvents = parseNyFedCpi(current, year, month)
      if (currentEvents.some(event => Date.parse(event.at) > this.now())) return currentEvents
      const following = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 }
      const html = await fetchFeed(this.fetcher, nyFedMonthUrl(following.year, following.month), signal)
      const events = parseNyFedCpi(html, following.year, following.month)
      if (!events.some(event => Date.parse(event.at) > this.now())) throw blsError
      return events
    }
  }

  private async refresh(): Promise<MarketEventsResult> {
    const [fed, bls] = await Promise.allSettled([
      fetchFeed(this.fetcher, FED_FEED, this.signal).then(parseFedAnnouncements),
      this.cpiSchedule(),
    ])
    const now = this.now()
    const unavailable: MarketEventSource[] = []
    if (fed.status === 'rejected') unavailable.push('fed')
    if (bls.status === 'rejected') unavailable.push('bls')
    let next: MarketEvent | undefined
    if (bls.status === 'fulfilled') {
      next = bls.value.filter(e => Date.parse(e.at) > now).sort(ascending)[0]
      this.lastCpi = next ? { event: next, checkedAt: now } : undefined
    } else if (this.lastCpi && now - this.lastCpi.checkedAt < DAY_MS && Date.parse(this.lastCpi.event.at) > now) {
      next = { ...this.lastCpi.event, cachedUntil: this.lastCpi.checkedAt + DAY_MS }
    }
    const recent = fed.status === 'fulfilled' ? fed.value.filter(e => {
      const age = now - Date.parse(e.at)
      return age >= 0 && age <= 45 * DAY_MS
    }).sort((a, b) => ascending(b, a)).slice(0, next ? 4 : 5) : []
    const value = { events: next ? [next, ...recent] : recent, unavailable }
    const nextRelease = next ? Date.parse(next.at) : Infinity
    this.cached = { value, expires: Math.min(now + (unavailable.length ? 60_000 : 900_000), nextRelease, next?.cachedUntil ?? Infinity) }
    return value
  }
}

function ascending(a: MarketEvent, b: MarketEvent): number { return a.at.localeCompare(b.at) }
