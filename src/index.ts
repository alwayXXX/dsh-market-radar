import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { RadarEngine } from './engine.ts'
import { FileConfigStore } from './storage.ts'
import type { EventLlm } from './market-event-preview.ts'
import type { ChartRange, EconomicIndicatorId, Market, RadarConfig } from './types.ts'

export const name = 'dsh-market-radar'
export const inject = ['typertGateway']
export interface Config { dataDir?: string }
export function profileDataDirectory(ctx: Context, override?: string): string {
  if (override) return resolve(override)
  const baseUrl = (ctx.root as Context & { baseUrl?: string }).baseUrl
  if (baseUrl?.startsWith('file:')) return join(fileURLToPath(baseUrl), '.data', 'dsh-market-radar')
  // A stable fallback still separates embedded roots by their configured base URL.
  const key = createHash('sha256').update(baseUrl ?? process.cwd()).digest('hex').slice(0, 16)
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'plugin-data', name, key)
}
export class MarketRadarService extends TypertRemoteService {
  constructor(ctx: Context, readonly engine: RadarEngine) { super(ctx, 'marketRadar') }
  @Remote('snapshot')
  snapshot() { return this.engine.snapshot() }
  @Remote('save')
  save(config: RadarConfig) { return this.engine.save(config) }
  @Remote('resolve')
  resolve(market: Market, symbol: string) { return this.engine.resolve(market, symbol) }
  @Remote('candidates')
  candidates(symbol: string) { return this.engine.candidates(symbol) }
  @Remote('acknowledgeAlerts')
  acknowledgeAlerts(ids: string[]) { return this.engine.acknowledgeAlerts(ids) }
  @Remote('series')
  series(instrumentId: string, range?: ChartRange) {
    if (typeof instrumentId !== 'string' || instrumentId.length > 80) throw new Error('标的代码无效')
    return this.engine.series(instrumentId, range)
  }
  @Remote('marketEvents')
  marketEvents() { return this.engine.marketEvents() }
  @Remote('marketEventPreview')
  marketEventPreview(url: string) { return this.engine.marketEventPreview(url) }
  @Remote('economicIndicators')
  economicIndicators() { return this.engine.economicIndicators() }
  @Remote('economicIndicatorPreview')
  economicIndicatorPreview(id: EconomicIndicatorId, fetchedAt: string) { return this.engine.economicIndicatorPreview(id, fetchedAt) }
  @Remote('refresh')
  refresh() { return this.engine.refresh(true) }
  @Remote('visibility')
  visibility(clientId: string, open: boolean) {
    if (typeof clientId !== 'string' || typeof open !== 'boolean') throw new Error('无效的显示状态')
    return this.engine.visibility(clientId, open)
  }
}
export function apply(ctx: Context, config: Config = {}): void {
  const engine = new RadarEngine(new FileConfigStore(join(profileDataDirectory(ctx, config.dataDir), 'config.json')))
  new MarketRadarService(ctx, engine)
  ctx.inject(['llm'], child => {
    engine.setEventLlm((child as Context & { llm: EventLlm }).llm)
    child.effect(() => () => engine.setEventLlm(undefined), 'market event model availability')
  })
  ctx.effect(() => {
    void engine.start().catch(error => ctx.logger.warn('行情雷达启动失败', error instanceof Error ? error.message : 'unknown'))
    return () => engine.dispose()
  }, 'market-radar polling and requests')
}
