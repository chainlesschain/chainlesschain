import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CliCanonicalMemoryService } from "../../src/lib/context-memory-kernel/memory-service.js";
import { createCliContextMemoryRuntime } from "../../src/lib/context-memory-kernel/runtime.js";
import { prepareCanonicalProviderContext } from "../../src/lib/context-memory-kernel/provider-context.js";
import {
  appendAssistantMessage,
  appendEvent,
  appendUserMessage,
  readVerifiedEvents,
  readVerifiedMessages,
  startSession,
} from "../../src/harness/jsonl-session-store.js";

const [mode, root, change] = process.argv.slice(2);
assert.ok(
  ["write", "mutate", "resume", "uncommitted", "reconcile"].includes(mode),
);
assert.ok(path.isAbsolute(root));
assert.equal(fs.realpathSync.native(root), root);
assert.ok(["supersede", "delete", "unfinished"].includes(change));
const sessionId = `compaction-process-${change}`;
const memoryFilePath = path.join(root, "memory.json");
const runtime = createCliContextMemoryRuntime({
  sessionId,
  memoryFilePath,
  purgePorts: [],
});
const service = new CliCanonicalMemoryService({ runtime });
let physicalRequests = 0;
globalThis.fetch = () => {
  physicalRequests++;
  throw new Error("Process recovery fixture refuses network requests");
};
const oldContent = "RESTART_TOPIC OLD_RECALL_50017";
const nextContent = "RESTART_TOPIC SUCCESSOR_RECALL_50017";
const currentContent = "RESTART_TOPIC CURRENT_RECALL_50017";
const requestFile = path.join(root, "compaction-request.json");
const receiptFile = path.join(root, "compaction-receipt.json");
const seed = (
  memoryId,
  content,
  scope = "user",
  scopeId = "local-user",
  allowedSinks = ["provider.local"],
) =>
  service.addScoped(content, {
    memoryId,
    content,
    scope,
    scopeId,
    allowedSinks,
    importance: 0.95,
  });
const prepare = () =>
  prepareCanonicalProviderContext(readVerifiedMessages(sessionId), {
    sessionId,
    provider: "local",
    model: "fixture",
    contextMemoryFilePath: memoryFilePath,
    contextMemoryModelWindowTokens: 8192,
    maxOutputTokens: 512,
  });
const report = (value) =>
  process.stdout.write(
    JSON.stringify({ ...value, pid: process.pid, physicalRequests }) + "\n",
  );
const waitForKill = () => new Promise(() => setInterval(() => {}, 1000));

