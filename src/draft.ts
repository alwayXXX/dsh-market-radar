import type { InputActions } from './host-types.ts'
/** Preserve the selected draft text and attachments; never submit a message. */
export function insertSnapshot(actions: InputActions, text: string): boolean {
  const span = actions.captureInsertion()
  const accepted = actions.insertText(`\n\n${text}\n\n`, { ...span, start: span.end })
  if (accepted) actions.persistDraft()
  return accepted
}
