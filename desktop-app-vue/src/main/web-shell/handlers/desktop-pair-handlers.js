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
const os = require("os");
const { logger } = require("../../utils/logger.js");

/**
 * 探测桌面的 LAN IPv4 地址，用于把 `ws://<ip>:9001` 塞进 QR payload，
 * 手机扫到后可直接连上桌面信令服务器 — 免去 NSD mDNS 发现的时间窗口与
 * 多播被路由器抑制的风险（issue #21 v1.3+ Connect timeout 复现根因）。
 *
 * 选 IP 策略：第一块**非 internal、非 link-local、非 docker bridge** 的 IPv4。
 * 多网卡场景（VMware/Hyper-V）取第一个匹配；若全失败返 `null`，QR 仍包
 * 旧字段，手机走 NSD fallback。
 */
function detectLanIPv4() {
  try {
    const ifaces = os.networkInterfaces();
    const candidates = [];
    for (const [name, addrs] of Object.entries(ifaces || {})) {
      if (!addrs) {
        continue;
      }
      const lower = name.toLowerCase();
      // 排除已知虚拟/隧道网卡：docker / vEthernet (WSL/Hyper-V) / singbox / clash /
      // tap / tun / wireguard / utun / OpenVPN — 它们的 IP 不在物理 LAN，手机连不通。
      if (
        lower.includes("docker") ||
        lower.startsWith("vethernet") ||
        lower.includes("singbox") ||
        lower.includes("clash") ||
        lower.includes("wireguard") ||
        lower.includes("openvpn") ||
        lower.startsWith("tap") ||
        lower.startsWith("tun") ||
        lower.startsWith("utun") ||
        lower.startsWith("letstap")
      ) {
        continue;
      }
      for (const a of addrs) {
        if (a.family !== "IPv4" || a.internal) {
          continue;
        }
        if (a.address.startsWith("169.254.")) {
          continue;
        } // link-local
        candidates.push({ name, address: a.address });
      }
    }
    if (candidates.length === 0) {
      return null;
    }
    // 严格优先级（家用 LAN 几乎都是 192.168.*；docker 默认 172.17.*）：
    //   1) 192.168.* — 普通家用路由器 DHCP 段，最常见
    //   2) 10.*       — 公司 / 大型 LAN
    //   3) 172.16-31.* — 排到最后，因为 docker 默认是 172.17，VPN tunnel 也常在这段
    const score = (addr) => {
      if (/^192\.168\./.test(addr)) {
        return 1;
      }
      if (/^10\./.test(addr)) {
        return 2;
      }
      if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(addr)) {
        return 3;
      }
      return 9;
    };
    candidates.sort((a, b) => score(a.address) - score(b.address));
    logger.info(
      `[desktop.pair WS] detected LAN candidates: ${candidates.map((c) => `${c.name}=${c.address}`).join(", ")} → using ${candidates[0].address}`,
    );
    return candidates[0].address;
  } catch (e) {
    logger.warn(`[desktop.pair WS] detectLanIPv4 failed: ${e.message}`);
    return null;
  }
}

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
/**
 * v1.3+ — pair-ack 直接落 CLI 的 SQLite (p2p_paired_devices)，不再依赖
 * web-panel 必须打开。spawn `cc p2p pair-from-qr` 子进程做 INSERT。
 * 失败 silent log（前向兼容 — 用户没装全局 cc 时也不该 break 主流程）。
 */
function persistPairAck(ackPayload) {
  try {
    const { spawn } = require("child_process");
    const path = require("path");
    const fs = require("fs");
    const payload = {
      type: "device-pairing",
      code: ackPayload.pairingCode,
      did: ackPayload.mobileDid,
      deviceInfo: {
        deviceId: ackPayload.deviceInfo?.deviceId,
        name: ackPayload.deviceInfo?.name || "(unnamed)",
        platform: ackPayload.deviceInfo?.platform || "mobile",
      },
      timestamp: Date.now(),
    };
    // 找 cc 可执行：优先 workspace bin（dev mode），fallback 系统 PATH。
    // Windows 必须用 .cmd 后缀或 shell:true 才能解析 npm bin symlink。
    let bin = "cc";
    let useShell = process.platform === "win32";
    try {
      const wsBin = path.resolve(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "..",
        "packages",
        "cli",
        "bin",
        "chainlesschain.js",
      );
      if (fs.existsSync(wsBin)) {
        bin = process.execPath; // node binary
        useShell = false;
        var prependArgs = [wsBin];
      }
    } catch {
      // ignore
    }
    const args = (typeof prependArgs !== "undefined" ? prependArgs : []).concat(
      ["p2p", "pair-from-qr", JSON.stringify(payload), "--json"],
    );
    const child = spawn(bin, args, {
      stdio: "pipe",
      windowsHide: true,
      shell: useShell,
      env: process.env,
    });
    let out = "";
    let err = "";
    child.stdout?.on("data", (d) => (out += d.toString()));
    child.stderr?.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => {
      logger.warn(`[desktop.pair WS] persist spawn failed: ${e.message}`);
    });
    child.on("close", (code) => {
      if (code === 0) {
        logger.info(
          `[desktop.pair WS] ✓ persisted pair to CLI DB (deviceId=${payload.deviceInfo.deviceId})`,
        );
      } else {
        logger.warn(
          `[desktop.pair WS] persist exit=${code} stderr=${err.slice(0, 200)}`,
        );
      }
    });
  } catch (e) {
    logger.warn(`[desktop.pair WS] persist threw: ${e.message}`);
  }
}

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
  // 直接持久化，不依赖 web-panel polling
  persistPairAck(ackPayload);
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
    // 把 LAN IP 直接塞进 QR — 手机端 ScanDesktopPairingViewModel 收到 signalingUrl
    // 字段时立刻持久化进 SignalingConfig prefs，再做 sendAck；零配置体验。
    // 信令端口固定 9001（与 main/index.js `信令服务器: ws://localhost:9001` 对齐）。
    const lanIp = detectLanIPv4();
    const signalingUrl = lanIp ? `ws://${lanIp}:9001` : null;
    // v1.3+ — 外网中继 URL；手机扫到后作为 fallback：LAN 不通时切到中继。
    // 环境变量可 override（dev / 私有部署）。
    const relayUrl =
      process.env.CC_RELAY_URL || "wss://signaling.chainlesschain.com";
    const payload = {
      type: "desktop-pairing",
      code,
      pcPeerId,
      deviceInfo: {
        name: os.hostname(),
        platform: process.platform,
        version: process.env.npm_package_version || "v1.1",
      },
      // v1.3+ — 手机扫到后直接用此 URL 连信令；null 则手机 fallback NSD
      signalingUrl,
      // v1.3+ — 公网中继 URL；LAN 不通时手机自动 fallback 到这里
      relayUrl,
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
