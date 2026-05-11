/**
 * M4 D2 跨端审批 E2E（desktop-only integration test）
 *
 * 真接通的桌面侧完整链路：
 *   CommandRouter (context.source='mobile') → whitelist (allow) → whitelist
 *     (requiresApproval=true) → MobileApprovalChannel.requestApproval →
 *     onRequest callback (wired by MobileApprovalTransport) →
 *     FakeMobileBridge.sendReverseRpcRequest → 模拟 Android side
 *     (ApprovalCommandRouter) → response → channel.resolveApproval →
 *     command-router continues → handler.handle
 *
 * 真机端的 E2E (跨 WebRTC DataChannel + 真 Android ApprovalDialog) 见
 * docs/design/Android_M4_D2_E2E.md。
 *
 * 本测试覆盖 desktop 侧每个组件 + 它们之间的边界协议，是真机 E2E 之前的最后
 * 一道闸 — 离 production 仅差 WebRTC transport + Android Compose dialog。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CommandRouter, ERROR_CODES } from "../command-router";
import { MobileSkillWhitelist } from "../handlers/mobile-skill-whitelist";
import { MobileApprovalChannel } from "../handlers/mobile-approval-channel";
import { MobileApprovalTransport } from "../handlers/mobile-approval-transport";

/**
 * FakeMobileBridge — 模拟 mobile-bridge.js sendReverseRpcRequest，行为可配置：
 *  - approveAll: Android 端用户都点同意
 *  - denyAll: Android 端用户都点拒绝
 *  - custom: handler 自定义 response（带 signature 等）
 *
 * 模拟 Android 的 ApprovalCommandRouter（method='approval.request'）。
 */
function makeFakeMobileBridge({ androidBehavior = "approveAll" } = {}) {
  const sent = [];
  const sendReverseRpcRequest = vi.fn(async (peerId, request) => {
    sent.push({ peerId, request });

    if (request.method !== "approval.request") {
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32601, message: "Method not found" },
      };
    }

    const params = request.params || {};
    // Android side ApprovalCommandRouter would route to ApprovalGate.requestApproval
    // — simulate the result envelope here.
    if (typeof androidBehavior === "function") {
      return androidBehavior(params);
    }

    if (androidBehavior === "denyAll") {
      return {
        jsonrpc: "2.0",
        id: request.id,
        result: {
          requestId: params.requestId,
          approved: false,
          deniedReason: "user-declined",
        },
      };
    }
    if (androidBehavior === "biometricFail") {
      return {
        jsonrpc: "2.0",
        id: request.id,
        result: {
          requestId: params.requestId,
          approved: false,
          deniedReason: "biometric-failed",
        },
      };
    }
    if (androidBehavior === "rpcError") {
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32000, message: "no-active-did" },
      };
    }
    if (androidBehavior === "transportError") {
      throw new Error("WebRTC DataChannel closed");
    }
    // default: approve
    return {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        requestId: params.requestId,
        approved: true,
        signature: `ed25519-sig-${params.requestId}`,
      },
    };
  });
  return { sendReverseRpcRequest, sent };
}

function makeMarketplaceHandler() {
  return {
    handle: vi.fn(async (action, params, context) => {
      // Echo back so we can assert on the context (containing mobileApproval) and params.
      return {
        ok: true,
        action,
        params,
        receivedApproval: context.mobileApproval,
      };
    }),
  };
}

