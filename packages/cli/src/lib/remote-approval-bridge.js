/**
 * RemoteApprovalBridge — routes interactive permission asks from a LOCAL
 * agent process (headless run / REPL) to paired mobile/web devices
 * (gap-analysis 第四阶段 #2).
 *
 * The bridge is the remote-session HOST for a client-hosted session: it
 * connects to a cc WS server (self-hosted or `cc remote-control start`),
 * registers a remote session under this process's agent session id, and then
 *
 *   ask:    publishes a `permission.request` runtime event (fan-out delivers
 *           to WS members, E2EE relay members, and triggers vendor push wake —
 *           the event type matches isApprovalRequestEvent).
 *   answer: paired devices publish `approval.resolve`; because the session is
 *           NOT server-hosted, the server forwards it back to this host as a
 *           `remote-session-control` frame (batch-18 protocol extension) and
 *           the bridge settles the pending gate decision.
 *   after:  publishes `permission.resolved` so device UIs can clear the card.
 *
 * `makeConfirmer()` adapts this to the ApprovalGate confirmer contract
 * (`async (ctx) => boolean`) with an optional local fallback racing the
 * remote decision and a fail-closed timeout.
 */

import { randomBytes } from "crypto";
import { WsRpcClient } from "./ws-rpc-client.js";
import { ORIGIN, approvalBindingDigest } from "./agent-authority.js";
import {
  ApprovalAuthorityStore,
  defaultApprovalAuthorityStatePath,
} from "./approval-authority-store.js";
import {
  computeOperationFingerprint,
  fingerprintsMatch,
  OperationApprovalRegistry,
} from "./operation-fingerprint.js";
import {
  createRemoteMembershipPrincipalCredential,
  REMOTE_MEMBERSHIP_COORDINATOR_UNAVAILABLE_CODE,
  REMOTE_MEMBERSHIP_COORDINATOR_VERSION,
} from "./remote-membership-coordinator.js";
import {
  DurableRemoteMembershipHostStore,
  REMOTE_MEMBERSHIP_HOST_UNAVAILABLE_CODE,
} from "./remote-membership-host-store.js";
import {
  assertDirectWsUrlAllowed,
  buildDirectPairingUri,
  isLoopbackBindHost,
  pickLanAddress,
  renderQrCode,
  resolveRemoteControlOptions,
  resolveRemoteControlWsUrl,
} from "./remote-control.js";
import { logger } from "./logger.js";

const DEFAULT_DECISION_TIMEOUT_MS = 5 * 60 * 1000;
const REMOTE_LEASE_AUTHORIZATION_KIND =
  "chainlesschain.remote-approval-lease-authorization/v1";
const SUPPORTED_REMOTE_LEASE_TOOLS = new Set(["run_shell"]);
const remoteLeaseAuthorizations = new WeakMap();

function buildApprovalBinding({
  requestId,
  tool,
  action,
  params,
  workspace,
  session,
  targetEnv,
  policyVersion,
}) {
  return approvalBindingDigest({
    toolCallId: requestId,
    args: {
      tool: tool || null,
      action: action || null,
      params: params ?? null,
      workspace: workspace || null,
      session: session || null,
      targetEnv: targetEnv || null,
    },
    policyDigest: policyVersion || null,
  });
}

export class RemoteApprovalBridge {
  constructor({
    wsUrl,
    token = null,
    agentSessionId,
    name = null,
    scopes = ["observe", "approve"],
    decisionTimeoutMs = DEFAULT_DECISION_TIMEOUT_MS,
    createClient = null,
    now = Date.now,
    approvalStore = undefined,
    approvalStateFile = null,
    membershipHostStore = undefined,
    membershipHostStateFile = null,
    membershipHostWitnessFile = null,
    membershipHostAuthorityLockFile = null,
    expectedCoordinatorPublicKeySha256 = null,
    onSecurityError = null,
  } = {}) {
    if (!wsUrl) throw new Error("wsUrl is required");
    if (!agentSessionId) throw new Error("agentSessionId is required");
    this.wsUrl = wsUrl;
    this.token = token;
    this.agentSessionId = agentSessionId;
    this.name = name || `approval-bridge:${agentSessionId}`;
    this.scopes = scopes;
    this.decisionTimeoutMs = decisionTimeoutMs;
    this._createClient = createClient || ((url) => new WsRpcClient({ url }));
    this._now = now;
    this.client = null;
    this.remoteSessionId = null;
    this.pairing = null;
    this._pending = new Map(); // requestId → { resolve, timer, fingerprint }
    this._counter = 0;
    this._closed = false;
    this._securityErrors = [];
    this._onSecurityError =
      typeof onSecurityError === "function" ? onSecurityError : null;
    this._membershipHostStore =
      membershipHostStore === undefined
        ? () =>
            new DurableRemoteMembershipHostStore({
              agentSessionId,
              ...(membershipHostStateFile
                ? { stateFile: membershipHostStateFile }
                : {}),
              ...(membershipHostWitnessFile
                ? { witnessFile: membershipHostWitnessFile }
                : {}),
              ...(membershipHostAuthorityLockFile
                ? { authorityLockFile: membershipHostAuthorityLockFile }
                : {}),
              ...(expectedCoordinatorPublicKeySha256
                ? {
                    expectedPublicKeySha256: expectedCoordinatorPublicKeySha256,
                  }
                : {}),
              now: () => this._now(),
            })
        : membershipHostStore;
    const durableStore =
      approvalStore === undefined
        ? new ApprovalAuthorityStore({
            filePath:
              approvalStateFile ||
              defaultApprovalAuthorityStatePath(agentSessionId),
            now: () => this._now(),
          })
        : approvalStore;
    if (
      !durableStore ||
      typeof durableStore.issueRequest !== "function" ||
      typeof durableStore.resolveRequest !== "function" ||
      typeof durableStore.cancelRequest !== "function"
    ) {
      throw new Error(
        "approvalStore must implement issueRequest/resolveRequest/cancelRequest",
      );
    }
    // §8.2 cross-device approval registry: full-tuple operation fingerprints,
    // single-winner across concurrent cards for one logical operation, at-most-
    // once resolution, and validity-window enforcement — all fail-closed.
    this._registry = new OperationApprovalRegistry({
      clock: () => this._now(),
      store: durableStore,
    });
    this._approvalStore = durableStore;
  }

