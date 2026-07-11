/**
 * Integration: 用量归因 end-to-end through the REAL JSONL store on a temp
 * home dir.
 *
 *  - The REPL agentLoop wrapper persists compact tool_call events
 *    ({tool, is_error, skill?} — never args) for a session-bound run.
 *  - appendTokenUsage carries the attribution frame into the transcript and
 *    extractUsage/sessionUsage read it back.
 *  - `cc session usage <id> --json` includes the attribution section;
 *    `--by tool|origin|mcp` renders the breakdown; the DEFAULT output is
 *    unchanged; an invalid --by is rejected.
 *  - Mixed-generation compat: a transcript with pre-attribution events only
 *    aggregates exactly as before.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";

let tmpHome;

function mockPaths() {
  vi.doMock("../../src/lib/paths.js", () => ({
    getHomeDir: () => tmpHome,
    getBinDir: () => path.join(tmpHome, "bin"),
    getConfigPath: () => path.join(tmpHome, "config.json"),
    getStatePath: () => path.join(tmpHome, "state"),
    getPidFilePath: () => path.join(tmpHome, "state", "app.pid"),
    getServicesDir: () => path.join(tmpHome, "services"),
    getLogsDir: () => path.join(tmpHome, "logs"),
    getCacheDir: () => path.join(tmpHome, "cache"),
    ensureDir: (p) => {
      if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
      return p;
    },
    ensureHomeDir: () => tmpHome,
  }));
}

function captureStdout(fn) {
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => logs.push(args.join(" "));
  return Promise.resolve(fn())
    .then(() => logs)
    .finally(() => {
      console.log = origLog;
    });
}

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "cli-usage-attr-"));
  vi.resetModules();
  mockPaths();
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  vi.doUnmock("../../src/lib/paths.js");
});

/** Build a transcript via the real store: 1 turn, tools, main + attributed usage. */
async function seedSession(id) {
  const store = await import("../../src/harness/jsonl-session-store.js");
  store.startSession(id, {
    title: "attr",
    provider: "anthropic",
    model: "claude-opus-4-8",
  });
  store.appendUserMessage(id, "do the thing");
  store.appendToolCallCompact(id, { tool: "read_file", isError: false });
  store.appendToolCallCompact(id, {
    tool: "run_skill",
    isError: false,
    skill: "csv-clean",
  });
  store.appendToolCallCompact(id, {
    tool: "mcp__github__search_issues",
    isError: true,
  });
  store.appendTokenUsage(id, {
    provider: "anthropic",
    model: "claude-haiku-4-5",
    usage: { input_tokens: 40, output_tokens: 15 },
    attribution: {
      origin: "subagent",
      subagentId: "sub-1",
      role: "researcher",
      parentSessionId: id,
      depth: 1,
    },
  });
  store.appendTokenUsage(id, {
    provider: "anthropic",
    model: "claude-opus-4-8",
    usage: { input_tokens: 100, output_tokens: 20 },
  });
  store.appendAssistantMessage(id, "done");
  return store;
}

describe("REPL wrapper persists compact tool_call events", () => {
  it("writes {tool, is_error, skill?} at tool-result time — never args", async () => {
    const { agentLoop } = await import("../../src/repl/agent-repl.js");
    const store = await import("../../src/harness/jsonl-session-store.js");

    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    try {
      const core = async function* () {
        yield {
          type: "tool-executing",
          tool: "run_skill",
          args: { skill_name: "csv-clean", input: "secret-blob" },
        };
        yield { type: "tool-result", tool: "run_skill", result: { ok: 1 } };
        yield {
          type: "tool-executing",
          tool: "mcp__github__search_issues",
          args: { q: "bug" },
        };
        yield {
          type: "tool-result",
          tool: "mcp__github__search_issues",
          result: { error: "rate limited" },
        };
        yield { type: "response-complete", content: "hi" };
      };
      await agentLoop([], { _coreLoop: core, sessionId: "s-repl" });
    } finally {
      writeSpy.mockRestore();
    }

    const events = store.readEvents("s-repl");
    const toolEvents = events.filter((e) => e.type === "tool_call");
    expect(toolEvents).toHaveLength(2);
    expect(toolEvents[0].data).toEqual({
      tool: "run_skill",
      is_error: false,
      skill: "csv-clean",
    });
    expect(toolEvents[1].data).toEqual({
      tool: "mcp__github__search_issues",
      is_error: true,
    });
    // args (which can carry file bodies) must never be persisted
    expect(JSON.stringify(toolEvents)).not.toContain("secret-blob");
  });

  it("persists nothing without a sessionId (anonymous run unchanged)", async () => {
    const { agentLoop } = await import("../../src/repl/agent-repl.js");
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    try {
      const core = async function* () {
        yield {
          type: "tool-executing",
          tool: "read_file",
          args: { path: "x" },
        };
        yield { type: "tool-result", tool: "read_file", result: { ok: 1 } };
        yield { type: "response-complete", content: "hi" };
      };
      await agentLoop([], { _coreLoop: core });
    } finally {
      writeSpy.mockRestore();
    }
    const sessionsDir = path.join(tmpHome, "sessions");
    expect(
      fs.existsSync(sessionsDir) ? fs.readdirSync(sessionsDir) : [],
    ).toEqual([]);
  });
});

