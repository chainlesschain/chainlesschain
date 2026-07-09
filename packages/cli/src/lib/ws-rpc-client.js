/**
 * Minimal promise-based WebSocket RPC client for the cc WS server protocol
 * (auth + id-correlated request/response + fire-hose events). Used by
 * `cc remote-control` for its in-process loopback HOST connection — the
 * remote-session registry closes a session when its host disconnects, so the
 * unified entry keeps this client open for the server's lifetime.
 *
 * Protocol notes:
 *   - every request carries a unique `id`. Flat responses (auth, remote-session-*)
 *     echo it back as `id`; envelope responses (session-create & friends,
 *     createCodingAgentEvent) repurpose `id` as a random eventId and carry the
 *     correlation key in `requestId` — so match `requestId` FIRST, then `id`.
 *   - the FIRST frame matching a pending key settles that request (fine for
 *     command/one-shot topics; streaming topics need onEvent, not request()).
 *   - messages matching no pending key are events → onEvent callbacks.
 */

import WebSocket from "ws";

const DEFAULT_TIMEOUT_MS = 15_000;

export class WsRpcClient {
  constructor({ url, WebSocketImpl = WebSocket, timeoutMs } = {}) {
    if (!url) throw new Error("url is required");
    this.url = url;
    this.WebSocketImpl = WebSocketImpl;
    this.timeoutMs = timeoutMs || DEFAULT_TIMEOUT_MS;
    this.ws = null;
    this._pending = new Map();
    this._counter = 0;
    this._eventHandlers = new Set();
    this._closed = false;
  }

  onEvent(handler) {
    this._eventHandlers.add(handler);
    return () => this._eventHandlers.delete(handler);
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new this.WebSocketImpl(this.url);
      this.ws = ws;
      const onOpen = () => {
        ws.off?.("error", onError);
        resolve();
      };
      const onError = (err) => {
        reject(new Error(`WebSocket connect failed: ${err.message || err}`));
      };
      ws.once("open", onOpen);
      ws.once("error", onError);
      ws.on("message", (data) => this._onMessage(data));
      ws.on("close", () => this._onClose());
    });
  }

  _onMessage(data) {
    let message;
    try {
      message = JSON.parse(data.toString("utf8"));
    } catch {
      return; // non-JSON frames are not part of this protocol
    }
    const key =
      message.requestId && this._pending.has(message.requestId)
        ? message.requestId
        : message.id && this._pending.has(message.id)
          ? message.id
          : null;
    if (key) {
      const pending = this._pending.get(key);
      this._pending.delete(key);
      clearTimeout(pending.timer);
      if (message.type === "error") {
        pending.reject(
          new Error(
            message.message ||
              message.payload?.message ||
              message.code ||
              message.payload?.code ||
              "server error",
          ),
        );
      } else {
        pending.resolve(message);
      }
      return;
    }
    for (const handler of this._eventHandlers) {
      try {
        handler(message);
      } catch {
        // one bad handler must not break the read loop
      }
    }
  }

  _onClose() {
    this._closed = true;
    for (const [, pending] of this._pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("connection closed"));
    }
    this._pending.clear();
  }

  /** Send `{id, type, ...payload}` and await the matching response frame. */
  request(type, payload = {}, { timeoutMs } = {}) {
    if (this._closed || !this.ws || this.ws.readyState !== this.ws.OPEN) {
      return Promise.reject(new Error("not connected"));
    }
    const id = `rpc-${process.pid}-${++this._counter}`;
    const frame = { id, type, ...payload };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`request "${type}" timed out`));
      }, timeoutMs || this.timeoutMs);
      if (typeof timer.unref === "function") timer.unref();
      this._pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify(frame), (err) => {
        if (err) {
          this._pending.delete(id);
          clearTimeout(timer);
          reject(err);
        }
      });
    });
  }

  /** Authenticate against a token-protected server. No-op when token is null. */
  async auth(token) {
    if (!token) return { success: true, skipped: true };
    const result = await this.request("auth", { token });
    if (!result.success) {
      throw new Error(result.message || "authentication failed");
    }
    return result;
  }

  close() {
    this._closed = true;
    try {
      this.ws?.close();
    } catch {
      // already closing
    }
  }
}
