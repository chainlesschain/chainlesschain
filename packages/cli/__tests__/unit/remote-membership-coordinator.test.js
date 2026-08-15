import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  RemoteSessionCryptoContext,
  remoteSessionPairingTokenDigest,
} from "../../src/harness/remote-session-crypto.js";
import {
  createRemoteMembershipPrincipalCredential,
  DurableRemoteMembershipCoordinator,
  REMOTE_MEMBERSHIP_COORDINATOR_ROLLBACK_CODE,
  REMOTE_MEMBERSHIP_COORDINATOR_UNAVAILABLE_CODE,
  _remoteMembershipCoordinatorInternals,
  signRemoteMembershipAuthenticationChallenge,
} from "../../src/lib/remote-membership-coordinator.js";
import {
  DurableRemoteMembershipHostStore,
  REMOTE_MEMBERSHIP_HOST_ROLLBACK_CODE,
  REMOTE_MEMBERSHIP_HOST_TRUST_CODE,
  REMOTE_MEMBERSHIP_HOST_UNAVAILABLE_CODE,
} from "../../src/lib/remote-membership-host-store.js";

const roots = [];
const activeWorkers = new Set();
const workerPath = fileURLToPath(
  new URL("../fixtures/remote-membership-worker.mjs", import.meta.url),
);

