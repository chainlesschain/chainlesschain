/**
 * EvoMap Client — GEP-A2A HTTP client for gene exchange.
 *
 * Communicates with EvoMap Hub servers to search, publish, and download
 * agent capability genes (skills, prompts, tool configs).
 *
 * Lightweight: uses native fetch, no heavy dependencies.
 */

// Exported for test injection
export const _deps = {
  fetch: globalThis.fetch,
};

const DEFAULT_HUB = "https://evomap.chainlesschain.com/api/v1";

export class EvoMapClient {
  /**
   * @param {object} options
   * @param {string} [options.hubUrl] - EvoMap Hub URL
   * @param {string} [options.apiKey] - Optional API key for authenticated endpoints
   * @param {number} [options.timeout] - Request timeout in ms
   */
  constructor({ hubUrl, apiKey, timeout } = {}) {
    this.hubUrl = hubUrl || process.env.EVOMAP_HUB_URL || DEFAULT_HUB;
    this.apiKey = apiKey || process.env.EVOMAP_API_KEY || "";
    this.timeout = timeout || 10000;
  }

  /**
   * Search for genes on the hub.
   * @param {string} query - Search query
   * @param {object} [options]
   * @param {string} [options.category] - Filter by category
   * @param {number} [options.limit] - Max results
   * @returns {Promise<Array<{ id, name, description, author, version, downloads, rating }>>}
   */
  async search(query, { category, limit = 20 } = {}) {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    if (category) params.set("category", category);

    const data = await this._request(`/genes/search?${params}`);
    return data.genes || data.results || [];
  }

  /**
   * Get gene details by ID.
   */
  async getGene(geneId) {
    return this._request(`/genes/${encodeURIComponent(geneId)}`);
  }

  /**
   * Download a gene package.
   * @returns {{ gene: object, content: string }}
   */
  async download(geneId) {
    const data = await this._request(
      `/genes/${encodeURIComponent(geneId)}/download`,
    );
    return data;
  }

  /**
   * Publish a gene to the hub.
   * @param {object} gene - Gene metadata + content
   */
  async publish(gene) {
    if (!this.apiKey) throw new Error("API key required for publishing");
    return this._request("/genes", {
      method: "POST",
      body: JSON.stringify(gene),
    });
  }

  /**
   * List hub information.
   */
  async getHubInfo() {
    return this._request("/info");
  }

  /**
   * List available hubs (returns current hub info).
   */
  async listHubs() {
    try {
      const info = await this.getHubInfo();
      return [{ url: this.hubUrl, ...info }];
    } catch (_err) {
      return [{ url: this.hubUrl, status: "unreachable" }];
    }
  }

  // ─── Internal ───

  async _request(path, options = {}) {
    const url = `${this.hubUrl}${path}`;
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await _deps.fetch(url, {
        method: options.method || "GET",
        headers,
        body: options.body || undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(
          `EvoMap API error: ${response.status} ${response.statusText}`,
        );
      }

      return await response.json();
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") {
        throw new Error(`EvoMap request timed out after ${this.timeout}ms`);
      }
      throw err;
    }
  }
}

