export type Market = 'gold' | 'cn' | 'us'
export type QuoteStatus = 'live' | 'closed' | 'delayed' | 'error' | 'unknown'
export type ChartRange = '1d' | '5d' | '1m' | '6m' | 'ytd' | '1y' | '5y' | 'max'
export type SeriesGranularity = 'minute' | 'five-minute' | 'daily' | 'sampled'
export interface Instrument {
  id: string
  market: Market
  symbol: string
  name: string
  currency: 'CNY' | 'USD'
  unit: '克' | '盎司' | '股' | '份' | '点'
}
export interface Quote {
  instrument: Instrument
  price: number
  previousClose: number | null
  change: number | null
  changePercent: number | null
  source: string
  asOf: string | null
  receivedAt: string
  status: QuoteStatus
  error?: string
}
export interface PricePoint { time: number; price: number; breakBefore?: boolean }
export interface PriceSeries {
  instrumentId: string
  range: ChartRange
  points: PricePoint[]
  previousClose: number | null
  source: string
  coverage: 'provider' | 'sampled'
  granularity: SeriesGranularity
  note?: string
  updatedAt: string
  error?: string
}
export type MarketEventSource = 'fed' | 'bls' | 'nyfed'
export interface MarketEvent {
  title: string
  at: string
  url: string
  source: MarketEventSource
  kind: 'published' | 'scheduled'
  cachedUntil?: number
}
export interface MarketEventsResult {
  events: MarketEvent[]
  unavailable: MarketEventSource[]
}
export interface MarketEventPreview {
  summary: string
  outlook: string
  impacts?: MarketImpacts
  model?: string
  coverage?: string
}
export interface MarketImpacts {
  gold: MarketImpact
  usStocks: MarketImpact
}
export interface MarketImpact {
  direction: 'positive' | 'negative' | 'mixed' | 'uncertain'
  reason: string
}
export type EconomicIndicatorId = 'payroll' | 'cpi'
export interface EconomicIndicator {
  id: EconomicIndicatorId
  period: string
  value: number | null
  previous: number | null
  history: { period: string; value: number | null }[]
  fetchedAt: string
}
export interface EconomicIndicatorsResult {
  indicators: EconomicIndicator[]
  unavailable: EconomicIndicatorId[]
}
export type AlertKind = 'above' | 'below' | 'move' | 'move_up' | 'move_down'
export interface AlertRule {
  id: string
  instrumentId: string
  kind: AlertKind
  value: number
  enabled: boolean
  cooldownMinutes: number
}
export interface AlertEvent { id: string; ruleId: string; instrumentId: string; text: string; at: string; read?: boolean }
export interface RadarConfig {
  version: 1
  revision: number
  instruments: Instrument[]
  pinned: string[]
  alerts: AlertRule[]
  hidden: boolean
  colorMode: 'red-up' | 'green-up'
}
export interface RadarSnapshot {
  config: RadarConfig
  quotes: Record<string, Quote>
  alerts: AlertEvent[]
  alertsRevision?: number
  alertsEpoch?: string
  updatedAt: string
  errors?: Record<string, string>
  storageError?: string
}
export interface RadarApi {
  snapshot(): Promise<RadarSnapshot>
  save(config: RadarConfig): Promise<RadarSnapshot>
  resolve(market: Market, symbol: string): Promise<Instrument>
  candidates(symbol: string): Promise<Instrument[]>
  acknowledgeAlerts(ids: string[]): Promise<RadarSnapshot>
  series(instrumentId: string, range?: ChartRange): Promise<PriceSeries>
  marketEvents(): Promise<MarketEventsResult>
  marketEventPreview(url: string): Promise<MarketEventPreview>
  economicIndicators(): Promise<EconomicIndicatorsResult>
  economicIndicatorPreview(id: EconomicIndicatorId, fetchedAt: string): Promise<MarketEventPreview>
  refresh(): Promise<RadarSnapshot>
  visibility(clientId: string, open: boolean): Promise<void>
}
