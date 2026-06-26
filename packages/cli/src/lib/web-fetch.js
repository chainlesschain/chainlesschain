/**
 * Web Fetch — agent-safe HTTP(S) GET with allowlist + size/timeout limits.
 *
 * Inspired by open-agents web_fetch tool. Guards against SSRF by rejecting
 * private/loopback hosts unless explicitly allowlisted.
 */

import http from "http";
import https from "https";
import { lookup as dnsLookup } from "dns";
import { URL } from "url";

const DEFAULT_MAX_BYTES = 2_000_000;
const DEFAULT_TIMEOUT_MS = 15_000;

// RFC 1918 + loopback + link-local (IPv4 and IPv6). Blocked by default unless
// config.allowPrivateHosts. Decimal/integer IPv4 forms (http://2130706433,
// http://0) are normalized to dotted-decimal by `new URL()` before they reach
// here, so the IPv4 patterns catch them too.
const PRIVATE_HOST_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./, // link-local incl. cloud metadata 169.254.169.254
  /^0\.0\.0\.0$/,
  /^0$/, // bare 0 → 0.0.0.0
  /^::1$/, // IPv6 loopback
  /^::$/, // IPv6 unspecified (== 0.0.0.0)
  /^f[cd][0-9a-f]{2}:/, // fc00::/7 unique-local (ULA)
  /^fe[89ab][0-9a-f]:/, // fe80::/10 link-local
  /^localhost$/i,
];

// Decode the IPv4 embedded in an IPv4-mapped IPv6 address back to dotted form,
// or null if `h` is not such an address. `new URL()` normalizes the embedded
// IPv4 to hex (::ffff:127.0.0.1 → ::ffff:7f00:1), so without decoding, a fetch
// to [::ffff:127.0.0.1] would bypass the IPv4 loopback/private rules.
function mappedIPv4(h) {
  const m = /^::ffff:(.+)$/.exec(h);
  if (!m) return null;
  const tail = m[1];
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(tail)) return tail; // already dotted
  const hx = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(tail);
  if (!hx) return null;
  const a = parseInt(hx[1], 16);
  const b = parseInt(hx[2], 16);
  return [(a >> 8) & 255, a & 255, (b >> 8) & 255, b & 255].join(".");
}

export function isPrivateHost(host) {
  if (!host) return true;
  let h = String(host).toLowerCase();
  // `new URL().hostname` returns IPv6 hosts bracketed ("[::1]") — strip so the
  // IPv6 patterns (and the previously-dead ::1 rule) actually match.
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  const v4 = mappedIPv4(h);
  if (v4) h = v4; // re-check the embedded IPv4 against the IPv4 rules
  return PRIVATE_HOST_PATTERNS.some((re) => re.test(h));
}

export function checkAllowed(urlStr, config = {}) {
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { allowed: false, reason: "invalid URL" };
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    return {
      allowed: false,
      reason: `unsupported protocol: ${parsed.protocol}`,
    };
  }
  if (isPrivateHost(parsed.hostname) && !config.allowPrivateHosts) {
    return {
      allowed: false,
      reason: `private/loopback host blocked: ${parsed.hostname}`,
    };
  }
  const allowed = Array.isArray(config.allowedDomains)
    ? config.allowedDomains
    : ["*"];
  if (!allowed.includes("*")) {
    const match = allowed.some((pattern) => {
      if (pattern.startsWith("*.")) {
        return parsed.hostname.endsWith(pattern.slice(1));
      }
      return parsed.hostname === pattern;
    });
    if (!match) {
      return {
        allowed: false,
        reason: `host not in allowedDomains: ${parsed.hostname}`,
      };
    }
  }
  return { allowed: true, url: parsed };
}

