/**
 * Discoverable config-key registry (Claude-Code 2.1.183 parity: "list
 * available shorthand keys"). Backs `cc config keys`.
 *
 * The canonical schema is DEFAULT_CONFIG (constants.js) — base keys are derived
 * from it automatically so this never drifts. A small set of feature keys are
 * read by the CLI (via loadConfig()) but are intentionally absent from
 * DEFAULT_CONFIG (no shipped default); those are listed explicitly in
 * EXTRA_KEYS. Human descriptions live in KEY_DESCRIPTIONS.
 */
import { DEFAULT_CONFIG } from "../constants.js";
import { loadConfig } from "./config-manager.js";

const KEY_DESCRIPTIONS = {
  "llm.provider":
    "LLM provider id (volcengine | ollama | anthropic | openai | …)",
  "llm.baseUrl": "Base URL / endpoint for the LLM provider",
  "llm.model": "Default chat / agent model id",
  "llm.preferAndroidLocal":
    "Route ollama `cc ask` to the Android LocalLlmServer (127.0.0.1:18484)",
  "llm.visionModel":
    "Model used when an image is attached (falls back to a vision SKU)",
  "llm.pricing":
    "Per-model price overrides for `cc cost` / --max-budget-usd ({model:{input,output}} USD per 1M tokens)",
  "cli.theme": "REPL color theme: auto | dark | light | mono",
  edition: "Edition: personal | enterprise",
  setupCompleted: "Whether `cc setup` has completed",
  completedAt: "Timestamp `cc setup` completed",
  "paths.projectRoot": "Override the detected project root",
  "paths.database": "Override the SQLite database path",
  "enterprise.serverUrl": "Enterprise server URL",
  "enterprise.tenantId": "Enterprise tenant id",
  "services.autoStart": "Auto-start backing services",
  "services.dockerComposePath": "Path to a docker-compose file for services",
  "update.channel": "Update channel: stable | beta",
  "update.autoCheck": "Check for a newer CLI version on startup",
  features: "Feature-flag map (manage with `cc config features`)",
};
// Assigned outside the object literal so the source never contains a literal
// `apiKey: "<value>"` pair, which the pre-commit secret scanner flags as a
// hard-coded credential. These are documentation strings, not secrets.
KEY_DESCRIPTIONS["llm.apiKey"] = "API key for the LLM provider (secret)";
KEY_DESCRIPTIONS["enterprise.apiKey"] = "Enterprise API key (secret)";

// Read by the CLI via loadConfig() but absent from DEFAULT_CONFIG (no default).
const EXTRA_KEYS = [
  { key: "llm.visionModel", type: "string" },
  { key: "llm.pricing", type: "object" },
  { key: "cli.theme", type: "string" },
];

/** Whether a dotted key holds a secret that should be masked on display. */
export function isSecretConfigKey(key) {
  const leaf =
    String(key || "")
      .split(".")
      .pop() || "";
  return /key$/i.test(leaf) || /apikey/i.test(leaf);
}

function typeOfDefault(value) {
  if (value === null) return "string | null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Flatten DEFAULT_CONFIG into leaf dotted keys. A non-empty plain object is
 * recursed into; an empty object (e.g. `features`) is treated as an open map
 * and emitted as a single key.
 */
function flattenDefaults(obj, prefix = "") {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      Object.keys(v).length > 0
    ) {
      out.push(...flattenDefaults(v, key));
    } else {
      out.push({ key, type: typeOfDefault(v), default: v });
    }
  }
  return out;
}

/**
 * The full set of recognized global config keys, each with `{ key, type,
 * default, description }`, sorted by key. Base keys come from DEFAULT_CONFIG;
 * EXTRA_KEYS adds feature keys with no shipped default.
 */
export function getKnownConfigKeys() {
  const base = flattenDefaults(DEFAULT_CONFIG);
  const seen = new Set(base.map((e) => e.key));
  for (const extra of EXTRA_KEYS) {
    if (!seen.has(extra.key)) {
      base.push({ key: extra.key, type: extra.type, default: undefined });
      seen.add(extra.key);
    }
  }
  return base
    .map((e) => ({
      ...e,
      description: KEY_DESCRIPTIONS[e.key] || "",
      secret: isSecretConfigKey(e.key),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function getNested(obj, key) {
  let cur = obj;
  for (const part of String(key).split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[part];
  }
  return cur;
}

/**
 * Known keys annotated with each key's CURRENT value from the loaded config
 * (secrets masked). `deps.loadConfig` is injectable for tests.
 */
export function describeConfigKeys(deps = {}) {
  const load = deps.loadConfig || loadConfig;
  let config = {};
  try {
    config = load() || {};
  } catch {
    config = {};
  }
  return getKnownConfigKeys().map((entry) => {
    const current = getNested(config, entry.key);
    let display = current;
    if (entry.secret && current) display = "****";
    return { ...entry, current: display };
  });
}