  _requireMembershipHostStore() {
    if (typeof this._membershipHostStore === "function") {
      this._membershipHostStore = this._membershipHostStore();
    }
    if (
      !this._membershipHostStore ||
      typeof this._membershipHostStore.adopt !== "function" ||
      typeof this._membershipHostStore.requireConsumableLease !== "function"
    ) {
      const error = new Error(
        "Durable Remote membership host store is unavailable; remote approval is denied",
      );
      error.code = REMOTE_MEMBERSHIP_HOST_UNAVAILABLE_CODE;
      throw error;
    }
    return this._membershipHostStore;
  }

  _recordSecurityError({ action, requestId = null, reason, errorCode = null }) {
    const entry = {
      timestamp: this._now(),
      action: String(action || "approval"),
      requestId: requestId ? String(requestId) : null,
      reason: String(reason || "rejected"),
      errorCode: errorCode ? String(errorCode) : null,
    };
    this._securityErrors.push(entry);
    if (this._securityErrors.length > 1000) this._securityErrors.shift();
    if (this._onSecurityError) {
      try {
        this._onSecurityError({ ...entry });
      } catch {
        // Observability is advisory; the approval remains denied.
      }
    }
    return entry;
  }

  getSecurityErrors(limit = this._securityErrors.length) {
    const count = Math.max(
      0,
      Math.min(Math.floor(Number(limit) || 0), this._securityErrors.length),
    );
    if (count === 0) return [];
    return this._securityErrors.slice(-count).map((entry) => ({ ...entry }));
  }

  /** Connect, register the client-hosted remote session, start listening. */
  async start() {
    this.client = this._createClient(this.wsUrl);
    await this.client.connect();
    await this.client.auth(this.token);
    this.client.onEvent((message) => {
      Promise.resolve(this._onServerEvent(message)).catch((error) => {
        this._recordSecurityError({
          action: "approval.resolve",
          reason: "host-event-processing-failed",
          errorCode: error?.code || null,
        });
      });
    });
    const hostStore = this._requireMembershipHostStore();
    const bootstrap = hostStore.getBootstrap();
    let pairing = null;
    if (bootstrap) {
      if (bootstrap.agentSessionId !== this.agentSessionId) {
        throw new Error(
          "Durable Remote host bootstrap belongs to another agent session",
        );
      }
      this.remoteSessionId = bootstrap.sessionId;
    } else {
      const credential = createRemoteMembershipPrincipalCredential();
      const created = await this.client.request("remote-session-create", {
        sessionId: this.agentSessionId,
        name: this.name,
        scopes: this.scopes,
        requireDurableMembershipAuthority: true,
        hostCredentialPublicKeySpki: credential.publicKey,
      });
      if (
        created.session?.membershipAuthority !==
          REMOTE_MEMBERSHIP_COORDINATOR_VERSION ||
        typeof created.session?.sessionEpoch !== "string" ||
        !created.bootstrap?.trust ||
        !created.bootstrap?.statement
      ) {
        throw new Error(
          "Remote Session server did not establish a signed durable membership",
        );
      }
      hostStore.pinTrust(created.bootstrap.trust);
      hostStore.recordBootstrap({
        coordinatorId: created.bootstrap.trust.coordinatorId,
        sessionId: created.session.sessionId,
        agentSessionId: this.agentSessionId,
        hostPrincipalId: created.bootstrap.hostPrincipalId,
        hostCredentialPublicKeySpki:
          created.bootstrap.hostCredentialPublicKeySpki,
        hostCredentialPrivateKeyPkcs8: credential.privateKeyPkcs8,
        statement: created.bootstrap.statement,
      });
      hostStore.adopt(created.bootstrap.statement, {
        expectedKind: "session.snapshot",
        expectedSessionId: created.session.sessionId,
      });
      this.remoteSessionId = created.session.sessionId;
      pairing = created.pairing;
    }
    const currentBootstrap = hostStore.getBootstrap();
    let resumed;
    try {
      const challenged = await this.client.request(
        "remote-session-resume-challenge",
        {
          remoteSessionId: this.remoteSessionId,
          principalId: currentBootstrap.hostPrincipalId,
        },
      );
      const signature = hostStore.signAuthenticationChallenge(
        challenged.challenge,
      );
      resumed = await this.client.request("remote-session-resume", {
        remoteSessionId: this.remoteSessionId,
        challengeId: challenged.challenge.challengeId,
        signature,
      });
    } catch (resumeError) {
      if (!bootstrap) throw resumeError;
      const terminal = await this.client.request("remote-session-terminal", {
        remoteSessionId: this.remoteSessionId,
        principalId: currentBootstrap.hostPrincipalId,
      });
      hostStore.adopt(terminal.statement, {
        expectedKind: "session.snapshot",
        expectedSessionId: this.remoteSessionId,
      });
      const challenged = await this.client.request(
        "remote-session-reenable-challenge",
        {
          remoteSessionId: this.remoteSessionId,
          principalId: currentBootstrap.hostPrincipalId,
        },
      );
      const signature = hostStore.signAuthenticationChallenge(
        challenged.challenge,
      );
      resumed = await this.client.request("remote-session-reenable", {
        remoteSessionId: this.remoteSessionId,
        challengeId: challenged.challenge.challengeId,
        signature,
      });
    }
    if (
      resumed.session?.membershipAuthority !==
        REMOTE_MEMBERSHIP_COORDINATOR_VERSION ||
      resumed.member?.principalId !== currentBootstrap.hostPrincipalId
    ) {
      throw new Error("Remote Session host resume binding changed");
    }
    hostStore.adopt(resumed.statement, {
      expectedKind: "session.snapshot",
      expectedSessionId: this.remoteSessionId,
    });
    if (!pairing) {
      const issued = await this.client.request("remote-session-pairing-token", {
        remoteSessionId: this.remoteSessionId,
        scopes: this.scopes,
      });
      pairing = issued.pairing;
    }
    this.pairing = pairing;
    return this;
  }