export function htmlToMarkdown(html) {
  if (!html) return "";
  let text = String(html);
  // Strip scripts/styles entirely
  text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<!--[\s\S]*?-->/g, "");
  // Convert headings
  text = text.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, inner) => {
    return `\n\n${"#".repeat(Number(n))} ${inner.trim()}\n\n`;
  });
  // Paragraphs / breaks
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n\n");
  // Links: [text](href)
  text = text.replace(
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_, href, inner) => `[${stripTags(inner).trim()}](${href})`,
  );
  // List items
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, inner) => {
    return `- ${stripTags(inner).trim()}\n`;
  });
  // Strip remaining tags
  text = stripTags(text);
  // Decode minimal HTML entities
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  // Collapse whitespace
  text = text.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+/g, " ");
  return text.trim();
}

function stripTags(html) {
  return String(html).replace(/<[^>]+>/g, "");
}

/**
 * A `lookup` for http(s).request that resolves the hostname and REJECTS the
 * connection if any resolved IP is private/loopback/link-local. checkAllowed
 * only inspects the URL's literal hostname, so a public-looking domain that
 * DNS-resolves to an internal IP (e.g. 169.254.169.254 cloud metadata) would
 * otherwise sail through — classic DNS-based SSRF. Because Node connects to the
 * exact address this returns, it also closes the DNS-rebinding TOCTOU window.
 * Returns a Node-style lookup fn; `allowPrivateHosts` opts out (same flag as
 * checkAllowed).
 */
export function makeSafeLookup(allowPrivateHosts, deps = _deps) {
  const lookup = deps.lookup || dnsLookup;
  return (hostname, options, callback) => {
    const cb = typeof options === "function" ? options : callback;
    const opts = typeof options === "function" ? {} : options || {};
    lookup(hostname, { ...opts, all: true }, (err, addresses) => {
      if (err) return cb(err);
      const list = Array.isArray(addresses) ? addresses : [];
      if (list.length === 0) {
        return cb(new Error(`could not resolve host: ${hostname}`));
      }
      if (!allowPrivateHosts) {
        for (const a of list) {
          if (isPrivateHost(a.address)) {
            return cb(
              new Error(`private/loopback resolved IP blocked: ${a.address}`),
            );
          }
        }
      }
      const chosen = list[0];
      cb(null, chosen.address, chosen.family);
    });
  };
}

async function _doRequest(
  parsed,
  { maxBytes, timeout, headers, allowPrivateHosts },
) {
  const lib = parsed.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        method: "GET",
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        // Resolve-and-check: reject the connection if the host resolves to a
        // private IP (DNS-SSRF + rebinding guard). String-host check is in
        // checkAllowed; this covers the resolved address.
        lookup: makeSafeLookup(allowPrivateHosts),
        headers: {
          "User-Agent": "ChainlessChain-Agent/1.0",
          Accept: "*/*",
          ...headers,
        },
        timeout,
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          return resolve({ redirect: res.headers.location });
        }
        const chunks = [];
        let size = 0;
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            req.destroy(new Error(`response exceeds maxBytes (${maxBytes})`));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("request timeout")));
    req.end();
  });
}

export async function webFetch(url, options = {}) {
  const {
    format = "markdown",
    maxBytes = DEFAULT_MAX_BYTES,
    timeout = DEFAULT_TIMEOUT_MS,
    config = {},
    headers = {},
    maxRedirects = 3,
  } = options;

  const check = checkAllowed(url, config);
  if (!check.allowed) {
    return { error: `web_fetch blocked: ${check.reason}` };
  }

  let parsed = check.url;
  let redirects = 0;
  let response;
  while (true) {
    response = await _doRequest(parsed, {
      maxBytes,
      timeout,
      headers,
      allowPrivateHosts: config.allowPrivateHosts,
    });
    if (!response.redirect) break;
    if (++redirects > maxRedirects) {
      return { error: "too many redirects" };
    }
    const next = new URL(response.redirect, parsed);
    const nextCheck = checkAllowed(next.toString(), config);
    if (!nextCheck.allowed) {
      return { error: `redirect blocked: ${nextCheck.reason}` };
    }
    parsed = nextCheck.url;
  }

  const { statusCode, headers: respHeaders, body } = response;
  const contentType = String(respHeaders["content-type"] || "");

  let output = body;
  let outputFormat = format;
  if (format === "markdown") {
    output = /html/i.test(contentType) ? htmlToMarkdown(body) : body;
  } else if (format === "text") {
    output = /html/i.test(contentType) ? stripTags(body) : body;
  } else if (format === "json") {
    try {
      output = JSON.parse(body);
    } catch {
      return { error: "response is not valid JSON", statusCode, body };
    }
  }

  return {
    url: parsed.toString(),
    statusCode,
    contentType,
    format: outputFormat,
    bytes: Buffer.byteLength(body, "utf8"),
    content: output,
  };
}

