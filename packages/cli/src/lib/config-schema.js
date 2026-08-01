/**
 * Versioned, machine-readable schema for ~/.chainlesschain/config.json.
 *
 * The descriptor table is the source of truth used by config set/validate,
 * secret redaction, `config keys`, and the exported JSON Schema.  Open maps are
 * explicit: arbitrary top-level keys are rejected. Open maps such as
 * `features.*` are declared as such; plugin keys remain closed until their
 * owner calls registerPluginConfigSchema().
 */
import { DEFAULT_CONFIG, LLM_PROVIDERS } from "../constants.js";

export const CONFIG_SCHEMA_VERSION = "1.0.0";
export const CONFIG_SCHEMA_ID =
  "https://chainlesschain.com/schemas/cli-config/v1.json";

const descriptor = (key, type, options = {}) => ({
  key,
  type,
  scope: "user",
  managedLock: true,
  ...options,
});

const DESCRIPTORS = [
  descriptor("setupCompleted", "boolean", {
    default: DEFAULT_CONFIG.setupCompleted,
    description: "Whether initial CLI setup has completed",
  }),
  descriptor("completedAt", ["string", "null"], {
    default: DEFAULT_CONFIG.completedAt,
    description: "ISO timestamp at which setup completed",
  }),
  descriptor("edition", "string", {
    enum: ["personal", "enterprise"],
    default: DEFAULT_CONFIG.edition,
    description: "ChainlessChain edition",
  }),
  descriptor("features", "object", {
    default: DEFAULT_CONFIG.features,
    open: true,
    description: "Feature flag map",
  }),
  descriptor("paths.projectRoot", ["string", "null"], {
    default: DEFAULT_CONFIG.paths.projectRoot,
    description: "Override the detected project root",
  }),
  descriptor("paths.database", ["string", "null"], {
    default: DEFAULT_CONFIG.paths.database,
    description: "Override the SQLite database path",
  }),
  descriptor("llm.provider", "string", {
    enum: [...Object.keys(LLM_PROVIDERS), "local", "llamacpp", "mediapipe"],
    default: DEFAULT_CONFIG.llm.provider,
    description: "LLM provider id",
  }),
  descriptor("llm.apiKey", ["string", "null"], {
    default: DEFAULT_CONFIG.llm.apiKey,
    secret: true,
    description: "LLM provider API key",
  }),
  descriptor("llm.apiKeyHelper", ["string", "null"], {
    description: "Command that prints an API key to stdout",
  }),
  descriptor("llm.baseUrl", "string", {
    default: DEFAULT_CONFIG.llm.baseUrl,
    description: "LLM provider API endpoint",
  }),
  descriptor("llm.model", "string", {
    default: DEFAULT_CONFIG.llm.model,
    description: "Default model id",
  }),
  descriptor("llm.visionModel", ["string", "null"], {
    description: "Model used for image turns",
  }),
  descriptor("llm.fallbackModel", ["string", "null"], {
    deprecated: true,
    migration: "llm.fallbackModels",
    description: "Legacy single fallback model",
  }),
  descriptor("llm.fallbackModels", ["array", "string"], {
    description: "Ordered fallback model ids",
  }),
  descriptor("llm.preferAndroidLocal", "boolean", {
    default: DEFAULT_CONFIG.llm.preferAndroidLocal,
    description: "Prefer the Android local Ollama-compatible endpoint",
  }),
  descriptor("llm.pricing", "object", {
    open: true,
    description: "Per-model pricing overrides",
  }),
  descriptor("llm.streamStallTimeoutMs", "number", {
    minimum: 0,
    description: "Abort an inactive model stream after this many milliseconds",
  }),
  descriptor("llm.temperature", "number", {
    minimum: 0,
    maximum: 2,
    description: "Default sampling temperature",
  }),
  descriptor("llm.maxTokens", "number", {
    minimum: 1,
    description: "Default maximum output tokens",
  }),
  descriptor("enterprise.serverUrl", ["string", "null"], {
    default: DEFAULT_CONFIG.enterprise.serverUrl,
    description: "Enterprise server URL",
  }),
  descriptor("enterprise.apiKey", ["string", "null"], {
    default: DEFAULT_CONFIG.enterprise.apiKey,
    secret: true,
    description: "Enterprise API key",
  }),
  descriptor("enterprise.tenantId", ["string", "null"], {
    default: DEFAULT_CONFIG.enterprise.tenantId,
    description: "Enterprise tenant id",
  }),
  descriptor("services.autoStart", "boolean", {
    default: DEFAULT_CONFIG.services.autoStart,
    description: "Start backing services automatically",
  }),
  descriptor("services.dockerComposePath", ["string", "null"], {
    default: DEFAULT_CONFIG.services.dockerComposePath,
    description: "Path to a Docker Compose file",
  }),
  descriptor("update.channel", "string", {
    enum: ["stable", "beta"],
    default: DEFAULT_CONFIG.update.channel,
    description: "CLI update channel",
  }),
  descriptor("update.autoCheck", "boolean", {
    default: DEFAULT_CONFIG.update.autoCheck,
    description: "Check for updates on startup",
  }),
  descriptor("cli.theme", "string", {
    enum: ["auto", "dark", "light", "mono"],
    description: "Interactive color theme",
  }),
  descriptor("cli.tuiMode", "string", {
    enum: ["auto", "inline", "fullscreen"],
    description: "Interactive TUI mode",
  }),
  descriptor("cli.fastMode", "boolean", {
    description: "Prefer lower-latency model behavior",
  }),
  descriptor("cli.promptSuggestions", "boolean", {
    default: DEFAULT_CONFIG.cli.promptSuggestions,
    description: "Show background prompt suggestions in the interactive REPL",
  }),
  descriptor("cli.keybindings", "object", {
    default: DEFAULT_CONFIG.cli.keybindings,
    open: true,
    description: "Interactive REPL action-to-key binding overrides",
  }),
  descriptor("voice", "object", {
    default: DEFAULT_CONFIG.voice,
    description: "Interactive voice-dictation settings",
  }),
  descriptor("voice.backends", "object", {
    default: DEFAULT_CONFIG.voice.backends,
    open: true,
    description: "Available host speech-to-text backend capability map",
  }),
  descriptor("voice.allowCloud", "boolean", {
    default: DEFAULT_CONFIG.voice.allowCloud,
    description: "Allow cloud speech transcription after local-first probes",
  }),
  descriptor("context.autoPin", ["boolean", "object"], {
    open: true,
    description: "Keep the original task through context compaction",
  }),
  descriptor("permissions.askTimeoutMs", "number", {
    minimum: 0,
    description: "Idle timeout for interactive permission prompts",
  }),
  descriptor("webSearch", "object", {
    description: "Web-search provider options",
  }),
  descriptor("webSearch.provider", "string", {
    enum: [
      "auto",
      "tavily",
      "brave",
      "bocha",
      "qianfan",
      "duckduckgo",
      "searxng",
      "baidu",
    ],
    description: "Web-search provider",
  }),
  descriptor("webSearch.maxResults", "number", {
    minimum: 1,
    description: "Default maximum search result count",
  }),
  descriptor("webSearch.apiKey", ["string", "null"], {
    secret: true,
    description: "Web-search provider API key",
  }),
  ...["tavily", "brave", "bocha", "qianfan"].map((provider) =>
    descriptor(`webSearch.${provider}ApiKey`, ["string", "null"], {
      secret: true,
      description: `${provider} web-search API key`,
    }),
  ),
  descriptor("webSearch.instanceUrl", "string", {
    description: "SearXNG instance URL",
  }),
  descriptor("webSearch.qianfanUrl", "string", {
    description: "Qianfan search endpoint",
  }),
  descriptor("cloud", "object", {
    open: true,
    description: "Private cloud-runner options",
  }),
  descriptor("cloud.token", ["string", "null"], {
    secret: true,
    description: "Private cloud-runner bearer token",
  }),
  descriptor("channels", "object", {
    open: true,
    description: "Inbound channel configuration",
  }),
  descriptor("session", "object", {
    open: true,
    description: "Session persistence and mirror options",
  }),
  descriptor("plugins", "object", {
    description: "Plugin-owned configuration namespace",
  }),
  descriptor("plugins.registryTokens", "object", {
    open: true,
    secretChildren: true,
    description: "Per-registry authentication tokens",
  }),
  descriptor("hub", "object", {
    open: true,
    description: "Hub service configuration",
  }),
  descriptor("hub.llm", ["string", "object"], {
    open: true,
    description: "Hub LLM routing configuration",
  }),
  descriptor("hub.llm.apiKey", ["string", "null"], {
    secret: true,
    description: "Hub-specific LLM API key",
  }),
  descriptor("hub.llm.provider", "string", {
    description: "Hub-specific LLM provider",
  }),
  descriptor("hub.llm.model", "string", {
    description: "Hub-specific LLM model",
  }),
  descriptor("hub.llm.baseUrl", "string", {
    description: "Hub-specific LLM endpoint",
  }),
  descriptor("hub.llm.apiKeyEnv", "string", {
    description: "Environment variable containing the hub LLM API key",
  }),
  descriptor("remoteControl", "object", {
    open: true,
    description: "Remote-control connection settings",
  }),
  descriptor("credentialProxy", "object", {
    description: "Credential proxy policy",
  }),
  descriptor("credentialProxy.enabled", "boolean", {
    description: "Mask credentials inherited by child processes",
  }),
  descriptor("credentialProxy.mode", "string", {
    enum: ["mask", "deny"],
    description: "Mask or remove credential variables",
  }),
  descriptor("credentialProxy.allow", "array", {
    description: "Credential environment variable allowlist",
  }),
  descriptor("credentialProxy.deny", "array", {
    description: "Additional credential environment variables to mask",
  }),
  descriptor("advisor.enabled", "boolean", {
    default: DEFAULT_CONFIG.advisor.enabled,
    description: "Enable the independent advisor/critic pass",
  }),
  descriptor("advisor.provider", ["string", "null"], {
    description: "Advisor-specific LLM provider",
  }),
  descriptor("advisor.model", ["string", "null"], {
    description: "Advisor-specific model",
  }),
  descriptor("advisor.budgetUsd", "number", {
    minimum: 0,
    description: "Maximum advisor spend in USD per run",
  }),
  descriptor("advisor.repeatErrorThreshold", "integer", {
    minimum: 2,
    description: "Repeated-error count that triggers advisor review",
  }),
  descriptor("advisorEnabled", "boolean", {
    deprecated: true,
    migration: "advisor.enabled",
    description: "Legacy advisor enabled alias",
  }),
  descriptor("advisorProvider", ["string", "null"], {
    deprecated: true,
    migration: "advisor.provider",
    description: "Legacy advisor provider alias",
  }),
  descriptor("advisorModel", ["string", "null"], {
    deprecated: true,
    migration: "advisor.model",
    description: "Legacy advisor model alias",
  }),
  descriptor("advisorBudgetUsd", "number", {
    minimum: 0,
    deprecated: true,
    migration: "advisor.budgetUsd",
    description: "Legacy advisor budget alias",
  }),
  descriptor("advisorRepeatErrorThreshold", "integer", {
    minimum: 2,
    deprecated: true,
    migration: "advisor.repeatErrorThreshold",
    description: "Legacy advisor repeated-error alias",
  }),
  descriptor("telemetry", "object", {
    open: true,
    description: "Telemetry and local observability settings",
  }),
  descriptor("ui", "object", {
    open: true,
    description: "Desktop UI compatibility settings",
  }),
];