  /**
   * Pairing descriptor for devices. Relay-configured servers return a ready
   * E2EE URI; otherwise build a direct URI from the explicitly selected
   * loopback/LAN endpoint.
   */
  pairingInfo({ lanWsUrl = null } = {}) {
    if (!this.pairing) return null;
    const uri =
      this.pairing.uri ||
      buildDirectPairingUri({
        wsUrl: lanWsUrl || this.wsUrl,
        serverToken: this.token,
        remoteSessionId: this.remoteSessionId,
        agentSessionId: this.agentSessionId,
        pairingToken: this.pairing.token,
        scopes: this.pairing.scopes,
        expiresAt: this.pairing.expiresAt,
        durableMembership: true,
      });
    return {
      uri,
      mode: this.pairing.uri ? "relay" : "direct",
      remoteSessionId: this.remoteSessionId,
      scopes: this.pairing.scopes,
      expiresAt: this.pairing.expiresAt,
    };
  }

  async _onServerEvent(message) {
    if (
      message?.type !== "remote-session-control" ||
      message.remoteSessionId !== this.remoteSessionId ||
      message.event?.type !== "approval.resolve"
    ) {
      return;
    }
    const requestId = message.event.requestId || message.event.approvalId;
    const pending = requestId ? this._pending.get(requestId) : null;
    if (!pending) return;
    if (message.agentSessionId !== this.agentSessionId) {
      this._recordSecurityError({
        action: "approval.resolve",
        requestId,
        reason: "membership-agent-session-mismatch",
      });
      return;
    }
    if (
      message.membershipAuthority !== REMOTE_MEMBERSHIP_COORDINATOR_VERSION ||
      typeof message.from !== "string" ||
      !message.from ||
      typeof message.sessionEpoch !== "string" ||
      typeof message.membershipEpoch !== "string"
    ) {
      this._recordSecurityError({
        action: "approval.resolve",
        requestId,
        reason: "membership-binding-required",
      });
      return;
    }
    // The device must echo the complete durable capability tuple. Missing,
    // mismatched, stale, duplicate, or expired resolutions never settle an
    // approval; only the store's successful CAS can return approved=true.
    const rawAnswer = message.event.answer ?? message.event.approved;
    const hasDecision =
      rawAnswer === true ||
      rawAnswer === false ||
      rawAnswer === "true" ||
      rawAnswer === "false" ||
      rawAnswer === "yes" ||
      rawAnswer === "no";
    if (!hasDecision) {
      this._recordSecurityError({
        action: "approval.resolve",
        requestId,
        reason: "decision-required",
      });
      return;
    }
    const decision =
      rawAnswer === true || rawAnswer === "true" || rawAnswer === "yes";
    let ackedLease = null;
    // The server creates the lease before forwarding the resolve frame. Keep a
    // strictly request-bound cancellation handle even when durable adoption of
    // that statement fails before it can return a trusted payload.
    let leaseForFailure = this._stateFailureLeaseCandidate(
      message,
      requestId,
      pending,
    );
    try {
      if (decision) {
        if (!message.approvalLeaseStatement) {
          throw new Error(
            "Approved remote response did not carry a signed execution lease",
          );
        }
        const hostStore = this._requireMembershipHostStore();
        const adopted = hostStore.adopt(message.approvalLeaseStatement, {
          expectedKind: "lease.created",
          expectedSessionId: this.remoteSessionId,
        });
        const createdLease = adopted.payload;
        if (
          createdLease.status !== "active" ||
          createdLease.sessionId !== this.remoteSessionId ||
          createdLease.sessionEpoch !== message.sessionEpoch ||
          createdLease.principalId !== message.from ||
          createdLease.membershipEpoch !== message.membershipEpoch ||
          createdLease.requestId !== requestId ||
          !fingerprintsMatch(createdLease.fingerprint, pending.fingerprint) ||
          createdLease.fingerprint !== message.event.fingerprint ||
          createdLease.binding !== pending.binding ||
          createdLease.binding !== message.event.binding ||
          createdLease.expiresAt > pending.descriptor.notAfter
        ) {
          throw new Error(
            "Signed remote execution lease does not match the pending operation",
          );
        }
        leaseForFailure = createdLease;
        const bootstrap = hostStore.getBootstrap();
        if (
          !bootstrap ||
          createdLease.hostPrincipalId !== bootstrap.hostPrincipalId
        ) {
          throw new Error("Signed remote execution lease targets another host");
        }
        const acked = await this.client.request("remote-session-lease-ack", {
          remoteSessionId: this.remoteSessionId,
          leaseId: createdLease.leaseId,
          expectedCreatedGeneration: createdLease.createdGeneration,
          hostReceiptDigest: adopted.receiptHash,
        });
        const ackReceipt = hostStore.adopt(acked.statement, {
          expectedKind: "lease.acked",
          expectedSessionId: this.remoteSessionId,
        });
        ackedLease = ackReceipt.payload;
        leaseForFailure = ackedLease;
        if (
          acked.dispatchAuthorized === true ||
          ackedLease.status !== "acked" ||
          ackedLease.leaseId !== createdLease.leaseId ||
          ackedLease.createdGeneration !== createdLease.createdGeneration ||
          ackedLease.principalId !== createdLease.principalId ||
          ackedLease.membershipEpoch !== createdLease.membershipEpoch ||
          ackedLease.requestId !== createdLease.requestId ||
          ackedLease.fingerprint !== createdLease.fingerprint ||
          ackedLease.binding !== createdLease.binding ||
          ackedLease.expiresAt !== createdLease.expiresAt
        ) {
          throw new Error("Remote execution lease ACK binding changed");
        }
      }
    } catch (error) {
      const verdict = {
        reason: `lease-adopt-or-ack-failed:${error?.cause?.message || error?.message || "unknown"}`,
        errorCode:
          error?.code || REMOTE_MEMBERSHIP_COORDINATOR_UNAVAILABLE_CODE,
      };
      this._recordSecurityError({
        action: "approval.resolve",
        requestId,
        reason: verdict.reason,
        errorCode: verdict.errorCode,
      });
      await this._settleDeniedForStateFailure(requestId, pending, verdict, {
        lease: leaseForFailure,
      });
      return;
    }
    const authority = {
      origin: ORIGIN.REMOTE,
      authenticated: true,
      scopes: ["approve"],
      principalId: message.from,
      sessionId: this.agentSessionId,
      remoteSessionId: this.remoteSessionId,
      sessionEpoch: message.sessionEpoch,
      membershipEpoch: message.membershipEpoch,
    };
    const verdict = this._registry.resolve(pending.fingerprint, {
      requestId,
      fingerprint: message.event.fingerprint,
      binding: message.event.binding,
      sessionId: this.agentSessionId,
      decision,
      authority,
      expectedRevision: message.event.revision,
      now: this._now(),
    });
    if (!verdict.ok) {
      this._recordSecurityError({
        action: "approval.resolve",
        requestId,
        reason: verdict.reason,
        errorCode: verdict.errorCode,
      });
      if (verdict.reason === "state-unavailable") {
        await this._settleDeniedForStateFailure(requestId, pending, verdict, {
          lease: ackedLease,
        });
      } else if (ackedLease) {
        await this._cancelLeaseBestEffort(
          ackedLease,
          `approval-store-${verdict.reason || "rejected"}`,
          {
            requestId,
            fingerprint: pending.fingerprint,
            binding: pending.binding,
            revision: pending.revision,
          },
        );
      }
      return;
    }
    this._pending.delete(requestId);
    clearTimeout(pending.timer);
    pending.resolve({
      approved: verdict.ok === true && verdict.approved === true,
      via: "remote",
      from: message.from || null,
      authorizationRequired: verdict.approved === true,
      ...(verdict.approved === true && ackedLease
        ? {
            authorization: this._createLeaseAuthorization({
              lease: ackedLease,
              descriptor: pending.descriptor,
              action: pending.action,
            }),
          }
        : {}),
    });
  }

