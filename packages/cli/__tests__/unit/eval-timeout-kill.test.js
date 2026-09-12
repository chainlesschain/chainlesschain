import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import {
  _deps,
  killAgentTree,
  makeHeadlessRunAgent,
} from "../../src/commands/eval.js";
import { computeTrend } from "../../src/lib/eval/trend.js";

const originalDeps = { ..._deps };
let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-eval-kill-"));
});
afterEach(() => {
  Object.assign(_deps, originalDeps);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe("eval process Broker contract", () => {
  it.each([
    [
      "success",
      [{ type: "result", subtype: "success", is_error: false }],
      0,
      null,
      true,
    ],
    [
      "error result",
      [{ type: "result", subtype: "success", is_error: true }],
      0,
      null,
      false,
    ],
    [
      "missing is_error",
      [{ type: "result", subtype: "success" }],
      0,
      null,
      false,
    ],
    [
      "mistyped is_error",
      [{ type: "result", subtype: "success", is_error: "false" }],
      0,
      null,
      false,
    ],
    ["missing result", [{ type: "system", subtype: "init" }], 0, null, false],
    [
      "duplicate result",
      [
        { type: "result", subtype: "success" },
        { type: "result", subtype: "success" },
      ],
      0,
      null,
      false,
    ],
    ["nonzero", [{ type: "result", subtype: "success" }], 1, null, false],
    [
      "signal",
      [{ type: "result", subtype: "success" }],
      null,
      "SIGTERM",
      false,
    ],
    [
      "provider error",
      [{ type: "error" }, { type: "result", subtype: "success" }],
      0,
      null,
      false,
    ],
    [
      "data after terminal",
      [{ type: "result", subtype: "success" }, { type: "assistant" }],
      0,
      null,
      false,
    ],
  ])(
    "requires both a clean exit and a valid terminal: %s",
    async (_label, events, code, signal, ok) => {
      const child = new EventEmitter();
      child.pid = 42;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      _deps.spawn = vi.fn(() => child);
      const pending = makeHeadlessRunAgent({
        model: "test-model",
        provider: "openai",
      })({ prompt: "x", cwd: dir });
      child.stdout.emit(
        "data",
        Buffer.from(
          events
            .map((event) =>
              JSON.stringify(
                event.type === "result" &&
                  !["missing is_error", "mistyped is_error"].includes(_label)
                  ? { is_error: false, ...event }
                  : event,
              ),
            )
            .join("\n"),
        ),
      );
      child.emit("close", code, signal);
      expect(await pending).toMatchObject({
        ok,
        executionEvidence: {
          protocol: "cc-agent-stream-json/v1",
          exitCode: code,
          signal,
        },
      });
      expect(_deps.spawn.mock.calls[0][1]).toContain("stream-json");
    },
  );

  it("retains successful fallback execution but records its changed model provenance", async () => {
    const child = new EventEmitter();
    child.pid = 42;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    _deps.spawn = vi.fn(() => child);
    const pending = makeHeadlessRunAgent()({ prompt: "x", cwd: dir });
    child.stdout.emit(
      "data",
      Buffer.from(
        [
          {
            type: "raw",
            subtype: "provider_fallback",
            from: "openai",
            to: "ollama",
          },
          { type: "result", subtype: "success", is_error: false },
        ]
          .map((event) => JSON.stringify(event))
          .join("\n"),
      ),
    );
    child.emit("close", 0);
    expect(await pending).toMatchObject({
      ok: true,
      executionEvidence: { terminalVerified: true, observedFallback: true },
    });
  });

  it("runs the headless agent with literal argv and eval provenance", async () => {
    const child = new EventEmitter();
    child.pid = 42;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    _deps.spawn = vi.fn(() => child);

    const argv = ["-e", "process.exit(0)"];
    const runAgent = makeHeadlessRunAgent({ _argv: argv });
    const pending = runAgent({ prompt: "x", cwd: dir, timeoutMs: 30000 });
    child.emit("close", 0);

    await expect(pending).resolves.toMatchObject({ ok: true, error: null });
    expect(_deps.spawn).toHaveBeenCalledWith(
      process.execPath,
      argv,
      expect.objectContaining({
        cwd: dir,
        origin: "eval:agent-run",
        policy: "allow",
        scope: "eval",
        shell: false,
      }),
    );
  });

  it("routes Windows tree termination through taskkill argv", () => {
    const child = { pid: 4242, kill: vi.fn() };
    _deps.platform = "win32";
    _deps.spawnSync = vi.fn(() => ({ status: 0 }));

    killAgentTree(child);

    expect(_deps.spawnSync).toHaveBeenCalledWith(
      "taskkill",
      ["/PID", "4242", "/T", "/F"],
      expect.objectContaining({
        origin: "eval:agent-tree-kill",
        policy: "allow",
        scope: "eval",
        shell: false,
      }),
    );
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });
});

describe("eval timeout — tree kill + settle only after exit", () => {
  it(
    "kills the child AND its grandchild before resolving (no post-timeout writes)",
    { timeout: 30000 },
    async () => {
      // Parent spawns a grandchild; BOTH append to heartbeat files forever.
      // Pre-fix: timeout resolved immediately after a bare SIGTERM — the tree
      // (on Windows, always the grandchild) kept writing into the workspace
      // while the runner snapshotted/checked/deleted it.
      const script = `
        const fs = require("fs"), path = require("path"), cp = require("child_process");
        const dir = process.argv[1];
        const grand = cp.spawn(process.execPath, ["-e", \`
          const fs = require("fs");
          setInterval(() => fs.appendFileSync(process.argv[1] + "/grand.beat", "g"), 50);
        \`, dir], { stdio: "ignore" });
        setInterval(() => fs.appendFileSync(dir + "/parent.beat", "p"), 50);
      `;
      const runAgent = makeHeadlessRunAgent({ _argv: ["-e", script, dir] });
      const res = await runAgent({ prompt: "x", cwd: dir, timeoutMs: 800 });
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/timed out/);

      // Give any survivor time to write, then verify the tree is really dead:
      // neither heartbeat file may grow after the promise resolved.
      const size = (f) => {
        try {
          return fs.statSync(path.join(dir, f)).size;
        } catch {
          return 0;
        }
      };
      const p1 = size("parent.beat");
      const g1 = size("grand.beat");
      await sleep(500);
      expect(size("parent.beat")).toBe(p1);
      expect(size("grand.beat")).toBe(g1);
    },
  );

  it("a fast clean exit still resolves ok (no timeout interference)", async () => {
    const runAgent = makeHeadlessRunAgent({
      _argv: ["-e", "process.exit(0)"],
    });
    const res = await runAgent({ prompt: "x", cwd: dir, timeoutMs: 30000 });
    expect(res.ok).toBe(true);
  });
});

describe("eval trend — dry-run records are excluded", () => {
  it("a 0% dry-run appended after a real run does not trip the gate", () => {
    const real = {
      ranAt: "2026-07-01T00:00:00Z",
      passed: 10,
      total: 10,
      passRate: 1,
      results: [{ id: "a", pass: true }],
    };
    const dry = {
      ranAt: "2026-07-02T00:00:00Z",
      dryRun: true,
      passed: 0,
      total: 10,
      passRate: 0,
      results: [{ id: "a", pass: false }],
    };
    const trend = computeTrend([real, dry]);
    // Pre-fix this reported delta -1 with task "a" regressed and gate tripped.
    expect(trend.regressed).toBe(false);
    expect(trend.runs).toBe(1);
    expect(trend.latest.passRate).toBe(1);
  });
});
