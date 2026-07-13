/**
 * Canonical capability manifest — the single source the CLI capability output,
 * the VS Code / JetBrains negotiation, the protocol docs, the compatibility
 * fixture, the behavior matrix and the release-notes capability diff all project
 * from (P1-9 "Capability Manifest 与脱敏诊断包" of
 * CLAUDE_CODE_IDE_INCREMENTAL_GAP_ANALYSIS_2026-07-13.md).
 *
 * Today the wire-protocol capability surface is hand-authored in THREE places
 * that can silently drift:
 *   - [[capability-negotiation.js]]: `PROTOCOL_FEATURES`, `FEATURE_MIN_VERSION`,
 *     and the private `FEATURE_TO_FIELD` map.
 *   - [[headless-manifest.js]]: `buildAgentCapabilities().features` (the
 *     `cc agent --capabilities` output).
 *   - the Java twin + the shared negotiation fixture.
 * A new v2 field added to one list but not the others parses wrong on the peer
 * that missed it. This module is the ONE definition; every other shape is a pure
 * projection of it, and a drift-guard test asserts the live hand-authored
 * constants still equal the projection (see capability-manifest.test.js).
 *
 * Pure: no fs / process / clock. Projections are deterministic so a caller can
 * regenerate docs/fixtures and diff them against the checked-in copies in CI.
 */

import { createHash } from "node:crypto";

/**
 * THE canonical manifest. `wireFeatures` is the negotiable additive per-line
 * field set (order mirrors capability-negotiation.js `PROTOCOL_FEATURES`);
 * `runtimeFeatures` are the boolean capability flags that change what the CLI
 * can DO (not the shape of a line the client must parse) and are NOT negotiated.
 */
export const CAPABILITY_MANIFEST = Object.freeze({
  name: "chainlesschain-cli",
  protocolVersion: 1,
  minProtocolVersion: 1,

  wireFeatures: Object.freeze([
    Object.freeze({
      key: "event_seq",
      field: "seq",
      minVersion: 1,
      description:
        "every stream-json stdout line carries a monotonic per-run `seq`",
    }),
    Object.freeze({
      key: "tool_use_id",
      field: "tool_use_id",
      minVersion: 1,
      description:
        'tool_use / tool_result lines carry a pairing `id` ("tu-<n>")',
    }),
    Object.freeze({
      key: "trace_id",
      field: "trace_id",
      minVersion: 1,
      description:
        "each line carries a run-scoped, caller-injectable `trace_id` for IDE ↔ CLI correlation",
    }),
  ]),

  // Boolean capability flags (buildAgentCapabilities().features truthy keys).
  runtimeFeatures: Object.freeze([
    "bare",
    "safe_mode",
    "ephemeral",
    "background",
    "worktree",
    "checkpoint",
    "json_schema_output",
    "partial_messages",
    "interactive_approvals",
    "permission_prompt_tool",
    "remote_control",
  ]),

  mcpFeatures: Object.freeze([
    "config_file",
    "registry",
    "tool_search",
    "oauth",
    "managed_allowlist",
  ]),
  sandboxEngines: Object.freeze(["docker", "bubblewrap"]),

  permissionModes: Object.freeze([
    "default",
    "manual",
    "auto",
    "dontAsk",
    "plan",
    "acceptEdits",
    "bypassPermissions",
  ]),
  outputFormats: Object.freeze(["text", "json", "stream-json"]),
  inputFormats: Object.freeze(["text", "stream-json"]),
});

const manifestOr = (m) =>
  m && typeof m === "object" ? m : CAPABILITY_MANIFEST;
const wireFeaturesOf = (m) =>
  Array.isArray(manifestOr(m).wireFeatures) ? manifestOr(m).wireFeatures : [];

/**
 * The negotiable wire feature keys, in canonical declared order — the value
 * capability-negotiation.js `PROTOCOL_FEATURES` must equal.
 * @returns {string[]}
 */
export function toProtocolFeatures(m = CAPABILITY_MANIFEST) {
  return wireFeaturesOf(m).map((f) => f.key);
}

