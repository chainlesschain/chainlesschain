import { it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateCanonicalAgentStreamEvent } from "@chainlesschain/agent-protocol";
import { CcAppServer } from "../../src/lib/app-server/server.js";
import { MemoryRolloutStore } from "../../src/lib/app-server/rollout-store.js";
import {
  APP_SERVER_PROTOCOL_VERSION,
  JSON_RPC_ERROR,
} from "../../src/lib/app-server/protocol.js";
import { createCliContextMemoryRuntime } from "../../src/lib/context-memory-kernel/runtime.js";

function removeFixture(directory, parent) {
  if (
    path.dirname(directory) !== parent ||
    !path.basename(directory).startsWith("cc-rpc-memory-correction-") ||
    fs.realpathSync.native(directory) !== directory
  )
    throw Error("Unsafe App Server fixture cleanup");
  fs.rmSync(directory, { recursive: true, force: true });
}

it("corrects through the production App Server route with body-free predecessor notifications", async () => {
  const parent = fs.realpathSync.native(os.tmpdir());
  const directory = fs.mkdtempSync(
    path.join(parent, "cc-rpc-memory-correction-"),
  );
  const messages = [];
  const runtime = createCliContextMemoryRuntime({
    env: { CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE: "canonical_default" },
    memoryFilePath: path.join(directory, "memory.json"),
    purgePorts: [],
  });
  const server = new CcAppServer({
    store: new MemoryRolloutStore(),
    kernel: { close() {} },
    send: async (message) => messages.push(message),
    contextMemoryRuntimeFactory: () => runtime,
  });
  let id = 0;
  const request = (method, params) =>
    server.receive({ jsonrpc: "2.0", id: ++id, method, params });
  try {
    expect(
      (
        await request("initialize", {
          protocolVersion: APP_SERVER_PROTOCOL_VERSION,
          minimumProtocolVersion: 1,
          client: { name: "correction-fixture", version: "1.0.0" },
          features: ["context_memory_kernel"],
        })
      ).error,
    ).toBeUndefined();
    const proposed = await request("memory/propose", {
      memoryId: "rule-memory",
      scope: "user",
      scopeId: "local-user",
      category: "rule",
      content: "obsolete-private-rule",
      provenance: {
        source: "test",
        actor: "local-user",
        observedAt: new Date().toISOString(),
      },
      evidenceRefs: [{ store: "test", id: "source-rule" }],
      confidence: 0.8,
      importance: 0.8,
      sensitivity: "personal",
      allowedSinks: ["provider.ollama"],
      retentionPolicy: { mode: "durable" },
      activate: true,
    });
    expect(proposed.error).toBeUndefined();
    const old = proposed.result.record;
    const corrected = await request("memory/decide", {
      memoryId: old.memoryId,
      type: "correct",
      expectedRevision: 1,
      content: "replacement-private-rule",
      reason: "obsolete-private-rule was wrong",
      authority: "rpc-user",
    });
    expect(corrected.error).toBeUndefined();
    expect(corrected.result.record).toMatchObject({
      revision: 2,
      content: "replacement-private-rule",
      state: old.state,
    });
    const notifications = messages.filter(
      (x) =>
        x.method === "memory/event" && x.params.type === "memory.corrected",
    );
    expect(notifications).toHaveLength(1);
    const payload = notifications[0].params;
    expect(payload).toEqual({
      type: "memory.corrected",
      memory_id: old.memoryId,
      revision: 2,
      record_digest: corrected.result.record.digest,
      previous_revision: 1,
      previous_record_digest: old.digest,
    });
    expect(validateCanonicalAgentStreamEvent(payload).ok).toBe(true);
    expect(
      validateCanonicalAgentStreamEvent({
        ...payload,
        seq: 1,
        trace_id: "trace:correction",
      }).ok,
    ).toBe(true);
    expect(
      validateCanonicalAgentStreamEvent({
        ...payload,
        record: corrected.result.record,
      }).ok,
    ).toBe(false);
    expect(
      validateCanonicalAgentStreamEvent({
        ...payload,
        previous_record_digest: undefined,
      }).ok,
    ).toBe(false);
    expect(JSON.stringify(payload)).not.toContain("private-rule");
    const stale = await request("memory/decide", {
      memoryId: old.memoryId,
      type: "correct",
      expectedRevision: 1,
      content: "must-not-commit",
    });
    expect(stale.error.code).toBe(JSON_RPC_ERROR.CONFLICT);
    expect((await runtime.memoryPort.read(old.memoryId)).content).toBe(
      "replacement-private-rule",
    );
    expect(
      messages.filter(
        (x) =>
          x.method === "memory/event" && x.params.type === "memory.corrected",
      ),
    ).toHaveLength(1);
  } finally {
    await server.close();
    removeFixture(directory, parent);
  }
});