  _stateFailureLeaseCandidate(message, requestId, pending) {
    const event = message?.event;
    const lease = message?.approvalLeaseStatement?.payload;
    if (
      !pending ||
      event?.requestId !== requestId ||
      event.fingerprint !== pending.fingerprint ||
      event.binding !== pending.binding ||
      event.revision !== pending.revision ||
      !lease ||
      typeof lease.leaseId !== "string" ||
      !lease.leaseId ||
      lease.status !== "active" ||
      lease.sessionId !== this.remoteSessionId ||
      lease.sessionEpoch !== message.sessionEpoch ||
      lease.principalId !== message.from ||
      lease.membershipEpoch !== message.membershipEpoch ||
      lease.requestId !== requestId ||
      lease.fingerprint !== pending.fingerprint ||
      lease.binding !== pending.binding
    ) {
      return null;
    }
    return structuredClone(lease);
  }

  _leaseMatchesApproval(lease, approval) {
    return Boolean(
      lease &&
      approval &&
      typeof lease.leaseId === "string" &&
      lease.leaseId &&
      Number.isInteger(approval.revision) &&
      approval.revision > 0 &&
      lease.requestId === approval.requestId &&
      lease.fingerprint === approval.fingerprint &&
      lease.binding === approval.binding,
    );
  }

  async _cancelLeaseBestEffort(lease, reason, approval) {
    if (
      !this.client ||
      !this._leaseMatchesApproval(lease, approval) ||
      lease.sessionId !== this.remoteSessionId
    ) {
      this._recordSecurityError({
        action: "lease.cancel",
        requestId: approval?.requestId || lease?.requestId || null,
        reason: "lease-cancel-binding-mismatch",
      });
      return false;
    }
    try {
      const cancelled = await this.client.request(
        "remote-session-lease-cancel",
        {
          remoteSessionId: this.remoteSessionId,
          leaseId: lease.leaseId,
          reason,
          requestId: approval.requestId,
          fingerprint: approval.fingerprint,
          binding: approval.binding,
          approvalRevision: approval.revision,
        },
      );
      const receipt = this._requireMembershipHostStore().adopt(
        cancelled.statement,
        {
          expectedKind: "lease.cancelled",
          expectedSessionId: this.remoteSessionId,
        },
      );
      if (
        receipt.payload.status !== "cancelled" ||
        receipt.payload.leaseId !== lease.leaseId ||
        !this._leaseMatchesApproval(receipt.payload, approval)
      ) {
        throw new Error("Cancelled Remote approval lease binding changed");
      }
      return true;
    } catch (error) {
      // The cancel RPC may have committed while its response (or the local
      // cancellation receipt) failed. Reconcile from a signed session snapshot
      // before declaring the terminal outcome unknown. This also lets a host
      // that missed `lease.created` adopt the final cancelled lease directly.
      try {
        const snapshot = await this._refreshMembershipSnapshot();
        const observed = snapshot.payload.leases.find(
          (candidate) => candidate.leaseId === lease.leaseId,
        );
        if (
          observed &&
          !["active", "acked"].includes(observed.status) &&
          this._leaseMatchesApproval(observed, approval)
        ) {
          return true;
        }
      } catch {
        // Report the original cancellation failure below. The approval itself
        // still settles denied; no authorization handle is ever returned.
      }
      this._recordSecurityError({
        action: "lease.cancel",
        requestId: approval.requestId,
        reason: "lease-cancel-unknown",
        errorCode: error?.code || null,
      });
      return false;
    }
  }

