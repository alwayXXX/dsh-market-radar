import type { ComponentType } from 'react'
export interface InputActions {
  captureInsertion(): { start: number; end: number; draftRev: number }
  insertText(text: string, span: { start: number; end: number; draftRev: number }): boolean
  persistDraft(): void
}
export interface ClientContext {
  effect(setup: () => (() => void), label?: string): unknown
  slots: {
    inject(name: string, setup: () => unknown): unknown
    register(spec: { name: string; id?: string; order?: number; inject?: () => unknown }, component: ComponentType<any>): () => void
  }
  connection: {
    rpc: { call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<{ ok: true; value: unknown } | { ok: false; error: { message: string; code: string } }> }
  }
  shortcuts?: {
    register(command: {
      id: string
      label: () => string
      aliases: string[]
      defaults: Record<string, { code: string; modifiers: string[] }>
      regions: string[]
      resolve: () => { status: 'handled'; run: () => void }
    }): () => void
  }
}
