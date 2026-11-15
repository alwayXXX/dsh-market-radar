import { mkdir, readFile, rename, writeFile, copyFile, unlink } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { defaultConfig, validateConfig } from './config.ts'
import type { RadarConfig } from './types.ts'
export interface ConfigStore { load(): Promise<{ config: RadarConfig; error?: string }>; save(config: RadarConfig): Promise<void> }
export class FileConfigStore implements ConfigStore {
  constructor(readonly path: string) {}
  async load(): Promise<{ config: RadarConfig; error?: string }> {
    try { return { config: validateConfig(JSON.parse(await readFile(this.path, 'utf8'))) } }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { config: defaultConfig() }
      // Keep a damaged file for diagnosis instead of silently replacing user settings.
      await copyFile(this.path, `${this.path}.invalid-${Date.now()}`).catch(() => {})
      return { config: defaultConfig(), error: '本地配置读取失败，已使用默认自选；原文件保留，保存前请先检查备份。' }
    }
  }
  async save(config: RadarConfig): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    const temp = `${this.path}.${randomUUID()}.tmp`
    try {
      await writeFile(temp, JSON.stringify(config, null, 2), { flag: 'wx', mode: 0o600 })
      for (let attempt = 0; ; attempt++) {
        try { await rename(temp, this.path); break }
        catch (error) {
          if (process.platform !== 'win32' || !['EPERM', 'EBUSY', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '') || attempt >= 4) throw error
          await delay(20 * 2 ** attempt)
        }
      }
    } catch (e) {
      await unlink(temp).catch(() => {})
      throw new Error('无法保存本地配置，请检查目录写入权限', { cause: e })
    }
  }
}
