import { afterAll, describe, expect, it, vi } from "vitest";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const root = mkdtempSync(join(tmpdir(), "cc-mcp-task-journal-"));
vi.mock("../../src/lib/paths.js", () => ({
  getHomeDir: () => join(root, "home"),
  getSessionStoreDir: () => join(root, "home", "sessions"),
  getClaudeProjectStorageDir: () => null,
  getStatePath: () => join(root, "home", "state"),
  getMachineSecurityAnchorDir: () => join(root, "security"),
}));
const { startSession, appendEvent, appendCompactEvent, readEvents } =
  await import("../../src/harness/jsonl-session-store.js");
const { createMcpCallLedger } =
  await import("../../src/lib/mcp-call-ledger.js");
const { createSessionMcpLedgerSink } =
  await import("../../src/lib/mcp-call-ledger-store.js");
const { appendMcpTaskJournalEvent: append, readMcpTaskJournal: read } =
  await import("../../src/lib/mcp-task-journal.js");

afterAll(() => rmSync(root, { recursive: true, force: true }));
const at = "2026-11-08T00:00:00.000Z";
const task = (status = "working", taskId = "opaque:task/1") => ({
  taskId,
  status,
  createdAt: at,
  lastUpdatedAt: at,
  ttl: null,
});
const result = (taskId = "opaque:task/1") => ({
  content: [{ type: "text", text: "private task result" }],
  _meta: { "io.modelcontextprotocol/related-task": { taskId } },
});

async function fixture() {
  const id = "task-" + randomUUID();
  startSession(id, { provider: "test", model: "test" });
  const ledger = createMcpCallLedger({ sink: createSessionMcpLedgerSink(id) });
  const ticket = await ledger.begin({
    sessionId: id,
    toolName: "work",
    serverName: "test",
    input: { privateArgument: "never-persist-this" },
    effectContract: { effect: "write" },
  });
  const localId = randomUUID();
  const prepared = {
    schemaVersion: 1,
    phase: "prepared",
    localId,
    revision: 0,
    sessionId: id,
    serverName: "test",
    toolName: "work",
    ledgerId: ticket.ledgerId,
    inputDigest: ticket.record.inputDigest,
    identityDigest: "hmac-sha256:" + "a".repeat(64),
    secretRef: "mcp-task/" + localId,
    at,
  };
  const event = (phase, revision, extra = {}) => ({
    schemaVersion: 1,
    phase,
    localId,
    revision,
    sessionId: id,
    at,
    ...extra,
  });
  return { id, prepared, event, ticket };
}

function rejectedWithoutWrite(id, data) {
  const before = readEvents(id);
  expect(() => append(id, data)).toThrow();
  expect(readEvents(id)).toEqual(before);
}