describe("M4 D2 cross-end approval — full desktop pipeline", () => {
  let whitelist;
  let channel;
  let bridge;
  let router;
  let handler;
  let unwire;

  beforeEach(() => {
    whitelist = new MobileSkillWhitelist({
      exposeRemoteSkills: ["marketplace.*", "did.*"],
      approvalChannelsForMobile: ["marketplace.purchase", "did.delegate"],
    });
    channel = new MobileApprovalChannel({ timeoutMs: 500 });
    handler = makeMarketplaceHandler();
    router = new CommandRouter({
      enableLogging: false,
      mobileBridgeWhitelist: whitelist,
      mobileApprovalChannel: channel,
    });
    router.registerHandler("marketplace", handler);
    router.registerHandler("did", handler);
  });

  afterEach(() => {
    if (unwire) {
      unwire();
    }
    unwire = null;
  });

  it("happy path: marketplace.purchase from mobile → Android approves → command executes with signature", async () => {
    bridge = makeFakeMobileBridge({ androidBehavior: "approveAll" });
    unwire = MobileApprovalTransport.wire(channel, bridge);

    const res = await router.route(
      {
        id: 1,
        method: "marketplace.purchase",
        params: { itemId: "X", amount: 25 },
      },
      { source: "mobile", peerId: "android-paired-1" },
    );

    // Command succeeded
    expect(res.result).toBeDefined();
    expect(res.error).toBeUndefined();
    expect(res.result.ok).toBe(true);
    expect(res.result.params.itemId).toBe("X");

    // Bridge was called once with proper JSON-RPC envelope
    expect(bridge.sendReverseRpcRequest).toHaveBeenCalledTimes(1);
    const sentReq = bridge.sent[0].request;
    expect(sentReq.jsonrpc).toBe("2.0");
    expect(sentReq.method).toBe("approval.request");
    expect(sentReq.id).toMatch(/^apr-/);

    // Payload Android receives carries the original method + computed hash + description
    expect(sentReq.params.method).toBe("marketplace.purchase");
    expect(sentReq.params.params).toEqual({ itemId: "X", amount: 25 });
    expect(sentReq.params.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(sentReq.params.payloadDescription).toBe("Marketplace · Purchase");
    expect(sentReq.params.requireBiometric).toBe(true);

    // Handler was invoked with mobileApproval context (the signature)
    expect(handler.handle).toHaveBeenCalledTimes(1);
    const handlerContext = handler.handle.mock.calls[0][2];
    expect(handlerContext.mobileApproval).toBeDefined();
    expect(handlerContext.mobileApproval.signature).toMatch(
      /^ed25519-sig-apr-/,
    );
  });

  it("user declines on Android → PERMISSION_DENIED returned + handler not called", async () => {
    bridge = makeFakeMobileBridge({ androidBehavior: "denyAll" });
    unwire = MobileApprovalTransport.wire(channel, bridge);

    const res = await router.route(
      { id: 2, method: "marketplace.purchase", params: { itemId: "Y" } },
      { source: "mobile", peerId: "android-paired-1" },
    );

    expect(res.error).toBeDefined();
    expect(res.error.code).toBe(ERROR_CODES.PERMISSION_DENIED);
    expect(res.error.message).toMatch(/user-declined/);
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it("Android biometric fails → PERMISSION_DENIED carries biometric-failed reason", async () => {
    bridge = makeFakeMobileBridge({ androidBehavior: "biometricFail" });
    unwire = MobileApprovalTransport.wire(channel, bridge);

    const res = await router.route(
      { id: 3, method: "did.delegate", params: { to: "did:cc:abc" } },
      { source: "mobile", peerId: "android-paired-1" },
    );

    expect(res.error.code).toBe(ERROR_CODES.PERMISSION_DENIED);
    expect(res.error.message).toMatch(/biometric-failed/);
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it("Android RPC error response → propagated as deniedReason", async () => {
    bridge = makeFakeMobileBridge({ androidBehavior: "rpcError" });
    unwire = MobileApprovalTransport.wire(channel, bridge);

    const res = await router.route(
      { id: 4, method: "marketplace.purchase", params: {} },
      { source: "mobile", peerId: "android-paired-1" },
    );

    expect(res.error.code).toBe(ERROR_CODES.PERMISSION_DENIED);
    expect(res.error.message).toMatch(/rpc-error:no-active-did/);
  });

  it("transport throws (WebRTC closed) → command denied with transport reason", async () => {
    bridge = makeFakeMobileBridge({ androidBehavior: "transportError" });
    unwire = MobileApprovalTransport.wire(channel, bridge);

    const res = await router.route(
      { id: 5, method: "marketplace.purchase", params: {} },
      { source: "mobile", peerId: "android-paired-1" },
    );

    expect(res.error.code).toBe(ERROR_CODES.PERMISSION_DENIED);
    expect(res.error.message).toMatch(/transport:.*WebRTC.*closed/i);
  });

  it("Android slow-response → channel timeout fires first → command denied with timeout", async () => {
    // Bridge that never resolves — channel's 500ms timeout (beforeEach) must kick in
    bridge = {
      sendReverseRpcRequest: vi.fn(
        () => new Promise(() => {}), // never resolves
      ),
    };
    unwire = MobileApprovalTransport.wire(channel, bridge);

    const res = await router.route(
      { id: 6, method: "marketplace.purchase", params: {} },
      { source: "mobile", peerId: "android-paired-1" },
    );

    expect(res.error.code).toBe(ERROR_CODES.PERMISSION_DENIED);
    expect(res.error.message).toMatch(/timeout/);
  });

  it("non-approval method on whitelist (e.g. marketplace.browse) → skips channel + executes directly", async () => {
    bridge = makeFakeMobileBridge();
    unwire = MobileApprovalTransport.wire(channel, bridge);

    const res = await router.route(
      { id: 7, method: "marketplace.browse", params: { q: "books" } },
      { source: "mobile", peerId: "android-paired-1" },
    );

    expect(res.result.ok).toBe(true);
    expect(bridge.sendReverseRpcRequest).not.toHaveBeenCalled();
    expect(handler.handle).toHaveBeenCalledTimes(1);
  });

  it("method not on whitelist → blocked before approval channel ever fires", async () => {
    bridge = makeFakeMobileBridge();
    unwire = MobileApprovalTransport.wire(channel, bridge);

    // not in exposeRemoteSkills
    router.registerHandler("system", handler);

    const res = await router.route(
      { id: 8, method: "system.shutdown", params: {} },
      { source: "mobile", peerId: "android-paired-1" },
    );

    expect(res.error.code).toBe(ERROR_CODES.PERMISSION_DENIED);
    expect(res.error.message).toMatch(/not allowed for mobile peers/);
    expect(bridge.sendReverseRpcRequest).not.toHaveBeenCalled();
  });

  it("multiple parallel approval requests do not collide (independent requestIds)", async () => {
    bridge = makeFakeMobileBridge({ androidBehavior: "approveAll" });
    unwire = MobileApprovalTransport.wire(channel, bridge);

    const [r1, r2] = await Promise.all([
      router.route(
        { id: 9, method: "marketplace.purchase", params: { itemId: "A" } },
        { source: "mobile", peerId: "android-paired-1" },
      ),
      router.route(
        { id: 10, method: "did.delegate", params: { to: "did:cc:b" } },
        { source: "mobile", peerId: "android-paired-1" },
      ),
    ]);

    expect(r1.result.ok).toBe(true);
    expect(r2.result.ok).toBe(true);
    expect(bridge.sent).toHaveLength(2);
    expect(bridge.sent[0].request.id).not.toBe(bridge.sent[1].request.id);

    // Both handler calls received their own signature
    const sig1 = handler.handle.mock.calls[0][2].mobileApproval.signature;
    const sig2 = handler.handle.mock.calls[1][2].mobileApproval.signature;
    expect(sig1).not.toBe(sig2);
  });

  it("desktop-internal call (context.source != 'mobile') bypasses all mobile gates", async () => {
    bridge = makeFakeMobileBridge();
    unwire = MobileApprovalTransport.wire(channel, bridge);

    const res = await router.route(
      { id: 11, method: "marketplace.purchase", params: { itemId: "Z" } },
      { source: "desktop" /* not mobile */ },
    );

    expect(res.result.ok).toBe(true);
    expect(bridge.sendReverseRpcRequest).not.toHaveBeenCalled();
  });
});
