import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fedMinutesLink, fetchFeed, MarketEventFeed, parseCpiSchedule, parseFedAnnouncements, parseFedArticle, parseFedMinutes, parseNbsReleases } from '../src/market-events.ts'
import { MarketEventPreviewer, type EventLlm } from '../src/market-event-preview.ts'

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

const nbsLink = 'https://www.stats.gov.cn/sj/zxfb/202611/t20261116_1965844.html'
const nbsShortLink = 'https://www.stats.gov.cn/sj/zxfb/202611/t20261115_1965800.html'
const nbsBody = '国家统计局发布：10月份国民经济运行总体平稳，工业生产、消费和就业保持增长。'.repeat(8)
const nbsItem = (link = nbsLink, title = '10月份国民经济运行总体平稳、向新向优', content = nbsBody, time = '2026-11-16 10:00:05') =>
  `<item><title><![CDATA[${title}]]></title><link>${link}</link><pubTime>${time}</pubTime><content><![CDATA[${content}]]></content></item>`
const nbsXml = (...items: string[]) => `<rss version="2.0"><channel><title>数据发布</title>${items.join('')}</channel></rss>`

test('Fed RSS renders plain titles, official press links and marks AI-capable events', () => {
  const items = parseFedAnnouncements(rss(announcement, announcement, announcement.replace(fedLink, 'https://www.federalreserve.gov.example.com/newsevents/pressreleases/monetary.htm')))
  assert.deepEqual(items, [{ title: 'Policy & schedule – update', at: '2026-11-12T17:45:00.000Z', url: fedLink, source: 'fed', kind: 'published', preview: 'ai' }])
  assert.throws(() => parseFedAnnouncements('<html>Rate limited</html>'))
})

test('NBS RSS keeps recent Chinese releases, uses Beijing time and marks unreadable bodies as original-only', () => {
  const parsed = parseNbsReleases(nbsXml(
    nbsItem(),
    nbsItem(nbsShortLink, '测试短讯', '短讯', '2026-11-15 10:00:00'),
    nbsItem(),
    nbsItem('https://example.com/sj/zxfb/202611/t20261113_1965600.html'),
    nbsItem('https://www.stats.gov.cn/sj/zxfb/202611/bad.html'),
    nbsItem('https://www.stats.gov.cn/sj/zxfb/202611/t20261114_1965700.html', '坏日期', nbsBody, '2026-02-30 10:00:00'),
  ))
  assert.deepEqual(parsed.events.map(item => [item.title, item.at, item.source, item.kind, item.preview]), [
    ['10月份国民经济运行总体平稳、向新向优', '2026-11-16T02:00:05.000Z', 'nbs', 'published', 'ai'],
    ['测试短讯', '2026-11-15T02:00:00.000Z', 'nbs', 'published', 'original'],
  ])
  assert.match(parsed.articles.get(nbsLink) ?? '', /国民经济运行总体平稳/)
  const sanitized = parseNbsReleases(nbsXml(nbsItem(nbsLink, '<script>alert(1)</script>A &amp; B\u0000')))
  assert.doesNotMatch(sanitized.events[0].title, /<script|\u0000/)
  assert.match(sanitized.events[0].title, /A & B/)
  assert.throws(() => parseNbsReleases('<html>blocked</html>'), /无效/)
})

test('BLS calendar selects CPI, unfolds lines and converts both Eastern offsets', () => {
  assert.deepEqual(parseCpiSchedule(cpi).map(item => [item.at, item.kind, item.preview]), [
    ['2026-07-14T12:30:00.000Z', 'scheduled', 'schedule'],
    ['2026-12-10T13:30:00.000Z', 'scheduled', 'schedule'],
    ['2027-01-14T13:30:00.000Z', 'scheduled', 'schedule'],
  ])
})

