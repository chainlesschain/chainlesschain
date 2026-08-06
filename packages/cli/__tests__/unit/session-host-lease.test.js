import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fork } from "node:child_process";
import {
  SESSION_HOST_LEASE_FENCED_CODE,
  SESSION_HOST_LEASE_HELD_CODE,
  SESSION_HOST_LEASE_UNAVAILABLE_CODE,
  SessionHostLeaseAuthority,
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

afterEach(() => {
  for (const root of roots.splice(0)) {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  }
});

describe("SessionHostLeaseAuthority", () => {
  it("blocks a real second process and advances fencing after a hard exit", async () => {
    const stateRoot = testRoot();
    const sessionId = "session-real-process";
    const child = fork(
      new URL("../fixtures/session-host-lease-child.mjs", import.meta.url),
      [stateRoot, sessionId],
      { stdio: ["ignore", "ignore", "ignore", "ipc"] },
    );
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
});
