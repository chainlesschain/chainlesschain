/**
 * ChainlessChain Signaling Relay
 *
 * 公网 WebSocket signaling 中继。协议与 desktop-app-vue/src/main/p2p/signaling-server.js
 * 完全一致 — register / message / pair-ack — 桌面与手机 client 0 改动接入。
 *
 * 部署：Docker 容器跑 0.0.0.0:9001，外面 nginx 把 wss://signaling.chainlesschain.com
 * 反代过来。
 *
 * 安全：v1 开放注册，靠 pairing-code + DID 验证（每个 ack 都带 6 位 code，desktop
 *   sessionState 比对）。v2 加 HMAC token。
 */

const WebSocket = require("ws");
const crypto = require("crypto");

const PORT = parseInt(process.env.PORT || "9001", 10);
const HOST = process.env.HOST || "0.0.0.0";
const MAX_PAYLOAD = 1024 * 1024; // 1MB
const HEARTBEAT_INTERVAL = 30_000;
const STALE_TIMEOUT = 90_000; // 3x heartbeat
const MAX_CONNS = 1000;

// peerId -> { ws, registeredAt, lastSeen, deviceInfo, role }
const peers = new Map();

// 临时离线消息队列 — peerId -> [{ msg, queuedAt }]
const offlineQueue = new Map();
const OFFLINE_TTL_MS = 5 * 60 * 1000;
const MAX_QUEUE_PER_PEER = 50;

let stats = {
  startedAt: Date.now(),
  totalConnections: 0,
  messagesForwarded: 0,
  errors: 0,
};

function ts() {
  return new Date().toISOString();
}

function log(level, ...args) {
  const line = `[${ts()}] [${level}]`;
  // eslint-disable-next-line no-console
  console.log(line, ...args);
}

function send(ws, obj) {
  if (ws.readyState !== WebSocket.OPEN) return false;
  try {
    ws.send(JSON.stringify(obj));
    return true;
  } catch (e) {
    log("WARN", "send failed:", e.message);
    return false;
  }
}

function flushOfflineQueue(peerId) {
  const queue = offlineQueue.get(peerId);
  if (!queue || queue.length === 0) return 0;
  const peer = peers.get(peerId);
  if (!peer) return 0;
  let delivered = 0;
  const now = Date.now();
  for (const item of queue) {
    if (now - item.queuedAt > OFFLINE_TTL_MS) continue;
    if (send(peer.ws, item.msg)) delivered++;
  }
  offlineQueue.delete(peerId);
  return delivered;
}

function handleRegister(ws, msg, fromIp) {
  const peerId = msg.peerId || msg.from;
  if (!peerId || typeof peerId !== "string") {
    send(ws, { type: "error", error: "register requires peerId" });
    return;
  }
  // 替换旧连接
  const existing = peers.get(peerId);
  if (existing && existing.ws !== ws && existing.ws.readyState === WebSocket.OPEN) {
    log("INFO", `replacing existing peer ${peerId.slice(0, 12)}…`);
    try { existing.ws.close(1000, "replaced"); } catch {}
  }
  peers.set(peerId, {
    ws,
    registeredAt: Date.now(),
    lastSeen: Date.now(),
    deviceInfo: msg.deviceInfo || {},
    role: msg.deviceInfo?.role || "unknown",
    fromIp,
  });
  ws._peerId = peerId;
  log(
    "INFO",
    `register peer=${peerId.slice(0, 24)}… role=${msg.deviceInfo?.role || "?"} from=${fromIp}`,
  );
  send(ws, { type: "registered", peerId });
  const flushed = flushOfflineQueue(peerId);
  if (flushed > 0) {
    log("INFO", `flushed ${flushed} queued messages to ${peerId.slice(0, 12)}…`);
  }
}