const BY_KEY = new Map(DESCRIPTORS.map((entry) => [entry.key, entry]));
// Extension namespaces cannot publish plaintext just because their common
// credential field uses a compound spelling. This is a closed leaf-name
// vocabulary (not a broad substring guess); plugin schemas can additionally
// mark any custom field with `secret: true`.
const SECRET_LEAF_RE =
  /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|bearer[_-]?token|bot[_-]?token|client[_-]?secret|secret[_-]?access[_-]?key|private[_-]?key|secret|token|password|passwd|credential|credentials)$/i;
const FORBIDDEN_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

export function validateConfigKeySyntax(key) {
  const text = String(key || "");
  const parts = text.split(".");
  if (
    !text ||
    parts.some(
      (part) =>
        !part || FORBIDDEN_SEGMENTS.has(part) || !/^[A-Za-z0-9_-]+$/.test(part),
    )
  ) {
    const error = new Error(`Invalid configuration key: ${text || "(empty)"}`);
    error.code = "CONFIG_KEY_INVALID";
    throw error;
  }
  return text;
}

function parentDescriptors(key) {
  const parents = [];
  const parts = key.split(".");
  for (let index = parts.length - 1; index > 0; index -= 1) {
    const found = BY_KEY.get(parts.slice(0, index).join("."));
    if (found) parents.push(found);
  }
  return parents;
}

