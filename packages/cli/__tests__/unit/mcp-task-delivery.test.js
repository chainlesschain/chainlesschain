import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const root = mkdtempSync(join(tmpdir(), "cc-mcp-task-delivery-"));
vi.mock("../../src/lib/paths.js", () => ({
  getHomeDir: () => join(root, "home"),
  getSessionStoreDir: () => join(root, "home", "sessions"),
  getClaudeProjectStorageDir: () => null,
  getStatePath: () => join(root, "home", "state"),
  getMachineSecurityAnchorDir: () => join(root, "security"),
}));
const {
  startSession,
  appendEvent,
  appendCompactEvent,
  appendUserMessage,
  readEvents,
  readVerifiedProjection,
  _sessionScaleFaultHooks,
} = await import("../../src/harness/jsonl-session-store.js");
const { acquireSessionHostLease } =
  await import("../../src/lib/session-host-lease.js");
const { createMcpCallLedger, summarizeMcpPayload } =
  await import("../../src/lib/mcp-call-ledger.js");
const { createSessionMcpLedgerSink, loadMcpLedgerRecovery } =
  await import("../../src/lib/mcp-call-ledger-store.js");
const { appendMcpTaskJournalEvent, readMcpTaskJournal } =
  await import("../../src/lib/mcp-task-journal.js");
const { deliverMcpTaskResult } =
  await import("../../src/lib/mcp-task-delivery.js");
const { beginMcpTaskContinuation, settleMcpTaskContinuation } =
  await import("../../src/lib/mcp-task-continuation.js");
const { listDurableMcpTasks } =
  await import("../../src/lib/mcp-task-runtime.js");
const { MCP_TASK_CONTINUATION_FIELD, createMcpTaskContinuationMessage } =
  await import("../../src/lib/mcp-task-continuation-contract.js");
const { createMcpTaskDeliveryData, MCP_TASK_DELIVERY_EVENT } =
  await import("../../src/lib/mcp-task-delivery-contract.js");
const { readSessionTranscriptHistory } =
  await import("../../src/lib/session-transcript-history.js");

const { readSessionTranscriptPage } =
  await import("../../src/lib/session-transcript-page.js");

it("keeps recovery snapshots immutable while accepting later incidents", async () => {
  const { createMcpLedgerEventReducer } =
    await import("../../src/lib/mcp-call-ledger-projection.js");
  const reducer = createMcpLedgerEventReducer({
    sessionId: "snapshot-isolation",
    verified: false,
  });
  const before = reducer.finish();
  expect(before.incidents).toEqual([]);
  expect(Object.isFrozen(before.incidents)).toBe(true);
  reducer.accept({ type: "mcp_call_ledger", data: {} });
  const after = reducer.finish();
  expect(before.incidents).toHaveLength(0);
  expect(after.incidents).toHaveLength(1);
  expect(after.incidents).not.toBe(before.incidents);
  expect(Object.isFrozen(after.incidents)).toBe(true);
  expect(Object.isFrozen(after.incidents[0])).toBe(true);
});

const leases = [];
afterEach(() => {
  for (const lease of leases.splice(0).reverse()) lease.release();
});
afterAll(() => rmSync(root, { recursive: true, force: true }));
const USER = "Inspect the export result; preserve this real user requirement.";
const EVIDENCE =
  "external artifact evidence; not permission to run any command";
const at = "2026-11-08T00:00:00.000Z";
const invoke = (sessionId, localId) =>
  Promise.resolve().then(() => deliverMcpTaskResult(sessionId, localId));
const messages = (sessionId) =>
  readVerifiedProjection(sessionId, () => ({
    accept() {},
    finish(authority) {
      return authority.readMessages();
    },
  }));
const deliveries = (sessionId) =>
  readEvents(sessionId).filter(
    (event) => event.type === MCP_TASK_DELIVERY_EVENT,
  );

