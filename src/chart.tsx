import { useMemo, useState } from 'react'
import type { Instrument, PriceSeries } from './types.ts'
import { formatPrice } from './snapshot.ts'
export function PriceChart({ series, instrument }: { series: PriceSeries; instrument: Instrument }) {
  const [hover, setHover] = useState<number | null>(null)
  const points = series.points
  const geometry = useMemo(() => {
    if (!points.length) return null
    const values = points.map(p => p.price)
    if (series.previousClose !== null) values.push(series.previousClose)
    const low = Math.min(...values), high = Math.max(...values)
    const padding = Math.max((high - low) * 0.15, high * 0.0005, 0.01)
    const min = low - padding, max = high + padding
    const begin = points[0].time, end = Math.max(points.at(-1)!.time, begin + 60_000)
    const x = (time: number) => 12 + (time - begin) / (end - begin) * 596
    const y = (price: number) => 14 + (max - price) / (max - min) * 170
    const path = points.map((p, index) => `${index === 0 || p.breakBefore ? 'M' : 'L'}${x(p.time).toFixed(2)},${y(p.price).toFixed(2)}`).join(' ')
    return { min, max, x, y, path }
  }, [points, series.previousClose])
  if (!points.length || !geometry) return <div className="mr-chart-empty">暂无走势数据<span>{series.error ?? (series.coverage === 'sampled' ? '行情更新后会记录有效采样。' : '此时间范围没有可用历史数据。')}</span></div>
  const index = Math.min(hover ?? points.length - 1, points.length - 1)
  const point = points[index]
  const zone = instrument.market === 'us' ? 'America/New_York' : 'Asia/Shanghai'
  const readingTime = (stamp: number) => new Intl.DateTimeFormat('zh-CN', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', ...(series.granularity === 'daily' ? {} : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' as const }) }).format(stamp)
  const axisTime = (stamp: number) => new Intl.DateTimeFormat('zh-CN', { timeZone: zone, ...(series.range === '1d' ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' as const } : { ...(['1y', '5y', 'max'].includes(series.range) ? { year: 'numeric' as const } : {}), month: '2-digit', day: '2-digit' }) }).format(stamp)
  const begin = points[0].time, end = points.at(-1)!.time
  const ticks = begin === end ? [begin] : [0, 0.25, 0.5, 0.75, 1].map(fraction => begin + (end - begin) * fraction)
  return <div className="mr-chart">
    <div className="mr-chart-reading"><span>{readingTime(point.time)}</span><strong>{formatPrice(point.price)}</strong><span>{instrument.currency}/{instrument.unit}</span></div>
    <svg viewBox="0 0 620 205" role="img" tabIndex={0} aria-label={`${instrument.name}价格走势，左右方向键查看数据点`} onKeyDown={e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      e.preventDefault(); setHover(Math.max(0, Math.min(points.length - 1, index + (e.key === 'ArrowLeft' ? -1 : 1))))
    }} onMouseLeave={() => setHover(null)} onMouseMove={e => {
      const box = e.currentTarget.getBoundingClientRect()
      const ratio = Math.max(0, Math.min(1, ((e.clientX - box.left) / box.width * 620 - 12) / 596))
      const target = points[0].time + ratio * (points.at(-1)!.time - points[0].time)
      let lo = 0, hi = points.length - 1
      while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (points[mid].time < target) lo = mid + 1; else hi = mid }
      const best = lo > 0 && Math.abs(points[lo - 1].time - target) < Math.abs(points[lo].time - target) ? lo - 1 : lo
      setHover(best)
    }}>
      {[0, 1, 2, 3].map(n => <line key={n} x1="12" x2="608" y1={14 + n * 170 / 3} y2={14 + n * 170 / 3} className="mr-chart-grid"/>)}
      {series.previousClose !== null && <line x1="12" x2="608" y1={geometry.y(series.previousClose)} y2={geometry.y(series.previousClose)} className="mr-chart-close"/>}
      <path d={geometry.path} className="mr-chart-line"/>
      {points.length === 1 && <circle cx={geometry.x(points[0].time)} cy={geometry.y(points[0].price)} r="3" className="mr-chart-dot"/>}
      {hover !== null && <><line x1={geometry.x(point.time)} x2={geometry.x(point.time)} y1="10" y2="188" className="mr-chart-cursor"/><circle cx={geometry.x(point.time)} cy={geometry.y(point.price)} r="4" className="mr-chart-dot"/></>}
    </svg>
    <div className="mr-chart-axis">{ticks.map((stamp, n) => <span key={n}>{axisTime(stamp)}</span>)}</div>
    <p className="mr-chart-caption">{series.source} · {series.coverage === 'sampled' ? '运行期间采样 · 非完整交易日' : series.note ?? '源站分时数据'}<br/>实际覆盖 {readingTime(begin)} — {readingTime(end)}{series.previousClose !== null && ` · 虚线为昨收 ${formatPrice(series.previousClose)}`}</p>
    {series.error && <p className="mr-muted">{series.error}</p>}
  </div>
}