/**
 * Feature → minimum protocol version, ONLY for features gated above the base
 * version (a v1-additive field is absent, matching an empty
 * `FEATURE_MIN_VERSION` today). Adding a v2 feature here flows the gate to the
 * negotiator automatically.
 * @returns {Record<string, number>}
 */
export function toFeatureMinVersion(m = CAPABILITY_MANIFEST) {
  const out = {};
  for (const f of wireFeaturesOf(m)) {
    if (Number(f.minVersion) > 1) out[f.key] = Number(f.minVersion);
  }
  return out;
}

/**
 * Feature → the stream line field it gates (the value of the private
 * `FEATURE_TO_FIELD` map in capability-negotiation.js).
 * @returns {Record<string, string>}
 */
export function toFieldGate(m = CAPABILITY_MANIFEST) {
  const out = {};
  for (const f of wireFeaturesOf(m)) out[f.key] = f.field;
  return out;
}

/**
 * The server negotiation offer shape consumed by
 * capability-negotiation.js `negotiateProtocol(server, …)`.
 * @returns {{protocolVersion:number, minProtocolVersion:number, features:string[]}}
 */
export function toServerOffer(m = CAPABILITY_MANIFEST) {
  const mm = manifestOr(m);
  return {
    protocolVersion: Number(mm.protocolVersion) || 1,
    minProtocolVersion: Number(mm.minProtocolVersion) || 1,
    features: toProtocolFeatures(mm),
  };
}

/**
 * The `features` object of `cc agent --capabilities`
 * (buildAgentCapabilities().features): every runtime flag true, every wire
 * feature true, plus the nested `mcp` object and `sandbox_engines` list. A test
 * asserts the live buildAgentCapabilities().features deep-equals this.
 * @returns {object}
 */
export function toAgentFeatureFlags(m = CAPABILITY_MANIFEST) {
  const mm = manifestOr(m);
  const flags = {};
  for (const key of mm.runtimeFeatures || []) flags[key] = true;
  for (const f of wireFeaturesOf(mm)) flags[f.key] = true;
  flags.mcp = {};
  for (const key of mm.mcpFeatures || []) flags.mcp[key] = true;
  flags.sandbox_engines = [...(mm.sandboxEngines || [])];
  return flags;
}

/**
 * A deterministic capability fixture the VS Code / JetBrains twins can pin and
 * assert against (the "Compatibility Fixture" the gap doc asks for). Order- and
 * clock-independent; a `digest` lets a peer detect any change in one compare.
 * @returns {object}
 */
export function buildCompatFixture(m = CAPABILITY_MANIFEST) {
  const mm = manifestOr(m);
  const body = {
    protocolVersion: Number(mm.protocolVersion) || 1,
    minProtocolVersion: Number(mm.minProtocolVersion) || 1,
    features: toProtocolFeatures(mm),
    featureFields: toFieldGate(mm),
    featureMinVersion: toFeatureMinVersion(mm),
    permissionModes: [...(mm.permissionModes || [])],
    outputFormats: [...(mm.outputFormats || [])],
    inputFormats: [...(mm.inputFormats || [])],
  };
  return { ...body, digest: capabilityDigest(mm) };
}

/**
 * A stable digest of the whole capability surface (no RNG/clock) — one string
 * that changes iff any projected capability changed. Handy as a CI drift check.
 * @returns {string} 16-hex-char sha256 prefix
 */
export function capabilityDigest(m = CAPABILITY_MANIFEST) {
  const mm = manifestOr(m);
  const canonical = {
    protocolVersion: Number(mm.protocolVersion) || 1,
    minProtocolVersion: Number(mm.minProtocolVersion) || 1,
    wire: wireFeaturesOf(mm)
      .map((f) => [f.key, f.field, Number(f.minVersion) || 1])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
    runtime: [...(mm.runtimeFeatures || [])].sort(),
    mcp: [...(mm.mcpFeatures || [])].sort(),
    sandbox: [...(mm.sandboxEngines || [])].sort(),
    permissionModes: [...(mm.permissionModes || [])].sort(),
    outputFormats: [...(mm.outputFormats || [])].sort(),
    inputFormats: [...(mm.inputFormats || [])].sort(),
  };
  return createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex")
    .slice(0, 16);
}

