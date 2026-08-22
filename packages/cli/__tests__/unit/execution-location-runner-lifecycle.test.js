import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ExecutionLocationRunnerLifecycle,
  assertExecutionLocationRunnerLeaseAuthority,
  lifecycleProfileFromLease,
} from "../../src/lib/execution-location-runner-lifecycle.js";

const roots = [];
const HOOK_DIGEST = `sha256:${"a".repeat(64)}`;
const RESULT_DIGEST = `sha256:${"b".repeat(64)}`;
const FAILURE_DIGEST = `sha256:${"c".repeat(64)}`;

function authority(nowMs, revision) {
  return {
    id: "proxy-authority-1",
    revision,
    issuedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + 60_000).toISOString(),
  };
}

function fixture(target = "container") {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-location-runner-lifecycle-"),
  );
  roots.push(root);
  const baseDir = path.join(root, "workspace");
  fs.mkdirSync(baseDir);
  let nowMs = Date.parse("2026-08-21T00:00:00.000Z");
  let identifier = 0;
  const lifecycle = new ExecutionLocationRunnerLifecycle({
    filePath: path.join(root, "state", "runner.json"),
    runnerId: `${target}-runner-1`,
    target,
    baseDir,
    resources: {
      cpuSeconds: 120,
      memoryBytes: 2 * 1024 * 1024 * 1024,
    },
    postSessionHookDigest: HOOK_DIGEST,
    now: () => nowMs,
    randomId: () => `id-${++identifier}`,
  });
  return {
    lifecycle,
    get nowMs() {
      return nowMs;
    },
    advance(milliseconds) {
      nowMs += milliseconds;
    },
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("execution location runner lifecycle", () => {
  it("fences a graceful SIGTERM drain, result return, hook, and reclaim", () => {
    const runtime = fixture();
    const initial = runtime.lifecycle.initialize();
    expect(initial).toMatchObject({
      state: "accepting",
      accepting: true,
      generation: 1,
      activeLeaseCount: 0,
    });

    const lease = runtime.lifecycle.acquireLease({
      sessionId: "session-1",
      expectedGeneration: 1,
      proxyAuthority: authority(runtime.nowMs, 1),
    });
    const profile = lifecycleProfileFromLease(lease);
    expect(profile).toMatchObject({
      runnerId: "container-runner-1",
      authorityFile: runtime.lifecycle.filePath,
      state: "accepting",
      generation: 1,
      lease: { generation: 1 },
      proxyAuthority: { revision: 1 },
      baseDir: { writableRequired: true },
      resources: { cpuSeconds: 120, memoryBytes: 2 * 1024 * 1024 * 1024 },
      postSessionHook: { digest: HOOK_DIGEST, generation: 1 },
    });
    expect(
      assertExecutionLocationRunnerLeaseAuthority(profile, "container", {
        now: () => runtime.nowMs,
      }),
    ).toMatchObject({
      state: "accepting",
      generation: 1,
      leaseId: lease.lease.id,
    });
    expect(
      runtime.lifecycle.assertPoll({
        leaseId: lease.lease.id,
        leaseGeneration: 1,
        proxyAuthorityId: "proxy-authority-1",
        proxyAuthorityRevision: 1,
      }),
    ).toMatchObject({ state: "accepting", leaseGeneration: 1 });

    const draining = runtime.lifecycle.requestDrain({
      expectedGeneration: 1,
      signal: "SIGTERM",
      timeoutMs: 30_000,
    });
    expect(draining).toMatchObject({
      state: "draining",
      accepting: false,
      generation: 2,
      activeLeaseCount: 1,
      drain: { signal: "SIGTERM" },
    });
    expect(() =>
      runtime.lifecycle.acquireLease({
        sessionId: "session-denied",
        expectedGeneration: 2,
        proxyAuthority: authority(runtime.nowMs, 1),
      }),
    ).toThrow(/not accepting/u);
    expect(
      runtime.lifecycle.assertPoll({
        leaseId: lease.lease.id,
        leaseGeneration: 1,
        proxyAuthorityId: "proxy-authority-1",
        proxyAuthorityRevision: 1,
      }),
    ).toMatchObject({ state: "draining", runnerGeneration: 2 });

    const parked = runtime.lifecycle.settleLease({
      leaseId: lease.lease.id,
      leaseGeneration: 1,
      resultDigest: RESULT_DIGEST,
    });
    expect(parked).toMatchObject({
      state: "parked",
      generation: 3,
      activeLeaseCount: 0,
      settledLeaseCount: 1,
    });
    const hookReceipt = runtime.lifecycle.authorizePostSessionHook({
      expectedRunnerGeneration: 3,
      leaseId: lease.lease.id,
      leaseGeneration: 1,
      resultDigest: RESULT_DIGEST,
      hookDigest: HOOK_DIGEST,
    });
    expect(hookReceipt.receiptDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(() =>
      runtime.lifecycle.authorizePostSessionHook({
        expectedRunnerGeneration: 3,
        leaseId: lease.lease.id,
        leaseGeneration: 1,
        resultDigest: RESULT_DIGEST,
        hookDigest: HOOK_DIGEST,
      }),
    ).toThrow(/hook fence is stale/u);

    const reclaiming = runtime.lifecycle.beginReclaim({
      expectedGeneration: 3,
      proxyAuthority: authority(runtime.nowMs, 2),
    });
    expect(reclaiming).toMatchObject({
      state: "reclaiming",
      generation: 4,
      proxyAuthority: { revision: 2 },
    });
    expect(() =>
      runtime.lifecycle.assertPoll({
        leaseId: lease.lease.id,
        leaseGeneration: 1,
        proxyAuthorityId: "proxy-authority-1",
        proxyAuthorityRevision: 1,
      }),
    ).toThrow(/stale or parked/u);
    expect(
      runtime.lifecycle.completeReclaim({ expectedGeneration: 4 }),
    ).toMatchObject({ state: "accepting", generation: 5, accepting: true });
  });

  it("invalidates an old poll after proxy rotation without losing result authority", () => {
    const runtime = fixture("ssh");
    runtime.lifecycle.initialize();
    const lease = runtime.lifecycle.acquireLease({
      sessionId: "session-token-rotation",
      expectedGeneration: 1,
      proxyAuthority: authority(runtime.nowMs, 1),
    });
    const initialProfile = lifecycleProfileFromLease(lease);
    const rotatedAuthority = authority(runtime.nowMs, 2);
    const rotated = runtime.lifecycle.rotateProxyAuthority({
      expectedGeneration: 1,
      proxyAuthority: rotatedAuthority,
    });
    expect(rotated).toMatchObject({
      state: "accepting",
      generation: 2,
      policyRevision: 2,
      proxyAuthority: { revision: 2 },
    });
    expect(() =>
      runtime.lifecycle.assertPoll({
        leaseId: lease.lease.id,
        leaseGeneration: 1,
        proxyAuthorityId: "proxy-authority-1",
        proxyAuthorityRevision: 1,
      }),
    ).toThrow(/stale or parked/u);
    expect(() =>
      assertExecutionLocationRunnerLeaseAuthority(initialProfile, "ssh", {
        now: () => runtime.nowMs,
      }),
    ).toThrow(/lease authority is stale/u);
    expect(
      runtime.lifecycle.assertPoll({
        leaseId: lease.lease.id,
        leaseGeneration: 1,
        proxyAuthorityId: "proxy-authority-1",
        proxyAuthorityRevision: 2,
      }),
    ).toMatchObject({ runnerGeneration: 2 });
    const refreshed = runtime.lifecycle.refreshLeaseAuthority({
      leaseId: lease.lease.id,
      leaseGeneration: 1,
      expectedGeneration: 2,
      proxyAuthority: rotatedAuthority,
    });
    expect(refreshed).toMatchObject({
      runnerGeneration: 2,
      proxyAuthority: { revision: 2 },
      lease: { id: lease.lease.id, generation: 1 },
    });
    expect(
      assertExecutionLocationRunnerLeaseAuthority(
        lifecycleProfileFromLease(refreshed),
        "ssh",
        { now: () => runtime.nowMs },
      ),
    ).toMatchObject({ generation: 2, leaseId: lease.lease.id });
    expect(
      runtime.lifecycle.settleLease({
        leaseId: lease.lease.id,
        leaseGeneration: 1,
        resultDigest: RESULT_DIGEST,
      }),
    ).toMatchObject({ state: "accepting", settledLeaseCount: 1 });
  });

  it("parks checkout failure and a lost poll at the bounded drain deadline", () => {
    const checkout = fixture("wsl");
    checkout.lifecycle.initialize();
    const checkoutLease = checkout.lifecycle.acquireLease({
      sessionId: "session-checkout-failure",
      expectedGeneration: 1,
      proxyAuthority: authority(checkout.nowMs, 1),
    });
    expect(
      checkout.lifecycle.parkLease({
        leaseId: checkoutLease.lease.id,
        leaseGeneration: 1,
        resultDigest: FAILURE_DIGEST,
        reason: "checkout-failure",
      }),
    ).toMatchObject({
      state: "parked",
      generation: 2,
      parkedLeaseCount: 1,
      parkReason: "checkout-failure",
    });

    const lostPoll = fixture("local");
    lostPoll.lifecycle.initialize();
    const lostLease = lostPoll.lifecycle.acquireLease({
      sessionId: "session-lost-poll",
      expectedGeneration: 1,
      ttlMs: 1_000,
      proxyAuthority: authority(lostPoll.nowMs, 1),
    });
    lostPoll.advance(1_001);
    expect(() =>
      lostPoll.lifecycle.assertPoll({
        leaseId: lostLease.lease.id,
        leaseGeneration: 1,
        proxyAuthorityId: "proxy-authority-1",
        proxyAuthorityRevision: 1,
      }),
    ).toThrow(/stale or parked/u);
    const draining = lostPoll.lifecycle.requestDrain({
      expectedGeneration: 1,
      timeoutMs: 10,
    });
    lostPoll.advance(10);
    expect(
      lostPoll.lifecycle.parkExpiredDrain({
        expectedGeneration: draining.generation,
      }),
    ).toMatchObject({
      state: "parked",
      generation: 3,
      newlyParkedLeaseCount: 1,
      parkedLeaseCount: 1,
    });
  });

  it("fails closed before leasing a missing or non-directory base path", () => {
    const runtime = fixture();
    runtime.lifecycle.initialize();
    const statePath = runtime.lifecycle.filePath;
    const serialized = fs.readFileSync(statePath, "utf8");
    const baseDirDigest = createHash("sha256")
      .update(runtime.lifecycle.baseDir)
      .digest("hex");
    expect(serialized).not.toContain(baseDirDigest);
    fs.rmSync(runtime.lifecycle.baseDir, { recursive: true, force: true });
    expect(() =>
      runtime.lifecycle.acquireLease({
        sessionId: "session-no-workspace",
        expectedGeneration: 1,
        proxyAuthority: authority(runtime.nowMs, 1),
      }),
    ).toThrow();
    expect(runtime.lifecycle.snapshot()).toMatchObject({
      state: "accepting",
      activeLeaseCount: 0,
    });
  });
});
