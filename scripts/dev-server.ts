import { createServer } from 'node:http'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { build } from 'esbuild'
import { RadarEngine } from '../src/engine.ts'
import { FileConfigStore } from '../src/storage.ts'
import { validateConfig } from '../src/config.ts'
import type { Market } from '../src/types.ts'
await mkdir('.fixture', { recursive: true })
await build({ entryPoints: ['fixture/main.tsx'], outfile: '.fixture/dev.js', bundle: true, format: 'iife', platform: 'browser', target: 'chrome120', loader: { '.css': 'text' } })
const engine = new RadarEngine(new FileConfigStore(join(process.cwd(), '.fixture/config.json')))
void engine.start()
const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/dev.js') { res.setHeader('content-type', 'text/javascript'); res.end(await readFile('.fixture/dev.js')); return }
    if (req.method === 'GET' && req.url === '/') { res.setHeader('content-type', 'text/html;charset=utf-8'); res.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>行情雷达 · 开发验证页</title></head><body><div id="root"></div><script src="/dev.js"></script></body></html>'); return }
    if (req.method !== 'POST' || req.url !== '/invoke') { res.writeHead(404).end(); return }
    const origin = req.headers.origin
    if (origin && origin !== 'http://127.0.0.1:4188') { res.writeHead(403).end(); return }
    let body = ''
    for await (const chunk of req) { body += chunk; if (body.length > 1_000_000) { res.writeHead(413).end(); return } }
    const { method, args } = JSON.parse(body)
    let value: unknown
    switch (method) {
      case 'snapshot': value = await engine.snapshot(); break
      case 'save': value = await engine.save(validateConfig(args.config)); break
      case 'refresh': value = await engine.refresh(true); break
      case 'resolve': value = await engine.resolve(args.market as Market, args.symbol); break
      case 'series': value = await engine.series(args.instrumentId); break
      case 'visibility': value = await engine.visibility(args.clientId, args.open); break
      default: throw new Error('Unknown method')
    }
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, value: value ?? null }))
  } catch (e) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: false, error: { message: e instanceof Error ? e.message : 'Error' } })) }
})
server.listen(4188, '127.0.0.1', () => console.log('Development fixture: http://127.0.0.1:4188 (not DSH)'))
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { engine.dispose(); server.close(); process.exit() })
