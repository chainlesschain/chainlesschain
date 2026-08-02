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
    appendAuthorityEventIfHead: vi.fn(() => ({ hash: "head-2" })),
  };
});

const store = await import("../../src/harness/jsonl-session-store.js");
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
    store.appendAuthorityEventIfHead.mockImplementation(() => ({
      hash: "head-2",
    }));
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
    store.readVerifiedMessages.mockReturnValue(manyMessages(40));
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
    store.readVerifiedMessages.mockReturnValue(manyMessages(40));
    await runCompact(["sess-1", "--dry-run"]);
    expect(store.appendAuthorityEventIfHead).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining("Would compact"),
    );
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