describe("canonical MCP task journal", () => {
  it("reopens complete task authority across compaction and old call settlement", async () => {
    const f = await fixture();
    const prepared = append(f.id, f.prepared);
    expect(prepared).toMatchObject({
      phase: "prepared",
      task: null,
      result: null,
      cancelRequested: false,
      cancelUnknown: false,
    });
    append(f.id, f.event("accepted", 1, { task: task() }));
    append(f.id, f.event("observed", 2, { task: task("input_required") }));
    const saved = append(
      f.id,
      f.event("result_saved", 3, { result: result() }),
    );
    expect(saved.result).toEqual(result());
    await f.ticket.settle({ output: result() });
    appendCompactEvent(f.id, {
      messages: [{ role: "assistant", content: "summary" }],
    });
    // A fresh projection uses only the canonical file, not a module task cache.
    const reopened = read(f.id);
    expect(reopened.records).toEqual([saved]);
    expect(reopened.callRecovery.records[0].status).toBe("completed");
    expect(reopened.callRecovery.unsettled).toEqual([]);
    expect(reopened.headHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(Object.isFrozen(reopened.records[0].result.content[0])).toBe(true);
    expect(
      Object.isFrozen(reopened.callRecovery.records[0].effectContract),
    ).toBe(true);
    expect(
      readFileSync(join(root, "home", "sessions", f.id + ".jsonl"), "utf8"),
    ).not.toContain("never-persist-this");
  });

  it("persists cancelled and unknown acknowledgements without fabricating completion", async () => {
    const f = await fixture();
    append(f.id, f.prepared);
    append(f.id, f.event("accepted", 1, { task: task() }));
    append(f.id, f.event("cancel_requested", 2));
    const unknown = append(f.id, f.event("cancel_unknown", 3));
    expect(unknown).toMatchObject({
      cancelRequested: true,
      cancelUnknown: true,
      task: { status: "working" },
    });
    const observed = append(
      f.id,
      f.event("observed", 4, { task: task("cancelled") }),
    );
    expect(observed.task.status).toBe("cancelled");
    expect(read(f.id).callRecovery.unsettled).toHaveLength(1);
  });

  it.each([
    "sessionId",
    "serverName",
    "toolName",
    "inputDigest",
    "ledgerId",
    "secretRef",
  ])("rejects prepared %s binding mismatch before appending", async (field) => {
    const f = await fixture();
    const value =
      field === "inputDigest"
        ? "sha256:" + "b".repeat(64)
        : field === "secretRef"
          ? "mcp-task/" + randomUUID()
          : "other";
    rejectedWithoutWrite(f.id, { ...f.prepared, [field]: value });
  });

  it("rejects duplicate local IDs and two tasks bound to the same started call", async () => {
    const f = await fixture();
    append(f.id, f.prepared);
    rejectedWithoutWrite(f.id, f.prepared);
    const second = randomUUID();
    rejectedWithoutWrite(f.id, {
      ...f.prepared,
      localId: second,
      secretRef: "mcp-task/" + second,
    });
  });

  it("requires a currently started call, not a terminal call", async () => {
    const f = await fixture();
    await f.ticket.settle({ output: { content: [] } });
    rejectedWithoutWrite(f.id, f.prepared);
  });

  it("rejects skipped revisions, duplicate acceptance and invalid phase transitions", async () => {
    const f = await fixture();
    append(f.id, f.prepared);
    rejectedWithoutWrite(f.id, f.event("accepted", 2, { task: task() }));
    rejectedWithoutWrite(f.id, f.event("cancel_requested", 1));
    rejectedWithoutWrite(f.id, f.event("cancel_unknown", 1));
    rejectedWithoutWrite(
      f.id,
      f.event("result_saved", 1, { result: result() }),
    );
    append(f.id, f.event("accepted", 1, { task: task() }));
    rejectedWithoutWrite(f.id, f.event("accepted", 2, { task: task() }));
    rejectedWithoutWrite(f.id, f.event("cancel_unknown", 2));
  });

  it("binds task IDs and creation identity, then refuses terminal regression", async () => {
    const f = await fixture();
    append(f.id, f.prepared);
    append(f.id, f.event("accepted", 1, { task: task() }));
    rejectedWithoutWrite(
      f.id,
      f.event("observed", 2, { task: task("working", "other") }),
    );
    rejectedWithoutWrite(
      f.id,
      f.event("observed", 2, {
        task: { ...task(), createdAt: "2026-11-09T00:00:00.000Z" },
      }),
    );
    append(f.id, f.event("observed", 2, { task: task("failed") }));
    rejectedWithoutWrite(
      f.id,
      f.event("observed", 3, { task: task("working") }),
    );
    rejectedWithoutWrite(
      f.id,
      f.event("observed", 3, { task: task("completed") }),
    );
    expect(
      append(f.id, f.event("observed", 3, { task: task("failed") })).revision,
    ).toBe(3);
  });

  it("saves a matching result exactly once and forbids later observations", async () => {
    const f = await fixture();
    append(f.id, f.prepared);
    append(f.id, f.event("accepted", 1, { task: task() }));
    rejectedWithoutWrite(
      f.id,
      f.event("result_saved", 2, { result: result("wrong") }),
    );
    append(f.id, f.event("result_saved", 2, { result: result() }));
    rejectedWithoutWrite(
      f.id,
      f.event("result_saved", 3, { result: result() }),
    );
    rejectedWithoutWrite(
      f.id,
      f.event("observed", 3, { task: task("completed") }),
    );
    rejectedWithoutWrite(f.id, f.event("cancel_requested", 3));
  });

  it("refuses accessors, unknown fields and oversized data before writing", async () => {
    const f = await fixture();
    const getter = vi.fn();
    const unsafe = Object.defineProperty({ ...f.prepared }, "headers", {
      enumerable: true,
      get: getter,
    });
    rejectedWithoutWrite(f.id, unsafe);
    expect(getter).not.toHaveBeenCalled();
    rejectedWithoutWrite(f.id, {
      ...f.prepared,
      headers: { Authorization: "secret" },
    });
    append(f.id, f.prepared);
    rejectedWithoutWrite(
      f.id,
      f.event("accepted", 1, { task: { ...task(), unknown: "x" } }),
    );
    append(f.id, f.event("accepted", 1, { task: task() }));
    rejectedWithoutWrite(
      f.id,
      f.event("result_saved", 2, {
        result: {
          ...result(),
          content: [{ type: "text", text: "x".repeat(1024 * 1024) }],
        },
      }),
    );
  });

  it("fails closed for semantically corrupt task and old-call events", async () => {
    const f = await fixture();
    append(f.id, f.prepared);
    appendEvent(
      f.id,
      "mcp_task_ledger",
      f.event("observed", 1, { task: task() }),
    );
    expect(() => read(f.id)).toThrow();
    const g = await fixture();
    appendEvent(g.id, "mcp_call_ledger", {});
    expect(() => read(g.id)).toThrow();
    expect(() => append(g.id, g.prepared)).toThrow();
  });

  it("refuses a broken physical journal and missing session without bootstrapping", async () => {
    const f = await fixture();
    append(f.id, f.prepared);
    appendFileSync(
      join(root, "home", "sessions", f.id + ".jsonl"),
      '{"type":"mcp_task_ledger","data":{}}\n',
    );
    expect(() => read(f.id)).toThrow();
    expect(() => read("missing-" + randomUUID())).toThrow();
  });
});

it("rejects a foreign-session call even when its event chain is valid", async () => {
  const source = await fixture();
  const target = "foreign-" + randomUUID();
  startSession(target, { provider: "test" });
  const started = readEvents(source.id).find(
    (event) => event.type === "mcp_call_ledger",
  );
  appendEvent(target, "mcp_call_ledger", started.data);
  expect(() => read(target)).toThrow();
  expect(() =>
    append(target, { ...source.prepared, sessionId: target }),
  ).toThrow();
});

it.each(["beforeTranscriptAppend", "afterAntiRollbackPublish"])(
  "returns a record only after verified commit at %s",
  async (hookName) => {
    const f = await fixture();
    const { _sessionScaleFaultHooks } =
      await import("../../src/harness/jsonl-session-store.js");
    const previous = process.env.CC_SESSION_SCALE_FAULT_INJECTION;
    process.env.CC_SESSION_SCALE_FAULT_INJECTION = "1";
    _sessionScaleFaultHooks[hookName] = ({ type }) => {
      if (type === "mcp_task_ledger") {
        _sessionScaleFaultHooks[hookName] = null;
        throw Object.assign(new Error("simulated journal fault"), {
          code: "EIO",
        });
      }
    };
    try {
      if (hookName === "beforeTranscriptAppend") {
        expect(() => append(f.id, f.prepared)).toThrow();
        expect(read(f.id).records).toEqual([]);
        expect(read(f.id).callRecovery.unsettled).toHaveLength(1);
      } else {
        const saved = append(f.id, f.prepared);
        expect(read(f.id).records).toEqual([saved]);
        expect(
          readEvents(f.id).filter((event) => event.type === "mcp_task_ledger"),
        ).toHaveLength(1);
      }
    } finally {
      _sessionScaleFaultHooks[hookName] = null;
      if (previous === undefined)
        delete process.env.CC_SESSION_SCALE_FAULT_INJECTION;
      else process.env.CC_SESSION_SCALE_FAULT_INJECTION = previous;
    }
  },
);