function implicitContainerDescriptor(key) {
  const prefix = `${key}.`;
  const descendants = DESCRIPTORS.filter((entry) =>
    entry.key.startsWith(prefix),
  );
  if (descendants.length === 0) return null;
  return {
    key,
    type: "object",
    scope: descendants.every((entry) => entry.scope === descendants[0].scope)
      ? descendants[0].scope
      : "user",
    managedLock: descendants.some((entry) => entry.managedLock !== false),
    implicit: true,
    description: `Configuration group for ${key}`,
  };
}

/** Return the exact descriptor, or a descriptor inherited from an open map. */
export function getConfigDescriptor(key) {
  const normalized = validateConfigKeySyntax(key);
  const exact = BY_KEY.get(normalized);
  if (exact) return { ...exact };
  const container = implicitContainerDescriptor(normalized);
  if (container) return container;
  const openParent = parentDescriptors(normalized).find((entry) => entry.open);
  if (!openParent) return null;
  const leaf = normalized.split(".").at(-1);
  return {
    key: normalized,
    type: "any",
    scope: openParent.scope,
    managedLock: openParent.managedLock,
    extension: true,
    secret:
      openParent.secretChildren === true || SECRET_LEAF_RE.test(String(leaf)),
    description: `Extension value under ${openParent.key}`,
  };
}

