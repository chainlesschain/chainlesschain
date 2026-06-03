/**
 * Cowork Template Marketplace — share and install Cowork templates via EvoMap.
 *
 * A "Cowork template" is a serializable subset of the full template object
 * (id, name, category, acceptsFiles, mode, systemPromptExtension,
 * parallelStrategy, debatePerspectives, shellPolicyOverrides, mcpServers +
 * UI fields: icon, description, examples).
 *
 * Published templates are wrapped as EvoMap "genes" with `category: "cowork-template"`
 * so they sit alongside other gene types but can be filtered explicitly.
 *
 * Installed templates are persisted to `.chainlesschain/cowork/user-templates/<id>.json`
 * and merged into the built-in template registry by `cowork-task-templates.js`.
 *
 * @module cowork-template-marketplace
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";

export const _deps = {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
  // Injected at runtime by CLI to avoid eager evomap-client load
  evomapClient: null,
};

const EVOMAP_CATEGORY = "cowork-template";

// ─── Paths ───────────────────────────────────────────────────────────────────

function _userTemplatesDir(cwd) {
  return join(cwd, ".chainlesschain", "cowork", "user-templates");
}

function _userTemplateFile(cwd, id) {
  return join(_userTemplatesDir(cwd), `${id}.json`);
}

// ─── Serialization ───────────────────────────────────────────────────────────

const SHARED_FIELDS = [
  "id",
  "name",
  "category",
  "acceptsFiles",
  "fileTypes",
  "mode",
  "parallelStrategy",
  "debatePerspectives",
  "systemPromptExtension",
  "shellPolicyOverrides",
  "mcpServers",
];

const UI_FIELDS = ["icon", "description", "examples"];

/**
 * Pick the shareable subset of a template (strips internal fields).
 * @param {object} template - Template object from TASK_TEMPLATES or UI metadata
 * @param {object} [uiMeta] - Optional { icon, description, examples }
 */
export function toShareableTemplate(template, uiMeta = {}) {
  const out = {};
  for (const f of SHARED_FIELDS) {
    if (template[f] !== undefined) out[f] = template[f];
  }
  for (const f of UI_FIELDS) {
    if (uiMeta[f] !== undefined) out[f] = uiMeta[f];
  }
  return out;
}

/**
 * Build an EvoMap gene payload for a template.
 * @param {object} template - Shareable template (see toShareableTemplate)
 * @param {object} meta - { author, version, description, tags }
 */
export function buildTemplateGene(template, meta = {}) {
  if (!template?.id) throw new Error("template.id is required");
  if (!template?.name) throw new Error("template.name is required");
  return {
    id: `cowork-template-${template.id}`,
    name: template.name,
    description: meta.description || template.description || template.name,
    category: EVOMAP_CATEGORY,
    author: meta.author || "anonymous",
    version: meta.version || "1.0.0",
    tags: Array.isArray(meta.tags) ? meta.tags : [EVOMAP_CATEGORY],
    content: JSON.stringify(template),
  };
}

/**
 * Extract a template from a downloaded gene payload.
 * Accepts either { gene, content } or a flat gene object.
 */
export function templateFromGene(payload) {
  if (!payload) throw new Error("empty gene payload");
  const gene = payload.gene || payload;
  const content = payload.content ?? gene.content;
  if (!content || typeof content !== "string") {
    throw new Error("gene is missing `content` string");
  }
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(`gene content is not valid JSON: ${err.message}`);
  }
  if (!parsed?.id || !parsed?.name) {
    throw new Error("gene content is not a valid cowork template");
  }
  return parsed;
}

// ─── Local persistence ──────────────────────────────────────────────────────

/** List all installed user templates (as full objects). */
export function listUserTemplates(cwd) {
  const dir = _userTemplatesDir(cwd);
  if (!_deps.existsSync(dir)) return [];
  const out = [];
  for (const entry of _deps.readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    try {
      const raw = _deps.readFileSync(join(dir, entry), "utf-8");
      const tpl = JSON.parse(raw);
      if (tpl?.id && tpl?.name) out.push({ ...tpl, source: "user" });
    } catch (_e) {
      // Skip malformed files — don't let one bad template break the list
    }
  }
  return out;
}

/** Save a template to the local user-templates directory. */
export function saveUserTemplate(cwd, template) {
  if (!template?.id) throw new Error("template.id is required");
  const dir = _userTemplatesDir(cwd);
  _deps.mkdirSync(dir, { recursive: true });
  _deps.writeFileSync(
    _userTemplateFile(cwd, template.id),
    JSON.stringify(template, null, 2),
    "utf-8",
  );
  return template;
}

/** Remove an installed user template. Returns true if removed. */
export function removeUserTemplate(cwd, id) {
  const file = _userTemplateFile(cwd, id);
  if (!_deps.existsSync(file)) return false;
  _deps.unlinkSync(file);
  return true;
}

// ─── Marketplace operations ──────────────────────────────────────────────────

/**
 * Search for templates on an EvoMap hub. Filters to category=cowork-template.
 */