// `lookup` is injectable so tests can resolve a domain to a private IP without
// real network; production uses the system resolver.
export const _deps = { http, https, lookup: dnsLookup };

// ===== V2 Surface: Web Fetch governance overlay (CLI v0.142.0) =====
export const WFET_TARGET_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  DEGRADED: "degraded",
  RETIRED: "retired",
});
export const WFET_JOB_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  FETCHING: "fetching",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _wfetTTrans = new Map([
  [
    WFET_TARGET_MATURITY_V2.PENDING,
    new Set([WFET_TARGET_MATURITY_V2.ACTIVE, WFET_TARGET_MATURITY_V2.RETIRED]),
  ],
  [
    WFET_TARGET_MATURITY_V2.ACTIVE,
    new Set([
      WFET_TARGET_MATURITY_V2.DEGRADED,
      WFET_TARGET_MATURITY_V2.RETIRED,
    ]),
  ],
  [
    WFET_TARGET_MATURITY_V2.DEGRADED,
    new Set([WFET_TARGET_MATURITY_V2.ACTIVE, WFET_TARGET_MATURITY_V2.RETIRED]),
  ],
  [WFET_TARGET_MATURITY_V2.RETIRED, new Set()],
]);
const _wfetTTerminal = new Set([WFET_TARGET_MATURITY_V2.RETIRED]);
const _wfetJTrans = new Map([
  [
    WFET_JOB_LIFECYCLE_V2.QUEUED,
    new Set([WFET_JOB_LIFECYCLE_V2.FETCHING, WFET_JOB_LIFECYCLE_V2.CANCELLED]),
  ],
  [
    WFET_JOB_LIFECYCLE_V2.FETCHING,
    new Set([
      WFET_JOB_LIFECYCLE_V2.SUCCEEDED,
      WFET_JOB_LIFECYCLE_V2.FAILED,
      WFET_JOB_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [WFET_JOB_LIFECYCLE_V2.SUCCEEDED, new Set()],
  [WFET_JOB_LIFECYCLE_V2.FAILED, new Set()],
  [WFET_JOB_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _wfetTsV2 = new Map();
const _wfetJsV2 = new Map();
let _wfetMaxActive = 12,
  _wfetMaxPending = 30,
  _wfetIdleMs = 7 * 24 * 60 * 60 * 1000,
  _wfetStuckMs = 60 * 1000;
function _wfetPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _wfetCheckT(from, to) {
  const a = _wfetTTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid wfet target transition ${from} → ${to}`);
}
function _wfetCheckJ(from, to) {
  const a = _wfetJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid wfet job transition ${from} → ${to}`);
}
export function setMaxActiveWfetTargetsPerOwnerV2(n) {
  _wfetMaxActive = _wfetPos(n, "maxActiveWfetTargetsPerOwner");
}
export function getMaxActiveWfetTargetsPerOwnerV2() {
  return _wfetMaxActive;
}
export function setMaxPendingWfetJobsPerTargetV2(n) {
  _wfetMaxPending = _wfetPos(n, "maxPendingWfetJobsPerTarget");
}
export function getMaxPendingWfetJobsPerTargetV2() {
  return _wfetMaxPending;
}
export function setWfetTargetIdleMsV2(n) {
  _wfetIdleMs = _wfetPos(n, "wfetTargetIdleMs");
}
export function getWfetTargetIdleMsV2() {
  return _wfetIdleMs;
}
export function setWfetJobStuckMsV2(n) {
  _wfetStuckMs = _wfetPos(n, "wfetJobStuckMs");
}
export function getWfetJobStuckMsV2() {
  return _wfetStuckMs;
}
export function _resetStateWebFetchV2() {
  _wfetTsV2.clear();
  _wfetJsV2.clear();
  _wfetMaxActive = 12;
  _wfetMaxPending = 30;
  _wfetIdleMs = 7 * 24 * 60 * 60 * 1000;
  _wfetStuckMs = 60 * 1000;
}
export function registerWfetTargetV2({ id, owner, baseUrl, metadata } = {}) {
  if (!id) throw new Error("wfet target id required");
  if (!owner) throw new Error("wfet target owner required");
  if (_wfetTsV2.has(id))
    throw new Error(`wfet target ${id} already registered`);
  const now = Date.now();
  const t = {
    id,
    owner,
    baseUrl: baseUrl || "",
    status: WFET_TARGET_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    activatedAt: null,
    retiredAt: null,
    lastTouchedAt: now,
    metadata: { ...(metadata || {}) },
  };
  _wfetTsV2.set(id, t);
  return { ...t, metadata: { ...t.metadata } };
}
function _wfetCountActive(owner) {
  let n = 0;
  for (const t of _wfetTsV2.values())
    if (t.owner === owner && t.status === WFET_TARGET_MATURITY_V2.ACTIVE) n++;
  return n;
}
export function activateWfetTargetV2(id) {
  const t = _wfetTsV2.get(id);
  if (!t) throw new Error(`wfet target ${id} not found`);
  _wfetCheckT(t.status, WFET_TARGET_MATURITY_V2.ACTIVE);
  const recovery = t.status === WFET_TARGET_MATURITY_V2.DEGRADED;
  if (!recovery && _wfetCountActive(t.owner) >= _wfetMaxActive)
    throw new Error(`max active wfet targets for owner ${t.owner} reached`);
  const now = Date.now();
  t.status = WFET_TARGET_MATURITY_V2.ACTIVE;
  t.updatedAt = now;
  t.lastTouchedAt = now;
  if (!t.activatedAt) t.activatedAt = now;
  return { ...t, metadata: { ...t.metadata } };
}
export function degradeWfetTargetV2(id) {
  const t = _wfetTsV2.get(id);
  if (!t) throw new Error(`wfet target ${id} not found`);
  _wfetCheckT(t.status, WFET_TARGET_MATURITY_V2.DEGRADED);
  t.status = WFET_TARGET_MATURITY_V2.DEGRADED;
  t.updatedAt = Date.now();
  return { ...t, metadata: { ...t.metadata } };
}
export function retireWfetTargetV2(id) {
  const t = _wfetTsV2.get(id);
  if (!t) throw new Error(`wfet target ${id} not found`);
  _wfetCheckT(t.status, WFET_TARGET_MATURITY_V2.RETIRED);
  const now = Date.now();
  t.status = WFET_TARGET_MATURITY_V2.RETIRED;
  t.updatedAt = now;
  if (!t.retiredAt) t.retiredAt = now;
  return { ...t, metadata: { ...t.metadata } };
}
export function touchWfetTargetV2(id) {
  const t = _wfetTsV2.get(id);
  if (!t) throw new Error(`wfet target ${id} not found`);
  if (_wfetTTerminal.has(t.status))
    throw new Error(`cannot touch terminal wfet target ${id}`);
  const now = Date.now();
  t.lastTouchedAt = now;
  t.updatedAt = now;
  return { ...t, metadata: { ...t.metadata } };
}
export function getWfetTargetV2(id) {
  const t = _wfetTsV2.get(id);
  if (!t) return null;
  return { ...t, metadata: { ...t.metadata } };
}
export function listWfetTargetsV2() {
  return [..._wfetTsV2.values()].map((t) => ({
    ...t,
    metadata: { ...t.metadata },
  }));
}
function _wfetCountPending(targetId) {
  let n = 0;
  for (const j of _wfetJsV2.values())
    if (
      j.targetId === targetId &&
      (j.status === WFET_JOB_LIFECYCLE_V2.QUEUED ||
        j.status === WFET_JOB_LIFECYCLE_V2.FETCHING)
    )
      n++;
  return n;
}
export function createWfetJobV2({ id, targetId, kind, metadata } = {}) {
  if (!id) throw new Error("wfet job id required");
  if (!targetId) throw new Error("wfet job targetId required");
  if (_wfetJsV2.has(id)) throw new Error(`wfet job ${id} already exists`);
  if (!_wfetTsV2.has(targetId))
    throw new Error(`wfet target ${targetId} not found`);
  if (_wfetCountPending(targetId) >= _wfetMaxPending)
    throw new Error(`max pending wfet jobs for target ${targetId} reached`);
  const now = Date.now();
  const j = {
    id,
    targetId,
    kind: kind || "GET",
    status: WFET_JOB_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _wfetJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function fetchingWfetJobV2(id) {
  const j = _wfetJsV2.get(id);
  if (!j) throw new Error(`wfet job ${id} not found`);
  _wfetCheckJ(j.status, WFET_JOB_LIFECYCLE_V2.FETCHING);
  const now = Date.now();
  j.status = WFET_JOB_LIFECYCLE_V2.FETCHING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function succeedWfetJobV2(id) {
  const j = _wfetJsV2.get(id);
  if (!j) throw new Error(`wfet job ${id} not found`);
  _wfetCheckJ(j.status, WFET_JOB_LIFECYCLE_V2.SUCCEEDED);
  const now = Date.now();
  j.status = WFET_JOB_LIFECYCLE_V2.SUCCEEDED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failWfetJobV2(id, reason) {
  const j = _wfetJsV2.get(id);
  if (!j) throw new Error(`wfet job ${id} not found`);
  _wfetCheckJ(j.status, WFET_JOB_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = WFET_JOB_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelWfetJobV2(id, reason) {
  const j = _wfetJsV2.get(id);
  if (!j) throw new Error(`wfet job ${id} not found`);
  _wfetCheckJ(j.status, WFET_JOB_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = WFET_JOB_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getWfetJobV2(id) {
  const j = _wfetJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listWfetJobsV2() {
  return [..._wfetJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoDegradeIdleWfetTargetsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const x of _wfetTsV2.values())
    if (
      x.status === WFET_TARGET_MATURITY_V2.ACTIVE &&
      t - x.lastTouchedAt >= _wfetIdleMs
    ) {
      x.status = WFET_TARGET_MATURITY_V2.DEGRADED;
      x.updatedAt = t;
      flipped.push(x.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckWfetJobsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _wfetJsV2.values())
    if (
      j.status === WFET_JOB_LIFECYCLE_V2.FETCHING &&
      j.startedAt != null &&
      t - j.startedAt >= _wfetStuckMs
    ) {
      j.status = WFET_JOB_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getWebFetchGovStatsV2() {
  const targetsByStatus = {};
  for (const v of Object.values(WFET_TARGET_MATURITY_V2))
    targetsByStatus[v] = 0;
  for (const t of _wfetTsV2.values()) targetsByStatus[t.status]++;
  const jobsByStatus = {};
  for (const v of Object.values(WFET_JOB_LIFECYCLE_V2)) jobsByStatus[v] = 0;
  for (const j of _wfetJsV2.values()) jobsByStatus[j.status]++;
  return {
    totalWfetTargetsV2: _wfetTsV2.size,
    totalWfetJobsV2: _wfetJsV2.size,
    maxActiveWfetTargetsPerOwner: _wfetMaxActive,
    maxPendingWfetJobsPerTarget: _wfetMaxPending,
    wfetTargetIdleMs: _wfetIdleMs,
    wfetJobStuckMs: _wfetStuckMs,
    targetsByStatus,
    jobsByStatus,
  };
}