export function isKnownConfigKey(key) {
  try {
    return getConfigDescriptor(key) !== null;
  } catch {
    return false;
  }
}

export function isSecretConfigKey(key) {
  const leaf = String(key || "")
    .split(".")
    .at(-1);
  try {
    const entry = getConfigDescriptor(key);
    if (entry?.secret === true) return true;
    return SECRET_LEAF_RE.test(leaf || "");
  } catch {
    // Redaction is an independent security boundary and may receive a raw,
    // invalid document before validation. Preserve the closed leaf-name
    // fallback even when the full dotted path is deliberately rejected.
    return SECRET_LEAF_RE.test(leaf || "");
  }
}

export function getConfigDescriptors() {
  return DESCRIPTORS.map((entry) => ({ ...entry }));
}

/**
 * Register typed plugin-owned keys without opening arbitrary global keys.
 * Entries use keys relative to `plugins.<pluginId>` and may declare `secret`.
 */
export function registerPluginConfigSchema(pluginId, entries = []) {
  const id = String(pluginId || "").trim();
  validateConfigKeySyntax(`plugins.${id}`);
  if (!id || id.includes(".")) {
    throw new Error("Plugin config schema id must be one path segment");
  }
  const namespace = `plugins.${id}`;
  if (
    BY_KEY.has(namespace) ||
    DESCRIPTORS.some((entry) => entry.key.startsWith(`${namespace}.`))
  ) {
    throw new Error(`Plugin config namespace is reserved: ${namespace}`);
  }
  const pending = [];
  const pendingKeys = new Set();
  for (const value of entries) {
    const relative = validateConfigKeySyntax(value?.key);
    const key = `${namespace}.${relative}`;
    if (BY_KEY.has(key) || pendingKeys.has(key)) {
      throw new Error(`Configuration key is already registered: ${key}`);
    }
    const next = descriptor(key, value.type || "any", {
      ...value,
      key,
      scope: "plugin",
    });
    pending.push(next);
    pendingKeys.add(key);
  }
  // Resolve inheritance only after every descriptor exists so callers are not
  // forced to order a secretChildren parent before its children.
  for (const next of pending) {
    const inheritedSecret = [...DESCRIPTORS, ...pending].some(
      (entry) =>
        next.key.startsWith(`${entry.key}.`) &&
        (entry.secret === true || entry.secretChildren === true),
    );
    if (inheritedSecret) next.secret = true;
  }
  for (const next of pending) {
    DESCRIPTORS.push(next);
    BY_KEY.set(next.key, next);
  }
  return pending.map((entry) => ({ ...entry }));
}

