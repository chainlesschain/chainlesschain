/** DMM-07: data-only declarations. Compatibility never grants execution. */
import semver from "semver";

export const GOAL_EXTENSION_API_VERSION = "1.0.0";
export const GOAL_EXTENSION_HOSTS = Object.freeze([
  "cli",
  "vscode",
  "jetbrains",
  "desktop",
]);
export const GOAL_EXTENSION_EVENTS = Object.freeze([
  "goal.status.changed",
  "risk.review.completed",
  "action.receipt.updated",
]);
export const GOAL_EXTENSION_SLOTS = Object.freeze([
  "goal.summary",
  "goal.evidence",
  "goal.actions",
]);
export const GOAL_EXTENSION_PROPOSALS = Object.freeze([
  "task.create",
  "task.description.update",
]);
const PANEL_FIELDS = ["objective", "status", "riskSummary", "receiptSummary"];

function object(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  for (const key of Object.keys(value)) {
    if (!keys.includes(key))
      throw new Error(`${label}: unsupported field ${key}`);
  }
}

function text(value, label, max = 128) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new Error(`${label} must be non-empty text (max ${max})`);
  return value;
}

function list(value, allowed, label) {
  if (
    !Array.isArray(value) ||
    value.length > 16 ||
    value.some((entry) => !allowed.includes(entry)) ||
    new Set(value).size !== value.length
  )
    throw new Error(
      `${label} must be a unique list of supported values (max 16)`,
    );
  return [...value];
}

export function requiredGoalExtensionCapabilities(extension) {
  return [
    ...new Set([
      ...extension.events.map((event) => `event:${event}`),
      ...extension.panels.map((panel) => `panel:${panel.slot}`),
      ...extension.proposals.map((action) => `proposal:${action}`),
    ]),
  ].sort();
}

/** Unknown fields include code entrypoints, approval claims and receipt writers. */
export function normalizeGoalExtension(raw, permissions) {
  if (raw === undefined) return null;
  object(
    raw,
    ["apiVersion", "hosts", "events", "panels", "proposals"],
    "goalExtension",
  );
  const apiVersion = text(raw.apiVersion, "goalExtension.apiVersion");
  if (!semver.valid(apiVersion))
    throw new Error("goalExtension.apiVersion must be semver");
  object(raw.hosts, GOAL_EXTENSION_HOSTS, "goalExtension.hosts");
  if (!Object.keys(raw.hosts).length)
    throw new Error("goalExtension.hosts must declare a host");
  const hosts = {};
  for (const [host, range] of Object.entries(raw.hosts)) {
    text(range, `goalExtension.hosts.${host}`);
    if (!semver.validRange(range))
      throw new Error(`goalExtension.hosts.${host} must be a semver range`);
    hosts[host] = range;
  }
  const events = list(
    raw.events ?? [],
    GOAL_EXTENSION_EVENTS,
    "goalExtension.events",
  );
  const proposals = list(
    raw.proposals ?? [],
    GOAL_EXTENSION_PROPOSALS,
    "goalExtension.proposals",
  );
  if (!Array.isArray(raw.panels ?? []) || (raw.panels ?? []).length > 16)
    throw new Error("goalExtension.panels must be a list (max 16)");
  const ids = new Set();
  const panels = (raw.panels ?? []).map((panel) => {
    object(
      panel,
      ["id", "title", "slot", "fields", "fallback"],
      "goalExtension.panel",
    );
    const id = text(panel.id, "goalExtension.panel.id", 64);
    if (!/^[a-z][a-z0-9-]*$/.test(id) || ids.has(id))
      throw new Error("goalExtension.panel.id must be unique kebab-case");
    ids.add(id);
    if (!GOAL_EXTENSION_SLOTS.includes(panel.slot))
      throw new Error("goalExtension.panel.slot is unsupported");
    if (panel.fallback !== "text")
      throw new Error("goalExtension.panel.fallback must be text");
    return {
      id,
      title: text(panel.title, "goalExtension.panel.title"),
      slot: panel.slot,
      fields: list(panel.fields, PANEL_FIELDS, "goalExtension.panel.fields"),
      fallback: "text",
    };
  });
  const extension = { apiVersion, hosts, events, panels, proposals };
  const allowed = [
    ...GOAL_EXTENSION_EVENTS.map((event) => `event:${event}`),
    ...GOAL_EXTENSION_SLOTS.map((slot) => `panel:${slot}`),
    ...GOAL_EXTENSION_PROPOSALS.map((action) => `proposal:${action}`),
  ];
  // Validate RAW permissions: permissive legacy coercion cannot admit this API.
  object(permissions, Object.keys(permissions || {}), "permissions");
  const grants = list(
    permissions.goalExtension,
    allowed,
    "permissions.goalExtension",
  );
  for (const required of requiredGoalExtensionCapabilities(extension)) {
    if (!grants.includes(required))
      throw new Error(
        `goalExtension requires permissions.goalExtension: ${required}`,
      );
  }
  return extension;
}

/** Pure version/capability check; callers must still check current authorization. */
export function checkGoalExtensionCompatibility(extension, host = {}) {
  if (!extension) return { compatible: false, reason: "legacy_unsupported" };
  if (!semver.eq(extension.apiVersion, GOAL_EXTENSION_API_VERSION))
    return { compatible: false, reason: "unsupported_api" };
  if (!Object.hasOwn(extension.hosts, host.id))
    return { compatible: false, reason: "unsupported_host" };
  if (
    !semver.valid(host.version) ||
    !semver.satisfies(host.version, extension.hosts[host.id])
  )
    return { compatible: false, reason: "host_version_mismatch" };
  const supported = Array.isArray(host.capabilities) ? host.capabilities : [];
  const missing = requiredGoalExtensionCapabilities(extension).filter(
    (cap) => !supported.includes(cap),
  );
  return missing.length
    ? { compatible: false, reason: "unsupported_capabilities", missing }
    : { compatible: true, reason: "compatible" };
}

/** Safe management summary; never an admission token or a claim of a live host. */
export function summarizeGoalExtension(manifest) {
  const extension = manifest?.goalExtension;
  if (!extension)
    return {
      status: manifest?.goalExtensionDeclared ? "invalid" : "legacy",
      runtimeAvailable: false,
    };
  return {
    status: "declaration-only",
    runtimeAvailable: false,
    apiVersion: extension.apiVersion,
    apiCompatible: semver.eq(extension.apiVersion, GOAL_EXTENSION_API_VERSION),
    hosts: { ...extension.hosts },
    events: [...extension.events],
    panels: extension.panels.map((panel) => ({
      ...panel,
      fields: [...panel.fields],
    })),
    proposals: [...extension.proposals],
  };
}