test('feed URLs enforce HTTPS, host, path, credential and port allowlists without network access', async () => {
  const blocked = [
    'not a url',
    'http://www.stats.gov.cn/sj/zxfb/rss.xml',
    'https://www.stats.gov.cn.evil.com/sj/zxfb/rss.xml',
    'https://user:pass@www.stats.gov.cn/sj/zxfb/rss.xml',
    'https://www.stats.gov.cn:8443/sj/zxfb/rss.xml',
    'https://127.0.0.1/sj/zxfb/rss.xml',
    'https://www.stats.gov.cn/admin',
    'https://www.stats.gov.cn/sj/zxfb/rss.xml?x=1',
    'https://www.stats.gov.cn/sj/zxfb/rss.xml#x',
    'https://www.bls.gov@evil.example/schedule/news_release/bls.ics',
  ]
  let calls = 0
  const fetcher: typeof fetch = async () => { calls++; return new Response('ok') }
  const signal = new AbortController().signal
  for (const url of blocked) await assert.rejects(fetchFeed(fetcher, url, signal), /允许列表|无效/)
  assert.equal(calls, 0)
  assert.equal(await fetchFeed(fetcher, 'https://www.stats.gov.cn/sj/zxfb/rss.xml', signal), 'ok')
  const options: RequestInit[] = []
  await fetchFeed(async (_url, init) => { options.push(init as RequestInit); return new Response('ok') }, nbsLink, signal)
  assert.equal(options[0]?.redirect, 'error')
  await assert.rejects(fetchFeed(async () => new Response('x'.repeat(2048)), nbsLink, signal, 1024), /大小限制/)
})

test('NBS feed accepts multi-megabyte official RSS but rejects responses over its bounded limit', async () => {
  const now = () => Date.parse('2026-11-18T00:00:00Z')
  const rssWithPadding = (size: number) => nbsXml(nbsItem(), `<!-- ${'x'.repeat(size)} -->`)
  const large = new MarketEventFeed(new AbortController().signal, async () => new Response(rssWithPadding(2_000_000)), now)
  assert.equal((await large.load('cn')).events[0]?.url, nbsLink)
  const oversized = new MarketEventFeed(new AbortController().signal, async () => new Response(rssWithPadding(8 * 1024 * 1024)), now)
  const result = await oversized.load('cn')
  assert.deepEqual(result.unavailable, ['nbs'])
  assert.equal(result.events.length, 0)
})

