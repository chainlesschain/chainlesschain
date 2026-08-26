"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const extensionRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(extensionRoot, "..", "..");
const protocol = require("../src/vendor/agent-sdk/generated/app-protocol.js");
const { buildApprovalResponse } = require("../src/chat/approval-response.js");
const {
  createTurnState,
  mapAgentEvent,
} = require("../src/chat/chat-events.js");

test("vendored Agent SDK matches the current source and generated output", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/sync-agent-sdk.mjs", "--check"],
    { cwd: extensionRoot, encoding: "utf8", windowsHide: true },
  );

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /agent-sdk v0\.2\.2 is current/);
});

test("IDE CI reruns when the SDK or canonical protocol changes", () => {
  const workflow = fs.readFileSync(
    path.join(repoRoot, ".github", "workflows", "ide-extensions.yml"),
    "utf8",
  );
  for (const watchedPath of [
    '"packages/agent-sdk/**"',
    '"packages/agent-protocol/**"',
  ]) {
    assert.ok(
      workflow.split(watchedPath).length - 1 >= 2,
      `push and pull_request must watch ${watchedPath}`,
    );
  }
  assert.match(workflow, /run: npm run check:agent-sdk/u);
});

test("VS Code replays the canonical ApprovalDecision conformance fixture", () => {
  const fixturePath = path.join(
    repoRoot,
    "packages",
    "agent-protocol",
    "test",
    "fixtures",
    "approval-decisions.json",
  );
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

  for (const entry of fixture) {
    assert.equal(
      protocol.validateApprovalDecision(entry.value).ok,
      entry.valid,
      entry.name,
    );
  }
});

test("VS Code emits schema-valid, least-privilege approval responses", () => {
  const accepted = buildApprovalResponse(
    {
      id: "approval-1",
      approve: true,
      binding: "sha256:exact-call",
    },
    {
      id: "approval-1",
      binding: "sha256:exact-call",
      permissions: [{ capability: "tool:run_shell", scope: "npm test" }],
    },
  );
  assert.deepEqual(accepted, {
    type: "approval",
    id: "approval-1",
    decision: { kind: "acceptOnce" },
    approve: true,
    binding: "sha256:exact-call",
  });
  assert.equal(protocol.validateApprovalDecision(accepted.decision).ok, true);

  for (const decisionKind of ["acceptForTurn", "acceptForSession"]) {
    const scoped = buildApprovalResponse(
      {
        id: "approval-1",
        decisionKind,
        // A compromised Webview cannot widen the CLI-issued permission.
        permissions: [{ capability: "tool:run_shell", scope: "*" }],
      },
      {
        id: "approval-1",
        binding: "sha256:exact-call",
        permissions: [{ capability: "tool:run_shell", scope: "npm test" }],
      },
    );
    assert.deepEqual(scoped, {
      type: "approval",
      id: "approval-1",
      decision: {
        kind: decisionKind,
        permissions: [{ capability: "tool:run_shell", scope: "npm test" }],
      },
      approve: true,
      binding: "sha256:exact-call",
    });
    assert.equal(protocol.validateApprovalDecision(scoped.decision).ok, true);
  }

  const declined = buildApprovalResponse({
    id: "approval-2",
    approve: "truthy-but-untrusted",
    binding: null,
    decision: { kind: "acceptForSession", permissions: [] },
  });
  assert.deepEqual(declined, {
    type: "approval",
    id: "approval-2",
    decision: { kind: "decline" },
    approve: false,
  });
  assert.equal(protocol.validateApprovalDecision(declined.decision).ok, true);

  assert.throws(
    () =>
      buildApprovalResponse(
        { id: "approval-1", approve: true, binding: "sha256:replayed" },
        { id: "approval-1", binding: "sha256:exact-call" },
      ),
    /binding does not match/u,
  );
});

test("VS Code retains bounded CLI approval grants and resolution scope", () => {
  const state = createTurnState();
  const request = mapAgentEvent(
    {
      type: "approval_request",
      id: "approval-scoped",
      tool: "run_shell",
      binding: "ab_0123456789abcdef0123456789abcdef",
      requested_permissions: [
        { capability: "tool:run_shell", scope: "npm test" },
        { capability: "", scope: "must-be-dropped" },
      ],
    },
    state,
  );
  assert.deepEqual(request.permissions, [
    { capability: "tool:run_shell", scope: "npm test" },
  ]);

  const resolved = mapAgentEvent(
    {
      type: "approval_resolved",
      id: "approval-scoped",
      approved: true,
      decision: { kind: "acceptForSession" },
      via: "user",
    },
    state,
  );
  assert.equal(resolved.decisionKind, "acceptForSession");
});
