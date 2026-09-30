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
 * @param {{ active?: boolean, isActive?: () => boolean }} [opts] Hosts that
 *        switch modes use `active` and setActive() so every committed change
 *        advances the authority revision and synchronously notifies observers.
 *        Omitted → always active. The legacy isActive callback is sampled only;
 *        it cannot provide lossless notification of changes between samples.
 */
export function createAutoModeApprovalGate(inner, resolved, opts = {}) {
  const inputMap = resolved?.map || defaultDecisionMap();
  const inputRules = Array.isArray(resolved?.rules) ? resolved.rules : [];
  if (opts.active !== undefined && typeof opts.active !== "boolean") {
    throw new TypeError("Auto Mode active state must be boolean");
  }
  const legacyIsActive =
    typeof opts.isActive === "function" ? opts.isActive : null;
  let active = opts.active ?? true;
  let activeRevision = 0;
  const activeListeners = new Set();
  const isActive = () => (legacyIsActive ? legacyIsActive() === true : active);
  let confirm = null;
  let authorizationConsumerRequired = false;
  const authorityConfig = Object.freeze({
    map: Object.freeze(
      Object.fromEntries(
        RISK_LEVELS.map((riskLevel) => {
          const entry = inputMap[riskLevel];
          if (!DECISION_VALUES.includes(entry?.decision)) {
            throw new TypeError("Invalid resolved Auto Mode decision");
          }
          return [
            riskLevel,
            Object.freeze({
              decision: entry.decision,
              reason: typeof entry.reason === "string" ? entry.reason : null,
              source: typeof entry.source === "string" ? entry.source : null,
            }),
          ];
        }),
      ),
    ),
    rules: Object.freeze(
      inputRules.map((rule) => {
        const match = rule.match;
        if (
          !DECISION_VALUES.includes(rule.decision) ||
          !isPlainObject(match) ||
          Object.keys(match).some(
            (key) => !["riskLevel", "tool", "commandPattern"].includes(key),
          ) ||
          (match.riskLevel !== undefined &&
            !RISK_LEVELS.includes(match.riskLevel)) ||
          (match.tool !== undefined &&
            (typeof match.tool !== "string" || !match.tool)) ||
          (match.commandPattern !== undefined &&
            (typeof match.commandPattern !== "string" ||
              !match.commandPattern)) ||
          (!match.tool && !match.commandPattern)
        ) {
          throw new TypeError("Invalid resolved Auto Mode rule");
        }
        return Object.freeze({
          decision: rule.decision,
          reason: typeof rule.reason === "string" ? rule.reason : null,
          source: "settings",
          match: Object.freeze({ ...match }),
        });
      }),
    ),
  });
  // Compile only the immutable authority data. Caller-owned matchers and
  // resolved objects must never change decisions behind an unchanged snapshot.
  const map = authorityConfig.map;
  const rules = authorityConfig.rules.map((rule) => ({
    rule,
    regex: rule.match.commandPattern
      ? compileGlob(rule.match.commandPattern)
      : null,
  }));

  return {
    isAutoModeGate: true,
    setActive(nextActive) {
      if (legacyIsActive) {
        throw new TypeError(
          "Callback-owned Auto Mode state cannot use setActive",
        );
      }
      if (typeof nextActive !== "boolean") {
        throw new TypeError("Auto Mode active state must be boolean");
      }
      if (active === nextActive) return;
      const nextRevision = activeRevision + 1;
      if (!Number.isSafeInteger(nextRevision)) {
        throw new Error("Auto Mode active revision exhausted");
      }
      active = nextActive;
      activeRevision = nextRevision;
      let listenerError = null;
      for (const subscription of [...activeListeners]) {
        try {
          subscription.listener(
            Object.freeze({
              sessionId: subscription.sessionId,
              source: "auto-mode-active",
              active,
              activeRevision,
            }),
          );
        } catch (error) {
          listenerError ||= error;
        }
      }
      if (listenerError) throw listenerError;
    },
    setSessionPolicy(sessionId, policy) {
      return inner?.setSessionPolicy?.(sessionId, policy);
    },
    getSessionPolicy(sessionId) {
      return inner?.getSessionPolicy?.(sessionId);
    },
    clearSessionPolicy(sessionId) {
      return inner?.clearSessionPolicy?.(sessionId);
    },
    awaitPersistence() {
      return inner?.awaitPersistence?.();
    },
    hasPolicyStore() {
      return inner?.hasPolicyStore?.() === true;
    },
    setConfirmer(fn) {
      confirm = typeof fn === "function" ? fn : null;
      inner?.setConfirmer?.(fn);
    },
    hasConfirmer() {
      return typeof confirm === "function";
    },
    setAuthorizationConsumer(fn) {
      authorizationConsumerRequired = typeof fn === "function";
      return inner?.setAuthorizationConsumer?.(fn);
    },
    hasAuthorizationConsumer() {
      return authorizationConsumerRequired;
    },
    getAuthorizationPolicySnapshot(sessionId = null) {
      return Object.freeze({
        schema: "chainlesschain.approval-policy-authority/v1",
        kind: "auto-mode",
        active: isActive(),
        activeRevision,
        activeSource: legacyIsActive ? "sampled-callback" : "owned",
        config: authorityConfig,
        inner:
          inner?.getAuthorizationPolicySnapshot?.(sessionId) ||
          Object.freeze({
            schema: "chainlesschain.approval-policy-authority/v1",
            kind: "unobserved-inner",
            sessionId: sessionId ? String(sessionId) : null,
          }),
      });
    },
    subscribePolicyRevision(sessionId, listener) {
      if (!sessionId || typeof listener !== "function") {
        throw new TypeError(
          "Auto Mode policy revision subscription requires a session and listener",
        );
      }
      const removeInner = inner?.subscribePolicyRevision?.(sessionId, listener);
      if (
        typeof inner?.subscribePolicyRevision === "function" &&
        typeof removeInner !== "function"
      ) {
        throw new TypeError("Inner policy subscription must return a function");
      }
      const subscription = { sessionId: String(sessionId), listener };
      activeListeners.add(subscription);
      return () => {
        activeListeners.delete(subscription);
        removeInner?.();
      };
    },
    consumeAuthorization(authorization, ctx) {
      if (typeof inner?.consumeAuthorization !== "function") {
        throw new Error("Approval authorization consumer is unavailable");
      }
      return inner.consumeAuthorization(authorization, ctx);
    },
    createAuthorizationBinder() {
      return inner?.createAuthorizationBinder?.() || null;
    },
    async decide(ctx = {}) {
      const shouldCheckPersistence =
        typeof inner?.awaitPersistence === "function" &&
        (typeof inner?.hasPolicyStore !== "function" ||
          inner.hasPolicyStore() === true);
      if (shouldCheckPersistence) {
        try {
          await inner.awaitPersistence();
        } catch (error) {
          return {
            decision: "deny",
            via: "policy-store-error",
            base: "deny",
            policy: "auto-mode",
            riskLevel: RISK_LEVELS.includes(ctx.riskLevel)
              ? ctx.riskLevel
              : "low",
            error,
          };
        }
      }
      if (!isActive()) return inner.decide(ctx);
      const riskLevel = RISK_LEVELS.includes(ctx.riskLevel)
        ? ctx.riskLevel
        : "low";
      // Fine-grained rules (tool / commandPattern) run in declaration order
      // before the riskLevel map — first full match wins.
      let rule = null;
      for (const { rule: candidate, regex } of rules) {
        const match = candidate.match;
        if (
          (!match.riskLevel || match.riskLevel === riskLevel) &&
          (!match.tool || match.tool === ctx.tool) &&
          (!regex || regex.test(String(ctx.args?.command ?? "")))
        ) {
          rule = candidate;
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
      // Snapshot both mutable callbacks before the first await. A concurrent
      // stop/start or session reconfiguration must not retarget an in-flight
      // remote approval to a different authorization consumer generation.
      const confirmer = confirm;
      const consumerRequired = authorizationConsumerRequired;
      const bindAuthorization = consumerRequired
        ? inner?.createAuthorizationBinder?.()
        : null;
      if (typeof confirmer !== "function") {
        return {
          decision: "deny",
          via: "no-confirmer",
          base: "confirm",
          ...common,
        };
      }
      let ok = false;
      let authorization = null;
      let confirmationVia = null;
      try {
        const confirmation = await confirmer(ctx);
        if (confirmation && typeof confirmation === "object") {
          ok = confirmation.approved === true;
          confirmationVia = confirmation.via || null;
          if (ok && !confirmation.authorization) {
            return {
              decision: "deny",
              via: "authorization-missing",
              base: "confirm",
              ...common,
            };
          }
          if (
            ok &&
            (!consumerRequired || typeof bindAuthorization !== "function")
          ) {
            return {
              decision: "deny",
              via: "authorization-consumer-missing",
              base: "confirm",
              ...common,
            };
          }
          if (ok) {
            authorization = bindAuthorization(confirmation.authorization);
          }
        } else {
          ok = confirmation === true;
        }
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
        via: confirmationVia || (ok ? "user-confirm" : "user-deny"),
        base: "confirm",
        ...(authorization ? { authorization } : {}),
        ...common,
      };
    },
  };
}
