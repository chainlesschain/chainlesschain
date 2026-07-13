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
import {
  fingerprintsMatch,
  OperationApprovalRegistry,
} from "./operation-fingerprint.js";
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
    // §8.2 cross-device approval registry: full-tuple operation fingerprints,
    // single-winner across concurrent cards for one logical operation, at-most-
    // once resolution, and validity-window enforcement — all fail-closed.
    this._registry = new OperationApprovalRegistry({
      clock: () => this._now(),
    });
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
    // Confused-deputy guard: a resolve that echoes a fingerprint must match the
    // operation this ask published. A mismatch (stale card / replayed / swapped
    // body / different session·workspace·env·policy) is rejected — the ask stays
    // pending and fails closed on timeout. An absent fingerprint is a legacy
    // device: resolved via this ask's own fingerprint (still window-guarded).
    if (
      message.event.fingerprint != null &&
      !fingerprintsMatch(pending.fingerprint, message.event.fingerprint)
    ) {
      return;
    }
    // Fail-closed §8.2 enforcement: single-winner (superseded card), at-most-once
    // (duplicate), and validity window (not-yet-valid / expired). A rejected
    // verdict leaves the ask pending so it still fails closed on timeout.
    const verdict = this._registry.resolve(pending.fingerprint, {
      now: this._now(),
    });
    if (!verdict.ok) return;
    this._pending.delete(requestId);
    clearTimeout(pending.timer);
    const answer = message.event.answer ?? message.event.approved;
    pending.resolve({
      approved: answer === true || answer === "true" || answer === "yes",
      via: "remote",
      from: message.from || null,
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
    const card = this._registry.issue(desc);
    if (onRequestId) {
      try {
        onRequestId(requestId);
      } catch {
        // observer only
      }
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
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
    this._pending.delete(requestId);
    clearTimeout(pending.timer);
    // Consume the registry card so a late remote resolve for the SAME operation
    // is a `duplicate`, never a second settle.
    this._registry.resolve(pending.fingerprint, { now: this._now() });
    pending.resolve({ approved, via: "local", from: null });
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
      if (decision.via === "local" && requestId) {
        this.resolveLocally(requestId, decision.approved);
      }
      return decision.approved;
    };
  }

  async close() {
    this._closed = true;
    for (const [requestId, pending] of this._pending) {
      clearTimeout(pending.timer);
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