export async function searchTemplates(query, { limit = 20 } = {}) {
  const client = _deps.evomapClient;
  if (!client) throw new Error("EvoMap client not configured");
  const results = await client.search(query || "", {
    category: EVOMAP_CATEGORY,
    limit,
  });
  return Array.isArray(results) ? results : [];
}

/**
 * Install a template by gene id. Downloads, validates, and saves to local dir.
 * @returns {object} The installed template definition.
 */
export async function installTemplate(cwd, geneId) {
  const client = _deps.evomapClient;
  if (!client) throw new Error("EvoMap client not configured");
  const payload = await client.download(geneId);
  const template = templateFromGene(payload);
  saveUserTemplate(cwd, template);
  return template;
}

/**
 * Publish a template. Caller provides the shareable template + metadata.
 */
export async function publishTemplate(template, meta = {}) {
  const client = _deps.evomapClient;
  if (!client) throw new Error("EvoMap client not configured");
  const gene = buildTemplateGene(template, meta);
  return client.publish(gene);
}

// =====================================================================
// cowork-template-marketplace V2 governance overlay (iter25)
// =====================================================================
export const CTMGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  SUSPENDED: "suspended",
  ARCHIVED: "archived",
});
export const CTMGOV_ORDER_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  FULFILLING: "fulfilling",
  FULFILLED: "fulfilled",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _ctmgovPTrans = new Map([
  [
    CTMGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      CTMGOV_PROFILE_MATURITY_V2.ACTIVE,
      CTMGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    CTMGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      CTMGOV_PROFILE_MATURITY_V2.SUSPENDED,
      CTMGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    CTMGOV_PROFILE_MATURITY_V2.SUSPENDED,
    new Set([
      CTMGOV_PROFILE_MATURITY_V2.ACTIVE,
      CTMGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [CTMGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _ctmgovPTerminal = new Set([CTMGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _ctmgovJTrans = new Map([
  [
    CTMGOV_ORDER_LIFECYCLE_V2.QUEUED,
    new Set([
      CTMGOV_ORDER_LIFECYCLE_V2.FULFILLING,
      CTMGOV_ORDER_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    CTMGOV_ORDER_LIFECYCLE_V2.FULFILLING,
    new Set([
      CTMGOV_ORDER_LIFECYCLE_V2.FULFILLED,
      CTMGOV_ORDER_LIFECYCLE_V2.FAILED,
      CTMGOV_ORDER_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [CTMGOV_ORDER_LIFECYCLE_V2.FULFILLED, new Set()],
  [CTMGOV_ORDER_LIFECYCLE_V2.FAILED, new Set()],
  [CTMGOV_ORDER_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _ctmgovPsV2 = new Map();
const _ctmgovJsV2 = new Map();
let _ctmgovMaxActive = 6,
  _ctmgovMaxPending = 15,
  _ctmgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _ctmgovStuckMs = 60 * 1000;
function _ctmgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _ctmgovCheckP(from, to) {
  const a = _ctmgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid ctmgov profile transition ${from} → ${to}`);
}
function _ctmgovCheckJ(from, to) {
  const a = _ctmgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid ctmgov order transition ${from} → ${to}`);
}
function _ctmgovCountActive(owner) {
  let c = 0;
  for (const p of _ctmgovPsV2.values())
    if (p.owner === owner && p.status === CTMGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _ctmgovCountPending(profileId) {
  let c = 0;
  for (const j of _ctmgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === CTMGOV_ORDER_LIFECYCLE_V2.QUEUED ||
        j.status === CTMGOV_ORDER_LIFECYCLE_V2.FULFILLING)
    )
      c++;
  return c;
}
export function setMaxActiveCtmgovProfilesPerOwnerV2(n) {
  _ctmgovMaxActive = _ctmgovPos(n, "maxActiveCtmgovProfilesPerOwner");
}
export function getMaxActiveCtmgovProfilesPerOwnerV2() {
  return _ctmgovMaxActive;
}
export function setMaxPendingCtmgovOrdersPerProfileV2(n) {
  _ctmgovMaxPending = _ctmgovPos(n, "maxPendingCtmgovOrdersPerProfile");
}
export function getMaxPendingCtmgovOrdersPerProfileV2() {
  return _ctmgovMaxPending;
}
export function setCtmgovProfileIdleMsV2(n) {
  _ctmgovIdleMs = _ctmgovPos(n, "ctmgovProfileIdleMs");
}
export function getCtmgovProfileIdleMsV2() {
  return _ctmgovIdleMs;
}
export function setCtmgovOrderStuckMsV2(n) {
  _ctmgovStuckMs = _ctmgovPos(n, "ctmgovOrderStuckMs");
}
export function getCtmgovOrderStuckMsV2() {
  return _ctmgovStuckMs;
}
export function _resetStateCoworkTemplateMarketplaceGovV2() {
  _ctmgovPsV2.clear();
  _ctmgovJsV2.clear();
  _ctmgovMaxActive = 6;
  _ctmgovMaxPending = 15;
  _ctmgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _ctmgovStuckMs = 60 * 1000;
}
export function registerCtmgovProfileV2({ id, owner, vendor, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_ctmgovPsV2.has(id))
    throw new Error(`ctmgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    vendor: vendor || "default",
    status: CTMGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _ctmgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateCtmgovProfileV2(id) {
  const p = _ctmgovPsV2.get(id);
  if (!p) throw new Error(`ctmgov profile ${id} not found`);
  const isInitial = p.status === CTMGOV_PROFILE_MATURITY_V2.PENDING;
  _ctmgovCheckP(p.status, CTMGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _ctmgovCountActive(p.owner) >= _ctmgovMaxActive)
    throw new Error(`max active ctmgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = CTMGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function suspendCtmgovProfileV2(id) {
  const p = _ctmgovPsV2.get(id);
  if (!p) throw new Error(`ctmgov profile ${id} not found`);
  _ctmgovCheckP(p.status, CTMGOV_PROFILE_MATURITY_V2.SUSPENDED);
  p.status = CTMGOV_PROFILE_MATURITY_V2.SUSPENDED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveCtmgovProfileV2(id) {
  const p = _ctmgovPsV2.get(id);
  if (!p) throw new Error(`ctmgov profile ${id} not found`);
  _ctmgovCheckP(p.status, CTMGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = CTMGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchCtmgovProfileV2(id) {
  const p = _ctmgovPsV2.get(id);
  if (!p) throw new Error(`ctmgov profile ${id} not found`);
  if (_ctmgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal ctmgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getCtmgovProfileV2(id) {
  const p = _ctmgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listCtmgovProfilesV2() {
  return [..._ctmgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createCtmgovOrderV2({
  id,
  profileId,
  templateId,
  metadata,
} = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_ctmgovJsV2.has(id)) throw new Error(`ctmgov order ${id} already exists`);
  if (!_ctmgovPsV2.has(profileId))
    throw new Error(`ctmgov profile ${profileId} not found`);
  if (_ctmgovCountPending(profileId) >= _ctmgovMaxPending)
    throw new Error(
      `max pending ctmgov orders for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    templateId: templateId || "",
    status: CTMGOV_ORDER_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _ctmgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function fulfillingCtmgovOrderV2(id) {
  const j = _ctmgovJsV2.get(id);
  if (!j) throw new Error(`ctmgov order ${id} not found`);
  _ctmgovCheckJ(j.status, CTMGOV_ORDER_LIFECYCLE_V2.FULFILLING);
  const now = Date.now();
  j.status = CTMGOV_ORDER_LIFECYCLE_V2.FULFILLING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeOrderCtmgovV2(id) {
  const j = _ctmgovJsV2.get(id);
  if (!j) throw new Error(`ctmgov order ${id} not found`);
  _ctmgovCheckJ(j.status, CTMGOV_ORDER_LIFECYCLE_V2.FULFILLED);
  const now = Date.now();
  j.status = CTMGOV_ORDER_LIFECYCLE_V2.FULFILLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failCtmgovOrderV2(id, reason) {
  const j = _ctmgovJsV2.get(id);
  if (!j) throw new Error(`ctmgov order ${id} not found`);
  _ctmgovCheckJ(j.status, CTMGOV_ORDER_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = CTMGOV_ORDER_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelCtmgovOrderV2(id, reason) {
  const j = _ctmgovJsV2.get(id);
  if (!j) throw new Error(`ctmgov order ${id} not found`);
  _ctmgovCheckJ(j.status, CTMGOV_ORDER_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = CTMGOV_ORDER_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getCtmgovOrderV2(id) {
  const j = _ctmgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listCtmgovOrdersV2() {
  return [..._ctmgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoSuspendIdleCtmgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _ctmgovPsV2.values())
    if (
      p.status === CTMGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _ctmgovIdleMs
    ) {
      p.status = CTMGOV_PROFILE_MATURITY_V2.SUSPENDED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckCtmgovOrdersV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _ctmgovJsV2.values())
    if (
      j.status === CTMGOV_ORDER_LIFECYCLE_V2.FULFILLING &&
      j.startedAt != null &&
      t - j.startedAt >= _ctmgovStuckMs
    ) {
      j.status = CTMGOV_ORDER_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getCoworkTemplateMarketplaceGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(CTMGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _ctmgovPsV2.values()) profilesByStatus[p.status]++;
  const ordersByStatus = {};
  for (const v of Object.values(CTMGOV_ORDER_LIFECYCLE_V2))
    ordersByStatus[v] = 0;
  for (const j of _ctmgovJsV2.values()) ordersByStatus[j.status]++;
  return {
    totalCtmgovProfilesV2: _ctmgovPsV2.size,
    totalCtmgovOrdersV2: _ctmgovJsV2.size,
    maxActiveCtmgovProfilesPerOwner: _ctmgovMaxActive,
    maxPendingCtmgovOrdersPerProfile: _ctmgovMaxPending,
    ctmgovProfileIdleMs: _ctmgovIdleMs,
    ctmgovOrderStuckMs: _ctmgovStuckMs,
    profilesByStatus,
    ordersByStatus,
  };
}
