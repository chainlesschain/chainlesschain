import settingsLoader from "./settings-loader.cjs";

const { loadManagedSettings, readSettingsFile, settingsPaths } = settingsLoader;

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

/**
 * Layered merge for `autoMode` settings. NOT mergeSandboxSettings: that
 * helper's array branch stringifies elements (`map(String)`) for sandbox
 * allowlists, which destroys array-form `decisions` rule objects into
 * "[object Object]". Here `decisions` arrays are an ORDERED RULE LIST — a
 * closer layer replaces the whole list; everything else keeps the familiar
 * closer-scalar-wins / deep-object-merge semantics.
 */
function mergeAutoModeSettings(base, overlay) {
  const out = isPlainObject(base) ? clone(base) : {};
  for (const [key, value] of Object.entries(overlay || {})) {
    if (Array.isArray(value)) {
      out[key] = clone(value);
    } else if (isPlainObject(value)) {
      out[key] = mergeAutoModeSettings(out[key], value);
    } else if (["string", "boolean", "number"].includes(typeof value)) {
      out[key] = value;
    }
  }
  return out;
}

export function loadAutoModeConfig(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  let effective = clone(AUTO_MODE_DEFAULTS.settings);
  const files = [];

  for (const file of settingsPaths(cwd, opts.settingsFile)) {
    const data = readSettingsFile(file, { onWarn: opts.onWarn });
    const autoMode = autoModeFromSettings(data);
    if (!autoMode) continue;
    effective = mergeAutoModeSettings(effective, autoMode);
    files.push(file);
  }

  const managed = loadManagedSettings(opts);
  let managedFile = null;
  if (managed.settings) {
    const autoMode = autoModeFromSettings(managed.settings);
    if (autoMode) {
      effective = mergeAutoModeSettings(effective, autoMode);
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
 * Compile a shell-style glob (`*` wildcard only) into an anchored RegExp.
 * Case-sensitive on purpose: match patterns are user-vetted capabilities and
 * a looser match could over-authorize.
 */
function compileGlob(pattern) {
  const escaped = String(pattern)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

/**
 * Resolve the effective decision rules for `--permission-mode auto`.
 *
 * Accepts `autoMode.decisions` in two shapes:
 *   - object: `{ "medium": "ask", "high": { "decision": "deny", "reason": "…" } }`
 *     (riskLevel-level overrides only)
 *   - array (same shape as the defaults document):
 *     `[{ "match": { "riskLevel": "medium" }, "decision": "ask", "reason": "…" }]`
 *     Array rules may additionally match on `tool` (exact name) and/or
 *     `commandPattern` (a `*` glob against the shell command). Rules with a
 *     tool/commandPattern are FINE-GRAINED: they are tried in declaration
 *     order before the riskLevel map, first full match wins.
 *
 * Invalid risk levels / decision values / non-string patterns are ignored
 * (fail to defaults) so a typo in settings.json can never loosen NOR silently
 * break the gate.
 *
 * @param {object} [effectiveSettings] merged `autoMode` settings
 * @returns {{
 *   map: Record<string,{decision:string,reason:string,source:string}>,
 *   rules: Array<{match:object,decision:string,reason:string,_test:(ctx:object)=>boolean}>,
 *   customized: boolean,
 * }}
 */
export function resolveAutoModeDecisions(effectiveSettings = {}) {
  const map = defaultDecisionMap();
  const rules = [];
  let customized = false;

  const raw = effectiveSettings?.decisions;
  const entries = [];
  if (Array.isArray(raw)) {
    for (const rule of raw) {
      if (!isPlainObject(rule)) continue;
      const match = isPlainObject(rule.match) ? rule.match : {};
      const decision = normalizeDecisionValue(rule.decision);
      if (!decision) continue;
      const hasTool = typeof match.tool === "string" && match.tool.trim();
      const hasPattern =
        typeof match.commandPattern === "string" && match.commandPattern.trim();
      if (hasTool || hasPattern) {
        // Fine-grained rule: tried in order before the riskLevel map.
        const riskLevel =
          typeof match.riskLevel === "string" &&
          RISK_LEVELS.includes(match.riskLevel.toLowerCase())
            ? match.riskLevel.toLowerCase()
            : null;
        const tool = hasTool ? match.tool.trim() : null;
        const pattern = hasPattern ? match.commandPattern.trim() : null;
        const regex = pattern ? compileGlob(pattern) : null;
        const reason =
          typeof rule.reason === "string" && rule.reason.trim()
            ? rule.reason.trim()
            : `autoMode.decisions rule matches ${[
                tool ? `tool=${tool}` : null,
                pattern ? `command=${pattern}` : null,
                riskLevel ? `risk=${riskLevel}` : null,
              ]
                .filter(Boolean)
                .join(" ")} → ${decision}`;
        rules.push({
          match: {
            ...(riskLevel ? { riskLevel } : {}),
            ...(tool ? { tool } : {}),
            ...(pattern ? { commandPattern: pattern } : {}),
          },
          decision,
          reason,
          _test: (ctx) => {
            if (riskLevel) {
              const r = RISK_LEVELS.includes(ctx.riskLevel)
                ? ctx.riskLevel
                : "low";
              if (r !== riskLevel) return false;
            }
            if (tool && ctx.tool !== tool) return false;
            if (regex && !regex.test(String(ctx.args?.command ?? ""))) {
              return false;
            }
            return true;
          },
        });
        customized = true;
        continue;
      }
      entries.push([match.riskLevel, rule.decision, rule.reason]);
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

  return { map, rules, customized };
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
 * @param {{ isActive?: () => boolean }} [opts] `isActive` lets a host that can
 *        switch permission modes mid-session (the REPL) leave the wrapper
 *        installed permanently and toggle it: when it returns false, decide()
 *        delegates untouched to the inner gate. Omitted → always active
 *        (headless runs pick the mode once per process).
 */
export function createAutoModeApprovalGate(inner, resolved, opts = {}) {
  const map = resolved?.map || defaultDecisionMap();
  const rules = Array.isArray(resolved?.rules) ? resolved.rules : [];
  const isActive =
    typeof opts.isActive === "function" ? opts.isActive : () => true;
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
      if (!isActive()) return inner.decide(ctx);
      const riskLevel = RISK_LEVELS.includes(ctx.riskLevel)
        ? ctx.riskLevel
        : "low";
      // Fine-grained rules (tool / commandPattern) run in declaration order
      // before the riskLevel map — first full match wins.
      let rule = null;
      for (const candidate of rules) {
        let matched = false;
        try {
          matched = candidate._test({ ...ctx, riskLevel });
        } catch {
          matched = false; // a broken matcher never decides anything
        }
        if (matched) {
          rule = {
            decision: candidate.decision,
            reason: candidate.reason,
            source: "settings",
            match: candidate.match,
          };
          break;
        }
      }
      if (!rule) {
        const fromMap = map[riskLevel];
        rule = {
          decision: fromMap.decision,
          reason: fromMap.reason,
          source: fromMap.source,
        };
      }
      const common = {
        policy: "auto-mode",
        riskLevel,
        reason: rule.reason,
        rule: {
          riskLevel,
          decision: rule.decision,
          source: rule.source,
          ...(rule.match ? { match: rule.match } : {}),
        },
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
