/**
 * Manual Pair Alias Listener — iOS Phase 1.6 桌面 follow-up (2026-05-15)。
 *
 * iOS `ManualPairingViewModel` (Phase 1.6) 让用户输入桌面屏幕显示的 6 位
 * pairing code，然后经 signaling forward 发 pair-ack 到 peerId
 * `pairing-code:<6digit>`。本模块在 Flow B QR 激活期间额外打开一对临时
 * WS 连接（LAN signaling-server + 公网 relay），各 register 上面那个别名
 * peer-id，让 server 能把 iOS 的 pair-ack 路由到桌面，最终走与 QR 路径
 * **完全相同**的 `recordPairAck` 逻辑（含 code 校验）。
 *
 * **生命周期**：QR generate 时 start；QR cancel/expire/successful pair-ack
 * 时 stop。从不长存。
 *
 * **架构动机**（design doc `iOS_Phase_1_Pairing_Flow_B.md` §6.5 修订版）：
 * 不在 main `MobileBridge` socket 上 register 第二个 peerId，因为 server
 * `handleRegister` 会把 `ws.peerId` 覆盖成最新 register 的值，main socket
 * 后续 outbound forward 的 `from` 字段会泄露成 `pairing-code:<code>` 别名。
 * 单独 socket 完全隔离。
 *
 * **forward-compat**：iOS 端在 follow-up 落地之前已发布；那时 iOS 发的 pair-ack
 * 找不到 peer，server 返 `peer-offline`，iOS 60s timeout 后友好失败提示用户改
 * 用扫描方式。本模块落地后 → iOS Manual flow 真接通。
 */

const WebSocket = require("ws");
const { logger } = require("../../utils/logger.js");

const DEFAULT_LAN_URL =
  process.env.CC_LAN_SIGNALING_URL || "ws://localhost:9001";
const DEFAULT_RELAY_URL =
  process.env.CC_RELAY_URL || "wss://signaling.chainlesschain.com";

/**
 * 单条 alias listener — 包一条到指定 signaling URL 的 WS 连接。
 *
 * @param {Object} opts
 * @param {string} opts.url - signaling server URL（LAN ws://localhost:9001 或
 *   relay wss://signaling.chainlesschain.com）
 * @param {string} opts.code - 6 位 pairing code
 * @param {(pairAckPayload: Object) => void} opts.onPairAck - 收到 pair-ack
 *   payload 时调用，桌面 caller 应转发给现有 `recordPairAck`
 * @param {typeof WebSocket} [opts.WebSocketImpl] - 测试可注入 fake，默认 require("ws")
 */
class ManualPairAliasListener {
  constructor(opts) {
    if (!opts?.url) {
      throw new Error("ManualPairAliasListener requires url");
    }
    if (!opts?.code) {
      throw new Error("ManualPairAliasListener requires code");
    }
    this.url = opts.url;
    this.code = String(opts.code);
    this.aliasPeerId = `pairing-code:${this.code}`;
    this.onPairAck = opts.onPairAck;
    this.WebSocketImpl = opts.WebSocketImpl || WebSocket;
    this.ws = null;
    this.stopped = false;
    this.opened = false;
  }