function typesFor(entry) {
  return Array.isArray(entry?.type) ? entry.type : [entry?.type || "any"];
}

function actualType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function valueIssue(key, code, message) {
  return { key, code, message };
}

function isPersistedSecretRef(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof value.__cc_secret_ref === "string" &&
    value.__cc_secret_ref.length > 0,
  );
}

export function validateConfigValue(key, value, options = {}) {
  let entry;
  try {
    entry = getConfigDescriptor(key);
  } catch (error) {
    return [valueIssue(String(key || ""), error.code, error.message)];
  }
  if (!entry) {
    return options.allowUnknown
      ? []
      : [
          valueIssue(
            key,
            "CONFIG_KEY_UNKNOWN",
            `Unknown configuration key: ${key}`,
          ),
        ];
  }
  if (isPersistedSecretRef(value)) {
    if (entry.secret === true) return [];
    return [
      valueIssue(
        key,
        "CONFIG_SECRET_REF_INVALID",
        `Secret reference is not allowed at non-secret key: ${key}`,
      ),
    ];
  }
  const allowed = typesFor(entry);
  const got = actualType(value);
  const typeMatches =
    allowed.includes("any") ||
    allowed.includes(got) ||
    (got === "number" &&
      allowed.includes("integer") &&
      Number.isInteger(value));
  if (!typeMatches) {
    return [
      valueIssue(
        key,
        "CONFIG_TYPE_INVALID",
        `${key} must be ${allowed.join(" | ")}; received ${got}`,
      ),
    ];
  }
  if (entry.enum && !entry.enum.includes(value)) {
    return [
      valueIssue(
        key,
        "CONFIG_ENUM_INVALID",
        `${key} must be one of: ${entry.enum.join(", ")}`,
      ),
    ];
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return [
        valueIssue(key, "CONFIG_NUMBER_INVALID", `${key} must be finite`),
      ];
    }
    if (entry.minimum != null && value < entry.minimum) {
      return [
        valueIssue(
          key,
          "CONFIG_NUMBER_RANGE",
          `${key} must be >= ${entry.minimum}`,
        ),
      ];
    }
    if (entry.maximum != null && value > entry.maximum) {
      return [
        valueIssue(
          key,
          "CONFIG_NUMBER_RANGE",
          `${key} must be <= ${entry.maximum}`,
        ),
      ];
    }
  }
  return [];
}