function handleMessage(ws, msg) {
  const to = msg.to;
  if (!to || typeof to !== "string") {
    send(ws, { type: "error", error: "message requires to" });
    return;
  }
  const target = peers.get(to);
  if (target && target.ws.readyState === WebSocket.OPEN) {
    if (send(target.ws, msg)) {
      stats.messagesForwarded++;
      log(
        "DEBUG",
        `forward ${msg.from?.slice?.(0, 12) || "?"}… → ${to.slice(0, 12)}…`,
      );
    }
    return;
  }
  // 离线队列
  const q = offlineQueue.get(to) || [];
  if (q.length >= MAX_QUEUE_PER_PEER) q.shift();
  q.push({ msg, queuedAt: Date.now() });
  offlineQueue.set(to, q);
  log(
    "INFO",
    `queue for offline peer ${to.slice(0, 12)}… (${q.length} queued)`,
  );
}

function handlePing(ws, msg) {
  send(ws, { type: "pong", ts: Date.now() });
  const peerId = ws._peerId;
  if (peerId && peers.has(peerId)) {
    peers.get(peerId).lastSeen = Date.now();
  }
}

function handleConnection(ws, req) {
  stats.totalConnections++;
  const fromIp =
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket.remoteAddress;
  const connId = crypto.randomUUID().slice(0, 8);
  log("INFO", `connect id=${connId} from=${fromIp} total=${peers.size + 1}`);

  if (peers.size >= MAX_CONNS) {
    send(ws, { type: "error", error: "server full" });
    try { ws.close(1013, "server full"); } catch {}
    return;
  }

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      send(ws, { type: "error", error: "invalid json" });
      stats.errors++;
      return;
    }
    if (!msg || typeof msg !== "object") return;
    switch (msg.type) {
      case "register":
        handleRegister(ws, msg, fromIp);
        break;
      case "message":
        handleMessage(ws, msg);
        break;
      case "ping":
        handlePing(ws, msg);
        break;
      case "unregister": {
        const peerId = ws._peerId;
        if (peerId) {
          peers.delete(peerId);
          log("INFO", `unregister ${peerId.slice(0, 12)}…`);
        }
        break;
      }
      default:
        log("DEBUG", `unknown type=${msg.type}`);
    }
  });

  ws.on("close", (code, reason) => {
    const peerId = ws._peerId;
    if (peerId && peers.get(peerId)?.ws === ws) {
      peers.delete(peerId);
      log(
        "INFO",
        `disconnect ${peerId.slice(0, 12)}… code=${code} reason=${reason?.toString?.() || ""}`,
      );
    }
  });

  ws.on("error", (err) => {
    stats.errors++;
    log("WARN", `ws error: ${err.message}`);
  });
}

function startHeartbeatSweeper() {
  setInterval(() => {
    const now = Date.now();
    for (const [peerId, peer] of peers) {
      if (now - peer.lastSeen > STALE_TIMEOUT) {
        log("INFO", `stale peer ${peerId.slice(0, 12)}… last=${now - peer.lastSeen}ms`);
        try { peer.ws.close(1001, "stale"); } catch {}
        peers.delete(peerId);
      }
    }
    // 清离线队列过期
    for (const [peerId, q] of offlineQueue) {
      const fresh = q.filter((it) => now - it.queuedAt <= OFFLINE_TTL_MS);
      if (fresh.length === 0) offlineQueue.delete(peerId);
      else offlineQueue.set(peerId, fresh);
    }
  }, HEARTBEAT_INTERVAL);
}

// 简单 HTTP health endpoint —— ws upgrade 之外的请求返 JSON 状态。
// nginx /health 探活，外网 curl 也能调试。
const http = require("http");
const httpServer = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        peers: peers.size,
        uptime: Math.floor((Date.now() - stats.startedAt) / 1000),
        stats,
      }),
    );
    return;
  }
  if (req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ChainlessChain Signaling Relay — connect via WebSocket\n");
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocket.Server({
  server: httpServer,
  maxPayload: MAX_PAYLOAD,
});
wss.on("connection", handleConnection);

httpServer.listen(PORT, HOST, () => {
  log("INFO", `relay listening on ${HOST}:${PORT} (max=${MAX_CONNS}, heartbeat=${HEARTBEAT_INTERVAL}ms)`);
  startHeartbeatSweeper();
});

process.on("SIGTERM", () => {
  log("INFO", "SIGTERM, draining…");
  for (const [, peer] of peers) {
    try { peer.ws.close(1001, "shutdown"); } catch {}
  }
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
});
