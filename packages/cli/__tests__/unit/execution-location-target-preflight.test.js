import fs from "node:fs";
import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  projectExecutionLocationTargetPreflight,
  projectExecutionLocationTargetSigtermProbe,
} from "../../src/lib/execution-location-target-preflight.js";

const roots = [];
const HOOK_DIGEST = `sha256:${"a".repeat(64)}`;

function fixture(overrides = {}) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-location-target-preflight-"),
  );
  roots.push(root);
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace);
  const limitsPath = path.join(root, "limits");
  fs.writeFileSync(
    limitsPath,
    [
      "Limit                     Soft Limit           Hard Limit           Units",
      "Max cpu time              120                  120                  seconds   ",
      "Max address space         2147483648           2147483648           bytes     ",
      "",
    ].join("\n"),
    "utf8",
  );
  return {
    root,
    workspace,
    limitsPath,
    environment: {
      CC_EXECUTION_LOCATION_BASE_DIR: workspace,
      CC_EXECUTION_LOCATION_CPU_SECONDS: "120",
      CC_EXECUTION_LOCATION_GENERATION: "3",
      CC_EXECUTION_LOCATION_LEASE_GENERATION: "1",
      CC_EXECUTION_LOCATION_LEASE_ID: "lease-1",
      CC_EXECUTION_LOCATION_LEASE_EXPIRES_AT: "2026-08-21T00:10:00.000Z",
      CC_EXECUTION_LOCATION_MEMORY_BYTES: "2147483648",
      CC_EXECUTION_LOCATION_POST_SESSION_HOOK_DIGEST: HOOK_DIGEST,
      CC_EXECUTION_LOCATION_POST_SESSION_HOOK_GENERATION: "1",
      CC_EXECUTION_LOCATION_PROXY_AUTHORITY_ID: "proxy-1",
      CC_EXECUTION_LOCATION_PROXY_EXPIRES_AT: "2026-08-21T00:10:00.000Z",
      CC_EXECUTION_LOCATION_PROXY_ISSUED_AT: "2026-08-21T00:00:00.000Z",
      CC_EXECUTION_LOCATION_PROXY_REVISION: "2",
      CC_EXECUTION_LOCATION_RESOURCE_ENFORCEMENT: "posix-rlimit",
      CC_EXECUTION_LOCATION_RUNNER_ID: "runner-1",
      CC_EXECUTION_LOCATION_STATE: "draining",
      ...overrides,
    },
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("execution location target preflight", () => {
  it("proves the target workspace and process limits without exposing paths", () => {
    const input = fixture();
    const receipt = projectExecutionLocationTargetPreflight(
      {},
      {
        environment: input.environment,
        limitsPath: input.limitsPath,
        cwd: () => input.workspace,
        randomId: () => "probe-1",
        now: () => Date.parse("2026-08-21T00:01:00.000Z"),
      },
    );
    expect(receipt).toMatchObject({
      schema: "cc-execution-location-target-preflight/v1",
      runnerId: "runner-1",
      state: "draining",
      generation: 3,
      lease: {
        id: "lease-1",
        generation: 1,
        expiresAt: "2026-08-21T00:10:00.000Z",
      },
      proxyAuthority: {
        id: "proxy-1",
        revision: 2,
        issuedAt: "2026-08-21T00:00:00.000Z",
        expiresAt: "2026-08-21T00:10:00.000Z",
      },
      baseDir: { writable: true },
      resources: {
        cpuSeconds: 120,
        memoryBytes: 2 * 1024 * 1024 * 1024,
        observedCpuSeconds: 120,
        observedMemoryBytes: 2 * 1024 * 1024 * 1024,
        targetEnforced: true,
        enforcement: "posix-rlimit",
      },
      postSessionHook: { digest: HOOK_DIGEST, generation: 1 },
      secretTransferCount: 0,
    });
    expect(receipt.baseDir.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(receipt.receiptDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(JSON.stringify(receipt)).not.toContain(input.workspace);
    expect(fs.readdirSync(input.workspace)).toEqual([]);
  });

  it("rejects target directory drift and missing target-side quotas", () => {
    const drift = fixture();
    expect(() =>
      projectExecutionLocationTargetPreflight(
        {},
        {
          environment: drift.environment,
          limitsPath: drift.limitsPath,
          cwd: () => drift.root,
          now: () => Date.parse("2026-08-21T00:01:00.000Z"),
        },
      ),
    ).toThrow(/base directory drifted/u);

    const unlimited = fixture();
    fs.writeFileSync(
      unlimited.limitsPath,
      [
        "Limit                     Soft Limit           Hard Limit           Units",
        "Max cpu time              unlimited            unlimited            seconds",
        "Max address space         unlimited            unlimited            bytes",
        "",
      ].join("\n"),
      "utf8",
    );
    expect(() =>
      projectExecutionLocationTargetPreflight(
        {},
        {
          environment: unlimited.environment,
          limitsPath: unlimited.limitsPath,
          cwd: () => unlimited.workspace,
          now: () => Date.parse("2026-08-21T00:01:00.000Z"),
        },
      ),
    ).toThrow(/resource limits are not enforced/u);
  });

  it("never removes a pre-existing path when the writable probe collides", () => {
    const input = fixture();
    const collision = path.join(
      input.workspace,
      ".cc-location-preflight-collision",
    );
    fs.writeFileSync(collision, "owned-by-another-process\n", "utf8");
    expect(() =>
      projectExecutionLocationTargetPreflight(
        {},
        {
          environment: input.environment,
          limitsPath: input.limitsPath,
          cwd: () => input.workspace,
          randomId: () => "collision",
          now: () => Date.parse("2026-08-21T00:01:00.000Z"),
        },
      ),
    ).toThrow();
    expect(fs.readFileSync(collision, "utf8")).toBe(
      "owned-by-another-process\n",
    );
  });

  it("accepts only explicitly supervised Local limits and binds their observed ceiling", () => {
    const input = fixture({
      CC_EXECUTION_LOCATION_RESOURCE_ENFORCEMENT: "target-supervisor",
      CC_EXECUTION_LOCATION_OBSERVED_CPU_SECONDS: "60",
      CC_EXECUTION_LOCATION_OBSERVED_MEMORY_BYTES: "268435456",
    });
    const receipt = projectExecutionLocationTargetPreflight(
      {},
      {
        environment: input.environment,
        cwd: () => input.workspace,
        randomId: () => "probe-supervised",
        now: () => Date.parse("2026-08-21T00:01:00.000Z"),
      },
    );
    expect(receipt.resources).toMatchObject({
      enforcement: "target-supervisor",
      cpuSeconds: 120,
      observedCpuSeconds: 60,
      memoryBytes: 2 * 1024 * 1024 * 1024,
      observedMemoryBytes: 256 * 1024 * 1024,
      targetEnforced: true,
    });
  });

  it("binds a POSIX CPU rlimit combined with the target memory supervisor", () => {
    const input = fixture({
      CC_EXECUTION_LOCATION_RESOURCE_ENFORCEMENT:
        "posix-rlimit+target-supervisor",
      CC_EXECUTION_LOCATION_OBSERVED_CPU_SECONDS: "120",
      CC_EXECUTION_LOCATION_OBSERVED_MEMORY_BYTES: "268435456",
    });
    const receipt = projectExecutionLocationTargetPreflight(
      {},
      {
        environment: input.environment,
        cwd: () => input.workspace,
        randomId: () => "probe-hybrid",
        now: () => Date.parse("2026-08-21T00:01:00.000Z"),
      },
    );
    expect(receipt.resources).toMatchObject({
      enforcement: "posix-rlimit+target-supervisor",
      observedCpuSeconds: 120,
      observedMemoryBytes: 256 * 1024 * 1024,
      targetEnforced: true,
    });
  });

  it("rejects expired lease and proxy timestamps on the target", () => {
    const input = fixture();
    expect(() =>
      projectExecutionLocationTargetPreflight(
        {},
        {
          environment: input.environment,
          limitsPath: input.limitsPath,
          cwd: () => input.workspace,
          now: () => Date.parse("2026-08-21T00:10:00.000Z"),
        },
      ),
    ).toThrow(/lease or proxy authority is stale/u);
  });

  it("rejects a lease generation ahead of runner authority", () => {
    const input = fixture({
      CC_EXECUTION_LOCATION_GENERATION: "2",
      CC_EXECUTION_LOCATION_LEASE_GENERATION: "3",
    });
    expect(() =>
      projectExecutionLocationTargetPreflight(
        {},
        {
          environment: input.environment,
          limitsPath: input.limitsPath,
          cwd: () => input.workspace,
          now: () => Date.parse("2026-08-21T00:01:00.000Z"),
        },
      ),
    ).toThrow(/lease generation is stale/u);
  });

  it("handles an actual SIGTERM event before projecting a bounded drain", async () => {
    const input = fixture({ CC_EXECUTION_LOCATION_STATE: "accepting" });
    const processRef = new EventEmitter();
    processRef.pid = 42;
    processRef.kill = (pid, signal) => {
      expect(pid).toBe(42);
      queueMicrotask(() => processRef.emit(signal));
      return true;
    };
    const receipt = await projectExecutionLocationTargetSigtermProbe(
      {},
      {
        environment: input.environment,
        limitsPath: input.limitsPath,
        cwd: () => input.workspace,
        randomId: () => "probe-sigterm",
        process: processRef,
        now: () => Date.parse("2026-08-21T00:01:00.000Z"),
      },
    );
    expect(receipt).toMatchObject({
      schema: "cc-execution-location-target-sigterm-drain/v1",
      signal: "SIGTERM",
      before: { state: "accepting", generation: 3, accepting: true },
      after: { state: "draining", generation: 4, accepting: false },
      lease: { id: "lease-1", generation: 1, continued: true },
      signalDeliveryCount: 1,
      postSignalLeaseAcceptanceCount: 0,
      secretTransferCount: 0,
    });
    expect(receipt.receiptDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(processRef.listenerCount("SIGTERM")).toBe(0);
  });
});
