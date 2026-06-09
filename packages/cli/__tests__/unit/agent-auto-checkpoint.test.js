import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentLoop } from "../../src/runtime/agent-core.js";
import { listCheckpoints } from "../../src/lib/checkpoint-store.js";

function git(repo, ...args) {
  const r = spawnSync("git", args, { cwd: repo, encoding: "utf-8" });
  if (r.status !== 0) throw new Error(r.stderr || `git ${args.join(" ")}`);
  return (r.stdout || "").trim();
}

/** Drive the loop deterministically: one tool call, then a final answer. */
function scriptedChat(toolName, toolArgs) {
  let n = 0;
  return async () => {
    n += 1;
    if (n === 1) {
      return {
        message: {
          role: "assistant",
          tool_calls: [
            {
              id: "c1",
              function: { name: toolName, arguments: JSON.stringify(toolArgs) },
            },
          ],
        },
      };
    }
    return { message: { role: "assistant", content: "done" } };
  };
}

async function runLoop(messages, options) {
  const events = [];
  for await (const ev of agentLoop(messages, options)) events.push(ev);
  return events;
}

describe("agent-core auto-checkpoint (before mutating tools)", () => {
  let repo;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "cc-autocp-"));
    git(repo, "init", "-q");
    git(repo, "config", "user.email", "t@test.local");
    git(repo, "config", "user.name", "tester");
    git(repo, "config", "core.autocrlf", "false");
    writeFileSync(join(repo, "seed.txt"), "seed\n", "utf8");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "init");
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  const baseOpts = (extra) => ({
    cwd: repo,
    chatFn: scriptedChat("write_file", { path: "out.txt", content: "hi" }),
    ...extra,
  });

  it("snapshots before a mutating tool and emits a checkpoint event", async () => {
    const events = await runLoop([{ role: "user", content: "write it" }], {
      ...baseOpts(),
      autoCheckpoint: true,
      checkpointSession: "t1",
    });

    const cp = events.find((e) => e.type === "checkpoint");
    expect(cp).toBeTruthy();
    expect(cp.tool).toBe("write_file");

    // The checkpoint event precedes the tool-executing event.
    const cpIdx = events.findIndex((e) => e.type === "checkpoint");
    const execIdx = events.findIndex((e) => e.type === "tool-executing");
    expect(cpIdx).toBeLessThan(execIdx);

    // A real shadow ref exists in that session.
    const rows = listCheckpoints(repo, { session: "t1" });
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe(cp.id);
  });

  it("does not checkpoint when autoCheckpoint is off", async () => {
    const events = await runLoop([{ role: "user", content: "write it" }], {
      ...baseOpts(),
      autoCheckpoint: false,
      checkpointSession: "t2",
    });
    expect(events.some((e) => e.type === "checkpoint")).toBe(false);
    expect(listCheckpoints(repo, { session: "t2" }).length).toBe(0);
  });

  it("does not checkpoint before a read-only tool", async () => {
    const events = await runLoop([{ role: "user", content: "read it" }], {
      cwd: repo,
      chatFn: scriptedChat("read_file", { path: "seed.txt" }),
      autoCheckpoint: true,
      checkpointSession: "t3",
    });
    expect(events.some((e) => e.type === "checkpoint")).toBe(false);
    expect(listCheckpoints(repo, { session: "t3" }).length).toBe(0);
  });

  it("is a no-op outside a git work tree", async () => {
    const plain = mkdtempSync(join(tmpdir(), "cc-autocp-nogit-"));
    try {
      const events = await runLoop([{ role: "user", content: "write it" }], {
        cwd: plain,
        chatFn: scriptedChat("write_file", { path: "out.txt", content: "x" }),
        autoCheckpoint: true,
        checkpointSession: "t4",
      });
      // No checkpoint event, and the tool still ran.
      expect(events.some((e) => e.type === "checkpoint")).toBe(false);
      expect(events.some((e) => e.type === "tool-executing")).toBe(true);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});
