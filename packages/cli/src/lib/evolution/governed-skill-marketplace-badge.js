import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { isIP } from "node:net";
import { isGovernedSkillMarketplaceCliHost } from "./governed-skill-marketplace-cli-host.js";

const STYLE = `:root{color-scheme:light dark;font-family:system-ui,sans-serif;background:#f4f6fa;color:#152238}body{margin:0;padding:32px 16px}main{max-width:880px;margin:auto;background:#fff;padding:28px;border:1px solid #dde3ec;border-radius:16px}h1{margin:8px 0}.eyebrow{letter-spacing:.08em;color:#50627b}.status{display:inline-block;padding:6px 12px;border-radius:20px;background:#e8f5ec;color:#21623b}.revoked{background:#fdebec;color:#952a35}.score{font-size:32px;font-weight:650}.muted{color:#50627b}.notice{padding:14px;background:#f1f4fa;border-radius:8px}dl{display:grid;grid-template-columns:180px minmax(0,1fr);gap:12px;margin:24px 0}dt{font-weight:600}dd{margin:0;overflow-wrap:anywhere}code{font-size:.85em}a{color:#225caa}footer{margin-top:24px;font-size:.9em}@media(max-width:560px){main{padding:18px}dl{grid-template-columns:1fr;gap:6px}dd{margin-bottom:12px}}@media(prefers-color-scheme:dark){:root{background:#101722;color:#e1e8f2}main{background:#172231;border-color:#344154}.muted,.eyebrow{color:#afbed2}.notice{background:#233147}a{color:#96bfff}}`;
const CSP = `default-src 'none'; style-src 'sha256-${createHash("sha256").update(STYLE).digest("base64")}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}

export function renderGovernedSkillMarketplaceBadge(badge) {
  const rows = [
    [
      "目标模型 / OS / 工具 / runtime",
      [
        badge.target.model,
        badge.target.os,
        badge.target.tool,
        badge.target.runtime,
      ].join(" / "),
    ],
    ["来源模型", badge.sourceModel],
    ["签名目录摘要", badge.manifestDigest],
    ["目标评测凭证", badge.evalReceiptDigest],
    ["Eval badge 摘要", badge.evalBadgeDigest],
    ["来源 commit 摘要", badge.sourceCommitDigest],
    [
      "原始包 / 适配包",
      `${badge.packageDigest} / ${badge.adaptedOutputDigest}`,
    ],
    ["SBOM 摘要", badge.sbomDigest],
    ["依赖锁摘要", badge.dependencyLockDigest],
    ["权限清单摘要", badge.permissionManifestDigest],
    ["兼容矩阵摘要", badge.targetMatrixDigest],
    ["发布时核验", badge.verifiedAt],
    ["快照有效至", badge.expiresAt],
    ["本次状态检查", badge.checkedAt],
  ];
  const status = badge.revoked ? "已撤销 · 不可用于安装" : "已核验的评测快照";
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(badge.skillName)} · Skill 评测凭证</title><style>${STYLE}</style></head>
<body><main><p class="eyebrow">CHAINLESSCHAIN · EVAL BADGE</p><h1>${escapeHtml(badge.skillName)} <small>@ ${escapeHtml(badge.version)}</small></h1>
<p class="status${badge.revoked ? " revoked" : ""}">${status}</p><p><span class="score">${escapeHtml((badge.qualityScore * 100).toFixed(1))}%</span> 目标评分 · ${escapeHtml(badge.sampleCount)} 个样本</p>
<p class="notice">此页展示发布时的目标评测与适配核验结果。目录签名和已记录撤销在每次访问时重新检查；其他 authority 的后续撤销不由此快照证明。页面不代表已安装、已启用或新的运行授权。</p>
<dl>${rows.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd><code>${escapeHtml(value)}</code></dd>`).join("\n")}</dl>
<p><a href="/badge.json">查看公开 JSON 投影</a></p><footer class="muted">仅公开必要元数据与证据摘要，不公开租户、候选内容、签名原文或私有回执。独立复核和复现需要发布者另行提供原始签名证据及可公开的评测材料。</footer></main></body></html>`;
}

function integer(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new TypeError(`${label} is out of range`);
}

/** Publish one explicitly selected immutable listing; no browse or mutation API. */
export async function startGovernedSkillMarketplaceBadgeServer({
  marketplaceHost,
  skillName,
  version,
  manifestDigest,
  listen = "127.0.0.1",
  port = 8321,
  snapshotTtlMs = 600_000,
  requestTimeoutMs = 5_000,
  maxConcurrentRequests = 4,
  now = Date.now,
} = {}) {
  if (!isGovernedSkillMarketplaceCliHost(marketplaceHost))
    throw new TypeError("public badges require a branded marketplace host");
  if (!isIP(listen))
    throw new TypeError("badge listen address must be an IP literal");
  integer(port, "badge port", 0, 65535);
  integer(snapshotTtlMs, "badge snapshot TTL", 1_000, 3_600_000);
  integer(requestTimeoutMs, "badge request timeout", 10, 30_000);
  integer(maxConcurrentRequests, "badge concurrency", 1, 16);
  if (typeof now !== "function") throw new TypeError("badge clock is required");
  const timestamp = () => {
    const value = now();
    if (
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value > 8_640_000_000_000_000 - snapshotTtlMs
    )
      throw new Error("badge clock is invalid");
    return value;
  };
  const reader = await marketplaceHost.preparePublicBadge({
    skillName,
    version,
    manifestDigest,
  });
  await reader.read();
  const verifiedAt = timestamp();
  const expiresAt = verifiedAt + snapshotTtlMs;
  let inFlight = 0;
  const server = createServer({ maxHeaderSize: 8192 }, (request, response) => {
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.setHeader("Content-Security-Policy", CSP);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");
    const finish = (status, body, type = "text/plain; charset=utf-8") => {
      if (response.writableEnded || response.destroyed) return;
      response.statusCode = status;
      response.setHeader("Content-Type", type);
      response.end(request.method === "HEAD" ? undefined : body);
    };
    if (!["GET", "HEAD"].includes(request.method)) {
      response.setHeader("Allow", "GET, HEAD");
      response.setHeader("Connection", "close");
      finish(405, "Read-only badge endpoint.");
      return;
    }
    if (
      request.headers["transfer-encoding"] ||
      (request.headers["content-length"] &&
        request.headers["content-length"] !== "0")
    ) {
      response.setHeader("Connection", "close");
      finish(400, "Request bodies are not accepted.");
      return;
    }
    if (request.url !== "/" && request.url !== "/badge.json") {
      finish(404, "Badge endpoint not found.");
      return;
    }
    if (inFlight >= maxConcurrentRequests) {
      response.setHeader("Retry-After", "5");
      finish(429, "Badge verification is busy.");
      return;
    }
    inFlight += 1;
    const timer = setTimeout(
      () => finish(503, "Badge verification is unavailable."),
      requestTimeoutMs,
    );
    Promise.resolve()
      .then(async () => {
        const before = timestamp();
        if (before < verifiedAt || before >= expiresAt)
          throw new Error("snapshot expired");
        const current = await reader.read();
        const checkedAt = timestamp();
        if (checkedAt < before || checkedAt >= expiresAt)
          throw new Error("snapshot expired");
        const badge = {
          ...current,
          verifiedAt: new Date(verifiedAt).toISOString(),
          expiresAt: new Date(expiresAt).toISOString(),
          checkedAt: new Date(checkedAt).toISOString(),
        };
        if (request.url === "/badge.json")
          finish(
            200,
            `${JSON.stringify(badge, null, 2)}\n`,
            "application/json; charset=utf-8",
          );
        else
          finish(
            200,
            renderGovernedSkillMarketplaceBadge(badge),
            "text/html; charset=utf-8",
          );
      })
      .catch(() => finish(503, "Badge verification is unavailable."))
      .finally(() => {
        clearTimeout(timer);
        // A timed-out underlying verifier retains its slot until it settles.
        inFlight -= 1;
      });
  });
  server.maxConnections = 32;
  server.maxRequestsPerSocket = 16;
  server.headersTimeout = 5_000;
  server.requestTimeout = 5_000;
  server.keepAliveTimeout = 1_000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, listen, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  const hostname =
    isIP(address.address) === 6 ? `[${address.address}]` : address.address;
  let closing;
  return Object.freeze({
    server,
    url: `http://${hostname}:${address.port}/`,
    close: () =>
      (closing ??= new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      })),
  });
}