/**
 * A behavior matrix row per wire feature — feature × min version × gated field ×
 * negotiable × description. Consumed by renderProtocolDoc and by a test that a
 * doc table matches the code.
 * @returns {Array<{feature:string, minVersion:number, field:string, negotiable:boolean, description:string}>}
 */
export function renderBehaviorMatrix(m = CAPABILITY_MANIFEST) {
  return wireFeaturesOf(m).map((f) => ({
    feature: f.key,
    minVersion: Number(f.minVersion) || 1,
    field: f.field,
    negotiable: true,
    description: String(f.description || ""),
  }));
}

/**
 * Render the protocol capability section as Markdown (a generated doc a CI job
 * diffs against the checked-in copy). Deterministic; ends with a trailing
 * newline so a byte compare is stable.
 * @returns {string}
 */
export function renderProtocolDoc(m = CAPABILITY_MANIFEST) {
  const mm = manifestOr(m);
  const lines = [];
  lines.push("# Agent Protocol Capability Manifest (generated)");
  lines.push("");
  lines.push(
    `Protocol version **${mm.protocolVersion}** (negotiates down to **${mm.minProtocolVersion}**).`,
  );
  lines.push("");
  lines.push("## Negotiable wire features");
  lines.push("");
  lines.push("| Feature | Min version | Line field | Description |");
  lines.push("| ------- | ----------- | ---------- | ----------- |");
  for (const row of renderBehaviorMatrix(mm)) {
    lines.push(
      `| \`${row.feature}\` | ${row.minVersion} | \`${row.field}\` | ${row.description} |`,
    );
  }
  lines.push("");
  lines.push("## Permission modes");
  lines.push("");
  lines.push((mm.permissionModes || []).map((x) => `\`${x}\``).join(", "));
  lines.push("");
  return lines.join("\n") + "\n";
}

/**
 * Capability diff for release notes: what changed between a previous and a next
 * manifest (or a manifest and the current canonical one). Additive vs removed vs
 * min-version/field changes, plus any protocol-version bump.
 *
 * @param {object} prev  a manifest (or its compat fixture)
 * @param {object} [next=CAPABILITY_MANIFEST]
 * @returns {{protocolChange:{from:number,to:number}|null,
 *            addedWireFeatures:string[], removedWireFeatures:string[],
 *            changedWireFeatures:Array<{feature:string, from:object, to:object}>,
 *            addedRuntimeFeatures:string[], removedRuntimeFeatures:string[]}}
 */
export function diffCapabilities(prev, next = CAPABILITY_MANIFEST) {
  const wireMap = (m) => {
    const out = new Map();
    for (const f of wireFeaturesOf(m)) {
      out.set(f.key, {
        field: f.field,
        minVersion: Number(f.minVersion) || 1,
      });
    }
    return out;
  };
  const runtimeSet = (m) => new Set(manifestOr(m).runtimeFeatures || []);

  const p = wireMap(prev);
  const n = wireMap(next);
  const addedWireFeatures = [...n.keys()].filter((k) => !p.has(k)).sort();
  const removedWireFeatures = [...p.keys()].filter((k) => !n.has(k)).sort();
  const changedWireFeatures = [];
  for (const [key, nv] of n) {
    const pv = p.get(key);
    if (pv && (pv.field !== nv.field || pv.minVersion !== nv.minVersion)) {
      changedWireFeatures.push({ feature: key, from: pv, to: nv });
    }
  }

  const pr = runtimeSet(prev);
  const nr = runtimeSet(next);
  const addedRuntimeFeatures = [...nr].filter((k) => !pr.has(k)).sort();
  const removedRuntimeFeatures = [...pr].filter((k) => !nr.has(k)).sort();

  const pVer = Number(manifestOr(prev).protocolVersion) || 1;
  const nVer = Number(manifestOr(next).protocolVersion) || 1;
  const protocolChange = pVer === nVer ? null : { from: pVer, to: nVer };

  return {
    protocolChange,
    addedWireFeatures,
    removedWireFeatures,
    changedWireFeatures,
    addedRuntimeFeatures,
    removedRuntimeFeatures,
  };
}
