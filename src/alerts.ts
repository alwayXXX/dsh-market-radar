import type { AlertEvent, AlertRule, Quote } from './types.ts'
interface RuleState { fingerprint: string; inside: boolean; lastAt: number; lastQuote: number }
export class AlertEngine {
  private state = new Map<string, RuleState>()
  reset(): void { this.state.clear() }
  evaluate(rules: AlertRule[], quotes: Record<string, Quote>, now: number, hidden: boolean): AlertEvent[] {
    const active = new Set(rules.filter(r => r.enabled).map(r => r.id))
    for (const id of this.state.keys()) if (!active.has(id)) this.state.delete(id)
    const events: AlertEvent[] = []
    for (const rule of rules) {
      if (!rule.enabled) continue
      const q = quotes[rule.instrumentId]
      const old = this.state.get(rule.id)
      if (!q || q.status !== 'live' || !q.asOf || now - Date.parse(q.asOf) > 120_000 || now - Date.parse(q.asOf) < -120_000) {
        if (old) old.lastQuote = 0
        continue
      }
      const value = rule.kind === 'move' ? Math.abs(q.changePercent ?? NaN) : q.price
      if (!Number.isFinite(value)) { if (old) old.lastQuote = 0; continue }
      const inside = rule.kind === 'below' ? value <= rule.value : value >= rule.value
      const stamp = Date.parse(q.asOf)
      const fingerprint = `${rule.instrumentId}:${rule.kind}:${rule.value}:${rule.cooldownMinutes}`
      if (!old || old.fingerprint !== fingerprint || now - old.lastQuote > 180_000 || stamp < old.lastQuote) {
        this.state.set(rule.id, { fingerprint, inside, lastAt: old?.lastAt ?? 0, lastQuote: stamp })
        continue
      }
      if (stamp === old.lastQuote) continue
      if (inside && !old.inside && now - old.lastAt >= rule.cooldownMinutes * 60_000 && !hidden) {
        old.lastAt = now
        const condition = rule.kind === 'above' ? `高于 ${rule.value}` : rule.kind === 'below' ? `低于 ${rule.value}` : `当日涨跌幅达到 ${rule.value}%`
        events.push({ id: `${rule.id}-${now}`, ruleId: rule.id, instrumentId: rule.instrumentId, text: `${q.instrument.name} ${condition} · 当前 ${q.price} ${q.instrument.currency}`, at: new Date(now).toISOString() })
      }
      old.inside = inside
      old.lastQuote = stamp
    }
    return events
  }
}