// =====================================================================
// evomap-client V2 governance overlay (iter27)
// =====================================================================
export const EVCLIGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  STALE: "stale",
  ARCHIVED: "archived",
});
export const EVCLIGOV_RPC_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  CALLING: "calling",
  RETURNED: "returned",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _evcligovPTrans = new Map([
  [
    EVCLIGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      EVCLIGOV_PROFILE_MATURITY_V2.ACTIVE,
      EVCLIGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    EVCLIGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      EVCLIGOV_PROFILE_MATURITY_V2.STALE,
      EVCLIGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    EVCLIGOV_PROFILE_MATURITY_V2.STALE,
    new Set([
      EVCLIGOV_PROFILE_MATURITY_V2.ACTIVE,
      EVCLIGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [EVCLIGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _evcligovPTerminal = new Set([EVCLIGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _evcligovJTrans = new Map([
  [
    EVCLIGOV_RPC_LIFECYCLE_V2.QUEUED,
    new Set([
      EVCLIGOV_RPC_LIFECYCLE_V2.CALLING,
      EVCLIGOV_RPC_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    EVCLIGOV_RPC_LIFECYCLE_V2.CALLING,
    new Set([
      EVCLIGOV_RPC_LIFECYCLE_V2.RETURNED,
      EVCLIGOV_RPC_LIFECYCLE_V2.FAILED,
      EVCLIGOV_RPC_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [EVCLIGOV_RPC_LIFECYCLE_V2.RETURNED, new Set()],
  [EVCLIGOV_RPC_LIFECYCLE_V2.FAILED, new Set()],
  [EVCLIGOV_RPC_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _evcligovPsV2 = new Map();
const _evcligovJsV2 = new Map();
let _evcligovMaxActive = 6,
  _evcligovMaxPending = 15,
  _evcligovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _evcligovStuckMs = 60 * 1000;
function _evcligovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _evcligovCheckP(from, to) {
  const a = _evcligovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid evcligov profile transition ${from} → ${to}`);
}
function _evcligovCheckJ(from, to) {
  const a = _evcligovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid evcligov rpc transition ${from} → ${to}`);
}
function _evcligovCountActive(owner) {
  let c = 0;
  for (const p of _evcligovPsV2.values())
    if (p.owner === owner && p.status === EVCLIGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _evcligovCountPending(profileId) {
  let c = 0;
  for (const j of _evcligovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === EVCLIGOV_RPC_LIFECYCLE_V2.QUEUED ||
        j.status === EVCLIGOV_RPC_LIFECYCLE_V2.CALLING)
    )
      c++;
  return c;
}
export function setMaxActiveEvcligovProfilesPerOwnerV2(n) {
  _evcligovMaxActive = _evcligovPos(n, "maxActiveEvcligovProfilesPerOwner");
}
export function getMaxActiveEvcligovProfilesPerOwnerV2() {
  return _evcligovMaxActive;
}
export function setMaxPendingEvcligovRpcsPerProfileV2(n) {
  _evcligovMaxPending = _evcligovPos(n, "maxPendingEvcligovRpcsPerProfile");
}
export function getMaxPendingEvcligovRpcsPerProfileV2() {
  return _evcligovMaxPending;
}
export function setEvcligovProfileIdleMsV2(n) {
  _evcligovIdleMs = _evcligovPos(n, "evcligovProfileIdleMs");
}
export function getEvcligovProfileIdleMsV2() {
  return _evcligovIdleMs;
}
export function setEvcligovRpcStuckMsV2(n) {
  _evcligovStuckMs = _evcligovPos(n, "evcligovRpcStuckMs");
}
export function getEvcligovRpcStuckMsV2() {
  return _evcligovStuckMs;
}
export function _resetStateEvomapClientGovV2() {
  _evcligovPsV2.clear();
  _evcligovJsV2.clear();
  _evcligovMaxActive = 6;
  _evcligovMaxPending = 15;
  _evcligovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _evcligovStuckMs = 60 * 1000;
}
export function registerEvcligovProfileV2({
  id,
  owner,
  endpoint,
  metadata,
} = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_evcligovPsV2.has(id))
    throw new Error(`evcligov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    endpoint: endpoint || "primary",
    status: EVCLIGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _evcligovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateEvcligovProfileV2(id) {
  const p = _evcligovPsV2.get(id);
  if (!p) throw new Error(`evcligov profile ${id} not found`);
  const isInitial = p.status === EVCLIGOV_PROFILE_MATURITY_V2.PENDING;
  _evcligovCheckP(p.status, EVCLIGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _evcligovCountActive(p.owner) >= _evcligovMaxActive)
    throw new Error(
      `max active evcligov profiles for owner ${p.owner} reached`,
    );
  const now = Date.now();
  p.status = EVCLIGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function staleEvcligovProfileV2(id) {
  const p = _evcligovPsV2.get(id);
  if (!p) throw new Error(`evcligov profile ${id} not found`);
  _evcligovCheckP(p.status, EVCLIGOV_PROFILE_MATURITY_V2.STALE);
  p.status = EVCLIGOV_PROFILE_MATURITY_V2.STALE;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveEvcligovProfileV2(id) {
  const p = _evcligovPsV2.get(id);
  if (!p) throw new Error(`evcligov profile ${id} not found`);
  _evcligovCheckP(p.status, EVCLIGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = EVCLIGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchEvcligovProfileV2(id) {
  const p = _evcligovPsV2.get(id);
  if (!p) throw new Error(`evcligov profile ${id} not found`);
  if (_evcligovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal evcligov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getEvcligovProfileV2(id) {
  const p = _evcligovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listEvcligovProfilesV2() {
  return [..._evcligovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createEvcligovRpcV2({ id, profileId, method, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_evcligovJsV2.has(id))
    throw new Error(`evcligov rpc ${id} already exists`);
  if (!_evcligovPsV2.has(profileId))
    throw new Error(`evcligov profile ${profileId} not found`);
  if (_evcligovCountPending(profileId) >= _evcligovMaxPending)
    throw new Error(
      `max pending evcligov rpcs for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    method: method || "",
    status: EVCLIGOV_RPC_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _evcligovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function callingEvcligovRpcV2(id) {
  const j = _evcligovJsV2.get(id);
  if (!j) throw new Error(`evcligov rpc ${id} not found`);
  _evcligovCheckJ(j.status, EVCLIGOV_RPC_LIFECYCLE_V2.CALLING);
  const now = Date.now();
  j.status = EVCLIGOV_RPC_LIFECYCLE_V2.CALLING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeRpcEvcligovV2(id) {
  const j = _evcligovJsV2.get(id);
  if (!j) throw new Error(`evcligov rpc ${id} not found`);
  _evcligovCheckJ(j.status, EVCLIGOV_RPC_LIFECYCLE_V2.RETURNED);
  const now = Date.now();
  j.status = EVCLIGOV_RPC_LIFECYCLE_V2.RETURNED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failEvcligovRpcV2(id, reason) {
  const j = _evcligovJsV2.get(id);
  if (!j) throw new Error(`evcligov rpc ${id} not found`);
  _evcligovCheckJ(j.status, EVCLIGOV_RPC_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = EVCLIGOV_RPC_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelEvcligovRpcV2(id, reason) {
  const j = _evcligovJsV2.get(id);
  if (!j) throw new Error(`evcligov rpc ${id} not found`);
  _evcligovCheckJ(j.status, EVCLIGOV_RPC_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = EVCLIGOV_RPC_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getEvcligovRpcV2(id) {
  const j = _evcligovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listEvcligovRpcsV2() {
  return [..._evcligovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoStaleIdleEvcligovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _evcligovPsV2.values())
    if (
      p.status === EVCLIGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _evcligovIdleMs
    ) {
      p.status = EVCLIGOV_PROFILE_MATURITY_V2.STALE;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckEvcligovRpcsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _evcligovJsV2.values())
    if (
      j.status === EVCLIGOV_RPC_LIFECYCLE_V2.CALLING &&
      j.startedAt != null &&
      t - j.startedAt >= _evcligovStuckMs
    ) {
      j.status = EVCLIGOV_RPC_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getEvomapClientGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(EVCLIGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _evcligovPsV2.values()) profilesByStatus[p.status]++;
  const rpcsByStatus = {};
  for (const v of Object.values(EVCLIGOV_RPC_LIFECYCLE_V2)) rpcsByStatus[v] = 0;
  for (const j of _evcligovJsV2.values()) rpcsByStatus[j.status]++;
  return {
    totalEvcligovProfilesV2: _evcligovPsV2.size,
    totalEvcligovRpcsV2: _evcligovJsV2.size,
    maxActiveEvcligovProfilesPerOwner: _evcligovMaxActive,
    maxPendingEvcligovRpcsPerProfile: _evcligovMaxPending,
    evcligovProfileIdleMs: _evcligovIdleMs,
    evcligovRpcStuckMs: _evcligovStuckMs,
    profilesByStatus,
    rpcsByStatus,
  };
}
