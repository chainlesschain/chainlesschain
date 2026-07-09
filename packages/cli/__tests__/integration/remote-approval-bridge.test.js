/**
 * Integration: RemoteApprovalBridge against a REAL WebSocket server — the
 * full mobile/web approval loop for a client-hosted (local REPL/headless)
 * session:
 *
 *   local gate asks → bridge publishes permission.request → paired device
 *   receives it → device publishes approval.resolve → server forwards
 *   remote-session-control to the host → bridge settles the confirmer.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChainlessChainWSServer } from "../../src/gateways/ws/ws-server.js";
import { WsRpcClient } from "../../src/lib/ws-rpc-client.js";
import { RemoteApprovalBridge } from "../../src/lib/remote-approval-bridge.js";

const TOKEN = "bridge-integration-token";

function waitForEvent(client, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timed out waiting for event")),
      timeoutMs,
    );
    const off = client.onEvent((message) => {
      if (!predicate(message)) return;
      clearTimeout(timer);
      off();
      resolve(message);
    });
  });
}

describe("remote approval bridge (integration)", () => {
  let server;
  let bridge;
  let device;

  beforeEach(async () => {
    server = new ChainlessChainWSServer({
      port: 0, // OS-assigned; server.port is read back after start()
      host: "127.0.0.1",
      token: TOKEN,
    });
    await server.start();

    bridge = new RemoteApprovalBridge({
      wsUrl: `ws://127.0.0.1:${server.port}`,
      token: TOKEN,
      agentSessionId: "headless-local-1",
      scopes: ["observe", "approve"],
    });
    await bridge.start();

    // Pair a device using nothing but the pairing info.
    const info = bridge.pairingInfo();
    device = new WsRpcClient({ url: `ws://127.0.0.1:${server.port}` });
    await device.connect();
    await device.auth(TOKEN);
    const joined = await device.request("remote-session-join", {
      remoteSessionId: info.remoteSessionId,
      token: bridge.pairing.token,
    });
    expect(joined.type).toBe("remote-session-joined");
  });

  afterEach(async () => {
    device?.close();
    await bridge?.close();
    await server?.stop().catch(() => undefined);
  });

  it("approves a gate from the paired device", async () => {
    const confirmer = bridge.makeConfirmer();

    const devicePermissionRequest = waitForEvent(
      device,
      (m) =>
        m.type === "remote-session-event" &&
        m.event?.type === "permission.request",
    );

    const decisionPromise = confirmer({
      tool: "run_shell",
      command: "npm publish",
    });

    const request = await devicePermissionRequest;
    expect(request.event.tool).toBe("run_shell");
    expect(request.event.detail).toBe("npm publish");

    const resolvedSeen = waitForEvent(
      device,
      (m) =>
        m.type === "remote-session-event" &&
        m.event?.type === "permission.resolved",
    );
    await device.request("remote-session-publish", {
      remoteSessionId: bridge.remoteSessionId,
      commandId: "dev-cmd-1",
      event: {
        type: "approval.resolve",
        requestId: request.event.requestId,
        answer: true,
      },
    });

    await expect(decisionPromise).resolves.toBe(true);
    // Devices see the resolution so UIs can clear the pending card.
    const resolved = await resolvedSeen;
    expect(resolved.event.approved).toBe(true);
  });

  it("denies from the device and replays idempotently on reconnect re-send", async () => {
    const ask = waitForEvent(
      device,
      (m) =>
        m.type === "remote-session-event" &&
        m.event?.type === "permission.request",
    );
    const decision = bridge.requestDecision({ tool: "git", action: "push" });
    const request = await ask;

    const first = await device.request("remote-session-publish", {
      remoteSessionId: bridge.remoteSessionId,
      commandId: "dev-cmd-2",
      event: {
        type: "approval.resolve",
        requestId: request.event.requestId,
        answer: false,
      },
    });
    expect(first.forwardedToHost).toBe(true);

    await expect(decision).resolves.toMatchObject({
      approved: false,
      via: "remote",
    });

    // Same commandId re-sent (dropped-ACK reconnect) → replayed, not re-run.
    const replay = await device.request("remote-session-publish", {
      remoteSessionId: bridge.remoteSessionId,
      commandId: "dev-cmd-2",
      event: {
        type: "approval.resolve",
        requestId: request.event.requestId,
        answer: false,
      },
    });
    expect(replay.replayed).toBe(true);
  });

  it("local fallback wins the race and clears the remote ask", async () => {
    const confirmer = bridge.makeConfirmer({
      fallback: async () => true, // terminal user answers immediately
    });
    const resolvedSeen = waitForEvent(
      device,
      (m) =>
        m.type === "remote-session-event" &&
        m.event?.type === "permission.resolved",
    );
    await expect(confirmer({ tool: "write_file" })).resolves.toBe(true);
    const resolved = await resolvedSeen;
    expect(resolved.event.approved).toBe(true);
  });

  it("fails closed on timeout", async () => {
    const decision = await bridge.requestDecision({
      tool: "run_shell",
      timeoutMs: 150,
    });
    expect(decision).toEqual({ approved: false, via: "timeout", from: null });
  });

  it("counts approvers", async () => {
    expect(await bridge.approverCount()).toBe(1);
  });
});
