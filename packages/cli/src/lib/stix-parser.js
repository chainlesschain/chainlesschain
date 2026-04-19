/**
 * STIX 2.1 Indicator Parser — extracts IoC (indicators of compromise)
 * from STIX 2.1 bundles or loose objects.
 *
 * Supports the most common observable types used in threat feeds:
 *   file-hash (md5/sha1/sha256/sha512), ipv4-addr, ipv6-addr,
 *   domain-name, url, email-addr.
 *
 * Reference: https://docs.oasis-open.org/cti/stix/v2.1/stix-v2.1.html
 *
 * The STIX pattern grammar is too rich for a full parser to live here;
 * this module handles the simple `[<object-path> = '<value>']` shape
 * (optionally joined by OR / AND / FOLLOWEDBY) that covers the vast
 * majority of real-world indicator feeds (AlienVault OTX, MISP export,
 * MITRE ATT&CK, etc.).
 */

export const IOC_TYPES = Object.freeze([
  "file-md5",
  "file-sha1",
  "file-sha256",
  "file-sha512",
  "ipv4",
  "ipv6",
  "domain",
  "url",
  "email",
]);

/**
 * Map a STIX object-path + hash-key to one of our IOC_TYPES.
 * Returns null for unsupported observable types.
 */
function _classify(objectPath, hashKey) {
  const p = objectPath.toLowerCase();
  switch (p) {
    case "file:hashes":
      switch ((hashKey || "").toUpperCase()) {
        case "MD5":
          return "file-md5";
        case "SHA-1":
        case "SHA1":
          return "file-sha1";
        case "SHA-256":
        case "SHA256":
          return "file-sha256";
        case "SHA-512":
        case "SHA512":
          return "file-sha512";
        default:
          return null;
      }
    case "ipv4-addr:value":
      return "ipv4";
    case "ipv6-addr:value":
      return "ipv6";
    case "domain-name:value":
      return "domain";
    case "url:value":
      return "url";
    case "email-addr:value":
      return "email";
    default:
      return null;
  }
}

const _termRegex =
  /([a-z0-9_-]+(?::[a-z0-9_-]+)?)(?:\.'([^']+)'|\.([a-z0-9_-]+))?\s*=\s*'((?:\\'|[^'])*)'/gi;

/**
 * Parse a STIX pattern string and yield raw matches of the simple
 * comparison form: `<object:path>[.<key>] = '<value>'`. Joiners
 * (OR/AND/FOLLOWEDBY) between terms are ignored — each matched term
 * becomes its own IoC.
 */
export function parseStixPattern(pattern) {
  if (typeof pattern !== "string") return [];
  const out = [];
  let m;
  _termRegex.lastIndex = 0;
  while ((m = _termRegex.exec(pattern)) !== null) {
    const [, rawObjectPath, quotedKey, bareKey, rawValue] = m;
    const hashKey = quotedKey || bareKey || null;
    const objectPath = hashKey
      ? `${rawObjectPath.toLowerCase()}`
      : rawObjectPath.toLowerCase();
    const iocType = _classify(objectPath, hashKey);
    if (!iocType) continue;
    const value = rawValue.replace(/\\'/g, "'");
    out.push({ type: iocType, value });
  }
  return out;
}

/**
 * Extract indicators from a parsed STIX 2.1 object. Returns an array
 * of `{type, value, source: {indicatorId, name, labels, confidence,
 * valid_from, valid_until}}` entries.
 */
export function extractIndicatorsFromObject(obj) {
  if (!obj || typeof obj !== "object") return [];
  if (obj.type !== "indicator") return [];
  const pattern = obj.pattern;
  if (!pattern) return [];
  if (obj.pattern_type && obj.pattern_type !== "stix") {
    // Only STIX-pattern indicators are supported; feeds may ship
    // snort/yara/pcre patterns which we ignore.
    return [];
  }
  const iocs = parseStixPattern(pattern);
  const source = {
    indicatorId: obj.id || null,
    name: obj.name || null,
    labels: Array.isArray(obj.indicator_types)
      ? obj.indicator_types.slice()
      : Array.isArray(obj.labels)
        ? obj.labels.slice()
        : [],
    confidence: typeof obj.confidence === "number" ? obj.confidence : null,
    validFrom: obj.valid_from || null,
    validUntil: obj.valid_until || null,
  };
  return iocs.map((ioc) => ({ ...ioc, source }));
}

/**
 * Extract indicators from a STIX 2.1 bundle (`{type:"bundle", objects:[…]}`)
 * or a loose array of STIX objects. Unknown inputs return [].
 */
export function extractIndicatorsFromBundle(bundle) {
  if (!bundle) return [];
  const objects = Array.isArray(bundle)
    ? bundle
    : bundle.type === "bundle" && Array.isArray(bundle.objects)
      ? bundle.objects
      : null;
  if (!objects) return [];
  const out = [];
  for (const obj of objects) {
    for (const ioc of extractIndicatorsFromObject(obj)) {
      out.push(ioc);
    }
  }
  return out;
}

/**
 * Best-effort classifier for an arbitrary observable string supplied
 * by the user (via `cc compliance threat-intel match <value>`).
 * Returns one of IOC_TYPES or "unknown".
 */
export function classifyObservable(value) {
  if (typeof value !== "string") return "unknown";
  const v = value.trim();
  if (!v) return "unknown";
  if (/^[a-f0-9]{32}$/i.test(v)) return "file-md5";
  if (/^[a-f0-9]{40}$/i.test(v)) return "file-sha1";
  if (/^[a-f0-9]{64}$/i.test(v)) return "file-sha256";
  if (/^[a-f0-9]{128}$/i.test(v)) return "file-sha512";
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) return "ipv4";
  if (/^[0-9a-f:]+$/i.test(v) && v.includes(":")) return "ipv6";
  if (/^https?:\/\//i.test(v)) return "url";
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return "email";
  if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(v)) return "domain";
  return "unknown";
}

