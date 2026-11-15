import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defaultConfig } from '../src/config.ts'
import { FileConfigStore } from '../src/storage.ts'
async function directory() {
  const parent = join(process.cwd(), '.fixture')
  await mkdir(parent, { recursive: true })
  return mkdtemp(join(parent, 'storage-'))
}
test('file storage round-trips settings and replaces the previous complete document', async () => {
  const dir = await directory(), path = join(dir, 'config.json')
  const store = new FileConfigStore(path)
  assert.deepEqual((await store.load()).config, defaultConfig())
  const config = defaultConfig(); config.hidden = true; config.revision = 3
  await store.save(config)
  assert.deepEqual((await store.load()).config, config)
  config.colorMode = 'green-up'; config.revision++
  await store.save(config)
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), config)
  assert.deepEqual(await readdir(dir), ['config.json'])
})
test('a malformed settings document is retained with a backup and a visible load warning', async () => {
  const dir = await directory(), path = join(dir, 'config.json')
  await writeFile(path, '{damaged settings')
  const result = await new FileConfigStore(path).load()
  assert.ok(result.error)
  assert.equal(await readFile(path, 'utf8'), '{damaged settings')
  const backup = (await readdir(dir)).find(name => name.startsWith('config.json.invalid-'))
  assert.ok(backup)
  assert.equal(await readFile(join(dir, backup), 'utf8'), '{damaged settings')
})
