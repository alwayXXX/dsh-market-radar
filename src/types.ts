export type Market = 'gold' | 'cn' | 'us'
export type QuoteStatus = 'live' | 'closed' | 'delayed' | 'error' | 'unknown'
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
  points: PricePoint[]
  previousClose: number | null
  source: string
  coverage: 'provider' | 'sampled'
  updatedAt: string
  error?: string
}
export interface AlertRule {
  id: string
  instrumentId: string
  kind: 'above' | 'below' | 'move'
  value: number
  enabled: boolean
  cooldownMinutes: number
}
export interface AlertEvent { id: string; ruleId: string; instrumentId: string; text: string; at: string }
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
  updatedAt: string
  errors?: Record<string, string>
  storageError?: string
}
export interface RadarApi {
  snapshot(): Promise<RadarSnapshot>
  save(config: RadarConfig): Promise<RadarSnapshot>
  resolve(market: Market, symbol: string): Promise<Instrument>
  series(instrumentId: string): Promise<PriceSeries>
  refresh(): Promise<RadarSnapshot>
  visibility(clientId: string, open: boolean): Promise<void>
}
