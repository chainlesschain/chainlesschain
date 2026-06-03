/**
 * MobileApprovalChannel 单元测试（M4 D2）
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  MobileApprovalChannel,
  _canonicalJson,
  _describeMethodDefault,
} from "../handlers/mobile-approval-channel";
import crypto from "crypto";

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

  // --- M4 D2 payload enrich: payloadHash + payloadDescription + requireBiometric ---

  it("payload includes payloadHash (sha256 hex 64-char)", () => {
    const cb = vi.fn();
    channel.setOnRequest(cb);
    channel.requestApproval({
      peerId: "p1",
      method: "marketplace.purchase",
      params: { itemId: "X", amount: 25 },
    });
    const payload = cb.mock.calls[0][0];
    expect(payload.payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("payloadHash is deterministic for same {method, params, requestedAt}", () => {
    // 同 method + params + requestedAt → 同 hash（独立调 canonicalJson 验证）
    const canonical = _canonicalJson({
      method: "marketplace.purchase",
      params: { amount: 25, itemId: "X" }, // key 顺序无关
      requestedAt: 1700000000000,
    });
    const expectedHex = crypto
      .createHash("sha256")
      .update(canonical, "utf8")
      .digest("hex");
    // 顺序换位后再算一次
    const canonical2 = _canonicalJson({
      requestedAt: 1700000000000,
      params: { itemId: "X", amount: 25 },
      method: "marketplace.purchase",
    });
    const hex2 = crypto
      .createHash("sha256")
      .update(canonical2, "utf8")
      .digest("hex");
    expect(hex2).toBe(expectedHex);
  });

  it("payloadDescription defaults to derived '<Namespace> · <Action>'", () => {
    const cb = vi.fn();
    channel.setOnRequest(cb);
    channel.requestApproval({ peerId: "p1", method: "marketplace.purchase" });
    const payload = cb.mock.calls[0][0];
    expect(payload.payloadDescription).toBe("Marketplace · Purchase");
  });

  it("payloadDescription explicit override wins over default", () => {
    const cb = vi.fn();
    channel.setOnRequest(cb);
    channel.requestApproval({
      peerId: "p1",
      method: "marketplace.purchase",
      payloadDescription: "购买道具：金币 ×100（$25 USDT）",
    });
    const payload = cb.mock.calls[0][0];
    expect(payload.payloadDescription).toBe("购买道具：金币 ×100（$25 USDT）");
  });

  it("requireBiometric defaults to true", () => {
    const cb = vi.fn();
    channel.setOnRequest(cb);
    channel.requestApproval({ peerId: "p1", method: "did.delegate" });
    expect(cb.mock.calls[0][0].requireBiometric).toBe(true);
  });

  it("requireBiometric can be explicitly set to false", () => {
    const cb = vi.fn();
    channel.setOnRequest(cb);
    channel.requestApproval({
      peerId: "p1",
      method: "ai.chat",
      requireBiometric: false,
    });
    expect(cb.mock.calls[0][0].requireBiometric).toBe(false);
  });

  it("_describeMethodDefault handles unknown/empty inputs", () => {
    expect(_describeMethodDefault("")).toBe("(unknown method)");
    expect(_describeMethodDefault(null)).toBe("(unknown method)");
    expect(_describeMethodDefault("foo")).toBe("Foo · (action)");
    expect(_describeMethodDefault("a.b.c")).toBe("A · B.c");
  });

  it("_canonicalJson sorts nested keys + survives arrays", () => {
    const j = _canonicalJson({ z: 1, a: [3, 1, 2], n: { y: true, x: null } });
    expect(j).toBe('{"a":[3,1,2],"n":{"x":null,"y":true},"z":1}');
  });

  it("_canonicalJson throws on non-finite number", () => {
    expect(() => _canonicalJson(Number.POSITIVE_INFINITY)).toThrow(
      /non-finite/,
    );
  });
});
