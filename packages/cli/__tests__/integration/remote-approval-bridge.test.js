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
import {
  createRemoteMembershipPrincipalCredential,
  signRemoteMembershipAuthenticationChallenge,
} from "../../src/lib/remote-membership-coordinator.js";
import { raceLocalAndRemote } from "../../src/repl/remote-approval.js";

// These cases use real loopback WebSockets plus fsync-backed coordinator and
// host stores. Bound them explicitly for loaded CI workers instead of relying
// on Vitest's generic 5-second unit-test default.
vi.setConfig({ testTimeout: 15_000 });

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
  let server2;
  let bridge2;
  let devicePrincipalId;
  let approvalDirectory;

  const coordinatorOptions = () => ({
    stateFile: path.join(approvalDirectory, "coordinator", "state.json"),
    keyFile: path.join(approvalDirectory, "coordinator", "key.json"),
    witnessFile: path.join(approvalDirectory, "coordinator", "witness.json"),
  });

  const bridgeOptions = (port) => ({
    wsUrl: `ws://127.0.0.1:${port}`,
    token: TOKEN,
    agentSessionId: "headless-local-1",
    scopes: ["observe", "approve"],
    approvalStateFile: path.join(approvalDirectory, "approval-state.json"),
    membershipHostStateFile: path.join(approvalDirectory, "host", "state.json"),
    membershipHostWitnessFile: path.join(
      approvalDirectory,
      "host",
      "witness.json",
    ),
  });

  async function approveShell({
    host = bridge,
    approver = device,
    command,
    commandId,
  }) {
    const ask = waitForEvent(
      approver,
      (message) =>
        message.type === "remote-session-event" &&
        message.event?.type === "permission.request",
    );
    const decisionPromise = host.requestDecision({
      tool: "run_shell",
      detail: command,
      operationArgs: { command },
    });
    const request = await ask;
    await approver.request("remote-session-publish", {
      remoteSessionId: host.remoteSessionId,
      commandId,
      event: approvalResolveEvent(request, true),
    });
    return { request, decision: await decisionPromise };
  }

  function expectStateFailureCleanup(request) {
    const requestId = request.event.requestId;
    expect(
      bridge._approvalStore.getRequest(requestId, { bestEffort: false }),
    ).toMatchObject({
      requestId,
      fingerprint: request.event.fingerprint,
      binding: request.event.binding,
      status: "cancelled",
      revision: request.event.revision + 1,
    });

    const coordinatorLease = server
      ._requireRemoteMembershipCoordinator()
      .snapshotSession(bridge.remoteSessionId)
      .session.leases.find((lease) => lease.requestId === requestId);
    const hostLease = bridge
      ._requireMembershipHostStore()
      .inspect()
      .leases.find((lease) => lease.requestId === requestId);
    for (const lease of [coordinatorLease, hostLease]) {
      expect(lease).toMatchObject({
        requestId,
        fingerprint: request.event.fingerprint,
        binding: request.event.binding,
        status: "cancelled",
      });
    }
  }

  beforeEach(async () => {
    approvalDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-remote-approval-integration-"),
    );
    server = new ChainlessChainWSServer({
      port: 0, // OS-assigned; server.port is read back after start()
      host: "127.0.0.1",
      token: TOKEN,
      remoteMembershipCoordinatorOptions: coordinatorOptions(),
    });
    await server.start();

    bridge = new RemoteApprovalBridge(bridgeOptions(server.port));
    await bridge.start();

    // Pair a device using nothing but the pairing info.
    const info = bridge.pairingInfo();
    device = new WsRpcClient({ url: `ws://127.0.0.1:${server.port}` });
    await device.connect();
    await device.auth(TOKEN);
    const credential = createRemoteMembershipPrincipalCredential();
    const challenged = await device.request("remote-session-join-challenge", {
      remoteSessionId: info.remoteSessionId,
      token: bridge.pairing.token,
      capabilities: ["approval-binding-v1"],
      credentialPublicKey: credential.publicKey,
    });
    const joined = await device.request("remote-session-join", {
      remoteSessionId: info.remoteSessionId,
      challengeId: challenged.challenge.challengeId,
      signature: signRemoteMembershipAuthenticationChallenge(
        challenged.challenge,
        credential.privateKeyPkcs8,
      ),
    });
    expect(joined.type).toBe("remote-session-joined");
    devicePrincipalId = joined.member.principalId;
    expect(devicePrincipalId).toMatch(/^ed25519:[0-9a-f]{64}$/);
  });

  afterEach(async () => {
    device?.close();
    await bridge2?.close().catch(() => undefined);
    await bridge?.close();
    await server2?.stop().catch(() => undefined);
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

    const approvedWorkspace = approvalDirectory;
    const approvedPolicyVersion =
      "cc-shell-policy-authority/v1:integration-test";
    const decisionPromise = confirmer({
      tool: "run_shell",
      args: { command: "npm publish" },
      cwd: approvedWorkspace,
      sessionId: "headless-local-1",
      targetEnv: "local",
      policyVersion: approvedPolicyVersion,
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

    const decision = await decisionPromise;
    expect(decision, JSON.stringify(bridge.getSecurityErrors())).toMatchObject({
      approved: true,
      via: "remote",
    });
    await expect(
      bridge.consumeAuthorization(decision.authorization, {
        tool: "run_shell",
        action: "high-risk",
        args: { command: "npm publish" },
        workspace: approvedWorkspace,
        session: "headless-local-1",
        targetEnv: "local",
        policyVersion: approvedPolicyVersion,
      }),
    ).rejects.toThrow(/does not match the dispatch operation/);
    // A pure tuple mismatch does not burn the lease handle. The approved tuple
    // remains retryable until the first online consume attempt.
    await expect(
      bridge.consumeAuthorization(decision.authorization, {
        tool: "run_shell",
        action: null,
        args: { command: "npm publish" },
        workspace: approvedWorkspace,
        session: "headless-local-1",
        targetEnv: "local",
        policyVersion: approvedPolicyVersion,
      }),
    ).resolves.toBe(true);
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
    const decision = bridge.requestDecision({
      tool: "run_shell",
      action: "push",
      detail: "git push origin main",
      operationArgs: { command: "git push origin main" },
    });
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
    await expect(
      confirmer({ tool: "run_shell", args: { command: "echo local" } }),
    ).resolves.toBe(true);
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

  it("cancels the ACKed lease and exact approval record when the approval CAS fails", async () => {
    const stateError = Object.assign(new Error("approval CAS unavailable"), {
      code: "CC_TEST_APPROVAL_CAS_UNAVAILABLE",
    });
    const resolveRequest = bridge._approvalStore.resolveRequest.bind(
      bridge._approvalStore,
    );
    vi.spyOn(bridge._approvalStore, "resolveRequest")
      .mockImplementationOnce(() => {
        throw stateError;
      })
      .mockImplementation(resolveRequest);
    const ask = waitForEvent(
      device,
      (message) =>
        message.type === "remote-session-event" &&
        message.event?.type === "permission.request",
    );
    const decision = bridge.requestDecision({
      tool: "run_shell",
      detail: "echo approval-cas-failure",
      operationArgs: { command: "echo approval-cas-failure" },
    });
    const request = await ask;

    await device.request("remote-session-publish", {
      remoteSessionId: bridge.remoteSessionId,
      commandId: "dev-cmd-approval-cas-failure",
      event: approvalResolveEvent(request, true),
    });

    await expect(decision).resolves.toEqual({
      approved: false,
      via: "state-error",
      from: null,
      errorCode: "CC_TEST_APPROVAL_CAS_UNAVAILABLE",
    });
    expectStateFailureCleanup(request);
  });

  it("cancels and reconciles a lease when lease.created adoption fails", async () => {
    const stateError = Object.assign(new Error("created receipt unavailable"), {
      code: "CC_TEST_CREATED_ADOPT_UNAVAILABLE",
    });
    const hostStore = bridge._requireMembershipHostStore();
    const adopt = hostStore.adopt.bind(hostStore);
    let failed = false;
    vi.spyOn(hostStore, "adopt").mockImplementation((statement, options) => {
      if (!failed && options?.expectedKind === "lease.created") {
        failed = true;
        throw stateError;
      }
      return adopt(statement, options);
    });
    const ask = waitForEvent(
      device,
      (message) =>
        message.type === "remote-session-event" &&
        message.event?.type === "permission.request",
    );
    const decision = bridge.requestDecision({
      tool: "run_shell",
      detail: "echo created-adopt-failure",
      operationArgs: { command: "echo created-adopt-failure" },
    });
    const request = await ask;

    await device.request("remote-session-publish", {
      remoteSessionId: bridge.remoteSessionId,
      commandId: "dev-cmd-created-adopt-failure",
      event: approvalResolveEvent(request, true),
    });

    await expect(decision).resolves.toEqual({
      approved: false,
      via: "state-error",
      from: null,
      errorCode: "CC_TEST_CREATED_ADOPT_UNAVAILABLE",
    });
    expectStateFailureCleanup(request);
  });

  it("cancels an ACKed lease when the ACK response outcome is lost", async () => {
    const stateError = Object.assign(new Error("ACK response lost"), {
      code: "CC_TEST_ACK_OUTCOME_UNKNOWN",
    });
    const requestRpc = bridge.client.request.bind(bridge.client);
    let failed = false;
    vi.spyOn(bridge.client, "request").mockImplementation(
      async (method, payload) => {
        const response = await requestRpc(method, payload);
        if (!failed && method === "remote-session-lease-ack") {
          failed = true;
          throw stateError;
        }
        return response;
      },
    );
    const ask = waitForEvent(
      device,
      (message) =>
        message.type === "remote-session-event" &&
        message.event?.type === "permission.request",
    );
    const decision = bridge.requestDecision({
      tool: "run_shell",
      detail: "echo ack-outcome-unknown",
      operationArgs: { command: "echo ack-outcome-unknown" },
    });
    const request = await ask;

    await device.request("remote-session-publish", {
      remoteSessionId: bridge.remoteSessionId,
      commandId: "dev-cmd-ack-outcome-unknown",
      event: approvalResolveEvent(request, true),
    });

    await expect(decision).resolves.toEqual({
      approved: false,
      via: "state-error",
      from: null,
      errorCode: "CC_TEST_ACK_OUTCOME_UNKNOWN",
    });
    expectStateFailureCleanup(request);
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
    await expect(race).resolves.toMatchObject({
      approved: true,
      via: "remote",
    });
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

  it("recovers the durable session and ACKed lease after a server restart while a lost pending ask denies", async () => {
    const command = "echo restart-authorized";
    const { decision } = await approveShell({
      command,
      commandId: "dev-cmd-restart-approved",
    });
    expect(decision).toMatchObject({
      approved: true,
      authorizationRequired: true,
    });
    const ackedBefore = bridge
      ._requireMembershipHostStore()
      .inspect()
      .leases.find((lease) => lease.status === "acked");
    expect(ackedBefore).toBeDefined();

    let lostPendingRequestId = null;
    const lostPending = bridge.requestDecision({
      tool: "run_shell",
      detail: "echo lost-pending",
      operationArgs: { command: "echo lost-pending" },
      timeoutMs: 200,
      onRequestId: (requestId) => {
        lostPendingRequestId = requestId;
      },
    });
    // The durable issue callback is synchronous and precedes the asynchronous
    // membership refresh/publish. Assert that exact pending card instead of
    // racing its 200 ms expiry against delivery to the device on a loaded CI
    // runner. Other cases above cover the full publish/resolve path; this case
    // specifically crashes the transport with a real durable card in flight.
    expect(lostPendingRequestId).toMatch(/^ra-/);
    expect(
      bridge._approvalStore.getRequest(lostPendingRequestId, {
        bestEffort: false,
      }),
    ).toMatchObject({
      requestId: lostPendingRequestId,
      status: "pending",
      revision: 1,
    });

    const sessionId = bridge.remoteSessionId;
    device.close();
    device = null;
    await server.stop();
    server = null;
    const lostDecision = await lostPending;
    expect(lostDecision).toMatchObject({
      approved: false,
      from: null,
    });
    // Depending on whether the in-flight membership refresh observes the
    // socket close before the deadline, the bridge reports a state error or a
    // timeout. Both paths must durably remove authority and fail closed.
    expect(["state-error", "timeout"]).toContain(lostDecision.via);
    expect(
      bridge._approvalStore.getRequest(lostPendingRequestId, {
        bestEffort: false,
      }),
    ).toMatchObject({
      requestId: lostPendingRequestId,
      status: expect.stringMatching(/^(cancelled|expired)$/),
      revision: 2,
    });
    // This was a transport/server crash, not a host-requested session close.
    // Drop the dead bridge without calling close(), which would durably close
    // the session by design.
    bridge = null;

    server2 = new ChainlessChainWSServer({
      port: 0,
      host: "127.0.0.1",
      token: TOKEN,
      remoteMembershipCoordinatorOptions: coordinatorOptions(),
    });
    await server2.start();
    bridge2 = new RemoteApprovalBridge(bridgeOptions(server2.port));
    await bridge2.start();

    expect(bridge2.remoteSessionId).toBe(sessionId);
    const hostAfterRestart = bridge2._requireMembershipHostStore().inspect();
    expect(hostAfterRestart.bootstrap.sessionId).toBe(sessionId);
    expect(hostAfterRestart.leases).toContainEqual(
      expect.objectContaining({
        leaseId: ackedBefore.leaseId,
        status: "acked",
        requestId: ackedBefore.requestId,
        fingerprint: ackedBefore.fingerprint,
        binding: ackedBefore.binding,
      }),
    );
    const coordinatorAfterRestart = server2
      ._requireRemoteMembershipCoordinator()
      .snapshotSession(sessionId).session;
    expect(coordinatorAfterRestart.leases).toContainEqual(
      expect.objectContaining({
        leaseId: ackedBefore.leaseId,
        status: "acked",
      }),
    );

    await expect(
      bridge2.consumeAuthorization(decision.authorization, {
        tool: "run_shell",
        action: null,
        args: { command },
        workspace: null,
        session: "headless-local-1",
        targetEnv: null,
        policyVersion: null,
      }),
    ).resolves.toBe(true);
    expect(
      server2
        ._requireRemoteMembershipCoordinator()
        .snapshotSession(sessionId)
        .session.leases.find((lease) => lease.leaseId === ackedBefore.leaseId),
    ).toMatchObject({ status: "consumed" });
    expect(
      bridge2
        ._requireMembershipHostStore()
        .inspect()
        .leases.find((lease) => lease.leaseId === ackedBefore.leaseId),
    ).toMatchObject({ status: "consumed" });
  });

  it("linearizes consume against a revoke from a second WS server and rejects the revoked device's late result", async () => {
    server2 = new ChainlessChainWSServer({
      port: 0,
      host: "127.0.0.1",
      token: TOKEN,
      remoteMembershipCoordinatorOptions: coordinatorOptions(),
    });
    await server2.start();
    bridge2 = new RemoteApprovalBridge(bridgeOptions(server2.port));
    await bridge2.start();

    const command = "echo revoke-race";
    const { decision } = await approveShell({
      command,
      commandId: "dev-cmd-revoke-race",
    });
    const ackedLease = bridge
      ._requireMembershipHostStore()
      .inspect()
      .leases.find((lease) => lease.status === "acked");
    expect(ackedLease).toBeDefined();

    const lateAskSeen = waitForEvent(
      device,
      (message) =>
        message.type === "remote-session-event" &&
        message.event?.type === "permission.request",
    );
    const lateDecision = bridge.requestDecision({
      tool: "run_shell",
      detail: "echo late-result",
      operationArgs: { command: "echo late-result" },
      timeoutMs: 250,
    });
    const lateRequest = await lateAskSeen;

    const [consumeResult, revokeResult] = await Promise.allSettled([
      bridge.consumeAuthorization(decision.authorization, {
        tool: "run_shell",
        action: null,
        args: { command },
        workspace: null,
        session: "headless-local-1",
        targetEnv: null,
        policyVersion: null,
      }),
      bridge2.revokeMember(devicePrincipalId),
    ]);

    expect(
      revokeResult.status,
      revokeResult.status === "rejected"
        ? revokeResult.reason?.stack || revokeResult.reason?.message
        : undefined,
    ).toBe("fulfilled");
    const finalSnapshot = server2
      ._requireRemoteMembershipCoordinator()
      .snapshotSession(bridge2.remoteSessionId).session;
    expect(
      finalSnapshot.members.find(
        (member) => member.principalId === devicePrincipalId,
      ),
    ).toMatchObject({ status: "revoked" });
    const terminalLease = finalSnapshot.leases.find(
      (lease) => lease.leaseId === ackedLease.leaseId,
    );
    expect(["consumed", "cancelled"]).toContain(terminalLease.status);
    if (consumeResult.status === "fulfilled") {
      expect(consumeResult.value).toBe(true);
      expect(terminalLease.status).toBe("consumed");
    } else {
      expect(consumeResult.reason).toBeInstanceOf(Error);
    }
    expect(
      bridge2._requireMembershipHostStore().inspect().lastAuthorityGeneration,
    ).toBe(finalSnapshot.authorityGeneration);

    await expect(
      device.request("remote-session-publish", {
        remoteSessionId: bridge2.remoteSessionId,
        commandId: "dev-cmd-late-after-revoke",
        event: approvalResolveEvent(lateRequest, true),
      }),
    ).rejects.toThrow(/membership coordinator denied|revoked|not paired/i);
    await expect(lateDecision).resolves.toMatchObject({
      approved: false,
      via: "timeout",
    });
  });
});
