import type { Instrument, QuoteStatus } from './types.ts'
export function zonedParts(time: number, zone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(time)
  return Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]))
}
export function sourceTime(value: string, zone: string): string | null {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})[ T]?(\d{2}):?(\d{2}):?(\d{2})$/.exec(value.trim())
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m.map(Number)
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null
  const target = Date.UTC(y, mo - 1, d, h, mi, s)
  let utc = target
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(utc, zone)
    utc += target - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  }
  const p = zonedParts(utc, zone)
  if (p.year !== y || p.month !== mo || p.day !== d || p.hour !== h || p.minute !== mi || p.second !== s) return null
  return new Date(utc).toISOString()
}
/** Recurring hours only. Weekday holiday/early-close uncertainty is kept visible as delayed. */
export function scheduledClosed(instrument: Instrument, now: number): boolean {
  const zone = instrument.market === 'us' ? 'America/New_York' : 'Asia/Shanghai'
  const p = zonedParts(now, zone)
  const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()
  const minute = p.hour * 60 + p.minute
  if (instrument.market === 'us') return weekday === 0 || weekday === 6 || minute < 570 || minute >= 960
  if (instrument.market === 'cn') return weekday === 0 || weekday === 6 || minute < 570 || (minute >= 690 && minute < 780) || minute >= 900
  if (instrument.symbol === 'XAU') return weekday === 0 || (weekday === 6 && minute >= 360) || (weekday === 1 && minute < 420)
  const day = weekday >= 1 && weekday <= 5 && ((minute >= 540 && minute < 690) || (minute >= 810 && minute < 930))
  const night = weekday >= 1 && weekday <= 5 && minute >= 1200
  const early = weekday >= 2 && weekday <= 6 && minute < 150
  return !(day || night || early)
}
export function quoteStatus(instrument: Instrument, asOf: string | null, now: number): QuoteStatus {
  if (!asOf) return 'unknown'
  const age = now - Date.parse(asOf)
  if (!Number.isFinite(age) || age < -120_000) return 'unknown'
  if (scheduledClosed(instrument, now)) return 'closed'
  return age <= 120_000 ? 'live' : 'delayed'
}