function makeRoot(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

function fixture() {
  const coordinatorRoot = makeRoot("cc-membership-coordinator-");
  const hostRoot = makeRoot("cc-membership-host-");
  let now = 1_000;
  const paths = {
    stateFile: path.join(coordinatorRoot, "state", "coordinator.json"),
    keyFile: path.join(coordinatorRoot, "key", "ed25519.json"),
    witnessFile: path.join(coordinatorRoot, "witness", "head.json"),
  };
  const coordinator = new DurableRemoteMembershipCoordinator({
    ...paths,
    now: () => now,
  });
  const hostPaths = {
    agentSessionId: "agent-1",
    stateFile: path.join(hostRoot, "state", "receipts.json"),
    witnessFile: path.join(hostRoot, "witness", "head.json"),
  };
  const host = new DurableRemoteMembershipHostStore({
    ...hostPaths,
    now: () => now,
  });
  return {
    coordinatorRoot,
    hostRoot,
    coordinator,
    coordinatorPaths: paths,
    host,
    hostPaths,
    setNow(value) {
      now = value;
    },
    getNow() {
      return now;
    },
  };
}

function createSession(
  fixtureValue,
  { sessionId = "remote-1", joinPolicy = null } = {},
) {
  const hostCredential = createRemoteMembershipPrincipalCredential();
  const created = fixtureValue.coordinator.createSession({
    sessionId,
    agentSessionId: "agent-1",
    scopes: ["observe", "prompt", "approve", "interrupt"],
    expiresAt: 100_000,
    hostCredentialPublicKeySpki: hostCredential.publicKey,
    joinPolicy,
  });
  fixtureValue.host.pinTrust(created.trust);
  fixtureValue.host.recordBootstrap({
    coordinatorId: created.trust.coordinatorId,
    sessionId: created.sessionId,
    agentSessionId: "agent-1",
    hostPrincipalId: created.hostPrincipalId,
    hostCredentialPublicKeySpki: created.hostCredentialPublicKeySpki,
    hostCredentialPrivateKeyPkcs8: hostCredential.privateKeyPkcs8,
    statement: created.statement,
  });
  fixtureValue.host.adopt(created.statement, {
    expectedKind: "session.snapshot",
    expectedSessionId: created.sessionId,
  });
  return Object.freeze({ ...created, hostCredential });
}

function joinDevice(fixtureValue, created) {
  const credential = createRemoteMembershipPrincipalCredential();
  const connectionNonce = "mobile-connection-nonce";
  const challenge = fixtureValue.coordinator.issueMemberJoinChallenge({
    sessionId: created.sessionId,
    expectedSessionEpoch: created.sessionEpoch,
    scopes: ["observe", "approve"],
    capabilities: ["approval-binding-v1"],
    credentialPublicKey: credential.publicKey,
    connectionNonce,
  });
  const joined = fixtureValue.coordinator.joinMember({
    challengeId: challenge.challengeId,
    connectionNonce,
    signature: signRemoteMembershipAuthenticationChallenge(
      challenge,
      credential.privateKeyPkcs8,
    ),
  });
  fixtureValue.host.adopt(joined.statement, {
    expectedKind: "session.snapshot",
    expectedSessionId: created.sessionId,
  });
  return Object.freeze({ ...joined, credential });
}

function createLease(fixtureValue, created, joined, requestId = "request-1") {
  return fixtureValue.coordinator.createApprovalLease({
    sessionId: created.sessionId,
    sessionEpoch: created.sessionEpoch,
    principalId: joined.principalId,
    membershipEpoch: joined.membershipEpoch,
    hostPrincipalId: created.hostPrincipalId,
    requestId,
    fingerprint: `opf_${"a".repeat(40)}`,
    binding: `ab_${"b".repeat(32)}`,
    expiresAt: 20_000,
  });
}

function relayHandshake(
  created,
  authority,
  token = "relay-pairing-token",
  authorizedScopes = ["observe", "approve"],
  now = () => 1_000,
) {
  const hostCrypto = new RemoteSessionCryptoContext({
    sessionId: created.sessionId,
    localPeerId: "host-peer",
    now,
  });
  const mobileCrypto = new RemoteSessionCryptoContext({
    sessionId: created.sessionId,
    localPeerId: "mobile-peer",
  });
  hostCrypto.pairForDurableMembership(
    "mobile-peer",
    mobileCrypto.publicKey,
    token,
    {
      ...authority,
      authorizedScopes,
      expiresAtMs: 10_000,
    },
  );
  mobileCrypto.pair("host-peer", hostCrypto.publicKey, token);
  return { hostCrypto, mobileCrypto, token };
}

function adoptAndAck(fixtureValue, created, issued) {
  const adopted = fixtureValue.host.adopt(issued.statement, {
    expectedKind: "lease.created",
    expectedSessionId: created.sessionId,
  });
  const acked = fixtureValue.coordinator.ackApprovalLease({
    sessionId: created.sessionId,
    leaseId: issued.lease.leaseId,
    hostPrincipalId: created.hostPrincipalId,
    expectedHostMembershipEpoch: created.membershipEpoch,
    expectedCreatedGeneration: issued.lease.createdGeneration,
    hostReceiptDigest: adopted.receiptHash,
  });
  fixtureValue.host.adopt(acked.statement, {
    expectedKind: "lease.acked",
    expectedSessionId: created.sessionId,
  });
  return { adopted, acked };
}

function consumeArgs(created, joined, issued, acked) {
  return {
    sessionId: created.sessionId,
    leaseId: issued.lease.leaseId,
    hostPrincipalId: created.hostPrincipalId,
    expectedHostMembershipEpoch: created.membershipEpoch,
    expectedAckedGeneration: acked.lease.ackedGeneration,
    expectedMembershipEpoch: joined.membershipEpoch,
    requestId: issued.lease.requestId,
    fingerprint: issued.lease.fingerprint,
    binding: issued.lease.binding,
  };
}

function startWorker(payload) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const child = spawn(process.execPath, [workerPath, encoded], {
    cwd: path.dirname(workerPath),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  activeWorkers.add(child);
  let stdout = "";
  let stderr = "";
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf8");
    if (stdout.includes("READY\n")) readyResolve();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  const timeout = setTimeout(() => {
    const error = new Error("remote membership worker timed out");
    readyReject(error);
    child.kill();
  }, 20_000);
  const completed = new Promise((resolve, reject) => {
    child.once("error", (error) => {
      readyReject(error);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      activeWorkers.delete(child);
      if (code !== 0) {
        const error = new Error(`worker exited ${code}: ${stderr}`);
        readyReject(error);
        reject(error);
        return;
      }
      const line = stdout
        .trim()
        .split(/\r?\n/)
        .filter((entry) => entry !== "READY")
        .at(-1);
      resolve(JSON.parse(line));
    });
  });
  return { ready, completed };
}

async function raceWorkers(payloads, barrierFile) {
  const workers = payloads.map((payload) =>
    startWorker({ ...payload, barrierFile }),
  );
  try {
    await Promise.all(workers.map((worker) => worker.ready));
    fs.writeFileSync(barrierFile, "go\n", "utf8");
    return await Promise.all(workers.map((worker) => worker.completed));
  } catch (error) {
    for (const worker of activeWorkers) worker.kill();
    await Promise.allSettled(workers.map((worker) => worker.completed));
    throw error;
  }
}

afterEach(async () => {
  const closing = [];
  for (const worker of activeWorkers) {
    closing.push(
      new Promise((resolve) => {
        worker.once("close", resolve);
        worker.kill();
        setTimeout(resolve, 2_000).unref();
      }),
    );
  }
  await Promise.allSettled(closing);
  activeWorkers.clear();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("cross-host Remote membership coordinator", () => {
  it("negotiates approval-binding-v1 exactly and strips approve from legacy durable clients", () => {
    const value = fixture();
    const created = createSession(value);
    const join = (connectionNonce, capabilities) => {
      const credential = createRemoteMembershipPrincipalCredential();
      const challenge = value.coordinator.issueMemberJoinChallenge({
        sessionId: created.sessionId,
        expectedSessionEpoch: created.sessionEpoch,
        scopes: ["observe", "approve"],
        capabilities,
        credentialPublicKey: credential.publicKey,
        connectionNonce,
      });
      return value.coordinator.joinMember({
        challengeId: challenge.challengeId,
        connectionNonce,
        signature: signRemoteMembershipAuthenticationChallenge(
          challenge,
          credential.privateKeyPkcs8,
        ),
      });
    };

    expect(join("legacy-client", null)).toMatchObject({
      scopes: ["observe"],
      capabilities: [],
    });
    expect(join("bound-client", ["approval-binding-v1"])).toMatchObject({
      scopes: ["approve", "observe"],
      capabilities: ["approval-binding-v1"],
    });
    expect(() => join("invalid-client", "approval-binding-v1")).toThrow(
      /bounded array/,
    );
  });

  it("strips approve while replaying a pre-capability member event", () => {
    const value = fixture();
    const created = createSession(value);
    const joined = joinDevice(value, created);
    const { eventHash, replayStore } = _remoteMembershipCoordinatorInternals;
    const store = JSON.parse(
      fs.readFileSync(value.coordinatorPaths.stateFile, "utf8"),
    );
    const legacyJoin = store.events.find(
      (event) =>
        event.type === "member.joined" &&
        event.principalId === joined.principalId,
    );
    for (const field of [
      "capabilities",
      "joinVia",
      "policyAllowedScopes",
      "policyAllowRelayPairing",
      "policyMaxDevices",
      "policyVersion",
    ]) {
      delete legacyJoin[field];
    }
    legacyJoin.eventHash = eventHash(legacyJoin);
    store.headHash = legacyJoin.eventHash;

    const replayed = replayStore(store, created.trust.coordinatorId);
    expect(
      replayed.sessions.get(created.sessionId).members.get(joined.principalId),
    ).toMatchObject({
      status: "active",
      scopes: ["observe"],
      capabilities: [],
    });
  });

  it("revalidates maxDevices against the current CAS state after stale cross-server challenges", () => {
    const value = fixture();
    const joinPolicy = {
      policyVersion: "policy-v1",
      allowedScopes: ["observe", "approve"],
      maxDevices: 1,
      allowRelayPairing: true,
    };
    const created = createSession(value, { joinPolicy });
    const peer = new DurableRemoteMembershipCoordinator({
      ...value.coordinatorPaths,
      now: () => value.getNow(),
    });
    const credentials = [
      createRemoteMembershipPrincipalCredential(),
      createRemoteMembershipPrincipalCredential(),
    ];
    const coordinators = [value.coordinator, peer];
    const challenges = coordinators.map((coordinator, index) =>
      coordinator.issueMemberJoinChallenge({
        sessionId: created.sessionId,
        expectedSessionEpoch: created.sessionEpoch,
        scopes: ["observe", "approve"],
        capabilities: ["approval-binding-v1"],
        joinPolicy,
        credentialPublicKey: credentials[index].publicKey,
        connectionNonce: `cross-server-${index}`,
      }),
    );
    const complete = (index) =>
      coordinators[index].joinMember({
        challengeId: challenges[index].challengeId,
        connectionNonce: `cross-server-${index}`,
        signature: signRemoteMembershipAuthenticationChallenge(
          challenges[index],
          credentials[index].privateKeyPkcs8,
        ),
      });

    expect(complete(0).scopes).toEqual(["approve", "observe"]);
    let denied;
    try {
      complete(1);
    } catch (error) {
      denied = error;
    }
    expect(denied).toMatchObject({
      code: REMOTE_MEMBERSHIP_COORDINATOR_UNAVAILABLE_CODE,
      cause: expect.objectContaining({
        message: expect.stringMatching(/device limit reached/),
      }),
    });
  });

  it("recovers a signed close tombstone after response loss and safely re-enables on restart", () => {
    const value = fixture();
    const created = createSession(value);
    const joined = joinDevice(value, created);
    let crashAfterCommit = true;
    const crashy = new DurableRemoteMembershipCoordinator({
      ...value.coordinatorPaths,
      now: () => value.getNow(),
      faultHooks: {
        afterStateCommit() {
          if (crashAfterCommit) throw new Error("simulated lost close reply");
        },
      },
    });

    expect(() =>
      crashy.closeSession({
        sessionId: created.sessionId,
        hostPrincipalId: created.hostPrincipalId,
        expectedSessionEpoch: created.sessionEpoch,
        expectedHostMembershipEpoch: created.membershipEpoch,
      }),
    ).toThrow(
      expect.objectContaining({
        code: REMOTE_MEMBERSHIP_COORDINATOR_UNAVAILABLE_CODE,
        commitState: "unknown",
      }),
    );
    crashAfterCommit = false;

    const restarted = new DurableRemoteMembershipCoordinator({
      ...value.coordinatorPaths,
      now: () => value.getNow(),
    });
    const terminal = restarted.getSessionSnapshot(created.sessionId);
    expect(terminal.session).toMatchObject({
      status: "closed",
      sessionEpoch: "2",
    });
    value.host.adopt(terminal.statement, {
      expectedKind: "session.snapshot",
      expectedSessionId: created.sessionId,
    });

    const connectionNonce = "reenable-after-lost-close";
    const challenge = restarted.issueSessionReenableChallenge({
      sessionId: created.sessionId,
      principalId: created.hostPrincipalId,
      connectionNonce,
      scopes: ["observe", "prompt", "approve", "interrupt"],
      expiresAt: 200_000,
    });
    const reenabled = restarted.reenableSession({
      challengeId: challenge.challengeId,
      connectionNonce,
      signature: signRemoteMembershipAuthenticationChallenge(
        challenge,
        created.hostCredential.privateKeyPkcs8,
      ),
    });
    expect(reenabled).toMatchObject({
      sessionEpoch: "3",
      hostPrincipalId: created.hostPrincipalId,
      membershipEpoch: "2",
    });
    value.host.adopt(reenabled.statement, {
      expectedKind: "session.snapshot",
      expectedSessionId: created.sessionId,
    });
    expect(
      restarted.readMembership({
        sessionId: created.sessionId,
        sessionEpoch: "3",
        principalId: joined.principalId,
        membershipEpoch: joined.membershipEpoch,
      }),
    ).toMatchObject({ ok: false });
  });

  it("pins an independent trust root and requires durable adopt + ACK + online consume", () => {
    const value = fixture();
    const created = createSession(value);
    const joined = joinDevice(value, created);
    const issued = createLease(value, created, joined);

    const adopted = value.host.adopt(issued.statement, {
      expectedKind: "lease.created",
      expectedSessionId: created.sessionId,
    });
    expect(() =>
      value.host.requireConsumableLease(issued.lease.leaseId),
    ).toThrow(/not ACKed/);

    const acked = value.coordinator.ackApprovalLease({
      sessionId: created.sessionId,
      leaseId: issued.lease.leaseId,
      hostPrincipalId: created.hostPrincipalId,
      expectedHostMembershipEpoch: created.membershipEpoch,
      expectedCreatedGeneration: issued.lease.createdGeneration,
      hostReceiptDigest: adopted.receiptHash,
    });
    value.host.adopt(acked.statement, {
      expectedKind: "lease.acked",
      expectedSessionId: created.sessionId,
    });
    expect(
      value.host.requireConsumableLease(issued.lease.leaseId),
    ).toMatchObject({
      status: "acked",
      requestId: "request-1",
      membershipEpoch: joined.membershipEpoch,
    });

    const consumed = value.coordinator.consumeApprovalLease({
      sessionId: created.sessionId,
      leaseId: issued.lease.leaseId,
      hostPrincipalId: created.hostPrincipalId,
      expectedHostMembershipEpoch: created.membershipEpoch,
      expectedAckedGeneration: acked.lease.ackedGeneration,
      expectedMembershipEpoch: joined.membershipEpoch,
      requestId: issued.lease.requestId,
      fingerprint: issued.lease.fingerprint,
      binding: issued.lease.binding,
    });
    expect(consumed.dispatchAuthorized).toBe(true);
    value.host.adopt(consumed.statement, {
      expectedKind: "lease.consumed",
      expectedSessionId: created.sessionId,
    });
    expect(value.host.getLease(issued.lease.leaseId)).toMatchObject({
      status: "consumed",
    });
    expect(() =>
      value.coordinator.consumeApprovalLease({
        sessionId: created.sessionId,
        leaseId: issued.lease.leaseId,
        hostPrincipalId: created.hostPrincipalId,
        expectedHostMembershipEpoch: created.membershipEpoch,
        expectedAckedGeneration: acked.lease.ackedGeneration,
        expectedMembershipEpoch: joined.membershipEpoch,
        requestId: issued.lease.requestId,
        fingerprint: issued.lease.fingerprint,
        binding: issued.lease.binding,
      }),
    ).toThrow();
  });

  it("atomically revokes a member and every active or ACKed lease before dispatch", () => {
    const value = fixture();
    const created = createSession(value);
    const joined = joinDevice(value, created);
    const first = createLease(value, created, joined, "request-active");
    const firstReceipt = value.host.adopt(first.statement, {
      expectedKind: "lease.created",
    });
    const acked = value.coordinator.ackApprovalLease({
      sessionId: created.sessionId,
      leaseId: first.lease.leaseId,
      hostPrincipalId: created.hostPrincipalId,
      expectedHostMembershipEpoch: created.membershipEpoch,
      expectedCreatedGeneration: first.lease.createdGeneration,
      hostReceiptDigest: firstReceipt.receiptHash,
    });
    value.host.adopt(acked.statement, { expectedKind: "lease.acked" });

    const revoked = value.coordinator.revokeMember({
      sessionId: created.sessionId,
      principalId: joined.principalId,
      hostPrincipalId: created.hostPrincipalId,
      expectedSessionEpoch: created.sessionEpoch,
      expectedMembershipEpoch: joined.membershipEpoch,
      expectedHostMembershipEpoch: created.membershipEpoch,
    });
    expect(revoked.cancelledLeaseIds).toEqual([first.lease.leaseId]);
    value.host.adopt(revoked.statement, {
      expectedKind: "session.snapshot",
    });
    expect(value.host.getLease(first.lease.leaseId)).toMatchObject({
      status: "cancelled",
      cancelReason: "membership-revoked",
    });
    expect(() =>
      value.coordinator.consumeApprovalLease({
        sessionId: created.sessionId,
        leaseId: first.lease.leaseId,
        hostPrincipalId: created.hostPrincipalId,
        expectedHostMembershipEpoch: created.membershipEpoch,
        expectedAckedGeneration: acked.lease.ackedGeneration,
        expectedMembershipEpoch: joined.membershipEpoch,
        requestId: first.lease.requestId,
        fingerprint: first.lease.fingerprint,
        binding: first.lease.binding,
      }),
    ).toThrow();
  });

  it("recovers sessions, principal epochs, and active leases after a coordinator restart", () => {
    const value = fixture();
    const created = createSession(value);
    const joined = joinDevice(value, created);
    const issued = createLease(value, created, joined);

    const restarted = new DurableRemoteMembershipCoordinator({
      ...value.coordinatorPaths,
      now: () => 2_000,
    });
    const connectionNonce = "host-restart-connection";
    const challenge = restarted.issueSessionResumeChallenge({
      sessionId: created.sessionId,
      principalId: created.hostPrincipalId,
      connectionNonce,
    });
    const resumed = restarted.resumeSession({
      challengeId: challenge.challengeId,
      connectionNonce,
      signature: signRemoteMembershipAuthenticationChallenge(
        challenge,
        created.hostCredential.privateKeyPkcs8,
      ),
    });
    expect(resumed.session).toMatchObject({
      sessionId: created.sessionId,
      sessionEpoch: created.sessionEpoch,
      status: "active",
    });
    expect(resumed.session.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          principalId: joined.principalId,
          membershipEpoch: joined.membershipEpoch,
          status: "active",
        }),
      ]),
    );
    expect(resumed.session.leases).toEqual([
      expect.objectContaining({
        leaseId: issued.lease.leaseId,
        status: "active",
      }),
    ]);
  });

  it("rejects a different coordinator key and signed statements older than durable high-water", () => {
    const first = fixture();
    const created = createSession(first);
    const joined = joinDevice(first, created);
    const older = created.statement;

    expect(() =>
      first.host.adopt(older, { expectedKind: "session.snapshot" }),
    ).toThrow(
      expect.objectContaining({ code: REMOTE_MEMBERSHIP_HOST_ROLLBACK_CODE }),
    );

    const other = fixture();
    const otherHostCredential = createRemoteMembershipPrincipalCredential();
    const otherCreated = other.coordinator.createSession({
      sessionId: "remote-other",
      agentSessionId: "agent-other",
      scopes: ["observe", "approve"],
      expiresAt: 100_000,
      hostCredentialPublicKeySpki: otherHostCredential.publicKey,
    });
    expect(() => first.host.pinTrust(otherCreated.trust)).toThrow(
      expect.objectContaining({ code: REMOTE_MEMBERSHIP_HOST_TRUST_CODE }),
    );
    expect(() =>
      first.host.adopt(otherCreated.statement, {
        expectedKind: "session.snapshot",
      }),
    ).toThrow(
      expect.objectContaining({ code: REMOTE_MEMBERSHIP_HOST_TRUST_CODE }),
    );
    expect(joined.membershipEpoch).toBe("1");
  });

  it("detects coordinator state rollback against an independent witness", () => {
    const value = fixture();
    const created = createSession(value);
    const before = fs.readFileSync(value.coordinatorPaths.stateFile, "utf8");
    joinDevice(value, created);
    fs.writeFileSync(value.coordinatorPaths.stateFile, before, "utf8");

    const restarted = new DurableRemoteMembershipCoordinator({
      ...value.coordinatorPaths,
      now: () => 2_000,
    });
    expect(() => restarted.snapshotSession(created.sessionId)).toThrow(
      expect.objectContaining({
        code: REMOTE_MEMBERSHIP_COORDINATOR_ROLLBACK_CODE,
      }),
    );
  });

  it("detects host receipt rollback against its independent witness", () => {
    const value = fixture();
    const created = createSession(value);
    const before = fs.readFileSync(value.hostPaths.stateFile, "utf8");
    joinDevice(value, created);
    fs.writeFileSync(value.hostPaths.stateFile, before, "utf8");

    const restarted = new DurableRemoteMembershipHostStore(value.hostPaths);
    expect(() => restarted.inspect()).toThrow(
      expect.objectContaining({ code: REMOTE_MEMBERSHIP_HOST_ROLLBACK_CODE }),
    );
  });

  it("fails closed when offline or expired instead of treating a cached ACK as authority", () => {
    const value = fixture();
    const created = createSession(value);
    const joined = joinDevice(value, created);
    const issued = createLease(value, created, joined);
    const adopted = value.host.adopt(issued.statement, {
      expectedKind: "lease.created",
    });
    const acked = value.coordinator.ackApprovalLease({
      sessionId: created.sessionId,
      leaseId: issued.lease.leaseId,
      hostPrincipalId: created.hostPrincipalId,
      expectedHostMembershipEpoch: created.membershipEpoch,
      expectedCreatedGeneration: issued.lease.createdGeneration,
      hostReceiptDigest: adopted.receiptHash,
    });
    value.host.adopt(acked.statement, { expectedKind: "lease.acked" });
    value.setNow(20_001);

    expect(() =>
      value.host.requireConsumableLease(issued.lease.leaseId),
    ).toThrow(/expired/);
    expect(() =>
      value.coordinator.consumeApprovalLease({
        sessionId: created.sessionId,
        leaseId: issued.lease.leaseId,
        hostPrincipalId: created.hostPrincipalId,
        expectedHostMembershipEpoch: created.membershipEpoch,
        expectedAckedGeneration: acked.lease.ackedGeneration,
        expectedMembershipEpoch: joined.membershipEpoch,
        requestId: issued.lease.requestId,
        fingerprint: issued.lease.fingerprint,
        binding: issued.lease.binding,
      }),
    ).toThrow();
  });

  it("binds stable principals to Ed25519 possession and rejects replay, wrong nonce, and cross-server proof reuse", () => {
    const value = fixture();
    const created = createSession(value);
    const joined = joinDevice(value, created);
    expect(created.hostPrincipalId).toBe(
      `ed25519:${created.hostPrincipalId.slice("ed25519:".length)}`,
    );
    expect(joined.principalId).toMatch(/^ed25519:[0-9a-f]{64}$/);

    const badNonceChallenge = value.coordinator.issueSessionResumeChallenge({
      sessionId: created.sessionId,
      principalId: joined.principalId,
      connectionNonce: "connection-a",
    });
    const badNonceSignature = signRemoteMembershipAuthenticationChallenge(
      badNonceChallenge,
      joined.credential.privateKeyPkcs8,
    );
    expect(() =>
      value.coordinator.resumeSession({
        challengeId: badNonceChallenge.challengeId,
        connectionNonce: "connection-b",
        signature: badNonceSignature,
      }),
    ).toThrow();
    expect(() =>
      value.coordinator.resumeSession({
        challengeId: badNonceChallenge.challengeId,
        connectionNonce: "connection-a",
        signature: badNonceSignature,
      }),
    ).toThrow();

    const challenge = value.coordinator.issueSessionResumeChallenge({
      sessionId: created.sessionId,
      principalId: joined.principalId,
      connectionNonce: "connection-c",
    });
    const signature = signRemoteMembershipAuthenticationChallenge(
      challenge,
      joined.credential.privateKeyPkcs8,
    );
    const otherProcess = new DurableRemoteMembershipCoordinator({
      ...value.coordinatorPaths,
      now: () => value.getNow(),
    });
    expect(() =>
      otherProcess.resumeSession({
        challengeId: challenge.challengeId,
        connectionNonce: "connection-c",
        signature,
      }),
    ).toThrow();
    expect(
      value.coordinator.resumeSession({
        challengeId: challenge.challengeId,
        connectionNonce: "connection-c",
        signature,
      }),
    ).toMatchObject({
      principalId: joined.principalId,
      membershipEpoch: joined.membershipEpoch,
      nextConnectionNonce: expect.any(String),
    });
    expect(() =>
      value.coordinator.resumeSession({
        challengeId: challenge.challengeId,
        connectionNonce: "connection-c",
        signature,
      }),
    ).toThrow();
  });

  it("joins a relay principal only with a private one-shot capability minted after authenticated DH/AEAD decrypt", () => {
    const value = fixture();
    const created = createSession(value);
    const { hostCrypto, mobileCrypto, token } = relayHandshake(
      created,
      value.coordinator.relayAuthorityDescriptor(),
    );
    expect(() =>
      hostCrypto.takeRelayPossessionCapability("mobile-peer"),
    ).toThrow(/No authenticated/);
    const envelope = mobileCrypto.encrypt("host-peer", {
      type: "pair.join",
      token,
      capabilities: ["approval-binding-v1"],
    });
    expect(hostCrypto.decrypt(envelope)).toEqual({
      type: "pair.join",
      token,
      capabilities: ["approval-binding-v1"],
    });
    const capability = hostCrypto.takeRelayPossessionCapability("mobile-peer");
    const args = {
      sessionId: created.sessionId,
      expectedSessionEpoch: created.sessionEpoch,
      scopes: ["observe", "approve"],
      mobilePeerId: "mobile-peer",
      mobilePublicKey: mobileCrypto.publicKey,
      pairingTokenDigest: remoteSessionPairingTokenDigest(token),
      capabilities: ["approval-binding-v1"],
    };
    expect(() =>
      value.coordinator.joinRelayMember({
        ...args,
        possessionCapability: structuredClone(capability),
      }),
    ).toThrow();
    const joined = value.coordinator.joinRelayMember({
      ...args,
      possessionCapability: capability,
    });
    expect(joined).toMatchObject({
      principalId: expect.stringMatching(/^relay-x25519:[0-9a-f]{64}$/),
      credentialType: "relay-x25519",
      membershipEpoch: "1",
      scopes: ["approve", "observe"],
      capabilities: ["approval-binding-v1"],
    });
    value.host.adopt(joined.statement, { expectedKind: "session.snapshot" });
    expect(() =>
      value.coordinator.joinRelayMember({
        ...args,
        possessionCapability: capability,
      }),
    ).toThrow();
    expect(() => hostCrypto.decrypt(envelope)).toThrow(/replay|out-of-order/);
  });

  it("strips approve from a durable relay join that omits approval-binding-v1", () => {
    const value = fixture();
    const created = createSession(value);
    const { hostCrypto, mobileCrypto, token } = relayHandshake(
      created,
      value.coordinator.relayAuthorityDescriptor(),
      "legacy-relay-token",
    );
    hostCrypto.decrypt(
      mobileCrypto.encrypt("host-peer", {
        type: "pair.join",
        token,
      }),
    );
    const joined = value.coordinator.joinRelayMember({
      sessionId: created.sessionId,
      expectedSessionEpoch: created.sessionEpoch,
      scopes: ["observe", "approve"],
      mobilePeerId: "mobile-peer",
      mobilePublicKey: mobileCrypto.publicKey,
      pairingTokenDigest: remoteSessionPairingTokenDigest(token),
      possessionCapability:
        hostCrypto.takeRelayPossessionCapability("mobile-peer"),
    });

    expect(joined).toMatchObject({
      scopes: ["observe"],
      capabilities: [],
    });
  });

  it("consumes and rejects relay capability on peer, key, token, or session mismatch and never mints one for a wrong join token", () => {
    const value = fixture();
    const created = createSession(value);
    const authority = value.coordinator.relayAuthorityDescriptor();
    const wrongToken = relayHandshake(created, authority, "expected-token");
    wrongToken.hostCrypto.decrypt(
      wrongToken.mobileCrypto.encrypt("host-peer", {
        type: "pair.join",
        token: "different-token",
      }),
    );
    expect(() =>
      wrongToken.hostCrypto.takeRelayPossessionCapability("mobile-peer"),
    ).toThrow(/No authenticated/);

    const mismatch = relayHandshake(created, authority, "mismatch-token");
    mismatch.hostCrypto.decrypt(
      mismatch.mobileCrypto.encrypt("host-peer", {
        type: "pair.join",
        token: mismatch.token,
      }),
    );
    const capability =
      mismatch.hostCrypto.takeRelayPossessionCapability("mobile-peer");
    const correct = {
      sessionId: created.sessionId,
      expectedSessionEpoch: created.sessionEpoch,
      scopes: ["observe", "approve"],
      mobilePeerId: "mobile-peer",
      mobilePublicKey: mismatch.mobileCrypto.publicKey,
      pairingTokenDigest: remoteSessionPairingTokenDigest(mismatch.token),
    };
    expect(() =>
      value.coordinator.joinRelayMember({
        ...correct,
        mobilePeerId: "other-peer",
        possessionCapability: capability,
      }),
    ).toThrow();
    expect(() =>
      value.coordinator.joinRelayMember({
        ...correct,
        possessionCapability: capability,
      }),
    ).toThrow();

    for (const mismatchField of [
      "mobilePublicKey",
      "pairingTokenDigest",
      "sessionId",
    ]) {
      const fresh = relayHandshake(
        created,
        authority,
        `token-${mismatchField}`,
      );
      fresh.hostCrypto.decrypt(
        fresh.mobileCrypto.encrypt("host-peer", {
          type: "pair.join",
          token: fresh.token,
        }),
      );
      const freshCapability =
        fresh.hostCrypto.takeRelayPossessionCapability("mobile-peer");
      const otherKey = new RemoteSessionCryptoContext({
        sessionId: created.sessionId,
        localPeerId: "other-key",
      }).publicKey;
      const changed = {
        sessionId: created.sessionId,
        expectedSessionEpoch: created.sessionEpoch,
        scopes: ["observe", "approve"],
        mobilePeerId: "mobile-peer",
        mobilePublicKey: fresh.mobileCrypto.publicKey,
        pairingTokenDigest: remoteSessionPairingTokenDigest(fresh.token),
        possessionCapability: freshCapability,
      };
      if (mismatchField === "mobilePublicKey")
        changed.mobilePublicKey = otherKey;
      if (mismatchField === "pairingTokenDigest") {
        changed.pairingTokenDigest = "0".repeat(64);
      }
      if (mismatchField === "sessionId") changed.sessionId = "other-session";
      expect(() => value.coordinator.joinRelayMember(changed)).toThrow();
    }
  });

  it("binds relay scopes, expiry, and coordinator instance without breaking legacy re-pair semantics", () => {
    const value = fixture();
    const created = createSession(value);
    const authority = value.coordinator.relayAuthorityDescriptor();

    const observeOnly = relayHandshake(created, authority, "observe-only", [
      "observe",
      "observe",
    ]);
    observeOnly.hostCrypto.decrypt(
      observeOnly.mobileCrypto.encrypt("host-peer", {
        type: "pair.join",
        token: observeOnly.token,
      }),
    );
    const observeCapability =
      observeOnly.hostCrypto.takeRelayPossessionCapability("mobile-peer");
    expect(observeCapability.authorizedScopes).toEqual(["observe"]);
    expect(() =>
      value.coordinator.joinRelayMember({
        sessionId: created.sessionId,
        expectedSessionEpoch: created.sessionEpoch,
        scopes: ["approve"],
        mobilePeerId: "mobile-peer",
        mobilePublicKey: observeOnly.mobileCrypto.publicKey,
        pairingTokenDigest: remoteSessionPairingTokenDigest(observeOnly.token),
        possessionCapability: observeCapability,
      }),
    ).toThrow(/over-scoped|unavailable/i);

    const subset = relayHandshake(created, authority, "subset-token", [
      "approve",
      "observe",
      "observe",
    ]);
    subset.hostCrypto.decrypt(
      subset.mobileCrypto.encrypt("host-peer", {
        type: "pair.join",
        token: subset.token,
      }),
    );
    expect(
      value.coordinator.joinRelayMember({
        sessionId: created.sessionId,
        expectedSessionEpoch: created.sessionEpoch,
        scopes: ["observe"],
        mobilePeerId: "mobile-peer",
        mobilePublicKey: subset.mobileCrypto.publicKey,
        pairingTokenDigest: remoteSessionPairingTokenDigest(subset.token),
        possessionCapability:
          subset.hostCrypto.takeRelayPossessionCapability("mobile-peer"),
      }),
    ).toMatchObject({ credentialType: "relay-x25519" });

    let relayNow = 1_000;
    const expiring = relayHandshake(
      created,
      authority,
      "expiring-token",
      ["observe"],
      () => relayNow,
    );
    expiring.hostCrypto.decrypt(
      expiring.mobileCrypto.encrypt("host-peer", {
        type: "pair.join",
        token: expiring.token,
      }),
    );
    const expiringCapability =
      expiring.hostCrypto.takeRelayPossessionCapability("mobile-peer");
    relayNow = 10_000;
    value.setNow(10_000);
    expect(() =>
      value.coordinator.joinRelayMember({
        sessionId: created.sessionId,
        expectedSessionEpoch: created.sessionEpoch,
        scopes: ["observe"],
        mobilePeerId: "mobile-peer",
        mobilePublicKey: expiring.mobileCrypto.publicKey,
        pairingTokenDigest: remoteSessionPairingTokenDigest(expiring.token),
        possessionCapability: expiringCapability,
      }),
    ).toThrow();

    value.setNow(1_000);
    const crossInstance = relayHandshake(
      created,
      authority,
      "cross-instance-token",
      ["observe"],
    );
    crossInstance.hostCrypto.decrypt(
      crossInstance.mobileCrypto.encrypt("host-peer", {
        type: "pair.join",
        token: crossInstance.token,
      }),
    );
    const crossCapability =
      crossInstance.hostCrypto.takeRelayPossessionCapability("mobile-peer");
    const restarted = new DurableRemoteMembershipCoordinator({
      ...value.coordinatorPaths,
      now: () => value.getNow(),
    });
    const crossArgs = {
      sessionId: created.sessionId,
      expectedSessionEpoch: created.sessionEpoch,
      scopes: ["observe"],
      mobilePeerId: "mobile-peer",
      mobilePublicKey: crossInstance.mobileCrypto.publicKey,
      pairingTokenDigest: remoteSessionPairingTokenDigest(crossInstance.token),
      possessionCapability: crossCapability,
    };
    expect(() => restarted.joinRelayMember(crossArgs)).toThrow();
    expect(() => value.coordinator.joinRelayMember(crossArgs)).toThrow();

    const legacy = new RemoteSessionCryptoContext({
      sessionId: created.sessionId,
      localPeerId: "legacy-host",
    });
    const legacyMobile = new RemoteSessionCryptoContext({
      sessionId: created.sessionId,
      localPeerId: "legacy-mobile",
    });
    legacy.pair("legacy-mobile", legacyMobile.publicKey, "legacy-token-1");
    legacyMobile.pair("legacy-host", legacy.publicKey, "legacy-token-1");
    legacy.decrypt(
      legacyMobile.encrypt("legacy-host", {
        type: "pair.join",
        token: "legacy-token-1",
      }),
    );
    expect(() => legacy.takeRelayPossessionCapability("legacy-mobile")).toThrow(
      /No authenticated/,
    );
    // Legacy callers may still replace a peer key/token; the durable path did
    // not silently turn pair() into a permanent peer-id reservation.
    expect(() =>
      legacy.pair("legacy-mobile", legacyMobile.publicKey, "legacy-token-2"),
    ).not.toThrow();
  });

  it("rejects a replaced signing key and a public/private signing-key mismatch", () => {
    const first = fixture();
    const created = createSession(first);
    const originalKey = fs.readFileSync(first.coordinatorPaths.keyFile, "utf8");
    const second = fixture();
    createSession(second);
    const replacementKey = fs.readFileSync(
      second.coordinatorPaths.keyFile,
      "utf8",
    );

    fs.writeFileSync(first.coordinatorPaths.keyFile, replacementKey, "utf8");
    const replaced = new DurableRemoteMembershipCoordinator({
      ...first.coordinatorPaths,
      now: () => 2_000,
    });
    expect(() => replaced.snapshotSession(created.sessionId)).toThrow(
      expect.objectContaining({
        code: REMOTE_MEMBERSHIP_COORDINATOR_UNAVAILABLE_CODE,
      }),
    );

    const mismatched = JSON.parse(originalKey);
    mismatched.privateKeyPkcs8 = JSON.parse(replacementKey).privateKeyPkcs8;
    fs.writeFileSync(
      first.coordinatorPaths.keyFile,
      `${JSON.stringify(mismatched)}\n`,
      "utf8",
    );
    expect(
      () =>
        new DurableRemoteMembershipCoordinator({
          ...first.coordinatorPaths,
          now: () => 2_000,
        }),
    ).toThrow(
      expect.objectContaining({
        code: REMOTE_MEMBERSHIP_COORDINATOR_UNAVAILABLE_CODE,
      }),
    );
  });

  it("detects witness-only rollback for coordinator and host state roots", () => {
    const value = fixture();
    const created = createSession(value);
    const coordinatorWitness = fs.readFileSync(
      value.coordinatorPaths.witnessFile,
      "utf8",
    );
    const hostWitness = fs.readFileSync(value.hostPaths.witnessFile, "utf8");
    joinDevice(value, created);

    fs.writeFileSync(
      value.coordinatorPaths.witnessFile,
      coordinatorWitness,
      "utf8",
    );
    const restartedCoordinator = new DurableRemoteMembershipCoordinator({
      ...value.coordinatorPaths,
      now: () => 2_000,
    });
    expect(() =>
      restartedCoordinator.snapshotSession(created.sessionId),
    ).toThrow(
      expect.objectContaining({
        code: REMOTE_MEMBERSHIP_COORDINATOR_ROLLBACK_CODE,
      }),
    );

    fs.writeFileSync(value.hostPaths.witnessFile, hostWitness, "utf8");
    const restartedHost = new DurableRemoteMembershipHostStore({
      ...value.hostPaths,
      now: () => 2_000,
    });
    expect(() => restartedHost.inspect()).toThrow(
      expect.objectContaining({ code: REMOTE_MEMBERSHIP_HOST_ROLLBACK_CODE }),
    );
  });

  it("rejects canonicalization ambiguity, extra signed fields, and future event-generation jumps", () => {
    const { canonicalJson, eventHash, replayStore } =
      _remoteMembershipCoordinatorInternals;
    expect(() => canonicalJson({ missing: undefined })).toThrow();
    expect(() => canonicalJson({ negativeZero: -0 })).toThrow();
    const sparse = [];
    sparse[1] = "value";
    expect(() => canonicalJson(sparse)).toThrow();

    const value = fixture();
    const created = createSession(value);
    const withExtraField = { ...created.statement, ignored: true };
    expect(() =>
      value.host.adopt(withExtraField, { expectedKind: "session.snapshot" }),
    ).toThrow(
      expect.objectContaining({ code: REMOTE_MEMBERSHIP_HOST_TRUST_CODE }),
    );
    expect(() =>
      value.host.adopt(
        { ...created.statement, signature: `${created.statement.signature}=` },
        { expectedKind: "session.snapshot" },
      ),
    ).toThrow(
      expect.objectContaining({ code: REMOTE_MEMBERSHIP_HOST_TRUST_CODE }),
    );

    const store = JSON.parse(
      fs.readFileSync(value.coordinatorPaths.stateFile, "utf8"),
    );
    store.events[0].generation = "2";
    store.events[0].eventHash = eventHash(store.events[0]);
    store.generation = "2";
    store.headHash = store.events[0].eventHash;
    expect(() => replayStore(store, created.trust.coordinatorId)).toThrow(
      /append-only chain/,
    );

    const extraEventStore = JSON.parse(
      fs.readFileSync(value.coordinatorPaths.stateFile, "utf8"),
    );
    extraEventStore.events[0].ambiguous = null;
    extraEventStore.events[0].eventHash = eventHash(extraEventStore.events[0]);
    extraEventStore.headHash = extraEventStore.events[0].eventHash;
    expect(() =>
      replayStore(extraEventStore, created.trust.coordinatorId),
    ).toThrow(/non-canonical fields/);
  });

  it("enforces session, lease TTL, challenge TTL, and clock-rollback boundaries", () => {
    const value = fixture();
    const created = createSession(value);
    const joined = joinDevice(value, created);
    const issued = createLease(value, created, joined);
    value.host.adopt(issued.statement, { expectedKind: "lease.created" });

    value.setNow(20_000);
    expect(() =>
      value.coordinator.ackApprovalLease({
        sessionId: created.sessionId,
        leaseId: issued.lease.leaseId,
        hostPrincipalId: created.hostPrincipalId,
        expectedHostMembershipEpoch: created.membershipEpoch,
        expectedCreatedGeneration: issued.lease.createdGeneration,
        hostReceiptDigest: "a".repeat(64),
      }),
    ).toThrow();

    value.setNow(100_000);
    expect(() =>
      value.coordinator.issueSessionResumeChallenge({
        sessionId: created.sessionId,
        principalId: created.hostPrincipalId,
        connectionNonce: "expired-session",
      }),
    ).toThrow();

    const clock = fixture();
    const clockCreated = createSession(clock);
    clock.setNow(2_000);
    clock.coordinator.snapshotSession(clockCreated.sessionId);
    // A read does not advance durable time; create an event at 2,000 first.
    joinDevice(clock, clockCreated);
    clock.setNow(1_999);
    expect(() =>
      clock.coordinator.snapshotSession(clockCreated.sessionId),
    ).toThrow(
      expect.objectContaining({
        code: REMOTE_MEMBERSHIP_COORDINATOR_ROLLBACK_CODE,
      }),
    );

    const challengeClock = fixture();
    const challengeCreated = createSession(challengeClock);
    const challenge = challengeClock.coordinator.issueSessionResumeChallenge({
      sessionId: challengeCreated.sessionId,
      principalId: challengeCreated.hostPrincipalId,
      connectionNonce: "ttl-boundary",
      ttlMs: 10,
    });
    challengeClock.setNow(challenge.expiresAtMs);
    expect(() =>
      challengeClock.coordinator.resumeSession({
        challengeId: challenge.challengeId,
        connectionNonce: "ttl-boundary",
        signature: signRemoteMembershipAuthenticationChallenge(
          challenge,
          challengeCreated.hostCredential.privateKeyPkcs8,
        ),
      }),
    ).toThrow();
  });

  it("replay independently rejects an ACK at the lease expiry boundary", () => {
    const value = fixture();
    const created = createSession(value);
    const joined = joinDevice(value, created);
    const issued = createLease(value, created, joined);
    const { acked } = adoptAndAck(value, created, issued);
    expect(acked.lease.status).toBe("acked");

    const store = JSON.parse(
      fs.readFileSync(value.coordinatorPaths.stateFile, "utf8"),
    );
    const ackEvent = store.events.at(-1);
    ackEvent.occurredAtMs = issued.lease.expiresAt;
    ackEvent.eventHash =
      _remoteMembershipCoordinatorInternals.eventHash(ackEvent);
    store.headHash = ackEvent.eventHash;
    expect(() =>
      _remoteMembershipCoordinatorInternals.replayStore(
        store,
        created.trust.coordinatorId,
      ),
    ).toThrow(/expired lease/);

    value.coordinator.consumeApprovalLease(
      consumeArgs(created, joined, issued, acked),
    );
    const consumedStore = JSON.parse(
      fs.readFileSync(value.coordinatorPaths.stateFile, "utf8"),
    );
    const consumeEvent = consumedStore.events.at(-1);
    consumeEvent.occurredAtMs = issued.lease.expiresAt;
    consumeEvent.eventHash =
      _remoteMembershipCoordinatorInternals.eventHash(consumeEvent);
    consumedStore.headHash = consumeEvent.eventHash;
    expect(() =>
      _remoteMembershipCoordinatorInternals.replayStore(
        consumedStore,
        created.trust.coordinatorId,
      ),
    ).toThrow(/expired lease/);
  });

  it("rejects signed authority-time rollback at the host even at a higher generation", () => {
    const value = fixture();
    const created = createSession(value);
    value.setNow(2_000);
    const joined = joinDevice(value, created);
    const payload = structuredClone(joined.statement.payload);
    const forgedGeneration = String(BigInt(joined.statement.generation) + 1n);
    payload.authorityGeneration = forgedGeneration;
    const signedRollback = value.coordinator._statement(
      "session.snapshot",
      payload,
      forgedGeneration,
      1_999,
    );
    expect(() =>
      value.host.adopt(signedRollback, {
        expectedKind: "session.snapshot",
        expectedSessionId: created.sessionId,
      }),
    ).toThrow();
    expect(value.host.inspect().lastAuthorityGeneration).toBe(
      joined.statement.generation,
    );
  });

  it("binds ACK and consume to the exact host, epoch, fingerprint, and binding", () => {
    const value = fixture();
    const created = createSession(value);
    const joined = joinDevice(value, created);
    const issued = createLease(value, created, joined);
    const adopted = value.host.adopt(issued.statement, {
      expectedKind: "lease.created",
    });
    expect(() =>
      value.coordinator.ackApprovalLease({
        sessionId: created.sessionId,
        leaseId: issued.lease.leaseId,
        hostPrincipalId: joined.principalId,
        expectedHostMembershipEpoch: created.membershipEpoch,
        expectedCreatedGeneration: issued.lease.createdGeneration,
        hostReceiptDigest: adopted.receiptHash,
      }),
    ).toThrow();
    expect(() =>
      value.coordinator.ackApprovalLease({
        sessionId: created.sessionId,
        leaseId: issued.lease.leaseId,
        hostPrincipalId: created.hostPrincipalId,
        expectedHostMembershipEpoch: "2",
        expectedCreatedGeneration: issued.lease.createdGeneration,
        hostReceiptDigest: adopted.receiptHash,
      }),
    ).toThrow();
    const acked = value.coordinator.ackApprovalLease({
      sessionId: created.sessionId,
      leaseId: issued.lease.leaseId,
      hostPrincipalId: created.hostPrincipalId,
      expectedHostMembershipEpoch: created.membershipEpoch,
      expectedCreatedGeneration: issued.lease.createdGeneration,
      hostReceiptDigest: adopted.receiptHash,
    });
    const exact = consumeArgs(created, joined, issued, acked);
    expect(() =>
      value.coordinator.consumeApprovalLease({
        ...exact,
        fingerprint: `${exact.fingerprint.slice(0, -1)}0`,
      }),
    ).toThrow();
    expect(() =>
      value.coordinator.consumeApprovalLease({
        ...exact,
        binding: `${exact.binding.slice(0, -1)}0`,
      }),
    ).toThrow();
    expect(value.coordinator.consumeApprovalLease(exact)).toMatchObject({
      dispatchAuthorized: true,
      lease: { status: "consumed" },
    });
  });

  it("returns the original durable receipt on statement replay and rejects an ACK for any other host receipt", () => {
    const value = fixture();
    const created = createSession(value);
    const joined = joinDevice(value, created);
    const issued = createLease(value, created, joined, "receipt-binding");
    const original = value.host.adopt(issued.statement, {
      expectedKind: "lease.created",
    });
    const checkpoint = value.coordinator.snapshotSession(created.sessionId);
    value.host.adopt(checkpoint.statement, {
      expectedKind: "session.snapshot",
    });
    const replayed = value.host.adopt(issued.statement, {
      expectedKind: "lease.created",
    });
    expect(replayed).toMatchObject({
      adopted: false,
      replayed: true,
      receiptRevision: original.receiptRevision,
      receiptHash: original.receiptHash,
    });

    const wrongAck = value.coordinator.ackApprovalLease({
      sessionId: created.sessionId,
      leaseId: issued.lease.leaseId,
      hostPrincipalId: created.hostPrincipalId,
      expectedHostMembershipEpoch: created.membershipEpoch,
      expectedCreatedGeneration: issued.lease.createdGeneration,
      hostReceiptDigest: "0".repeat(64),
    });
    expect(() =>
      value.host.adopt(wrongAck.statement, { expectedKind: "lease.acked" }),
    ).toThrow();
    expect(value.host.getLease(issued.lease.leaseId)).toMatchObject({
      status: "active",
    });
  });

  it("allows only the current host epoch to cancel an unconsumed lease", () => {
    const value = fixture();
    const created = createSession(value);
    const joined = joinDevice(value, created);
    const issued = createLease(value, created, joined);
    expect(() =>
      value.coordinator.cancelApprovalLease({
        sessionId: created.sessionId,
        leaseId: issued.lease.leaseId,
        hostPrincipalId: joined.principalId,
        expectedHostMembershipEpoch: created.membershipEpoch,
        reason: "wrong-host",
      }),
    ).toThrow();
    expect(() =>
      value.coordinator.cancelApprovalLease({
        sessionId: created.sessionId,
        leaseId: issued.lease.leaseId,
        hostPrincipalId: created.hostPrincipalId,
        expectedHostMembershipEpoch: "2",
        reason: "stale-host-epoch",
      }),
    ).toThrow();
    expect(
      value.coordinator.cancelApprovalLease({
        sessionId: created.sessionId,
        leaseId: issued.lease.leaseId,
        hostPrincipalId: created.hostPrincipalId,
        expectedHostMembershipEpoch: created.membershipEpoch,
        reason: "host-cancelled",
      }).lease,
    ).toMatchObject({ status: "cancelled", cancelReason: "host-cancelled" });
  });

  it("fails closed when the host clock rolls behind its durable receipt time", () => {
    const value = fixture();
    const created = createSession(value);
    const joined = joinDevice(value, created);
    const issued = createLease(value, created, joined);
    value.setNow(2_000);
    adoptAndAck(value, created, issued);
    value.setNow(1_999);
    expect(() =>
      value.host.requireConsumableLease(issued.lease.leaseId),
    ).toThrow(
      expect.objectContaining({ code: REMOTE_MEMBERSHIP_HOST_ROLLBACK_CODE }),
    );
  });

  it("linearizes revoke against ACK and consume with exactly one winning transition", () => {
    const revokeFirst = fixture();
    const createdA = createSession(revokeFirst);
    const joinedA = joinDevice(revokeFirst, createdA);
    const issuedA = createLease(revokeFirst, createdA, joinedA);
    const receiptA = revokeFirst.host.adopt(issuedA.statement, {
      expectedKind: "lease.created",
    });
    const peerA = new DurableRemoteMembershipCoordinator({
      ...revokeFirst.coordinatorPaths,
      now: () => revokeFirst.getNow(),
    });
    peerA.revokeMember({
      sessionId: createdA.sessionId,
      principalId: joinedA.principalId,
      hostPrincipalId: createdA.hostPrincipalId,
      expectedSessionEpoch: createdA.sessionEpoch,
      expectedMembershipEpoch: joinedA.membershipEpoch,
      expectedHostMembershipEpoch: createdA.membershipEpoch,
    });
    expect(() =>
      revokeFirst.coordinator.ackApprovalLease({
        sessionId: createdA.sessionId,
        leaseId: issuedA.lease.leaseId,
        hostPrincipalId: createdA.hostPrincipalId,
        expectedHostMembershipEpoch: createdA.membershipEpoch,
        expectedCreatedGeneration: issuedA.lease.createdGeneration,
        hostReceiptDigest: receiptA.receiptHash,
      }),
    ).toThrow();

    const consumeFirst = fixture();
    const createdB = createSession(consumeFirst);
    const joinedB = joinDevice(consumeFirst, createdB);
    const issuedB = createLease(consumeFirst, createdB, joinedB);
    const { acked: ackedB } = adoptAndAck(consumeFirst, createdB, issuedB);
    const peerB = new DurableRemoteMembershipCoordinator({
      ...consumeFirst.coordinatorPaths,
      now: () => consumeFirst.getNow(),
    });
    expect(
      consumeFirst.coordinator.consumeApprovalLease(
        consumeArgs(createdB, joinedB, issuedB, ackedB),
      ),
    ).toMatchObject({ dispatchAuthorized: true });
    expect(
      peerB.revokeMember({
        sessionId: createdB.sessionId,
        principalId: joinedB.principalId,
        hostPrincipalId: createdB.hostPrincipalId,
        expectedSessionEpoch: createdB.sessionEpoch,
        expectedMembershipEpoch: joinedB.membershipEpoch,
        expectedHostMembershipEpoch: createdB.membershipEpoch,
      }).cancelledLeaseIds,
    ).toEqual([]);
  });

  it("quarantines unknown coordinator and host commits, then reconciles exact prepared state after restart", () => {
    const value = fixture();
    const created = createSession(value);
    let failCoordinator = false;
    const crashyCoordinator = new DurableRemoteMembershipCoordinator({
      ...value.coordinatorPaths,
      now: () => value.getNow(),
      faultHooks: {
        afterStateCommit() {
          if (failCoordinator) throw new Error("simulated coordinator crash");
        },
      },
    });
    const credential = createRemoteMembershipPrincipalCredential();
    const challenge = crashyCoordinator.issueMemberJoinChallenge({
      sessionId: created.sessionId,
      expectedSessionEpoch: created.sessionEpoch,
      scopes: ["observe", "approve"],
      capabilities: ["approval-binding-v1"],
      credentialPublicKey: credential.publicKey,
      connectionNonce: "unknown-commit",
    });
    failCoordinator = true;
    expect(() =>
      crashyCoordinator.joinMember({
        challengeId: challenge.challengeId,
        connectionNonce: "unknown-commit",
        signature: signRemoteMembershipAuthenticationChallenge(
          challenge,
          credential.privateKeyPkcs8,
        ),
      }),
    ).toThrow(
      expect.objectContaining({
        code: REMOTE_MEMBERSHIP_COORDINATOR_UNAVAILABLE_CODE,
        commitState: "unknown",
      }),
    );
    expect(() => crashyCoordinator.snapshotSession(created.sessionId)).toThrow(
      expect.objectContaining({ commitState: "unknown" }),
    );
    const recoveredCoordinator = new DurableRemoteMembershipCoordinator({
      ...value.coordinatorPaths,
      now: () => value.getNow(),
    });
    const recoveredSnapshot = recoveredCoordinator.snapshotSession(
      created.sessionId,
    );
    expect(recoveredSnapshot.session.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          principalId: challenge.principalId,
          status: "active",
        }),
      ]),
    );
    value.host.adopt(recoveredSnapshot.statement, {
      expectedKind: "session.snapshot",
    });

    const joined = {
      principalId: challenge.principalId,
      membershipEpoch: challenge.membershipEpoch,
    };
    const issued = createLease(value, created, joined, "host-unknown-commit");
    let failHost = true;
    const crashyHost = new DurableRemoteMembershipHostStore({
      ...value.hostPaths,
      now: () => value.getNow(),
      faultHooks: {
        afterStateCommit() {
          if (failHost) throw new Error("simulated host crash");
        },
      },
    });
    expect(() =>
      crashyHost.adopt(issued.statement, { expectedKind: "lease.created" }),
    ).toThrow(
      expect.objectContaining({
        code: REMOTE_MEMBERSHIP_HOST_UNAVAILABLE_CODE,
        commitState: "unknown",
      }),
    );
    expect(() => crashyHost.inspect()).toThrow(
      expect.objectContaining({ commitState: "unknown" }),
    );
    failHost = false;
    const recoveredHost = new DurableRemoteMembershipHostStore({
      ...value.hostPaths,
      now: () => value.getNow(),
    });
    expect(recoveredHost.getLease(issued.lease.leaseId)).toMatchObject({
      status: "active",
    });
  });

  it("keeps bootstrap immutable across host instances and rejects a mismatched private credential", () => {
    const value = fixture();
    const created = createSession(value);
    const peer = new DurableRemoteMembershipHostStore({
      ...value.hostPaths,
      now: () => value.getNow(),
    });
    expect(
      peer.recordBootstrap({
        ...value.host.getBootstrap(),
        statement: created.statement,
      }),
    ).toMatchObject({
      sessionId: created.sessionId,
      hostPrincipalId: created.hostPrincipalId,
    });
    const competingCredential = createRemoteMembershipPrincipalCredential();
    const competing = value.coordinator.createSession({
      sessionId: "other-session",
      agentSessionId: "agent-1",
      scopes: ["observe", "approve"],
      expiresAt: 100_000,
      hostCredentialPublicKeySpki: competingCredential.publicKey,
    });
    expect(() =>
      peer.recordBootstrap({
        coordinatorId: competing.trust.coordinatorId,
        sessionId: competing.sessionId,
        agentSessionId: "agent-1",
        hostPrincipalId: competing.hostPrincipalId,
        hostCredentialPublicKeySpki: competing.hostCredentialPublicKeySpki,
        hostCredentialPrivateKeyPkcs8: competingCredential.privateKeyPkcs8,
        statement: competing.statement,
      }),
    ).toThrow(/already exists/);
    const otherCredential = createRemoteMembershipPrincipalCredential();
    const emptyHost = fixture();
    const emptyCreated = emptyHost.coordinator.createSession({
      sessionId: "credential-mismatch",
      agentSessionId: "agent-1",
      scopes: ["observe", "approve"],
      expiresAt: 100_000,
      hostCredentialPublicKeySpki: otherCredential.publicKey,
    });
    emptyHost.host.pinTrust(emptyCreated.trust);
    expect(() =>
      emptyHost.host.recordBootstrap({
        coordinatorId: emptyCreated.trust.coordinatorId,
        sessionId: emptyCreated.sessionId,
        agentSessionId: "agent-1",
        hostPrincipalId: emptyCreated.hostPrincipalId,
        hostCredentialPublicKeySpki: otherCredential.publicKey,
        hostCredentialPrivateKeyPkcs8: created.hostCredential.privateKeyPkcs8,
        statement: emptyCreated.statement,
      }),
    ).toThrow(
      expect.objectContaining({ code: REMOTE_MEMBERSHIP_HOST_TRUST_CODE }),
    );
  });

  it("serializes real multi-process revoke-vs-ACK and revoke-vs-consume races", async () => {
    const ackRace = fixture();
    const createdA = createSession(ackRace);
    const joinedA = joinDevice(ackRace, createdA);
    const issuedA = createLease(ackRace, createdA, joinedA, "mp-ack-race");
    const receiptA = ackRace.host.adopt(issuedA.statement, {
      expectedKind: "lease.created",
    });
    const ackBarrier = path.join(ackRace.coordinatorRoot, "ack-race.go");
    const [ackOutcome, ackRevokeOutcome] = await raceWorkers(
      [
        {
          target: "coordinator",
          paths: ackRace.coordinatorPaths,
          now: ackRace.getNow(),
          method: "ackApprovalLease",
          args: {
            sessionId: createdA.sessionId,
            leaseId: issuedA.lease.leaseId,
            hostPrincipalId: createdA.hostPrincipalId,
            expectedHostMembershipEpoch: createdA.membershipEpoch,
            expectedCreatedGeneration: issuedA.lease.createdGeneration,
            hostReceiptDigest: receiptA.receiptHash,
          },
        },
        {
          target: "coordinator",
          paths: ackRace.coordinatorPaths,
          now: ackRace.getNow(),
          method: "revokeMember",
          args: {
            sessionId: createdA.sessionId,
            principalId: joinedA.principalId,
            hostPrincipalId: createdA.hostPrincipalId,
            expectedSessionEpoch: createdA.sessionEpoch,
            expectedMembershipEpoch: joinedA.membershipEpoch,
            expectedHostMembershipEpoch: createdA.membershipEpoch,
          },
        },
      ],
      ackBarrier,
    );
    expect(ackRevokeOutcome.ok).toBe(true);
    expect([true, false]).toContain(ackOutcome.ok);
    const afterAckRace = new DurableRemoteMembershipCoordinator({
      ...ackRace.coordinatorPaths,
      now: () => ackRace.getNow(),
    }).snapshotSession(createdA.sessionId).session;
    expect(
      afterAckRace.leases.find(
        (lease) => lease.leaseId === issuedA.lease.leaseId,
      ),
    ).toMatchObject({
      status: "cancelled",
      cancelReason: "membership-revoked",
    });

    const consumeRace = fixture();
    const createdB = createSession(consumeRace);
    const joinedB = joinDevice(consumeRace, createdB);
    const issuedB = createLease(
      consumeRace,
      createdB,
      joinedB,
      "mp-consume-race",
    );
    const { acked: ackedB } = adoptAndAck(consumeRace, createdB, issuedB);
    const consumeBarrier = path.join(
      consumeRace.coordinatorRoot,
      "consume-race.go",
    );
    const [consumeOutcome, consumeRevokeOutcome] = await raceWorkers(
      [
        {
          target: "coordinator",
          paths: consumeRace.coordinatorPaths,
          now: consumeRace.getNow(),
          method: "consumeApprovalLease",
          args: consumeArgs(createdB, joinedB, issuedB, ackedB),
        },
        {
          target: "coordinator",
          paths: consumeRace.coordinatorPaths,
          now: consumeRace.getNow(),
          method: "revokeMember",
          args: {
            sessionId: createdB.sessionId,
            principalId: joinedB.principalId,
            hostPrincipalId: createdB.hostPrincipalId,
            expectedSessionEpoch: createdB.sessionEpoch,
            expectedMembershipEpoch: joinedB.membershipEpoch,
            expectedHostMembershipEpoch: createdB.membershipEpoch,
          },
        },
      ],
      consumeBarrier,
    );
    expect(consumeRevokeOutcome.ok).toBe(true);
    const afterConsumeRace = new DurableRemoteMembershipCoordinator({
      ...consumeRace.coordinatorPaths,
      now: () => consumeRace.getNow(),
    }).snapshotSession(createdB.sessionId).session;
    const terminalLease = afterConsumeRace.leases.find(
      (lease) => lease.leaseId === issuedB.lease.leaseId,
    );
    expect(["consumed", "cancelled"]).toContain(terminalLease.status);
    expect(consumeOutcome.ok).toBe(terminalLease.status === "consumed");
    if (terminalLease.status === "consumed") {
      expect(consumeRevokeOutcome.result.cancelledLeaseIds).toEqual([]);
    } else {
      expect(consumeRevokeOutcome.result.cancelledLeaseIds).toEqual([
        issuedB.lease.leaseId,
      ]);
    }
  });

  it("allows exactly one signed bootstrap to win a real multi-process host race", async () => {
    const value = fixture();
    const firstCredential = createRemoteMembershipPrincipalCredential();
    const secondCredential = createRemoteMembershipPrincipalCredential();
    const first = value.coordinator.createSession({
      sessionId: "bootstrap-race-first",
      agentSessionId: "agent-1",
      scopes: ["observe", "approve"],
      expiresAt: 100_000,
      hostCredentialPublicKeySpki: firstCredential.publicKey,
    });
    const second = value.coordinator.createSession({
      sessionId: "bootstrap-race-second",
      agentSessionId: "agent-1",
      scopes: ["observe", "approve"],
      expiresAt: 100_000,
      hostCredentialPublicKeySpki: secondCredential.publicKey,
    });
    value.host.pinTrust(first.trust);
    const barrier = path.join(value.hostRoot, "bootstrap-race.go");
    const outcomes = await raceWorkers(
      [
        {
          target: "host",
          paths: value.hostPaths,
          now: value.getNow(),
          method: "recordBootstrap",
          args: {
            coordinatorId: first.trust.coordinatorId,
            sessionId: first.sessionId,
            agentSessionId: "agent-1",
            hostPrincipalId: first.hostPrincipalId,
            hostCredentialPublicKeySpki: first.hostCredentialPublicKeySpki,
            hostCredentialPrivateKeyPkcs8: firstCredential.privateKeyPkcs8,
            statement: first.statement,
          },
        },
        {
          target: "host",
          paths: value.hostPaths,
          now: value.getNow(),
          method: "recordBootstrap",
          args: {
            coordinatorId: second.trust.coordinatorId,
            sessionId: second.sessionId,
            agentSessionId: "agent-1",
            hostPrincipalId: second.hostPrincipalId,
            hostCredentialPublicKeySpki: second.hostCredentialPublicKeySpki,
            hostCredentialPrivateKeyPkcs8: secondCredential.privateKeyPkcs8,
            statement: second.statement,
          },
        },
      ],
      barrier,
    );
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.filter((outcome) => !outcome.ok)).toHaveLength(1);
    const winningSessionId = outcomes.find((outcome) => outcome.ok).result
      .sessionId;
    expect(
      new DurableRemoteMembershipHostStore({
        ...value.hostPaths,
        now: () => value.getNow(),
      }).getBootstrap().sessionId,
    ).toBe(winningSessionId);
  });

  it("settles and reaps a worker failure without leaving a live child", async () => {
    const value = fixture();
    const barrier = path.join(value.coordinatorRoot, "failure-race.go");
    const [outcome] = await raceWorkers(
      [
        {
          target: "coordinator",
          paths: value.coordinatorPaths,
          now: value.getNow(),
          method: "missingOperation",
          args: {},
        },
      ],
      barrier,
    );
    expect(outcome).toMatchObject({ ok: false });
    expect(activeWorkers.size).toBe(0);
  });
});
