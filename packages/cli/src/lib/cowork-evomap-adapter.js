/**
 * Cowork ↔ EvoMap adapter — publish Cowork templates as EvoMap "genes" and
 * pull them back for local install. Thin wrapper over `evomap-client.js`
 * that fixes `kind = "cowork-template"` and carries N4 signatures through.
 *
 * Pure glue: all I/O is delegated to EvoMapClient (network) and the
 * marketplace/share modules (disk). Injectable via `_deps.createClient`.
 *
 * @module cowork-evomap-adapter
 */

import { EvoMapClient } from "./evomap-client.js";
import {
  toShareableTemplate,
  saveUserTemplate,
} from "./cowork-template-marketplace.js";
import { buildPacket } from "./cowork-share.js";

export const _deps = {
  createClient: (opts) => new EvoMapClient(opts),
};

const KIND = "cowork-template";

function _wrapGene(template, signer) {
  const payload = toShareableTemplate(template);
  // Reuse share-packet builder so signed genes land on the hub with the same
  // canonical shape as file-based packets (checksum + optional signature).
  const packet = buildPacket({
    kind: "template",
    payload,
    author: signer?.did || "anonymous",
    cliVersion: undefined,
    signer: signer || undefined,
  });
  return {
    id: payload.id,
    name: payload.name || payload.id,
    description: payload.description || "",
    kind: KIND,
    version: payload.version || "1.0.0",
    packet,
  };
}

/**
 * Publish a template to a hub. Requires API key on the client.
 * @returns {Promise<object>} hub response (typically { id, ... })
 */
export async function publishTemplateToHub(
  template,
  { hubUrl, apiKey, signer } = {},
) {
  if (!template || !template.id) {
    throw new Error("template.id required");
  }
  const client = _deps.createClient({ hubUrl, apiKey });
  const gene = _wrapGene(template, signer);
  return client.publish(gene);
}

/**
 * Search templates on a hub. Degrades to [] on network error unless
 * `strict: true` is passed.
 * @returns {Promise<Array>} annotated with `_hubMeta`
 */
export async function searchTemplatesInHub(
  query,
  { hubUrl, limit = 20, strict = false } = {},
) {
  const client = _deps.createClient({ hubUrl });
  try {
    const results = await client.search(query || "", {
      category: KIND,
      limit,
    });
    return (results || []).map((r) => ({
      ...r,
      _hubMeta: {
        hubUrl: client.hubUrl,
        downloads: r.downloads || 0,
        rating: r.rating || null,
      },
    }));
  } catch (err) {
    if (strict) throw err;
    return [];
  }
}

/**
 * Fetch a gene by id and install its template into the local marketplace.
 * Returns the saved template object.
 */
export async function installTemplateFromHub(
  cwd,
  geneId,
  { hubUrl, requireSigned = false, trustedDids = null } = {},
) {
  const client = _deps.createClient({ hubUrl });
  const data = await client.download(geneId);
  // Hub may return { gene: { packet } } or { packet } directly
  const gene = data?.gene || data;
  const packet = gene?.packet || data?.packet;
  if (!packet || packet.kind !== "template" || !packet.payload) {
    throw new Error("Hub response missing template packet");
  }
  if (requireSigned && !packet.signature) {
    throw new Error("Gene is not signed and --require-signed was set");
  }
  if (
    Array.isArray(trustedDids) &&
    trustedDids.length > 0 &&
    (!packet.signature || !trustedDids.includes(packet.signature.did))
  ) {
    throw new Error(
      `Gene signer not in trusted list${packet.signature ? ` (${packet.signature.did})` : ""}`,
    );
  }
  return saveUserTemplate(cwd, packet.payload);
}