  _createLeaseAuthorization({ lease, descriptor, action }) {
    const authorization = Object.freeze({
      kind: REMOTE_LEASE_AUTHORIZATION_KIND,
    });
    remoteLeaseAuthorizations.set(
      authorization,
      Object.freeze({
        lease: structuredClone(lease),
        descriptor: structuredClone(descriptor),
        action: action ?? null,
      }),
    );
    return authorization;
  }

  _cancelApprovalForStateFailure(requestId, pending) {
    let cancellation;
    try {
      cancellation = this._registry.cancel(pending.fingerprint, {
        requestId,
        fingerprint: pending.fingerprint,
        binding: pending.binding,
        expectedRevision: pending.revision,
        reason: "state-failure",
        now: this._now(),
      });
    } catch (error) {
      cancellation = {
        ok: false,
        reason: "state-unavailable",
        errorCode: error?.code || "CC_APPROVAL_STATE_UNKNOWN",
      };
    }
    if (cancellation.ok) return true;

    // A failed resolve may have committed before reporting an unknown write
    // outcome. Accept that only as an exact, one-revision terminal record; a
    // mismatched request/fingerprint/binding never counts as cleanup.
    let terminal = false;
    try {
      const record = this._approvalStore?.getRequest?.(requestId, {
        bestEffort: false,
      });
      terminal = Boolean(
        record &&
        record.requestId === requestId &&
        record.fingerprint === pending.fingerprint &&
        record.binding === pending.binding &&
        record.revision === pending.revision + 1 &&
        ["cancelled", "expired", "resolved", "rejected"].includes(
          record.status,
        ),
      );
    } catch {
      terminal = false;
    }
    if (!terminal) {
      this._recordSecurityError({
        action: "approval.cancel",
        requestId,
        reason: cancellation.reason || "state-unavailable",
        errorCode: cancellation.errorCode || null,
      });
    }
    return terminal;
  }

  async _settleDeniedForStateFailure(
    requestId,
    pending,
    verdict,
    { lease = null } = {},
  ) {
    if (!pending || this._pending.get(requestId) !== pending) return false;
    this._pending.delete(requestId);
    clearTimeout(pending.timer);
    this._cancelApprovalForStateFailure(requestId, pending);
    if (lease) {
      await this._cancelLeaseBestEffort(
        lease,
        `approval-state-${verdict?.reason || "failure"}`,
        {
          requestId,
          fingerprint: pending.fingerprint,
          binding: pending.binding,
          revision: pending.revision,
        },
      );
    }
    pending.resolve({
      approved: false,
      via: "state-error",
      from: null,
      errorCode: verdict?.errorCode || null,
    });
    return true;
  }

  async _refreshMembershipSnapshot() {
    const result = await this.client.request(
      "remote-session-membership-snapshot",
      { remoteSessionId: this.remoteSessionId },
    );
    return this._requireMembershipHostStore().adopt(result.statement, {
      expectedKind: "session.snapshot",
      expectedSessionId: this.remoteSessionId,
    });
  }

  /** Number of devices that can approve (excludes this host). */
  async approverCount() {
    try {
      const devices = await this.client.request("remote-session-devices", {
        remoteSessionId: this.remoteSessionId,
      });
      return (devices.devices || []).filter(
        (device) => !device.isHost && device.scopes?.includes("approve"),
      ).length;
    } catch {
      return 0;
    }
  }

