import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import sharedRuntime from "@chainlesschain/session-core/scheduler-runtime";
import {
  SchedulerRuntime as CliSchedulerRuntime,
  createSchedulerRuntime as createCliSchedulerRuntime,
} from "../../src/lib/scheduler-kernel/runtime.js";
import { openSchedulerStore } from "../../src/lib/scheduler-kernel/store.js";
import { SchedulerOccurrenceGraphAuthority } from "../../src/lib/scheduler-kernel/graph-authority-adapter.js";

const { SchedulerRuntime } = sharedRuntime;
const require = createRequire(import.meta.url);
// The extracted CJS runtime resolves its contract through Node's CJS cache.
// Vite transforms workspace ESM imports separately; use the native contract
// here and verify actual ESM shim identity in the isolated Node probe below.
const {
  SchedulerKernelError,
} = require("@chainlesschain/session-core/scheduler-contract");
const stores = [];

afterEach(() => {
  vi.unstubAllEnvs();
  while (stores.length) stores.pop().close();
});

function fixture() {
  const now = 1_700_000_000_000;
  const store = openSchedulerStore({
    file: ":memory:",
    Database,
    clock: () => now,
  });
  stores.push(store);
  store.createJob({
    id: "host-job",
    kind: "test.host-boundary",
    trigger: { source: "manual" },
    payload: { projectId: "p1" },
    authority: {
      principal: { type: "test", id: "host-owner" },
      requestedCapabilities: ["project.risk.read"],
      authorizationRefs: {},
    },
    maxAttempts: 2,
  });
  const occurrence = store.enqueueOccurrence({
    jobId: "host-job",
    scheduledFor: now,
    triggerKey: "check-1",
  });
  const execute = vi.fn(() => ({ checked: true }));
  return {
    store,
    occurrence,
    execute,
    options: {
      store,
      adapters: [{ kind: "test.host-boundary", execute }],
      authorize: () => ({ allowed: true }),
    },
  };
}

