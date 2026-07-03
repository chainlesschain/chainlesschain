import { EventEmitter } from "events";
import WebSocket from "ws";

export class RemoteSessionRelay extends EventEmitter {
  constructor({
    relayUrl,
    peerId,
    deviceType = "remote-session",
    websocketFactory,
    reconnectBaseMs = 500,
    reconnectMaxMs = 30_000,
    maxReconnectAttempts = Infinity,
    queueLimit = 100,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = {}) {
    super();
    if (!relayUrl || !peerId)
      throw new Error("relayUrl and peerId are required");
    this.relayUrl = relayUrl;
    this.peerId = peerId;
    this.deviceType = deviceType;
    this.websocketFactory = websocketFactory || ((url) => new WebSocket(url));
    this.ws = null;
    this.reconnectBaseMs = reconnectBaseMs;
    this.reconnectMaxMs = reconnectMaxMs;
    this.maxReconnectAttempts = maxReconnectAttempts;
    this.queueLimit = queueLimit;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.outbox = [];
    this.closedExplicitly = false;
    this.connectPromise = null;
  }

  connect() {
    if (this.ws && this.ws.readyState === this.ws.OPEN)
      return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;
    this.closedExplicitly = false;
    this.connectPromise = new Promise((resolve, reject) => {
      const ws = this.websocketFactory(this.relayUrl);
      this.ws = ws;
      const onOpen = () => {
        this._send({
          type: "register",
          peerId: this.peerId,
          deviceType: this.deviceType,
          deviceInfo: { protocol: "remote-session.e2ee.v1" },
        });
        this.reconnectAttempts = 0;
        this.connectPromise = null;
        this._flushOutbox();
        this.emit("connect");
        resolve();
      };
      ws.once("open", onOpen);
      ws.once("error", (error) => {
        this.connectPromise = null;
        reject(error);
      });
      ws.on("message", (raw) => this._handleMessage(raw));
      ws.on("close", () => {
        if (this.ws === ws) this.ws = null;
        this.connectPromise = null;
        this.emit("disconnect");
        this._scheduleReconnect();
      });
    });
    return this.connectPromise;
  }

  sendEncrypted(targetPeerId, envelope) {
    const message = {
      type: "message",
      to: targetPeerId,
      payload: { type: "remote-session.encrypted", envelope },
    };
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) {
      if (this.outbox.length >= this.queueLimit) this.outbox.shift();
      this.outbox.push(message);
      this.emit("queued", { size: this.outbox.length });
      return false;
    }
    this._send(message);
    return true;
  }

  close() {
    this.closedExplicitly = true;
    if (this.reconnectTimer) {
      this.clearTimer(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  _scheduleReconnect() {
    if (
      this.closedExplicitly ||
      this.reconnectTimer ||
      this.reconnectAttempts >= this.maxReconnectAttempts
    ) {
      return;
    }
    const delay = Math.min(
      this.reconnectBaseMs * 2 ** this.reconnectAttempts,
      this.reconnectMaxMs,
    );
    this.reconnectAttempts += 1;
    this.emit("reconnecting", { attempt: this.reconnectAttempts, delay });
    this.reconnectTimer = this.setTimer(() => {
      this.reconnectTimer = null;
      this.connect().catch((error) => {
        this.emit("reconnect-error", error);
        this._scheduleReconnect();
      });
    }, delay);
    if (typeof this.reconnectTimer?.unref === "function")
      this.reconnectTimer.unref();
  }

  _flushOutbox() {
    const pending = this.outbox.splice(0);
    for (const message of pending) this._send(message);
    if (pending.length) this.emit("flushed", { count: pending.length });
  }

  _send(message) {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) {
      throw new Error("Remote Session relay is not connected");
    }
    this.ws.send(JSON.stringify(message));
  }

  _handleMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw.toString("utf8"));
    } catch {
      this.emit("protocol-error", new Error("Invalid signaling relay JSON"));
      return;
    }
    if (message.type === "offline-message") message = message.originalMessage;
    if (
      message?.type === "message" &&
      message.payload?.type === "remote-session.encrypted"
    ) {
      this.emit("encrypted-message", {
        from: message.from,
        envelope: message.payload.envelope,
      });
      return;
    }
    this.emit("relay-message", message);
  }
}
