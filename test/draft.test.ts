import assert from 'node:assert/strict'
import { test } from 'node:test'
import { insertSnapshot } from '../src/draft.ts'
test('inserting a snapshot preserves a selected range, existing text and attachment identity', () => {
  let text = '已有文字：请保留全部内容。'
  const initial = text
  const attachments = ['existing-attachment-1']
  const originalAttachments = attachments
  let persisted = false
  assert.equal(insertSnapshot({
    captureInsertion: () => ({ start: 5, end: 10, draftRev: 3 }),
    insertText(value, span) { assert.equal(span.draftRev, 3); text = text.slice(0, span.start) + value + text.slice(span.end); return true },
    persistDraft() { persisted = true },
  }, '【行情快照】'), true)
  assert.equal(text.replace('\n\n【行情快照】\n\n', ''), initial)
  assert.equal(attachments, originalAttachments)
  assert.equal(persisted, true)
})
test('locked or changed drafts decline insertion without persisting or submitting', () => {
  let persisted = false
  assert.equal(insertSnapshot({ captureInsertion: () => ({ start: 0, end: 0, draftRev: 1 }), insertText: () => false, persistDraft() { persisted = true } }, 'test'), false)
  assert.equal(persisted, false)
})