// =====================================================================
// cowork-evomap-adapter V2 governance overlay (iter27)
// =====================================================================
export const CEADGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  STALE: "stale",
  ARCHIVED: "archived",
});
export const CEADGOV_BIND_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  BINDING: "binding",
  BOUND: "bound",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _ceadgovPTrans = new Map([
  [
    CEADGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      CEADGOV_PROFILE_MATURITY_V2.ACTIVE,
      CEADGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    CEADGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      CEADGOV_PROFILE_MATURITY_V2.STALE,
      CEADGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    CEADGOV_PROFILE_MATURITY_V2.STALE,
    new Set([
      CEADGOV_PROFILE_MATURITY_V2.ACTIVE,
      CEADGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [CEADGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _ceadgovPTerminal = new Set([CEADGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _ceadgovJTrans = new Map([
  [
    CEADGOV_BIND_LIFECYCLE_V2.QUEUED,
    new Set([
      CEADGOV_BIND_LIFECYCLE_V2.BINDING,
      CEADGOV_BIND_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    CEADGOV_BIND_LIFECYCLE_V2.BINDING,
    new Set([
      CEADGOV_BIND_LIFECYCLE_V2.BOUND,
      CEADGOV_BIND_LIFECYCLE_V2.FAILED,
      CEADGOV_BIND_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [CEADGOV_BIND_LIFECYCLE_V2.BOUND, new Set()],
  [CEADGOV_BIND_LIFECYCLE_V2.FAILED, new Set()],
  [CEADGOV_BIND_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _ceadgovPsV2 = new Map();
const _ceadgovJsV2 = new Map();
let _ceadgovMaxActive = 6,
  _ceadgovMaxPending = 15,
  _ceadgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _ceadgovStuckMs = 60 * 1000;
function _ceadgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _ceadgovCheckP(from, to) {
  const a = _ceadgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid ceadgov profile transition ${from} → ${to}`);
}
function _ceadgovCheckJ(from, to) {
  const a = _ceadgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid ceadgov bind transition ${from} → ${to}`);
}
function _ceadgovCountActive(owner) {
  let c = 0;
  for (const p of _ceadgovPsV2.values())
    if (p.owner === owner && p.status === CEADGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _ceadgovCountPending(profileId) {
  let c = 0;
  for (const j of _ceadgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === CEADGOV_BIND_LIFECYCLE_V2.QUEUED ||
        j.status === CEADGOV_BIND_LIFECYCLE_V2.BINDING)
    )
      c++;
  return c;
}
export function setMaxActiveCeadgovProfilesPerOwnerV2(n) {
  _ceadgovMaxActive = _ceadgovPos(n, "maxActiveCeadgovProfilesPerOwner");
}
export function getMaxActiveCeadgovProfilesPerOwnerV2() {
  return _ceadgovMaxActive;
}
export function setMaxPendingCeadgovBindsPerProfileV2(n) {
  _ceadgovMaxPending = _ceadgovPos(n, "maxPendingCeadgovBindsPerProfile");
}
export function getMaxPendingCeadgovBindsPerProfileV2() {
  return _ceadgovMaxPending;
}
export function setCeadgovProfileIdleMsV2(n) {
  _ceadgovIdleMs = _ceadgovPos(n, "ceadgovProfileIdleMs");
}
export function getCeadgovProfileIdleMsV2() {
  return _ceadgovIdleMs;
}
export function setCeadgovBindStuckMsV2(n) {
  _ceadgovStuckMs = _ceadgovPos(n, "ceadgovBindStuckMs");
}
export function getCeadgovBindStuckMsV2() {
  return _ceadgovStuckMs;
}
export function _resetStateCoworkEvomapAdapterGovV2() {
  _ceadgovPsV2.clear();
  _ceadgovJsV2.clear();
  _ceadgovMaxActive = 6;
  _ceadgovMaxPending = 15;
  _ceadgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _ceadgovStuckMs = 60 * 1000;
}
export function registerCeadgovProfileV2({
  id,
  owner,
  direction,
  metadata,
} = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_ceadgovPsV2.has(id))
    throw new Error(`ceadgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    direction: direction || "bidirectional",
    status: CEADGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _ceadgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateCeadgovProfileV2(id) {
  const p = _ceadgovPsV2.get(id);
  if (!p) throw new Error(`ceadgov profile ${id} not found`);
  const isInitial = p.status === CEADGOV_PROFILE_MATURITY_V2.PENDING;
  _ceadgovCheckP(p.status, CEADGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _ceadgovCountActive(p.owner) >= _ceadgovMaxActive)
    throw new Error(`max active ceadgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = CEADGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function staleCeadgovProfileV2(id) {
  const p = _ceadgovPsV2.get(id);
  if (!p) throw new Error(`ceadgov profile ${id} not found`);
  _ceadgovCheckP(p.status, CEADGOV_PROFILE_MATURITY_V2.STALE);
  p.status = CEADGOV_PROFILE_MATURITY_V2.STALE;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveCeadgovProfileV2(id) {
  const p = _ceadgovPsV2.get(id);
  if (!p) throw new Error(`ceadgov profile ${id} not found`);
  _ceadgovCheckP(p.status, CEADGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = CEADGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchCeadgovProfileV2(id) {
  const p = _ceadgovPsV2.get(id);
  if (!p) throw new Error(`ceadgov profile ${id} not found`);
  if (_ceadgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal ceadgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getCeadgovProfileV2(id) {
  const p = _ceadgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listCeadgovProfilesV2() {
  return [..._ceadgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createCeadgovBindV2({ id, profileId, geneId, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_ceadgovJsV2.has(id))
    throw new Error(`ceadgov bind ${id} already exists`);
  if (!_ceadgovPsV2.has(profileId))
    throw new Error(`ceadgov profile ${profileId} not found`);
  if (_ceadgovCountPending(profileId) >= _ceadgovMaxPending)
    throw new Error(
      `max pending ceadgov binds for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    geneId: geneId || "",
    status: CEADGOV_BIND_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _ceadgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function bindingCeadgovBindV2(id) {
  const j = _ceadgovJsV2.get(id);
  if (!j) throw new Error(`ceadgov bind ${id} not found`);
  _ceadgovCheckJ(j.status, CEADGOV_BIND_LIFECYCLE_V2.BINDING);
  const now = Date.now();
  j.status = CEADGOV_BIND_LIFECYCLE_V2.BINDING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeBindCeadgovV2(id) {
  const j = _ceadgovJsV2.get(id);
  if (!j) throw new Error(`ceadgov bind ${id} not found`);
  _ceadgovCheckJ(j.status, CEADGOV_BIND_LIFECYCLE_V2.BOUND);
  const now = Date.now();
  j.status = CEADGOV_BIND_LIFECYCLE_V2.BOUND;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failCeadgovBindV2(id, reason) {
  const j = _ceadgovJsV2.get(id);
  if (!j) throw new Error(`ceadgov bind ${id} not found`);
  _ceadgovCheckJ(j.status, CEADGOV_BIND_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = CEADGOV_BIND_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelCeadgovBindV2(id, reason) {
  const j = _ceadgovJsV2.get(id);
  if (!j) throw new Error(`ceadgov bind ${id} not found`);
  _ceadgovCheckJ(j.status, CEADGOV_BIND_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = CEADGOV_BIND_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getCeadgovBindV2(id) {
  const j = _ceadgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listCeadgovBindsV2() {
  return [..._ceadgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoStaleIdleCeadgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _ceadgovPsV2.values())
    if (
      p.status === CEADGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _ceadgovIdleMs
    ) {
      p.status = CEADGOV_PROFILE_MATURITY_V2.STALE;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckCeadgovBindsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _ceadgovJsV2.values())
    if (
      j.status === CEADGOV_BIND_LIFECYCLE_V2.BINDING &&
      j.startedAt != null &&
      t - j.startedAt >= _ceadgovStuckMs
    ) {
      j.status = CEADGOV_BIND_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getCoworkEvomapAdapterGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(CEADGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _ceadgovPsV2.values()) profilesByStatus[p.status]++;
  const bindsByStatus = {};
  for (const v of Object.values(CEADGOV_BIND_LIFECYCLE_V2))
    bindsByStatus[v] = 0;
  for (const j of _ceadgovJsV2.values()) bindsByStatus[j.status]++;
  return {
    totalCeadgovProfilesV2: _ceadgovPsV2.size,
    totalCeadgovBindsV2: _ceadgovJsV2.size,
    maxActiveCeadgovProfilesPerOwner: _ceadgovMaxActive,
    maxPendingCeadgovBindsPerProfile: _ceadgovMaxPending,
    ceadgovProfileIdleMs: _ceadgovIdleMs,
    ceadgovBindStuckMs: _ceadgovStuckMs,
    profilesByStatus,
    bindsByStatus,
  };
}
