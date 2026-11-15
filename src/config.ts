import type { Instrument, Market, RadarConfig, AlertRule } from './types.ts'

export const GOLD: Instrument[] = [
  { id: 'gold:XAU', market: 'gold', symbol: 'XAU', name: '国际现货金', currency: 'USD', unit: '盎司' },
  { id: 'gold:AU9999', market: 'gold', symbol: 'AU9999', name: 'Au99.99', currency: 'CNY', unit: '克' },
]
export function instrumentFor(market: Market, raw: string): Instrument {
  if (!['gold', 'cn', 'us'].includes(market)) throw new Error('请选择支持的市场')
  if (typeof raw !== 'string' || raw.length > 40) throw new Error('标的代码格式无效')
  const value = raw.trim()
  if (market === 'gold') {
    const gold = GOLD.find(i => i.symbol === value.toUpperCase())
    if (!gold) throw new Error('黄金支持 XAU 或 AU9999')
    return { ...gold }
  }
  const symbol = market === 'cn' ? value.toLowerCase() : value.toUpperCase()
  if (market === 'cn' && !/^(sh|sz|bj)\d{6}$/.test(symbol)) throw new Error('A 股请填写交易所前缀，例如 sh600519、sz000001')
  if (market === 'us' && !/^[A-Z.][A-Z0-9.-]{0,14}$/.test(symbol)) throw new Error('请填写有效的美股代码，例如 AAPL、VOO、.INX')
  const index = market === 'cn' ? /^(sh000|sz399|bj899)\d{3}$/.test(symbol) : symbol.startsWith('.')
  return { id: `${market}:${symbol}`, market, symbol, name: symbol, currency: market === 'cn' ? 'CNY' : 'USD', unit: index ? '点' : '股' }
}
export function defaultConfig(): RadarConfig {
  const cn = { ...instrumentFor('cn', 'sh000001'), name: '上证指数', unit: '点' as const }
  const us = { ...instrumentFor('us', 'VOO'), name: '标普500 ETF', unit: '份' as const }
  const instruments = [...GOLD.map(i => ({ ...i })), cn, us]
  return { version: 1, revision: 0, instruments, pinned: [GOLD[0].id, cn.id, us.id], alerts: [], hidden: false, colorMode: 'red-up' }
}
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
export function validateConfig(raw: unknown): RadarConfig {
  if (!record(raw) || raw.version !== 1 || !Array.isArray(raw.instruments) || raw.instruments.length > 100) throw new Error('配置格式无效：需要版本 1，最多 100 个自选')
  const instruments: Instrument[] = raw.instruments.map(v => {
    if (!record(v) || typeof v.symbol !== 'string' || typeof v.market !== 'string') throw new Error('自选标的格式无效')
    const base = instrumentFor(v.market as Market, v.symbol)
    if (v.id !== base.id) throw new Error('标的市场与代码不一致')
    if (typeof v.name !== 'string' || !v.name.trim() || v.name.length > 80) throw new Error('标的名称无效')
    return { ...base, name: v.name.trim(), unit: base.market === 'gold' ? base.unit : base.unit === '点' || v.unit === '点' ? '点' : v.unit === '份' ? '份' : '股' }
  })
  const ids = new Set(instruments.map(i => i.id))
  if (ids.size !== instruments.length) throw new Error('配置包含重复标的')
  if (!Array.isArray(raw.pinned) || raw.pinned.length > 3 || raw.pinned.some(v => typeof v !== 'string' || !ids.has(v)) || new Set(raw.pinned).size !== raw.pinned.length) throw new Error('行情条最多固定三个已有标的')
  if (!Array.isArray(raw.alerts) || raw.alerts.length > 200) throw new Error('提醒规则格式无效')
  const alerts: AlertRule[] = raw.alerts.map(v => {
    if (!record(v) || typeof v.id !== 'string' || !/^[\w-]{1,80}$/.test(v.id) || typeof v.instrumentId !== 'string' || !ids.has(v.instrumentId) || !['above', 'below', 'move'].includes(v.kind as string) || typeof v.value !== 'number' || !Number.isFinite(v.value) || v.value <= 0 || typeof v.enabled !== 'boolean' || typeof v.cooldownMinutes !== 'number' || !Number.isInteger(v.cooldownMinutes) || v.cooldownMinutes < 1 || v.cooldownMinutes > 1440) throw new Error('提醒规则无效：阈值须为正数，冷却为 1–1440 分钟')
    return { id: v.id, instrumentId: v.instrumentId, kind: v.kind as AlertRule['kind'], value: v.value, enabled: v.enabled, cooldownMinutes: v.cooldownMinutes }
  })
  if (new Set(alerts.map(a => a.id)).size !== alerts.length) throw new Error('提醒规则 ID 重复')
  if (typeof raw.hidden !== 'boolean' || !['red-up', 'green-up'].includes(raw.colorMode as string)) throw new Error('显示设置无效')
  return { version: 1, revision: Number.isSafeInteger(raw.revision) && Number(raw.revision) >= 0 ? Number(raw.revision) : 0, instruments, pinned: raw.pinned as string[], alerts, hidden: raw.hidden, colorMode: raw.colorMode as RadarConfig['colorMode'] }
}
export function exportConfig(config: RadarConfig): string {
  return JSON.stringify({ ...config, revision: 0 }, null, 2)
}
