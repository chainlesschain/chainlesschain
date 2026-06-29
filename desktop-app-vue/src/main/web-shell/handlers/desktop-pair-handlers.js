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
const { startManualPairAliasListeners } = require("./manual-pair-listener.js");

/**
 * v1.3+ plan B — coturn time-limited credentials.
 *
 * 在 QR 生成时签发 24h TTL 的 ICE 凭证，手机扫码后持久化 + WebRTC 建连用。
 * 客户端**不需要知道 shared secret**（只在桌面端，从 env 读）— 桌面签好直接塞 QR。
 *
 * 凭证算法（与 turnserver.conf use-auth-secret 匹配）：
 *   username = <expiry-unix-ts>:<user-id>
 *   credential = base64(HMAC-SHA1(secret, username))
 *
 * 必填 env：`CC_TURN_SECRET`（与 /opt/cc-turn/turnserver.conf 的
 * `use-auth-secret` 必须匹配，否则 TURN server 拒绝凭证）。无 fallback —
 * 不在源码里硬编码 shared secret，任何人 fork 都不该拿到生效凭证。
 * dev 起 desktop 时也必须设；可以本地起 coturn 用任意私有 secret。
 */
const TURN_URL = process.env.CC_TURN_URL || "turn.chainlesschain.com";
const TURN_SECRET = process.env.CC_TURN_SECRET;
const TURN_TTL_SEC = 24 * 60 * 60; // 24h

function signIceCredentials(userId) {
  if (!TURN_SECRET) {
    throw new Error(
      "CC_TURN_SECRET env var not set — required for plan B WebRTC TURN credentials. " +
        "Set it to the same value as your coturn server's `use-auth-secret`. " +
        "For dev without TURN, set CC_TURN_SECRET=dev to disable cred validation " +
        "(STUN-only mode still works, TURN relay will reject).",
    );
  }
  const expiry = Math.floor(Date.now() / 1000) + TURN_TTL_SEC;
  const username = `${expiry}:${userId}`;
  const credential = crypto
    .createHmac("sha1", TURN_SECRET)
    .update(username)
    .digest("base64");
  return {
    iceServers: [
      { urls: [`stun:${TURN_URL}:3478`] },
      {
        urls: [
          `turn:${TURN_URL}:3478?transport=udp`,
          `turn:${TURN_URL}:3478?transport=tcp`,
          `turns:${TURN_URL}:5349`,
        ],
        username,
        credential,
      },
    ],
    expiry,
  };
}

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
/**
 * Build the device-pairing payload from a remote peer's pair-ack, validating it
 * for shell safety. The payload is later passed to the CLI as a SHELL argument
 * (spawn shell:true on Windows for npm-bin resolution), so a peer who brute-forced
 * the 6-digit pairing code could inject shell commands via mobileDid / deviceId /
 * platform. Reject structured identifiers carrying anything outside a safe charset,
 * and strip shell metacharacters from the free-form display name.
 * @returns the sanitized payload, or null if an identifier is unsafe (drop the ack).
 */
