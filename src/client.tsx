import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react'
import { RadarController } from './controller.ts'
import { exportConfig, GOLD, validateConfig } from './config.ts'
import { PriceChart } from './chart.tsx'
import { insertSnapshot } from './draft.ts'
import { formatPercent, formatPrice, quoteTooltip, snapshotText, STATUS_LABEL } from './snapshot.ts'
import type { InputActions, ClientContext } from './host-types.ts'
import type { AlertKind, ChartRange, EconomicIndicator, EconomicIndicatorsResult, Instrument, Market, MarketEvent, MarketEventPreview, MarketEventsResult, PriceSeries, Quote, RadarApi, RadarConfig } from './types.ts'
import styles from './styles.css'

export const name = 'dsh-market-radar-client'
export const inject = ['slots', 'connection', 'shortcuts']
const MARKET_LABEL = { gold: '黄金', cn: 'A 股', us: '美股' }
function Icon({ name = 'radar', size = 16 }: { name?: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    radar: <><path d="M3 17 8 11l4 3 8-10"/><path d="M3 4v16h18"/></>,
    close: <path d="m6 6 12 12M6 18 18 6"/>, plus: <path d="M12 5v14M5 12h14"/>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 11-2l3 3M4 16l3 3a7 7 0 0 0 11-2"/></>,
    hide: <><path d="m3 3 18 18M10 5c6-1 10 7 10 7a17 17 0 0 1-3 4M6 6a17 17 0 0 0-4 6s4 8 10 7a10 10 0 0 0 3-1"/><path d="M9 9a4 4 0 0 0 6 6"/></>,
    bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9ZM10 21h4"/></>,
    settings: <><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/></>,
    pin: <><path d="m8 3 8 0-1 5 4 5H5l4-5-1-5ZM12 13v8"/></>,
    back: <path d="m14 5-7 7 7 7"/>, up: <path d="m6 14 6-6 6 6"/>, down: <path d="m6 10 6 6 6-6"/>,
    trash: <><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></>,
    chat: <path d="M4 4h16v12H9l-5 4V4Z"/>, arrow: <path d="m9 5 7 7-7 7"/>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></>,
    upload: <><path d="M12 15V3m-5 5 5-5 5 5M4 16v5h16v-5"/></>,
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.radar}</svg>
}
function useRadar(radar: RadarController) { return useSyncExternalStore(radar.subscribe, radar.getSnapshot, radar.getSnapshot) }
function IconButton({ icon, label, onClick, disabled, active }: { icon: string; label: string; onClick: () => void; disabled?: boolean; active?: boolean }) {
  return <button type="button" className={`mr-icon-button ${active ? 'mr-active' : ''}`} aria-label={label} title={label} disabled={disabled} onClick={onClick}><Icon name={icon}/></button>
}
function Change({ quote }: { quote?: Quote }) { return <span className={`mr-change ${(quote?.changePercent ?? 0) >= 0 ? 'mr-up' : 'mr-down'}`}>{formatPercent(quote?.changePercent)}</span> }

