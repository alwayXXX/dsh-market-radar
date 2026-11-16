import type { Quote } from './types.ts'
export const STATUS_LABEL = { live: '最新报价', closed: '常规休市时段', delayed: '报价已延迟', error: '连接失败', unknown: '状态未知' }
export function quoteTooltip(name: string, quote?: Quote, error?: string): string {
  if (!quote) return `${name} · ${error ? '连接失败' : '等待报价'}`
  const zone = quote.instrument.market === 'us' ? 'America/New_York' : 'Asia/Shanghai'
  const stamp = quote.asOf ? Date.parse(quote.asOf) : NaN
  const asOf = Number.isFinite(stamp) ? new Intl.DateTimeFormat('zh-CN', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(stamp) : '未知'
  return `${name} · ${STATUS_LABEL[quote.status]}\n来源：${quote.source}\n源站时间：${asOf}${Number.isFinite(stamp) ? (zone === 'America/New_York' ? '（纽约时间）' : '（北京时间）') : ''}`
}
export function snapshotText(quotes: Quote[]): string {
  const rows = quotes.map(q => [
    `- ${q.instrument.name}（${q.instrument.symbol}，${q.instrument.market === 'gold' ? '黄金' : q.instrument.market === 'cn' ? 'A股' : '美股'}）`,
    `  价格：${q.price} ${q.instrument.currency}/${q.instrument.unit}；涨跌幅：${q.changePercent === null ? '未知' : `${q.changePercent >= 0 ? '+' : ''}${q.changePercent.toFixed(2)}%`}`,
    `  来源：${q.source}；源站时间：${q.asOf ?? '未知'}；获取时间：${q.receivedAt}；状态：${STATUS_LABEL[q.status]}`,
  ].join('\n'))
  return `【行情快照】\n${rows.join('\n')}\n\n请基于以上快照说明价格与涨跌表现，并区分已知信息和缺失信息。解释变化原因所需的新闻或宏观信息请另行核实。`
}
export function formatPrice(price: number | undefined): string { return price === undefined ? '—' : price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) }
export function formatPercent(value: number | null | undefined): string { return value == null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%` }
