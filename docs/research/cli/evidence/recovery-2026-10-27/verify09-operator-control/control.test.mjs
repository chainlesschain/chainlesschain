import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// Operator-authored diagnostic only. Never a native candidate or scored sample.
const root = process.env.VERIFY09_CONTROL_ROOT;
const moduleAt = (relative) => import(pathToFileURL(path.join(root, relative)).href);
const { createSessionHistoryOrigins, HISTORY_PREFIX_SCHEMA } = await moduleAt('packages/cli/src/lib/session-history-origins.js');
const { messagesToContextItems, contextItemsToMessages } = await moduleAt('packages/cli/src/lib/context-memory-kernel/message-adapter.js');
const messages = [
  { role: 'user', content: 'first' },
  { role: 'assistant', content: 'answer' },
  { role: 'user', content: 'selected' },
];

function compactThenRewind(sourceSession) {
  const origins = createSessionHistoryOrigins();
  origins.snapshot(messages);
  // Both fixtures are produced by the real public constructor. No hand-written
  // digest, malformed item, or altered content can cause accidental rejection.
  const outputItems = messagesToContextItems(messages, { sessionId: sourceSession });
  const outputMessages = contextItemsToMessages(outputItems);
  assert.deepEqual(outputMessages, messages, 'fixture must decode successfully');
  origins.compact({
    messages: outputMessages,
    canonical: { sessionId: 'session-A', outputItems },
  });
  const head = 'a'.repeat(64);
  return origins.rewind({
    prevHash: head,
    data: {
      action: 'restore-conversation',
      messages: outputMessages.slice(0, 2),
      historyPrefix: {
        schema: HISTORY_PREFIX_SCHEMA,
        sourceHead: head,
        sourceMessageCount: outputMessages.length,
        retainedMessageCount: 2,
      },
    },
  }, 3);
}

test('same-session compaction preserves the readable origin cutoff', () => {
  assert.equal(compactThenRewind('session-A'), 2);
});

test('foreign-session compaction cannot inherit same-content source origins', () => {
  assert.equal(compactThenRewind('session-B'), null);
});
