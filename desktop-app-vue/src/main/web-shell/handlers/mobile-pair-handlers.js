/**
 * `mobile.pair.send-confirmation` WS handler — Android v1.1 W3.6 (issue #19).
 *
 * Web-panel `MobileBridge.vue::onQrScanned` 扫码成功 + CLI pair-from-qr 写 DB
 * 后调本 handler 经信令服务器发 `pairing:confirmation` 给 mobile，让 Android
 * `WebSocketSignalClient.handlePairingConfirmation` 收到 → PairingMessageBus
 * → DesktopPairingViewModel.markConfirmed → state 进 Completed。
 *
 * Web-panel **没有** window.electronAPI（只 V5/V6 有），所以无法直接调
 * ipcMain.invoke('sync:mobile:send-pairing-confirmation')；本 WS topic 是
 * web-panel 唯一可达入口。同一逻辑在 sync/mobile-ipc.js 里有 IPC 双胞胎
 * 保留给 V5/V6 未来用 — 两份等价，故意不抽公共因为各自不到 50 行。
 *
 * Payload 字段与 desktop `device-pairing-handler.js::sendConfirmation` 的
 * confirmationMessage 形状对齐；mobile 端 `WebSocketSignalClient.handlePairingConfirmation`
 * 期望：{type:"pairing:confirmation", pairingCode, pcPeerId, deviceInfo, timestamp}
 *
 * Frame:
 *   client → server: { id, type: "mobile.pair.send-confirmation",
 *                      qrPayload: {type:"device-pairing", code, did, ...} }
 *   server → client: { id, type: "mobile.pair.send-confirmation.result",
 *                      ok: true } 或 { ok: false, error: "..." }
 */

const { logger } = require("../../utils/logger.js");

/**
 * @param {Object} options
 * @param {() => any} [options.getMobileBridge] - **lazy** getter for MobileBridge.
 *   `this.mobileBridge` 在 startWebShell **之后**才赋值（index.js initializeMobileBridge），
 *   handler 注册时为 null 是预期；late-binding 让首次扫码时拿到 ready 状态。
 * @param {() => any} [options.getP2pManager] - lazy getter for p2pManager.
 */
function createMobilePairConfirmationHandler(options = {}) {
  return async function mobilePairConfirmationHandler(frame) {
    const qrPayload = frame?.qrPayload;
    if (!qrPayload || typeof qrPayload !== "object") {
      throw new Error("qrPayload required");
    }
    if (!qrPayload.did || typeof qrPayload.did !== "string") {
      throw new Error("qrPayload.did required");
    }
    if (!qrPayload.code || typeof qrPayload.code !== "string") {
      throw new Error("qrPayload.code required");
    }

    const mobileBridge =
      typeof options.getMobileBridge === "function"
        ? options.getMobileBridge()
        : null;
    if (!mobileBridge) {
      throw new Error("mobile_bridge_unavailable");
    }
    if (!mobileBridge.isConnected) {
      throw new Error("signaling_server_disconnected");
    }

    const p2pManager =
      typeof options.getP2pManager === "function"
        ? options.getP2pManager()
        : null;
    const pcPeerId = p2pManager?.peerId
      ? String(p2pManager.peerId)
      : "desktop-unknown";

    const confirmationMessage = {
      type: "pairing:confirmation",
      pairingCode: qrPayload.code,
      pcPeerId,
      deviceInfo: {
        name: require("os").hostname(),
        platform: process.platform,
        version: process.env.npm_package_version || "v1.1",
      },
      timestamp: Date.now(),
    };

    try {
      mobileBridge.send({
        type: "message",
        to: qrPayload.did,
        payload: confirmationMessage,
      });
      logger.info(
        `[mobile.pair WS] pairing:confirmation 已发往 ${qrPayload.did} (code=${qrPayload.code})`,
      );
      return { ok: true };
    } catch (err) {
      logger.error("[mobile.pair WS] send failed:", err);
      throw new Error(err?.message || String(err));
    }
  };
}

module.exports = {
  createMobilePairConfirmationHandler,
};
