import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentLoop } from "../helpers/test-model-egress.js";
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
  let managedStateDir;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "cc-autocp-"));
    managedStateDir = mkdtempSync(join(tmpdir(), "cc-managed-cp-state-"));
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
    rmSync(managedStateDir, { recursive: true, force: true });
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
    expect(cp.tool_use_id).toBe("c1");

    const executing = events.find((e) => e.type === "tool-executing");
    const result = events.find((e) => e.type === "tool-result");
    expect(executing.tool_use_id).toBe("c1");
    expect(result.tool_use_id).toBe("c1");
    expect(cp.turn_id).toBe(executing.turn_id);
    expect(result.turn_id).toBe(executing.turn_id);

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

  it.each([
    "status --short",
    "git diff --stat",
    "log -n 1 --oneline",
    "show --stat HEAD",
    "rev-parse --show-toplevel",
  ])(
    "does not snapshot the workspace before read-only git: %s",
    async (command) => {
      // Dirty files must not turn a read into a whole-workspace checkpoint.
      writeFileSync(join(repo, "seed.txt"), "changed\n", "utf8");
      const events = await runLoop([{ role: "user", content: "inspect git" }], {
        cwd: repo,
        chatFn: scriptedChat("git", { command }),
        autoCheckpoint: true,
        managedCheckpoint: true,
        managedCheckpointStateDir: managedStateDir,
        checkpointSession: "git-read",
      });
      expect(events.some((e) => e.type === "tool-executing")).toBe(true);
      expect(
        events.find((e) => e.type === "tool-result")?.result.exitCode,
      ).toBe(0);
      expect(events.some((e) => e.type === "checkpoint")).toBe(false);
      expect(events.some((e) => e.type === "managed-checkpoint")).toBe(false);
      expect(listCheckpoints(repo, { session: "git-read" })).toEqual([]);
      expect(readFileSync(join(repo, "seed.txt"), "utf8")).toBe("changed\n");
    },
  );

  it.each([
    "add seed.txt",
    "diff --output=changes.diff",
    "diff --out=changes.diff",
  ])("retains the checkpoint for git writes: %s", async (command) => {
    writeFileSync(join(repo, "seed.txt"), "changed\n", "utf8");
    const events = await runLoop([{ role: "user", content: "run git" }], {
      cwd: repo,
      chatFn: scriptedChat("git", { command }),
      autoCheckpoint: true,
      checkpointSession: "git-write",
    });
    const cpIndex = events.findIndex((e) => e.type === "checkpoint");
    expect(cpIndex).toBeGreaterThanOrEqual(0);
    expect(cpIndex).toBeLessThan(
      events.findIndex((e) => e.type === "tool-executing"),
    );
    expect(listCheckpoints(repo, { session: "git-write" })).toHaveLength(1);
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

  it("commits an explicit managed workspace transaction with honest coverage", async () => {
    const events = await runLoop([{ role: "user", content: "write it" }], {
      ...baseOpts(),
      autoCheckpoint: false,
      managedCheckpoint: true,
      managedCheckpointStateDir: managedStateDir,
    });

    const prepared = events.find((e) => e.type === "managed-checkpoint");
    const settled = events.find((e) => e.type === "managed-checkpoint-settled");
    const result = events.find((e) => e.type === "tool-result");

    expect(prepared).toMatchObject({
      phase: "prepared",
      tool: "write_file",
      coverage: "partial",
      transaction_id: expect.stringMatching(/^wcp-/),
    });
    expect(settled).toMatchObject({
      phase: "committed",
      tool: "write_file",
      coverage: "partial",
      file_coverage: "partial",
      transaction_id: prepared.transaction_id,
      evidence_digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    expect(result.result.managedCheckpoint.evidence).toMatchObject({
      outcome: "committed",
      coverage: "partial",
      fileCoverage: "partial",
    });
    expect(existsSync(join(repo, "out.txt"))).toBe(true);
    expect(readFileSync(join(repo, "out.txt"), "utf8")).toBe("hi");
  });
});