// =====================================================================
// stix-parser V2 governance overlay (iter27)
// =====================================================================
export const STIXGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  STALE: "stale",
  ARCHIVED: "archived",
});
export const STIXGOV_PARSE_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  PARSING: "parsing",
  PARSED: "parsed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _stixgovPTrans = new Map([
  [
    STIXGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      STIXGOV_PROFILE_MATURITY_V2.ACTIVE,
      STIXGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    STIXGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      STIXGOV_PROFILE_MATURITY_V2.STALE,
      STIXGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    STIXGOV_PROFILE_MATURITY_V2.STALE,
    new Set([
      STIXGOV_PROFILE_MATURITY_V2.ACTIVE,
      STIXGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [STIXGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _stixgovPTerminal = new Set([STIXGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _stixgovJTrans = new Map([
  [
    STIXGOV_PARSE_LIFECYCLE_V2.QUEUED,
    new Set([
      STIXGOV_PARSE_LIFECYCLE_V2.PARSING,
      STIXGOV_PARSE_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    STIXGOV_PARSE_LIFECYCLE_V2.PARSING,
    new Set([
      STIXGOV_PARSE_LIFECYCLE_V2.PARSED,
      STIXGOV_PARSE_LIFECYCLE_V2.FAILED,
      STIXGOV_PARSE_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [STIXGOV_PARSE_LIFECYCLE_V2.PARSED, new Set()],
  [STIXGOV_PARSE_LIFECYCLE_V2.FAILED, new Set()],
  [STIXGOV_PARSE_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _stixgovPsV2 = new Map();
const _stixgovJsV2 = new Map();
let _stixgovMaxActive = 6,
  _stixgovMaxPending = 15,
  _stixgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _stixgovStuckMs = 60 * 1000;
function _stixgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _stixgovCheckP(from, to) {
  const a = _stixgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid stixgov profile transition ${from} → ${to}`);
}
function _stixgovCheckJ(from, to) {
  const a = _stixgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid stixgov parse transition ${from} → ${to}`);
}
function _stixgovCountActive(owner) {
  let c = 0;
  for (const p of _stixgovPsV2.values())
    if (p.owner === owner && p.status === STIXGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _stixgovCountPending(profileId) {
  let c = 0;
  for (const j of _stixgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === STIXGOV_PARSE_LIFECYCLE_V2.QUEUED ||
        j.status === STIXGOV_PARSE_LIFECYCLE_V2.PARSING)
    )
      c++;
  return c;
}
export function setMaxActiveStixgovProfilesPerOwnerV2(n) {
  _stixgovMaxActive = _stixgovPos(n, "maxActiveStixgovProfilesPerOwner");
}
export function getMaxActiveStixgovProfilesPerOwnerV2() {
  return _stixgovMaxActive;
}
export function setMaxPendingStixgovParsesPerProfileV2(n) {
  _stixgovMaxPending = _stixgovPos(n, "maxPendingStixgovParsesPerProfile");
}
export function getMaxPendingStixgovParsesPerProfileV2() {
  return _stixgovMaxPending;
}
export function setStixgovProfileIdleMsV2(n) {
  _stixgovIdleMs = _stixgovPos(n, "stixgovProfileIdleMs");
}
export function getStixgovProfileIdleMsV2() {
  return _stixgovIdleMs;
}
export function setStixgovParseStuckMsV2(n) {
  _stixgovStuckMs = _stixgovPos(n, "stixgovParseStuckMs");
}
export function getStixgovParseStuckMsV2() {
  return _stixgovStuckMs;
}
export function _resetStateStixParserGovV2() {
  _stixgovPsV2.clear();
  _stixgovJsV2.clear();
  _stixgovMaxActive = 6;
  _stixgovMaxPending = 15;
  _stixgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _stixgovStuckMs = 60 * 1000;
}
export function registerStixgovProfileV2({
  id,
  owner,
  stixVersion,
  metadata,
} = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_stixgovPsV2.has(id))
    throw new Error(`stixgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    stixVersion: stixVersion || "2.1",
    status: STIXGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _stixgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateStixgovProfileV2(id) {
  const p = _stixgovPsV2.get(id);
  if (!p) throw new Error(`stixgov profile ${id} not found`);
  const isInitial = p.status === STIXGOV_PROFILE_MATURITY_V2.PENDING;
  _stixgovCheckP(p.status, STIXGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _stixgovCountActive(p.owner) >= _stixgovMaxActive)
    throw new Error(`max active stixgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = STIXGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function staleStixgovProfileV2(id) {
  const p = _stixgovPsV2.get(id);
  if (!p) throw new Error(`stixgov profile ${id} not found`);
  _stixgovCheckP(p.status, STIXGOV_PROFILE_MATURITY_V2.STALE);
  p.status = STIXGOV_PROFILE_MATURITY_V2.STALE;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveStixgovProfileV2(id) {
  const p = _stixgovPsV2.get(id);
  if (!p) throw new Error(`stixgov profile ${id} not found`);
  _stixgovCheckP(p.status, STIXGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = STIXGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchStixgovProfileV2(id) {
  const p = _stixgovPsV2.get(id);
  if (!p) throw new Error(`stixgov profile ${id} not found`);
  if (_stixgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal stixgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getStixgovProfileV2(id) {
  const p = _stixgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listStixgovProfilesV2() {
  return [..._stixgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createStixgovParseV2({
  id,
  profileId,
  bundleId,
  metadata,
} = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_stixgovJsV2.has(id))
    throw new Error(`stixgov parse ${id} already exists`);
  if (!_stixgovPsV2.has(profileId))
    throw new Error(`stixgov profile ${profileId} not found`);
  if (_stixgovCountPending(profileId) >= _stixgovMaxPending)
    throw new Error(
      `max pending stixgov parses for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    bundleId: bundleId || "",
    status: STIXGOV_PARSE_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _stixgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function parsingStixgovParseV2(id) {
  const j = _stixgovJsV2.get(id);
  if (!j) throw new Error(`stixgov parse ${id} not found`);
  _stixgovCheckJ(j.status, STIXGOV_PARSE_LIFECYCLE_V2.PARSING);
  const now = Date.now();
  j.status = STIXGOV_PARSE_LIFECYCLE_V2.PARSING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeParseStixgovV2(id) {
  const j = _stixgovJsV2.get(id);
  if (!j) throw new Error(`stixgov parse ${id} not found`);
  _stixgovCheckJ(j.status, STIXGOV_PARSE_LIFECYCLE_V2.PARSED);
  const now = Date.now();
  j.status = STIXGOV_PARSE_LIFECYCLE_V2.PARSED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failStixgovParseV2(id, reason) {
  const j = _stixgovJsV2.get(id);
  if (!j) throw new Error(`stixgov parse ${id} not found`);
  _stixgovCheckJ(j.status, STIXGOV_PARSE_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = STIXGOV_PARSE_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelStixgovParseV2(id, reason) {
  const j = _stixgovJsV2.get(id);
  if (!j) throw new Error(`stixgov parse ${id} not found`);
  _stixgovCheckJ(j.status, STIXGOV_PARSE_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = STIXGOV_PARSE_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getStixgovParseV2(id) {
  const j = _stixgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listStixgovParsesV2() {
  return [..._stixgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoStaleIdleStixgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _stixgovPsV2.values())
    if (
      p.status === STIXGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _stixgovIdleMs
    ) {
      p.status = STIXGOV_PROFILE_MATURITY_V2.STALE;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckStixgovParsesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _stixgovJsV2.values())
    if (
      j.status === STIXGOV_PARSE_LIFECYCLE_V2.PARSING &&
      j.startedAt != null &&
      t - j.startedAt >= _stixgovStuckMs
    ) {
      j.status = STIXGOV_PARSE_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getStixParserGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(STIXGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _stixgovPsV2.values()) profilesByStatus[p.status]++;
  const parsesByStatus = {};
  for (const v of Object.values(STIXGOV_PARSE_LIFECYCLE_V2))
    parsesByStatus[v] = 0;
  for (const j of _stixgovJsV2.values()) parsesByStatus[j.status]++;
  return {
    totalStixgovProfilesV2: _stixgovPsV2.size,
    totalStixgovParsesV2: _stixgovJsV2.size,
    maxActiveStixgovProfilesPerOwner: _stixgovMaxActive,
    maxPendingStixgovParsesPerProfile: _stixgovMaxPending,
    stixgovProfileIdleMs: _stixgovIdleMs,
    stixgovParseStuckMs: _stixgovStuckMs,
    profilesByStatus,
    parsesByStatus,
  };
}
