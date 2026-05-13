/**
 * Public Signaling Relay Client (v1.3+ — issue #21 远程模式)
 *
 * 桌面 outbound 连 `wss://signaling.chainlesschain.com`，注册自己 pcPeerId
 * 让外网手机能经中继路由 pair-ack / WebRTC 信令到桌面，不依赖局域网 mDNS。
 *
 * 协议对齐：与 src/main/p2p/signaling-server.js + signaling-handlers.js 相同
 *   - register：宣告 peerId + deviceInfo
 *   - message：携带 to / from / payload，relay 转发到目标 peer
 *   - ping/pong：keepalive
 *
 * 与 SignalingServer 的关系：本类是 *客户端*，连远程；SignalingServer 是
 * *服务端*，监听本地 9001（LAN 配对路径）。两者通过 pcPeerId 都对外发布同
 * 一身份。手机走 LAN 路径时连 SignalingServer，走 WAN 路径时经 relay 路由
 * 过来——两条链都 land 在 mobile-bridge.recordPairAck 同一函数。
 *
 * 容错：连失败 / 中断不应该挂掉应用，只是降级到「仅 LAN」。指数退避自重连
 * 最多 INFINITE 次，但每次失败间隔 capped 60s 防止 DoS 中继。
 */

const WebSocket = require("ws");
const { EventEmitter } = require("events");
const { logger } = require("../utils/logger.js");

const DEFAULT_RELAY_URL = "wss://signaling.chainlesschain.com";
const PING_INTERVAL_MS = 25_000; // 中继 nginx proxy_read_timeout=600s，30s 内必须有流量
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 60_000;
const CONNECT_TIMEOUT_MS = 15_000;

class RelayClient extends EventEmitter {
  /**
   * @param {Object} options
   * @param {string} options.peerId - 自身 pcPeerId（与本地 SignalingServer
   *   注册同一 ID，让 phone forward 到这个 ID 时不区分 LAN/WAN）
   * @param {string} [options.url] - 中继 URL，默认 prod relay
   * @param {Object} [options.deviceInfo] - 注册时带的元数据
   * @param {(msg: object) => void} [options.onMessage] - 收到 forward 消息
   *   的回调（type=message 时进入；register 等握手消息内部处理）
   */
  constructor(options) {
    super();
    if (!options?.peerId) {
      throw new Error("RelayClient requires peerId");
    }
    this.peerId = options.peerId;
    this.url = options.url || DEFAULT_RELAY_URL;
    this.deviceInfo = options.deviceInfo || {};
    this.onMessage = options.onMessage;

    this.ws = null;
    this.connected = false;
    this.registered = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.shuttingDown = false;
  }

  start() {
    if (this.shuttingDown) {
      return;
    }
    this.connect();
  }

  stop() {
    this.shuttingDown = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
    }
    this.reconnectTimer = null;
    this.pingTimer = null;
    if (this.ws) {
      try {
        this.ws.close(1000, "shutdown");
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.connected = false;
    this.registered = false;
  }

  connect() {
    if (this.shuttingDown) {
      return;
    }
    logger.info(
      `[RelayClient] connecting to ${this.url} as ${this.peerId.slice(0, 12)}…`,
    );

    let ws;
    try {
      ws = new WebSocket(this.url, {
        handshakeTimeout: CONNECT_TIMEOUT_MS,
      });
    } catch (e) {
      logger.warn(`[RelayClient] new WebSocket threw: ${e.message}`);
      this.scheduleReconnect();
      return;
    }

    this.ws = ws;

    const connectTimeout = setTimeout(() => {
      if (!this.connected) {
        logger.warn("[RelayClient] connect timeout, closing");
        try {
          ws.terminate();
        } catch {
          // ignore
        }
      }
    }, CONNECT_TIMEOUT_MS);

    ws.on("open", () => {
      clearTimeout(connectTimeout);
      this.connected = true;
      this.reconnectAttempts = 0;
      logger.info("[RelayClient] ✓ connected to relay, sending register");

      try {
        ws.send(
          JSON.stringify({
            type: "register",
            peerId: this.peerId,
            deviceInfo: {
              ...this.deviceInfo,
              role: "desktop-pair-target",
            },
          }),
        );
      } catch (e) {
        logger.warn(`[RelayClient] register send failed: ${e.message}`);
      }

      this.startPing();
    });

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object") {
        return;
      }

      if (msg.type === "registered") {
        this.registered = true;
        logger.info(
          `[RelayClient] ✓ registered as ${this.peerId.slice(0, 12)}…`,
        );
        this.emit("registered", msg);
        return;
      }
      if (msg.type === "pong") {
        return;
      }
      if (msg.type === "error") {
        logger.warn(`[RelayClient] relay error: ${msg.error}`);
        return;
      }

      // forwarded message — phone 经中继转发过来
      logger.info(
        `[RelayClient] ← incoming type=${msg.type} from=${msg.from?.slice?.(0, 16) || "?"} payloadType=${msg.payload?.type || "?"}`,
      );
      if (this.onMessage) {
        try {
          this.onMessage(msg);
        } catch (e) {
          logger.warn(`[RelayClient] onMessage threw: ${e.message}`);
        }
      }
    });

    ws.on("close", (code, reason) => {
      clearTimeout(connectTimeout);
      this.connected = false;
      this.registered = false;
      if (this.pingTimer) {
        clearInterval(this.pingTimer);
        this.pingTimer = null;
      }
      logger.info(
        `[RelayClient] closed code=${code} reason=${reason?.toString?.() || ""}`,
      );
      if (!this.shuttingDown) {
        this.scheduleReconnect();
      }
    });

    ws.on("error", (err) => {
      logger.warn(`[RelayClient] ws error: ${err.message}`);
      // close 会跟着触发，重连逻辑在 close 里
    });
  }

  startPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
    }
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: "ping", ts: Date.now() }));
        } catch {
          // ignore
        }
      }
    }, PING_INTERVAL_MS);
  }

  scheduleReconnect() {
    if (this.shuttingDown) {
      return;
    }
    if (this.reconnectTimer) {
      return;
    }
    this.reconnectAttempts++;
    // 指数退避：2s, 4s, 8s, 16s, 32s, 60s, 60s...
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** Math.min(this.reconnectAttempts - 1, 5),
      RECONNECT_MAX_MS,
    );
    logger.info(
      `[RelayClient] reconnect attempt #${this.reconnectAttempts} in ${delay}ms`,
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /**
   * 由 desktop 主动向已配对手机发消息（v1.3+ remote 反向通道）。当前 pair
   * flow 主要是手机 → 桌面，但 mobileSign 等流程会用反向。
   */
  send(toPeerId, payload) {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      logger.warn("[RelayClient] cannot send, ws not open");
      return false;
    }
    try {
      this.ws.send(
        JSON.stringify({
          type: "message",
          from: this.peerId,
          to: toPeerId,
          ...payload,
        }),
      );
      return true;
    } catch (e) {
      logger.warn(`[RelayClient] send threw: ${e.message}`);
      return false;
    }
  }
}

module.exports = { RelayClient, DEFAULT_RELAY_URL };
