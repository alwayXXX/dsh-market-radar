import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MarketEventFeed, parseCpiSchedule, parseFedAnnouncements } from '../src/market-events.ts'

const fedLink = 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20261112a.htm'
const announcement = `<item><title>Policy &amp; schedule &#x2013; update</title><link><![CDATA[${fedLink}]]></link><pubDate><![CDATA[Thu, 12 Nov 2026 17:45:00 GMT]]></pubDate></item>`
const rss = (...items: string[]) => `<rss version="2.0"><channel>${items.join('')}</channel></rss>`
const event = (...lines: string[]) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n')
const calendar = (...events: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events, 'END:VCALENDAR'].join('\r\n')
const cpi = calendar(
  event('DTSTART;TZID=US-Eastern:20260714T083000', 'SUMMARY:Consumer Price Index'),
  event('DTSTART;TZID=US-Eastern:20261210T083000', 'SUMMARY:Consumer Pri', ' ce Index'),
  event('DTSTART;TZID=US-Eastern:20270113T083000', 'SUMMARY:Consumer Price Index', 'STATUS:CANCELLED'),
  event('DTSTART;TZID=US-Eastern:20270114T083000', 'SUMMARY:Consumer Price Index'),
  event('DTSTART;TZID=US-Eastern:20270115T083000', 'SUMMARY:Producer Price Index'),
)

test('Fed RSS renders plain titles and keeps only unique official press links', () => {
  const items = parseFedAnnouncements(rss(announcement, announcement, announcement.replace(fedLink, 'https://www.federalreserve.gov.example.com/newsevents/pressreleases/monetary.htm')))
  assert.deepEqual(items, [{ title: 'Policy & schedule – update', at: '2026-11-12T17:45:00.000Z', url: fedLink, source: 'fed', kind: 'published' }])
  assert.throws(() => parseFedAnnouncements('<html>Rate limited</html>'))
})

test('BLS calendar selects CPI, unfolds lines and converts both Eastern offsets', () => {
  assert.deepEqual(parseCpiSchedule(cpi).map(item => [item.at, item.kind]), [
    ['2026-07-14T12:30:00.000Z', 'scheduled'],
    ['2026-12-10T13:30:00.000Z', 'scheduled'],
    ['2027-01-14T13:30:00.000Z', 'scheduled'],
  ])
})

test('market events load on demand, share requests and keep a healthy source on partial failure', async () => {
  const now = Date.parse('2026-11-18T00:00:00Z')
  let time = now
  let calls = 0
  let blsReady = false
  const fetcher: typeof fetch = async url => {
    if (String(url).includes('newyorkfed.org')) return new Response('Unavailable', { status: 503 })
    calls++
    if (String(url).includes('federalreserve.gov')) return new Response(rss(announcement))
    return blsReady ? new Response(cpi) : new Response('Access Denied', { status: 403 })
  }
  const feed = new MarketEventFeed(new AbortController().signal, fetcher, () => time)
  assert.equal(calls, 0)
  const first = feed.load()
  assert.equal(feed.load(), first)
  const partial = await first
  assert.deepEqual(partial.events.map(item => item.source), ['fed'])
  assert.deepEqual(partial.unavailable, ['bls'])
  assert.equal(await feed.load(), partial)
  assert.equal(calls, 2)
  blsReady = true
  time += 60_000
  const recovered = await feed.load()
  assert.deepEqual(recovered.events.map(item => [item.source, item.at]), [['bls', '2026-12-10T13:30:00.000Z'], ['fed', '2026-11-12T17:45:00.000Z']])
  assert.deepEqual(recovered.unavailable, [])
  assert.equal(calls, 4)

  time = Date.parse('2026-12-10T13:30:00.000Z')
  const afterRelease = await feed.load()
  assert.equal(afterRelease.events[0]?.at, '2027-01-14T13:30:00.000Z')
  assert.equal(calls, 6)
})

test('BLS 403 falls back to the next upcoming CPI on the official New York Fed calendars', async () => {
  const calendarPage = (month: string, day: number) => `<h3>${month} 2026</h3>
    <td class="somatdR dirColL"><div>${day}<br/><br/><span class="ts-accordion-content">
    <a href="https://www.bls.gov/news.release/cpi.toc.htm">Consumer Price Index</a><br/>(08:30)<br/>
    </span></div></td>`
  const calendars: string[] = []
  const fetcher: typeof fetch = async url => {
    const target = new URL(String(url))
    if (target.hostname === 'www.federalreserve.gov') return new Response(rss(announcement))
    if (target.hostname === 'www.bls.gov') return new Response('Access Denied', { status: 403 })
    calendars.push(target.pathname)
    return new Response(target.pathname.endsWith('i-nov26.html') ? calendarPage('November', 10) : calendarPage('December', 10))
  }
  const feed = new MarketEventFeed(new AbortController().signal, fetcher, () => Date.parse('2026-11-18T00:00:00Z'))
  const result = await feed.load()
  assert.deepEqual(calendars, ['/research/calendars/i-nov26.html', '/research/calendars/i-dec26.html'])
  assert.deepEqual(result.unavailable, [])
  assert.deepEqual(result.events.map(e => [e.source, e.at]), [['nyfed', '2026-12-10T13:30:00.000Z'], ['fed', '2026-11-12T17:45:00.000Z']])
  assert.equal(result.events[0].url, 'https://www.newyorkfed.org/research/calendars/i-dec26.html')
})

test('a failed CPI refresh keeps a checked future date for at most one day and drops elapsed dates', async () => {
  const checkedAt = Date.parse('2026-12-09T23:00:00Z')
  let now = checkedAt
  let available = true
  const fetcher: typeof fetch = async url => {
    if (String(url).includes('federalreserve.gov')) return new Response(rss(announcement))
    if (String(url).includes('newyorkfed.org')) return new Response('Unavailable', { status: 503 })
    return available ? new Response(cpi) : new Response('Access Denied', { status: 403 })
  }
  const feed = new MarketEventFeed(new AbortController().signal, fetcher, () => now)
  const fresh = await feed.load()
  assert.equal(fresh.events[0]?.kind, 'scheduled')
  assert.equal(fresh.events[0]?.cachedUntil, undefined)
  available = false
  now += 900_000
  const cached = await feed.load()
  assert.equal(cached.events[0]?.at, fresh.events[0]?.at)
  assert.equal(cached.events[0]?.cachedUntil, checkedAt + 86_400_000)
  assert.deepEqual(cached.unavailable, ['bls'])
  now = Date.parse('2026-12-10T13:30:00Z')
  assert.ok((await feed.load()).events.every(event => event.kind !== 'scheduled'))

  available = true
  now += 60_000
  const recheckedAt = now
  assert.equal((await feed.load()).events[0]?.at, '2027-01-14T13:30:00.000Z')
  available = false
  now = recheckedAt + 86_400_000
  assert.ok((await feed.load()).events.every(event => event.kind !== 'scheduled'))
})
