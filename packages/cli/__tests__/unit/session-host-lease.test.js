import { afterEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fork } from "node:child_process";
import {
  SESSION_HOST_LEASE_FENCED_CODE,
  SESSION_HOST_LEASE_HELD_CODE,
  SESSION_HOST_LEASE_UNAVAILABLE_CODE,
  SessionHostLeaseAuthority,
  createSessionHostWriteDelegation,
} from "../../src/lib/session-host-lease.js";

const roots = [];

function testRoot() {
  const root = join(
    tmpdir(),
    `cc-session-host-lease-${process.pid}-${Date.now()}-${roots.length}`,
  );
  mkdirSync(root, { recursive: true });
  roots.push(root);
  return root;
}

function timers() {
  return {
    setIntervalFn: () => ({ unref() {} }),
    clearIntervalFn() {},
  };
}

function waitForChildMessage(child, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("session host lease child did not become ready"));
    }, timeoutMs);
    const onMessage = (message) => {
      cleanup();
      resolve(message);
    };
    const onExit = (code, signal) => {
      cleanup();
      reject(
        new Error(
          `session host lease child exited early (${code ?? signal ?? "unknown"})`,
        ),
      );
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.off("message", onMessage);
      child.off("exit", onExit);
    };
    child.once("message", onMessage);
    child.once("exit", onExit);
  });
}

function waitForChildExit(child, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("session host lease child did not exit"));
    }, timeoutMs);
    const onExit = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.off("exit", onExit);
    };
    child.once("exit", onExit);
  });
}

function spawnLeaseChild(stateRoot, sessionId, mode = "host", requestId) {
  return fork(
    new URL("../fixtures/session-host-lease-child.mjs", import.meta.url),
    [stateRoot, sessionId, mode, ...(requestId ? [requestId] : [])],
    { stdio: ["ignore", "ignore", "ignore", "ipc"] },
  );
}

async function requestChild(child, message) {
  const response = waitForChildMessage(child);
  child.send(message);
  return response;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  }
});