function BottomBar({ radar }: { radar: RadarController }) {
  const state = useRadar(radar)
  useEffect(() => { radar.patch({ bottomMounted: true }); return () => { radar.patch({ bottomMounted: false }) } }, [radar])
  if (radar.hidden) return null
  const { config, quotes } = state.snapshot
  const unread = state.snapshot.alerts.filter(alert => !alert.read).length
  return <div className="mr-root mr-bar" data-market-radar="" data-colors={config.colorMode}>
    <button className="mr-brand-button" onClick={() => radar.setOpen(!state.open)} title="打开行情雷达"><Icon size={14}/><span>行情雷达</span></button>
    <div className="mr-tickers">
      {config.pinned.map(id => {
        const i = config.instruments.find(i => i.id === id)
        if (!i) return null
        const original = quotes[id]
        const q = original && !state.connected ? { ...original, status: 'error' as const } : original
        return <button className="mr-ticker" key={id} onClick={() => { window.dispatchEvent(new CustomEvent('market-radar-select', { detail: id })); radar.setOpen(true) }} title={quoteTooltip(i.name, q, state.connected ? state.snapshot.errors?.[id] : '连接失败')}>
          <span className="mr-ticker-name">{i.market === 'gold' ? i.symbol : i.name}</span><strong>{formatPrice(q?.price)}</strong><Change quote={q}/>{(!state.connected || state.snapshot.errors?.[id] || (q && q.status !== 'live')) && <span className="mr-stale-dot" aria-label={!state.connected || state.snapshot.errors?.[id] ? '连接失败' : STATUS_LABEL[q!.status]}/>}
        </button>
      })}
      {!config.pinned.length && <button className="mr-ticker" onClick={() => radar.setOpen(true)}>添加重点自选</button>}
    </div>
    <span className={`mr-connection-dot ${state.connected ? 'mr-online' : ''}`} title={state.connected ? '行情服务已连接' : '正在连接行情服务'}/>
    {unread > 0 && <button className="mr-alert-count" title="查看未读提醒" aria-label={`${unread} 条未读提醒`} onClick={() => { window.dispatchEvent(new Event('market-radar-alerts')); radar.setOpen(true) }}><Icon name="bell" size={12}/>{unread}</button>}
    <button className="mr-bar-hide" title="隐藏行情并静音（Ctrl/⌘+Shift+F9 恢复）" aria-label="隐藏行情并静音" onClick={() => { void radar.toggleHidden() }}><Icon name="hide" size={13}/></button>
  </div>
}
function AddInstrument({ radar, done }: { radar: RadarController; done: () => void }) {
  const state = useRadar(radar)
  const [market, setMarket] = useState<Market>('cn')
  const [symbol, setSymbol] = useState('')
  const [candidates, setCandidates] = useState<Instrument[]>([])
  const query = useRef(0)
  const [finding, setFinding] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => () => { query.current++ }, [])
  async function find(e: FormEvent) {
    e.preventDefault(); setError(''); setCandidates([]); setFinding(true)
    const current = ++query.current
    try {
      const results = market === 'cn' && /^\d{6}$/.test(symbol.trim()) ? await radar.api.candidates(symbol.trim()) : [await radar.api.resolve(market, symbol)]
      if (query.current === current) { setCandidates(results); if (!results.length) setError('未找到标的，请输入带交易所前缀的代码重试') }
    }
    catch (e) { if (query.current === current) setError(e instanceof Error ? e.message : '查询失败') }
    finally { if (query.current === current) setFinding(false) }
  }
  return <section className="mr-section"><h3>添加自选</h3><p className="mr-muted">核对市场与标的名称后，加入你的自选。</p>
    <form onSubmit={e => { void find(e) }}>
      <label>市场<select value={market} onChange={e => { query.current++; setFinding(false); setMarket(e.target.value as Market); setCandidates([]); setSymbol(''); setError('') }}>{Object.entries(MARKET_LABEL).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>代码{market === 'gold' ? <select value={symbol} onChange={e => { query.current++; setFinding(false); setSymbol(e.target.value); setCandidates([]); setError('') }}><option value="">请选择黄金报价</option>{GOLD.map(i => <option key={i.id} value={i.symbol}>{i.name} · {i.symbol}</option>)}</select> : <input autoFocus value={symbol} placeholder={market === 'cn' ? '600519 / sh600519 / 000001' : 'AAPL / VOO / QQQM / .INX'} maxLength={20} onChange={e => { query.current++; setFinding(false); setSymbol(e.target.value); setCandidates([]); setError('') }}/>}</label>
      {market === 'cn' && <p className="mr-muted">六位代码可查询候选；上证指数与平安银行均为 000001，请核对交易所。</p>}
      <button className="mr-button mr-primary" disabled={!symbol.trim() || finding || !state.connected}>{finding ? '正在查找…' : '查找标的'}</button>
    </form>
    {error && <p className="mr-error" role="alert">{error}</p>}
    {candidates.map(candidate => <div className="mr-candidate" key={candidate.id}><div><strong>{candidate.name}</strong><span>{MARKET_LABEL[candidate.market]} · {candidate.symbol} · {candidate.currency}/{candidate.unit}</span></div><button className="mr-button mr-primary" disabled={state.busy || state.snapshot.config.instruments.some(i => i.id === candidate.id)} onClick={() => {
      void radar.save(c => { if (c.instruments.some(i => i.id === candidate.id)) throw new Error('该标的已在自选中'); c.instruments.push(candidate); if (c.pinned.length < 3) c.pinned.push(candidate.id) }).then(() => { done(); void radar.refresh() }).catch(() => {})
    }}>{state.snapshot.config.instruments.some(i => i.id === candidate.id) ? '已在自选' : '确认添加'}</button></div>)}
  </section>
}
function Rules({ radar, instrumentId }: { radar: RadarController; instrumentId?: string }) {
  const state = useRadar(radar)
  const config = state.snapshot.config
  const [id, setId] = useState(instrumentId ?? config.instruments[0]?.id ?? '')
  const [kind, setKind] = useState<AlertKind>('above')
  const [value, setValue] = useState('')
  const [cooldown, setCooldown] = useState('15')
  const [error, setError] = useState('')
  const rules = config.alerts.filter(a => !instrumentId || a.instrumentId === instrumentId)
  return <section className="mr-section"><h3>提醒规则</h3><p className="mr-muted">以最新有效报价判断；先建立基线，再在穿越阈值时提醒。隐藏模式下静音。</p>
    <form onSubmit={e => {
      e.preventDefault(); setError('')
      if (!Number.isFinite(Number(value)) || Number(value) <= 0 || !Number.isInteger(Number(cooldown)) || Number(cooldown) < 1 || Number(cooldown) > 1440) { setError('请输入正数阈值及 1–1440 分钟冷却时间'); return }
      void radar.save(c => c.alerts.push({ id: crypto.randomUUID(), instrumentId: id, kind, value: Number(value), cooldownMinutes: Number(cooldown), enabled: true })).then(() => setValue('')).catch(() => {})
    }}>
      <label>标的<select value={id} onChange={e => setId(e.target.value)}>{config.instruments.map(i => <option key={i.id} value={i.id}>{i.name} · {i.symbol}</option>)}</select></label>
      <div className="mr-form-row"><label>条件<select value={kind} onChange={e => setKind(e.target.value as AlertKind)}><option value="above">价格高于或等于</option><option value="below">价格低于或等于</option><option value="move_up">当日涨幅达到</option><option value="move_down">当日跌幅达到</option><option value="move">当日涨跌幅绝对值达到</option></select></label><label>阈值{kind.startsWith('move') ? '（%）' : ''}<input type="number" min="0" step="any" value={value} onChange={e => setValue(e.target.value)} placeholder={kind.startsWith('move') ? '3' : '目标价格'} required/></label></div>
      {kind.startsWith('move') && <p className="mr-muted">请输入正数；例如 3 表示{kind === 'move_up' ? '上涨 +3%' : kind === 'move_down' ? '下跌 -3%' : '上涨 +3% 或下跌 -3%'}。</p>}
      <label>冷却时间（分钟）<input type="number" min="1" max="1440" value={cooldown} onChange={e => setCooldown(e.target.value)} required/></label>
      <button className="mr-button mr-primary" disabled={state.busy || !id || !value || !state.connected}>添加提醒</button>
    </form>
    {error && <p className="mr-error">{error}</p>}
    <div className="mr-rule-list">{rules.map(rule => <div className="mr-rule" key={rule.id}><label className="mr-switch"><input type="checkbox" checked={rule.enabled} disabled={state.busy} onChange={e => { const enabled = e.target.checked; void radar.save(c => { c.alerts.find(a => a.id === rule.id)!.enabled = enabled }).catch(() => {}) }}/><span><strong>{config.instruments.find(i => i.id === rule.instrumentId)?.name}</strong><small>{rule.kind === 'above' ? '价格 ≥' : rule.kind === 'below' ? '价格 ≤' : rule.kind === 'move_up' ? '当日涨幅 ≥' : rule.kind === 'move_down' ? '当日跌幅 ≥' : '|当日涨跌幅| ≥'} {rule.value}{rule.kind.startsWith('move') ? '%' : ''} · 冷却 {rule.cooldownMinutes} 分钟</small></span></label><IconButton icon="trash" label="删除提醒" disabled={state.busy} onClick={() => { void radar.save(c => { c.alerts = c.alerts.filter(a => a.id !== rule.id) }).catch(() => {}) }}/></div>)}{!rules.length && <p className="mr-empty-small">尚未设置提醒</p>}</div>
    {!instrumentId && state.snapshot.alerts.length > 0 && <><h3 className="mr-spaced">最近提醒</h3>{state.snapshot.alerts.some(a => !a.read) && <button className="mr-button" onClick={() => { void radar.acknowledgeAlerts(state.snapshot.alerts.filter(a => !a.read).map(a => a.id)) }}>标记已读</button>}{state.snapshot.alerts.map(a => <div className="mr-alert-item" key={a.id}><span>{!a.read && '未读 · '}{a.text}</span><small>{new Date(a.at).toLocaleTimeString('zh-CN', { hour12: false })}</small></div>)}</>}
  </section>
}
function Settings({ radar }: { radar: RadarController }) {
  const state = useRadar(radar)
  const [pending, setPending] = useState<RadarConfig | null>(null)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  return <section className="mr-section"><h3>显示与备份</h3>
    <label>涨跌颜色<select value={state.snapshot.config.colorMode} disabled={state.busy} onChange={e => { const colorMode = e.target.value as RadarConfig['colorMode']; void radar.save(c => { c.colorMode = colorMode }).catch(() => {}) }}><option value="red-up">红涨绿跌</option><option value="green-up">绿涨红跌</option></select></label>
    <div className="mr-setting-note"><Icon name="hide"/><div><strong>一键隐藏并静音</strong><p>Ctrl / ⌘ + Shift + F9 隐藏或恢复，仅在 DSH 窗口获得焦点时生效。</p></div></div>
    <p className="mr-muted">可在宿主的快捷键设置中查找“行情雷达：隐藏或恢复”并修改绑定；macOS 默认为 Command + Shift + F9。</p>
    <div className="mr-button-row"><button className="mr-button" onClick={() => {
      const url = URL.createObjectURL(new Blob([exportConfig(state.snapshot.config)], { type: 'application/json' }))
      const link = document.createElement('a'); link.href = url; link.download = `dsh-market-radar-${new Date().toISOString().slice(0, 10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
    }}><Icon name="download"/>导出配置</button><button className="mr-button" onClick={() => input.current?.click()}><Icon name="upload"/>导入配置</button></div>
    <input hidden ref={input} type="file" accept=".json,application/json" onChange={e => {
      const file = e.target.files?.[0]; e.target.value = ''; if (!file) return
      setPending(null); setError('')
      if (file.size > 1_000_000) { setError('配置文件过大'); return }
      void file.text().then(text => setPending(validateConfig(JSON.parse(text)))).catch(e => setError(e instanceof Error ? e.message : '无法读取配置文件'))
    }}/>
    {pending && <div className="mr-import-preview"><strong>确认替换当前配置</strong><p>{pending.instruments.length} 个自选 · {pending.alerts.length} 条提醒。保留当前隐藏状态。</p><div className="mr-button-row"><button className="mr-button" onClick={() => setPending(null)}>取消</button><button className="mr-button mr-primary" disabled={state.busy} onClick={() => { void radar.save(c => { Object.assign(c, pending, { revision: c.revision, hidden: c.hidden }) }).then(() => { setPending(null); radar.notify('配置已导入'); void radar.refresh() }).catch(() => {}) }}>确认导入</button></div></div>}
    {error && <p className="mr-error" role="alert">{error}</p>}
    <div className="mr-source-note"><h3>数据与运行</h3><p>股票报价来自腾讯财经，黄金报价来自新浪财经；历史走势还可能来自 Yahoo Finance 或上海黄金交易所，图表下方标明实际来源。免费数据可能存在延迟或暂时不可用。</p><p>监测在 DSH 运行且电脑保持唤醒时进行。自选和提醒保存在本机当前 profile。</p><p>首版使用常规交易时段判断休市，节假日及临时休市可能显示为“报价已延迟”。</p></div>
  </section>
}
const EVENT_SOURCE_LABEL = { fed: '美联储', bls: '美国劳工统计局', nyfed: '纽约联储日历' }
const CPI_CALENDAR_FALLBACK = 'https://www.newyorkfed.org/research/calendars/nationalecon_cal'
const EVENT_TIME = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})
function scheduleExpiresAt(event: MarketEvent): number { return Math.min(Date.parse(event.at), event.cachedUntil ?? Infinity) }

const IMPACT_LABEL = { positive: '可能利好', negative: '可能利空', mixed: '影响分化', uncertain: '无法判断' }
function AnalysisPreview({ value, title }: { value: MarketEventPreview; title: string }) {
  return <div className="mr-event-preview"><div><strong>{title}</strong><p>{value.summary}</p></div><div><strong>市场关注</strong><p>{value.outlook}</p></div>
    {value.impacts && <div><strong>AI 影响判断</strong><div className="mr-impact-list">{([['黄金', value.impacts.gold], ['美股', value.impacts.usStocks]] as const).map(([name, impact]) => <div key={name}><span className="mr-impact-tag">{name} · {IMPACT_LABEL[impact.direction]}</span><p>{impact.reason}</p></div>)}</div></div>}
    <div className="mr-event-preview-footer"><span>{value.model ? `AI 生成 · ${value.model} · ${value.coverage}` : '日程说明'}</span></div>
    {value.model && <p className="mr-ai-warning" role="note">AI 生成，仅供参考，可能有误；市场受多种因素影响，请核实原始信息并谨慎操作，不构成投资建议。</p>}
  </div>
}

function MarketEventCard({ event, preview }: { event: MarketEvent; preview: RadarApi['marketEventPreview'] }) {
  const [value, setValue] = useState<MarketEventPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  async function openPreview() {
    if (loading) return
    if (value) { setValue(null); return }
    setLoading(true); setError('')
    try { const result = await preview(event.url); if (mounted.current) setValue(result) }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : '预览暂不可用') }
    finally { if (mounted.current) setLoading(false) }
  }
  return <li><span className="mr-event-meta">{event.kind === 'scheduled' ? '计划发布' : '已发布'}{event.cachedUntil !== undefined && '（缓存）'} · {EVENT_SOURCE_LABEL[event.source]} · <time dateTime={event.at}>{EVENT_TIME.format(new Date(event.at))}</time></span>
    <button className="mr-event-title" type="button" aria-expanded={!!value} onClick={() => { void openPreview() }}>{event.title}<Icon name="arrow" size={13}/></button>
    {loading && <p className="mr-event-status" role="status">正在生成预览…</p>}
    {error && <p className="mr-event-status" role="alert">{error} <button className="mr-text-button" onClick={() => { void openPreview() }}>重试</button></p>}
    {value && <AnalysisPreview value={value} title="事件摘要"/>}
    <a href={event.url} target="_blank" rel="noopener noreferrer">查看原文 ↗</a>
  </li>
}

function MarketEventList({ load, preview }: { load: RadarApi['marketEvents']; preview: RadarApi['marketEventPreview'] }) {
  const [result, setResult] = useState<MarketEventsResult | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const withoutElapsedSchedule = (value: MarketEventsResult, now: number): MarketEventsResult => ({
      ...value, events: value.events.filter(event => event.kind !== 'scheduled' || scheduleExpiresAt(event) > now),
    })
    async function update() {
      try {
        const value = await load()
        if (!active) return
        const now = Date.now()
        const current = withoutElapsedSchedule(value, now)
        setResult(current)
        const next = current.events.find(event => event.kind === 'scheduled')
        if (!next) return
        // Browsers can only schedule a timeout up to about 24.8 days away.
        const delay = Math.min(scheduleExpiresAt(next) - now, 2_147_483_647)
        timer = setTimeout(() => {
          setResult(previous => previous && withoutElapsedSchedule(previous, Date.now()))
          void update()
        }, delay)
      } catch {
        if (active) setFailed(true)
      }
    }
    void update()
    return () => { active = false; clearTimeout(timer) }
  }, [load])

  if (failed) return <p className="mr-event-status" role="status">暂时无法读取市场事件</p>
  if (!result) return <p className="mr-event-status" role="status">正在读取市场事件…</p>
  const { events, unavailable } = result
  return <div className="mr-event-content">
    {!!events.length && <><p className="mr-event-time-zone">北京时间 · 点击已发布事件时使用 DSH 模型生成摘要</p><ul>{events.map(event => <MarketEventCard key={`${event.at}:${event.url}`} event={event} preview={preview}/>)}</ul></>}
    {!!unavailable.length && <p className="mr-event-status"><span role="status">{unavailable.map(source => EVENT_SOURCE_LABEL[source]).join('、')}暂时无法读取</span>
      {unavailable.includes('bls') && <> · <a href={CPI_CALENDAR_FALLBACK} target="_blank" rel="noopener noreferrer">查看纽约联储日历</a></>}
    </p>}
    {!events.length && !unavailable.length && <p className="mr-event-status" role="status">暂无可显示的市场事件</p>}
  </div>
}

function MarketEventsDisclosure({ load, preview }: { load: RadarApi['marketEvents']; preview: RadarApi['marketEventPreview'] }) {
  const [expanded, setExpanded] = useState(false)
  return <details className="mr-market-events" onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>市场事件<Icon name="arrow" size={13}/></summary>
    {expanded && <MarketEventList load={load} preview={preview}/>}
  </details>
}

const ECONOMIC_LABEL = { payroll: '美国非农就业变化', cpi: '美国 CPI 同比' }
function EconomicCard({ indicator, preview }: { indicator: EconomicIndicator; preview: RadarApi['economicIndicatorPreview'] }) {
  const [analysis, setAnalysis] = useState<MarketEventPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  async function toggleAnalysis() {
    if (loading) return
    if (analysis) { setAnalysis(null); return }
    setLoading(true); setError('')
    try { const value = await preview(indicator.id, indicator.fetchedAt); if (mounted.current) setAnalysis(value) }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : '解读暂不可用') }
    finally { if (mounted.current) setLoading(false) }
  }
  const unit = indicator.id === 'payroll' ? '万人' : '%'
  const number = (value: number | null) => value === null ? '暂无' : `${value > 0 ? '+' : ''}${value.toFixed(1)}`
  const max = Math.max(1, ...indicator.history.map(point => Math.abs(point.value ?? 0)))
  const source = indicator.id === 'payroll' ? 'https://www.bls.gov/ces/' : 'https://www.bls.gov/cpi/'
  return <article className={`mr-economic-card${analysis ? ' mr-economic-card-expanded' : ''}`}>
    <div className="mr-economic-heading"><strong>{ECONOMIC_LABEL[indicator.id]}</strong><span>{indicator.period}</span></div>
    <div className="mr-economic-body"><div><strong className="mr-economic-value">{number(indicator.value)}</strong>{indicator.value !== null && <span className="mr-economic-unit">{unit}</span>}<p>前值 {number(indicator.previous)}{indicator.previous !== null && unit}</p></div>
      <div className="mr-economic-chart" role="img" aria-label={`最近八个月：${indicator.history.map(point => `${point.period} ${number(point.value)}${point.value === null ? '' : unit}`).join('，')}`}>
        {indicator.history.map(point => <span className="mr-economic-column" key={point.period} title={`${point.period} ${number(point.value)}${point.value === null ? '' : unit}`}>
          {point.value !== null && <i style={{ height: `${Math.max(2, Math.abs(point.value) / max * 19)}px`, bottom: point.value >= 0 ? '50%' : undefined, top: point.value < 0 ? '50%' : undefined }}/>}</span>)}
      </div>
    </div>
    <p className="mr-economic-note">{indicator.id === 'payroll' ? '季调后月度变化，前值可能修订' : '未季调指数计算，同比基期缺失时显示暂无'}</p>
    <a href={source} target="_blank" rel="noopener noreferrer">美国劳工统计局 ↗</a>
    <button className="mr-text-button mr-economic-analysis" type="button" disabled={indicator.value === null || loading} aria-expanded={!!analysis} onClick={() => { void toggleAnalysis() }}>{loading ? '正在生成 AI 解读…' : analysis ? '收起 AI 解读' : '生成 AI 解读'}</button>
    {indicator.value === null && <p className="mr-economic-note">当前数据不足，暂无法生成判断。</p>}
    {error && <p className="mr-error" role="alert">{error} <button className="mr-text-button" onClick={() => { void toggleAnalysis() }}>重试</button></p>}
    {analysis && <AnalysisPreview value={analysis} title="数据摘要"/>}
  </article>
}

function EconomicIndicators({ load, preview }: { load: RadarApi['economicIndicators']; preview: RadarApi['economicIndicatorPreview'] }) {
  const [expanded, setExpanded] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<EconomicIndicatorsResult | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!expanded) return
    let active = true
    setResult(null); setFailed(false)
    void load().then(value => { if (active) setResult(value) }).catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [expanded, load, attempt])
  return <details className="mr-economics" onToggle={event => setExpanded(event.currentTarget.open)}><summary>经济数据<Icon name="arrow" size={13}/></summary>
    {expanded && <div className="mr-economics-content">
      <p className="mr-economic-note">点击生成后将数据发送给 DSH 可用模型，可能产生模型用量。</p>
      {!result && !failed && <p className="mr-muted" role="status">正在读取经济数据…</p>}
      {result && <div className="mr-economic-grid">{result.indicators.map(indicator => <EconomicCard key={`${indicator.id}:${indicator.fetchedAt}`} indicator={indicator} preview={preview}/>)}</div>}
      {(failed || !!result?.unavailable.length) && <p className="mr-muted" role="status">{failed ? '经济数据暂时不可用' : `${result!.unavailable.map(id => ECONOMIC_LABEL[id]).join('、')}暂时不可用`} <button className="mr-text-button" onClick={() => setAttempt(value => value + 1)}>重试</button></p>}
      {result?.indicators[0] && <p className="mr-economic-updated">数据获取于 {EVENT_TIME.format(new Date(result.indicators[0].fetchedAt))}（北京时间）</p>}
    </div>}
  </details>
}

function SnapshotPreview({ radar, preview, onClose }: { radar: RadarController; preview: string; onClose: () => void }) {
  const state = useRadar(radar)
  return <div className="mr-snapshot-preview"><h4>放入对话前预览</h4><pre>{preview}</pre><p className="mr-muted">加入草稿后由你发送，已有文字和附件会保留。</p><div className="mr-button-row"><button className="mr-button" onClick={onClose}>取消</button><button className="mr-button mr-primary" disabled={!state.draftReady} onClick={() => {
    if (radar.insertDraft(preview)) { onClose(); radar.notify('已放入当前对话草稿') }
    else radar.patch({ error: '当前对话暂不能编辑，请返回对话后重试。' })
  }}>放入对话</button></div>{!state.draftReady && <p className="mr-muted">请先打开一个可编辑的 DSH 对话。</p>}</div>
}

function InstrumentDetail({ radar, instrument, onBack, onRules }: { radar: RadarController; instrument: Instrument; onBack: () => void; onRules: () => void }) {
  const state = useRadar(radar)
  const [series, setSeries] = useState<PriceSeries | null>(null)
  const [range, setRange] = useState<ChartRange>('1d')
  const [error, setError] = useState('')
  const [preview, setPreview] = useState('')
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    setSeries(null); setError('')
    async function update() {
      try { const value = await radar.api.series(instrument.id, range); if (!stopped) { setSeries(value); setError('') } }
      catch (e) { if (!stopped) setError(e instanceof Error ? e.message : '走势暂不可用') }
      if (!stopped) timer = setTimeout(() => { void update() }, range === '1d' ? 30_000 : range === '5d' ? 60_000 : 600_000)
    }
    void update()
    return () => { stopped = true; clearTimeout(timer) }
  }, [radar, instrument.id, range])
  const quote = state.snapshot.quotes[instrument.id]
  const displayInstrument = quote?.instrument ?? instrument
  return <section className="mr-detail"><button className="mr-text-button mr-back" onClick={onBack}><Icon name="back"/>返回自选</button>
    <div className="mr-detail-heading"><div><span className={`mr-market-tag mr-tag-${instrument.market}`}>{MARKET_LABEL[instrument.market]}</span><h3>{displayInstrument.name}</h3><p>{displayInstrument.symbol} · {displayInstrument.currency}/{displayInstrument.unit}</p></div><IconButton icon="bell" label="设置此标的提醒" onClick={onRules}/></div>
    <div className="mr-detail-price"><strong>{formatPrice(quote?.price)}</strong><Change quote={quote}/></div>
    <div className="mr-detail-status"><span className={`mr-status mr-status-${quote?.status ?? 'unknown'}`}>{quote ? STATUS_LABEL[quote.status] : '等待报价'}</span>{quote?.asOf && <span>{new Date(quote.asOf).toLocaleString('zh-CN', { hour12: false })}</span>}</div>
    {state.snapshot.errors?.[instrument.id] && <p className="mr-error">{state.snapshot.errors[instrument.id]}</p>}
    <div className="mr-chart-title"><h4>价格走势</h4><span>{instrument.market === 'us' ? '纽约时间' : '北京时间'}</span></div>
    <div className="mr-chart-ranges" role="group" aria-label="走势时间范围">{([['1d', '1天'], ['5d', '5天'], ['1m', '1月'], ['6m', '半年'], ['ytd', 'YTD'], ['1y', '1年'], ['5y', '5年'], ['max', 'Max']] as const).map(([value, label]) => <button key={value} type="button" title={value === 'ytd' ? '年初至今' : value === 'max' ? '当前接口及请求上限内的历史' : undefined} className={range === value ? 'mr-selected' : ''} aria-pressed={range === value} onClick={() => setRange(value)}>{label}</button>)}</div>
    {series?.instrumentId === instrument.id && series.range === range ? <PriceChart key={`${instrument.id}:${range}`} series={series} instrument={displayInstrument}/> : <div className="mr-chart-empty">{error || '正在读取走势…'}</div>}
    {instrument.market === 'gold' && <MarketEventsDisclosure load={radar.api.marketEvents} preview={radar.api.marketEventPreview}/>}
    <div className="mr-detail-data"><div><span>昨收</span><strong>{formatPrice(quote?.previousClose ?? undefined)}</strong></div><div><span>涨跌额</span><strong>{quote?.change == null ? '—' : `${quote.change >= 0 ? '+' : ''}${formatPrice(quote.change)}`}</strong></div><div><span>来源</span><strong>{quote?.source ?? '—'}</strong></div></div>
    <button className="mr-button mr-primary mr-full" disabled={!quote} onClick={() => { if (quote) setPreview(snapshotText([quote])) }}><Icon name="chat"/>准备行情快照</button>
    {preview && <SnapshotPreview radar={radar} preview={preview} onClose={() => setPreview('')}/>}
  </section>
}
function Dashboard({ radar }: { radar: RadarController }) {
  const state = useRadar(radar)
  const [tab, setTab] = useState<'all' | Market>('all')
  const [page, setPage] = useState<'list' | 'add' | 'rules' | 'settings'>('list')
  const [selected, setSelected] = useState<string | null>(null)
  const [preview, setPreview] = useState('')
  const panel = useRef<HTMLElement>(null)
  const rulesFor = useRef<string | undefined>(undefined)
  useEffect(() => {
    const select = (e: Event) => { setSelected((e as CustomEvent<string>).detail); setPage('list') }
    const alerts = () => { rulesFor.current = undefined; setPage('rules') }
    window.addEventListener('market-radar-select', select)
    window.addEventListener('market-radar-alerts', alerts)
    return () => { window.removeEventListener('market-radar-select', select); window.removeEventListener('market-radar-alerts', alerts) }
  }, [])
  useEffect(() => {
    if (!state.open || radar.hidden) return
    const outside = (e: PointerEvent) => {
      const target = e.target
      if (target instanceof Element && !target.closest('[data-market-radar]')) radar.setOpen(false)
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented && !(e.target instanceof Element && e.target.closest('[role="dialog"]:not(.mr-panel)'))) { e.preventDefault(); radar.setOpen(false) } }
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', esc) }
  }, [state.open, radar])
  const config = state.snapshot.config
  const instrument = config.instruments.find(i => i.id === selected)
  const list = config.instruments.filter(i => tab === 'all' || i.market === tab)
  if (radar.hidden) return null
  return <div className="mr-root mr-overlay" data-market-radar="" data-colors={config.colorMode}>
    {!state.bottomMounted && state.connected && <button className="mr-fallback" title="打开行情雷达" onClick={() => radar.setOpen(!state.open)}><Icon/><span>行情</span></button>}
    {state.open && <aside className="mr-panel" ref={panel} role="dialog" aria-modal="false" aria-label="行情雷达">
      <header className="mr-header"><div className="mr-header-title"><span className="mr-logo"><Icon size={20}/></span><div><h2>行情雷达</h2><p>黄金 · A 股 · 美股</p></div></div><div className="mr-header-actions"><IconButton icon="refresh" label="刷新行情" disabled={state.busy} onClick={() => { void radar.refresh() }}/><IconButton icon="hide" label="隐藏行情并静音（Ctrl/⌘+Shift+F9 恢复）" onClick={() => { void radar.toggleHidden() }}/><IconButton icon="close" label="关闭看板" onClick={() => radar.setOpen(false)}/></div></header>
      <nav className="mr-navigation" aria-label="看板页面"><button className={page === 'list' ? 'mr-selected' : ''} onClick={() => { setPage('list'); setSelected(null) }}>自选行情</button><button className={page === 'rules' ? 'mr-selected' : ''} onClick={() => { rulesFor.current = undefined; setPage('rules') }}><Icon name="bell" size={14}/>提醒{state.snapshot.alerts.some(a => !a.read) && <span className="mr-nav-count">{state.snapshot.alerts.filter(a => !a.read).length}</span>}</button><button className={page === 'settings' ? 'mr-selected' : ''} onClick={() => setPage('settings')}><Icon name="settings" size={14}/>设置</button></nav>
      {(state.error || state.snapshot.storageError || !state.connected) && <div className="mr-banner" role="status">{state.error || state.snapshot.storageError || '正在连接行情服务…'}</div>}
      {state.notice && <div className="mr-success" role="status">{state.notice}</div>}
      <div className="mr-panel-scroll">
        {page === 'add' ? <AddInstrument radar={radar} done={() => { setPage('list'); setSelected(null) }}/> : page === 'settings' ? <Settings radar={radar}/> : page === 'rules' ? <Rules key={rulesFor.current ?? 'all'} radar={radar} instrumentId={rulesFor.current}/> : instrument ? <InstrumentDetail key={instrument.id} radar={radar} instrument={instrument} onBack={() => setSelected(null)} onRules={() => { rulesFor.current = instrument.id; setPage('rules') }}/> : <>
          <div className="mr-list-toolbar"><div className="mr-market-tabs" role="tablist" aria-label="市场筛选">{(['all', 'gold', 'cn', 'us'] as const).map(id => <button role="tab" aria-selected={tab === id} key={id} className={tab === id ? 'mr-selected' : ''} onClick={() => setTab(id)}>{id === 'all' ? '全部' : MARKET_LABEL[id]}</button>)}</div><IconButton icon="plus" label="添加自选" onClick={() => setPage('add')}/></div>
          <div className="mr-list-columns"><span>标的 / 代码</span><span>价格 / 涨跌幅</span></div>
          <div className="mr-watchlist">{list.map(i => {
            const original = state.snapshot.quotes[i.id]
            const quote = original && !state.connected ? { ...original, status: 'error' as const } : original
            const pinned = config.pinned.includes(i.id)
            return <div className="mr-quote-row" key={i.id}><button className="mr-quote-main" onClick={() => setSelected(i.id)}><div className="mr-quote-label"><span className={`mr-market-letter mr-tag-${i.market}`}>{i.market === 'gold' ? '金' : i.market === 'cn' ? 'A' : 'US'}</span><div><strong>{quote?.instrument.name ?? i.name}</strong><span>{i.symbol}<span className="mr-inline-dot">·</span>{quote ? STATUS_LABEL[quote.status] : state.snapshot.errors?.[i.id] ? '连接失败' : '等待报价'}</span></div></div><div className="mr-quote-value"><strong>{formatPrice(quote?.price)}</strong><Change quote={quote}/></div></button><IconButton icon="pin" label={pinned ? `取消固定 ${i.name}` : `固定 ${i.name} 到行情条`} active={pinned} disabled={state.busy} onClick={() => {
              void radar.save(c => { if (pinned) c.pinned = c.pinned.filter(id => id !== i.id); else { if (c.pinned.length >= 3) throw new Error('行情条已固定三只标的，请先取消一只'); c.pinned.push(i.id) } }).catch(() => {})
            }}/><details className="mr-row-menu"><summary aria-label={`管理 ${i.name}`}>···</summary><div><button disabled={state.busy || config.instruments[0]?.id === i.id} onClick={() => { void radar.save(c => { const at = c.instruments.findIndex(v => v.id === i.id); [c.instruments[at - 1], c.instruments[at]] = [c.instruments[at], c.instruments[at - 1]] }).catch(() => {}) }}>上移</button><button disabled={state.busy || config.instruments.at(-1)?.id === i.id} onClick={() => { void radar.save(c => { const at = c.instruments.findIndex(v => v.id === i.id); [c.instruments[at], c.instruments[at + 1]] = [c.instruments[at + 1], c.instruments[at]] }).catch(() => {}) }}>下移</button><button onClick={() => { rulesFor.current = i.id; setPage('rules') }}>设置提醒</button><button className="mr-danger-text" disabled={state.busy} onClick={() => { void radar.save(c => { c.instruments = c.instruments.filter(v => v.id !== i.id); c.pinned = c.pinned.filter(id => id !== i.id); c.alerts = c.alerts.filter(a => a.instrumentId !== i.id) }).catch(() => {}) }}>移出自选</button></div></details></div>
          })}</div>
          {!list.length && <div className="mr-empty"><Icon size={30}/><h3>这里还没有自选</h3><p>添加你关注的标的，价格就在手边。</p><button className="mr-button mr-primary" onClick={() => setPage('add')}><Icon name="plus"/>添加自选</button></div>}
          <div className="mr-group-snapshot"><button className="mr-button mr-full" disabled={!state.connected || !config.pinned.length || config.pinned.some(id => !state.snapshot.quotes[id] || state.snapshot.errors?.[id])} onClick={() => setPreview(snapshotText(config.pinned.map(id => state.snapshot.quotes[id])))}><Icon name="chat"/>准备重点自选快照</button>{!config.pinned.length ? <p className="mr-muted">固定自选到底部行情条后可生成快照。</p> : (!state.connected || config.pinned.some(id => !state.snapshot.quotes[id] || state.snapshot.errors?.[id])) && <p className="mr-muted">等待所有重点自选的报价连接后生成快照。</p>}{preview && <SnapshotPreview radar={radar} preview={preview} onClose={() => setPreview('')}/>}</div>
          <EconomicIndicators load={radar.api.economicIndicators} preview={radar.api.economicIndicatorPreview}/>
          <button className="mr-add-row" onClick={() => setPage('add')}><Icon name="plus"/>添加自选标的</button>
          <div className="mr-list-tip"><Icon name="pin" size={13}/><span>固定最多三只到行情条，点击任意标的查看走势。</span></div>
          {state.snapshot.alerts[0] && <button className="mr-latest-alert" onClick={() => { rulesFor.current = undefined; setPage('rules') }}><Icon name="bell"/><span>{state.snapshot.alerts[0].text}</span><Icon name="arrow"/></button>}
        </>}
      </div>
      <footer className="mr-footer"><span><i className={`mr-connection-dot ${state.connected ? 'mr-online' : ''}`}/>{state.connected ? '本地行情服务已连接' : '行情服务未连接'}</span><span>Ctrl / ⌘ + Shift + F9 隐藏</span></footer>
    </aside>}
  </div>
}
function DraftBridge({ radar, inputActions }: { radar: RadarController; inputActions: InputActions }) {
  useEffect(() => radar.setDraftWriter(text => insertSnapshot(inputActions, text)), [radar, inputActions])
  return null
}
export function createRpcApi(ctx: ClientContext, signal: AbortSignal): RadarApi {
  async function call<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    const response = await ctx.connection.rpc.call('/api', `marketRadar/${method}`, { args }, signal)
    if (!response.ok) throw new Error(response.error.message)
    return response.value as T
  }
  return {
    snapshot: () => call('snapshot'), save: config => call('save', { config }),
    resolve: (market, symbol) => call('resolve', { market, symbol }), candidates: symbol => call('candidates', { symbol }), acknowledgeAlerts: ids => call('acknowledgeAlerts', { ids }), series: (instrumentId, range) => call('series', { instrumentId, range }),
    marketEvents: () => call('marketEvents'),
    marketEventPreview: url => call('marketEventPreview', { url }),
    economicIndicators: () => call('economicIndicators'),
    economicIndicatorPreview: (id, fetchedAt) => call('economicIndicatorPreview', { id, fetchedAt }),
    refresh: () => call('refresh'), visibility: (clientId, open) => call('visibility', { clientId, open }),
  }
}
export function apply(ctx: ClientContext): void {
  const abort = new AbortController()
  const radar = new RadarController(createRpcApi(ctx, abort.signal))
  // Keep the live controller in the plugin closure. Slot business injection
  // adapts objects; passing a mutable class there splits action/read receivers.
  const Ticker = () => <BottomBar radar={radar}/>
  const Overlay = () => <Dashboard radar={radar}/>
  const InputBridge = ({ inputActions }: { inputActions: InputActions }) => <DraftBridge radar={radar} inputActions={inputActions}/>
  ctx.effect(() => {
    const element = document.createElement('style'); element.dataset.marketRadarStyle = ''; element.textContent = styles; document.head.append(element)
    const toggle = (e: KeyboardEvent) => {
      const primary = e.ctrlKey !== e.metaKey
      if (primary && !e.altKey && e.shiftKey && e.code === 'F9' && !e.repeat && !e.isComposing && !e.getModifierState('AltGraph')) { e.preventDefault(); e.stopPropagation(); void radar.toggleHidden() }
    }
    // Desktop's native keyboard bridge owns configured shortcuts, so register
    // with the public catalog rather than relying on a document key listener.
    let disposeShortcut: (() => void) | undefined
    if (ctx.shortcuts) {
      const command = {
        id: 'market-radar.toggle-visibility', label: () => '行情雷达：隐藏或恢复', aliases: ['market radar', 'hide quotes'],
        defaults: Object.fromEntries(['desktop:windows', 'desktop:macos', 'desktop:linux', 'web:windows', 'web:macos'].map(profile => [profile, { code: 'F9', modifiers: ['primary', 'shift'] }])),
        regions: ['page', 'editable', 'terminal'],
        resolve: () => ({ status: 'handled' as const, run: () => { void radar.toggleHidden() } }),
      }
      try { disposeShortcut = ctx.shortcuts.register(command) }
      catch { disposeShortcut = ctx.shortcuts.register({ ...command, defaults: {} }) }
    } else document.addEventListener('keydown', toggle, true)
    void radar.poll()
    return () => { disposeShortcut?.(); document.removeEventListener('keydown', toggle, true); radar.dispose(); abort.abort(); element.remove() }
  }, 'market-radar client lifecycle')
  ctx.slots.inject('shell.bottom', () => {
    try { return ctx.slots.register({ name: 'shell.bottom', id: 'market-radar-ticker' }, Ticker) }
    catch { radar.patch({ bottomMounted: false }); return () => {} }
  })
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'market-radar-overlay', order: 30 }, Overlay))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'market-radar-draft', order: 99 }, InputBridge))
}
