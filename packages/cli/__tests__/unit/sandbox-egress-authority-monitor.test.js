import { afterEach, describe, expect, it, vi } from "vitest";
import { createDockerEgressAuthorityMonitor } from "../../src/lib/sandbox-egress-authority-monitor.js";

afterEach(() => vi.useRealTimers());

describe("Docker egress live authority monitor", () => {
  it("issues a stop acknowledgement only after both cleanups settle and monitoring stops", async () => {
    let releaseProxy;
    let releaseSession;
    const monitor = createDockerEgressAuthorityMonitor({
      sessionId: "session-one",
      policyVersion: "admitted-revision-one",
      revalidate: async () => {},
      abortProxy: () =>
        new Promise((resolve) => {
          releaseProxy = resolve;
        }),
    });
    monitor.attachSession({
      close: () =>
        new Promise((resolve) => {
          releaseSession = resolve;
        }),
    });
    expect(monitor.getStopAcknowledgement()).toBeNull();
    monitor.revoke(new Error("revoked"));
    monitor.stop();
    expect(monitor.getStopAcknowledgement()).toBeNull();
    releaseProxy();
    await Promise.resolve();
    expect(monitor.getStopAcknowledgement()).toBeNull();
    releaseSession();
    await monitor.awaitCleanup();
    expect(monitor.getStopAcknowledgement()).toEqual({
      schema: "chainlesschain.egress-stop-ack/v1",
      ...monitor.stopIdentity,
      proxyStopped: true,
      sessionStopped: true,
    });
    expect(monitor.stopIdentity).toMatchObject({
      sessionId: "session-one",
      policyVersion: "admitted-revision-one",
    });
    const other = createDockerEgressAuthorityMonitor({
      revalidate() {},
      abortProxy() {},
      sessionId: "session-one",
      policyVersion: "admitted-revision-one",
    });
    expect(other.stopIdentity.receiverId).not.toBe(
      monitor.getStopAcknowledgement().receiverId,
    );
    expect(() => monitor.attachSession({ close() {} })).toThrow(
      "already attached",
    );
  });

  it.each(["proxy", "session"])(
    "never acknowledges a failed %s cleanup",
    async (failed) => {
      const monitor = createDockerEgressAuthorityMonitor({
        revalidate: async () => {},
        abortProxy: async () => {
          if (failed === "proxy") throw new Error("proxy cleanup failed");
        },
      });
      monitor.attachSession({
        close: async () => {
          if (failed === "session") throw new Error("session cleanup failed");
        },
      });
      monitor.revoke(new Error("revoked"));
      monitor.stop();
      await monitor.awaitCleanup();
      expect(monitor.revocationError.cleanupError).toBeInstanceOf(Error);
      expect(monitor.getStopAcknowledgement()).toBeNull();
    },
  );

  it("latches revocation before aborting the proxy and closing the session", async () => {
    const events = [];
    let deny = false;
    const monitor = createDockerEgressAuthorityMonitor({
      revalidate: async () => {
        if (deny)
          throw Object.assign(new Error("permission changed"), {
            code: "REVOKED",
          });
      },
      abortProxy: async () => {
        events.push("abort");
        expect(() => monitor.assertAuthorized()).toThrow("permission changed");
      },
    });
    monitor.attachSession({ close: async () => events.push("close") });
    await monitor.checkNow();
    deny = true;
    await expect(monitor.checkNow()).rejects.toMatchObject({ code: "REVOKED" });
    await monitor.awaitCleanup();
    expect(events).toEqual(["abort", "close"]);
    await expect(monitor.finish()).rejects.toMatchObject({ code: "REVOKED" });
  });

  it("closes a session delivered after revocation", async () => {
    const close = vi.fn(async () => {});
    const monitor = createDockerEgressAuthorityMonitor({
      revalidate: async () => {},
      abortProxy: async () => {},
    });
    monitor.revoke(new Error("revoked before create completed"));
    expect(() => monitor.attachSession({ close })).toThrow("revoked");
    await monitor.awaitCleanup();
    expect(close).toHaveBeenCalledOnce();
  });

  it("bounds a hung authority provider and ignores its stale success", async () => {
    vi.useFakeTimers();
    let resolveProvider;
    const abortProxy = vi.fn(async () => {});
    const monitor = createDockerEgressAuthorityMonitor({
      revalidate: () =>
        new Promise((resolve) => {
          resolveProvider = resolve;
        }),
      abortProxy,
      checkTimeoutMs: 50,
    });
    const check = monitor.checkNow();
    await Promise.resolve();
    vi.advanceTimersByTime(50);
    await Promise.resolve();
    await expect(check).rejects.toMatchObject({
      code: "CC_DOCKER_EGRESS_AUTHORITY_TIMEOUT",
    });
    resolveProvider(true);
    await Promise.resolve();
    await monitor.awaitCleanup();
    expect(abortProxy).toHaveBeenCalledOnce();
    expect(() => monitor.assertAuthorized()).toThrow("timed out");
  });

  it("forces a new final sample after an older in-flight check succeeds", async () => {
    let denied = false;
    let releaseOldCheck;
    let checks = 0;
    const abortProxy = vi.fn(async () => {});
    const monitor = createDockerEgressAuthorityMonitor({
      revalidate: () => {
        checks += 1;
        if (checks === 1)
          return new Promise((resolve) => {
            releaseOldCheck = resolve;
          });
        if (denied) throw new Error("new policy denies shell");
      },
      abortProxy,
    });
    const oldCheck = monitor.checkNow();
    await Promise.resolve();
    denied = true;
    const finalCheck = monitor.finish();
    releaseOldCheck(true);
    await oldCheck;
    await expect(finalCheck).rejects.toThrow("new policy denies shell");
    expect(checks).toBe(2);
    await monitor.awaitCleanup();
    expect(abortProxy).toHaveBeenCalledOnce();
  });

  it("does not overlap scheduled checks and keeps a cleanup failure", async () => {
    vi.useFakeTimers();
    let resolveCheck;
    let checks = 0;
    const monitor = createDockerEgressAuthorityMonitor({
      revalidate: () => {
        checks += 1;
        return new Promise((resolve) => {
          resolveCheck = resolve;
        });
      },
      abortProxy: async () => {
        throw new Error("abort failed");
      },
      intervalMs: 10,
      checkTimeoutMs: 100,
    });
    monitor.start();
    vi.advanceTimersByTime(50);
    await Promise.resolve();
    expect(checks).toBe(1);
    const denied = monitor.revoke(new Error("policy changed"));
    resolveCheck(true);
    await monitor.awaitCleanup();
    expect(denied.cleanupError?.message).toBe("abort failed");
    expect(() => monitor.assertAuthorized()).toThrow("policy changed");
  });
});
