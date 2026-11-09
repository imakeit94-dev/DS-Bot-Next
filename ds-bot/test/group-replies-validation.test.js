import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseReplies } from '../src/shared/group-replies.js'

test('malformed message bodies do not hide valid replies', () => {
  for (const bad of [null, 42, false, {}, []]) {
    for (const kind of [undefined, 'user']) {
      const good = { botId: 'writer', text: 'surviving' }
      const invalid = { botId: 'writer', ...(kind ? { kind } : {}), text: bad }
      const event = { kind: 'missed', botId: 'writer' }
      const replies = [good, invalid, event, { text: '' }]
      assert.deepEqual(parseReplies(JSON.stringify({ replies })), { replies: [good, event, { text: '' }], broken: true })
      const cut = `{"replies":[${replies.map(reply => JSON.stringify(reply)).join(',')},[... tool result middle pruned ...]`
      assert.deepEqual(parseReplies(cut), { replies: [good, event, { text: '' }], broken: true })
    }
  }
  assert.deepEqual(parseReplies('{"replies":[]}'), { replies: [], broken: false })
  assert.deepEqual(parseReplies('{"replies":[null,42,{},[],{"text":""}]}'), { replies: [{ text: '' }], broken: true })
})
