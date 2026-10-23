import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../scripts/soak-host-metrics.mjs", async (original) => ({
  ...(await original()),
  resourceCount: () => ({ kind: "handle", count: 4 }),
  rssBytes: () => 1024,
}));

import {
  duplexSoakScenario,
  observeChildCompletion,
  retireDuplexProcessTree,
} from "../../scripts/cli-reliability-soak.mjs";

const temp = fs.realpathSync.native(os.tmpdir());
const roots = [];
function directory() {
  const root = fs.mkdtempSync(path.join(temp, "cc-duplex-diagnostics-"));
  roots.push(root);
  return root;
}
afterEach(() => {
  vi.useRealTimers();
  for (const root of roots.splice(0)) {
    expect(path.dirname(path.resolve(root))).toBe(temp);
    expect(path.basename(root).startsWith("cc-duplex-diagnostics-")).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
const profile = {
  warmupTurns: 2,
  turns: 2,
  durationSeconds: 0,
  cleanupDeadlineMs: 10_000,
  checkpointIntervalSeconds: 0,
};
const secret = "PRIVATE_DUPLEX_CANARY";

function stalledChild() {
  const child = new EventEmitter();
  child.pid = 123;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  child.stdin = {
    write: vi.fn(() => {
      if (child.stdin.write.mock.calls.length === 1) {
        child.stdout.write(
          JSON.stringify({
            type: "result",
            is_error: true,
            subtype: secret,
            result: secret,
            error: secret,
            error_details: {
              kind: "transport",
              name: "TypeError",
              causeCode: "UND_ERR_SOCKET",
              message: secret,
            },
          }) + "\n",
        );
      }
      return true;
    }),
  };
  return child;
}

describe("duplex failure evidence", () => {
  it.each([2, 0])(
    "retains safe diagnostics on a timeout with %s warmup turns",
    async (warmupTurns) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const home = directory();
      const snapshots = [];
      const child = stalledChild();
      let markSpawned;
      const spawned = new Promise((resolve) => {
        markSpawned = resolve;
      });
      const retire = vi.fn(async (_child, _completion, deadline) => {
        expect(deadline).toBe(10_000);
        expect(snapshots.at(-1).failure).toEqual({
          kind: "turn-timeout",
          awaitedResultCount: 2,
          timeoutMs: 60_000,
        });
        return { closed: true, treeTerminated: true, confirmed: true };
      });
      const pending = duplexSoakScenario(
        "http://localhost",
        home,
        { ...profile, warmupTurns },
        {
          spawnChild(_args, options) {
            fs.writeFileSync(
              options.env.CC_VERIFY01_FETCH_DIAGNOSTICS_FILE,
              JSON.stringify({
                schema: "chainlesschain.fetch-diagnostics/v1",
                event: "undici:request:error",
                endpoint: "loopback-broker",
                error: { code: "UND_ERR_SOCKET", message: secret },
                body: secret,
              }) + "\n",
            );
            markSpawned();
            return child;
          },
          checkpoint: (snapshot) => snapshots.push(structuredClone(snapshot)),
          retireChild: retire,
          sampleIo: () => ({ available: false }),
        },
      ).catch((error) => error);
      await spawned;
      await vi.advanceTimersByTimeAsync(250);
      await vi.advanceTimersByTimeAsync(59_999);
      expect(retire).not.toHaveBeenCalled();
      expect(snapshots.filter((value) => value.status === "failed")).toEqual(
        [],
      );
      if (warmupTurns === 0) {
        expect(snapshots[0]).toMatchObject({
          status: "running",
          results: { count: 1, errorCount: 1 },
        });
        expect(snapshots[0].fetchDiagnostics.events).toHaveLength(1);
      }
      await vi.advanceTimersByTimeAsync(1);
      const error = await pending;
      expect(error.message).toBe("turn 2 timed out");
      expect(retire).toHaveBeenCalledOnce();
      const snapshot = snapshots.at(-1);
      expect(snapshot).toMatchObject({
        status: "failed",
        resultCount: 1,
        sentCount: 2,
        results: {
          count: 1,
          errorCount: 1,
          subtypeCounts: { unknown: 1 },
          failures: [
            {
              turn: 1,
              subtype: "unknown",
              errorDetails: {
                kind: "transport",
                name: "TypeError",
                causeCode: "UND_ERR_SOCKET",
              },
            },
          ],
        },
        fetchDiagnostics: {
          events: [
            {
              event: "undici:request:error",
              endpoint: "loopback-broker",
              error: { code: "UND_ERR_SOCKET" },
            },
          ],
        },
        fetchRuntime: { node: process.versions.node },
        cleanup: { confirmed: true },
      });
      expect(JSON.stringify(snapshots)).not.toContain(secret);
    },
    10_000,
  );

  it("retains the primary timeout and prevents root removal when cleanup is unconfirmed", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const snapshots = [];
    let markSpawned;
    const spawned = new Promise((resolve) => {
      markSpawned = resolve;
    });
    const pending = duplexSoakScenario(
      "http://localhost",
      directory(),
      profile,
      {
        spawnChild: () => {
          markSpawned();
          return stalledChild();
        },
        retireChild: async () => ({
          closed: false,
          treeTerminated: false,
          confirmed: false,
        }),
        checkpoint: (snapshot) => snapshots.push(snapshot),
      },
    ).catch((error) => error);
    await spawned;
    await vi.advanceTimersByTimeAsync(60_250);
    expect(await pending).toMatchObject({
      message: "turn 2 timed out",
      reliabilityCleanupIncomplete: true,
    });
    expect(snapshots.at(-1).cleanup.confirmed).toBe(false);
  }, 10_000);

  it("closes a real resource-holding child tree before its files are removed", async () => {
    const root = directory();
    const childSource = `const fs=require('fs'); const cp=require('child_process');
      fs.openSync(process.argv[1],'w');
      const leaf=cp.spawn(process.execPath,['-e',"require('fs').openSync(process.argv[1],'w');process.stdout.write('ready');setInterval(()=>{},1000)",process.argv[2]],{stdio:['ignore','pipe','ignore'],windowsHide:true});
      leaf.stdout.once('data',()=>process.stdout.write(JSON.stringify({leaf:leaf.pid})+'\\n'));
      setInterval(()=>{},1000);`;
    const child = spawn(
      process.execPath,
      [
        "-e",
        childSource,
        path.join(root, "root-held.db"),
        path.join(root, "leaf-held.db"),
      ],
      {
        detached: process.platform !== "win32",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const completion = observeChildCompletion(child);
    child.stderr.resume();
    let closed = false;
    child.once("close", () => {
      closed = true;
    });
    let leaf;
    try {
      const [chunk] = await once(child.stdout, "data");
      leaf = JSON.parse(String(chunk)).leaf;
      expect(fs.existsSync(path.join(root, "leaf-held.db"))).toBe(true);
      const result = await retireDuplexProcessTree(child, completion, 10_000);
      expect(result, JSON.stringify(result)).toMatchObject({
        confirmed: true,
        closed: true,
        treeTerminated: true,
      });
      expect(closed).toBe(true);
      for (const pid of [child.pid, leaf]) {
        expect(() => process.kill(pid, 0)).toThrow();
      }
      fs.rmSync(root, { recursive: true, force: true });
      expect(fs.existsSync(root)).toBe(false);
    } finally {
      if (!closed) child.kill("SIGKILL");
      if (leaf) {
        try {
          process.kill(leaf, "SIGKILL");
        } catch {}
      }
    }
  }, 20_000);

  it.each(["signal-group", "probe-group"])(
    "keeps a POSIX %s permission failure unconfirmed with safe diagnostics",
    async (failureStage) => {
      const kill = vi.fn((_pid, signal) => {
        if (failureStage === "signal-group" || signal === 0) {
          throw Object.assign(new Error(secret), { code: "EPERM" });
        }
      });
      const result = await retireDuplexProcessTree(
        { pid: 123 },
        { exit: () => null, wait: async () => {} },
        10_000,
        {
          platform: failureStage === "signal-group" ? "darwin" : "linux",
          kill,
        },
      );
      expect(result).toMatchObject({
        confirmed: false,
        closed: true,
        treeTerminated: false,
        deadlineExceeded: false,
        diagnostics: {
          method: "posix-process-group",
          initialExitObserved: false,
          signalAttempted: true,
          failureStage,
          errorCode: "EPERM",
          probeCount: failureStage === "signal-group" ? 0 : 1,
        },
      });
      expect(kill.mock.calls).toEqual(
        failureStage === "signal-group"
          ? [[-123, "SIGKILL"]]
          : [
              [-123, "SIGKILL"],
              [-123, 0],
            ],
      );
      expect(JSON.stringify(result)).not.toContain(secret);
    },
  );

  it("waits through a Darwin permission probe until explicit group absence without resending the signal", async () => {
    let elapsed = 0;
    let probes = 0;
    const kill = vi.fn((_pid, signal) => {
      if (signal !== 0) return;
      probes += 1;
      throw Object.assign(new Error(secret), {
        code: probes === 1 ? "EPERM" : "ESRCH",
      });
    });
    const wait = vi.fn(async (budget) => expect(budget).toBe(10_000));
    const result = await retireDuplexProcessTree(
      { pid: 123 },
      { exit: () => null, wait },
      10_000,
      {
        platform: "darwin",
        kill,
        now: () => elapsed,
        sleep: async (delay) => {
          elapsed += delay;
        },
      },
    );
    expect(result).toMatchObject({
      confirmed: true,
      closed: true,
      treeTerminated: true,
      deadlineExceeded: false,
      elapsedMs: 25,
      diagnostics: {
        probeCount: 2,
        permissionProbeCount: 1,
        failureStage: null,
        errorCode: null,
      },
    });
    expect(kill.mock.calls).toEqual([
      [-123, "SIGKILL"],
      [-123, 0],
      [-123, 0],
    ]);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("keeps persistent Darwin permission probes unconfirmed at the original cleanup deadline", async () => {
    let elapsed = 0;
    const kill = vi.fn((_pid, signal) => {
      if (signal === 0)
        throw Object.assign(new Error(secret), { code: "EPERM" });
    });
    const result = await retireDuplexProcessTree(
      { pid: 123 },
      { exit: () => null, wait: async () => {} },
      10_000,
      {
        platform: "darwin",
        kill,
        now: () => elapsed,
        sleep: async (delay) => {
          elapsed += delay;
        },
      },
    );
    expect(result).toMatchObject({
      confirmed: false,
      closed: true,
      treeTerminated: false,
      deadlineExceeded: true,
      elapsedMs: 10_000,
      diagnostics: {
        probeCount: 400,
        permissionProbeCount: 400,
        failureStage: "probe-group",
        errorCode: "EPERM",
      },
    });
    expect(
      kill.mock.calls.filter(([, signal]) => signal === "SIGKILL"),
    ).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("does not poll past an unsuccessful Darwin group signal", async () => {
    const kill = vi.fn((_pid, signal) => {
      throw Object.assign(new Error(secret), {
        code: signal === 0 ? "EPERM" : "ESRCH",
      });
    });
    const sleep = vi.fn();
    const result = await retireDuplexProcessTree(
      { pid: 123 },
      { exit: () => null, wait: async () => {} },
      10_000,
      { platform: "darwin", kill, sleep },
    );
    expect(result).toMatchObject({
      confirmed: false,
      diagnostics: { permissionProbeCount: 0, errorCode: "EPERM" },
    });
    expect(sleep).not.toHaveBeenCalled();
  });

  it("keeps other Darwin probe errors unconfirmed without delaying or exposing their message", async () => {
    const kill = vi.fn((_pid, signal) => {
      if (signal === 0)
        throw Object.assign(new Error(secret), { code: "EINVAL" });
    });
    const sleep = vi.fn();
    const result = await retireDuplexProcessTree(
      { pid: 123 },
      { exit: () => null, wait: async () => {} },
      10_000,
      { platform: "darwin", kill, sleep },
    );
    expect(result).toMatchObject({
      confirmed: false,
      diagnostics: {
        permissionProbeCount: 0,
        failureStage: "probe-group",
        errorCode: "EINVAL",
      },
    });
    expect(sleep).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("preserves the terminal error when a Darwin permission probe is followed by a different failure", async () => {
    let elapsed = 0;
    let probes = 0;
    const kill = vi.fn((_pid, signal) => {
      if (signal !== 0) return;
      throw Object.assign(new Error(secret), {
        code: ++probes === 1 ? "EPERM" : "EACCES",
      });
    });
    const result = await retireDuplexProcessTree(
      { pid: 123 },
      { exit: () => null, wait: async () => {} },
      10_000,
      {
        platform: "darwin",
        kill,
        now: () => elapsed,
        sleep: async (delay) => {
          elapsed += delay;
        },
      },
    );
    expect(result).toMatchObject({
      confirmed: false,
      elapsedMs: 25,
      diagnostics: {
        probeCount: 2,
        permissionProbeCount: 1,
        failureStage: "probe-group",
        errorCode: "EACCES",
      },
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("does not confirm retirement when group absence is observed but the root close cannot be confirmed", async () => {
    const kill = vi.fn((_pid, signal) => {
      if (signal === 0)
        throw Object.assign(new Error(secret), { code: "ESRCH" });
    });
    const result = await retireDuplexProcessTree(
      { pid: 123 },
      {
        exit: () => null,
        wait: async () => {
          throw Object.assign(new Error(secret), { code: "ETIMEDOUT" });
        },
      },
      10_000,
      { platform: "darwin", kill },
    );
    expect(result).toMatchObject({
      confirmed: false,
      closed: false,
      treeTerminated: true,
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("keeps an observation wait failure unconfirmed with safe diagnostics", async () => {
    const kill = vi.fn();
    const result = await retireDuplexProcessTree(
      { pid: 123 },
      { exit: () => null, wait: async () => {} },
      10_000,
      {
        platform: "darwin",
        kill,
        sleep: async () => {
          throw Object.assign(new Error(secret), { code: "EACCES" });
        },
      },
    );
    expect(result).toMatchObject({
      confirmed: false,
      treeTerminated: false,
      diagnostics: { failureStage: "wait-group", errorCode: "EACCES" },
    });
    expect(kill.mock.calls).toEqual([
      [-123, "SIGKILL"],
      [-123, 0],
    ]);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("never signals an already exited root PID or claims its descendants are retired", async () => {
    const child = spawn(process.execPath, ["-e", "process.exit(0)"], {
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: "ignore",
    });
    const completion = observeChildCompletion(child);
    await completion.wait(10_000);
    const kill = vi.spyOn(child, "kill");
    try {
      expect(
        await retireDuplexProcessTree(child, completion, 10_000),
      ).toMatchObject({
        closed: true,
        treeTerminated: false,
        confirmed: false,
        deadlineExceeded: false,
      });
      expect(kill).not.toHaveBeenCalled();
    } finally {
      kill.mockRestore();
    }
  }, 20_000);
});
