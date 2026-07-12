/**
 * RemoteApprovalBridge confused-deputy guard (IDE gap P0#2 "approvalId 绑定操作
 * 指纹"). Drives the bridge offline (no WS server): _publish is a no-op without
 * a client, so requestDecision still records a pending ask with its operation
 * fingerprint, and _onServerEvent can be exercised directly with a resolve
 * carrying a matching / mismatching / absent fingerprint.
 */
import { describe, it, expect } from "vitest";
import { RemoteApprovalBridge } from "../../src/lib/remote-approval-bridge.js";
import { operationFingerprint } from "../../src/lib/operation-fingerprint.js";

function makeBridge() {
  const bridge = new RemoteApprovalBridge({
    wsUrl: "ws://127.0.0.1:1",
    agentSessionId: "offline-1",
  });
  bridge.remoteSessionId = "rs-1"; // pretend a session is registered
  return bridge;
}

function resolveFrame(requestId, extra) {
  return {
    type: "remote-session-control",
    remoteSessionId: "rs-1",
    event: { type: "approval.resolve", requestId, answer: true, ...extra },
  };
}

describe("remote approval fingerprint binding", () => {
  it("rejects a resolve whose fingerprint is for a DIFFERENT operation", async () => {
    const bridge = makeBridge();
    let requestId;
    const decision = bridge.requestDecision({
      tool: "run_shell",
      detail: "npm publish",
      timeoutMs: 200,
      onRequestId: (id) => {
        requestId = id;
      },
    });

    // A resolve for a different operation (e.g. the card was swapped) must NOT settle.
    const wrong = operationFingerprint({
      tool: "run_shell",
      detail: "rm -rf /",
    });
    bridge._onServerEvent(resolveFrame(requestId, { fingerprint: wrong }));

    // The ask is still pending; it fails closed on timeout instead.
    const result = await decision;
    expect(result).toEqual({ approved: false, via: "timeout", from: null });
  });

  it("settles when the resolve echoes the matching operation fingerprint", async () => {
    const bridge = makeBridge();
    let requestId;
    const decision = bridge.requestDecision({
      tool: "run_shell",
      detail: "npm publish",
      timeoutMs: 5000,
      onRequestId: (id) => {
        requestId = id;
      },
    });

    const right = operationFingerprint({
      tool: "run_shell",
      detail: "npm publish",
    });
    bridge._onServerEvent(resolveFrame(requestId, { fingerprint: right }));

    await expect(decision).resolves.toMatchObject({
      approved: true,
      via: "remote",
    });
  });

  it("settles a legacy resolve that carries no fingerprint (backward compatible)", async () => {
    const bridge = makeBridge();
    let requestId;
    const decision = bridge.requestDecision({
      tool: "git",
      action: "push",
      timeoutMs: 5000,
      onRequestId: (id) => {
        requestId = id;
      },
    });

    bridge._onServerEvent(resolveFrame(requestId, {})); // no fingerprint field

    await expect(decision).resolves.toMatchObject({
      approved: true,
      via: "remote",
    });
  });

  it("publishes the fingerprint on the permission.request so devices can echo it", () => {
    const bridge = makeBridge();
    const published = [];
    bridge._publish = (event) => published.push(event);
    bridge.requestDecision({
      tool: "run_shell",
      detail: "npm publish",
      timeoutMs: 5000,
    });
    const request = published.find((e) => e.type === "permission.request");
    expect(request.fingerprint).toBe(
      operationFingerprint({ tool: "run_shell", detail: "npm publish" }),
    );
  });
});