test('event previews use the official article, deduplicate model requests and reject unknown URLs', async () => {
  let articleCalls = 0
  let modelCalls = 0
  let system = ''
  const paragraph = 'The Committee decided to maintain the target range for the federal funds rate at 3 to 4 percent.'
  const html = `<div id="article"><div class="heading col-xs-12 col-sm-8 col-md-8"><p>Header</p></div><div class="col-xs-12 col-sm-4 col-md-4 hidden-sm"></div><div class="col-xs-12 col-sm-8 col-md-8"><p>${paragraph}</p><p><!-- ignored --><script>unsafe()</script>Economic activity continues to expand and inflation remains elevated in the latest readings.</p></div><div class="col-xs-12 col-sm-4 col-md-4"></div></div>`
  assert.match(parseFedArticle(html), /maintain the target range/)
  assert.doesNotMatch(parseFedArticle(html), /unsafe/)
  assert.throws(() => parseFedArticle('<html>blocked</html>'), /正文/)
  const fetcher: typeof fetch = async url => {
    if (String(url) === fedLink) { articleCalls++; return new Response(html) }
    if (String(url).includes('federalreserve.gov')) return new Response(rss(announcement))
    return new Response(cpi)
  }
  const feed = new MarketEventFeed(new AbortController().signal, fetcher, () => Date.parse('2026-11-18T00:00:00Z'))
  const previewer = new MarketEventPreviewer(feed, new AbortController().signal, fetcher)
  const model: EventLlm = {
    listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }],
    listModels: async () => [{ id: 'example', name: 'Example' }],
    async *stream(options) {
      modelCalls++
      system = options.system
      assert.match(options.messages[0].content[0].text, /maintain the target range/)
      yield { type: 'text-delta', text: '{"summary":"维持利率区间。","outlook":"黄金方向尚不明确。","impacts":{"gold":{"direction":"uncertain","reason":"缺少预期差。"},"usStocks":{"direction":"mixed","reason":"取决于预期。"}}}' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  previewer.setLlm(model)
  const [first, second] = await Promise.all([previewer.preview('us', fedLink), previewer.preview('us', fedLink)])
  assert.deepEqual(first, second)
  assert.match(first.summary, /维持/)
  assert.equal(first.impacts?.gold.direction, 'uncertain')
  assert.equal(first.impacts?.usStocks?.direction, 'mixed')
  assert.equal(first.impacts?.cnStocks, undefined)
  assert.match(system, /整体美股/)
  assert.match(system, /usStocks/)
  assert.equal(articleCalls, 1)
  assert.equal(modelCalls, 1)
  await assert.rejects(previewer.preview('us', 'https://example.com/'), /事件已更新/)
  assert.equal(articleCalls, 1)
  const schedule = await previewer.preview('us', 'https://www.bls.gov/schedule/news_release/cpi.htm')
  assert.match(schedule.summary, /尚未公布/)
  assert.equal(schedule.impacts, undefined)
  assert.equal(modelCalls, 1)
})

test('CN previews use the NBS RSS body, label A-shares and never call the Fed article parser', async () => {
  let statsCalls = 0
  let otherCalls = 0
  let modelCalls = 0
  let system = ''
  const fetcher: typeof fetch = async url => {
    if (String(url).includes('stats.gov.cn')) { statsCalls++; return new Response(nbsXml(nbsItem(), nbsItem(nbsShortLink, '测试短讯', '短讯', '2026-11-15 10:00:00'))) }
    otherCalls++
    return new Response('unexpected source', { status: 503 })
  }
  const feed = new MarketEventFeed(new AbortController().signal, fetcher, () => Date.parse('2026-11-18T00:00:00Z'))
  const previewer = new MarketEventPreviewer(feed, new AbortController().signal, fetcher)
  previewer.setLlm({
    listProviders: () => [{ id: 'test', name: 'Test' }],
    listModels: async () => [{ id: 'model', name: 'Model' }],
    async *stream(options) {
      modelCalls++
      system = options.system
      assert.match(options.messages[0].content[0].text, /国家统计局原文/)
      assert.match(options.messages[0].content[0].text, /中国 A 股/)
      assert.match(system, /A 股/)
      assert.match(system, /cnStocks/)
      assert.doesNotMatch(system, /美股/)
      yield { type: 'text-delta', text: '{"summary":"数据发布。","outlook":"关注内需与政策。","impacts":{"gold":{"direction":"uncertain","reason":"缺少预期差。"},"cnStocks":{"direction":"mixed","reason":"结构分化。"}}}' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  })
  const [first, second] = await Promise.all([previewer.preview('cn', nbsLink), previewer.preview('cn', nbsLink)])
  assert.deepEqual(first, second)
  assert.equal(first.impacts?.cnStocks?.direction, 'mixed')
  assert.equal(first.impacts?.usStocks, undefined)
  assert.match(first.coverage ?? '', /国家统计局/)
  assert.equal(statsCalls, 1)
  assert.equal(otherCalls, 0)
  assert.equal(modelCalls, 1)
  await assert.rejects(previewer.preview('cn', nbsShortLink), /暂不支持 AI 摘要/)
  assert.equal(modelCalls, 1)
  await assert.rejects(previewer.preview('us', nbsLink), /来源暂不可用|事件已更新/)
})

test('CN previews reject a US-stock impact instead of relabeling it as an A-share judgment', async () => {
  const fetcher: typeof fetch = async url => String(url).includes('stats.gov.cn')
    ? new Response(nbsXml(nbsItem()))
    : new Response('unexpected source', { status: 503 })
  const feed = new MarketEventFeed(new AbortController().signal, fetcher, () => Date.parse('2026-11-18T00:00:00Z'))
  const previewer = new MarketEventPreviewer(feed, new AbortController().signal, fetcher)
  previewer.setLlm({
    listProviders: () => [{ id: 'test', name: 'Test' }],
    listModels: async () => [{ id: 'model', name: 'Model' }],
    async *stream() {
      yield { type: 'text-delta', text: '{"summary":"数据发布。","outlook":"关注政策。","impacts":{"gold":{"direction":"uncertain","reason":"缺少预期差。"},"usStocks":{"direction":"mixed","reason":"美国市场判断。"}}}' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  })
  await assert.rejects(previewer.preview('cn', nbsLink), /生成失败/)
})

test('economic previews use the supplied official observations, deduplicate requests and reject missing values', async () => {
  const previewer = new MarketEventPreviewer(new MarketEventFeed(new AbortController().signal), new AbortController().signal)
  let calls = 0
  let system = ''
  previewer.setLlm({
    listProviders: () => [{ id: 'test', name: 'Test' }], listModels: async () => [{ id: 'model', name: 'Model' }],
    async *stream(options) {
      calls++
      system = options.system
      assert.match(options.messages[0].content[0].text, /最新月份：2026-10/)
      assert.match(options.messages[0].content[0].text, /最新值：16\.50/)
      assert.match(options.messages[0].content[0].text, /没有提供市场预期/)
      yield { type: 'text-delta', text: '{"summary":"非农增加16.5万人。","outlook":"关注预期差。","impacts":{"gold":{"direction":"uncertain","reason":"预期缺失。"},"usStocks":{"direction":"uncertain","reason":"预期缺失。"}}}' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  })
  const indicator = { id: 'payroll' as const, period: '2026-10', value: 16.5, previous: 6, history: [{ period: '2026-10', value: 16.5 }], fetchedAt: '2026-11-23T00:00:00Z' }
  const [first, second] = await Promise.all([previewer.previewIndicator(indicator), previewer.previewIndicator(indicator)])
  assert.deepEqual(first, second)
  assert.equal(first.impacts?.gold.direction, 'uncertain')
  assert.equal(first.impacts?.usStocks?.direction, 'uncertain')
  assert.match(first.coverage!, /不含市场预期/)
  assert.match(system, /整体美股/)
  assert.equal(calls, 1)
  await assert.rejects(previewer.previewIndicator({ ...indicator, value: null }), /数据不足/)
  assert.equal(calls, 1)
})

test('previews reject invalid impact directions instead of presenting unvalidated judgments', async () => {
  const previewer = new MarketEventPreviewer(new MarketEventFeed(new AbortController().signal), new AbortController().signal)
  previewer.setLlm({ listProviders: () => [{ id: 'test', name: 'Test' }], listModels: async () => [{ id: 'test', name: 'Test' }], async *stream() {
    yield { type: 'text-delta', text: '{"summary":"数据","outlook":"关注","impacts":{"gold":{"direction":"guaranteed","reason":"理由"},"usStocks":{"direction":"uncertain","reason":"理由"}}}' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } })
  await assert.rejects(previewer.previewIndicator({ id: 'cpi', period: '2026-10', value: 3, previous: null, history: [], fetchedAt: '2026-11-23T00:00:00Z' }), /生成失败/)
})

test('event previews report unavailable models and reject malformed model results', async () => {
  const html = '<div id="article"><div class="col-xs-12 col-sm-8 col-md-8"><p>The Committee decided to maintain the target range for the federal funds rate at 3 to 4 percent.</p></div><div class="col-xs-12 col-sm-4 col-md-4"></div>'
  const fetcher: typeof fetch = async url => String(url) === fedLink ? new Response(html) : String(url).includes('federalreserve.gov') ? new Response(rss(announcement)) : new Response(cpi)
  const feed = new MarketEventFeed(new AbortController().signal, fetcher, () => Date.parse('2026-11-18T00:00:00Z'))
  const previewer = new MarketEventPreviewer(feed, new AbortController().signal, fetcher)
  await assert.rejects(previewer.preview('us', fedLink), /模型服务/)
  previewer.setLlm({ listProviders: () => [{ id: 'test', name: 'Test' }], listModels: async () => [{ id: 'test', name: 'Test' }], async *stream() { yield { type: 'text-delta', text: 'invalid' }; yield { type: 'finish', reason: { kind: 'stop' } } } })
  await assert.rejects(previewer.preview('us', fedLink), /摘要生成失败/)
})

test('meeting minute links stay on the official site and preserve both ends of long documents', () => {
  const announcement = '<div id="article"><a href="/monetarypolicy/fomcminutes20261028.htm">HTML</a></div><div id="lastUpdate">'
  assert.equal(fedMinutesLink(announcement), 'https://www.federalreserve.gov/monetarypolicy/fomcminutes20261028.htm')
  assert.equal(fedMinutesLink(announcement.replace('/monetarypolicy/', 'https://other.example/monetarypolicy/')), null)
  const paragraph = 'A discussion of economic conditions and policy considerations continued among participants. '
  const minutes = `<div id="article"><p>START ${paragraph.repeat(300)} END</p></div><div id="lastUpdate">`
  const result = parseFedMinutes(minutes)
  assert.match(result, /^START/)
  assert.match(result, /END$/)
  assert.match(result, /中间内容已省略/)
})

test('US market events load on demand, share requests and keep a healthy source on partial failure', async () => {
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
  const first = feed.load('us')
  assert.equal(feed.load('us'), first)
  const partial = await first
  assert.deepEqual(partial.events.map(item => item.source), ['fed'])
  assert.deepEqual(partial.unavailable, ['bls'])
  assert.equal(await feed.load('us'), partial)
  assert.equal(calls, 2)
  blsReady = true
  time += 60_000
  const recovered = await feed.load('us')
  assert.deepEqual(recovered.events.map(item => [item.source, item.at]), [['bls', '2026-12-10T13:30:00.000Z'], ['fed', '2026-11-12T17:45:00.000Z']])
  assert.deepEqual(recovered.unavailable, [])
  assert.equal(calls, 4)

  time = Date.parse('2026-12-10T13:30:00.000Z')
  const afterRelease = await feed.load('us')
  assert.equal(afterRelease.events[0]?.at, '2027-01-14T13:30:00.000Z')
  assert.equal(calls, 6)
})

test('CN source failures are isolated from US events and stale Chinese events are not served', async () => {
  const now = Date.parse('2026-11-18T00:00:00Z')
  let time = now
  let cnCalls = 0
  let cnOk = true
  let usCalls = 0
  const fetcher: typeof fetch = async url => {
    const target = String(url)
    if (target.includes('stats.gov.cn')) {
      cnCalls++
      return cnOk ? new Response(nbsXml(nbsItem())) : new Response('busy', { status: 503 })
    }
    usCalls++
    if (target.includes('federalreserve.gov')) return new Response(rss(announcement))
    if (target.includes('newyorkfed.org')) return new Response('Unavailable', { status: 503 })
    return new Response(cpi)
  }
  const feed = new MarketEventFeed(new AbortController().signal, fetcher, () => time)
  const us = await feed.load('us')
  assert.deepEqual(us.unavailable, [])
  assert.ok(us.events.some(item => item.source === 'fed'))

  cnOk = false
  const failed = await feed.load('cn')
  assert.deepEqual(failed, { events: [], unavailable: ['nbs'] })
  assert.equal(cnCalls, 1)
  assert.deepEqual(await feed.load('us'), us)
  assert.ok(usCalls >= 2)

  time += 61_000
  cnOk = true
  const recovered = await feed.load('cn')
  assert.deepEqual(recovered.events.map(item => item.source), ['nbs'])
  assert.deepEqual(recovered.unavailable, [])
  assert.equal(cnCalls, 2)
  assert.deepEqual(await feed.load('cn'), recovered)
  assert.equal(cnCalls, 2)

  time += 15 * 60_000
  cnOk = false
  const stale = await feed.load('cn')
  assert.deepEqual(stale, { events: [], unavailable: ['nbs'] })
  assert.equal(cnCalls, 3)
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
  const result = await feed.load('us')
  assert.deepEqual(calendars, ['/research/calendars/i-nov26.html', '/research/calendars/i-dec26.html'])
  assert.deepEqual(result.unavailable, [])
  assert.deepEqual(result.events.map(e => [e.source, e.at]), [['nyfed', '2026-12-10T13:30:00.000Z'], ['fed', '2026-11-12T17:45:00.000Z']])
  assert.equal(result.events[0].url, 'https://www.newyorkfed.org/research/calendars/i-dec26.html')
})

test('a failed US CPI refresh keeps a checked future date for at most one day and drops elapsed dates', async () => {
  const checkedAt = Date.parse('2026-12-09T23:00:00Z')
  let now = checkedAt
  let available = true
  const fetcher: typeof fetch = async url => {
    if (String(url).includes('federalreserve.gov')) return new Response(rss(announcement))
    if (String(url).includes('newyorkfed.org')) return new Response('Unavailable', { status: 503 })
    return available ? new Response(cpi) : new Response('Access Denied', { status: 403 })
  }
  const feed = new MarketEventFeed(new AbortController().signal, fetcher, () => now)
  const fresh = await feed.load('us')
  assert.equal(fresh.events[0]?.kind, 'scheduled')
  assert.equal(fresh.events[0]?.cachedUntil, undefined)
  available = false
  now += 900_000
  const cached = await feed.load('us')
  assert.equal(cached.events[0]?.at, fresh.events[0]?.at)
  assert.equal(cached.events[0]?.cachedUntil, checkedAt + 86_400_000)
  assert.deepEqual(cached.unavailable, ['bls'])
  now = Date.parse('2026-12-10T13:30:00Z')
  assert.ok((await feed.load('us')).events.every(event => event.kind !== 'scheduled'))

  available = true
  now += 60_000
  const recheckedAt = now
  assert.equal((await feed.load('us')).events[0]?.at, '2027-01-14T13:30:00.000Z')
  available = false
  now = recheckedAt + 86_400_000
  assert.ok((await feed.load('us')).events.every(event => event.kind !== 'scheduled'))
})