  /**
   * Publish a permission ask to paired devices and await the decision.
   * Resolves `{approved, via, from}`; times out fail-closed (`approved:false,
   * via:"timeout"`). The `permission.request` type triggers vendor push wake.
   */
  requestDecision({
    tool,
    action = null,
    detail = null,
    operationArgs = undefined,
    workspace = null,
    session = null,
    targetEnv = null,
    policyVersion = null,
    timeoutMs,
    onRequestId = null,
  } = {}) {
    if (!SUPPORTED_REMOTE_LEASE_TOOLS.has(tool)) {
      return Promise.resolve({
        approved: false,
        via: "lease-unavailable",
        from: null,
      });
    }
    const requestId = `ra-${process.pid}-${++this._counter}-${randomBytes(4).toString("hex")}`;
    const askedAt = this._now();
    const effectiveTimeout = timeoutMs || this.decisionTimeoutMs;
    // §8.2 full-tuple descriptor: the fingerprint binds tool + params + target
    // env + workspace + session + policy version + validity window, so an
    // approval never carries over to a different operation OR a changed context.
    // The validity window rides the ask lifetime — a resolve after it expires is
    // rejected `expired`.
    const params =
      operationArgs === undefined ? detail : structuredClone(operationArgs);
    const desc = {
      toolName: tool,
      params,
      workspace,
      session: session || this.agentSessionId,
      targetEnv,
      policyVersion,
      notBefore: askedAt,
      notAfter:
        Number.isFinite(askedAt) && Number.isFinite(effectiveTimeout)
          ? askedAt + effectiveTimeout
          : null,
    };
    const binding = buildApprovalBinding({
      requestId,
      tool,
      action,
      params,
      workspace,
      session: desc.session,
      targetEnv,
      policyVersion,
    });
    let card;
    try {
      // Persist first. A card that was not durably issued must never become
      // visible to a device and can therefore never authorize a side effect.
      card = this._registry.issue(desc, {
        requestId,
        binding,
        now: askedAt,
      });
    } catch (error) {
      const errorCode = error?.code || "CC_APPROVAL_STATE_UNKNOWN";
      this._recordSecurityError({
        action: "approval.request",
        requestId,
        reason: "state-unavailable",
        errorCode,
      });
      return Promise.resolve({
        approved: false,
        via: "state-error",
        from: null,
        errorCode,
      });
    }
    if (onRequestId) {
      try {
        onRequestId(requestId);
      } catch {
        // observer only
      }
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const verdict = this._registry.cancel(card.fingerprint, {
          requestId,
          expectedRevision: card.revision,
          reason: "timeout",
          now: this._now(),
        });
        if (!verdict.ok) {
          this._recordSecurityError({
            action: "approval.cancel",
            requestId,
            reason: verdict.reason,
            errorCode: verdict.errorCode,
          });
        }
        this._pending.delete(requestId);
        this._publish({
          type: "permission.resolved",
          requestId,
          approved: false,
          via: "timeout",
        });
        resolve({ approved: false, via: "timeout", from: null });
      }, effectiveTimeout);
      if (typeof timer.unref === "function") timer.unref();
      this._pending.set(requestId, {
        timer,
        fingerprint: card.fingerprint,
        binding,
        revision: card.revision,
        descriptor: structuredClone(desc),
        action,
        resolve: (decision) => {
          this._publish({
            type: "permission.resolved",
            requestId,
            approved: decision.approved,
            via: decision.via,
          });
          resolve(decision);
        },
      });
      const requestEvent = {
        type: "permission.request",
        requestId,
        tool: tool || null,
        action,
        detail,
        // Full fingerprint (protocol) + short id / secret-free summary (what the
        // operator eyeballs on the device to confirm it is the SAME card).
        fingerprint: card.fingerprint,
        binding,
        revision: card.revision,
        shortId: card.shortId,
        summary: card.summary,
        notBefore: desc.notBefore,
        notAfter: desc.notAfter,
        askedAt,
      };
      this._refreshMembershipSnapshot()
        .then(() => {
          if (this._pending.get(requestId)) this._publish(requestEvent);
        })
        .catch(async (error) => {
          const pending = this._pending.get(requestId);
          if (!pending) return;
          this._recordSecurityError({
            action: "approval.request",
            requestId,
            reason: "membership-snapshot-unavailable",
            errorCode: error?.code || null,
          });
          await this._settleDeniedForStateFailure(requestId, pending, {
            errorCode: error?.code || null,
          });
        });
    });
  }

  /**
   * Consume one opaque approval authorization online immediately before the
   * exact side effect is dispatched. Pure/local tuple mismatches leave the
   * handle retryable; it is burned immediately before network I/O so an
   * unknown coordinator outcome can never be retried into a second spawn.
   */
  async consumeAuthorization(authorization, context = {}) {
    const granted = remoteLeaseAuthorizations.get(authorization);
    if (!granted || authorization?.kind !== REMOTE_LEASE_AUTHORIZATION_KIND) {
      throw new Error("Remote approval authorization is invalid or replayed");
    }
    const descriptor = {
      toolName: context.tool || null,
      params: structuredClone(context.args ?? null),
      workspace: context.workspace || null,
      session: context.session || this.agentSessionId,
      targetEnv: context.targetEnv || null,
      policyVersion: context.policyVersion || null,
      notBefore: granted.descriptor.notBefore,
      notAfter: granted.descriptor.notAfter,
    };
    const lease = granted.lease;
    const fingerprint = computeOperationFingerprint(descriptor);
    const binding = buildApprovalBinding({
      requestId: lease.requestId,
      tool: descriptor.toolName,
      action: context.action ?? null,
      params: descriptor.params,
      workspace: descriptor.workspace,
      session: descriptor.session,
      targetEnv: descriptor.targetEnv,
      policyVersion: descriptor.policyVersion,
    });
    if (
      (context.action ?? null) !== (granted.action ?? null) ||
      !fingerprintsMatch(fingerprint, lease.fingerprint) ||
      binding !== lease.binding
    ) {
      throw new Error(
        "Remote approval authorization does not match the dispatch operation",
      );
    }
    const hostStore = this._requireMembershipHostStore();
    const durableLease = hostStore.requireConsumableLease(lease.leaseId);
    const bootstrap = hostStore.getBootstrap();
    if (
      !bootstrap ||
      durableLease.status !== "acked" ||
      durableLease.sessionId !== this.remoteSessionId ||
      durableLease.hostPrincipalId !== bootstrap.hostPrincipalId ||
      durableLease.leaseId !== lease.leaseId ||
      durableLease.sessionEpoch !== lease.sessionEpoch ||
      durableLease.principalId !== lease.principalId ||
      durableLease.membershipEpoch !== lease.membershipEpoch ||
      durableLease.ackedGeneration !== lease.ackedGeneration ||
      durableLease.requestId !== lease.requestId ||
      durableLease.fingerprint !== fingerprint ||
      durableLease.binding !== binding ||
      durableLease.expiresAt !== lease.expiresAt
    ) {
      throw new Error("Durable Remote approval receipt binding changed");
    }
    // Everything above is deterministic local validation. Preserve the
    // opaque handle on a mismatch so the caller can retry the same approved
    // operation tuple. From this point onward the coordinator outcome may be
    // unknown, so burn before issuing the online consume request.
    remoteLeaseAuthorizations.delete(authorization);
    let consumed;
    try {
      consumed = await this.client.request("remote-session-lease-consume", {
        remoteSessionId: this.remoteSessionId,
        leaseId: durableLease.leaseId,
        expectedAckedGeneration: durableLease.ackedGeneration,
        expectedMembershipEpoch: durableLease.membershipEpoch,
        requestId: durableLease.requestId,
        fingerprint: durableLease.fingerprint,
        binding: durableLease.binding,
      });
    } catch (error) {
      this._recordSecurityError({
        action: "lease.consume",
        requestId: durableLease.requestId,
        reason: "consume-outcome-unknown",
        errorCode: error?.code || null,
      });
      throw error;
    }
    if (consumed.dispatchAuthorized !== true || !consumed.statement) {
      throw new Error(
        "Remote coordinator did not return linearized dispatch authority",
      );
    }
    const adopted = hostStore.adopt(consumed.statement, {
      expectedKind: "lease.consumed",
      expectedSessionId: this.remoteSessionId,
    });
    const consumedLease = adopted.payload;
    if (
      consumedLease.status !== "consumed" ||
      consumedLease.leaseId !== durableLease.leaseId ||
      consumedLease.ackedGeneration !== durableLease.ackedGeneration ||
      consumedLease.requestId !== durableLease.requestId ||
      consumedLease.fingerprint !== durableLease.fingerprint ||
      consumedLease.binding !== durableLease.binding
    ) {
      throw new Error("Consumed Remote approval statement binding changed");
    }
    return true;
  }

  /**
   * Revoke one stable device principal through the coordinator and durably
   * adopt the resulting membership epoch before returning to the host UI.
   */
  async revokeMember(principalId) {
    if (!this.client || !this.remoteSessionId) {
      throw new Error("Remote approval bridge is not connected");
    }
    const result = await this.client.request("remote-session-revoke", {
      remoteSessionId: this.remoteSessionId,
      clientId: principalId,
    });
    if (!result.statement) {
      throw new Error(
        "Remote coordinator did not return a signed revocation statement",
      );
    }
    const adopted = this._requireMembershipHostStore().adopt(result.statement, {
      expectedKind: "session.snapshot",
      expectedSessionId: this.remoteSessionId,
    });
    if (
      adopted.payload.members?.find(
        (member) => member.principalId === principalId,
      )?.status !== "revoked"
    ) {
      throw new Error("Signed revocation statement did not revoke the device");
    }
    return Object.freeze({
      principalId,
      authorityGeneration: adopted.authorityGeneration,
      session: result.session,
    });
  }

  /** Settle a pending ask locally (e.g. the terminal user answered first). */
  resolveLocally(requestId, approved) {
    const pending = this._pending.get(requestId);
    if (!pending) return false;
    const verdict = this._registry.resolve(pending.fingerprint, {
      requestId,
      fingerprint: pending.fingerprint,
      binding: pending.binding,
      sessionId: this.agentSessionId,
      decision: approved === true,
      authority: {
        origin: ORIGIN.USER,
        principalId: "local-terminal",
        sessionId: this.agentSessionId,
      },
      expectedRevision: pending.revision,
      now: this._now(),
    });
    if (!verdict.ok) {
      this._recordSecurityError({
        action: "approval.resolve",
        requestId,
        reason: verdict.reason,
        errorCode: verdict.errorCode,
      });
      if (verdict.reason === "state-unavailable") {
        void this._settleDeniedForStateFailure(requestId, pending, verdict);
      }
      return false;
    }
    this._pending.delete(requestId);
    clearTimeout(pending.timer);
    pending.resolve({
      approved: verdict.ok === true && verdict.approved === true,
      via: "local",
      from: null,
    });
    return true;
  }

  _publish(event) {
    if (this._closed || !this.client) return;
    this.client
      .request("remote-session-publish", {
        remoteSessionId: this.remoteSessionId,
        event,
      })
      .catch(() => {
        // Best-effort — a device that missed the request simply cannot answer;
        // the timeout keeps the gate fail-closed.
      });
  }

  /**
   * ApprovalGate confirmer (`async (ctx) => boolean`). With a `fallback`
   * confirmer, the LOCAL prompt races the remote decision (first answer wins);
   * without one (headless), the remote decision alone gates, fail-closed on
   * timeout.
   */
  makeConfirmer({ fallback = null, timeoutMs = null, onAsk = null } = {}) {
    return async (ctx) => {
      const ask = {
        tool: ctx?.tool || ctx?.name || null,
        action: ctx?.action || null,
        detail:
          typeof ctx?.command === "string"
            ? ctx.command
            : typeof ctx?.args?.command === "string"
              ? ctx.args.command
              : null,
        operationArgs:
          ctx?.args !== undefined
            ? structuredClone(ctx.args)
            : typeof ctx?.command === "string"
              ? { command: ctx.command }
              : null,
        // §8.2 context that binds the fingerprint (session defaults to this
        // bridge's agent session inside requestDecision).
        workspace: ctx?.cwd || ctx?.workspace || null,
        session: ctx?.session || ctx?.sessionId || null,
        targetEnv: ctx?.targetEnv || null,
        policyVersion: ctx?.policyVersion || null,
      };
      if (onAsk) {
        try {
          onAsk(ask);
        } catch {
          // observer only
        }
      }
      if (!SUPPORTED_REMOTE_LEASE_TOOLS.has(ask.tool) && fallback) {
        return fallback(ctx);
      }
      let requestId = null;
      const remote = this.requestDecision({
        ...ask,
        timeoutMs,
        onRequestId: (id) => {
          requestId = id;
        },
      });
      if (!fallback) {
        return remote;
      }
      const local = Promise.resolve()
        .then(() => fallback(ctx))
        .then((approved) => ({ approved: approved === true, via: "local" }));
      let decision = await Promise.race([remote, local]);
      if (
        decision.via !== "local" &&
        ["timeout", "closed", "lease-unavailable"].includes(decision.via)
      ) {
        decision = await local;
      }
      // Local answer won → settle the remote ask too (publishes
      // permission.resolved so device UIs clear the pending card).
      if (decision.via === "local") {
        if (!requestId) return false;
        const persisted = this.resolveLocally(requestId, decision.approved);
        return persisted && decision.approved === true;
      }
      return decision;
    };
  }

  async close() {
    this._closed = true;
    for (const [requestId, pending] of this._pending) {
      clearTimeout(pending.timer);
      const verdict = this._registry.cancel(pending.fingerprint, {
        requestId,
        expectedRevision: pending.revision,
        reason: "closed",
        now: this._now(),
      });
      if (!verdict.ok) {
        this._recordSecurityError({
          action: "approval.cancel",
          requestId,
          reason: verdict.reason,
          errorCode: verdict.errorCode,
        });
      }
      pending.resolve({ approved: false, via: "closed", from: null });
      this._pending.delete(requestId);
    }
    try {
      if (this.client && this.remoteSessionId) {
        const closed = await this.client
          .request("remote-session-close", {
            remoteSessionId: this.remoteSessionId,
          })
          .catch(() => null);
        if (closed?.statement) {
          this._requireMembershipHostStore().adopt(closed.statement, {
            expectedKind: "session.snapshot",
            expectedSessionId: this.remoteSessionId,
          });
        }
      }
    } finally {
      this.client?.close();
    }
  }
}

