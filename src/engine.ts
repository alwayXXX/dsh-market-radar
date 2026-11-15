import { AlertEngine } from './alerts.ts'
import { defaultConfig, instrumentFor, validateConfig } from './config.ts'
import { quoteStatus } from './market-time.ts'
import { PublicMarketProvider, sampledSeries, sanitizePoints, type MarketProvider } from './providers.ts'
import type { ConfigStore } from './storage.ts'
import type { ChartRange, Market, PricePoint, PriceSeries, RadarConfig, RadarSnapshot } from './types.ts'

export class RadarEngine {
  private state: RadarSnapshot = { config: defaultConfig(), quotes: {}, alerts: [], errors: {}, updatedAt: new Date(0).toISOString() }
  private alertEngine = new AlertEngine()
  private samples = new Map<string, PricePoint[]>()
  private history = new Map<string, { series: PriceSeries; at: number }>()
  private clients = new Map<string, number>()
  private failures = new Map<Market, { count: number; next: number }>()
  private timer?: ReturnType<typeof setTimeout>
  private controller = new AbortController()
  private inFlight?: Promise<RadarSnapshot>
  private mutation: Promise<unknown> = Promise.resolve()
  private disposed = false
  private readonly ready: Promise<void>
  constructor(private store: ConfigStore, private provider: MarketProvider = new PublicMarketProvider(), private now: () => number = Date.now) {
    this.ready = store.load().then(({ config, error }) => { this.state.config = config; if (error) this.state.storageError = error })
  }
  async start(): Promise<void> { await this.ready; if (!this.disposed) { await this.refresh(); this.schedule() } }
  private interval(): number {
    const now = this.now()
    for (const [id, at] of this.clients) if (now - at > 30_000) this.clients.delete(id)
    return this.clients.size || this.state.config.alerts.some(a => a.enabled) ? 15_000 : 60_000
  }
  private schedule(): void {
    if (this.disposed) return
    clearTimeout(this.timer)
    this.timer = setTimeout(async () => { try { await this.refresh() } finally { this.schedule() } }, this.interval())
    this.timer.unref?.()
  }
  async visibility(clientId: string, open: boolean): Promise<void> {
    if (!/^[\w-]{1,80}$/.test(clientId)) throw new Error('无效的客户端标识')
    const wasOpen = this.clients.has(clientId)
    if (open) this.clients.set(clientId, this.now()); else this.clients.delete(clientId)
    if (wasOpen !== open) this.schedule()
  }
  async snapshot(): Promise<RadarSnapshot> {
    await this.ready
    const copy = structuredClone(this.state)
    for (const q of Object.values(copy.quotes)) if (q.status !== 'error') q.status = quoteStatus(q.instrument, q.asOf, this.now())
    return copy
  }
  async save(raw: RadarConfig): Promise<RadarSnapshot> {
    const run = this.mutation.then(async () => {
      await this.ready
      const next = validateConfig(raw)
      if (next.revision !== this.state.config.revision) throw new Error('配置已在其他窗口更新，请刷新后重试')
      next.revision++
      await this.store.save(next)
      if (this.disposed) throw new Error('插件已停用')
      const ids = new Set(next.instruments.map(i => i.id))
      this.state.config = next
      delete this.state.storageError
      this.state.quotes = Object.fromEntries(Object.entries(this.state.quotes).filter(([id]) => ids.has(id)))
      this.state.errors = Object.fromEntries(Object.entries(this.state.errors ?? {}).filter(([id]) => ids.has(id)))
      for (const id of this.samples.keys()) if (!ids.has(id)) this.samples.delete(id)
      for (const [key, value] of this.history) if (!ids.has(value.series.instrumentId)) this.history.delete(key)
      if (next.hidden) this.state.alerts = []
      this.schedule()
      return this.snapshot()
    })
    this.mutation = run.catch(() => {})
    return run
  }
  async resolve(market: Market, symbol: string) {
    const i = instrumentFor(market, symbol)
    const [q] = await this.provider.quotes([i], this.controller.signal)
    if (!q) throw new Error('未找到该标的，请核对市场和代码')
    return q.instrument
  }
  async refresh(force = false): Promise<RadarSnapshot> {
    await this.ready
    if (this.disposed) return this.snapshot()
    if (this.inFlight) return this.inFlight
    this.inFlight = this.fetchQuotes(force).finally(() => { this.inFlight = undefined })
    return this.inFlight
  }
  private async fetchQuotes(force: boolean): Promise<RadarSnapshot> {
    const instruments = [...this.state.config.instruments]
    await Promise.allSettled((['gold', 'cn', 'us'] as const).map(async market => {
      const group = instruments.filter(i => i.market === market)
      if (!group.length || (!force && (this.failures.get(market)?.next ?? 0) > this.now())) return
      try {
        const quotes = await this.provider.quotes(group, this.controller.signal)
        if (this.disposed) return
        const current = new Set(this.state.config.instruments.map(i => i.id))
        const received = new Set(quotes.map(q => q.instrument.id))
        for (const q of quotes) {
          if (!current.has(q.instrument.id)) continue
          this.state.quotes[q.instrument.id] = q
          delete this.state.errors?.[q.instrument.id]
          if (q.status === 'live' && q.asOf) {
            const time = Date.parse(q.asOf)
            const old = this.samples.get(q.instrument.id) ?? []
            const cutoff = this.now() - 36 * 60 * 60_000
            this.samples.set(q.instrument.id, sanitizePoints([...old.filter(p => p.time >= cutoff), { time, price: q.price }]))
          }
        }
        for (const i of group) if (current.has(i.id) && !received.has(i.id)) this.markError(i.id, '该标的暂无有效报价')
        if (!quotes.length) throw new Error('行情源未返回有效报价')
        this.failures.delete(market)
      } catch (e) {
        if (this.disposed) return
        const count = Math.min((this.failures.get(market)?.count ?? 0) + 1, 5)
        this.failures.set(market, { count, next: this.now() + Math.min(15_000 * 2 ** count, 300_000) })
        for (const i of group) this.markError(i.id, e instanceof Error ? e.message : '连接失败')
      }
    }))
    if (!this.disposed) {
      const quotes = (await this.snapshot()).quotes
      const events = this.alertEngine.evaluate(this.state.config.alerts, quotes, this.now(), this.state.config.hidden)
      this.state.alerts = this.state.config.hidden ? [] : [...events, ...this.state.alerts].slice(0, 30)
      this.state.updatedAt = new Date(this.now()).toISOString()
    }
    return this.snapshot()
  }
  private markError(id: string, error: string) {
    if (!this.state.config.instruments.some(i => i.id === id)) return
    this.state.errors ??= {}
    this.state.errors[id] = error.slice(0, 150)
    const q = this.state.quotes[id]
    if (q) this.state.quotes[id] = { ...q, status: 'error', error: error.slice(0, 150) }
  }
  async series(id: string, range: ChartRange = '1d'): Promise<PriceSeries> {
    await this.ready
    if (!['1d', '5d', '1m', '6m', 'ytd', '1y', '5y', 'max'].includes(range)) throw new Error('不支持该走势时间范围')
    const i = this.state.config.instruments.find(i => i.id === id)
    if (!i) throw new Error('标的不在自选中')
    const key = `${id}|${range}`
    const cached = this.history.get(key)
    if (cached && this.now() - cached.at < (range === '1d' || range === '5d' ? 60_000 : 600_000)) return structuredClone(cached.series)
    const fallback = sampledSeries(i, this.samples.get(id) ?? [], this.state.quotes[id])
    try {
      let series: PriceSeries
      if (range === '1d') {
        const points = await this.provider.series(i, this.controller.signal)
        series = points.length ? { ...fallback, points, coverage: 'provider', granularity: 'minute', source: this.state.quotes[id]?.source ?? (i.market === 'gold' ? '新浪财经' : '腾讯财经') } : fallback
      } else {
        if (!this.provider.history) throw new Error('数据源暂不支持该时间范围')
        const data = await this.provider.history(i, range, this.controller.signal)
        series = { ...fallback, range, points: data.points, previousClose: null, coverage: 'provider', source: data.source, granularity: data.granularity, note: data.note, ...(!data.points.length ? { error: '该时间范围暂无可用数据' } : {}) }
      }
      if (!this.disposed && this.state.config.instruments.some(item => item.id === id)) this.history.set(key, { at: this.now(), series })
      return series
    } catch (error) {
      if (range === '1d') return { ...fallback, error: '历史走势暂不可用，显示已采样区间' }
      return { ...fallback, range, points: [], previousClose: null, coverage: 'provider', granularity: 'daily', error: error instanceof Error ? `走势暂不可用：${error.message}` : '历史走势暂不可用' }
    }
  }
  dispose(): void {
    this.disposed = true
    this.controller.abort()
    clearTimeout(this.timer)
    this.clients.clear(); this.samples.clear(); this.history.clear(); this.alertEngine.reset()
  }
}