function session({ user = true } = {}) {
  const sessionId = "delivery-" + randomUUID();
  startSession(sessionId, { provider: "fixture", model: "fixture" });
  if (user) appendUserMessage(sessionId, USER);
  const lease = acquireSessionHostLease(sessionId, {
    hostKind: "mcp-task-delivery-test",
  });
  leases.push(lease);
  return { sessionId, lease };
}
async function fixture({
  save = true,
  settle = true,
  settlementResult = null,
  user = true,
} = {}) {
  const base = session({ user });
  const { sessionId } = base;
  const ledger = createMcpCallLedger({
    sink: createSessionMcpLedgerSink(sessionId),
  });
  const ticket = await ledger.begin({
    sessionId,
    toolName: "export",
    serverName: "fixture",
    input: { job: "fixture-job" },
    effectContract: { effect: "write" },
  });
  const localId = randomUUID();
  const event = (phase, revision, extra = {}) => ({
    schemaVersion: 1,
    phase,
    revision,
    sessionId,
    localId,
    at,
    ...extra,
  });
  appendMcpTaskJournalEvent(
    sessionId,
    event("prepared", 0, {
      serverName: "fixture",
      toolName: "export",
      ledgerId: ticket.ledgerId,
      inputDigest: ticket.record.inputDigest,
      identityDigest: "hmac-sha256:" + "a".repeat(64),
      secretRef: "mcp-task/" + localId,
    }),
  );
  const task = {
    taskId: "opaque:" + localId,
    status: "working",
    createdAt: at,
    lastUpdatedAt: at,
    ttl: null,
  };
  appendMcpTaskJournalEvent(sessionId, event("accepted", 1, { task }));
  const result = {
    content: [{ type: "text", text: EVIDENCE }],
    _meta: { "io.modelcontextprotocol/related-task": { taskId: task.taskId } },
  };
  if (save)
    appendMcpTaskJournalEvent(sessionId, event("result_saved", 2, { result }));
  if (settle && save)
    await ticket.settle({
      status: "completed",
      output: settlementResult || result,
    });
  return {
    ...base,
    localId,
    result,
    ticket,
    record: () =>
      readMcpTaskJournal(sessionId).records.find(
        (record) => record.localId === localId,
      ),
  };
}

