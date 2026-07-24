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
import { OperationApprovalRegistry } from "./operation-fingerprint.js";
import {
  buildDirectPairingUri,
  pickLanAddress,
  renderQrCode,
  resolveRemoteControlOptions,
} from "./remote-control.js";

const DEFAULT_DECISION_TIMEOUT_MS = 5 * 60 * 1000;

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
    this.client.onEvent((message) => this._onServerEvent(message));
    const created = await this.client.request("remote-session-create", {
      sessionId: this.agentSessionId,
      name: this.name,
      scopes: this.scopes,
    });
    this.remoteSessionId = created.session.sessionId;
    this.pairing = created.pairing;
    return this;
  }

  /**
   * Pairing descriptor for devices. Relay-configured servers return a ready
   * E2EE URI; otherwise build the direct-LAN URI from the caller's endpoint.
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
      });
    return {
      uri,
      remoteSessionId: this.remoteSessionId,
      scopes: this.pairing.scopes,
      expiresAt: this.pairing.expiresAt,
    };
  }

  _onServerEvent(message) {
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
    const authority = {
      origin: ORIGIN.REMOTE,
      authenticated: true,
      scopes: ["approve"],
      principalId: message.from || "paired-device",
      sessionId: this.agentSessionId,
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
        this._settleDeniedForStateFailure(requestId, pending, verdict);
      }
      return;
    }
    this._pending.delete(requestId);
    clearTimeout(pending.timer);
    pending.resolve({
      approved: verdict.ok === true && verdict.approved === true,
      via: "remote",
      from: message.from || null,
    });
  }

  _settleDeniedForStateFailure(requestId, pending, verdict) {
    this._pending.delete(requestId);
    clearTimeout(pending.timer);
    pending.resolve({
      approved: false,
      via: "state-error",
      from: null,
      errorCode: verdict?.errorCode || null,
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
    workspace = null,
    session = null,
    targetEnv = null,
    policyVersion = null,
    timeoutMs,
    onRequestId = null,
  } = {}) {
    const requestId = `ra-${process.pid}-${++this._counter}-${randomBytes(4).toString("hex")}`;
    const askedAt = this._now();
    const effectiveTimeout = timeoutMs || this.decisionTimeoutMs;
    // §8.2 full-tuple descriptor: the fingerprint binds tool + params + target
    // env + workspace + session + policy version + validity window, so an
    // approval never carries over to a different operation OR a changed context.
    // The validity window rides the ask lifetime — a resolve after it expires is
    // rejected `expired`.
    const desc = {
      toolName: tool,
      params: detail,
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
    const binding = approvalBindingDigest({
      toolCallId: requestId,
      args: {
        tool: tool || null,
        action,
        detail,
        workspace,
        session: desc.session,
        targetEnv,
      },
      policyDigest: policyVersion,
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
      this._publish({
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
      });
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
        this._settleDeniedForStateFailure(requestId, pending, verdict);
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
            : ctx?.args
              ? JSON.stringify(ctx.args).slice(0, 2000)
              : null,
        // §8.2 context that binds the fingerprint (session defaults to this
        // bridge's agent session inside requestDecision).
        workspace: ctx?.cwd || ctx?.workspace || null,
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
      let requestId = null;
      const remote = this.requestDecision({
        ...ask,
        timeoutMs,
        onRequestId: (id) => {
          requestId = id;
        },
      });
      if (!fallback) {
        const decision = await remote;
        return decision.approved;
      }
      const local = Promise.resolve()
        .then(() => fallback(ctx))
        .then((approved) => ({ approved: approved === true, via: "local" }));
      const decision = await Promise.race([remote, local]);
      // Local answer won → settle the remote ask too (publishes
      // permission.resolved so device UIs clear the pending card).
      if (decision.via === "local") {
        if (!requestId) return false;
        const persisted = this.resolveLocally(requestId, decision.approved);
        return persisted && decision.approved === true;
      }
      return decision.approved === true;
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
        await this.client
          .request("remote-session-close", {
            remoteSessionId: this.remoteSessionId,
          })
          .catch(() => undefined);
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
 * gate confirmer + teardown. Relay settings (env/config) flow through, so a
 * configured relay yields an E2EE pairing URI reaching devices off-LAN.
 */
export async function startHeadlessRemoteApproval({
  agentSessionId,
  env = process.env,
  config = {},
  writeErr = () => {},
  isText = false,
  decisionTimeoutMs = undefined,
  deps = {},
} = {}) {
  const { ChainlessChainWSServer } =
    deps.serverModule || (await import("../gateways/ws/ws-server.js"));
  const resolved = resolveRemoteControlOptions({ flags: {}, env, config });
  const server = new ChainlessChainWSServer({
    port: 0,
    host: resolved.host,
    token: resolved.token,
    remoteSessionRelayUrl: resolved.relayUrl,
    remoteSessionPeerId: resolved.peerId,
  });
  await server.start();
  const bridge = new RemoteApprovalBridge({
    wsUrl: `ws://127.0.0.1:${server.port}`,
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
  const lanAddress = deps.lanAddress || pickLanAddress() || "127.0.0.1";
  const pairing = bridge.pairingInfo({
    lanWsUrl: `ws://${lanAddress}:${server.port}`,
  });
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
    close: async () => {
      await bridge.close().catch(() => undefined);
      await server.stop().catch(() => undefined);
    },
  };
}
