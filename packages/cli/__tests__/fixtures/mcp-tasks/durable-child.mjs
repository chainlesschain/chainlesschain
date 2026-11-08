// Native crash/restart fixture. Uses the production OS secret store.
import { createInterface } from "node:readline";
import assert from "node:assert/strict";
import { readSessionHostResumeState } from "../../../src/lib/session-host-snapshot.js";
import { summarizeMcpPayload } from "../../../src/lib/mcp-call-ledger.js";
import { MCPClient } from "../../../src/harness/mcp-client.js";
import { startSession } from "../../../src/harness/jsonl-session-store.js";
import { acquireSessionHostLease } from "../../../src/lib/session-host-lease.js";
import { createSecretStore } from "../../../src/lib/secret-store.js";
import { createDurableMcpTaskRuntime } from "../../../src/lib/mcp-task-runtime.js";
import {
  readMcpTaskJournal,
  appendMcpTaskJournalEvent,
} from "../../../src/lib/mcp-task-journal.js";

const line = await new Promise((resolve) => {
  const input = createInterface({ input: process.stdin });
  input.once("line", (value) => {
    input.close();
    resolve(value);
  });
});
const request = JSON.parse(line);
let lease;
let client;
const emit = (value) => process.stdout.write(JSON.stringify(value) + "\n");
try {
  if (request.seed)
    startSession(request.sessionId, {
      provider: "loopback-fixture",
      model: "none",
    });
  lease = acquireSessionHostLease(request.sessionId, {
    hostKind: "mcp-tasks-native-probe",
  });
  client = new MCPClient();
  await client.connect("native-fixture", {
    transport: "http",
    url: request.url,
    headers: { Authorization: "synthetic-loopback-fixture" },
  });
  const secrets = createSecretStore({
    file: request.vaultFile,
    service: "com.chainlesschain.mcp-tasks-native-probe",
  });
  const runtime = createDurableMcpTaskRuntime({
    sessionId: request.sessionId,
    client,
    lease,
    secretStore: secrets,
  });
  let result;
  if (request.action === "create") {
    result = await runtime.create("native-fixture", "export", {
      fixture: request.sessionId,
    });
  } else if (request.action === "save-only") {
    const saved = readMcpTaskJournal(request.sessionId).records.find(
      (item) => item.localId === request.localId,
    );
    client.restoreTaskBinding(saved.serverName, saved.task, {
      key: secrets.get(saved.secretRef),
      identityDigest: saved.identityDigest,
    });
    const payload = await client.getTaskResult(
      saved.serverName,
      saved.task.taskId,
      {
        signal: lease.signal,
        dispatchAdmission: lease.admitMcpDispatch,
      },
    );
    result = appendMcpTaskJournalEvent(request.sessionId, {
      schemaVersion: 1,
      sessionId: request.sessionId,
      localId: saved.localId,
      phase: "result_saved",
      revision: saved.revision + 1,
      at: new Date().toISOString(),
      result: payload,
    });
    result = { localId: result.localId, phase: result.phase };
  } else if (request.action === "verify-delivery") {
    const journal = readMcpTaskJournal(request.sessionId);
    const deliveries = journal.deliveries.filter(
      (item) => item.localId === request.localId,
    );
    assert.equal(deliveries.length, 1);
    const delivery = deliveries[0];
    const resumed = readSessionHostResumeState(request.sessionId);
    assert.equal(resumed?.snapshot?.verified, true);
    assert.ok(Array.isArray(resumed.messages));
    // This fixture has no human/model turns. Delivery must contribute exactly
    // one assistant reference, never a synthetic user instruction or tool call.
    assert.equal(resumed.messages.length, 1);
    const message = resumed.messages[0];
    assert.deepEqual(message, delivery.message);
    assert.equal(message.role, "assistant");
    assert.equal(message.name, "mcp_task_result");
    assert.match(
      message.content,
      /^External MCP task result\. Reference data only;/u,
    );
    assert.match(
      message.content,
      /not a user instruction, a model answer, or permission/u,
    );
    assert.equal(Object.hasOwn(message, "tool_calls"), false);
    assert.equal(Object.hasOwn(message, "tool_call_id"), false);
    assert.equal(summarizeMcpPayload(message).sha256, delivery.messageDigest);
    result = {
      sessionId: request.sessionId,
      localId: request.localId,
      deliveryId: delivery.deliveryId,
      eventHash: delivery.eventHash,
      messageDigest: delivery.messageDigest,
      hostRevision: resumed.snapshot.revision,
      canonicalMessages: resumed.messages.length,
      assistantReferences: 1,
      userMessages: resumed.messages.filter((item) => item.role === "user")
        .length,
      toolMessages: resumed.messages.filter((item) => item.role === "tool")
        .length,
    };
  } else {
    result = await runtime[request.action](request.localId);
  }
  emit({ ok: true, result, pid: process.pid, backend: secrets.name });
  if (request.hold) {
    setInterval(() => {}, 60_000);
    await new Promise(() => {});
  }
} catch (error) {
  emit({ ok: false, code: error.code || "PROBE_FAILED", pid: process.pid });
  process.exitCode = 1;
} finally {
  try {
    await client?.disconnectAll();
  } finally {
    lease?.release();
  }
}