/**
 * One-call assembly for headless runs (`cc agent -p --remote-control`):
 * self-hosts a lightweight WS server on an OS-assigned port (no sessionManager
 * needed — the session stays client-hosted), starts a bridge for this run's
 * session, prints the pairing URI (+ optional QR) to stderr, and returns the
 * gate confirmer + teardown. Relay settings flow through the startup
 * environment; LAN exposure remains a separate explicit caller authority.
 */
export async function startHeadlessRemoteApproval({
  agentSessionId,
  allowLan = false,
  env = process.env,
  config = undefined,
  writeErr = () => {},
  isText = false,
  decisionTimeoutMs = undefined,
  deps = {},
} = {}) {
  let effectiveConfig = config;
  if (effectiveConfig === undefined) {
    try {
      const configModule =
        deps.configModule || (await import("./config-manager.js"));
      effectiveConfig = configModule.loadConfig();
    } catch {
      effectiveConfig = {};
    }
  }
  const resolved = resolveRemoteControlOptions({
    flags: { allowApprove: true, allowLan: allowLan === true },
    env,
    config: effectiveConfig || {},
  });
  if (!resolved.relayUrl && !resolved.lanAccessible) {
    throw new Error(
      "remote approval is loopback-only by default; configure a relay, or enable " +
        "allowLan with a non-loopback host (omit host to use 0.0.0.0) on a trusted network",
    );
  }
  const lanAddress = resolved.lanAccessible
    ? deps.lanAddress ||
      (deps.pickLanAddress ? deps.pickLanAddress() : pickLanAddress())
    : null;
  const preflightLanWsUrl = resolveRemoteControlWsUrl(
    { ...resolved, port: 1 },
    { lanAddress },
  );
  if (
    !resolved.relayUrl &&
    resolved.lanAccessible &&
    isLoopbackBindHost(new URL(preflightLanWsUrl).hostname)
  ) {
    throw new Error(
      "LAN binding is enabled but no private LAN address can be advertised; " +
        "configure a private host or a relay",
    );
  }
  const { ChainlessChainWSServer } =
    deps.serverModule || (await import("../gateways/ws/ws-server.js"));
  const server = new ChainlessChainWSServer({
    port: 0,
    host: resolved.host,
    token: resolved.token,
    remoteSessionRelayUrl: resolved.relayUrl,
    remoteSessionPeerId: resolved.peerId,
  });
  let bridge;
  try {
    await server.start();
    const createBridge =
      deps.createBridge || ((options) => new RemoteApprovalBridge(options));
    bridge = createBridge({
      wsUrl: resolveRemoteControlWsUrl(
        { ...resolved, port: server.port, allowLan: resolved.lanAccessible },
        { lanAddress: null },
      ),
      token: resolved.token,
      agentSessionId,
      scopes: ["observe", "approve"],
      decisionTimeoutMs,
    });
    try {
      await bridge.start();
    } catch (err) {
      await server.stop().catch(() => undefined);
      throw err;
    }
    const lanWsUrl = resolveRemoteControlWsUrl(
      { ...resolved, port: server.port },
      { lanAddress },
    );
    const pairing = bridge.pairingInfo({ lanWsUrl });
    if (pairing?.mode !== "relay" && !resolved.lanAccessible) {
      throw new Error(
        "the configured relay did not provide a pairing URI; refusing to fall back to LAN without explicit allowLan",
      );
    }
    if (pairing?.mode === "direct") {
      if (isLoopbackBindHost(new URL(lanWsUrl).hostname)) {
        throw new Error(
          "LAN binding is enabled but no private LAN address can be advertised",
        );
      }
      assertDirectWsUrlAllowed(lanWsUrl);
      const warn = deps.warn || ((message) => logger.warn(message));
      warn(
        `LAN remote approval enabled on ${resolved.host}:${server.port}. ` +
          "Direct pairing uses plaintext ws:// with bearer credentials; use only on a trusted network.",
      );
    }
    if (!pairing?.uri) {
      throw new Error("remote approval did not produce a pairing URI");
    }
    if (isText) {
      writeErr(
        "  remote-control: approvals can be answered from a paired device\n",
      );
      writeErr(`  pairing: ${pairing.uri}\n`);
      const qr = await renderQrCode(pairing.uri, deps);
      if (qr) writeErr(qr + "\n");
    }
    return {
      pairing,
      server,
      bridge,
      confirmer: bridge.makeConfirmer({
        onAsk: (ask) => {
          if (isText) {
            writeErr(
              `  permission(${ask.tool || "?"}): waiting for remote approval…\n`,
            );
          }
        },
      }),
      consumeAuthorization: (authorization, context) =>
        bridge.consumeAuthorization(authorization, context),
      close: async () => {
        await bridge.close().catch(() => undefined);
        await server.stop().catch(() => undefined);
      },
    };
  } catch (err) {
    if (bridge) {
      await bridge.close().catch(() => undefined);
    }
    await server.stop().catch(() => undefined);
    throw err;
  }
}
