import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
await mkdir('lib', { recursive: true })
await build({ entryPoints: ['src/index.ts'], outfile: 'lib/index.js', bundle: true, format: 'esm', platform: 'node', target: 'node24', packages: 'external', legalComments: 'none' })
await build({
  entryPoints: ['src/client.tsx'], outfile: 'lib/client.js', bundle: true,
  format: 'cjs', platform: 'browser', target: 'chrome120',
  external: ['react', 'react/jsx-runtime'], loader: { '.css': 'text' }, legalComments: 'none',
  banner: { js: 'window.__ModuleLoader__.load({id:"dsh-market-radar",factory:(require)=>{var module={exports:{}};var exports=module.exports;' },
  footer: { js: 'return module.exports;}});' },
})
console.log('Built Host ESM and DSH browser factory.')
