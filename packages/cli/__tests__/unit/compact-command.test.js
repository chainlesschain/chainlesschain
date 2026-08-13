/**
 * Unit tests for `cc compact <session-id>` (src/commands/compact.js).
 *
 * The JSONL store and logger are mocked; the REAL PromptCompressor runs so the
 * command's integration with it is exercised. The command is driven through a
 * Commander program exactly as the CLI wires it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";

vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    log: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    verbose: vi.fn(),
    warn: vi.fn(),
  },
}));
vi.mock("../../src/harness/jsonl-session-store.js", () => {
  const readEvents = vi.fn(() => [
    { type: "session_start", data: { model: "", provider: "" } },
  ]);
  const readVerifiedMessages = vi.fn(() => []);
  return {
    sessionExists: vi.fn(() => true),
    readEvents,
    readVerifiedMessages,
    readVerifiedProjection: vi.fn((_sessionId, createProjection) => {
      const projection = createProjection();
      const events = readEvents();
      for (const event of events) projection.accept(event);
      return projection.finish({
        headHash: "head-1",
        eventCount: events.length,
        readMessages: () => readVerifiedMessages(),
      });
    }),
    appendEventIfHead: vi.fn((_sessionId, _type, _data, expectedHead) => ({
      hash: `${expectedHead}-next`,
    })),
    appendAuthorityEventIfHead: vi.fn(() => ({ hash: "head-2" })),
  };
});
vi.mock("../../src/runtime/agent-core.js", () => ({
  chatWithTools: vi.fn(),
}));

const store = await import("../../src/harness/jsonl-session-store.js");
const { chatWithTools } = await import("../../src/runtime/agent-core.js");
const { logger } = await import("../../src/lib/logger.js");
const { registerCompactCommand } =
  await import("../../src/commands/compact.js");

/** Build N alternating user/assistant messages (no system at index 0). */
function manyMessages(n) {
  const out = [{ role: "system", content: "sys" }];
  for (let i = 0; i < n; i++) {
    out.push({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `message number ${i} with some filler words to add token weight`,
    });
  }
  return out;
}

function semanticMessages(n) {
  const out = [{ role: "system", content: "sys" }];
  for (let i = 0; i < n; i++) {
    out.push({
      role: i % 2 === 0 ? "user" : "assistant",
      content: String.fromCodePoint(0x4e00 + i).repeat(80),
    });
  }
  return out;
}

const structuredSummary = JSON.stringify({
  objective: "Compact the durable session",
  constraints: [],
  keyDecisions: ["Keep model usage auditable"],
  changedFiles: [],
  tests: [],
  unresolvedSideEffects: [],
  checkpoints: [],
  blockers: [],
  nextSteps: ["Resume from the compact event"],
});

async function runCompact(args) {
  const program = new Command();
  program.exitOverride(); // throw instead of process.exit
  registerCompactCommand(program);
  await program.parseAsync(["node", "cc", "compact", ...args]);
}

