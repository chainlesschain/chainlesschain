/**
 * Unified OpenTelemetry identifier + attribute normalization (P2 "可观测性").
 *
 * The gap: spans/events across the runtime stamp ad-hoc, inconsistent ids, so a
 * session can't be reassembled across turns / tools / sub-agents / workflows, and
 * nothing guarantees prompt/response/tool-argument CONTENT stays out of telemetry
 * or that label cardinality stays bounded.
 *
 * This is the PURE normalization core. Given a loose context object it emits:
 *   - the canonical id set (session/turn/prompt/tool_use/agent/parent_agent/
 *     workflow.run_id/permission.decision_id/checkpoint.id) under stable keys,
 *   - CONTENT (prompt/response/tool arguments) redacted by default — opt-in only,
 *     and even then length-capped,
 *   - a bounded attribute map: only allow-listed keys survive, id values are
 *     charset-sanitized + length-capped, so a run can't explode label cardinality.
 *
 * Deterministic (no clock/RNG) so it's fully unit-testable; the span recorder
 * layer feeds its raw context through here before building OTLP.
 */

/**
 * Canonical id attribute keys, mapped from the many aliases the callers use.
 * The VALUE is the stable OTel attribute key; the KEY list are accepted aliases.
 * Order here is the emit order (stable, low cardinality).
 */
const ID_FIELDS = Object.freeze([
  { key: "session.id", aliases: ["session.id", "sessionId", "session_id"] },
  { key: "turn.id", aliases: ["turn.id", "turnId", "turn_id"] },
  { key: "prompt.id", aliases: ["prompt.id", "promptId", "prompt_id"] },
  {
    key: "tool_use.id",
    aliases: ["tool_use.id", "toolUseId", "tool_use_id", "toolUse.id"],
  },
  { key: "agent.id", aliases: ["agent.id", "agentId", "agent_id"] },
  {
    key: "parent_agent.id",
    aliases: [
      "parent_agent.id",
      "parentAgentId",
      "parent_agent_id",
      "parentAgent.id",
    ],
  },
  {
    key: "workflow.run_id",
    aliases: ["workflow.run_id", "workflowRunId", "workflow_run_id", "runId"],
  },
  {
    key: "permission.decision_id",
    aliases: [
      "permission.decision_id",
      "permissionDecisionId",
      "permission_decision_id",
      "decisionId",
    ],
  },
  {
    key: "checkpoint.id",
    aliases: ["checkpoint.id", "checkpointId", "checkpoint_id"],
  },
]);

/** Content fields that must never be emitted unless explicitly opted in. */
const CONTENT_FIELDS = Object.freeze([
  { key: "prompt", aliases: ["prompt", "promptText", "input"] },
  { key: "response", aliases: ["response", "responseText", "output"] },
  {
    key: "tool_arguments",
    aliases: ["tool_arguments", "toolArguments", "arguments", "args"],
  },
]);

/** The complete set of allow-listed attribute keys (ids + a few low-card meta). */
const META_KEYS = Object.freeze([
  "agent.kind",
  "tool.name",
  "workflow.name",
  "permission.decision",
]);

const MAX_ID_LEN = 128;
const MAX_CONTENT_LEN = 4096;
const REDACTED = "[redacted]";

function firstAlias(ctx, aliases) {
  for (const a of aliases) {
    if (ctx[a] != null && ctx[a] !== "") return ctx[a];
  }
  return undefined;
}

/**
 * Sanitize an id VALUE to a bounded, low-cardinality-safe token: keep a stable
 * printable charset, strip control/whitespace, cap length. Non-scalars are
 * stringified; empties drop out (caller omits the key).
 */
export function sanitizeIdValue(value) {
  if (value == null) return undefined;
  let s = typeof value === "string" ? value : String(value);
  // collapse anything outside a conservative id charset to '_'
  s = s.replace(/[^\w.\-:/@]/g, "_").replace(/_+/g, "_");
  s = s.replace(/^_+|_+$/g, "");
  if (!s) return undefined;
  return s.length > MAX_ID_LEN ? s.slice(0, MAX_ID_LEN) : s;
}

/**
 * Redact a content value: default → the redaction sentinel; opt-in → the value
 * stringified and length-capped (never unbounded, to keep exports sane).
 */
export function redactContent(value, includeContent = false) {
  if (value == null) return undefined;
  if (!includeContent) return REDACTED;
  const s = typeof value === "string" ? value : safeStringify(value);
  return s.length > MAX_CONTENT_LEN
    ? s.slice(0, MAX_CONTENT_LEN) + "…[truncated]"
    : s;
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Build the canonical, bounded, redacted attribute map for a telemetry context.
 *
 * @param {object} ctx raw context (mixed aliases, may carry content)
 * @param {object} [opts]
 *   includeContent — emit prompt/response/tool_arguments (still capped). Default
 *                    false. This is the ONLY switch that lets content out.
 * @returns {{ [key:string]: string }} attributes keyed by stable OTel names
 */
export function buildTelemetryAttributes(
  ctx = {},
  { includeContent = false } = {},
) {
  const attrs = {};
  for (const { key, aliases } of ID_FIELDS) {
    const raw = firstAlias(ctx, aliases);
    const v = sanitizeIdValue(raw);
    if (v !== undefined) attrs[key] = v;
  }
  for (const key of META_KEYS) {
    const v = sanitizeIdValue(ctx[key]);
    if (v !== undefined) attrs[key] = v;
  }
  for (const { key, aliases } of CONTENT_FIELDS) {
    const raw = firstAlias(ctx, aliases);
    if (raw == null || raw === "") continue;
    const v = redactContent(raw, includeContent);
    if (v !== undefined) attrs[`content.${key}`] = v;
  }
  return attrs;
}

/** The set of attribute keys this normalizer can ever emit (cardinality bound). */
export function allowedAttributeKeys() {
  return [
    ...ID_FIELDS.map((f) => f.key),
    ...META_KEYS,
    ...CONTENT_FIELDS.map((f) => `content.${f.key}`),
  ];
}

/**
 * Assert an already-built attribute map only uses allow-listed keys and never
 * leaks raw content when content wasn't opted in. Returns violation list (empty
 * = clean) so a recorder can fail-closed in strict mode.
 */
export function auditAttributes(attrs = {}, { includeContent = false } = {}) {
  const allowed = new Set(allowedAttributeKeys());
  const violations = [];
  for (const [k, v] of Object.entries(attrs)) {
    if (!allowed.has(k)) {
      violations.push({ key: k, reason: "key-not-allowlisted" });
      continue;
    }
    if (k.startsWith("content.") && !includeContent && v !== REDACTED) {
      violations.push({ key: k, reason: "content-not-redacted" });
    }
  }
  return violations;
}

export const TELEMETRY_ID_KEYS = Object.freeze(ID_FIELDS.map((f) => f.key));
export const TELEMETRY_CONTENT_SENTINEL = REDACTED;
