import { useState, useSyncExternalStore, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { apply } from '../src/client.tsx'
import type { ClientContext, InputActions } from '../src/host-types.ts'
const entries = new Map<string, { component: ComponentType<any>; inject?: () => unknown }>()
const effects: (() => void)[] = []
const listeners = new Set<() => void>()
let revision = 0
const update = () => { revision++; for (const listener of listeners) listener() }
let text = '请保留这段已有文字。'
let draftRev = 0
let selection = { start: text.length, end: text.length }
const inputActions: InputActions = {
  captureInsertion: () => ({ ...selection, draftRev }),
  insertText: (value, span) => {
    if (span.draftRev !== draftRev) return false
    text = text.slice(0, span.start) + value + text.slice(span.end); draftRev++; selection = { start: text.length, end: text.length }; update(); return true
  },
  persistDraft: () => {},
}
const ctx: ClientContext = {
  effect(setup) { effects.push(setup()) },
  slots: {
    inject(name, setup) { const result = setup(); if (typeof result === 'function') effects.push(result as () => void) },
    register(spec, component) { const key = `${spec.name}:${spec.id}`; entries.set(key, { component, inject: spec.inject }); update(); return () => { entries.delete(key); update() } },
  },
  connection: { rpc: { async call(channel, endpoint, payload, signal) { const response = await fetch('/invoke', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: endpoint.split('/')[1], args: (payload as { args: unknown }).args }), signal }); return response.json() } } },
}
apply(ctx)
function Slots({ name }: { name: string }) {
  return <>{[...entries].filter(([key]) => key.startsWith(`${name}:`)).map(([key, value]) => <value.component key={key} {...value.inject?.() as object} {...name.startsWith('conversation.') ? { inputActions } : {}} />)}</>
}
function App() {
  const [dark, setDark] = useState(false)
  const [collision, setCollision] = useState(false)
  useSyncExternalStore(fn => { listeners.add(fn); return () => { listeners.delete(fn) } }, () => revision)
  return <div data-theme={dark ? 'dark' : 'light'} style={{ fontFamily: 'system-ui,Segoe UI,sans-serif', background: dark ? '#181b21' : '#fafbfc', color: dark ? '#e4e7ef' : '#243048', height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <header style={{ display: 'flex', justifyContent: 'space-between', padding: '15px 22px', borderBottom: '1px solid #8882', fontSize: 12 }}><span>行情雷达 · 开发验证页（非 DSH）</span><div><button onClick={() => setDark(!dark)}>切换主题</button> <button onClick={() => setCollision(!collision)}>模拟底部占用</button></div></header>
    <div style={{ display: 'flex', flex: 1, minHeight: 0 }}><nav style={{ width: 230, borderRight: '1px solid #8882', padding: '28px 22px', color: '#9299a5', fontSize: 12 }}><strong style={{ color: dark ? '#e4e7ef' : '#243048', fontSize: 16 }}>DSH 开发测试壳</strong><p style={{ marginTop: 28 }}>交互与数据验证</p><p>自选管理与提醒</p><p>草稿保留验证</p><small>本页使用真实公开行情接口。桌面兼容性另行实测。</small></nav><main style={{ flex: 1, padding: '48px min(8vw,100px)', overflow: 'auto' }}><div style={{ maxWidth: 700, margin: '0 auto' }}><h1 style={{ fontSize: 28, fontWeight: 550 }}>把行情留在手边。</h1><p style={{ color: '#9299a5', fontSize: 13 }}>点击底部任意标的，查看自选行情与价格走势。</p><div style={{ marginTop: 100 }}><label style={{ fontSize: 12 }}>模拟当前对话草稿<textarea aria-label="模拟当前对话草稿" value={text} onSelect={e => { selection = { start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd } }} onChange={e => { text = e.target.value; draftRev++; update() }} style={{ display: 'block', width: '100%', minHeight: 160, marginTop: 10, border: '1px solid #8883', borderRadius: 12, padding: 18, background: 'transparent', color: 'inherit', fontFamily: 'inherit', fontSize: 13 }}/></label><span style={{ fontSize: 11, color: '#9299a5' }}>附件：保留的参考图.png（测试占位）</span></div><Slots name="conversation.input.dock"/></div></main></div>
    {!collision && <Slots name="shell.bottom"/>}<Slots name="shell.overlay"/>
  </div>
}
createRoot(document.getElementById('root')!).render(<App/> )
window.addEventListener('beforeunload', () => { for (const dispose of effects.reverse()) dispose() })