describe("cc compact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = 0;
    store.sessionExists.mockReturnValue(true);
    store.readEvents.mockReturnValue([
      { type: "session_start", data: { model: "", provider: "" } },
    ]);
    store.readVerifiedMessages.mockReturnValue([]);
    store.appendEventIfHead.mockImplementation(
      (_sessionId, _type, _data, expectedHead) => ({
        hash: `${expectedHead}-next`,
      }),
    );
    store.appendAuthorityEventIfHead.mockImplementation(() => ({
      hash: "head-2",
    }));
    chatWithTools.mockReset();
    chatWithTools.mockResolvedValue({
      message: { content: structuredSummary },
      usage: { input_tokens: 100, output_tokens: 20 },
    });
  });

  it("errors with exit code 1 when the session does not exist", async () => {
    store.sessionExists.mockReturnValue(false);
    await runCompact(["nope"]);
    expect(process.exitCode).toBe(1);
    expect(store.appendAuthorityEventIfHead).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("no such session"),
    );
  });

  it("compacts and persists a long session", async () => {
    store.readVerifiedMessages.mockReturnValue(semanticMessages(40));
    await runCompact(["sess-1"]);
    expect(store.appendAuthorityEventIfHead).toHaveBeenCalledTimes(1);
    const [sid, type, payload, expectedHead] =
      store.appendAuthorityEventIfHead.mock.calls[0];
    expect(sid).toBe("sess-1");
    expect(type).toBe("compact");
    expect(expectedHead).toBe("head-1");
    // The persisted compact event carries the shortened message array...
    expect(payload.messages.length).toBeLessThan(41);
    // ...and the stats the resume path / `cc cost` can read.
    expect(payload.compressedMessages).toBeLessThan(payload.originalMessages);
    expect(payload.saved).toBeGreaterThan(0);
    expect(process.exitCode).toBe(0);
  });

  it("does NOT write anything in --dry-run mode", async () => {
    store.readEvents.mockReturnValue([
      {
        type: "session_start",
        data: { model: "gpt-4o", provider: "openai" },
      },
    ]);
    store.readVerifiedMessages.mockReturnValue(semanticMessages(40));
    await runCompact(["sess-1", "--dry-run", "--max-messages", "5"]);
    expect(chatWithTools).not.toHaveBeenCalled();
    expect(store.appendEventIfHead).not.toHaveBeenCalled();
    expect(store.appendAuthorityEventIfHead).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining("Would compact"),
    );
  });

  it("persists a complete semantic model-call ledger before the compact CAS", async () => {
    store.readEvents.mockReturnValue([
      {
        type: "session_start",
        data: { model: "gpt-4o", provider: "openai" },
      },
    ]);
    store.readVerifiedMessages.mockReturnValue(semanticMessages(40));
    store.appendEventIfHead
      .mockReturnValueOnce({ hash: "head-started" })
      .mockReturnValueOnce({ hash: "head-settled" });

    await runCompact(["sess-1", "--max-messages", "5"]);

    expect(chatWithTools).toHaveBeenCalledOnce();
    expect(store.appendEventIfHead).toHaveBeenCalledTimes(2);
    const started = store.appendEventIfHead.mock.calls[0];
    const settled = store.appendEventIfHead.mock.calls[1];
    expect(store.appendEventIfHead.mock.invocationCallOrder[0]).toBeLessThan(
      chatWithTools.mock.invocationCallOrder[0],
    );
    expect(chatWithTools.mock.invocationCallOrder[0]).toBeLessThan(
      store.appendEventIfHead.mock.invocationCallOrder[1],
    );
    expect(started).toMatchObject([
      "sess-1",
      "model_usage_started",
      {
        provider: "openai",
        model: "gpt-4o",
        source: "semantic-compaction",
      },
      "head-1",
    ]);
    expect(settled).toMatchObject([
      "sess-1",
      "token_usage",
      {
        provider: "openai",
        model: "gpt-4o",
        source: "semantic-compaction",
        usage: { input_tokens: 100, output_tokens: 20 },
      },
      "head-started",
    ]);
    expect(settled[2].callId).toBe(started[2].callId);
    const compactPayload = store.appendAuthorityEventIfHead.mock.calls[0]?.[2];
    expect(compactPayload).toMatchObject({
      summaryCallId: started[2].callId,
      summaryUsageLedgerSettled: true,
    });
    expect(store.appendAuthorityEventIfHead).toHaveBeenCalledWith(
      "sess-1",
      "compact",
      expect.any(Object),
      "head-settled",
    );
  });

  it("settles a provider exception as unknown before the offline fallback persists", async () => {
    store.readEvents.mockReturnValue([
      {
        type: "session_start",
        data: { model: "gpt-4o", provider: "openai" },
      },
    ]);
    store.readVerifiedMessages.mockReturnValue(semanticMessages(40));
    chatWithTools.mockRejectedValue(
      new Error("connection reset after request upload"),
    );

    await runCompact(["sess-1", "--max-messages", "5"]);

    const [started, unknown] = store.appendEventIfHead.mock.calls;
    expect(unknown).toMatchObject([
      "sess-1",
      "model_usage_unknown",
      {
        callId: started[2].callId,
        provider: "openai",
        model: "gpt-4o",
        source: "semantic-compaction",
        code: "provider_call_failed",
      },
      "head-1-next",
    ]);
    expect(store.appendAuthorityEventIfHead).toHaveBeenCalledWith(
      "sess-1",
      "compact",
      expect.objectContaining({
        degraded: true,
        summaryCallId: started[2].callId,
        summaryUsageLedgerSettled: true,
      }),
      "head-1-next-next",
    );
    expect(process.exitCode).toBe(0);
  });

  it("settles missing provider usage as unknown with the same call id", async () => {
    store.readEvents.mockReturnValue([
      {
        type: "session_start",
        data: { model: "gpt-4o", provider: "openai" },
      },
    ]);
    store.readVerifiedMessages.mockReturnValue(semanticMessages(40));
    chatWithTools.mockResolvedValue({
      message: { content: structuredSummary },
    });

    await runCompact(["sess-1", "--max-messages", "5"]);

    const [started, unknown] = store.appendEventIfHead.mock.calls;
    expect(started[1]).toBe("model_usage_started");
    expect(unknown[1]).toBe("model_usage_unknown");
    expect(unknown[2]).toMatchObject({
      callId: started[2].callId,
      provider: "openai",
      model: "gpt-4o",
      source: "semantic-compaction",
      code: "provider_usage_missing",
    });
    expect(store.appendAuthorityEventIfHead).toHaveBeenCalledWith(
      "sess-1",
      "compact",
      expect.any(Object),
      "head-1-next-next",
    );
  });

  it("fails closed before provider spend when the started row cannot persist", async () => {
    store.readEvents.mockReturnValue([
      {
        type: "session_start",
        data: { model: "gpt-4o", provider: "openai" },
      },
    ]);
    store.readVerifiedMessages.mockReturnValue(semanticMessages(40));
    store.appendEventIfHead.mockImplementationOnce(() => {
      const error = new Error("session changed");
      error.code = "SESSION_REVISION_STALE";
      throw error;
    });

    await runCompact(["sess-1", "--max-messages", "5"]);

    expect(chatWithTools).not.toHaveBeenCalled();
    expect(store.appendAuthorityEventIfHead).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("fails closed when the known settlement loses its CAS race", async () => {
    store.readEvents.mockReturnValue([
      {
        type: "session_start",
        data: { model: "gpt-4o", provider: "openai" },
      },
    ]);
    store.readVerifiedMessages.mockReturnValue(semanticMessages(40));
    store.appendEventIfHead
      .mockReturnValueOnce({ hash: "head-started" })
      .mockImplementationOnce(() => {
        const error = new Error("session changed");
        error.code = "SESSION_REVISION_STALE";
        throw error;
      });

    await runCompact(["sess-1", "--max-messages", "5"]);

    expect(chatWithTools).toHaveBeenCalledOnce();
    expect(store.appendAuthorityEventIfHead).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("reports nothing-to-compact for a short session and writes nothing", async () => {
    store.readVerifiedMessages.mockReturnValue([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
    await runCompact(["sess-1"]);
    expect(store.appendAuthorityEventIfHead).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining("Nothing to compact"),
    );
    expect(process.exitCode).toBe(0);
  });

  it("emits JSON when --json is passed", async () => {
    store.readVerifiedMessages.mockReturnValue(manyMessages(40));
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await runCompact(["sess-1", "--json"]);
    const printed = spy.mock.calls.map((c) => c[0]).join("\n");
    spy.mockRestore();
    const parsed = JSON.parse(printed);
    expect(parsed.sessionId).toBe("sess-1");
    expect(parsed.dryRun).toBe(false);
    expect(parsed.stats.saved).toBeGreaterThan(0);
  });

  it("rejects a stale compact snapshot instead of overwriting a concurrent turn", async () => {
    store.readVerifiedMessages.mockReturnValue(manyMessages(40));
    store.appendAuthorityEventIfHead.mockImplementationOnce(() => {
      const error = new Error("stale");
      error.code = "SESSION_REVISION_STALE";
      throw error;
    });

    await runCompact(["sess-1"]);

    expect(store.appendAuthorityEventIfHead).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("session changed while compacting; retry"),
    );
  });
});