export function coerceConfigValue(key, raw, options = {}) {
  const entry = getConfigDescriptor(key);
  if (!entry && !options.allowUnknown) {
    const error = new Error(`Unknown configuration key: ${key}`);
    error.code = "CONFIG_KEY_UNKNOWN";
    throw error;
  }
  if (typeof raw !== "string") {
    const issues = validateConfigValue(key, raw, options);
    if (issues.length)
      throw Object.assign(new Error(issues[0].message), issues[0]);
    return raw;
  }
  const types = typesFor(entry);
  let value = raw;
  if (raw === "null" && types.includes("null")) {
    value = null;
  } else if (types.includes("boolean")) {
    if (raw !== "true" && raw !== "false") {
      const error = new Error(`${key} must be true or false`);
      error.code = "CONFIG_TYPE_INVALID";
      throw error;
    }
    value = raw === "true";
  } else if (types.includes("number") || types.includes("integer")) {
    value = Number(raw);
    if (
      !Number.isFinite(value) ||
      (types.includes("integer") && !Number.isInteger(value))
    ) {
      const error = new Error(
        `${key} must be a finite ${types.includes("integer") ? "integer" : "number"}`,
      );
      error.code = "CONFIG_TYPE_INVALID";
      throw error;
    }
  } else if (
    (types.includes("array") && raw.trim().startsWith("[")) ||
    (types.includes("object") && raw.trim().startsWith("{")) ||
    ((types.includes("array") || types.includes("object")) &&
      !types.includes("string"))
  ) {
    try {
      value = JSON.parse(raw);
    } catch {
      const error = new Error(`${key} must be valid JSON`);
      error.code = "CONFIG_TYPE_INVALID";
      throw error;
    }
  } else if (types.includes("any")) {
    if (raw === "true") value = true;
    else if (raw === "false") value = false;
    else if (raw === "null") value = null;
    else if (raw.trim() !== "" && Number.isFinite(Number(raw)))
      value = Number(raw);
  }
  const issues = validateConfigValue(key, value, options);
  if (issues.length)
    throw Object.assign(new Error(issues[0].message), issues[0]);
  return value;
}

function walkConfig(value, prefix, issues, options) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const [name, child] of Object.entries(value)) {
    const key = prefix ? `${prefix}.${name}` : name;
    let entry;
    try {
      entry = getConfigDescriptor(key);
    } catch (error) {
      issues.push(valueIssue(key, error.code, error.message));
      continue;
    }
    if (!entry) {
      if (!options.allowUnknown) {
        issues.push(
          valueIssue(
            key,
            "CONFIG_KEY_UNKNOWN",
            `Unknown configuration key: ${key}`,
          ),
        );
      }
      continue;
    }
    issues.push(...validateConfigValue(key, child, options));
    if (
      child &&
      typeof child === "object" &&
      !Array.isArray(child) &&
      !isPersistedSecretRef(child)
    ) {
      walkConfig(child, key, issues, options);
    }
  }
}

export function validateConfigDocument(config, options = {}) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return {
      valid: false,
      schemaVersion: CONFIG_SCHEMA_VERSION,
      issues: [
        valueIssue(
          "",
          "CONFIG_ROOT_INVALID",
          "Configuration root must be an object",
        ),
      ],
    };
  }
  const issues = [];
  walkConfig(config, "", issues, options);
  return {
    valid: issues.length === 0,
    schemaVersion: CONFIG_SCHEMA_VERSION,
    issues,
  };
}

export function migrateConfigDocument(config) {
  const next = structuredClone(config || {});
  const migrations = [];
  const legacy = next?.llm?.fallbackModel;
  if (legacy != null) {
    if (next?.llm?.fallbackModels == null) {
      next.llm.fallbackModels = Array.isArray(legacy) ? legacy : [legacy];
    }
    delete next.llm.fallbackModel;
    migrations.push({ from: "llm.fallbackModel", to: "llm.fallbackModels" });
  }
  const advisorAliases = [
    ["advisorEnabled", "enabled"],
    ["advisorProvider", "provider"],
    ["advisorModel", "model"],
    ["advisorBudgetUsd", "budgetUsd"],
    ["advisorRepeatErrorThreshold", "repeatErrorThreshold"],
  ];
  for (const [legacyKey, nestedKey] of advisorAliases) {
    if (!Object.prototype.hasOwnProperty.call(next, legacyKey)) continue;
    if (next.advisor == null) next.advisor = {};
    if (typeof next.advisor !== "object" || Array.isArray(next.advisor)) {
      // Preserve both invalid values so validation can report them; migration
      // must never crash or silently replace a malformed nested document.
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(next.advisor, nestedKey)) {
      next.advisor[nestedKey] = next[legacyKey];
    }
    delete next[legacyKey];
    migrations.push({ from: legacyKey, to: `advisor.${nestedKey}` });
  }
  return { config: next, migrations };
}

