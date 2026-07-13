/**
 * De-identified diagnostic bundle assembler + mandatory secret-scan export gate
 * (IDE gap P1-9 "脱敏诊断包" of CLAUDE_CODE_IDE_INCREMENTAL_GAP_ANALYSIS_2026-
 * 07-13.md).
 *
 * When an IDE session misbehaves, a one-click diagnostic export is the fastest
 * path to a fix — but a naive dump of "everything about the session" leaks
 * source, keys and terminal output. The gap doc pins the contract exactly: a
 * bundle carries version, platform, capability, connection state, redaction
 * events, trace, reconnect history, and process/port/lockfile/worktree
 * summaries; it does NOT carry source code, API keys, cookies, full environment
 * variables, or unpermitted terminal output; and "导出前必须运行 Secret Scan".
 *
 * This module assembles that bundle from caller-supplied signals and runs the
 * §8.1 recall-first scanner ([[secret-scan.js]]) as a fail-closed export gate.
 * It reuses the canonical capability projection ([[capability-manifest.js]]) so
 * the bundle never invents a second capability truth.
 *
 * Pure: no fs / process / clock / RNG — the caller collects the raw signals
 * (which processes, which ports, the env object) and this module shapes, de-
 * identifies and gates them. Timestamps, if any, are passed in.
 */

import { redactSecrets, scanSecrets, SURFACES } from "./secret-scan.js";
import { buildCompatFixture } from "./capability-manifest.js";
import { isSecretEnvName } from "./credential-guard.js";

/** The categories deliberately EXCLUDED from every bundle (never assembled). */
export const EXCLUDED_BY_DEFAULT = Object.freeze([
  "source code body",
  "API keys / tokens",
  "cookies",
  "full environment variable values",
  "unpermitted terminal output",
]);

/**
 * Summarize an environment WITHOUT any values: variable NAMES only, with the
 * secret-named ones flagged (via isSecretEnvName). Honors the contract "默认不
 * 包含完整环境变量" — a name is metadata, a value may be a credential.
 * @param {object} env
 * @returns {{count:number, names:string[], secretNames:string[]}}
 */
export function summarizeEnv(env) {
  if (!env || typeof env !== "object") {
    return { count: 0, names: [], secretNames: [] };
  }
  const names = Object.keys(env).sort();
  const secretNames = names.filter((n) => isSecretEnvName(n));
  return { count: names.length, names, secretNames };
}

/** Recursively redact every string in a value (arrays/objects walked). */
function deepRedact(value, depth = 0) {
  if (depth > 64) return value;
  if (typeof value === "string") return redactSecrets(value);
  if (Array.isArray(value)) return value.map((v) => deepRedact(v, depth + 1));
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value))
      out[k] = deepRedact(value[k], depth + 1);
    return out;
  }
  return value;
}

/**
 * Recursively scan a value for any residual secret, returning findings with a
 * dotted path so the gate can name WHERE a leak survived. Read-only.
 * @returns {Array<{path:string, category:string}>}
 */
export function scanBundleForSecrets(value, path = "", depth = 0) {
  if (depth > 64) return [];
  const findings = [];
  if (typeof value === "string") {
    for (const f of scanSecrets(value)) {
      findings.push({ path: path || "(root)", category: f.category });
    }
  } else if (Array.isArray(value)) {
    value.forEach((v, i) =>
      findings.push(...scanBundleForSecrets(v, `${path}[${i}]`, depth + 1)),
    );
  } else if (value && typeof value === "object") {
    for (const k of Object.keys(value)) {
      findings.push(
        ...scanBundleForSecrets(value[k], path ? `${path}.${k}` : k, depth + 1),
      );
    }
  }
  return findings;
}

const asArray = (v) => (Array.isArray(v) ? v : []);
const asString = (v) =>
  typeof v === "string" ? v : v == null ? "" : String(v);

/**
 * Assemble the diagnostic bundle from caller-supplied signals, de-identifying
 * as it goes. Free-text fields are secret-redacted; env is reduced to names;
 * terminal output is included ONLY with explicit permission (and still
 * redacted). Excluded categories are never assembled in the first place.
 *
 * @param {object} input
 * @param {string} [input.version]
 * @param {object|string} [input.platform]
 * @param {object} [input.capability]        defaults to the canonical compat fixture
 * @param {string} [input.connectionState]
 * @param {Array}  [input.reconnectHistory]  [{at?, reason?}] — reasons redacted
 * @param {object} [input.trace]             {traceId, spanCount} summary (no content)
 * @param {Array}  [input.redactionEvents]   [{surface, category, count}] — what was scrubbed
 * @param {Array}  [input.processes]         [{pid, name, cpu?}] metadata
 * @param {Array<number|object>} [input.ports]
 * @param {Array<string>} [input.lockfiles]
 * @param {Array}  [input.worktrees]         [{path, branch}]
 * @param {object} [input.env]               reduced to names only
 * @param {string} [input.terminalOutput]    included only when opts.includeTerminalOutput
 * @param {string} [input.notes]
 * @param {object} [opts]
 * @param {boolean} [opts.includeTerminalOutput=false]
 * @returns {object} the assembled (already-redacted) bundle
 */
