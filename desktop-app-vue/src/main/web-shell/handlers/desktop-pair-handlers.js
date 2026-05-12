/**
 * `desktop.pair.*` WS handlers — Android v1.1 W3.7 Flow B (issue #19)。
 *
 * Flow B：**desktop 显 QR / phone 扫**（反向于 Flow A）。手机摄像头扫桌面
 * 屏幕 QR 比桌面 webcam 对小手机屏幕 QR 识别率高得多——主流应用（微信、
 * 支付宝、Discord、WhatsApp Web）通用 UX 模式。
 *
 * Topics:
 *   - `desktop.pair.generate-qr` — 桌面端按需生成 pairing payload + 6 位
 *     code，返 Vue 渲染 QR。Idempotent in caller — UI 每次 mount/refresh
 *     调一次。
 *   - `desktop.pair.poll-ack`    — Vue 轮询是否收到手机 ack；返 latest
 *     ack 状态。**Phase 1 简化用 polling**，实时 push 走 W3.8 SSE/SharedFlow。
 *
 * Payload shape（手机端 ScanDesktopPairingViewModel 期望）：
 * ```json
 * {
 *   "type": "desktop-pairing",
 *   "code": "<6 位数字>",
 *   "pcPeerId": "<desktop mobileBridge peer-id>",
 *   "deviceInfo": {"name": "...", "platform": "win32", "version": "..."},
 *   "timestamp": <epoch-ms>
 * }
 * ```
 *
 * Phone scan + validate 后经信令发 ack：
 * ```json
 * {"type":"pair-ack", "pairingCode":"<6位>", "mobileDid":"...",
 *  "deviceInfo":{"deviceId":"...","name":"...","platform":"android"}, "timestamp":...}
 * ```
 * mobileBridge incoming-message handler 收到后 write `p2p_paired_devices`
 * + 改 sessionState；Vue poll 看到 ack 后刷新设备列表。
 */

const crypto = require("crypto");
const { logger } = require("../../utils/logger.js");

/**
 * 当前 active pairing session — 单例（同时只支持一个待配对窗口，足够 UX）。
 * Vue tab unmount / 用户主动 cancel / 5min timeout 后清空。
 */
const sessionState = {
  code: null,
  pcPeerId: null,
  payload: null,
  generatedAt: 0,
  ack: null, // {pairingCode, mobileDid, deviceInfo, receivedAt}
};

const PAIRING_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Phone 经信令发 pair-ack 时 mobile-bridge 调本函数（不在 WS handler 链路
 * 内，由 mobileBridge.js 路由）。
 */
function recordPairAck(ackPayload) {
  if (!sessionState.code) {
    logger.warn(
      "[desktop.pair WS] received pair-ack but no active session — drop",
    );
    return false;
  }
  if (ackPayload?.pairingCode !== sessionState.code) {
    logger.warn(
      `[desktop.pair WS] pair-ack code mismatch (expected=${sessionState.code}, got=${ackPayload?.pairingCode}) — drop`,
    );
    return false;
  }
  sessionState.ack = { ...ackPayload, receivedAt: Date.now() };
  logger.info(
    `[desktop.pair WS] pair-ack matched, mobile DID=${ackPayload.mobileDid}`,
  );
  return true;
}

function resetSession() {
  sessionState.code = null;
  sessionState.pcPeerId = null;
  sessionState.payload = null;
  sessionState.generatedAt = 0;
  sessionState.ack = null;
}

/**
 * `desktop.pair.generate-qr` handler — 生成新 pairing session。同时只一个
 * 活跃 session，反复调本 handler 会覆盖前一个。
 *
 * @param {Object} options
 * @param {() => any} [options.getMobileBridge] - lazy getter；用 .peerId
 *   填 pcPeerId 字段
 */
function createDesktopPairGenerateHandler(options = {}) {
  return async function desktopPairGenerateHandler(_frame) {
    const mobileBridge =
      typeof options.getMobileBridge === "function"
        ? options.getMobileBridge()
        : null;
    if (!mobileBridge) {
      throw new Error("mobile_bridge_unavailable");
    }
    // pcPeerId 优先级：
    //   1) mobileBridge.peerId — 已注册到信令服务器的 ID（W3.7 加 this.peerId）
    //   2) deviceManager.getCurrentDevice().deviceId — 源头 truth，mobileBridge 自己
    //      也是 fallback 到这。覆盖 mobileBridge 注册还没跑完的 timing race。
    //   3) "desktop-unknown" 最坏兜底 — phone 收到此 QR 后 sendAck 会失败
    let pcPeerId = mobileBridge.peerId || null;
    if (!pcPeerId) {
      const deviceManager =
        typeof options.getDeviceManager === "function"
          ? options.getDeviceManager()
          : null;
      const currentDevice = deviceManager?.getCurrentDevice?.();
      pcPeerId = currentDevice?.deviceId || "desktop-unknown";
      if (pcPeerId !== "desktop-unknown") {
        logger.info(
          `[desktop.pair WS] mobileBridge.peerId null, fallback deviceManager → ${pcPeerId}`,
        );
      }
    }
    pcPeerId = String(pcPeerId);
    const code = String(crypto.randomInt(100000, 1000000));
    const payload = {
      type: "desktop-pairing",
      code,
      pcPeerId,
      deviceInfo: {
        name: require("os").hostname(),
        platform: process.platform,
        version: process.env.npm_package_version || "v1.1",
      },
      timestamp: Date.now(),
    };
    sessionState.code = code;
    sessionState.pcPeerId = pcPeerId;
    sessionState.payload = payload;
    sessionState.generatedAt = Date.now();
    sessionState.ack = null;
    logger.info(
      `[desktop.pair WS] new pairing session code=${code} pcPeerId=${pcPeerId.slice(0, 12)}…`,
    );
    return { payload, payloadJson: JSON.stringify(payload) };
  };
}

/**
 * `desktop.pair.poll-ack` handler — Vue 轮询 latest ack。无 ack 时返
 * {status:"waiting"}；超 5min 无 ack 返 {status:"expired"}。
 */
function createDesktopPairPollAckHandler() {
  return async function desktopPairPollAckHandler(_frame) {
    if (!sessionState.code) {
      return { status: "idle" };
    }
    if (sessionState.ack) {
      const { receivedAt, ...ack } = sessionState.ack;
      return { status: "acked", ack, receivedAt };
    }
    if (Date.now() - sessionState.generatedAt > PAIRING_TIMEOUT_MS) {
      return { status: "expired" };
    }
    return { status: "waiting", code: sessionState.code };
  };
}

/**
 * `desktop.pair.reset` handler — Vue 主动取消当前 session。
 */
function createDesktopPairResetHandler() {
  return async function desktopPairResetHandler(_frame) {
    resetSession();
    return { ok: true };
  };
}

module.exports = {
  createDesktopPairGenerateHandler,
  createDesktopPairPollAckHandler,
  createDesktopPairResetHandler,
  // exposed for mobile-bridge incoming-message router
  recordPairAck,
  // exposed for testing
  _sessionState: sessionState,
  _resetSession: resetSession,
};
