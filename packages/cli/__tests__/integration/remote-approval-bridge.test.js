/**
 * Integration: RemoteApprovalBridge against a REAL WebSocket server — the
 * full mobile/web approval loop for a client-hosted (local REPL/headless)
 * session:
 *
 *   local gate asks → bridge publishes permission.request → paired device
 *   receives it → device publishes approval.resolve → server forwards
 *   remote-session-control to the host → bridge settles the confirmer.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChainlessChainWSServer } from "../../src/gateways/ws/ws-server.js";
import { WsRpcClient } from "../../src/lib/ws-rpc-client.js";
import { RemoteApprovalBridge } from "../../src/lib/remote-approval-bridge.js";
import { raceLocalAndRemote } from "../../src/repl/remote-approval.js";

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

function approvalResolveEvent(request, answer) {
  return {
    type: "approval.resolve",
    requestId: request.event.requestId,
    fingerprint: request.event.fingerprint,
    binding: request.event.binding,
    revision: request.event.revision,
    answer,
  };
}

describe("remote approval bridge (integration)", () => {
  let server;
  let bridge;
  let device;
  let approvalDirectory;

  beforeEach(async () => {
    approvalDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-remote-approval-integration-"),
    );
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
      approvalStateFile: path.join(approvalDirectory, "approval-state.json"),
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
    if (approvalDirectory) {
      fs.rmSync(approvalDirectory, { recursive: true, force: true });
    }
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
    expect(request.event.fingerprint).toMatch(/^opf_[0-9a-f]{40}$/);
    expect(request.event.binding).toMatch(/^ab_[0-9a-f]{32}$/);
    expect(request.event.revision).toBe(1);

    const resolvedSeen = waitForEvent(
      device,
      (m) =>
        m.type === "remote-session-event" &&
        m.event?.type === "permission.resolved",
    );
    await device.request("remote-session-publish", {
      remoteSessionId: bridge.remoteSessionId,
      commandId: "dev-cmd-1",
      event: approvalResolveEvent(request, true),
    });

    await expect(decisionPromise).resolves.toBe(true);
    // Devices see the resolution so UIs can clear the pending card.
    const resolved = await resolvedSeen;
    expect(resolved.event.approved).toBe(true);
    expect(
      bridge._approvalStore.getRequest(request.event.requestId, {
        bestEffort: false,
      }),
    ).toMatchObject({
      status: "resolved",
      decision: true,
      revision: 2,
    });
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
      event: approvalResolveEvent(request, false),
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
      event: approvalResolveEvent(request, false),
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
    expect(
      bridge._approvalStore.getRequest(resolved.event.requestId, {
        bestEffort: false,
      }),
    ).toMatchObject({
      status: "resolved",
      decision: true,
      revision: 2,
    });
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

  // REPL race (批26): the interactive terminal prompt races the device.
  it("REPL race: device answers first → local prompt is canceled", async () => {
    const ask = waitForEvent(
      device,
      (m) =>
        m.type === "remote-session-event" &&
        m.event?.type === "permission.request",
    );
    const cancel = vi.fn();
    const race = raceLocalAndRemote({
      bridge,
      ask: { tool: "run_shell", detail: "npm publish" },
      local: { promise: new Promise(() => {}), cancel }, // user never answers
      writeOut: () => {},
    });
    const request = await ask;
    await device.request("remote-session-publish", {
      remoteSessionId: bridge.remoteSessionId,
      commandId: "dev-cmd-race-1",
      event: approvalResolveEvent(request, true),
    });
    await expect(race).resolves.toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("REPL race: a local yes cannot revive a durably expired card", async () => {
    let answerLocal;
    const race = raceLocalAndRemote({
      bridge,
      // timeoutMs rides the requestDecision spread — real timeout fires first
      ask: { tool: "run_shell", timeoutMs: 120 },
      local: {
        promise: new Promise((resolve) => {
          answerLocal = resolve;
        }),
        cancel: vi.fn(),
      },
      writeOut: () => {},
    });
    // Once timeout is durably persisted, a later local "yes" cannot revive the
    // expired card without a fresh request/revision.
    await new Promise((resolve) => setTimeout(resolve, 300));
    answerLocal(true);
    await expect(race).resolves.toBe(false);
  });
});
