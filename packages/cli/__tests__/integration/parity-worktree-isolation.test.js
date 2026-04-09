/**
 * Parity Harness — Sub-agent + worktree isolation boundary
 *
 * Phase 7 Step 7. Drives `SubAgentContext` with the mock LLM provider
 * (injected via `llmOptions.chatFn`) to verify the deterministic
 * isolation boundary the CLI runtime guarantees for sub-agents:
 *
 *   1. The parent's messages array is NEVER mutated by sub-agent runs.
 *   2. `allowedTools` whitelist filters AGENT_TOOLS down to the named set.
 *   3. A sub-agent in a non-git cwd runs the direct code path and
 *      returns a structured result (summary/artifacts/tokenCount/...).
 *   4. Re-running a completed sub-agent throws "not active".
 *   5. When `useWorktree: true` AND the cwd is a real git repo, the
 *      sub-agent's tool execution sees a cwd inside a temporary
 *      worktree, the worktree is cleaned up after `run()` returns,
 *      and the result is annotated with `worktree.branch` / `.path`.
 *
 * Worktree coverage uses a real `git init` + initial commit in a temp
 * dir — `isolateTask` actually spawns git subprocesses. The sub-agent
 * tool flow observes the worktree cwd via a `read_file` round-trip on
 * a marker file that exists only in the worktree's HEAD.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { execSync } from "child_process";
import { SubAgentContext } from "../../src/lib/sub-agent-context.js";
import {
  createMockLLMProvider,
  mockToolCallMessage,
  mockTextMessage,
} from "../../src/harness/mock-llm-provider.js";

function initGitRepo(dir) {
  execSync("git init -q", { cwd: dir });
  execSync("git config user.email parity@test", { cwd: dir });
  execSync("git config user.name parity", { cwd: dir });
  // Newer gits default to 'main'; older to 'master'. Force 'main' so
  // branch lookups in the test are deterministic.
  execSync("git checkout -q -b main", { cwd: dir });
  writeFileSync(join(dir, "marker.txt"), "from-repo-head", "utf8");
  execSync("git add marker.txt", { cwd: dir });
  execSync('git commit -q -m "initial"', { cwd: dir });
}

describe("Phase 7 parity: sub-agent + worktree isolation", () => {
  let workDir;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "parity-worktree-"));
  });

  afterEach(() => {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it("DIRECT: non-git cwd → direct code path, returns structured result", async () => {
    const mock = createMockLLMProvider([
      { response: { message: mockTextMessage("sub-agent says hi") } },
    ]);

    const sub = SubAgentContext.create({
      role: "greeter",
      task: "say hi",
      cwd: workDir,
      useWorktree: false,
      llmOptions: { provider: "mock", model: "mock-1", chatFn: mock.chatFn },
    });

    const result = await sub.run("please greet");

    expect(result.summary).toBe("sub-agent says hi");
    expect(Array.isArray(result.artifacts)).toBe(true);
    expect(Array.isArray(result.toolsUsed)).toBe(true);
    expect(typeof result.tokenCount).toBe("number");
    expect(typeof result.iterationCount).toBe("number");
    expect(sub.status).toBe("completed");
    mock.assertDrained();
  });

  it("ISOLATED MESSAGES: parent array is not mutated by sub-agent runs", async () => {
    const parentMessages = [
      { role: "user", content: "parent-prompt" },
      { role: "assistant", content: "parent-reply" },
    ];
    const parentSnapshot = JSON.parse(JSON.stringify(parentMessages));

    const mock = createMockLLMProvider([
      { response: { message: mockTextMessage("isolated work done") } },
    ]);

    const sub = SubAgentContext.create({
      role: "worker",
      task: "do work",
      cwd: workDir,
      useWorktree: false,
      // Parent condensed context goes through this field, NOT by
      // sharing the messages array.
      inheritedContext: "parent context summary",
      llmOptions: { provider: "mock", model: "mock-1", chatFn: mock.chatFn },
    });

    // Sub-agent has its own messages starting with a system prompt
    expect(sub.messages).not.toBe(parentMessages);
    expect(sub.messages).toHaveLength(1);
    expect(sub.messages[0].role).toBe("system");
    expect(sub.messages[0].content).toContain("Sub-Agent Role: worker");
    expect(sub.messages[0].content).toContain("parent context summary");

    await sub.run("do it");

    // Parent array is untouched
    expect(parentMessages).toEqual(parentSnapshot);
    // Sub-agent messages grew to include its own user turn (system + user).
    // agentLoop yields response-complete without pushing the assistant text
    // back into the messages array for the plain-text path — assistant
    // content is surfaced via the result.summary instead.
    expect(sub.messages).toHaveLength(2);
    expect(sub.messages[1]).toEqual({ role: "user", content: "do it" });
    expect(sub.result.summary).toBe("isolated work done");
  });

  it("ALLOWED-TOOLS: whitelist filters AGENT_TOOLS down to named set", async () => {
    const sub = SubAgentContext.create({
      role: "reader",
      task: "read only",
      cwd: workDir,
      useWorktree: false,
      allowedTools: ["read_file", "list_dir"],
    });

    const filtered = sub._getFilteredTools();
    const names = filtered.map((t) => t.function.name);
    expect(new Set(names)).toEqual(new Set(["read_file", "list_dir"]));

    // And the unfiltered case: null whitelist → all tools
    const sub2 = SubAgentContext.create({
      role: "full",
      task: "anything",
      cwd: workDir,
      useWorktree: false,
      allowedTools: null,
    });
    const all = sub2._getFilteredTools();
    expect(all.length).toBeGreaterThan(2);
    const allNames = all.map((t) => t.function.name);
    expect(allNames).toContain("read_file");
    expect(allNames).toContain("list_dir");
  });

  it("RE-RUN GUARD: calling run() on a completed sub-agent throws 'not active'", async () => {
    const mock = createMockLLMProvider([
      { response: { message: mockTextMessage("done") } },
    ]);

    const sub = SubAgentContext.create({
      role: "once",
      task: "once-only",
      cwd: workDir,
      useWorktree: false,
      llmOptions: { provider: "mock", model: "mock-1", chatFn: mock.chatFn },
    });

    await sub.run("first");
    expect(sub.status).toBe("completed");

    await expect(sub.run("second")).rejects.toThrow(/is not active/);
  });

  it("WORKTREE: real git repo + useWorktree=true → cwd flips into worktree during run, cleaned up after", async () => {
    initGitRepo(workDir);

    // Script: model calls read_file on marker.txt, then acknowledges.
    const mock = createMockLLMProvider([
      {
        response: {
          message: mockToolCallMessage(
            "read_file",
            { path: "marker.txt" },
            "call_wt_1",
          ),
        },
      },
      {
        expect: (messages) =>
          messages.some(
            (m) =>
              m.role === "tool" &&
              typeof m.content === "string" &&
              m.content.includes("from-repo-head"),
          ),
        response: { message: mockTextMessage("marker read") },
      },
    ]);

    const sub = SubAgentContext.create({
      role: "wt-reader",
      task: "read marker inside worktree",
      cwd: workDir,
      useWorktree: true,
      allowedTools: ["read_file"],
      llmOptions: { provider: "mock", model: "mock-1", chatFn: mock.chatFn },
    });

    const result = await sub.run("read the marker");

    // Sub-agent completed successfully and captured the final reply
    expect(sub.status).toBe("completed");
    expect(result.summary).toBe("marker read");

    // Result was annotated with the worktree metadata
    expect(result.worktree).toBeDefined();
    expect(result.worktree.branch).toMatch(/^agent\/wt-reader-/);
    expect(typeof result.worktree.path).toBe("string");

    // While the sub-agent was running, `this.cwd` was flipped to the
    // worktree path — it should NO LONGER equal the original repo root.
    // (The worktree dir has been cleaned up by this point.)
    expect(sub.cwd).not.toBe(resolve(workDir));
    expect(sub.cwd).toContain(".worktrees");

    // Worktree directory was cleaned up by the finally block in
    // `isolateTask` → `removeWorktree`.
    expect(existsSync(sub.cwd)).toBe(false);

    mock.assertDrained();
  });
});
