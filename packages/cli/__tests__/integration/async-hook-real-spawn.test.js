import { describe, it, expect } from "vitest";
import { AsyncHookSupervisor } from "../../src/lib/async-hook-supervisor.cjs";

/**
 * Integration tier for the async hook supervisor: unlike the unit tests (which
 * inject a fake `spawn`), these drive the REAL `child_process.spawn` through a
 * shell, so the whole fire-and-forget path — stdin JSON, stdout capture,
 * exit-code classification, timeout kill — is exercised end to end. Commands are
 * `node -e …` so they run identically on Windows/macOS/Linux.
 */

const NODE = process.execPath.replace(/\\/g, "/");

/** Poll until the supervisor has drained records or the deadline passes. */
async function waitForResult(sup, ms = 8000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (sup.peekResults().length > 0) return sup.drainResults();
    await new Promise((r) => setTimeout(r, 25));
  }
  return sup.drainResults();
}

describe("AsyncHookSupervisor real spawn (integration)", () => {
  it("runs an async hook fire-and-forget and collects its stdout as context", async () => {
    const sup = new AsyncHookSupervisor();
    const disp = sup.dispatch(
      [
        {
          command: `"${NODE}" -e "console.log('BGHOOK_OK')"`,
          event: "PostToolUse",
        },
      ],
      { hook_event_name: "PostToolUse" },
    );
    expect(disp[0].dispatched).toBe(true);
    const results = await waitForResult(sup);
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
    expect(results[0].additionalContext).toMatch(/BGHOOK_OK/);
    sup.stopAll();
  });

  it("emits a JSON additionalContext payload back through the real pipe", async () => {
    const sup = new AsyncHookSupervisor();
    // A hook that reads the event JSON off stdin and echoes a decision object.
    const script =
      "let d='';process.stdin.on('data',c=>d+=c);" +
      "process.stdin.on('end',()=>{const p=JSON.parse(d);" +
      "console.log(JSON.stringify({additionalContext:'event='+p.hook_event_name}))})";
    sup.dispatch([{ command: `"${NODE}" -e "${script}"`, event: "Stop" }], {
      hook_event_name: "Stop",
    });
    const [r] = await waitForResult(sup);
    expect(r.ok).toBe(true);
    expect(r.additionalContext).toBe("event=Stop");
    sup.stopAll();
  });

  it("queues a rewake when a real asyncRewake hook exits non-zero", async () => {
    const sup = new AsyncHookSupervisor();
    sup.dispatch(
      [
        {
          command: `"${NODE}" -e "console.error('tests failed');process.exit(1)"`,
          event: "PostToolUse",
          asyncRewake: true,
        },
      ],
      {},
    );
    await waitForResult(sup);
    const rewakes = sup.drainRewakes();
    expect(rewakes).toHaveLength(1);
    expect(rewakes[0].ok).toBe(false);
    expect(rewakes[0].error).toMatch(/tests failed|hook exited 1/);
    sup.stopAll();
  });

  it("kills a real hook that overruns its timeout", async () => {
    const sup = new AsyncHookSupervisor();
    // Sleep ~5s but cap the hook at 0.2s → the supervisor must SIGTERM it.
    sup.dispatch(
      [
        {
          command: `"${NODE}" -e "setTimeout(()=>{},5000)"`,
          event: "Stop",
          timeout: 0.2,
          asyncRewake: true,
        },
      ],
      {},
    );
    const [r] = await waitForResult(sup, 6000);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/timed out/);
    expect(sup.runningCount()).toBe(0); // reaped
    sup.stopAll();
  });
});

// A hook runs with shell:true, so the real command is a GRANDCHILD of the shell.
// A bare child.kill() only signals the shell — the grandchild is orphaned
// (POSIX: reparented + keeps running; Windows: killing cmd.exe leaves children).
// These prove the supervisor tree-kills, honouring its no-orphan guarantee.
describe("AsyncHookSupervisor tree-kill (no orphaned grandchild)", () => {
  const isAlive = (pid) => {
    try {
      process.kill(pid, 0); // signal 0 = existence check (works on Win + POSIX)
      return true;
    } catch {
      return false;
    }
  };

  // Lay down a hook whose command spawns a long-lived grandchild that records
  // its own pid to a file, so the test can later assert the grandchild died.
  async function makeHookThatSpawnsGrandchild() {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-ahs-gc-"));
    const q = (p) => `"${p.replace(/\\/g, "/")}"`;
    const gcFile = path.join(dir, "gc.js");
    const hookFile = path.join(dir, "hook.js");
    const pidFile = path.join(dir, "gc.pid");
    // Grandchild: write my pid, then sit alive for a minute.
    fs.writeFileSync(
      gcFile,
      "const fs=require('fs');fs.writeFileSync(process.argv[2],String(process.pid));setTimeout(()=>{},60000);",
      "utf8",
    );
    // Hook: spawn the grandchild (inherits the shell's process group), stay alive.
    fs.writeFileSync(
      hookFile,
      "const cp=require('child_process');cp.spawn(process.execPath,[process.argv[2],process.argv[3]],{stdio:'ignore'});setTimeout(()=>{},60000);",
      "utf8",
    );
    const command = `${q(NODE)} ${q(hookFile)} ${q(gcFile)} ${q(pidFile)}`;
    const readGpid = async (ms = 6000) => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        try {
          const n = Number(fs.readFileSync(pidFile, "utf8").trim());
          if (Number.isInteger(n) && n > 0) return n;
        } catch {
          /* not written yet */
        }
        await new Promise((r) => setTimeout(r, 25));
      }
      return 0;
    };
    const cleanup = () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    };
    return { command, dir, readGpid, cleanup };
  }

  async function waitUntil(pred, ms = 6000) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (pred()) return true;
      await new Promise((r) => setTimeout(r, 25));
    }
    return pred();
  }

  it("tree-kills the grandchild when the hook overruns its timeout", async () => {
    const { command, readGpid, cleanup } = await makeHookThatSpawnsGrandchild();
    const sup = new AsyncHookSupervisor();
    try {
      sup.dispatch([{ command, event: "Stop", timeout: 0.5 }], {});
      const gpid = await readGpid();
      expect(gpid).toBeGreaterThan(0);
      // NOTE: no isAlive(gpid)===true sanity here. Under full-suite load the
      // 0.5s timeout often fires (and tree-kills successfully) BEFORE our
      // 25ms poll first reads the pid file — the behavior under test
      // succeeding early. The teeth are below: without the tree-kill the
      // grandchild sits alive for 60s and this times out red.
      await waitUntil(() => !isAlive(gpid), 6000);
      expect(isAlive(gpid)).toBe(false);
    } finally {
      sup.stopAll();
      cleanup();
    }
  });

  it("tree-kills the grandchild on stopAll (session-end reap)", async () => {
    const { command, readGpid, cleanup } = await makeHookThatSpawnsGrandchild();
    const sup = new AsyncHookSupervisor();
    try {
      // Long timeout so ONLY stopAll (not the timeout) does the reaping.
      sup.dispatch([{ command, event: "Stop", timeout: 30 }], {});
      const gpid = await readGpid();
      expect(gpid).toBeGreaterThan(0);
      expect(isAlive(gpid)).toBe(true);
      sup.stopAll();
      await waitUntil(() => !isAlive(gpid), 6000);
      expect(isAlive(gpid)).toBe(false);
    } finally {
      sup.stopAll();
      cleanup();
    }
  });
});