if (mode === "write" || mode === "uncommitted") {
  startSession(sessionId, { provider: "local", model: "fixture" });
  appendUserMessage(sessionId, `old question ${"x".repeat(900)}`);
  appendAssistantMessage(sessionId, `old answer ${"y".repeat(900)}`);
  appendUserMessage(sessionId, "RESTART_TOPIC");
  if (mode === "uncommitted") {
    appendEvent(sessionId, "model_usage_started", {
      callId: "unfinished-semantic-call",
      provider: "local",
      model: "fixture",
      source: "semantic-compaction",
      operationId: "unfinished-semantic-compaction",
    });
    report({
      ready: true,
      boundary: "durable_usage_intent_without_compaction",
    });
    await waitForKill();
  }
  await seed("original", oldContent);
  await seed(
    "other-agent",
    "RESTART_TOPIC FORBIDDEN_SCOPE_50017",
    "agent",
    "other-agent",
  );
  await seed(
    "other-sink",
    "RESTART_TOPIC FORBIDDEN_SINK_50017",
    "user",
    "local-user",
    ["provider.remote"],
  );
  const initial = await prepare();
  assert.deepEqual(
    initial.recall.results.map((row) => row.memoryId),
    ["original"],
  );
  assert.ok(JSON.stringify(initial.messages).includes(oldContent));
  const request = {
    operationId: "durable-process-compaction",
    sessionId,
    modelWindowTokens: 420,
    reservedOutputTokens: 80,
    safetyMarginTokens: 80,
    recoveryReserveTokens: 20,
    sink: "provider.local",
    scopeAdmissions: [{ scope: "session", scopeId: sessionId }],
    policyVersion: "process-recovery-v1",
    modelProfile: "fixture",
    memoryRevision: initial.plan.memoryRevision,
    now: "2026-10-29T00:00:00.000Z",
  };
  const receipt = await runtime.kernel.compactContext(request);
  assert.equal(receipt.status, "committed");
  assert.equal(
    readVerifiedEvents(sessionId).filter((event) => event.type === "compact")
      .length,
    1,
  );
  assert.equal(
    JSON.stringify(readVerifiedMessages(sessionId)).includes("RECALL_50017"),
    false,
  );
  fs.writeFileSync(requestFile, JSON.stringify(request));
  fs.writeFileSync(receiptFile, JSON.stringify(receipt));
  report({
    ready: true,
    receipt,
    initialRevision: initial.plan.memoryRevision,
  });
  await waitForKill();
} else if (mode === "mutate") {
  const before = await runtime.memoryPort.getRevision();
  if (change === "supersede") {
    await seed("successor", nextContent);
    await runtime.kernel.decideMemory({
      memoryId: "original",
      type: "supersede",
      successorMemoryId: "successor",
      expectedRevision: 1,
      authority: "fixture-user",
    });
  } else assert.equal((await service.delete("original")).status, "purged");
  await seed("current", currentContent);
  const after = await runtime.memoryPort.getRevision();
  assert.ok(after > before);
  report({ mutated: true, before, after });
} else if (mode === "resume") {
  const beforeEvents = readVerifiedEvents(sessionId);
  const original = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
  const request = JSON.parse(fs.readFileSync(requestFile, "utf8"));
  assert.deepEqual(await runtime.kernel.compactContext(request), original);
  assert.deepEqual(readVerifiedEvents(sessionId), beforeEvents);
  const prepared = await prepare();
  const ids = prepared.recall.results.map((row) => row.memoryId).sort();
  assert.deepEqual(
    ids,
    change === "supersede" ? ["current", "successor"] : ["current"],
  );
  assert.equal(
    prepared.plan.memoryRevision,
    await runtime.memoryPort.getRevision(),
  );
  assert.ok(prepared.plan.memoryRevision > original.memoryRevision);
  const text = JSON.stringify(prepared.messages);
  assert.ok(text.includes(currentContent));
  for (const forbidden of [
    oldContent,
    "FORBIDDEN_SCOPE_50017",
    "FORBIDDEN_SINK_50017",
  ])
    assert.equal(text.includes(forbidden), false);
  assert.equal(text.includes(nextContent), change === "supersede");
  assert.equal(prepared.messages.at(-1).content, "RESTART_TOPIC");
  assert.equal(
    JSON.stringify(readVerifiedMessages(sessionId)).includes("RECALL_50017"),
    false,
  );
  assert.equal(physicalRequests, 0);
  report({
    resumed: true,
    receipt: original,
    memoryRevision: prepared.plan.memoryRevision,
    recalledIds: ids,
    compactEvents: beforeEvents.filter((event) => event.type === "compact")
      .length,
  });
} else {
  const before = readVerifiedEvents(sessionId);
  const receipt = await runtime.sessionPort.readCompactionOperation(
    "unfinished-semantic-compaction",
  );
  assert.equal(receipt.status, "reconciliation_required");
  assert.equal(
    receipt.lifecycle[0].details.code,
    "semantic_usage_without_compaction_commit",
  );
  assert.deepEqual(readVerifiedEvents(sessionId), before);
  assert.equal(before.filter((event) => event.type === "compact").length, 0);
  assert.equal(physicalRequests, 0);
  report({ reconciliationRequired: true, receipt, compactEvents: 0 });
}