describe("host-neutral scheduler runtime authority boundary", () => {
  it.each([
    {},
    { graphAuthority: null },
    { graphAuthorityMode: "canonical" },
    { graphAuthorityMode: "shadow", graphAuthority: null },
  ])("requires an explicit available authority choice: %j", (choice) => {
    const f = fixture();
    expect(
      () => new SchedulerRuntime({ ...f.options, ...choice }),
    ).toThrowError(
      expect.objectContaining({
        code: "SCHEDULER_RUNTIME_GRAPH_AUTHORITY_REQUIRED",
      }),
    );
    expect(f.store.getOccurrence(f.occurrence.id).status).toBe("queued");
    expect(f.execute).not.toHaveBeenCalled();
  });

  it("rejects malformed or contradictory injected authority before any claim", () => {
    const f = fixture();
    const authority = {
      mode: "shadow",
      begin() {},
      settleSuccess() {},
      settleFailure() {},
    };
    for (const choice of [
      { graphAuthority: {} },
      { graphAuthority: { mode: "legacy", begin() {} } },
      { graphAuthorityMode: "invalid" },
      { graphAuthorityMode: "canonical", graphAuthority: authority },
    ]) {
      expect(
        () => new SchedulerRuntime({ ...f.options, ...choice }),
      ).toThrowError(
        expect.objectContaining({
          code: "SCHEDULER_RUNTIME_INVALID_GRAPH_AUTHORITY",
        }),
      );
    }
    expect(f.execute).not.toHaveBeenCalled();
  });

  it("requires the host authorizer even after an explicit legacy selection", () => {
    const f = fixture();
    expect(
      () =>
        new SchedulerRuntime({
          ...f.options,
          graphAuthorityMode: "legacy",
          authorize: undefined,
        }),
    ).toThrowError(
      expect.objectContaining({
        code: "SCHEDULER_RUNTIME_AUTHORIZER_REQUIRED",
      }),
    );
  });

  it.each([false, true, null, { allowed: false }, { allowed: "true" }])(
    "never turns an absent explicit allow into execution: %j",
    async (decision) => {
      const f = fixture();
      const runtime = new SchedulerRuntime({
        ...f.options,
        graphAuthorityMode: "legacy",
        authorize: () => decision,
      });
      await expect(
        runtime.runOccurrence(f.occurrence.id),
      ).resolves.toMatchObject({
        status: "dead_letter",
        error: { code: "SCHEDULER_RUNTIME_AUTHORIZATION_DENIED" },
      });
      expect(f.execute).not.toHaveBeenCalled();
    },
  );

  it("does not load Graph defaults or read the CLI mode for explicit legacy work", async () => {
    vi.stubEnv("CHAINLESSCHAIN_GRAPH_SCHEDULER", "invalid-environment-mode");
    const f = fixture();
    const runtime = new SchedulerRuntime({
      ...f.options,
      graphAuthorityMode: "legacy",
    });
    expect(runtime.graphAuthority).toBeNull();
    await expect(runtime.runOccurrence(f.occurrence.id)).resolves.toMatchObject(
      {
        status: "succeeded",
        result: { checked: true },
      },
    );
    expect(f.execute).toHaveBeenCalledOnce();
    expect(() => new CliSchedulerRuntime(f.options)).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_AUTHORITY_MODE_INVALID" }),
    );
  });

  it("does not execute when the injected Graph admission throws", async () => {
    const f = fixture();
    const graphAuthority = {
      mode: "canonical",
      begin: vi.fn(() => {
        throw new Error("authority unavailable");
      }),
      settleSuccess: vi.fn(),
      settleFailure: vi.fn(),
    };
    const runtime = new SchedulerRuntime({ ...f.options, graphAuthority });
    await expect(runtime.runOccurrence(f.occurrence.id)).resolves.toMatchObject(
      {
        status: "retry_wait",
        error: { message: "authority unavailable" },
      },
    );
    expect(f.execute).not.toHaveBeenCalled();
    expect(graphAuthority.settleSuccess).not.toHaveBeenCalled();
  });

  it("preserves canonical reconciliation and prevents replay of unknown effects", async () => {
    const f = fixture();
    const graphAuthority = {
      mode: "canonical",
      begin: () => ({ authorityMode: "canonical", alreadySettled: false }),
      settleSuccess: () => {
        throw new Error("receipt unavailable after effect");
      },
      settleFailure: () => ({
        status: "reconciliation_required",
        id: "graph-run-1",
      }),
    };
    const runtime = new SchedulerRuntime({ ...f.options, graphAuthority });
    await expect(runtime.runOccurrence(f.occurrence.id)).resolves.toMatchObject(
      {
        status: "dead_letter",
        error: { code: "CC_GRAPH_RECONCILIATION_REQUIRED" },
      },
    );
    await expect(runtime.runOccurrence(f.occurrence.id)).resolves.toMatchObject(
      {
        status: "dead_letter",
        alreadySettled: true,
      },
    );
    expect(f.execute).toHaveBeenCalledOnce();
  });

  it("keeps CLI default Graph composition on the shared engine and error class", () => {
    vi.stubEnv("CHAINLESSCHAIN_GRAPH_SCHEDULER", "legacy");
    const f = fixture();
    const runtime = createCliSchedulerRuntime(f.options);
    expect(runtime).toBeInstanceOf(CliSchedulerRuntime);
    expect(runtime).toBeInstanceOf(SchedulerRuntime);
    expect(runtime.graphAuthority).toBeInstanceOf(
      SchedulerOccurrenceGraphAuthority,
    );
    expect(runtime.graphAuthority.mode).toBe("legacy");
    expect(CliSchedulerRuntime.prototype.runOccurrence).toBe(
      SchedulerRuntime.prototype.runOccurrence,
    );
    try {
      runtime.registerAdapter({ kind: "broken" });
      expect.fail("invalid adapter was accepted");
    } catch (error) {
      expect(error).toBeInstanceOf(SchedulerKernelError);
    }
  });

  it("loads the CJS and ESM public runtime from an isolated dependency closure", () => {
    const base = resolve(tmpdir());
    const temporary = mkdtempSync(join(base, "cc-runtime-boundary-"));
    expect(dirname(resolve(temporary))).toBe(base);
    try {
      const packageDirectory = join(
        temporary,
        "node_modules/@chainlesschain/session-core",
      );
      mkdirSync(join(packageDirectory, "lib"), { recursive: true });
      const source = dirname(
        require.resolve("@chainlesschain/session-core/scheduler-runtime"),
      );
      for (const name of ["scheduler-runtime.js", "scheduler-contract.js"]) {
        copyFileSync(join(source, name), join(packageDirectory, "lib", name));
      }
      copyFileSync(
        join(source, "../package.json"),
        join(packageDirectory, "package.json"),
      );
      copyFileSync(
        resolve(
          import.meta.dirname,
          "../../src/lib/scheduler-kernel/contract.js",
        ),
        join(temporary, "cli-contract.mjs"),
      );
      const probe = `
const assert = require("node:assert/strict");
const api = require("@chainlesschain/session-core/scheduler-runtime");
const contract = require("@chainlesschain/session-core/scheduler-contract");
(async () => {
  const esm = await import("@chainlesschain/session-core/scheduler-runtime");
  const cliContract = await import("./cli-contract.mjs");
  assert.equal(esm.default.SchedulerRuntime, api.SchedulerRuntime);
  assert.equal(cliContract.SchedulerKernelError, contract.SchedulerKernelError);
  const store = Object.fromEntries(["claimNext", "claimOccurrence", "getJob", "getOccurrence", "renew", "settle"].map(key => [key, () => null]));
  assert.throws(() => new api.SchedulerRuntime({ store, authorize: () => ({allowed:true}) }),
    error => error instanceof contract.SchedulerKernelError && error.code === "SCHEDULER_RUNTIME_GRAPH_AUTHORITY_REQUIRED");
  const runtime = new api.SchedulerRuntime({ store, authorize: () => ({allowed:false}), graphAuthorityMode: "legacy" });
  assert.equal(runtime.graphAuthority, null);
  assert.deepEqual(await runtime.runNext(), {status:"idle"});
  assert.equal(Object.keys(require.cache).length, 2);
})().catch(error => { console.error(error); process.exitCode = 1; });
`;
      const executed = spawnSync(
        process.execPath,
        ["--input-type=commonjs", "-e", probe],
        {
          cwd: temporary,
          encoding: "utf8",
          windowsHide: true,
          timeout: 30_000,
          env: {
            ...process.env,
            CHAINLESSCHAIN_GRAPH_SCHEDULER: "invalid-environment-mode",
          },
        },
      );
      expect(executed.status, executed.error?.message || executed.stderr).toBe(
        0,
      );
    } finally {
      if (dirname(resolve(temporary)) === base)
        rmSync(temporary, { recursive: true, force: true });
    }
  });
});