describe("cc session usage — attribution surfaces", () => {
  async function makeProgram() {
    const { registerSessionCommand } =
      await import("../../src/commands/session.js");
    const program = new Command();
    program.exitOverride();
    registerSessionCommand(program);
    return program;
  }

  it("--json includes the attribution section (single session + old keys intact)", async () => {
    await seedSession("s-cmd");
    const program = await makeProgram();
    const logs = await captureStdout(() =>
      program.parseAsync(["session", "usage", "s-cmd", "--json"], {
        from: "user",
      }),
    );
    const payload = JSON.parse(logs.join("\n"));
    expect(payload.sessionId).toBe("s-cmd");
    // old keys unchanged: totals cover BOTH usage events
    expect(payload.total.totalTokens).toBe(175);
    expect(payload.total.calls).toBe(2);
    // attribution: origin split
    const byOrigin = Object.fromEntries(
      payload.attribution.byOrigin.map((r) => [r.origin, r]),
    );
    expect(byOrigin.main.totalTokens).toBe(120);
    expect(byOrigin.subagent.totalTokens).toBe(55);
    expect(payload.attribution.bySubagent[0]).toMatchObject({
      subagentId: "sub-1",
      role: "researcher",
    });
    // tools + MCP bucket + turn association (single turn → all tools get 175)
    expect(payload.attribution.tools.totalCalls).toBe(3);
    expect(payload.attribution.tools.totalErrors).toBe(1);
    const skillRow = payload.attribution.tools.byTool.find(
      (t) => t.tool === "run_skill",
    );
    expect(skillRow.turnTokens).toBe(175);
    expect(payload.attribution.tools.byMcpServer).toEqual([
      expect.objectContaining({
        server: "github",
        calls: 1,
        errors: 1,
        turnTokens: 175,
      }),
    ]);
  });

  it("--by tool / --by origin / --by mcp render breakdowns; global mode works too", async () => {
    await seedSession("s-by");
    const program = await makeProgram();

    const toolLogs = await captureStdout(() =>
      program.parseAsync(["session", "usage", "s-by", "--by", "tool"], {
        from: "user",
      }),
    );
    const toolText = toolLogs.join("\n");
    expect(toolText).toContain("run_skill");
    expect(toolText).toContain("mcp__github__search_issues");
    expect(toolText).toContain("turnTokens");

    const originLogs = await captureStdout(() =>
      program.parseAsync(["session", "usage", "s-by", "--by", "origin"], {
        from: "user",
      }),
    );
    expect(originLogs.join("\n")).toContain("subagent");

    // global (no id) --by mcp
    const mcpLogs = await captureStdout(() =>
      program.parseAsync(["session", "usage", "--by", "mcp"], {
        from: "user",
      }),
    );
    expect(mcpLogs.join("\n")).toContain("github");
  });

  it("default output is unchanged (no attribution lines) and invalid --by is rejected", async () => {
    await seedSession("s-def");
    const program = await makeProgram();
    const logs = await captureStdout(() =>
      program.parseAsync(["session", "usage", "s-def"], { from: "user" }),
    );
    const text = logs.join("\n");
    expect(text).toContain("total:");
    expect(text).not.toContain("attribution");
    expect(text).not.toContain("turnTokens");

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    try {
      await expect(
        captureStdout(() =>
          program.parseAsync(["session", "usage", "s-def", "--by", "bogus"], {
            from: "user",
          }),
        ),
      ).rejects.toThrow(/process.exit/);
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("mixed-generation compat: a pre-attribution transcript aggregates exactly as before", async () => {
    const store = await import("../../src/harness/jsonl-session-store.js");
    store.startSession("s-legacy", { title: "old" });
    store.appendUserMessage("s-legacy", "hi");
    // legacy shapes: token_usage with data.usage and a headless bare aggregate
    store.appendTokenUsage("s-legacy", {
      provider: "openai",
      model: "gpt-4o",
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    store.appendTokenUsage("s-legacy", {
      input_tokens: 7,
      output_tokens: 3,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    });

    const { sessionUsage } = await import("../../src/lib/session-usage.js");
    const r = sessionUsage("s-legacy");
    expect(r.total).toEqual({
      inputTokens: 17,
      outputTokens: 8,
      totalTokens: 25,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      calls: 2,
    });
    // everything buckets as main; no tools recorded
    expect(r.attribution.byOrigin).toEqual([
      expect.objectContaining({ origin: "main", totalTokens: 25, calls: 2 }),
    ]);
    expect(r.attribution.bySkill).toEqual([]);
    expect(r.attribution.tools.totalCalls).toBe(0);
  });
});
