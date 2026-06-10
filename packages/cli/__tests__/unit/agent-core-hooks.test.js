/**
 * agent-core executeTool — settings.json hook enforcement (Phase 2 teeth).
 *
 * A PreToolUse settings hook can BLOCK (exit 2 / {permissionDecision:deny}) or
 * ASK (→ confirmer); a PostToolUse hook attaches `hookFeedback`. A settings
 * permission `deny` short-circuits before any hook process spawns. Hook
 * commands are real `node -e` invocations (deterministic, cross-platform).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { executeTool, agentLoop } from "../../src/runtime/agent-core.js";

let tmp, file;

const pre = (command, matcher = "*") => ({
  PreToolUse: [{ matcher, hooks: [{ type: "command", command }] }],
});
const post = (command, matcher = "*") => ({
  PostToolUse: [{ matcher, hooks: [{ type: "command", command }] }],
});

// Cross-platform node one-liners (double-quoted so Windows cmd is happy).
const HOOK_BLOCK = 'node -e "process.exit(2)"';
const HOOK_PASS = 'node -e ""';
const HOOK_ASK =
  "node -e \"console.log(JSON.stringify({hookSpecificOutput:{permissionDecision:'ask'}}))\"";
const HOOK_POST_BLOCK =
  "node -e \"console.log(JSON.stringify({decision:'block',reason:'reformat needed'}))\"";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-achooks-"));
  file = path.join(tmp, "note.txt");
  fs.writeFileSync(file, "hello", "utf-8");
});
afterEach(() => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe("PreToolUse block", () => {
  it("exit 2 blocks the tool before it runs", async () => {
    const res = await executeTool(
      "read_file",
      { path: file },
      { cwd: tmp, settingsHooks: pre(HOOK_BLOCK) },
    );
    expect(res.error).toMatch(/\[Hook\] PreToolUse blocked/);
    expect(res.policy).toMatchObject({ decision: "block", via: "hook" });
  });

  it("exit 0 lets the tool run", async () => {
    const res = await executeTool(
      "read_file",
      { path: file },
      { cwd: tmp, settingsHooks: pre(HOOK_PASS) },
    );
    expect(res.error).toBeUndefined();
  });

  it("only fires for a matching tool (matcher Edit misses read_file)", async () => {
    const res = await executeTool(
      "read_file",
      { path: file },
      { cwd: tmp, settingsHooks: pre(HOOK_BLOCK, "Edit") },
    );
    expect(res.error).toBeUndefined();
  });
});

describe("PreToolUse ask → confirmer", () => {
  it("blocks when the confirmer declines", async () => {
    const res = await executeTool(
      "read_file",
      { path: file },
      {
        cwd: tmp,
        settingsHooks: pre(HOOK_ASK),
        permissionConfirm: async () => false,
      },
    );
    expect(res.error).toMatch(/\[Hook\] PreToolUse blocked/);
  });

  it("proceeds when the confirmer approves", async () => {
    const res = await executeTool(
      "read_file",
      { path: file },
      {
        cwd: tmp,
        settingsHooks: pre(HOOK_ASK),
        permissionConfirm: async () => true,
      },
    );
    expect(res.error).toBeUndefined();
  });
});

describe("PostToolUse feedback", () => {
  it("attaches hookFeedback on a block decision (tool still ran)", async () => {
    const res = await executeTool(
      "read_file",
      { path: file },
      { cwd: tmp, settingsHooks: post(HOOK_POST_BLOCK) },
    );
    expect(res.error).toBeUndefined();
    expect(res.hookFeedback).toBe("reformat needed");
  });
});

describe("precedence: permission deny short-circuits before hooks spawn", () => {
  it("a settings deny blocks with [Permission] and the hook never runs", async () => {
    const sentinel = path.join(tmp, "RAN");
    const hookCmd = `node -e "require('fs').writeFileSync('${sentinel.replace(/\\/g, "\\\\")}','x')"`;
    const res = await executeTool(
      "read_file",
      { path: file },
      {
        cwd: tmp,
        permissionRules: { deny: ["Read"] },
        settingsHooks: pre(hookCmd),
      },
    );
    expect(res.error).toMatch(/\[Permission\]/);
    expect(fs.existsSync(sentinel)).toBe(false); // hook process never spawned
  });
});

describe("no settingsHooks → unchanged", () => {
  it("reads normally with no hooks", async () => {
    const res = await executeTool("read_file", { path: file }, { cwd: tmp });
    expect(res.error).toBeUndefined();
  });
});

describe("Stop hook (agentLoop completion)", () => {
  it("fires a Stop hook when the agent finishes (no tool calls)", async () => {
    const sentinel = path.join(tmp, "STOPPED");
    const cmd = `node -e "require('fs').writeFileSync('${sentinel.replace(/\\/g, "\\\\")}','x')"`;
    const chatFn = async () => ({
      message: { role: "assistant", content: "done" },
      usage: {},
    });
    const gen = agentLoop([{ role: "user", content: "hi" }], {
      chatFn,
      cwd: tmp,
      settingsHooks: {
        Stop: [{ matcher: null, hooks: [{ type: "command", command: cmd }] }],
      },
      autoCompact: false,
    });
    // drain the generator
    // eslint-disable-next-line no-unused-vars
    for await (const _ev of gen) {
      /* consume events */
    }
    expect(fs.existsSync(sentinel)).toBe(true);
  });

  it("a Stop hook block forces one continuation (stop_hook_active guards loop)", async () => {
    // Blocks only on the first stop; honours stop_hook_active on the retry so
    // the loop terminates (the budget is the backstop for misbehaving hooks).
    const hookFile = path.join(tmp, "stophook.js");
    fs.writeFileSync(
      hookFile,
      "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);if(!j.stop_hook_active)console.log(JSON.stringify({decision:'block',reason:'keep going'}))}catch(e){}})",
    );
    let calls = 0;
    const chatFn = async () => {
      calls++;
      return { message: { role: "assistant", content: "done" }, usage: {} };
    };
    const events = [];
    const gen = agentLoop([{ role: "user", content: "hi" }], {
      chatFn,
      cwd: tmp,
      settingsHooks: {
        Stop: [
          {
            matcher: null,
            hooks: [{ type: "command", command: `node "${hookFile}"` }],
          },
        ],
      },
      autoCompact: false,
    });
    for await (const ev of gen) events.push(ev.type);
    expect(calls).toBe(2); // continued exactly once
    expect(events).toContain("stop-hook-continue");
  });
});

