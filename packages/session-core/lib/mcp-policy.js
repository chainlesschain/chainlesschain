/**
 * MCP Policy — 92_Deep_Agents_Deploy 借鉴落地方案 Phase 3
 *
 * 显式定义 local / lan / hosted 三种运行模式下 MCP server 的兼容矩阵.
 *
 * 规则:
 *   local:  允许 stdio / http / sse / https / ws / wss
 *   lan:    允许 http / sse / https / ws / wss (stdio 仅在 bundle 标记 lanAllowed 时)
 *   hosted: 只允许 http / sse / https / ws / wss, 永远禁止 stdio
 *
 * server 配置可通过 `modeCompatibility` 字段显式声明兼容模式,
 * 否则按 transport 推断.
 *
 *   {
 *     name: "filesystem",
 *     transport: "stdio",              // 或 "http" / "sse" / "ws"
 *     command: "npx",                  // stdio 必填
 *     args: [...],
 *     url: "https://...",              // http/sse/ws 必填
 *     modeCompatibility: ["local"]     // 可选,显式限制兼容模式
 *   }
 */

const { BUNDLE_MODES } = require("./agent-bundle-schema.js");

const TRANSPORTS = Object.freeze({
  STDIO: "stdio",
  HTTP: "http",
  HTTPS: "https",
  SSE: "sse",
  WS: "ws",
  WSS: "wss",
});

const REMOTE_TRANSPORTS = Object.freeze([
  TRANSPORTS.HTTP,
  TRANSPORTS.HTTPS,
  TRANSPORTS.SSE,
  TRANSPORTS.WS,
  TRANSPORTS.WSS,
]);

const MODE_ALLOWED_TRANSPORTS = Object.freeze({
  [BUNDLE_MODES.LOCAL]: Object.freeze([
    TRANSPORTS.STDIO,
    ...REMOTE_TRANSPORTS,
  ]),
  [BUNDLE_MODES.LAN]: Object.freeze([...REMOTE_TRANSPORTS]),
  [BUNDLE_MODES.HOSTED]: Object.freeze([...REMOTE_TRANSPORTS]),
});

/**
 * 推断单个 server 的 transport.
 * 优先显式字段, 退化用 url / command 判断.
 */
function inferTransport(server) {
  if (!server || typeof server !== "object") return null;
  if (server.transport) return String(server.transport).toLowerCase();
  if (server.url) {
    try {
      const proto = new URL(server.url).protocol.replace(":", "").toLowerCase();
      if (
        proto === "http" ||
        proto === "https" ||
        proto === "ws" ||
        proto === "wss"
      ) {
        return proto;
      }
    } catch {
      // ignore
    }
  }
  if (server.command) return TRANSPORTS.STDIO;
  return null;
}

/**
 * validateMcpServer(server, mode) → { allowed: bool, reason: string|null, transport }
 */
function validateMcpServer(server, mode = BUNDLE_MODES.LOCAL) {
  const transport = inferTransport(server);
  if (!transport) {
    return {
      allowed: false,
      reason: "cannot infer transport (missing transport/url/command)",
      transport: null,
    };
  }

  const allowedList = MODE_ALLOWED_TRANSPORTS[mode];
  if (!allowedList) {
    return {
      allowed: false,
      reason: `unknown mode "${mode}"`,
      transport,
    };
  }

  // 显式 modeCompatibility 覆盖默认规则(进一步收紧,不能放宽)
  if (Array.isArray(server.modeCompatibility)) {
    if (!server.modeCompatibility.includes(mode)) {
      return {
        allowed: false,
        reason: `server declares modeCompatibility=${JSON.stringify(server.modeCompatibility)}, not "${mode}"`,
        transport,
      };
    }
  }

  if (!allowedList.includes(transport)) {
    return {
      allowed: false,
      reason: `transport "${transport}" is not allowed in mode "${mode}"`,
      transport,
    };
  }

  return { allowed: true, reason: null, transport };
}

/**
 * filterMcpServers(serversMap, mode)
 *   → { allowed: {name → server}, rejected: Array<{name, reason, transport}> }
 *
 * 输入既支持 map 形式 `{ name: {...} }`,也支持 list `[ { name, ... } ]`.
 */
function filterMcpServers(servers, mode = BUNDLE_MODES.LOCAL) {
  const allowed = {};
  const rejected = [];

  const entries = Array.isArray(servers)
    ? servers.map((s) => [s.name, s])
    : Object.entries(servers || {});

  for (const [name, cfg] of entries) {
    if (!name) {
      rejected.push({ name: null, reason: "missing name", transport: null });
      continue;
    }
    const result = validateMcpServer(cfg, mode);
    if (result.allowed) {
      allowed[name] = cfg;
    } else {
      rejected.push({ name, reason: result.reason, transport: result.transport });
    }
  }

  return { allowed, rejected };
}

/**
 * annotateCompatibility(server)
 *   → { ...server, _modeCompatibility: string[] }
 *
 * 给 UI 展示用,标注该 server 在哪些模式下可用.
 */
function annotateCompatibility(server) {
  const modes = [];
  for (const mode of Object.values(BUNDLE_MODES)) {
    if (validateMcpServer(server, mode).allowed) modes.push(mode);
  }
  return { ...server, _modeCompatibility: modes };
}

module.exports = {
  TRANSPORTS,
  REMOTE_TRANSPORTS,
  MODE_ALLOWED_TRANSPORTS,
  inferTransport,
  validateMcpServer,
  filterMcpServers,
  annotateCompatibility,
};
