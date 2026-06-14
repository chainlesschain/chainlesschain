/**
 * Unit tests for `cc insights [id]` (src/commands/insights.js).
 * The JSONL store + config are mocked; the REAL analyzer + price table run.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";

vi.mock("../../src/lib/logger.js", () => ({
  logger: { log: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../src/harness/jsonl-session-store.js", () => ({
  sessionExists: vi.fn(() => true),
  readEvents: vi.fn(() => []),
  getLastSessionId: vi.fn(() => "last-session"),
}));
vi.mock("../../src/lib/config-manager.js", () => ({
  loadConfig: vi.fn(() => ({ llm: {} })),
}));

const store = await import("../../src/harness/jsonl-session-store.js");
const { logger } = await import("../../src/lib/logger.js");
const { registerInsightsCommand } = await import(
  "../../src/commands/insights.js"
);

const T0 = 1_700_000_000_000;
const sampleEvents = [
  {
    type: "session_start",
    timestamp: T0,
    data: { title: "t", model: "claude-opus", provider: "anthropic" },
  },
  { type: "user_message", timestamp: T0 + 1000, data: { content: "hi" } },
  {
    type: "token_usage",
    timestamp: T0 + 2000,
    data: {
      provider: "anthropic",
      model: "claude-opus",
      usage: { input_tokens: 1_000_000, output_tokens: 0 },
    },
  },
  { type: "assistant_message", timestamp: T0 + 3000, data: { content: "ok" } },
];

async function run(args) {
  const program = new Command();
  program.exitOverride();
  registerInsightsCommand(program);
  await program.parseAsync(["node", "cc", "insights", ...args]);
}

describe("cc insights", () => {
  let logSpy;
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = 0;
    store.sessionExists.mockReturnValue(true);
    store.getLastSessionId.mockReturnValue("last-session");
    store.readEvents.mockReturnValue(sampleEvents);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("--json emits a structured report with cost", async () => {
    await run(["sess-1", "--json"]);
    const payload = JSON.parse(logSpy.mock.calls.at(-1)[0]);
    expect(payload.sessionId).toBe("sess-1");
    expect(payload.messages.total).toBe(2);
    expect(payload.usage.total.totalTokens).toBe(1_000_000);
    // anthropic opus = $15 / 1M input → cost ≈ 15
    expect(payload.cost.totalCost).toBeCloseTo(15, 4);
  });

  it("defaults to the most-recent session", async () => {
    await run(["--json"]);
    expect(store.getLastSessionId).toHaveBeenCalled();
    const payload = JSON.parse(logSpy.mock.calls.at(-1)[0]);
    expect(payload.sessionId).toBe("last-session");
  });

  it("errors on an unknown session id", async () => {
    store.sessionExists.mockReturnValue(false);
    await run(["nope"]);
    expect(process.exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalled();
  });

  it("handles no sessions found", async () => {
    store.getLastSessionId.mockReturnValue(null);
    await run(["--json"]);
    const payload = JSON.parse(logSpy.mock.calls.at(-1)[0]);
    expect(payload.error).toMatch(/no sessions/);
  });

  it("pretty-prints without --json", async () => {
    await run(["sess-1"]);
    expect(logger.log).toHaveBeenCalled();
    const text = logger.log.mock.calls.map((c) => c[0]).join("\n");
    expect(text).toMatch(/Insights — session/);
    expect(text).toMatch(/tokens:/);
  });
});