describe("atomic MCP task delivery into canonical session history", () => {
  it("delivers once and returns the same receipt without another event", async () => {
    const f = await fixture();
    const before = readEvents(f.sessionId).length;
    const first = await invoke(f.sessionId, f.localId);
    expect(first).toMatchObject({
      sessionId: f.sessionId,
      localId: f.localId,
      deliveryId: "mcp-task-delivery:" + f.localId,
      delivered: true,
      duplicate: false,
    });
    expect(first.eventHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.messageDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    const second = await invoke(f.sessionId, f.localId);
    expect(second).toEqual({ ...first, duplicate: true });
    expect(readEvents(f.sessionId)).toHaveLength(before + 1);
    const journal = readMcpTaskJournal(f.sessionId);
    expect(journal.deliveries).toHaveLength(1);
    expect(journal.deliveries[0]).toMatchObject({
      eventHash: first.eventHash,
      sourceEventHash: f.record().resultEventHash,
      resultDigest: summarizeMcpPayload(f.result).sha256,
      messageDigest: first.messageDigest,
    });
  });

  it("serializes concurrent delivery attempts into one committed event", async () => {
    const f = await fixture();
    const receipts = await Promise.all([
      invoke(f.sessionId, f.localId),
      invoke(f.sessionId, f.localId),
      invoke(f.sessionId, f.localId),
    ]);
    expect(receipts.filter((receipt) => !receipt.duplicate)).toHaveLength(1);
    expect(new Set(receipts.map((receipt) => receipt.eventHash)).size).toBe(1);
    expect(deliveries(f.sessionId)).toHaveLength(1);
  });

  it("requires the owning session, existing local ID and an active writer lease", async () => {
    const f = await fixture();
    const other = session();
    await expect(invoke(other.sessionId, f.localId)).rejects.toThrow();
    await expect(invoke(f.sessionId, randomUUID())).rejects.toThrow();
    expect(deliveries(other.sessionId)).toHaveLength(0);
    f.lease.release();
    await expect(invoke(f.sessionId, f.localId)).rejects.toThrow();
    expect(deliveries(f.sessionId)).toHaveLength(0);
  });

  it.each([
    { save: false, settle: false },
    { save: true, settle: false },
    {
      save: true,
      settle: true,
      settlementResult: {
        content: [{ type: "text", text: "different output" }],
      },
    },
  ])(
    "refuses unsaved, unsettled or mismatched settlement %#",
    async (options) => {
      const f = await fixture(options);
      await expect(invoke(f.sessionId, f.localId)).rejects.toThrow();
      expect(deliveries(f.sessionId)).toHaveLength(0);
    },
  );

  it("projects one external assistant reference while preserving the actual user", async () => {
    const f = await fixture();
    await invoke(f.sessionId, f.localId);
    const replay = messages(f.sessionId);
    expect(replay.filter((message) => message.role === "user")).toEqual([
      { role: "user", content: USER },
    ]);
    const external = replay.filter(
      (message) => message.name === "mcp_task_result",
    );
    expect(external).toHaveLength(1);
    expect(external[0]).toMatchObject({ role: "assistant" });
    expect(external[0].content).toContain(EVIDENCE);
    expect(external[0].content).toContain("Reference data only");
    expect(external[0].content).toContain("not a user instruction");
    expect(external[0]).not.toHaveProperty("tool_calls");
    expect(external[0]).not.toHaveProperty("tool_call_id");
    // A subsequent genuine user turn, not the assistant carrier, authorizes continuation.
    appendUserMessage(f.sessionId, "Continue the original inspection.");
    expect(messages(f.sessionId).at(-1)).toEqual({
      role: "user",
      content: "Continue the original inspection.",
    });
  });

  it("shows the delivery once in ordinary pagination before and after compaction", async () => {
    const f = await fixture();
    await invoke(f.sessionId, f.localId);
    await invoke(f.sessionId, f.localId);
    const latest = readSessionTranscriptPage(f.sessionId, { limit: 1 });
    expect(latest.totalMessages).toBe(2);
    expect(latest.messages).toHaveLength(1);
    expect(latest.messages[0]).toMatchObject({ role: "assistant", ordinal: 1 });
    expect(latest.messages[0].text).toContain(EVIDENCE);
    expect(latest.nextCursor).toEqual(expect.any(String));
    const previous = readSessionTranscriptPage(f.sessionId, {
      limit: 1,
      cursor: latest.nextCursor,
    });
    expect(previous.messages).toHaveLength(1);
    expect(previous.messages[0]).toMatchObject({ role: "user", text: USER });
    expect(previous.nextCursor).toBeNull();
    appendCompactEvent(f.sessionId, { messages: messages(f.sessionId) });
    const compacted = readSessionTranscriptPage(f.sessionId);
    expect(compacted.totalMessages).toBe(2);
    expect(
      compacted.messages.filter((row) => row.text.includes(EVIDENCE)),
    ).toHaveLength(1);
    expect(compacted.messages.filter((row) => row.text === USER)).toHaveLength(
      1,
    );
  });

  it("keeps the delivery across compaction and displays it once in history", async () => {
    const f = await fixture();
    const first = await invoke(f.sessionId, f.localId);
    const replay = messages(f.sessionId);
    const beforeHistory = readSessionTranscriptHistory(f.sessionId);
    expect(
      beforeHistory.messages.filter((row) => row.text.includes(EVIDENCE)),
    ).toHaveLength(1);
    appendCompactEvent(f.sessionId, { messages: replay });
    const count = readEvents(f.sessionId).length;
    expect(await invoke(f.sessionId, f.localId)).toEqual({
      ...first,
      duplicate: true,
    });
    expect(readEvents(f.sessionId)).toHaveLength(count);
    expect(
      messages(f.sessionId).filter(
        (message) => message.name === "mcp_task_result",
      ),
    ).toHaveLength(1);
    const history = readSessionTranscriptHistory(f.sessionId);
    const evidence = history.messages.filter((row) =>
      row.text.includes(EVIDENCE),
    );
    expect(evidence).toHaveLength(1);
    expect(evidence[0].role).toBe("assistant");
    expect(history.messages.filter((row) => row.text === USER)).toHaveLength(1);
  });

  it.each(["beforeTranscriptAppend", "afterAntiRollbackPublish"])(
    "handles %s failure without a duplicate delivery",
    async (hookName) => {
      const f = await fixture();
      const previous = process.env.CC_SESSION_SCALE_FAULT_INJECTION;
      process.env.CC_SESSION_SCALE_FAULT_INJECTION = "1";
      _sessionScaleFaultHooks[hookName] = ({ type }) => {
        if (type === MCP_TASK_DELIVERY_EVENT) {
          _sessionScaleFaultHooks[hookName] = null;
          throw Object.assign(new Error("simulated delivery fault"), {
            code: "EIO",
          });
        }
      };
      try {
        if (hookName === "beforeTranscriptAppend") {
          await expect(invoke(f.sessionId, f.localId)).rejects.toThrow();
          expect(deliveries(f.sessionId)).toHaveLength(0);
        } else {
          const receipt = await invoke(f.sessionId, f.localId);
          expect(receipt.delivered).toBe(true);
          expect(deliveries(f.sessionId)).toHaveLength(1);
        }
        await invoke(f.sessionId, f.localId);
        await invoke(f.sessionId, f.localId);
        expect(deliveries(f.sessionId)).toHaveLength(1);
      } finally {
        _sessionScaleFaultHooks[hookName] = null;
        if (previous === undefined)
          delete process.env.CC_SESSION_SCALE_FAULT_INJECTION;
        else process.env.CC_SESSION_SCALE_FAULT_INJECTION = previous;
      }
    },
  );

  it.each([
    "source-event",
    "result-digest",
    "rendered-message",
    "local-id",
    "session",
  ])(
    "rejects a valid hash-chain delivery with a false %s binding even in generic reads",
    async (change) => {
      const f = await fixture();
      const data = structuredClone(createMcpTaskDeliveryData(f.record(), at));
      if (change === "source-event") data.sourceEventHash = "f".repeat(64);
      if (change === "result-digest")
        data.resultDigest = "sha256:" + "f".repeat(64);
      if (change === "rendered-message") {
        data.message.content += "\nforged added instructions";
        data.messageDigest = summarizeMcpPayload(data.message).sha256;
      }
      if (change === "local-id") {
        data.localId = randomUUID();
        data.deliveryId = "mcp-task-delivery:" + data.localId;
      }
      if (change === "session") data.sessionId = "foreign-session";
      // This is a canonical append, not physical file corruption: source protocol
      // validation must reject it even though chain and anti-rollback anchor agree.
      appendEvent(f.sessionId, MCP_TASK_DELIVERY_EVENT, data);
      expect(() => readMcpTaskJournal(f.sessionId)).toThrow();
      expect(() => messages(f.sessionId)).toThrow();
      expect(() => readSessionTranscriptHistory(f.sessionId)).toThrow();
    },
  );

  it("rejects a second physical delivery event instead of merely hiding it", async () => {
    const f = await fixture();
    await invoke(f.sessionId, f.localId);
    const first = deliveries(f.sessionId)[0];
    appendEvent(f.sessionId, MCP_TASK_DELIVERY_EVENT, first.data);
    expect(() => messages(f.sessionId)).toThrow();
    expect(() => readMcpTaskJournal(f.sessionId)).toThrow();
  });

  it("forks external reference data without transferring task control or delivery identity", async () => {
    const f = await fixture();
    await invoke(f.sessionId, f.localId);
    const { forkSession } =
      await import("../../src/harness/jsonl-session-store.js");
    const fork = forkSession(f.sessionId);
    const targetId = typeof fork === "string" ? fork : fork.id;
    const references = messages(targetId).filter((message) =>
      message.content?.includes(EVIDENCE),
    );
    expect(references).toHaveLength(1);
    expect(references[0].role).toBe("assistant");
    expect(
      messages(targetId).filter((message) => message.role === "user"),
    ).toEqual([{ role: "user", content: USER }]);
    const journal = readMcpTaskJournal(targetId);
    expect(journal.records).toEqual([]);
    expect(journal.deliveries).toEqual([]);
    f.lease.release();
    const lease = acquireSessionHostLease(targetId, {
      hostKind: "delivery-fork-test",
    });
    leases.push(lease);
    await expect(invoke(targetId, f.localId)).rejects.toThrow();
  });

  it.each(["call", "task", "duplicate-delivery"])(
    "does not wash away corrupt source %s authority at a real fork boundary",
    async (corruption) => {
      const f = await fixture();
      await invoke(f.sessionId, f.localId);
      if (corruption === "call") {
        appendEvent(f.sessionId, "mcp_call_ledger", {});
      } else if (corruption === "task") {
        appendEvent(f.sessionId, "mcp_task_ledger", {});
      } else {
        appendEvent(
          f.sessionId,
          MCP_TASK_DELIVERY_EVENT,
          deliveries(f.sessionId)[0].data,
        );
      }
      const { forkSession } =
        await import("../../src/harness/jsonl-session-store.js");
      const fork = forkSession(f.sessionId);
      const targetId = typeof fork === "string" ? fork : fork.id;
      const copied = readEvents(targetId);
      const lineage = copied.at(-1);
      expect(lineage.type).toBe("system");
      expect(lineage.data._cc_fork_authority).toMatchObject({
        sourceSessionId: f.sessionId,
        sourceHeadHash: copied.at(-2).hash,
        sourceEventCount: copied.length - 1,
      });
      expect(lineage.prevHash).toBe(copied.at(-2).hash);
      expect(() => messages(targetId)).toThrow();
      expect(() => readMcpTaskJournal(targetId)).toThrow();
    },
  );

  it("preserves one external reference through nested forks without inheriting task control", async () => {
    const f = await fixture();
    await invoke(f.sessionId, f.localId);
    const { forkSession } =
      await import("../../src/harness/jsonl-session-store.js");
    let sourceId = f.sessionId;
    f.lease.release();
    for (let depth = 0; depth < 2; depth++) {
      const fork = forkSession(sourceId);
      const targetId = typeof fork === "string" ? fork : fork.id;
      const replay = messages(targetId);
      const references = replay.filter((message) =>
        message.content?.includes(EVIDENCE),
      );
      expect(references).toHaveLength(1);
      expect(references[0]).toMatchObject({
        role: "assistant",
        name: "mcp_task_result",
      });
      expect(references[0]).not.toHaveProperty("tool_calls");
      expect(replay.filter((message) => message.role === "user")).toEqual([
        { role: "user", content: USER },
      ]);
      const journal = readMcpTaskJournal(targetId);
      expect(journal.records).toEqual([]);
      expect(journal.deliveries).toEqual([]);
      const lease = acquireSessionHostLease(targetId, {
        hostKind: "nested-delivery-fork-test",
      });
      leases.push(lease);
      await expect(invoke(targetId, f.localId)).rejects.toMatchObject({
        code: "CC_MCP_TASK_NOT_FOUND",
      });
      lease.release();
      sourceId = targetId;
    }
  });

  it("requires the real fork boundary when legacy source logs lack generation markers", async () => {
    const f = await fixture();
    await invoke(f.sessionId, f.localId);
    const { forkSession } =
      await import("../../src/harness/jsonl-session-store.js");
    const { computeEventHash } =
      await import("../../src/harness/transcript-integrity.js");
    const { createMcpTaskJournalProjection } =
      await import("../../src/lib/mcp-task-journal-projection.js");
    const targetId = forkSession(f.sessionId);
    const copied = readEvents(targetId);
    const hashes = new Map();
    let previous = null;
    const legacy = copied.map((event, index) => {
      const data = structuredClone(event.data);
      if (index === 0) delete data._sessionGeneration;
      if (event.type === MCP_TASK_DELIVERY_EVENT)
        data.sourceEventHash = hashes.get(data.sourceEventHash);
      if (data._cc_fork_authority)
        data._cc_fork_authority.sourceHeadHash = hashes.get(
          data._cc_fork_authority.sourceHeadHash,
        );
      const core = { type: event.type, timestamp: event.timestamp, data };
      const hash = computeEventHash(previous, core);
      const result = { ...core, prevHash: previous, hash };
      hashes.set(event.hash, hash);
      previous = hash;
      return result;
    });
    const project = (events) => {
      const reducer = createMcpTaskJournalProjection(targetId, {
        retainResults: false,
      });
      for (const event of events) reducer.accept(event);
      return reducer.finish({
        headHash: events.at(-1).hash,
        eventCount: events.length,
      });
    };
    expect(project(legacy)).toMatchObject({ records: [], deliveries: [] });
    expect(project(legacy).callRecovery.incidents.length).toBeGreaterThan(0);
    expect(() => project(legacy.slice(0, -1))).toThrow(/fork ownership/);
    const malformed = structuredClone(legacy);
    malformed[0].data._sessionGeneration = { schema: "invalid" };
    expect(() => project(malformed)).toThrow(/generation source/);
  });

  it("rejects a corrupt legacy prefix before the first source hint even with a valid fork boundary", async () => {
    const f = await fixture();
    await invoke(f.sessionId, f.localId);
    const { forkSession } =
      await import("../../src/harness/jsonl-session-store.js");
    const { computeEventHash } =
      await import("../../src/harness/transcript-integrity.js");
    const { createMcpTaskJournalProjection } =
      await import("../../src/lib/mcp-task-journal-projection.js");
    const targetId = forkSession(f.sessionId);
    const copied = readEvents(targetId);
    const buildLegacy = (injectCorruption) => {
      const source = [...copied];
      const firstHint = source.findIndex(
        (event) => event.type === "mcp_call_ledger",
      );
      expect(firstHint).toBeGreaterThan(0);
      if (injectCorruption)
        source.splice(firstHint, 0, {
          type: "mcp_call_ledger",
          timestamp: source[firstHint].timestamp,
          data: {},
        });
      const hashes = new Map();
      let previous = null;
      return source.map((event, index) => {
        const data = structuredClone(event.data);
        if (index === 0) delete data._sessionGeneration;
        if (event.type === MCP_TASK_DELIVERY_EVENT)
          data.sourceEventHash = hashes.get(data.sourceEventHash);
        if (data._cc_fork_authority) {
          data._cc_fork_authority.sourceHeadHash = previous;
          data._cc_fork_authority.sourceEventCount = index;
        }
        const core = { type: event.type, timestamp: event.timestamp, data };
        const hash = computeEventHash(previous, core);
        const rebuilt = { ...core, prevHash: previous, hash };
        if (event.hash) hashes.set(event.hash, hash);
        previous = hash;
        return rebuilt;
      });
    };
    const project = (events) => {
      const reducer = createMcpTaskJournalProjection(targetId, {
        retainResults: false,
      });
      for (const event of events) reducer.accept(event);
      return reducer.finish({
        headHash: events.at(-1).hash,
        eventCount: events.length,
      });
    };
    // The same legacy source and real lineage are accepted without the bad prefix.
    expect(project(buildLegacy(false))).toMatchObject({
      records: [],
      deliveries: [],
    });
    const corrupt = buildLegacy(true);
    const lineage = corrupt.at(-1);
    expect(lineage.data._cc_fork_authority).toMatchObject({
      sourceSessionId: f.sessionId,
      sourceHeadHash: corrupt.at(-2).hash,
      sourceEventCount: corrupt.length - 1,
    });
    const saved = corrupt.find(
      (event) =>
        event.type === "mcp_task_ledger" && event.data.phase === "result_saved",
    );
    const delivered = corrupt.find(
      (event) => event.type === MCP_TASK_DELIVERY_EVENT,
    );
    expect(delivered.data.sourceEventHash).toBe(saved.hash);
    for (let index = 0; index < corrupt.length; index++) {
      const { type, timestamp, data, hash, prevHash } = corrupt[index];
      expect(prevHash).toBe(index === 0 ? null : corrupt[index - 1].hash);
      expect(hash).toBe(computeEventHash(prevHash, { type, timestamp, data }));
    }
    expect(() => project(corrupt)).toThrow();
  });

  it("preserves generic inspection of a corrupt old call ledger when no delivery exists", () => {
    const f = session();
    appendEvent(f.sessionId, "mcp_call_ledger", {});
    expect(messages(f.sessionId)).toEqual([{ role: "user", content: USER }]);
    expect(loadMcpLedgerRecovery(f.sessionId).incidents.length).toBeGreaterThan(
      0,
    );
    expect(() => readMcpTaskJournal(f.sessionId)).toThrow();
    expect(readSessionTranscriptHistory(f.sessionId).messages[0].text).toBe(
      USER,
    );
  });
});

describe("MCP model continuation authority", () => {
  it.each(["begin", "settle"])(
    "confirms a durable %s after its publication acknowledgement is lost",
    async (stage) => {
      const f = await fixture();
      await invoke(f.sessionId, f.localId);
      let started =
        stage === "settle"
          ? beginMcpTaskContinuation(f.sessionId, f.localId)
          : null;
      const previous = process.env.CC_SESSION_SCALE_FAULT_INJECTION;
      process.env.CC_SESSION_SCALE_FAULT_INJECTION = "1";
      let faulted = false;
      _sessionScaleFaultHooks.afterAntiRollbackPublish = ({ type }) => {
        if (
          type ===
          (stage === "begin"
            ? "mcp_task_continuation_started"
            : "assistant_message")
        ) {
          faulted = true;
          _sessionScaleFaultHooks.afterAntiRollbackPublish = null;
          throw Object.assign(new Error("lost continuation acknowledgement"), {
            code: "EIO",
          });
        }
      };
      try {
        if (stage === "begin")
          started = beginMcpTaskContinuation(f.sessionId, f.localId);
        else settleMcpTaskContinuation(f.sessionId, started, "saved once");
        expect(faulted).toBe(true);
        const continuation = readMcpTaskJournal(f.sessionId).continuations[0];
        expect(continuation.phase).toBe(
          stage === "begin" ? "started" : "settled",
        );
        expect(
          readEvents(f.sessionId).filter(
            (event) => event.type === "mcp_task_continuation_started",
          ),
        ).toHaveLength(1);
        expect(() =>
          beginMcpTaskContinuation(f.sessionId, f.localId),
        ).toThrow();
        if (stage === "settle")
          expect(
            messages(f.sessionId).filter(
              (item) => item.content === "saved once",
            ),
          ).toHaveLength(1);
      } finally {
        _sessionScaleFaultHooks.afterAntiRollbackPublish = null;
        if (previous === undefined)
          delete process.env.CC_SESSION_SCALE_FAULT_INJECTION;
        else process.env.CC_SESSION_SCALE_FAULT_INJECTION = previous;
      }
    },
  );
  it("resumes an adjacent verified external reference and model answer without inventing a user turn", async () => {
    const f = await fixture();
    await invoke(f.sessionId, f.localId);
    const started = beginMcpTaskContinuation(f.sessionId, f.localId);
    settleMcpTaskContinuation(f.sessionId, started, "answer after reference");
    const { prepareReplJsonlResumeCandidate } =
      await import("../../src/repl/agent-repl.js");
    const prepared = prepareReplJsonlResumeCandidate(f.sessionId);
    expect(prepared.ok).toBe(true);
    expect(
      prepared.conversationMessages.filter((item) => item.role === "user"),
    ).toHaveLength(1);
    expect(prepared.conversationMessages.at(-1)).toEqual({
      role: "assistant",
      content: "answer after reference",
    });
  });
  it("binds one assistant answer to its original delivery without a fabricated user turn", async () => {
    const f = await fixture();
    const delivered = await invoke(f.sessionId, f.localId);
    appendUserMessage(
      f.sessionId,
      `A genuine quoted ID: ${delivered.deliveryId}`,
    );
    const started = beginMcpTaskContinuation(f.sessionId, f.localId);
    expect(started).toMatchObject({
      phase: "started",
      deliveryEventHash: delivered.eventHash,
    });
    expect(readMcpTaskJournal(f.sessionId).continuations[0].phase).toBe(
      "started",
    );
    expect(listDurableMcpTasks(f.sessionId).records[0]).toMatchObject({
      continuationStatus: "started",
      continuationOutcomeUnknown: true,
    });
    const settled = settleMcpTaskContinuation(
      f.sessionId,
      started,
      "actual model answer",
    );
    expect(settled).toMatchObject({
      phase: "settled",
      beginEventHash: started.beginEventHash,
    });
    expect(listDurableMcpTasks(f.sessionId).records[0]).toMatchObject({
      continuationStatus: "settled",
      continuationOutcomeUnknown: false,
    });
    expect(messages(f.sessionId)).toEqual([
      { role: "user", content: USER },
      started.delivery.message,
      { role: "user", content: `A genuine quoted ID: ${delivered.deliveryId}` },
      { role: "assistant", content: "actual model answer" },
    ]);
    expect(
      readEvents(f.sessionId).filter(
        (e) =>
          e.type === "assistant_message" && e.data[MCP_TASK_CONTINUATION_FIELD],
      ),
    ).toHaveLength(1);
    expect(() => beginMcpTaskContinuation(f.sessionId, f.localId)).toThrow(
      expect.objectContaining({
        code: "CC_MCP_TASK_CONTINUATION_ALREADY_STARTED",
      }),
    );
    expect(() =>
      settleMcpTaskContinuation(f.sessionId, started, "duplicate"),
    ).toThrow();
    appendCompactEvent(f.sessionId, { messages: messages(f.sessionId) });
    expect(readMcpTaskJournal(f.sessionId).continuations[0].phase).toBe(
      "settled",
    );
    expect(messages(f.sessionId).at(-1)).toEqual({
      role: "assistant",
      content: "actual model answer",
    });
    const { prepareReplJsonlResumeCandidate } =
      await import("../../src/repl/agent-repl.js");
    expect(prepareReplJsonlResumeCandidate(f.sessionId)).toMatchObject({
      ok: true,
    });
  });

  it("does not admit a continuation before delivery", async () => {
    const f = await fixture();
    expect(() => beginMcpTaskContinuation(f.sessionId, f.localId)).toThrow(
      expect.objectContaining({
        code: "CC_MCP_TASK_CONTINUATION_DELIVERY_REQUIRED",
      }),
    );
    expect(readMcpTaskJournal(f.sessionId).continuations).toEqual([]);
  });

  it("requires a real user task, not a task artifact alone", async () => {
    const f = await fixture({ user: false });
    await invoke(f.sessionId, f.localId);
    expect(() => beginMcpTaskContinuation(f.sessionId, f.localId)).toThrow(
      expect.objectContaining({
        code: "CC_MCP_TASK_CONTINUATION_USER_TASK_REQUIRED",
      }),
    );
    expect(readMcpTaskJournal(f.sessionId).continuations).toEqual([]);
  });

  it("holds an ambiguous legacy wake for review without declaring it complete", async () => {
    const f = await fixture();
    const delivered = await invoke(f.sessionId, f.localId);
    appendUserMessage(
      f.sessionId,
      `Continue from the verified background MCP task result (deliveryId: ${delivered.deliveryId}).`,
    );
    expect(() => beginMcpTaskContinuation(f.sessionId, f.localId)).toThrow(
      expect.objectContaining({
        code: "CC_MCP_TASK_CONTINUATION_LEGACY_REVIEW_REQUIRED",
      }),
    );
    expect(readMcpTaskJournal(f.sessionId).continuations).toEqual([]);
  });

  it("never automatically replays a started continuation after host takeover", async () => {
    const f = await fixture();
    await invoke(f.sessionId, f.localId);
    const started = beginMcpTaskContinuation(f.sessionId, f.localId);
    f.lease.release();
    expect(() =>
      settleMcpTaskContinuation(f.sessionId, started, "late result"),
    ).toThrow(
      expect.objectContaining({
        code: "CC_MCP_TASK_CONTINUATION_LEASE_REQUIRED",
      }),
    );
    leases.push(
      acquireSessionHostLease(f.sessionId, {
        hostKind: "mcp-continuation-resumed",
      }),
    );
    expect(() => beginMcpTaskContinuation(f.sessionId, f.localId)).toThrow(
      expect.objectContaining({
        code: "CC_MCP_TASK_CONTINUATION_ALREADY_STARTED",
      }),
    );
    expect(readMcpTaskJournal(f.sessionId).continuations[0].phase).toBe(
      "started",
    );
    expect(messages(f.sessionId)).toHaveLength(2);
  });

  it.each(["beginEventHash", "deliveryEventHash", "outputDigest"])(
    "rejects a chain-valid answer with a false %s in every verified reader",
    async (field) => {
      const f = await fixture();
      await invoke(f.sessionId, f.localId);
      const started = beginMcpTaskContinuation(f.sessionId, f.localId);
      const message = structuredClone(
        createMcpTaskContinuationMessage(started, "forged"),
      );
      message[MCP_TASK_CONTINUATION_FIELD][field] =
        field === "outputDigest" ? "sha256:" + "b".repeat(64) : "b".repeat(64);
      appendEvent(f.sessionId, "assistant_message", message);
      expect(() => messages(f.sessionId)).toThrow();
      expect(() => readMcpTaskJournal(f.sessionId)).toThrow();
      expect(() => readSessionTranscriptHistory(f.sessionId)).toThrow();
    },
  );

  it("does not accept an orphan assistant consumption marker without any delivery", () => {
    const f = session();
    appendEvent(f.sessionId, "assistant_message", {
      role: "assistant",
      content: "orphan",
      [MCP_TASK_CONTINUATION_FIELD]: {},
    });
    expect(() => messages(f.sessionId)).toThrow();
  });

  it("preserves an answer in a fork without transferring continuation control", async () => {
    const { forkSession } =
      await import("../../src/harness/jsonl-session-store.js");
    const f = await fixture();
    await invoke(f.sessionId, f.localId);
    const started = beginMcpTaskContinuation(f.sessionId, f.localId);
    settleMcpTaskContinuation(f.sessionId, started, "completed answer");
    const fork = forkSession(f.sessionId);
    const targetId = typeof fork === "string" ? fork : fork.id;
    expect(readMcpTaskJournal(targetId)).toMatchObject({
      records: [],
      deliveries: [],
      continuations: [],
    });
    expect(messages(targetId)).toContainEqual({
      role: "assistant",
      content: "completed answer",
    });
  });
});
