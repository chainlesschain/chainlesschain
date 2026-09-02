"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  MAX_REVIEW_BYTES,
  reviewAppServerApproval,
} = require("../src/app-server-approval-review.js");

function approval(overrides = {}) {
  return {
    id: "approval-1",
    binding: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      operationDigest: `sha256:${"a".repeat(64)}`,
      policyDigest: `sha256:${"b".repeat(64)}`,
      nonce: "nonce-1",
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
    operation: { tool: "write_file", path: "README.md" },
    risk: "medium",
    reason: "Write the reviewed file",
    requestedPermissions: [
      { capability: "workspace.write", scope: "README.md" },
    ],
    ...overrides,
  };
}

test("VS Code displays the exact binding and returns only requested turn permissions", async () => {
  const calls = [];
  const vscodeApi = {
    window: {
      async showWarningMessage(...args) {
        calls.push(args);
        return "Approve for turn";
      },
    },
  };
  const request = approval();
  assert.deepEqual(await reviewAppServerApproval(vscodeApi, request), {
    kind: "acceptForTurn",
    permissions: request.requestedPermissions,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].modal, true);
  assert.match(calls[0][1].detail, /README\.md/u);
  assert.match(calls[0][1].detail, new RegExp(request.binding.operationDigest));
  assert.deepEqual(calls[0].slice(2), [
    "Approve once",
    "Approve for turn",
    "Decline",
  ]);
});

test("VS Code dismissal, expiry, and oversized reviews fail closed", async () => {
  let shown = 0;
  const vscodeApi = {
    window: {
      async showWarningMessage() {
        shown += 1;
        return undefined;
      },
    },
  };
  assert.deepEqual(await reviewAppServerApproval(vscodeApi, approval()), {
    kind: "decline",
    reason: "VS Code reviewer declined the App Server operation",
  });
  assert.deepEqual(
    await reviewAppServerApproval(
      vscodeApi,
      approval({
        binding: {
          ...approval().binding,
          expiresAt: "2020-01-01T00:00:00.000Z",
        },
      }),
    ),
    {
      kind: "decline",
      reason: "VS Code received an expired App Server approval request",
    },
  );
  assert.deepEqual(
    await reviewAppServerApproval(
      vscodeApi,
      approval({ operation: { content: "x".repeat(MAX_REVIEW_BYTES) } }),
    ),
    {
      kind: "decline",
      reason: "App Server approval is too large to review safely in VS Code",
    },
  );
  assert.equal(shown, 1);
});

test("VS Code rechecks expiry after the modal decision", async () => {
  const beforeExpiry = Date.parse("2098-12-31T23:59:59.000Z");
  const afterExpiry = Date.parse("2099-01-01T00:00:01.000Z");
  const times = [beforeExpiry, afterExpiry];
  const vscodeApi = {
    window: {
      async showWarningMessage() {
        return "Approve once";
      },
    },
  };
  assert.deepEqual(
    await reviewAppServerApproval(vscodeApi, approval(), {
      now: () => times.shift(),
    }),
    {
      kind: "decline",
      reason: "App Server approval expired during VS Code review",
    },
  );
});
