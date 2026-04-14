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
