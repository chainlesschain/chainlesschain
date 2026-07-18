/**
 * Unit tests for the REPL's agentLoop() wrapper — its translation of
 * agent-core events into REPL state. Uses the `_coreLoop` injection seam so no
 * live model / agent-core is involved; stdout is spied to keep output clean.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { agentLoop } from "../../src/repl/agent-repl.js";
import {
  _deps as denialStoreDeps,
  readRecentDenials,
} from "../../src/lib/permission-denial-store.js";

// A fake agent-core loop: yields the given events and records the options it
// was called with (so we can assert what the wrapper forwarded).
function coreLoop(events) {
  const fn = async function* (_messages, opts) {
    fn.calledWith = opts;
    for (const e of events) yield e;
  };
  return fn;
}

let writeSpy;
let files;
const originalDenialStoreDeps = { ...denialStoreDeps };

beforeEach(() => {
  files = {};
  writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  denialStoreDeps.getHomeDir = () => "C:\\cc-home";
  denialStoreDeps.now = () => 10_000;
  denialStoreDeps.existsSync = (p) =>
    Object.prototype.hasOwnProperty.call(files, p);
  denialStoreDeps.mkdirSync = () => {};
  denialStoreDeps.readFileSync = (p) => {
    if (!(p in files)) throw new Error("ENOENT");
    return files[p];
  };
  denialStoreDeps.writeFileSync = (p, text) => {
    files[p] = String(text);
  };
  denialStoreDeps.renameSync = (from, to) => {
    files[to] = files[from];
    delete files[from];
  };
});

afterEach(() => {
  writeSpy.mockRestore();
  Object.assign(denialStoreDeps, originalDenialStoreDeps);
});

describe("agentLoop() wrapper", () => {
  it("FORCES autoCompact off even when the caller passes autoCompact:true", async () => {
    // Regression guard: the REPL runs its own post-turn compaction, so the
    // in-loop pass must stay off. A caller option must never re-enable it
    // (the `autoCompact:false` is spread-ordered to win).
    const core = coreLoop([{ type: "response-complete", content: "hi" }]);
    const res = await agentLoop([], { _coreLoop: core, autoCompact: true });
    expect(core.calledWith.autoCompact).toBe(false);
    expect(res.content).toBe("hi");
  });

  it("records a checkpoint mark with atMessageCount === messages.length at event time", async () => {
    // /rewind relies on this count to restore the right file snapshot for a
    // turn; an off-by-one would rewind code to the wrong point.
    const marks = [];
    const messages = [
      { role: "system", content: "s" },
      { role: "user", content: "u" },
    ];
    const core = coreLoop([
      { type: "checkpoint", id: "ck1", tool: "write_file" },
      { type: "response-complete", content: "done" },
    ]);
    await agentLoop(messages, { _coreLoop: core, checkpointMarks: marks });
    expect(marks).toEqual([
      { atMessageCount: 2, id: "ck1", tool: "write_file" },
    ]);
  });

  it("accumulates token-usage events and returns content + thinking", async () => {
    const core = coreLoop([
      { type: "token-usage", usage: { input_tokens: 5, output_tokens: 2 } },
      { type: "token-usage", usage: { input_tokens: 3 } },
      { type: "response-complete", content: "answer", thinking: "reasoned" },
    ]);
    const res = await agentLoop([], { _coreLoop: core });
    expect(res.content).toBe("answer");
    expect(res.thinking).toBe("reasoned");
    expect(res.usageEvents).toHaveLength(2);
  });

  it("returns empty content + usageEvents when the loop ends with no response-complete", async () => {
    const core = coreLoop([
      { type: "tool-executing", tool: "read_file", args: { path: "x" } },
    ]);
    const res = await agentLoop([], { _coreLoop: core });
    expect(res.content).toBe("");
    expect(res.usageEvents).toEqual([]);
  });

  it("records a policy denial into options.denialLog (not plain tool failures)", async () => {
    // /permissions denials reviews blocked calls; a tool that ran and merely
    // failed (non-zero exit) must NOT be logged as a denial.
    const denialLog = [];
    const core = coreLoop([
      {
        type: "tool-executing",
        tool: "run_shell",
        args: { command: "rm -rf build" },
      },
      {
        type: "tool-result",
        tool: "run_shell",
        error: "[Shell Policy] Destructive command blocked.",
        result: {
          error: "[Shell Policy] Destructive command blocked.",
          shellCommandPolicy: {
            allowed: false,
            ruleId: "rm-rf",
            normalizedCommand: "rm -rf build",
          },
        },
      },
      {
        type: "tool-executing",
        tool: "run_shell",
        args: { command: "ls /nope" },
      },
      {
        type: "tool-result",
        tool: "run_shell",
        error: "exited with code 2",
        result: { error: "exited with code 2" },
      },
      { type: "response-complete", content: "done" },
    ]);
    await agentLoop([], { _coreLoop: core, denialLog });
    expect(denialLog).toHaveLength(1);
    expect(denialLog[0]).toMatchObject({
      tool: "run_shell",
      via: "shell-policy",
      rule: "rm-rf",
      summary: "rm -rf build",
    });
    expect(typeof denialLog[0].at).toBe("number");
  });

  it("persists REPL policy denials into the shared recent-denials store when enabled", async () => {
    const denialLog = [];
    const core = coreLoop([
      {
        type: "tool-executing",
        tool: "run_shell",
        args: { command: "rm -rf build" },
      },
      {
        type: "tool-result",
        tool: "run_shell",
        error: "[Shell Policy] Destructive command blocked.",
        result: {
          error: "[Shell Policy] Destructive command blocked.",
          shellCommandPolicy: {
            allowed: false,
            ruleId: "rm-rf",
            normalizedCommand: "rm -rf build",
          },
        },
      },
      { type: "response-complete", content: "done" },
    ]);

    await agentLoop([], {
      _coreLoop: core,
      denialLog,
      persistRecentDenials: true,
      sessionId: "sess-repl",
      permissionMode: "strict",
      cwd: "C:\\repo",
    });

    expect(readRecentDenials()).toHaveLength(1);
    expect(readRecentDenials()[0]).toMatchObject({
      tool: "run_shell",
      summary: "rm -rf build",
      sessionId: "sess-repl",
      permissionMode: "strict",
      cwd: "C:\\repo",
      source: "repl",
    });
  });

  it("feeds every loop event to options.turnBindingFeed in stream order", async () => {
    // The REPL-as-producer seam: the wrapper folds checkpoint / tool / result
    // events into the explicit turn-binding table via the injected feed.
    const seen = [];
    const events = [
      { type: "checkpoint", id: "cp1", tool: "write_file" },
      { type: "tool-executing", tool: "write_file", args: { path: "x" } },
      { type: "tool-result", tool: "write_file", result: { ok: true } },
      { type: "response-complete", content: "done" },
    ];
    const core = coreLoop(events);
    await agentLoop([], {
      _coreLoop: core,
      turnBindingFeed: { handleEvent: (e) => seen.push(e.type) },
    });
    expect(seen).toEqual([
      "checkpoint",
      "tool-executing",
      "tool-result",
      "response-complete",
    ]);
  });

  it("a throwing turnBindingFeed never breaks the turn (advisory)", async () => {
    const core = coreLoop([{ type: "response-complete", content: "ok" }]);
    const res = await agentLoop([], {
      _coreLoop: core,
      turnBindingFeed: {
        handleEvent: () => {
          throw new Error("boom");
        },
      },
    });
    expect(res.content).toBe("ok");
  });

  it("uses a caller-supplied onProviderFallback over the default", async () => {
    const seen = [];
    const core = coreLoop([{ type: "response-complete", content: "ok" }]);
    await agentLoop([], {
      _coreLoop: core,
      onProviderFallback: (info) => seen.push(info),
    });
    // The wrapper forwards the caller's handler (not the default REPL printer).
    core.calledWith.onProviderFallback({ from: "a", to: "b" });
    expect(seen).toEqual([{ from: "a", to: "b" }]);
  });
});
