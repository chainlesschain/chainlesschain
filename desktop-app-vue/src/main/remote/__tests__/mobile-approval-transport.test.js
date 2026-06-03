/**
 * MobileApprovalTransport 单测（M4 D2 桌面胶水末段）— 把 channel.setOnRequest
 * 回调桥到 mobile-bridge.sendReverseRpcRequest，并把 RPC response 转成
 * channel.resolveApproval 入参。
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { MobileApprovalChannel } from "../handlers/mobile-approval-channel";
import { MobileApprovalTransport } from "../handlers/mobile-approval-transport";

function makeFakeBridge() {
  return {
    sendReverseRpcRequest: vi.fn(),
  };
}

describe("MobileApprovalTransport.wire", () => {
  let channel;
  let bridge;

  beforeEach(() => {
    channel = new MobileApprovalChannel({ timeoutMs: 1000 });
    bridge = makeFakeBridge();
  });

  it("throws when approvalChannel missing required interface", () => {
    expect(() => MobileApprovalTransport.wire(null, bridge)).toThrow();
    expect(() => MobileApprovalTransport.wire({}, bridge)).toThrow();
  });

  it("throws when mobileBridge missing required interface", () => {
    expect(() => MobileApprovalTransport.wire(channel, null)).toThrow();
    expect(() => MobileApprovalTransport.wire(channel, {})).toThrow();
  });

  it("forwards approval payload as JSON-RPC 2.0 approval.request", async () => {
    bridge.sendReverseRpcRequest.mockResolvedValue({
      jsonrpc: "2.0",
      id: "ignored",
      result: { approved: true, signature: "sig-1" },
    });
    MobileApprovalTransport.wire(channel, bridge);

    const promise = channel.requestApproval({
      peerId: "android-1",
      method: "marketplace.purchase",
      params: { itemId: "X" },
    });
    const result = await promise;

    expect(bridge.sendReverseRpcRequest).toHaveBeenCalledTimes(1);
    const [peerId, request] = bridge.sendReverseRpcRequest.mock.calls[0];
    expect(peerId).toBe("android-1");
    expect(request.jsonrpc).toBe("2.0");
    expect(request.method).toBe("approval.request");
    expect(request.id).toMatch(/^apr-/);
    expect(request.id).toBe(result.requestId);
    expect(request.params.method).toBe("marketplace.purchase");
    expect(request.params.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(request.params.payloadDescription).toBe("Marketplace · Purchase");
    expect(request.params.requireBiometric).toBe(true);
  });

  it("resolves channel with approved=true when RPC returns approved result", async () => {
    bridge.sendReverseRpcRequest.mockResolvedValue({
      jsonrpc: "2.0",
      id: "ignored",
      result: { approved: true, signature: "sig-OK" },
    });
    MobileApprovalTransport.wire(channel, bridge);
    const result = await channel.requestApproval({
      peerId: "p1",
      method: "x.y",
    });

    expect(result.approved).toBe(true);
    expect(result.signature).toBe("sig-OK");
  });

  it("resolves channel with deniedReason from RPC error", async () => {
    bridge.sendReverseRpcRequest.mockResolvedValue({
      jsonrpc: "2.0",
      id: "ignored",
      error: { code: -32010, message: "user-declined" },
    });
    MobileApprovalTransport.wire(channel, bridge);
    const result = await channel.requestApproval({
      peerId: "p1",
      method: "x.y",
    });

    expect(result.approved).toBe(false);
    expect(result.deniedReason).toContain("user-declined");
  });

  it("resolves channel with transport-error when sendReverseRpcRequest rejects", async () => {
    bridge.sendReverseRpcRequest.mockRejectedValue(new Error("WS closed"));
    MobileApprovalTransport.wire(channel, bridge);

    const result = await channel.requestApproval({
      peerId: "p1",
      method: "x.y",
    });

    expect(result.approved).toBe(false);
    expect(result.deniedReason).toMatch(/transport:WS closed/);
  });

  it("resolves channel with rpc-empty-response when response is null", async () => {
    bridge.sendReverseRpcRequest.mockResolvedValue(null);
    MobileApprovalTransport.wire(channel, bridge);

    const result = await channel.requestApproval({
      peerId: "p1",
      method: "x.y",
    });

    expect(result.approved).toBe(false);
    expect(result.deniedReason).toBe("rpc-empty-response");
  });

  it("unwire stops further bridge calls", async () => {
    bridge.sendReverseRpcRequest.mockResolvedValue({
      jsonrpc: "2.0",
      id: "ignored",
      result: { approved: true },
    });
    const unwire = MobileApprovalTransport.wire(channel, bridge);
    unwire();

    // After unwire, channel's onRequestCallback should be null; requestApproval
    // still creates pending entry but bridge.sendReverseRpcRequest will not be called.
    const promise = channel.requestApproval({ peerId: "p1", method: "x.y" });
    expect(bridge.sendReverseRpcRequest).not.toHaveBeenCalled();

    // Manually resolve to drain pending (avoid 60s timeout)
    const pendingId = Array.from(channel.pending.keys())[0];
    channel.resolveApproval(pendingId, {
      approved: false,
      deniedReason: "test",
    });
    await promise;
  });

  it("preserves requestId end-to-end (channel ↔ rpc.id ↔ resolveApproval)", async () => {
    let capturedId;
    bridge.sendReverseRpcRequest.mockImplementation((peerId, req) => {
      capturedId = req.id;
      return Promise.resolve({
        jsonrpc: "2.0",
        id: req.id,
        result: { requestId: req.id, approved: true },
      });
    });
    MobileApprovalTransport.wire(channel, bridge);

    const result = await channel.requestApproval({
      peerId: "p1",
      method: "x.y",
    });

    expect(result.requestId).toBe(capturedId);
    expect(result.requestId).toMatch(/^apr-/);
  });

  it("approval.request payload propagates explicit payloadDescription + requireBiometric=false", async () => {
    bridge.sendReverseRpcRequest.mockResolvedValue({
      jsonrpc: "2.0",
      id: "ignored",
      result: { approved: true },
    });
    MobileApprovalTransport.wire(channel, bridge);
    await channel.requestApproval({
      peerId: "p1",
      method: "ai.chat",
      payloadDescription: "Custom prompt confirm",
      requireBiometric: false,
    });

    const [, request] = bridge.sendReverseRpcRequest.mock.calls[0];
    expect(request.params.payloadDescription).toBe("Custom prompt confirm");
    expect(request.params.requireBiometric).toBe(false);
  });
});
