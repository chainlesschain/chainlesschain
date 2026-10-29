import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createCliContextMemoryRuntime } from "../../src/lib/context-memory-kernel/runtime.js";
import { CliCanonicalMemoryService } from "../../src/lib/context-memory-kernel/memory-service.js";
import {
  readVerifiedEvents,
  readVerifiedMessages,
} from "../../src/harness/jsonl-session-store.js";

const [mode, sessionId, change] = process.argv.slice(2);
assert.ok(["seed", "mutate", "inspect"].includes(mode));
assert.ok(["supersede", "delete"].includes(change));
const runtime = createCliContextMemoryRuntime({ sessionId, purgePorts: [] });
const service = new CliCanonicalMemoryService({ runtime });
let networkCalls = 0;
globalThis.fetch = () => {
  networkCalls++;
  throw new Error("Memory state fixture refuses network requests");
};
const seed = (
  memoryId,
  content,
  scope = "user",
  scopeId = "local-user",
  allowedSinks = ["provider.ollama"],
) =>
  service.addScoped(content, {
    memoryId,
    scope,
    scopeId,
    allowedSinks,
    importance: 0.95,
  });
let details = {};
if (mode === "seed") {
  await seed("original", "RESTART_TOPIC OLD_RECALL_99317");
  await seed(
    "other-agent",
    "RESTART_TOPIC FORBIDDEN_SCOPE_99317",
    "agent",
    "another-agent",
  );
  await seed(
    "other-sink",
    "RESTART_TOPIC FORBIDDEN_SINK_99317",
    "user",
    "local-user",
    ["provider.anthropic"],
  );
} else if (mode === "mutate") {
  const before = await runtime.memoryPort.getRevision();
  if (change === "supersede") {
    await seed("successor", "RESTART_TOPIC SUCCESSOR_RECALL_99317");
    await runtime.kernel.decideMemory({
      memoryId: "original",
      type: "supersede",
      successorMemoryId: "successor",
      expectedRevision: 1,
      authority: "fixture-user",
    });
  } else assert.equal((await service.delete("original")).status, "purged");
  await seed("current", "RESTART_TOPIC CURRENT_RECALL_99317");
  fs.writeFileSync(
    path.join(process.cwd(), ".chainlesschain/rules.md"),
    "PROJECT_RULE_NEW_99317",
  );
  fs.writeFileSync(
    path.join(process.cwd(), "file-memory.md"),
    "FILE_MEMORY_NEW_99317",
  );
  details = { before };
} else {
  const events = readVerifiedEvents(sessionId);
  const durable = JSON.stringify(readVerifiedMessages(sessionId));
  const forbiddenDurableMarkers = [
    "RECALL_99317",
    "FORBIDDEN_SCOPE_99317",
    "FORBIDDEN_SINK_99317",
    "PROJECT_RULE_",
    "FILE_MEMORY_",
  ];
  for (const marker of forbiddenDurableMarkers)
    assert.equal(durable.includes(marker), false, marker);
  details = {
    eventHashes: events.map((event) => event.hash),
    compactEvents: events
      .filter((event) => event.type === "compact")
      .map((event) => ({ hash: event.hash, canonical: event.data.canonical })),
    usage: events
      .filter((event) => event.type === "token_usage")
      .map((event) => event.data),
    usageStarted: events
      .filter((event) => event.type === "model_usage_started")
      .map((event) => event.data),
    unknownUsage: events.filter((event) => event.type === "model_usage_unknown")
      .length,
    durableMarkersAbsent: true,
  };
}
assert.equal(networkCalls, 0);
process.stdout.write(
  JSON.stringify({
    mode,
    pid: process.pid,
    networkCalls,
    revision: await runtime.memoryPort.getRevision(),
    ...details,
  }) + "\n",
);