function schemaType(type) {
  if (type === "any") return {};
  return { type };
}

function objectPropertiesFor(schema) {
  if (Array.isArray(schema.anyOf)) {
    let objectBranch = schema.anyOf.find((entry) => entry?.type === "object");
    if (!objectBranch) {
      objectBranch = { type: "object" };
      schema.anyOf.push(objectBranch);
    }
    objectBranch.properties ||= {};
    objectBranch.additionalProperties ??= false;
    return objectBranch.properties;
  }
  schema.type = "object";
  schema.properties ||= {};
  schema.additionalProperties ??= false;
  return schema.properties;
}

function markObjectBranchesOpen(schema) {
  if (!schema || typeof schema !== "object") return;
  if (schema.type === "object") schema.additionalProperties = true;
  if (Array.isArray(schema.anyOf)) {
    for (const branch of schema.anyOf) markObjectBranchesOpen(branch);
  }
}

function buildJsonSchema() {
  const root = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: CONFIG_SCHEMA_ID,
    title: "ChainlessChain CLI configuration",
    type: "object",
    additionalProperties: false,
    properties: {},
    $defs: {
      secretRef: {
        type: "object",
        additionalProperties: false,
        required: ["__cc_secret_ref"],
        properties: {
          __cc_secret_ref: { type: "string", minLength: 1 },
        },
      },
    },
    "x-chainlesschain-schema-version": CONFIG_SCHEMA_VERSION,
  };
  const orderedDescriptors = [...DESCRIPTORS].sort(
    (left, right) => left.key.split(".").length - right.key.split(".").length,
  );
  for (const entry of orderedDescriptors) {
    const parts = entry.key.split(".");
    let properties = root.properties;
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      const leaf = index === parts.length - 1;
      if (!properties[part]) {
        properties[part] = leaf
          ? {}
          : { type: "object", additionalProperties: false, properties: {} };
      }
      if (!leaf) {
        properties = objectPropertiesFor(properties[part]);
        continue;
      }
      const types = typesFor(entry);
      const declaredSchema =
        types.length === 1
          ? schemaType(types[0])
          : { anyOf: types.map((type) => schemaType(type)) };
      const leafSchema = entry.secret
        ? { anyOf: [declaredSchema, { $ref: "#/$defs/secretRef" }] }
        : declaredSchema;
      if (entry.enum) leafSchema.enum = [...entry.enum];
      if (entry.default !== undefined)
        leafSchema.default = structuredClone(entry.default);
      if (entry.minimum !== undefined) leafSchema.minimum = entry.minimum;
      if (entry.maximum !== undefined) leafSchema.maximum = entry.maximum;
      if (entry.description) leafSchema.description = entry.description;
      if (entry.open) {
        leafSchema.additionalProperties = true;
        markObjectBranchesOpen(leafSchema);
      }
      if (entry.secret) leafSchema["x-secret"] = true;
      if (entry.secretChildren) leafSchema["x-secret-children"] = true;
      leafSchema["x-scope"] = entry.scope;
      leafSchema["x-managed-lock"] = entry.managedLock;
      if (entry.deprecated) leafSchema.deprecated = true;
      if (entry.migration) leafSchema["x-migration"] = entry.migration;
      properties[part] = { ...properties[part], ...leafSchema };
    }
  }
  return root;
}

export const CONFIG_SCHEMA = Object.freeze(buildJsonSchema());

/** Include any plugin schemas registered in the current process. */
export function getConfigJsonSchema() {
  return buildJsonSchema();
}