export function buildDiagnosticBundle(input = {}, opts = {}) {
  const includeTerminal = opts.includeTerminalOutput === true;

  const redactionEvents = asArray(input.redactionEvents)
    .map((e) => ({
      surface: SURFACES.includes(e?.surface) ? e.surface : "unknown",
      category: asString(e?.category),
      count: Number(e?.count) || 0,
    }))
    .filter((e) => e.category);

  const bundle = {
    schema: "cc-diagnostic-bundle/v1",
    meta: {
      version: asString(input.version) || null,
      platform:
        input.platform && typeof input.platform === "object"
          ? input.platform
          : asString(input.platform) || null,
      excluded: [...EXCLUDED_BY_DEFAULT],
    },
    capability:
      input.capability && typeof input.capability === "object"
        ? input.capability
        : buildCompatFixture(),
    connection: {
      state: asString(input.connectionState) || null,
      reconnectHistory: asArray(input.reconnectHistory).map((r) => ({
        at: r?.at ?? null,
        reason: asString(r?.reason),
      })),
    },
    trace: input.trace
      ? {
          traceId: asString(input.trace.traceId) || null,
          spanCount: Number(input.trace.spanCount) || 0,
        }
      : null,
    redactionEvents,
    runtime: {
      processes: asArray(input.processes).map((p) => ({
        pid: p?.pid ?? null,
        name: asString(p?.name),
        cpu: p?.cpu ?? null,
      })),
      ports: asArray(input.ports).map((p) =>
        typeof p === "object" && p
          ? { port: Number(p.port) || null, proto: asString(p.proto) || null }
          : { port: Number(p) || null, proto: null },
      ),
      lockfiles: asArray(input.lockfiles).map((f) => asString(f)),
      worktrees: asArray(input.worktrees).map((w) => ({
        path: asString(w?.path),
        branch: asString(w?.branch) || null,
      })),
    },
    // env is reduced to NAMES only up front (values never enter the bundle).
    env: summarizeEnv(input.env),
    notes: input.notes != null ? asString(input.notes) : null,
  };

  // Terminal output is unpermitted by default: dropped entirely, with a marker
  // so the reader knows it was withheld (not merely absent).
  if (includeTerminal && input.terminalOutput != null) {
    bundle.terminalOutput = asString(input.terminalOutput);
  } else {
    bundle.terminalOutput = null;
    bundle.terminalOutputWithheld = input.terminalOutput != null;
  }

  // Single de-identification pass over the WHOLE assembled bundle: every string
  // field is secret-redacted regardless of which section it landed in, so the
  // export gate is guaranteed clean no matter which signal carried a secret.
  // env is already values-free, so its names (metadata) pass through untouched.
  return deepRedact(bundle);
}

/**
 * The mandatory pre-export gate ("导出前必须运行 Secret Scan"). Deep-scans the
 * assembled bundle; fail-closed: if ANY residual secret survives, `ok` is false
 * and `blocked` is true — the caller must NOT export it. On a clean bundle the
 * gate returns it ready for export.
 *
 * @param {object} bundle  a buildDiagnosticBundle() result
 * @returns {{ok:boolean, blocked:boolean, findings:Array, bundle:object}}
 */
export function secretScanGate(bundle) {
  const findings = scanBundleForSecrets(bundle);
  const ok = findings.length === 0;
  return { ok, blocked: !ok, findings, bundle };
}

/**
 * One-call assembly + gate. Builds the de-identified bundle and runs the secret
 * scan. When the gate is clean, returns the exportable bundle; when it is not
 * (should never happen given assembly redacts, but defense-in-depth), returns
 * `ok:false` and the leak locations, and does NOT hand back an exportable body.
 *
 * @returns {{ok:boolean, bundle:(object|null), findings:Array}}
 */
export function exportDiagnosticBundle(input = {}, opts = {}) {
  const bundle = buildDiagnosticBundle(input, opts);
  const gate = secretScanGate(bundle);
  return {
    ok: gate.ok,
    bundle: gate.ok ? bundle : null,
    findings: gate.findings,
  };
}
