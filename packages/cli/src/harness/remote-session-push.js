// Remote Session push notifications (vendor push).
//
// Wakes a paired device for time-sensitive events (an approval request) even
// when its relay WebSocket is suspended — the case a foreground-only local
// notification can't cover. The actual delivery (FCM / APNs / Xiaomi / Huawei /
// OPPO) is a pluggable `sender` injected by the host, so this layer stays
// credential-free and fully unit-testable; with no sender it degrades to a
// recorded no-op. Payloads carry NO session content, only the shape needed to
// route the wake-up (aligns with the audit log's privacy-first stance).

const DEFAULT_DEDUPE_WINDOW_MS = 30_000;

/**
 * True for host events that should wake a backgrounded device. Approval /
 * permission requests qualify; their `resolved` counterparts do not.
 */
export function isApprovalRequestEvent(type) {
  const value = String(type || "");
  return /approval|permission/i.test(value) && !/resolv/i.test(value);
}

export class RemoteSessionPushDispatcher {
  constructor(options = {}) {
    this.now = options.now || Date.now;
    this.sender = typeof options.sender === "function" ? options.sender : null;
    this.provider = options.provider || null;
    this.dedupeWindowMs = options.dedupeWindowMs || DEFAULT_DEDUPE_WINDOW_MS;
    this.recent = new Map();
    this.stats = { sent: 0, skipped: 0, failed: 0 };
  }

  get enabled() {
    return Boolean(this.sender);
  }

  /**
   * Deliver one wake-up. Never throws — a push is best-effort; the relay event
   * and in-app notification remain the primary channels. Returns a structured
   * outcome the caller can audit.
   */
  async dispatch({
    token,
    provider,
    sessionId,
    clientId,
    notification,
    dedupeKey,
  } = {}) {
    if (!token) return this._skip("no-token");
    if (!this.sender) return this._skip("no-sender");
    if (dedupeKey && this._isDuplicate(clientId, dedupeKey)) {
      return this._skip("deduplicated");
    }
    try {
      const result = await this.sender({
        token,
        provider: provider || this.provider,
        sessionId,
        clientId,
        notification,
      });
      this.stats.sent += 1;
      return { status: "sent", provider: provider || this.provider, result };
    } catch (error) {
      this.stats.failed += 1;
      return { status: "failed", error: error.message };
    }
  }

  _skip(reason) {
    this.stats.skipped += 1;
    return { status: "skipped", reason };
  }

  _isDuplicate(clientId, dedupeKey) {
    const key = `${clientId || ""}:${dedupeKey}`;
    const now = this.now();
    const last = this.recent.get(key);
    if (last != null && now - last < this.dedupeWindowMs) return true;
    this.recent.set(key, now);
    this._gc(now);
    return false;
  }

  _gc(now) {
    if (this.recent.size < 500) return;
    for (const [key, ts] of this.recent) {
      if (now - ts >= this.dedupeWindowMs) this.recent.delete(key);
    }
  }

  static fromEnv(env = {}, options = {}) {
    return new RemoteSessionPushDispatcher({
      provider: env.CHAINLESSCHAIN_REMOTE_SESSION_PUSH_PROVIDER || null,
      ...options,
    });
  }
}
