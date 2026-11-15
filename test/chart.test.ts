import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PriceChart } from '../src/chart.tsx'
import { instrumentFor } from '../src/config.ts'
import type { PriceSeries } from '../src/types.ts'

test('long-range chart renders real year ticks, source and daily coverage', () => {
  const instrument = instrumentFor('gold', 'XAU')
  const series: PriceSeries = {
    instrumentId: instrument.id, range: '5y', previousClose: null, coverage: 'provider', granularity: 'daily',
    source: '测试数据源', note: '日线收盘点', updatedAt: '2026-11-16T00:00:00Z',
    points: [{ time: Date.parse('2021-11-15T16:00:00Z'), price: 1800 }, { time: Date.parse('2026-11-12T16:00:00Z'), price: 3879.92 }],
  }
  const html = renderToStaticMarkup(createElement(PriceChart, { instrument, series }))
  assert.match(html, /测试数据源 · 日线收盘点/)
  assert.match(html, /实际覆盖 2021\/11\/16 — 2026\/11\/13/)
  assert.match(html, /2021\/11\/16/); assert.match(html, /2026\/11\/13/)
  assert.match(html, /USD\/盎司/); assert.match(html, /<path d="M/)
  const axis = /<div class="mr-chart-axis">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? ''
  assert.equal((axis.match(/<span>20\d{2}\//g) ?? []).length, 5)
  assert.doesNotMatch(html, /NaN|undefined/)
})

test('empty historical charts display an honest error instead of sample claims', () => {
  const instrument = instrumentFor('cn', 'sh000001')
  const series: PriceSeries = { instrumentId: instrument.id, range: 'max', points: [], previousClose: null, source: '腾讯财经', coverage: 'provider', granularity: 'daily', updatedAt: '', error: '走势暂不可用' }
  const html = renderToStaticMarkup(createElement(PriceChart, { instrument, series }))
  assert.match(html, /走势暂不可用/)
  assert.doesNotMatch(html, /行情更新后会记录有效采样/)
})
