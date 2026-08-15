/**
 * RemoteApprovalBridge §8.2 cross-device operation fingerprint. Drives the
 * bridge offline (no WS server): `_publish` is overridden to capture the
 * permission.request so the test can echo the SAME durable capability tuple
 * back. Missing / mismatched / stale / expired resolutions fail closed.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import { RemoteApprovalBridge } from "../../src/lib/remote-approval-bridge.js";
import { computeOperationFingerprint } from "../../src/lib/operation-fingerprint.js";
import {
  createRemoteMembershipPrincipalCredential,
  DurableRemoteMembershipCoordinator,
  REMOTE_MEMBERSHIP_COORDINATOR_UNAVAILABLE_CODE,
  REMOTE_MEMBERSHIP_COORDINATOR_VERSION,
  signRemoteMembershipAuthenticationChallenge,
} from "../../src/lib/remote-membership-coordinator.js";
import {
  DurableRemoteMembershipHostStore,
  REMOTE_MEMBERSHIP_HOST_ROLLBACK_CODE,
} from "../../src/lib/remote-membership-host-store.js";

const bridges = [];
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(bridges.splice(0).map((bridge) => bridge.close()));
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function createCoordinator(paths, clock) {
  return new DurableRemoteMembershipCoordinator({
    ...paths,
    now: clock,
  });
}

function joinDevice(membership) {
  const challenge = membership.coordinator.issueMemberJoinChallenge({
    sessionId: membership.created.sessionId,
    expectedSessionEpoch: membership.created.sessionEpoch,
    scopes: ["observe", "approve"],
    capabilities: ["approval-binding-v1"],
    credentialPublicKey: membership.deviceCredential.publicKey,
    connectionNonce: "offline-device-connection",
  });
  const joined = membership.coordinator.joinMember({
    challengeId: challenge.challengeId,
    connectionNonce: "offline-device-connection",
    signature: signRemoteMembershipAuthenticationChallenge(
      challenge,
      membership.deviceCredential.privateKeyPkcs8,
    ),
  });
  membership.hostStore.adopt(joined.statement, {
    expectedKind: "session.snapshot",
    expectedSessionId: membership.created.sessionId,
  });
  membership.joined = joined;
  return joined;
}

function revokeDevice(membership) {
  const revoked = membership.coordinator.revokeMember({
    sessionId: membership.created.sessionId,
    principalId: membership.joined.principalId,
    hostPrincipalId: membership.created.hostPrincipalId,
    expectedSessionEpoch: membership.created.sessionEpoch,
    expectedMembershipEpoch: membership.joined.membershipEpoch,
    expectedHostMembershipEpoch: membership.created.membershipEpoch,
  });
  membership.hostStore.adopt(revoked.statement, {
    expectedKind: "session.snapshot",
    expectedSessionId: membership.created.sessionId,
  });
  return revoked;
}

function makeBridge(now, options = {}) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-remote-approval-"),
  );
  temporaryDirectories.push(directory);
  const clock = now || Date.now;
  const coordinatorPaths = {
    stateFile: path.join(directory, "coordinator", "state.json"),
    keyFile: path.join(directory, "coordinator", "key.json"),
    witnessFile: path.join(directory, "coordinator", "witness.json"),
  };
  const coordinator = createCoordinator(coordinatorPaths, clock);
  const hostPaths = {
    agentSessionId: "offline-1",
    stateFile: path.join(directory, "host", "state.json"),
    witnessFile: path.join(directory, "host", "witness.json"),
  };
  const hostStore = new DurableRemoteMembershipHostStore({
    ...hostPaths,
    now: clock,
  });
  const hostCredential = createRemoteMembershipPrincipalCredential();
  const created = coordinator.createSession({
    sessionId: "rs-1",
    agentSessionId: "offline-1",
    scopes: ["observe", "prompt", "approve", "interrupt"],
    expiresAt: clock() + 100_000_000,
    hostCredentialPublicKeySpki: hostCredential.publicKey,
  });
  hostStore.pinTrust(created.trust);
  hostStore.recordBootstrap({
    coordinatorId: created.trust.coordinatorId,
    sessionId: created.sessionId,
    agentSessionId: "offline-1",
    hostPrincipalId: created.hostPrincipalId,
    hostCredentialPublicKeySpki: created.hostCredentialPublicKeySpki,
    hostCredentialPrivateKeyPkcs8: hostCredential.privateKeyPkcs8,
    statement: created.statement,
  });
  hostStore.adopt(created.statement, {
    expectedKind: "session.snapshot",
    expectedSessionId: created.sessionId,
  });
  const membership = {
    coordinator,
    coordinatorPaths,
    hostStore,
    hostPaths,
    hostCredential,
    deviceCredential: createRemoteMembershipPrincipalCredential(),
    created,
    joined: null,
    clock,
  };
  joinDevice(membership);
  const bridge = new RemoteApprovalBridge({
    wsUrl: "ws://127.0.0.1:1",
    agentSessionId: "offline-1",
    approvalStateFile: path.join(directory, "approval-state.json"),
    membershipHostStore: hostStore,
    ...(now ? { now } : {}),
    ...options,
  });
  bridge.remoteSessionId = "rs-1"; // pretend a session is registered
  bridge._testMembership = membership;
  bridge.client = {
    async request(type, payload = {}) {
      const current = bridge._testMembership;
      if (type === "remote-session-membership-snapshot") {
        return current.coordinator.snapshotSession(created.sessionId);
      }
      if (type === "remote-session-lease-ack") {
        return current.coordinator.ackApprovalLease({
          sessionId: created.sessionId,
          leaseId: payload.leaseId,
          hostPrincipalId: created.hostPrincipalId,
          expectedHostMembershipEpoch: created.membershipEpoch,
          expectedCreatedGeneration: payload.expectedCreatedGeneration,
          hostReceiptDigest: payload.hostReceiptDigest,
        });
      }
      if (type === "remote-session-lease-cancel") {
        return current.coordinator.cancelApprovalLease({
          sessionId: created.sessionId,
          leaseId: payload.leaseId,
          hostPrincipalId: created.hostPrincipalId,
          expectedHostMembershipEpoch: created.membershipEpoch,
          reason: payload.reason,
        });
      }
      if (type === "remote-session-close") return { closed: true };
      throw new Error(`Unexpected offline RPC: ${type}`);
    },
    close() {},
  };
  bridge._captured = [];
  bridge._publish = (event) => bridge._captured.push(event);
  bridges.push(bridge);
  return bridge;
}

function lastRequest(bridge) {
  return [...bridge._captured]
    .reverse()
    .find((e) => e.type === "permission.request");
}

async function waitForRequest(
  bridge,
  { afterRequestId = null, timeoutMs = 1_000 } = {},
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const request = lastRequest(bridge);
    if (request && request.requestId !== afterRequestId) return request;
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for offline permission.request");
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function requestAndCapture(bridge, options) {
  const previousRequestId = lastRequest(bridge)?.requestId || null;
  const decision = bridge.requestDecision(options);
  return {
    decision,
    request: await waitForRequest(bridge, {
      afterRequestId: previousRequestId,
    }),
  };
}

function resolveFrame(
  bridge,
  request,
  extra = {},
  frameExtra = {},
  { skipLease = false, approvalLeaseStatement = null } = {},
) {
  const requestId = typeof request === "string" ? request : request?.requestId;
  const tuple =
    request && typeof request === "object"
      ? {
          fingerprint: request.fingerprint,
          binding: request.binding,
          revision: request.revision,
        }
      : {};
  const event = {
    type: "approval.resolve",
    requestId,
    answer: true,
    ...tuple,
    ...extra,
  };
  const membership = bridge._testMembership;
  const from = frameExtra.from || membership.joined.principalId;
  const membershipEpoch =
    frameExtra.membershipEpoch || membership.joined.membershipEpoch;
  let leaseStatement = approvalLeaseStatement;
  const approved =
    event.answer === true || event.answer === "true" || event.answer === "yes";
  if (approved && !skipLease && !leaseStatement) {
    leaseStatement = membership.coordinator.createApprovalLease({
      sessionId: membership.created.sessionId,
      sessionEpoch: membership.created.sessionEpoch,
      principalId: from,
      membershipEpoch,
      hostPrincipalId: membership.created.hostPrincipalId,
      requestId,
      fingerprint: event.fingerprint,
      binding: event.binding,
      expiresAt: request?.notAfter,
    }).statement;
  }
  return {
    type: "remote-session-control",
    remoteSessionId: "rs-1",
    agentSessionId: "offline-1",
    from,
    membershipAuthority: REMOTE_MEMBERSHIP_COORDINATOR_VERSION,
    sessionEpoch: membership.created.sessionEpoch,
    membershipEpoch,
    ...(leaseStatement ? { approvalLeaseStatement: leaseStatement } : {}),
    ...frameExtra,
    event,
  };
}

// "did the decision settle within a beat?" — deterministic non-settlement check.
async function raced(decision) {
  return Promise.race([
    decision.then((d) => ({ settled: true, d })),
    new Promise((r) => setTimeout(() => r({ settled: false }), 40)),
  ]);
}

describe("remote approval fingerprint binding (§8.2 full tuple)", () => {
  it("settles when the resolve echoes the published fingerprint", async () => {
    const bridge = makeBridge();
    const { decision, request } = await requestAndCapture(bridge, {
      tool: "run_shell",
      detail: "npm publish",
      operationArgs: { command: "npm publish" },
      timeoutMs: 5000,
    });
    expect(request.fingerprint).toMatch(/^opf_[0-9a-f]{40}$/);
    await bridge._onServerEvent(resolveFrame(bridge, request));
    await expect(decision).resolves.toMatchObject({
      approved: true,
      via: "remote",
    });
    expect(
      bridge._approvalStore.getRequest(request.requestId, {
        bestEffort: false,
      }).resolvedAuthority,
    ).toContain(
      `membership-epoch=${bridge._testMembership.joined.membershipEpoch}`,
    );
  });

  it("performs the durable approval CAS only after the signed lease is ACKed", async () => {
    const bridge = makeBridge();
    let observedAckedLease = false;
    const resolveRequest = bridge._approvalStore.resolveRequest.bind(
      bridge._approvalStore,
    );
    bridge._approvalStore.resolveRequest = (...args) => {
      const coordinatorLease = bridge._testMembership.coordinator
        .snapshotSession("rs-1")
        .session.leases.find((lease) => lease.requestId === args[0]);
      const hostLease = bridge._testMembership.hostStore
        .inspect()
        .leases.find((lease) => lease.requestId === args[0]);
      expect(coordinatorLease?.status).toBe("acked");
      expect(hostLease?.status).toBe("acked");
      observedAckedLease = true;
      return resolveRequest(...args);
    };
    const { decision, request } = await requestAndCapture(bridge, {
      tool: "run_shell",
      detail: "npm publish",
      operationArgs: { command: "npm publish" },
      timeoutMs: 5_000,
    });

    await bridge._onServerEvent(resolveFrame(bridge, request));

    await expect(decision).resolves.toMatchObject({ approved: true });
    expect(observedAckedLease).toBe(true);
  });

  it("rejects a resolve whose fingerprint is for a DIFFERENT operation", async () => {
    const bridge = makeBridge();
    const { decision, request } = await requestAndCapture(bridge, {
      tool: "run_shell",
      detail: "npm publish",
      operationArgs: { command: "npm publish" },
      timeoutMs: 5_000,
    });
    const wrong = computeOperationFingerprint({
      toolName: "run_shell",
      params: { command: "rm -rf /" },
      session: "offline-1",
      notBefore: request.notBefore,
      notAfter: request.notAfter,
    });
    await bridge._onServerEvent(
      resolveFrame(bridge, request, { fingerprint: wrong }),
    );
    await expect(decision).resolves.toEqual({
      approved: false,
      via: "state-error",
      from: null,
      errorCode: REMOTE_MEMBERSHIP_COORDINATOR_UNAVAILABLE_CODE,
    });
    expect(
      bridge._approvalStore.getRequest(request.requestId, {
        bestEffort: false,
      }),
    ).toMatchObject({ status: "cancelled", revision: 2 });
    expect(bridge.getSecurityErrors()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requestId: request.requestId,
          reason:
            "lease-adopt-or-ack-failed:Signed remote execution lease does not match the pending operation",
        }),
      ]),
    );
  });

  it("rejects a resolve bound to a DIFFERENT session (stale context)", async () => {
    const bridge = makeBridge();
    const { decision, request } = await requestAndCapture(bridge, {
      tool: "run_shell",
      detail: "git push",
      operationArgs: { command: "git push" },
      timeoutMs: 5_000,
    });
    // Same tool/params but a fingerprint computed for another session must not
    // match this ask's card.
    const otherSession = computeOperationFingerprint({
      toolName: "run_shell",
      params: { command: "git push" },
      session: "someone-elses-session",
      notBefore: request.notBefore,
      notAfter: request.notAfter,
    });
    expect(otherSession).not.toBe(request.fingerprint);
    await bridge._onServerEvent(
      resolveFrame(bridge, request, { fingerprint: otherSession }),
    );
    await expect(decision).resolves.toEqual({
      approved: false,
      via: "state-error",
      from: null,
      errorCode: REMOTE_MEMBERSHIP_COORDINATOR_UNAVAILABLE_CODE,
    });
    expect(bridge.getSecurityErrors()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requestId: request.requestId,
          reason:
            "lease-adopt-or-ack-failed:Signed remote execution lease does not match the pending operation",
        }),
      ]),
    );
  });

  it("rejects a legacy resolve that omits the durable capability tuple", async () => {
    const bridge = makeBridge();
    const { decision, request } = await requestAndCapture(bridge, {
      tool: "run_shell",
      action: "high-risk",
      detail: "git push",
      operationArgs: { command: "git push" },
      timeoutMs: 5_000,
    });
    const frame = resolveFrame(bridge, request);
    delete frame.event.fingerprint;
    delete frame.event.binding;
    delete frame.event.revision;
    await bridge._onServerEvent(frame);
    await expect(decision).resolves.toEqual({
      approved: false,
      via: "state-error",
      from: null,
      errorCode: REMOTE_MEMBERSHIP_COORDINATOR_UNAVAILABLE_CODE,
    });
    expect(bridge.getSecurityErrors()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "approval.resolve",
          requestId: request.requestId,
          reason:
            "lease-adopt-or-ack-failed:Signed remote execution lease does not match the pending operation",
        }),
      ]),
    );
  });

  it("rejects a server frame that omits its durable membership binding", async () => {
    const bridge = makeBridge();
    const { decision, request } = await requestAndCapture(bridge, {
      tool: "run_shell",
      timeoutMs: 5_000,
    });
    const frame = resolveFrame(bridge, request, {}, {}, { skipLease: true });
    delete frame.membershipEpoch;
    await bridge._onServerEvent(frame);

    await expect(decision).resolves.toEqual({
      approved: false,
      via: "timeout",
      from: null,
    });
    expect(bridge.getSecurityErrors()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: "membership-binding-required" }),
      ]),
    );
  }, 15_000);

  it("fences a late forwarded approval after durable member revocation", async () => {
    const bridge = makeBridge();
    const { decision, request } = await requestAndCapture(bridge, {
      tool: "run_shell",
      detail: "deploy",
      operationArgs: { command: "deploy" },
      timeoutMs: 5_000,
    });
    const lateFrame = resolveFrame(bridge, request);
    revokeDevice(bridge._testMembership);

    await bridge._onServerEvent(lateFrame);
    await bridge._onServerEvent(lateFrame);

    expect(
      bridge._approvalStore.getRequest(request.requestId, {
        bestEffort: false,
      }),
    ).toMatchObject({ status: "cancelled", revision: 2 });

    await expect(decision).resolves.toEqual({
      approved: false,
      via: "state-error",
      from: null,
      errorCode: REMOTE_MEMBERSHIP_HOST_ROLLBACK_CODE,
    });
    expect(
      bridge._testMembership.coordinator
        .snapshotSession("rs-1")
        .session.leases.find((lease) => lease.requestId === request.requestId),
    ).toMatchObject({ status: "cancelled" });
    expect(bridge.getSecurityErrors()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requestId: request.requestId,
          reason: expect.stringMatching(
            /^lease-adopt-or-ack-failed:Remote membership host rollback detected:/,
          ),
        }),
      ]),
    );
  });

  it("rejects an out-of-order old epoch after rejoin but accepts the new epoch", async () => {
    const bridge = makeBridge();
    const first = await requestAndCapture(bridge, {
      tool: "run_shell",
      detail: "deploy",
      operationArgs: { command: "deploy" },
      timeoutMs: 5_000,
    });
    const oldEpoch = bridge._testMembership.joined.membershipEpoch;
    const oldFrame = resolveFrame(bridge, first.request);
    revokeDevice(bridge._testMembership);
    const rejoined = joinDevice(bridge._testMembership);
    expect(rejoined.membershipEpoch).not.toBe(oldEpoch);

    await bridge._onServerEvent(oldFrame);
    await expect(first.decision).resolves.toEqual({
      approved: false,
      via: "state-error",
      from: null,
      errorCode: REMOTE_MEMBERSHIP_HOST_ROLLBACK_CODE,
    });

    const second = await requestAndCapture(bridge, {
      tool: "run_shell",
      detail: "deploy",
      operationArgs: { command: "deploy" },
      timeoutMs: 5_000,
    });
    await bridge._onServerEvent(resolveFrame(bridge, second.request));

    await expect(second.decision).resolves.toMatchObject({
      approved: true,
      via: "remote",
      from: bridge._testMembership.joined.principalId,
    });
    expect(bridge.getSecurityErrors()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: expect.stringMatching(
            /^lease-adopt-or-ack-failed:Remote membership host rollback detected:/,
          ),
        }),
      ]),
    );
  });

  it("rechecks durable membership after the coordinator restarts", async () => {
    const bridge = makeBridge();
    const { decision, request } = await requestAndCapture(bridge, {
      tool: "run_shell",
      detail: "deploy",
      operationArgs: { command: "deploy" },
      timeoutMs: 5_000,
    });
    bridge._testMembership.coordinator = createCoordinator(
      bridge._testMembership.coordinatorPaths,
      bridge._testMembership.clock,
    );

    await bridge._onServerEvent(resolveFrame(bridge, request));

    await expect(decision).resolves.toMatchObject({
      approved: true,
      via: "remote",
    });
  });

  it("settles fail-closed when durable membership state is unavailable", async () => {
    const stateError = new Error("simulated membership lock failure");
    stateError.code = REMOTE_MEMBERSHIP_COORDINATOR_UNAVAILABLE_CODE;
    const bridge = makeBridge();
    const { decision, request } = await requestAndCapture(bridge, {
      tool: "run_shell",
      detail: "deploy",
      operationArgs: { command: "deploy" },
      timeoutMs: 5_000,
    });
    const frame = resolveFrame(bridge, request);
    bridge._membershipHostStore = {
      adopt() {
        throw stateError;
      },
      requireConsumableLease() {
        throw stateError;
      },
    };
    await bridge._onServerEvent(frame);

    await expect(decision).resolves.toEqual({
      approved: false,
      via: "state-error",
      from: null,
      errorCode: REMOTE_MEMBERSHIP_COORDINATOR_UNAVAILABLE_CODE,
    });
  });

  it("rejects a resolve after the validity window expired", async () => {
    let clock = 1000;
    const bridge = makeBridge(() => clock);
    // Huge real timeout so the wall-clock timer never fires during the test; the
    // INJECTED clock drives the validity window.
    const { decision, request } = await requestAndCapture(bridge, {
      tool: "run_shell",
      detail: "deploy",
      operationArgs: { command: "deploy" },
      timeoutMs: 10_000_000,
    });
    // Jump the injected clock past notAfter, then resolve with the right fp.
    clock = request.notAfter + 1;
    await bridge._onServerEvent(
      resolveFrame(bridge, request, { answer: false }, {}, { skipLease: true }),
    );
    const outcome = await raced(decision);
    expect(outcome.settled).toBe(false); // expired card never settled the gate
  });

  it("publishes fingerprint + short id + secret-free summary on the request", async () => {
    const bridge = makeBridge();
    const { request: req } = await requestAndCapture(bridge, {
      tool: "run_shell",
      detail: "npm publish",
      operationArgs: { command: "npm publish" },
      timeoutMs: 5000,
    });
    expect(req.fingerprint).toMatch(/^opf_[0-9a-f]{40}$/);
    expect(req.binding).toMatch(/^ab_[0-9a-f]{32}$/);
    expect(req.revision).toBe(1);
    expect(req.shortId).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
    // Summary carries the tool + session coord but NOT the raw command value.
    expect(req.summary).toContain("run_shell");
    expect(req.summary).toContain("sess:offline-1");
    expect(req.summary).not.toContain("npm publish");
    // The raw command still rides `detail` (the human legitimately sees it).
    expect(req.detail).toBe("npm publish");
    expect(typeof req.notBefore).toBe("number");
    expect(req.notAfter).toBeGreaterThan(req.notBefore);
    expect(
      bridge._approvalStore.getRequest(req.requestId, {
        bestEffort: false,
      }),
    ).toMatchObject({
      fingerprint: req.fingerprint,
      binding: req.binding,
      revision: req.revision,
      status: "pending",
    });
  });

  it("does not publish a card when durable issue fails", async () => {
    const error = new Error("lock unavailable");
    error.code = "CC_APPROVAL_STATE_LOCK_UNAVAILABLE";
    const bridge = makeBridge(null, {
      approvalStore: {
        issueRequest() {
          throw error;
        },
        resolveRequest() {
          throw error;
        },
        cancelRequest() {
          throw error;
        },
      },
    });
    let requestIdObserved = false;

    await expect(
      bridge.requestDecision({
        tool: "run_shell",
        detail: "do-not-log-this-secret",
        onRequestId: () => {
          requestIdObserved = true;
        },
      }),
    ).resolves.toEqual({
      approved: false,
      via: "state-error",
      from: null,
      errorCode: "CC_APPROVAL_STATE_LOCK_UNAVAILABLE",
    });
    expect(requestIdObserved).toBe(false);
    expect(lastRequest(bridge)).toBeUndefined();
    expect(JSON.stringify(bridge.getSecurityErrors())).not.toContain(
      "do-not-log-this-secret",
    );
  });

  it("denies when the resolve CAS cannot be durably written", async () => {
    const bridge = makeBridge();
    const { decision, request } = await requestAndCapture(bridge, {
      tool: "run_shell",
      detail: "another-secret-command",
      operationArgs: { command: "another-secret-command" },
      timeoutMs: 5000,
    });
    bridge._approvalStore._beforeRename = () => {
      throw new Error("simulated disk failure");
    };

    await bridge._onServerEvent(resolveFrame(bridge, request));

    await expect(decision).resolves.toEqual({
      approved: false,
      via: "state-error",
      from: null,
      errorCode: "CC_APPROVAL_STATE_WRITE_FAILED",
    });
    expect(bridge.getSecurityErrors()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "approval.resolve",
          requestId: request.requestId,
          reason: "state-unavailable",
          errorCode: "CC_APPROVAL_STATE_WRITE_FAILED",
        }),
      ]),
    );
    expect(JSON.stringify(bridge.getSecurityErrors())).not.toContain(
      "another-secret-command",
    );
  });
});