describe("SessionHostLeaseAuthority", () => {
  it("permits only an exact child-bound delegated writer", () => {
    const stateRoot = testRoot();
    const owner = new SessionHostLeaseAuthority({ stateRoot, ...timers() });
    const worker = new SessionHostLeaseAuthority({ stateRoot, ...timers() });
    const lease = owner.acquire("delegated-session", {
      hostKind: "headless",
    });
    const delegation = createSessionHostWriteDelegation(lease);
    const missingDelegationWrite = vi.fn();

    expect(() =>
      worker.withDelegatedWriteAuthority(
        "delegated-session",
        null,
        missingDelegationWrite,
        { expectedOwnerPid: process.pid },
      ),
    ).toThrow(/delegation/i);
    expect(missingDelegationWrite).not.toHaveBeenCalled();

    expect(() =>
      worker.withWriteAuthority("delegated-session", () => true),
    ).toThrowError(
      expect.objectContaining({ code: SESSION_HOST_LEASE_FENCED_CODE }),
    );
    expect(
      worker.withDelegatedWriteAuthority(
        "delegated-session",
        delegation,
        () =>
          worker.withWriteAuthority(
            "delegated-session",
            (authority) => authority,
          ),
        { expectedOwnerPid: process.pid },
      ),
    ).toMatchObject({
      leaseId: lease.leaseId,
      fencingToken: lease.fencingToken,
      ownerPid: process.pid,
      hostKind: "headless",
      delegated: true,
    });
    expect(() =>
      worker.withDelegatedWriteAuthority(
        "delegated-session",
        delegation,
        () => true,
        { expectedOwnerPid: process.pid + 1 },
      ),
    ).toThrowError(
      expect.objectContaining({ code: SESSION_HOST_LEASE_FENCED_CODE }),
    );
    expect(() =>
      worker.withDelegatedWriteAuthority(
        "delegated-session",
        { ...delegation, fencingToken: delegation.fencingToken + 1 },
        () => worker.withWriteAuthority("delegated-session", () => true),
        { expectedOwnerPid: process.pid },
      ),
    ).toThrowError(
      expect.objectContaining({ code: SESSION_HOST_LEASE_FENCED_CODE }),
    );

    expect(lease.release()).toBe(true);
    const successor = owner.acquire("delegated-session", {
      hostKind: "background-recovery",
    });
    const successorDelegation = createSessionHostWriteDelegation(successor);

    // A stale/forged delegated scope cannot borrow the local successor lease
    // merely because both happen to live in the same authority instance.
    for (const staleDelegation of [
      delegation,
      {
        ...successorDelegation,
        fencingToken: successorDelegation.fencingToken + 1,
      },
      { ...successorDelegation, ownerPid: process.pid + 1 },
    ]) {
      expect(() =>
        owner.withDelegatedWriteAuthority(
          "delegated-session",
          staleDelegation,
          () => owner.withWriteAuthority("delegated-session", () => true),
          { expectedOwnerPid: staleDelegation.ownerPid },
        ),
      ).toThrowError(
        expect.objectContaining({ code: SESSION_HOST_LEASE_FENCED_CODE }),
      );
    }
    expect(successor.assert()).toMatchObject({
      leaseId: successor.leaseId,
      fencingToken: successor.fencingToken,
    });

    expect(() =>
      worker.withDelegatedWriteAuthority(
        "delegated-session",
        delegation,
        () => worker.withWriteAuthority("delegated-session", () => true),
        { expectedOwnerPid: process.pid },
      ),
    ).toThrowError(
      expect.objectContaining({ code: SESSION_HOST_LEASE_FENCED_CODE }),
    );
    expect(successor.release()).toBe(true);
  });

  it("blocks a real second process and advances fencing after a hard exit", async () => {
    const stateRoot = testRoot();
    const sessionId = "session-real-process";
    const child = spawnLeaseChild(stateRoot, sessionId);
    try {
      await expect(waitForChildMessage(child)).resolves.toMatchObject({
        type: "ready",
      });
      const successor = new SessionHostLeaseAuthority({
        stateRoot,
        ...timers(),
      });
      expect(() =>
        successor.acquire(sessionId, { hostKind: "headless" }),
      ).toThrowError(
        expect.objectContaining({ code: SESSION_HOST_LEASE_HELD_CODE }),
      );

      child.kill();
      await waitForChildExit(child);
      const recovered = successor.acquire(sessionId, {
        hostKind: "recovery",
      });
      expect(recovered.fencingToken).toBe(2);
      recovered.release();
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
        await waitForChildExit(child).catch(() => {});
      }
    }
  }, 20_000);

  it("CAS-revokes a real host once, fences its next side effect, and never replays onto a restarted successor", async () => {
    const stateRoot = testRoot();
    const sessionId = "session-real-revocation";
    const oldHost = spawnLeaseChild(stateRoot, sessionId);
    const children = [oldHost];
    try {
      const oldReady = await waitForChildMessage(oldHost);
      expect(oldReady).toMatchObject({
        type: "ready",
        fencingToken: 1,
        revocationEpoch: 0,
      });

      const requestId = "cross-process-revoke-1";
      const revokerA = spawnLeaseChild(
        stateRoot,
        sessionId,
        "revoke",
        requestId,
      );
      const revokerB = spawnLeaseChild(
        stateRoot,
        sessionId,
        "revoke",
        requestId,
      );
      children.push(revokerA, revokerB);
      const revocations = await Promise.all([
        waitForChildMessage(revokerA),
        waitForChildMessage(revokerB),
      ]);
      expect(revocations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "revoked",
            requestId,
            revocationEpoch: 1,
            replayed: false,
            targetLeaseId: oldReady.leaseId,
          }),
          expect.objectContaining({
            type: "revoked",
            requestId,
            revocationEpoch: 1,
            replayed: true,
            targetLeaseId: oldReady.leaseId,
          }),
        ]),
      );

      const sideEffectPath = join(stateRoot, "revoked-side-effect.txt");
      await expect(
        requestChild(oldHost, {
          type: "side-effect",
          path: sideEffectPath,
        }),
      ).resolves.toMatchObject({
        type: "side-effect-error",
        code: SESSION_HOST_LEASE_FENCED_CODE,
      });
      expect(existsSync(sideEffectPath)).toBe(false);
      oldHost.kill();
      await waitForChildExit(oldHost);

      const restarted = spawnLeaseChild(stateRoot, sessionId);
      children.push(restarted);
      const restartedReady = await waitForChildMessage(restarted);
      expect(restartedReady).toMatchObject({
        type: "ready",
        fencingToken: 2,
        revocationEpoch: 1,
      });

      const replayAuthority = new SessionHostLeaseAuthority({
        stateRoot,
        ...timers(),
      });
      expect(
        replayAuthority.revoke(sessionId, {
          requestId,
          reasonCode: "fixture",
        }),
      ).toMatchObject({
        requestId,
        revocationEpoch: 1,
        replayed: true,
        targetLeaseId: oldReady.leaseId,
      });
      await expect(
        requestChild(restarted, { type: "assert" }),
      ).resolves.toMatchObject({
        type: "asserted",
        authority: {
          fencingToken: 2,
          revocationEpoch: 1,
        },
      });

      restarted.kill();
      await waitForChildExit(restarted);
      const afterHardKill = replayAuthority.acquire(sessionId, {
        hostKind: "recovery",
      });
      expect(afterHardKill).toMatchObject({
        fencingToken: 3,
        revocationEpoch: 1,
      });
      afterHardKill.release();
    } finally {
      for (const child of children) {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill();
          await waitForChildExit(child).catch(() => {});
        }
      }
    }
  }, 30_000);

  it("admits one live host and fences another process view", () => {
    const stateRoot = testRoot();
    const first = new SessionHostLeaseAuthority({ stateRoot, ...timers() });
    const second = new SessionHostLeaseAuthority({ stateRoot, ...timers() });
    const lease = first.acquire("session-a", { hostKind: "headless" });

    expect(lease.fencingToken).toBe(1);
    expect(
      first.withWriteAuthority("session-a", (value) => value),
    ).toMatchObject({
      leaseId: lease.leaseId,
      fencingToken: 1,
      hostKind: "headless",
    });
    expect(() => second.acquire("session-a", { hostKind: "ws" })).toThrowError(
      expect.objectContaining({ code: SESSION_HOST_LEASE_HELD_CODE }),
    );
    expect(() =>
      second.withWriteAuthority("session-a", () => true),
    ).toThrowError(
      expect.objectContaining({ code: SESSION_HOST_LEASE_FENCED_CODE }),
    );
    expect(lease.signal.aborted).toBe(false);

    expect(lease.release()).toBe(true);
    expect(second.withWriteAuthority("session-a", (value) => value)).toBeNull();
  });

  it("increments the fencing token and aborts an expired predecessor", () => {
    const stateRoot = testRoot();
    let now = 1_000;
    const first = new SessionHostLeaseAuthority({
      stateRoot,
      now: () => now,
      ...timers(),
    });
    const second = new SessionHostLeaseAuthority({
      stateRoot,
      now: () => now,
      isProcessAlive: () => false,
      ...timers(),
    });
    const stale = first.acquire("session-b", {
      hostKind: "stream",
      ttlMs: 1_000,
      heartbeatMs: 999,
    });
    now = 2_001;
    const successor = second.acquire("session-b", {
      hostKind: "repl",
      ttlMs: 1_000,
      heartbeatMs: 999,
    });

    expect(successor.fencingToken).toBe(2);
    expect(() => stale.assert()).toThrowError(
      expect.objectContaining({ code: SESSION_HOST_LEASE_FENCED_CODE }),
    );
    expect(stale.signal.aborted).toBe(true);
    expect(stale.signal.reason).toMatchObject({
      code: SESSION_HOST_LEASE_FENCED_CODE,
    });
    expect(successor.release()).toBe(true);
  });

  it("never steals an expired lease from an OS-live process", () => {
    const stateRoot = testRoot();
    let now = 1_000;
    const first = new SessionHostLeaseAuthority({
      stateRoot,
      now: () => now,
      ...timers(),
    });
    first.acquire("session-live", {
      hostKind: "headless",
      ttlMs: 1_000,
      heartbeatMs: 999,
    });
    now = 10_000;
    const second = new SessionHostLeaseAuthority({
      stateRoot,
      now: () => now,
      isProcessAlive: () => true,
      ...timers(),
    });

    expect(() =>
      second.acquire("session-live", { hostKind: "repl" }),
    ).toThrowError(
      expect.objectContaining({ code: SESSION_HOST_LEASE_HELD_CODE }),
    );
  });

  it("reclaims an unexpired lease only after its owner is proven dead", () => {
    const stateRoot = testRoot();
    const first = new SessionHostLeaseAuthority({ stateRoot, ...timers() });
    const stale = first.acquire("session-c", { hostKind: "ws" });
    const recovery = new SessionHostLeaseAuthority({
      stateRoot,
      isProcessAlive: () => false,
      ...timers(),
    });

    const next = recovery.acquire("session-c", { hostKind: "recovery" });
    expect(next.fencingToken).toBe(stale.fencingToken + 1);
    expect(() => stale.assert()).toThrowError(
      expect.objectContaining({ code: SESSION_HOST_LEASE_FENCED_CODE }),
    );
    next.release();
  });

  it("renews without changing fencing authority", () => {
    const stateRoot = testRoot();
    let now = 10_000;
    const authority = new SessionHostLeaseAuthority({
      stateRoot,
      now: () => now,
      ...timers(),
    });
    const lease = authority.acquire("session-d", {
      hostKind: "headless",
      ttlMs: 2_000,
      heartbeatMs: 500,
    });
    now = 11_000;

    expect(lease.renew()).toMatchObject({
      leaseId: lease.leaseId,
      fencingToken: lease.fencingToken,
      renewedAtMs: 11_000,
      expiresAtMs: 13_000,
    });
    expect(lease.assert()).toMatchObject({
      fencingToken: lease.fencingToken,
    });
    lease.release();
  });

  it("renews an exact local lease after an event-loop stall", () => {
    const stateRoot = testRoot();
    let now = 20_000;
    const authority = new SessionHostLeaseAuthority({
      stateRoot,
      now: () => now,
      ...timers(),
    });
    const lease = authority.acquire("session-stalled-local", {
      hostKind: "headless-stream",
      ttlMs: 1_000,
      heartbeatMs: 500,
    });

    // A synchronous external command can delay the JS timer beyond the TTL.
    // The durable tuple is still ours: no revocation or successor was written.
    now = 25_000;
    expect(lease.assert()).toMatchObject({
      leaseId: lease.leaseId,
      fencingToken: lease.fencingToken,
    });
    expect(lease.renew()).toMatchObject({
      leaseId: lease.leaseId,
      fencingToken: lease.fencingToken,
      renewedAtMs: 25_000,
      expiresAtMs: 26_000,
    });
    expect(lease.signal.aborted).toBe(false);
    lease.release();
  });

  it("migrates an inactive v1 lease store without resetting fencing authority", () => {
    const stateRoot = testRoot();
    const authority = new SessionHostLeaseAuthority({
      stateRoot,
      ...timers(),
    });
    const sessionId = "session-v1-migration";
    const filePath = authority.pathFor(sessionId);
    writeFileSync(
      filePath,
      `${JSON.stringify({
        version: 1,
        sessionId,
        lastFencingToken: 9,
        active: null,
      })}\n`,
      "utf8",
    );

    const lease = authority.acquire(sessionId, { hostKind: "recovery" });
    expect(lease).toMatchObject({
      fencingToken: 10,
      revocationEpoch: 0,
    });
    expect(JSON.parse(readFileSync(filePath, "utf8"))).toMatchObject({
      version: 2,
      lastFencingToken: 10,
      revocationEpoch: 0,
      revocations: [],
    });
    lease.release();
  });

  it("fails closed on corrupt durable authority", () => {
    const stateRoot = testRoot();
    const authority = new SessionHostLeaseAuthority({ stateRoot, ...timers() });
    const filePath = authority.pathFor("session-e");
    writeFileSync(filePath, "{broken", "utf8");

    expect(() => authority.acquire("session-e")).toThrowError(
      expect.objectContaining({ code: SESSION_HOST_LEASE_UNAVAILABLE_CODE }),
    );
    expect(() =>
      authority.withWriteAuthority("session-e", () => true),
    ).toThrowError(
      expect.objectContaining({ code: SESSION_HOST_LEASE_UNAVAILABLE_CODE }),
    );
  });

  it("reconciles an exact revocation after the durable commit response is lost", () => {
    const stateRoot = testRoot();
    let failAfterCommit = false;
    const authority = new SessionHostLeaseAuthority({
      stateRoot,
      ...timers(),
      lock: (_filePath, task) => {
        const result = task({ locked: true });
        if (failAfterCommit) {
          failAfterCommit = false;
          throw Object.assign(new Error("injected lock release failure"), {
            code: "EIO",
          });
        }
        return result;
      },
    });
    const lease = authority.acquire("session-revoke-unknown", {
      hostKind: "headless",
    });
    failAfterCommit = true;

    expect(
      authority.revoke("session-revoke-unknown", {
        requestId: "unknown-commit-revoke",
        reasonCode: "operator",
      }),
    ).toMatchObject({
      requestId: "unknown-commit-revoke",
      revocationEpoch: 1,
      replayed: true,
    });
    expect(lease.signal.aborted).toBe(true);
    expect(() => lease.assert()).toThrowError(
      expect.objectContaining({ code: SESSION_HOST_LEASE_FENCED_CODE }),
    );

    const recovered = new SessionHostLeaseAuthority({
      stateRoot,
      ...timers(),
    });
    expect(recovered.readAuthority("session-revoke-unknown")).toMatchObject({
      revocationEpoch: 1,
      revocationCount: 1,
      active: null,
    });
    expect(
      recovered.acquire("session-revoke-unknown", { hostKind: "recovery" }),
    ).toMatchObject({ fencingToken: 2, revocationEpoch: 1 });
  });

  it("fences a real MCP dispatch paused after an earlier assert when revoke wins before send", async () => {
    const stateRoot = testRoot();
    const sessionId = "session-dispatch-admission-race";
    const sideEffectPath = join(stateRoot, "dispatch-canary.txt");
    const host = spawnLeaseChild(stateRoot, sessionId);
    try {
      await expect(waitForChildMessage(host)).resolves.toMatchObject({
        type: "ready",
      });
      await expect(
        requestChild(host, { type: "precheck" }),
      ).resolves.toMatchObject({ type: "prechecked" });

      const revoker = new SessionHostLeaseAuthority({
        stateRoot,
        ...timers(),
      });
      expect(
        revoker.revoke(sessionId, {
          requestId: "dispatch-race-revoke",
          reasonCode: "operator",
        }),
      ).toMatchObject({ revocationEpoch: 1 });

      await expect(
        requestChild(host, {
          type: "admitted-side-effect",
          path: sideEffectPath,
        }),
      ).resolves.toMatchObject({
        type: "admitted-side-effect-error",
        code: SESSION_HOST_LEASE_FENCED_CODE,
      });
      expect(existsSync(sideEffectPath)).toBe(false);
    } finally {
      if (host.exitCode === null && host.signalCode === null) {
        host.kill();
        await waitForChildExit(host).catch(() => {});
      }
    }
  }, 20_000);

  it("linearizes dispatch-before-revoke and releases authority before awaiting the response", async () => {
    const stateRoot = testRoot();
    const sessionId = "session-dispatch-response-unlocked";
    const host = new SessionHostLeaseAuthority({ stateRoot, ...timers() });
    const revoker = new SessionHostLeaseAuthority({ stateRoot, ...timers() });
    const lease = host.acquire(sessionId, { hostKind: "headless" });
    let resolveResponse;
    const response = new Promise((resolve) => {
      resolveResponse = resolve;
    });

    const pending = lease.admitMcpDispatch(
      { method: "tools/call", transport: "http" },
      () => response,
    );
    expect(
      revoker.revoke(sessionId, {
        requestId: "response-unlocked-revoke",
        reasonCode: "operator",
      }),
    ).toMatchObject({ revocationEpoch: 1 });
    resolveResponse("completed-after-revoke");
    await expect(pending).resolves.toBe("completed-after-revoke");
    expect(() => lease.assert()).toThrowError(
      expect.objectContaining({ code: SESSION_HOST_LEASE_FENCED_CODE }),
    );
    expect(lease.signal.aborted).toBe(true);
  });
});
