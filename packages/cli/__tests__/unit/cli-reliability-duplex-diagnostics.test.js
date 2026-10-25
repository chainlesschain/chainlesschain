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
  descendantProcessSnapshot: () => ({ available: true, pids: [] }),
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

function stalledChild({ emitErrorResult = true } = {}) {
  const child = new EventEmitter();
  child.pid = 123;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  child.stdin = new EventEmitter();
  child.stdin.write = vi.fn(() => {
    if (emitErrorResult && child.stdin.write.mock.calls.length === 1) {
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
  });
  child.stdin.end = vi.fn(() => finishChild(child));
  return child;
}

function finishChild(child, code = 0) {
  child.emit("exit", code, null);
  child.stdout.end();
  child.stderr.end();
  child.emit("close", code, null);
}

function result(child, event) {
  child.stdout.write(JSON.stringify({ type: "result", ...event }) + "\n");
}

async function startScenario(child, options = {}) {
  const snapshots = [];
  let markSpawned;
  const spawned = new Promise((resolve) => {
    markSpawned = resolve;
  });
  const retire =
    options.retireChild ||
    vi.fn(async () => ({
      closed: true,
      treeTerminated: true,
      confirmed: true,
    }));
  const pending = duplexSoakScenario(
    "http://localhost",
    directory(),
    { ...profile, ...options.profile },
    {
      spawnChild() {
        markSpawned();
        return child;
      },
      sampleIo: () => ({ available: false }),
      retireChild: retire,
      checkpoint(snapshot) {
        snapshots.push(structuredClone(snapshot));
        options.checkpoint?.(snapshot);
      },
    },
  ).catch((error) => error);
  await spawned;
  return { pending, snapshots, retire };
}

describe("duplex failure evidence", () => {
  it.each([2, 0])(
    "immediately retains the original error result with %s warmup turns",
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
          kind: "result-error",
          awaitedResultCount: 1,
          result: {
            turn: 1,
            subtype: "unknown",
            errorDetails: {
              kind: "transport",
              name: "TypeError",
              causeCode: "UND_ERR_SOCKET",
            },
          },
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
      const error = await pending;
      expect(error).toMatchObject({
        code: "CC_RELIABILITY_RESULT_ERROR",
        message: "turn 1 returned an error result",
      });
      expect(child.stdin.write).toHaveBeenCalledOnce();
      expect(retire).toHaveBeenCalledOnce();
      expect(snapshots[0].failure).toEqual(snapshots.at(-1).failure);
      expect(vi.getTimerCount()).toBe(0);
      const snapshot = snapshots.at(-1);
      expect(snapshot).toMatchObject({
        status: "failed",
        resultCount: 1,
        sentCount: 1,
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
          return stalledChild({ emitErrorResult: false });
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
      message: "turn 1 timed out",
      reliabilityCleanupIncomplete: true,
    });
    expect(snapshots.at(-1).cleanup.confirmed).toBe(false);
  }, 10_000);

  it.each([false, true, undefined])(
    "stops at a failing result followed by close (is_error=%s)",
    async (isError) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const child = stalledChild({ emitErrorResult: false });
      child.stdin.write.mockImplementation(() => {
        result(child, {
          is_error: isError,
          subtype: "error_evolution_ingress",
          code: "CC_AGENT_EVOLUTION_INGRESS_FAILED",
          error:
            secret +
            " [storage_reason: release-clock-window] [storage_cause_codes: CC_EVOLUTION_ARTIFACT_EXPIRED]",
        });
        finishChild(child, 1);
        return true;
      });
      const run = await startScenario(child);
      await vi.advanceTimersByTimeAsync(250);
      expect(await run.pending).toMatchObject({
        code:
          isError === false
            ? "CC_RELIABILITY_CHILD_CLOSED"
            : "CC_RELIABILITY_RESULT_ERROR",
      });
      expect(child.stdin.write).toHaveBeenCalledOnce();
      expect(run.snapshots.at(-1).results.subtypeCounts).toEqual({
        unknown: 1,
      });
      expect(run.snapshots.at(-1).results.errorCount).toBe(
        isError === false ? 0 : 1,
      );
      if (isError !== false) {
        expect(run.snapshots.at(-1).failure.result).toMatchObject({
          subtype: "unknown",
          storageCauseCodes: ["CC_EVOLUTION_ARTIFACT_EXPIRED"],
          storageReason: "release-clock-window",
        });
      }
      expect(run.snapshots[0].failure).toEqual(run.snapshots.at(-1).failure);
      expect(JSON.stringify(run.snapshots)).not.toContain(secret);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(
    ["code", "error", "result"].flatMap((field) =>
      [
        ["object", { toString: 0, private: secret }],
        ["null", null],
        ["array", [{ toString: 0, private: secret }]],
      ].map(([shape, value]) => ({ field, shape, value })),
    ),
  )(
    "locks the NDJSON result error before inspecting $shape $field",
    async ({ field, value }) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const child = stalledChild({ emitErrorResult: false });
      child.stdin.write.mockImplementation(() => {
        // Exercise JSON encoding, a split transport chunk and the actual parser.
        // Include valid non-result JSON and invalid JSON before the terminal row.
        child.stdout.write('null\n[]\n{"broken":\n');
        const line =
          JSON.stringify({
            type: "result",
            is_error: true,
            subtype: secret,
            code: "CC_AGENT_EVOLUTION_INGRESS_FAILED",
            error: secret,
            result: secret,
            [field]: value,
          }) + "\n";
        const split = Math.floor(line.length / 2);
        child.stdout.write(line.slice(0, split));
        child.stdout.write(line.slice(split));
        return true;
      });
      const run = await startScenario(child);
      await vi.advanceTimersByTimeAsync(250);
      expect(await run.pending).toMatchObject({
        code: "CC_RELIABILITY_RESULT_ERROR",
        message: "turn 1 returned an error result",
      });
      expect(child.stdin.write).toHaveBeenCalledOnce();
      expect(run.snapshots.at(-1)).toMatchObject({
        sentCount: 1,
        resultCount: 1,
        results: { errorCount: 1, subtypeCounts: { unknown: 1 } },
        failure: {
          kind: "result-error",
          result: { turn: 1, subtype: "unknown", errorDetails: null },
        },
      });
      expect(run.snapshots[0].failure).toEqual(run.snapshots.at(-1).failure);
      expect(run.snapshots.at(-1).diagnosticCodes).toEqual(
        field === "code" ? [] : ["CC_AGENT_EVOLUTION_INGRESS_FAILED"],
      );
      expect(JSON.stringify(run.snapshots)).not.toContain(secret);
      expect(run.retire).toHaveBeenCalledWith(
        child,
        expect.any(Object),
        10_000,
      );
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("preserves the first timeout when a late result arrives during cleanup", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const child = stalledChild({ emitErrorResult: false });
    let finishCleanup;
    const retire = vi.fn(
      () =>
        new Promise((resolve) => {
          finishCleanup = resolve;
        }),
    );
    const run = await startScenario(child, { retireChild: retire });
    await vi.advanceTimersByTimeAsync(60_249);
    expect(retire).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(retire).toHaveBeenCalledOnce();
    result(child, { is_error: false, subtype: "success" });
    result(child, { is_error: true, subtype: secret, result: secret });
    finishChild(child, 1);
    finishCleanup({ confirmed: false, closed: true, treeTerminated: false });
    expect(await run.pending).toMatchObject({
      code: "CC_RELIABILITY_TURN_TIMEOUT",
      message: "turn 1 timed out",
      reliabilityCleanupIncomplete: true,
    });
    expect(run.snapshots[0].failure).toEqual({
      kind: "turn-timeout",
      awaitedResultCount: 1,
      timeoutMs: 60_000,
    });
    expect(run.snapshots.at(-1).failure).toEqual(run.snapshots[0].failure);
    expect(child.stdin.write).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(JSON.stringify(run.snapshots)).not.toContain(secret);
  });

  it("preserves the ingress failure at result 141 without sending input 142", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const child = stalledChild({ emitErrorResult: false });
    child.stdin.write.mockImplementation(() => {
      if (child.stdin.write.mock.calls.length < 141) {
        result(child, { is_error: false, subtype: "success" });
      } else {
        result(child, {
          is_error: true,
          subtype: "error_evolution_ingress",
          code: "CC_AGENT_EVOLUTION_INGRESS_FAILED",
          error:
            secret +
            " [storage_reason: release-clock-window] [storage_cause_codes: CC_EVOLUTION_ARTIFACT_EXPIRED]",
        });
        finishChild(child, 1);
      }
      return true;
    });
    const run = await startScenario(child, {
      profile: { warmupTurns: 20, turns: 1000 },
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(await run.pending).toMatchObject({
      code: "CC_RELIABILITY_RESULT_ERROR",
      message: "turn 141 returned an error result",
    });
    expect(child.stdin.write).toHaveBeenCalledTimes(141);
    expect(run.snapshots.at(-1)).toMatchObject({
      sentCount: 141,
      resultCount: 141,
      turns: 120,
      results: {
        count: 141,
        errorCount: 1,
        subtypeCounts: { success: 140, unknown: 1 },
      },
      failure: {
        kind: "result-error",
        awaitedResultCount: 141,
        result: {
          turn: 141,
          subtype: "unknown",
          storageCauseCodes: ["CC_EVOLUTION_ARTIFACT_EXPIRED"],
          storageReason: "release-clock-window",
        },
      },
    });
    expect(run.snapshots.at(-1).failure).toEqual(run.snapshots.at(-2).failure);
    expect(JSON.stringify(run.snapshots)).not.toContain(secret);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0, 300])(
    "fails immediately on close during startup or result wait at %sms",
    async (closeAt) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const child = stalledChild({ emitErrorResult: false });
      const run = await startScenario(child);
      await vi.advanceTimersByTimeAsync(closeAt);
      child.stderr.write(`Error: ${secret}\n`);
      finishChild(child, 1);
      expect(await run.pending).toMatchObject({
        code: "CC_RELIABILITY_CHILD_CLOSED",
      });
      expect(child.stdin.write).toHaveBeenCalledTimes(closeAt === 0 ? 0 : 1);
      expect(run.retire).toHaveBeenCalledOnce();
      expect(run.snapshots.at(-1)).toMatchObject({
        childExit: { code: 1, signal: null },
        startupDiagnostics: { classes: ["command-error"] },
      });
      expect(JSON.stringify(run.snapshots)).not.toContain(secret);
      expect(vi.getTimerCount()).toBe(0);
      expect(child.stdout.listenerCount("data")).toBe(0);
      expect(child.stdin.listenerCount("error")).toBe(0);
    },
  );

  it("projects child signal evidence without retaining arbitrary values", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const child = stalledChild({ emitErrorResult: false });
    const run = await startScenario(child);
    child.emit("exit", null, secret);
    child.emit("close", null, secret);
    expect(await run.pending).toMatchObject({
      code: "CC_RELIABILITY_CHILD_CLOSED",
    });
    expect(run.snapshots.at(-1).childExit).toEqual({
      code: null,
      signal: "unknown",
    });
    expect(JSON.stringify(run.snapshots)).not.toContain(secret);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves a final error result arriving after exit but before close without another write", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const child = stalledChild({ emitErrorResult: false });
    child.stdin.write.mockImplementation(() => {
      result(child, { is_error: false, subtype: "success" });
      child.emit("exit", 1, null);
      return true;
    });
    const run = await startScenario(child);
    await vi.advanceTimersByTimeAsync(250);
    expect(child.stdin.write).toHaveBeenCalledOnce();
    result(child, { is_error: true, subtype: "error", result: secret });
    finishChild(child, 1);
    expect(await run.pending).toMatchObject({
      code: "CC_RELIABILITY_RESULT_ERROR",
    });
    expect(child.stdin.write).toHaveBeenCalledOnce();
    expect(run.snapshots.at(-1).results.errorCount).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["result", "close", "stdin-error", "timeout"])(
    "interrupts stdin backpressure on %s and removes the drain listener",
    async (trigger) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const child = stalledChild({ emitErrorResult: false });
      child.stdin.write.mockReturnValue(false);
      const run = await startScenario(child);
      await vi.advanceTimersByTimeAsync(250);
      expect(child.stdin.listenerCount("drain")).toBe(1);
      if (trigger === "result")
        result(child, { is_error: true, subtype: "error" });
      if (trigger === "close") finishChild(child, 1);
      if (trigger === "stdin-error")
        child.stdin.emit("error", new Error(secret));
      if (trigger === "timeout") await vi.advanceTimersByTimeAsync(60_000);
      const codes = {
        result: "CC_RELIABILITY_RESULT_ERROR",
        close: "CC_RELIABILITY_CHILD_CLOSED",
        "stdin-error": "CC_RELIABILITY_STDIN_ERROR",
        timeout: "CC_RELIABILITY_TURN_TIMEOUT",
      };
      expect(await run.pending).toMatchObject({ code: codes[trigger] });
      expect(child.stdin.write).toHaveBeenCalledOnce();
      expect(child.stdin.listenerCount("drain")).toBe(0);
      expect(child.stdin.listenerCount("error")).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(JSON.stringify(run.snapshots)).not.toContain(secret);
    },
  );

  it.each(["result", "close"])(
    "interrupts pacing on %s without sending another input",
    async (trigger) => {
      vi.useFakeTimers({
        toFake: ["setTimeout", "clearTimeout", "performance"],
      });
      const child = stalledChild({ emitErrorResult: false });
      child.stdin.write.mockImplementation(() => {
        result(child, { is_error: false, subtype: "success" });
        return true;
      });
      const run = await startScenario(child, {
        profile: { warmupTurns: 0, durationSeconds: 100, turns: 2 },
      });
      await vi.advanceTimersByTimeAsync(50_250);
      expect(child.stdin.write).toHaveBeenCalledOnce();
      if (trigger === "result")
        result(child, { is_error: true, subtype: "error" });
      else finishChild(child, 1);
      expect(await run.pending).toBeInstanceOf(Error);
      expect(child.stdin.write).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("keeps a successful duplex run successful and releases its listeners", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const child = stalledChild({ emitErrorResult: false });
    child.stdin.write.mockImplementation(() => {
      result(child, { is_error: false, subtype: "success", result: "ok" });
      return true;
    });
    const run = await startScenario(child, {
      profile: { maxRssGrowthMb: 128, maxResourceGrowth: 8 },
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(await run.pending).toMatchObject({
      pass: true,
      turns: 2,
      results: { count: 4, errorCount: 0 },
    });
    expect(child.stdin.write).toHaveBeenCalledTimes(4);
    expect(run.retire).not.toHaveBeenCalled();
    expect(child.stdin.listenerCount("error")).toBe(0);
    expect(child.stdout.listenerCount("data")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("terminates an error result received while waiting for the normal final close", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const child = stalledChild({ emitErrorResult: false });
    child.stdin.write.mockImplementation(() => {
      result(child, { is_error: false, subtype: "success" });
      return true;
    });
    child.stdin.end.mockImplementation(() => {});
    const run = await startScenario(child);
    await vi.advanceTimersByTimeAsync(250);
    expect(child.stdin.end).toHaveBeenCalledOnce();
    result(child, { is_error: true, subtype: "error" });
    expect(await run.pending).toMatchObject({
      code: "CC_RELIABILITY_RESULT_ERROR",
    });
    expect(run.retire).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retains the original completion deadline when the final close never arrives", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const child = stalledChild({ emitErrorResult: false });
    child.stdin.write.mockImplementation(() => {
      result(child, { is_error: false, subtype: "success" });
      return true;
    });
    child.stdin.end.mockImplementation(() => {});
    const run = await startScenario(child);
    await vi.advanceTimersByTimeAsync(30_249);
    expect(run.retire).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await run.pending).toMatchObject({
      code: "CC_RELIABILITY_CHILD_COMPLETION_TIMEOUT",
    });
    expect(run.retire).toHaveBeenCalledWith(child, expect.any(Object), 10_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retains the original result failure if evidence writing and cleanup fail", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const child = stalledChild();
    const run = await startScenario(child, {
      checkpoint: () => {
        throw new Error(secret);
      },
      retireChild: vi.fn(async () => {
        throw new Error(secret);
      }),
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(await run.pending).toMatchObject({
      code: "CC_RELIABILITY_RESULT_ERROR",
      reliabilityCleanupIncomplete: true,
    });
    expect(run.snapshots).toHaveLength(2);
    expect(run.snapshots[0].failure).toEqual(run.snapshots[1].failure);
    expect(run.snapshots[1].cleanup).toMatchObject({
      confirmed: false,
      failure: "cleanup-failed",
    });
    expect(JSON.stringify(run.snapshots)).not.toContain(secret);
    expect(vi.getTimerCount()).toBe(0);
  });

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
        diagnostics: {
          initialExitObserved: true,
          reason: "root-exited-before-tree-retirement",
          signalAttempted: false,
          probeCount: 0,
        },
      });
      expect(kill).not.toHaveBeenCalled();
    } finally {
      kill.mockRestore();
    }
  }, 20_000);
});
