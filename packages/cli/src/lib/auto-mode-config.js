import settingsLoader from "./settings-loader.cjs";

const {
  loadManagedSettings,
  readSettingsFile,
  settingsPaths,
  mergeSandboxSettings,
} = settingsLoader;

export const AUTO_MODE_SCHEMA = "chainlesschain.auto-mode/v1";

export const AUTO_MODE_DEFAULTS = Object.freeze({
  schema: AUTO_MODE_SCHEMA,
  mode: "auto",
  sessionPolicy: "trusted",
  nonInteractiveConfirm: "deny",
  interactiveConfirm: "ask",
  precedence: Object.freeze([
    "managed-settings",
    "permission-rules.deny",
    "permission-rules.ask",
    "permission-rules.allow",
    "shell-policy",
    "approval-gate",
    "hooks",
  ]),
  decisions: Object.freeze([
    Object.freeze({
      match: Object.freeze({ riskLevel: "low" }),
      decision: "allow",
      reason: "read-only and low-risk tools do not require approval",
    }),
    Object.freeze({
      match: Object.freeze({ riskLevel: "medium" }),
      decision: "allow",
      reason: "auto maps to the trusted ApprovalGate policy",
    }),
    Object.freeze({
      match: Object.freeze({ riskLevel: "high" }),
      decision: "ask",
      nonInteractiveDecision: "deny",
      reason: "dangerous execution still needs approval",
    }),
  ]),
  settings: Object.freeze({
    classifyAllShell: false,
  }),
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function autoModeFromSettings(data) {
  if (!isPlainObject(data?.autoMode)) return null;
  return clone(data.autoMode);
}

export function loadAutoModeConfig(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  let effective = clone(AUTO_MODE_DEFAULTS.settings);
  const files = [];

  for (const file of settingsPaths(cwd, opts.settingsFile)) {
    const data = readSettingsFile(file, { onWarn: opts.onWarn });
    const autoMode = autoModeFromSettings(data);
    if (!autoMode) continue;
    effective = mergeSandboxSettings(effective, autoMode);
    files.push(file);
  }

  const managed = loadManagedSettings(opts);
  let managedFile = null;
  if (managed.settings) {
    const autoMode = autoModeFromSettings(managed.settings);
    if (autoMode) {
      effective = mergeSandboxSettings(effective, autoMode);
      managedFile = managed.file;
      files.push(managed.file);
    }
  }

  return {
    schema: AUTO_MODE_SCHEMA,
    defaults: clone(AUTO_MODE_DEFAULTS.settings),
    effective,
    files,
    managedFile,
  };
}

export function autoModeDefaultsDocument() {
  return clone(AUTO_MODE_DEFAULTS);
}

const RISK_LEVELS = Object.freeze(["low", "medium", "high"]);
const DECISION_VALUES = Object.freeze(["allow", "ask", "deny"]);

function normalizeDecisionValue(value) {
  const v = typeof value === "string" ? value.toLowerCase() : null;
  if (v === "confirm") return "ask";
  return DECISION_VALUES.includes(v) ? v : null;
}

function defaultDecisionMap() {
  const map = {};
  for (const rule of AUTO_MODE_DEFAULTS.decisions) {
    map[rule.match.riskLevel] = {
      decision: rule.decision,
      reason: rule.reason,
      source: "default",
    };
  }
  return map;
}

/**
 * Resolve the effective riskLevel → decision map for `--permission-mode auto`.
 *
 * Accepts `autoMode.decisions` in two shapes:
 *   - object: `{ "medium": "ask", "high": { "decision": "deny", "reason": "…" } }`
 *   - array (same shape as the defaults document):
 *     `[{ "match": { "riskLevel": "medium" }, "decision": "ask", "reason": "…" }]`
 *
 * Invalid risk levels / decision values are ignored (fail to defaults) so a
 * typo in settings.json can never loosen NOR silently break the gate.
 *
 * @param {object} [effectiveSettings] merged `autoMode` settings
 * @returns {{ map: Record<string,{decision:string,reason:string,source:string}>, customized: boolean }}
 */
export function resolveAutoModeDecisions(effectiveSettings = {}) {
  const map = defaultDecisionMap();
  let customized = false;

  const raw = effectiveSettings?.decisions;
  const entries = [];
  if (Array.isArray(raw)) {
    for (const rule of raw) {
      if (!isPlainObject(rule)) continue;
      entries.push([rule.match?.riskLevel, rule.decision, rule.reason]);
    }
  } else if (isPlainObject(raw)) {
    for (const [riskLevel, value] of Object.entries(raw)) {
      if (isPlainObject(value)) {
        entries.push([riskLevel, value.decision, value.reason]);
      } else {
        entries.push([riskLevel, value, undefined]);
      }
    }
  }

  for (const [riskLevelRaw, decisionRaw, reasonRaw] of entries) {
    const riskLevel =
      typeof riskLevelRaw === "string" ? riskLevelRaw.toLowerCase() : null;
    if (!RISK_LEVELS.includes(riskLevel)) continue;
    const decision = normalizeDecisionValue(decisionRaw);
    if (!decision) continue;
    const reason =
      typeof reasonRaw === "string" && reasonRaw.trim()
        ? reasonRaw.trim()
        : `autoMode.decisions maps ${riskLevel} risk to ${decision}`;
    if (map[riskLevel].decision !== decision) customized = true;
    map[riskLevel] = { decision, reason, source: "settings" };
  }

  return { map, customized };
}

/**
 * Wrap a session-core ApprovalGate so `--permission-mode auto` consults the
 * user-configured riskLevel → decision map instead of the fixed trusted-policy
 * tier. Only wired when `resolveAutoModeDecisions` reports `customized` — the
 * unconfigured path keeps the byte-identical trusted mapping.
 *
 * The wrapper cannot up-authorize hard shell-policy denies: those return from
 * `evaluateShellCommandWithApproval` before the gate is ever consulted.
 *
 * @param {object} inner session-core ApprovalGate (or compatible)
 * @param {ReturnType<typeof resolveAutoModeDecisions>} resolved
 */
export function createAutoModeApprovalGate(inner, resolved) {
  const map = resolved?.map || defaultDecisionMap();
  let confirm = null;

  return {
    isAutoModeGate: true,
    setSessionPolicy(sessionId, policy) {
      return inner?.setSessionPolicy?.(sessionId, policy);
    },
    getSessionPolicy(sessionId) {
      return inner?.getSessionPolicy?.(sessionId);
    },
    clearSessionPolicy(sessionId) {
      return inner?.clearSessionPolicy?.(sessionId);
    },
    setConfirmer(fn) {
      confirm = typeof fn === "function" ? fn : null;
      inner?.setConfirmer?.(fn);
    },
    hasConfirmer() {
      return typeof confirm === "function";
    },
    async decide(ctx = {}) {
      const riskLevel = RISK_LEVELS.includes(ctx.riskLevel)
        ? ctx.riskLevel
        : "low";
      const rule = map[riskLevel];
      const common = {
        policy: "auto-mode",
        riskLevel,
        reason: rule.reason,
        rule: { riskLevel, decision: rule.decision, source: rule.source },
      };
      if (rule.decision === "allow") {
        return {
          decision: "allow",
          via: "auto-mode-config",
          base: "allow",
          ...common,
        };
      }
      if (rule.decision === "deny") {
        return {
          decision: "deny",
          via: "auto-mode-config",
          base: "deny",
          ...common,
        };
      }
      // ask — same confirm semantics as the session-core gate: no confirmer
      // means fail-closed deny (headless installs a deny-confirmer anyway).
      if (typeof confirm !== "function") {
        return {
          decision: "deny",
          via: "no-confirmer",
          base: "confirm",
          ...common,
        };
      }
      let ok = false;
      try {
        ok = await confirm(ctx);
      } catch (error) {
        return {
          decision: "deny",
          via: "confirm-error",
          base: "confirm",
          error,
          ...common,
        };
      }
      return {
        decision: ok ? "allow" : "deny",
        via: ok ? "user-confirm" : "user-deny",
        base: "confirm",
        ...common,
      };
    },
  };
}