function sanitizePairAckPayload(ackPayload) {
  const SAFE_ID = /^[\w:.#@-]{0,256}$/;
  const did = ackPayload.mobileDid || "";
  const deviceId = ackPayload.deviceInfo?.deviceId || "";
  const platform = ackPayload.deviceInfo?.platform || "mobile";
  if (
    !SAFE_ID.test(did) ||
    !SAFE_ID.test(deviceId) ||
    !SAFE_ID.test(platform)
  ) {
    return null;
  }
  const name = String(ackPayload.deviceInfo?.name || "(unnamed)")
    .replace(/[`$;&|<>(){}[\]!^%*?~"'\\\r\n=]/g, "")
    .slice(0, 128);
  return {
    type: "device-pairing",
    code: ackPayload.pairingCode,
    did,
    deviceInfo: { deviceId, name, platform },
    timestamp: Date.now(),
  };
}

function persistPairAck(ackPayload) {
  try {
    const { spawn } = require("child_process");
    const path = require("path");
    const fs = require("fs");

    const payload = sanitizePairAckPayload(ackPayload);
    if (!payload) {
      logger.warn(
        "[desktop.pair WS] pair-ack identifier has unsafe characters — drop (possible injection)",
      );
      return;
    }
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

  // iOS Phase 1.6 follow-up — pair-ack 已收，alias listeners 不再需要，立刻停掉
  // 释放 socket。下个 QR 会重新 start。
  stopManualPairAliasListeners();

  // v1.3+ plan B — pair-ack 收到后异步把 iceServers 经信令 push 给手机。
  // 因 iceServers JSON ~400 字符塞 QR 让识别率暴跌，改成扫码后由信令通道下发。
  // 双发：本地 LAN signaling + 公网中继（手机连哪边都能收到）。
  pushIceServersToMobile(ackPayload);
  return true;
}

/**
 * v1.3+ plan B 配套 — 把 sessionState.iceConfig 经信令转发给刚配对的手机。
 * 手机端 RemoteOperateViewModel/PairingSignalingGate 收到 type=ice:config 后
 * 持久化到 PairedDesktopsStore.iceServersJson。
 */
function pushIceServersToMobile(ackPayload) {
  if (!sessionState.iceConfig) {
    return; // dev 未设 CC_TURN_SECRET 时跳过 (STUN-only mode)
  }
  const mobileDid = ackPayload?.mobileDid;
  if (!mobileDid) {
    return;
  }
  const message = {
    type: "chainlesschain:ice:config",
    payload: {
      pcPeerId: sessionState.pcPeerId,
      iceServers: sessionState.iceConfig.iceServers,
      iceExpiry: sessionState.iceConfig.expiry,
      timestamp: Date.now(),
    },
  };
  // 双发：mobile-bridge 走本地 LAN signaling，relay 走公网中继
  try {
    const main = global.__ccMobileBridge;
    if (main && typeof main.sendToMobile === "function") {
      main.sendToMobile(mobileDid, message).catch((e) => {
        logger.warn(`[desktop.pair WS] LAN ice push failed: ${e?.message}`);
      });
    }
  } catch (e) {
    logger.warn(`[desktop.pair WS] LAN ice push threw: ${e.message}`);
  }
  try {
    const relay = global.__ccRelayClient;
    if (relay && typeof relay.send === "function") {
      relay.send(mobileDid, { type: "message", payload: message });
    }
  } catch (e) {
    logger.warn(`[desktop.pair WS] relay ice push threw: ${e.message}`);
  }
  logger.info(
    `[desktop.pair WS] ✓ iceServers pushed to ${mobileDid.slice(0, 16)}… (expiry=${sessionState.iceConfig.expiry})`,
  );
}

/**
 * iOS Phase 1.6 follow-up — alias listeners handle (一对 LAN+relay WS 连接)。
 * QR 生成时 start，cancel/expire/successful pair-ack 时 stop。永远只有一个
 * 活跃 handle（覆盖前一个）。
 */
let activeManualPairAliasHandle = null;

function stopManualPairAliasListeners() {
  if (activeManualPairAliasHandle) {
    try {
      activeManualPairAliasHandle.stop();
    } catch (e) {
      logger.warn(`[desktop.pair WS] alias listener stop threw: ${e.message}`);
    }
    activeManualPairAliasHandle = null;
  }
}

function resetSession() {
  sessionState.code = null;
  sessionState.pcPeerId = null;
  sessionState.payload = null;
  sessionState.generatedAt = 0;
  sessionState.ack = null;
  stopManualPairAliasListeners();
}

/**
 * Plan A.1 v5.0.3.53-fix3 — paired mobile peer 重上线时自动续 iceServers。
 *
 * Why: iceServers 24h TTL（signIceCredentials），pair-ack 后只 push 一次。
 * 24h 后 mobile 重连，PairedDesktopsStore 里 iceServersJson 已过期 → fallback
 * Google STUN → 跨 NAT WebRTC 完全不通 → DC 永远 fail → 用户体验 Plan A 4 跳
 * signaling fragile。
 *
 * Fix: mobile-bridge.bridgeToLibp2p 任何 inbound 调本函数。本函数 12h 半 TTL
 * rate-limit per mobileDid，命中即 signIceCredentials() 签发新凭证 + 双发
 * push（LAN signaling + 公网中继），让 mobile PairedDesktopsStore 自动更新。
 *
 * @param {string} mobileDid - sender peerId from signaling msg. 只 push 给 DID 形式
 *   的（did:key:z…），跳过 transient WebRTC peerId（mobile-XXXX）— 后者非
 *   paired 身份，push 给它无意义。
 * @param {string} [pcPeerId] - 我们的 pcPeerId；若 null fallback sessionState
 */
const _iceLastPushAt = new Map(); // mobileDid -> insertedAt(ms)
const ICE_REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000; // half of 24h TTL

function maybeRefreshIceForMobile(mobileDid, pcPeerId = null) {
  if (!mobileDid || typeof mobileDid !== "string") {
    return;
  }
  if (!mobileDid.startsWith("did:")) {
    // 跳过 transient mobile-XXXX peerIds — 它们是 WebRTC handshake 时一次性
    // local peerId，不是 PairedDesktopsStore 里持久的 DID
    return;
  }
  if (!TURN_SECRET) {
    return; // dev STUN-only mode — no creds to sign
  }
  const now = Date.now();
  const lastAt = _iceLastPushAt.get(mobileDid) || 0;
  if (now - lastAt < ICE_REFRESH_INTERVAL_MS) {
    return; // 已在 12h 内 push 过，不重复
  }
  try {
    const fresh = signIceCredentials(mobileDid);
    const resolvedPcPeerId = pcPeerId || sessionState.pcPeerId;
    if (!resolvedPcPeerId) {
      logger.warn(
        `[ice-auto-refresh] no pcPeerId resolved for ${mobileDid.slice(0, 16)}…, skip push`,
      );
      return;
    }
    sessionState.iceConfig = fresh; // 保持 backward compat
    const message = {
      type: "chainlesschain:ice:config",
      payload: {
        pcPeerId: resolvedPcPeerId,
        iceServers: fresh.iceServers,
        iceExpiry: fresh.expiry,
        timestamp: now,
      },
    };
    // 双发：LAN signaling + 公网中继
    try {
      const bridge = global.__ccMobileBridge;
      if (bridge && typeof bridge.sendToMobile === "function") {
        bridge.sendToMobile(mobileDid, message).catch((e) => {
          logger.warn(`[ice-auto-refresh] LAN push failed: ${e?.message}`);
        });
      }
    } catch (e) {
      logger.warn(`[ice-auto-refresh] LAN push threw: ${e.message}`);
    }
    try {
      const relay = global.__ccRelayClient;
      if (relay && typeof relay.send === "function") {
        relay.send(mobileDid, { type: "message", payload: message });
      }
    } catch (e) {
      logger.warn(`[ice-auto-refresh] relay push threw: ${e.message}`);
    }
    _iceLastPushAt.set(mobileDid, now);
    logger.info(
      `[ice-auto-refresh] ✓ fresh iceServers pushed to ${mobileDid.slice(0, 16)}… (expiry=${fresh.expiry}, every 12h)`,
    );
  } catch (e) {
    logger.warn(
      `[ice-auto-refresh] failed for ${mobileDid?.slice?.(0, 16)}…: ${e.message}`,
    );
  }
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
    // v1.3+ plan B — 签发 24h ICE 凭证，手机扫码后直接用，不需要 shared secret
    // 无 CC_TURN_SECRET env 时降级到 STUN-only（LAN + 双 NAT 友好场景仍能跑，
    // 跨 NAT TURN relay 不可用）。dev 启动也能 pair，无强依赖部署 env。
    let iceConfig;
    try {
      iceConfig = signIceCredentials(pcPeerId);
    } catch (e) {
      logger.warn(
        `[desktop.pair WS] TURN credentials unavailable (${e.message}) — STUN-only mode`,
      );
      iceConfig = {
        iceServers: [
          { urls: ["stun:stun.l.google.com:19302"] },
          { urls: ["stun:stun1.l.google.com:19302"] },
        ],
        expiry: 0,
      };
    }
    // v1.3+ plan B — iceServers 不塞 QR（高纠错 280px QR 装不下，扫码识别率暴跌）。
    // 配对后通过 sessionState 缓存，pair-ack 收到时经信令 forward 回手机。
    // QR 保持精简: type/code/pcPeerId/deviceInfo/signalingUrl/relayUrl/timestamp。
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
    // iceConfig 留在 sessionState 里给 pair-ack 后续 push
    sessionState.iceConfig = iceConfig;
    logger.info(
      `[desktop.pair WS] new pairing session code=${code} pcPeerId=${pcPeerId.slice(0, 12)}…`,
    );

    // iOS Phase 1.6 follow-up — 起 alias listeners 让 iOS Manual flow 能
    // 经 signaling 路由到桌面。覆盖前一个（若有）。Factory 注入让测试可 stub。
    stopManualPairAliasListeners();
    const factory =
      options.startManualPairAliasListeners || startManualPairAliasListeners;
    try {
      activeManualPairAliasHandle = factory({
        code,
        onPairAck: recordPairAck,
      });
    } catch (e) {
      logger.warn(
        `[desktop.pair WS] alias listeners start failed: ${e.message}`,
      );
      activeManualPairAliasHandle = null;
    }

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
  // Plan A.1 v5.0.3.53-fix3: auto-refresh iceServers when paired mobile re-online
  maybeRefreshIceForMobile,
  // exposed for testing
  sanitizePairAckPayload,
  _sessionState: sessionState,
  _resetSession: resetSession,
  _getActiveManualPairAliasHandle: () => activeManualPairAliasHandle,
  _stopManualPairAliasListeners: stopManualPairAliasListeners,
  _resetIcePushAt: () => _iceLastPushAt.clear(),
};
