/**
 * MobileApprovalChannel 单元测试（M4 D2）
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { MobileApprovalChannel } from "../handlers/mobile-approval-channel";

describe("MobileApprovalChannel", () => {
  let channel;

  beforeEach(() => {
    channel = new MobileApprovalChannel({ timeoutMs: 200 });
  });

  it("requestApproval rejects when peerId or method missing", async () => {
    await expect(
      channel.requestApproval({ method: "ai.chat" }),
    ).rejects.toThrow();
    await expect(channel.requestApproval({ peerId: "p1" })).rejects.toThrow();
  });

  it("requestApproval creates pending entry", () => {
    channel.requestApproval({
      peerId: "android-1",
      method: "marketplace.purchase",
    });
    expect(channel.pendingCount()).toBe(1);
  });

  it("onRequest callback fires with payload", () => {
    const cb = vi.fn();
    channel.setOnRequest(cb);
    channel.requestApproval({
      peerId: "android-1",
      method: "marketplace.purchase",
      params: { itemId: "X", amount: 25 },
    });
    expect(cb).toHaveBeenCalledTimes(1);
    const arg = cb.mock.calls[0][0];
    expect(arg.method).toBe("marketplace.purchase");
    expect(arg.peerId).toBe("android-1");
    expect(arg.params.itemId).toBe("X");
    expect(arg.requestId).toMatch(/^apr-/);
  });

  it("resolveApproval with approved=true resolves caller promise", async () => {
    const cb = vi.fn();
    channel.setOnRequest(cb);
    const promise = channel.requestApproval({
      peerId: "p1",
      method: "marketplace.purchase",
    });
    const requestId = cb.mock.calls[0][0].requestId;

    channel.resolveApproval(requestId, {
      approved: true,
      signature: "sig-abc",
    });
    const result = await promise;

    expect(result.approved).toBe(true);
    expect(result.signature).toBe("sig-abc");
    expect(result.requestId).toBe(requestId);
    expect(channel.pendingCount()).toBe(0);
  });

  it("resolveApproval with approved=false marks deniedReason", async () => {
    const cb = vi.fn();
    channel.setOnRequest(cb);
    const promise = channel.requestApproval({
      peerId: "p1",
      method: "did.delegate",
    });
    const requestId = cb.mock.calls[0][0].requestId;

    channel.resolveApproval(requestId, {
      approved: false,
      deniedReason: "user-cancel",
    });
    const result = await promise;

    expect(result.approved).toBe(false);
    expect(result.deniedReason).toBe("user-cancel");
  });

  it("resolveApproval falls back to denied-by-user when reason missing", async () => {
    const cb = vi.fn();
    channel.setOnRequest(cb);
    const promise = channel.requestApproval({ peerId: "p1", method: "x.y" });
    const requestId = cb.mock.calls[0][0].requestId;

    channel.resolveApproval(requestId, { approved: false });
    const r = await promise;

    expect(r.deniedReason).toBe("denied-by-user");
  });

  it("timeout auto-resolves as denied with deniedReason=timeout", async () => {
    const cb = vi.fn();
    channel.setOnRequest(cb);
    const promise = channel.requestApproval({
      peerId: "p1",
      method: "cowork.spawnTeam",
    });

    const result = await promise; // 200ms timeout configured

    expect(result.approved).toBe(false);
    expect(result.deniedReason).toBe("timeout");
    expect(channel.pendingCount()).toBe(0);
  });

  it("resolveApproval on unknown requestId returns false", () => {
    expect(channel.resolveApproval("apr-nonexistent", { approved: true })).toBe(
      false,
    );
  });

  it("cancelApproval resolves promise as denied", async () => {
    const cb = vi.fn();
    channel.setOnRequest(cb);
    const promise = channel.requestApproval({ peerId: "p1", method: "x.y" });
    const requestId = cb.mock.calls[0][0].requestId;

    channel.cancelApproval(requestId, "device-disconnect");
    const result = await promise;

    expect(result.approved).toBe(false);
    expect(result.deniedReason).toBe("device-disconnect");
  });

  it("clearAll denies all pending and zero count", async () => {
    const cb = vi.fn();
    channel.setOnRequest(cb);
    const p1 = channel.requestApproval({ peerId: "p1", method: "x.y" });
    const p2 = channel.requestApproval({ peerId: "p2", method: "a.b" });
    expect(channel.pendingCount()).toBe(2);

    channel.clearAll("server-shutdown");
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.approved).toBe(false);
    expect(r1.deniedReason).toBe("server-shutdown");
    expect(r2.approved).toBe(false);
    expect(channel.pendingCount()).toBe(0);
  });

  it("onRequest throw does not break the channel", async () => {
    channel.setOnRequest(() => {
      throw new Error("transport down");
    });
    const promise = channel.requestApproval({ peerId: "p1", method: "x.y" });

    // Should still timeout cleanly without throwing
    const result = await promise;
    expect(result.approved).toBe(false);
    expect(result.deniedReason).toBe("timeout");
  });
});