  start() {
    if (this.stopped) {
      return;
    }
    let ws;
    try {
      ws = new this.WebSocketImpl(this.url);
    } catch (e) {
      logger.warn(
        `[ManualPair ${this.aliasPeerId}] new WebSocket(${this.url}) threw: ${e.message}`,
      );
      return;
    }
    this.ws = ws;

    ws.on("open", () => {
      if (this.stopped) {
        try {
          ws.close(1000, "stopped-before-open");
        } catch {
          // ignore
        }
        return;
      }
      this.opened = true;
      try {
        ws.send(
          JSON.stringify({
            type: "register",
            peerId: this.aliasPeerId,
            deviceType: "desktop",
            deviceInfo: { role: "manual-pair-alias", code: this.code },
          }),
        );
        logger.info(
          `[ManualPair ${this.aliasPeerId}] ✓ registered alias on ${this.url}`,
        );
      } catch (e) {
        logger.warn(
          `[ManualPair ${this.aliasPeerId}] register send failed: ${e.message}`,
        );
      }
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
      // 仅关心 forwarded message 且 payload 是 pair-ack — 其它（registered/pong/
      // peer-status/error 等）忽略。
      if (msg.type !== "message") {
        return;
      }
      const payload = msg.payload;
      if (!payload || payload.type !== "pair-ack") {
        return;
      }
      logger.info(
        `[ManualPair ${this.aliasPeerId}] ← pair-ack received from ${msg.from?.slice?.(0, 16) || "?"} pairingCode=${payload.pairingCode}`,
      );
      try {
        this.onPairAck?.(payload);
      } catch (e) {
        logger.warn(
          `[ManualPair ${this.aliasPeerId}] onPairAck threw: ${e.message}`,
        );
      }
    });

    ws.on("error", (err) => {
      logger.warn(
        `[ManualPair ${this.aliasPeerId}] ws error on ${this.url}: ${err.message || err}`,
      );
      // 不重连 — 生命周期与 QR 绑，QR 还活着的话 caller 可重试 start。
    });

    ws.on("close", (code, reason) => {
      this.opened = false;
      logger.info(
        `[ManualPair ${this.aliasPeerId}] closed code=${code} reason=${reason?.toString?.() || ""}`,
      );
    });
  }

  stop() {
    this.stopped = true;
    if (this.ws) {
      try {
        this.ws.close(1000, "stop");
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }
}

/**
 * 启动一对 listeners（LAN + relay）。Caller 拿返回的 handle 调 stop() 关闭全部。
 * 这是默认 factory，prod 调用方用此；测试可注入自己的 factory。
 *
 * @param {Object} opts
 * @param {string} opts.code - 6 位 pairing code
 * @param {(payload: Object) => void} opts.onPairAck - 收到 pair-ack 回调
 * @param {string} [opts.lanUrl] - 默认 process.env.CC_LAN_SIGNALING_URL || "ws://localhost:9001"
 * @param {string} [opts.relayUrl] - 默认 process.env.CC_RELAY_URL || "wss://signaling.chainlesschain.com"
 * @param {typeof WebSocket} [opts.WebSocketImpl] - 测试 stub
 * @returns {{ stop: () => void, listeners: ManualPairAliasListener[] }}
 */
function startManualPairAliasListeners(opts) {
  if (!opts?.code) {
    throw new Error("startManualPairAliasListeners requires code");
  }
  const lanUrl = opts.lanUrl || DEFAULT_LAN_URL;
  const relayUrl = opts.relayUrl || DEFAULT_RELAY_URL;
  const listeners = [];

  // LAN — 覆盖与桌面同 WiFi 的 iOS 设备（iOS 之前用 QR 扫过 → SignalingConfig
  // customSignalingUrl 已设为 LAN）。
  const lan = new ManualPairAliasListener({
    url: lanUrl,
    code: opts.code,
    onPairAck: opts.onPairAck,
    WebSocketImpl: opts.WebSocketImpl,
  });
  lan.start();
  listeners.push(lan);

  // Relay — 覆盖首次配对的 iOS 设备（无 customSignalingUrl，fallback 到 relay）。
  // 这是 Manual flow 的主要场景。
  const relay = new ManualPairAliasListener({
    url: relayUrl,
    code: opts.code,
    onPairAck: opts.onPairAck,
    WebSocketImpl: opts.WebSocketImpl,
  });
  relay.start();
  listeners.push(relay);

  return {
    listeners,
    stop() {
      for (const l of listeners) {
        try {
          l.stop();
        } catch (e) {
          logger.warn(`[ManualPair] listener stop threw: ${e?.message || e}`);
        }
      }
    },
  };
}

module.exports = {
  ManualPairAliasListener,
  startManualPairAliasListeners,
};
