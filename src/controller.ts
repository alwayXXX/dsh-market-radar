import type { RadarApi, RadarConfig, RadarSnapshot } from './types.ts'
import { defaultConfig } from './config.ts'
export interface ViewState {
  snapshot: RadarSnapshot
  open: boolean
  connected: boolean
  bottomMounted: boolean
  error: string
  notice: string
  busy: boolean
  draftReady: boolean
  localHidden: boolean | null
}
export class RadarController {
  private state: ViewState = { snapshot: { config: defaultConfig(), quotes: {}, alerts: [], updatedAt: '' }, open: false, connected: false, bottomMounted: false, error: '', notice: '', busy: false, draftReady: false, localHidden: null }
  private listeners = new Set<() => void>()
  private timer?: ReturnType<typeof setTimeout>
  private stopped = false
  private polling = false
  private writer: { token: symbol; insert: (text: string) => boolean } | null = null
  private noticeTimer?: ReturnType<typeof setTimeout>
  private mutation: Promise<unknown> = Promise.resolve()
  private pendingSaves = 0
  private toggleSequence = 0
  readonly clientId = `radar-${crypto.randomUUID()}`
  constructor(readonly api: RadarApi) {}
  getSnapshot = (): ViewState => this.state
  subscribe = (fn: () => void): (() => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  patch(value: Partial<ViewState>): void {
    if (this.stopped) return
    this.state = { ...this.state, ...value }
    for (const listener of this.listeners) listener()
  }
  get hidden(): boolean { return this.state.localHidden ?? this.state.snapshot.config.hidden }
  private accept(snapshot: RadarSnapshot): void {
    if (snapshot.config.revision < this.state.snapshot.config.revision) return
    if (!this.state.connected) this.patch({ error: '' })
    this.patch({ snapshot, connected: true })
  }
  async poll(): Promise<void> {
    if (this.stopped || this.polling) return
    this.polling = true
    try { this.accept(await this.api.snapshot()); await this.api.visibility(this.clientId, this.state.open && !this.hidden) }
    catch (error) { this.patch({ connected: false, error: error instanceof Error ? error.message : '与行情服务的连接已中断' }) }
    finally {
      this.polling = false
      if (!this.stopped) this.timer = setTimeout(() => { void this.poll() }, 3000)
    }
  }
  setOpen(open: boolean): void { this.patch({ open, error: '', notice: '' }); void this.api.visibility(this.clientId, open && !this.hidden).catch(() => {}) }
  async save(change: (config: RadarConfig) => void): Promise<void> {
    this.pendingSaves++
    this.patch({ busy: true, error: '' })
    const run = this.mutation.then(async () => {
      if (!this.state.connected) throw new Error('行情服务尚未连接，请稍后重试')
      const config = structuredClone(this.state.snapshot.config)
      change(config)
      this.accept(await this.api.save(config))
    })
    this.mutation = run.catch(() => {})
    try { await run }
    catch (error) { this.patch({ error: error instanceof Error ? error.message : '保存失败' }); throw error }
    finally { this.pendingSaves--; this.patch({ busy: this.pendingSaves > 0 }) }
  }
  async toggleHidden(): Promise<void> {
    const sequence = ++this.toggleSequence
    const hidden = !this.hidden
    this.patch({ localHidden: hidden, open: false, notice: '', error: '' })
    try { await this.save(config => { config.hidden = hidden }); if (sequence === this.toggleSequence) this.patch({ localHidden: null }) }
    catch { /* Stay locally hidden when persisting fails; the shortcut still restores it. */ }
  }
  async refresh(): Promise<void> {
    if (this.state.busy) return
    this.patch({ busy: true, error: '' })
    try { this.accept(await this.api.refresh()) }
    catch (error) { this.patch({ error: error instanceof Error ? error.message : '刷新失败' }) }
    finally { this.patch({ busy: false }) }
  }
  notify(notice: string): void {
    clearTimeout(this.noticeTimer)
    this.patch({ notice })
    this.noticeTimer = setTimeout(() => this.patch({ notice: '' }), 3500)
  }
  setDraftWriter(insert: (text: string) => boolean): () => void {
    const token = Symbol()
    this.writer = { token, insert }; this.patch({ draftReady: true })
    return () => { if (this.writer?.token === token) { this.writer = null; this.patch({ draftReady: false }) } }
  }
  insertDraft(text: string): boolean { return this.writer?.insert(text) ?? false }
  dispose(): void {
    this.stopped = true
    clearTimeout(this.timer); clearTimeout(this.noticeTimer)
    void this.api.visibility(this.clientId, false).catch(() => {})
    this.listeners.clear(); this.writer = null
  }
}