describe("SubagentStop hook (spawn_sub_agent completion)", () => {
  // spawn_sub_agent with empty args returns an error object WITHOUT spinning up
  // a real LLM subagent — enough to prove the SubagentStop seam fires on the
  // tool's completion.
  it("fires after a spawn_sub_agent call returns", async () => {
    const sentinel = path.join(tmp, "SUBSTOPPED");
    const cmd = `node -e "require('fs').writeFileSync('${sentinel.replace(/\\/g, "\\\\")}','x')"`;
    await executeTool(
      "spawn_sub_agent",
      {},
      {
        cwd: tmp,
        settingsHooks: {
          SubagentStop: [
            { matcher: null, hooks: [{ type: "command", command: cmd }] },
          ],
        },
      },
    );
    expect(fs.existsSync(sentinel)).toBe(true);
  });

  it("does NOT fire for a non-subagent tool", async () => {
    const sentinel = path.join(tmp, "SHOULD_NOT_RUN");
    const cmd = `node -e "require('fs').writeFileSync('${sentinel.replace(/\\/g, "\\\\")}','x')"`;
    await executeTool(
      "read_file",
      { path: file },
      {
        cwd: tmp,
        settingsHooks: {
          SubagentStop: [
            { matcher: null, hooks: [{ type: "command", command: cmd }] },
          ],
        },
      },
    );
    expect(fs.existsSync(sentinel)).toBe(false);
  });

  it("attaches hookFeedback to the result when it blocks", async () => {
    const hookFile = path.join(tmp, "substop.js");
    fs.writeFileSync(
      hookFile,
      "console.log(JSON.stringify({decision:'block',reason:'subagent drifted'}))",
    );
    const res = await executeTool(
      "spawn_sub_agent",
      {},
      {
        cwd: tmp,
        settingsHooks: {
          SubagentStop: [
            {
              matcher: null,
              hooks: [{ type: "command", command: `node "${hookFile}"` }],
            },
          ],
        },
      },
    );
    expect(res.hookFeedback).toBe("subagent drifted");
  });
});

describe("PreCompact hook block", () => {
  it("skips the auto-compaction when a PreCompact hook blocks", async () => {
    const hookFile = path.join(tmp, "precompact.js");
    fs.writeFileSync(
      hookFile,
      "console.log(JSON.stringify({decision:'block',reason:'owned'}))",
    );
    const compress = vi.fn(async () => ({
      messages: [],
      stats: { saved: 100 },
    }));
    const events = [];
    const gen = agentLoop(
      [
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
        { role: "user", content: "c" },
        { role: "assistant", content: "d" },
        { role: "user", content: "e" },
      ],
      {
        chatFn: async () => ({
          message: { role: "assistant", content: "done" },
          usage: {},
        }),
        cwd: tmp,
        autoCompact: true,
        _autoCompactor: { shouldAutoCompact: () => true, compress },
        settingsHooks: {
          PreCompact: [
            {
              matcher: null,
              hooks: [{ type: "command", command: `node "${hookFile}"` }],
            },
          ],
        },
      },
    );
    for await (const ev of gen) events.push(ev.type);
    expect(compress).not.toHaveBeenCalled();
    expect(events).toContain("compaction-skipped");
  });
});
