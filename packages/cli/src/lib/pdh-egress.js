/**
 * PDH egress classification (design module 101 §3.5.18 — 出境台账 / "what left
 * the device").
 *
 * The personal-data chat's single source of truth for egress is the Android,
 * on-device, *encrypted* TransparencyLedger (§3.5.18, line 962). But the cc
 * agent makes the actual cloud-LLM call — where conversation context that may
 * contain personal data is sent to a cloud provider — entirely inside the cc
 * subprocess, invisible to the Android app (the emitted token_usage carries no
 * provider). Egress-classed tools (send / export / cross-device sync /
 * remote-API fetch) likewise run inside cc.
 *
 * This module classifies cc-side egress so headless-stream.js can EMIT a
 * structured `egress` stream-json event the Android ledger records. cc only
 * REPORTS egress (emit-only); it never writes its own ledger file, so the
 * ledger stays the single on-device encrypted store the design mandates.
 *
 * Honest-by-default (§3.5.18 line 963 "不隐藏任何出境" — never hide an egress):
 * an unknown, non-empty provider is treated as cloud, i.e. we over-report
 * rather than under-report. A local/on-device turn reports nothing — the
 * truthful "0 条出境".
 *
 * Pure CLI, no Android dependency, fully unit-testable.
 */

import { BUILT_IN_PROVIDERS } from "./llm-providers.js";

// Providers that run on the device (or the user's own LAN box) and so never
// send conversation context off the device.
const LOCAL_PROVIDERS = new Set([
  "ollama",
  "llamacpp",
  "llama-cpp",
  "llama.cpp",
  "mediapipe",
  "on-device",
  "ondevice",
  "local",
]);

// Known cloud APIs, derived from the provider registry (single source of truth)
// — ollama is `free:true` (local); every other built-in is a cloud endpoint.
// For these the provider NAME is authoritative: classify as cloud regardless of
// a possibly-default/stale baseUrl. New providers added to the registry are
// picked up automatically.
const CLOUD_PROVIDERS = new Set(
  Object.values(BUILT_IN_PROVIDERS)
    .filter((d) => d && d.free !== true && d.name)
    .map((d) => String(d.name).toLowerCase()),
);

/** True when a baseUrl points at the local device or the user's own LAN. */
function isLocalBaseUrl(baseUrl) {
  const u = String(baseUrl || "").toLowerCase();
  if (!u) return false;
  if (
    u.includes("localhost") ||
    u.includes("127.0.0.1") ||
    u.includes("0.0.0.0") ||
    u.includes("[::1]") ||
    u.includes("//::1")
  ) {
    return true;
  }
  // Private LAN ranges (RFC 1918): the user's own box, not a cloud egress.
  return /\/\/(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(u);
}

/**
 * A provider is "local" (no egress) when it is a known on-device engine, or
 * (for an unknown/custom provider) its baseUrl resolves to the device / the
 * user's own LAN. A known cloud provider is never local even if it is called
 * with a default/stale localhost baseUrl — the provider name wins.
 */
export function isLocalProvider(provider, baseUrl) {
  const p = String(provider || "")
    .toLowerCase()
    .trim();
  if (p && LOCAL_PROVIDERS.has(p)) return true;
  if (p && CLOUD_PROVIDERS.has(p)) return false;
  // Unknown/custom provider — decide by where its baseUrl points.
  return isLocalBaseUrl(baseUrl);
}

/**
 * Cloud = a turn whose conversation context leaves the device. An empty
 * provider means no LLM ran (not cloud); an unknown non-empty provider is
 * treated as cloud so an egress is never silently hidden.
 */
export function isCloudProvider(provider, baseUrl) {
  if (!provider) return false;
  return !isLocalProvider(provider, baseUrl);
}

/**
 * Classify a tool call as a data-egress channel, or null when it stays on the
 * device. Tool names may carry an MCP prefix (mcp__pdh__collect_app_data) or be
 * bare (send_message); we match on the bare suffix.
 *
 * @returns {"message"|"export"|"cross_device"|"web"|"remote_api"|null}
 */
export function classifyEgressTool(toolName) {
  const raw = String(toolName || "")
    .toLowerCase()
    .trim();
  if (!raw) return null;
  // Strip an MCP server prefix: mcp__<server>__<tool> → <tool>.
  const bare = raw.includes("__") ? raw.slice(raw.lastIndexOf("__") + 2) : raw;

  // Sending data OUT to another party.
  if (bare === "send_message" || bare.startsWith("send_")) return "message";
  // Exporting data off the device.
  if (bare.includes("export")) return "export";
  // Cross-device sync / backup — leaves THIS device for another.
  if (
    bare.includes("cross_device") ||
    bare.includes("backup") ||
    bare.startsWith("sync_to") ||
    bare.includes("transfer")
  ) {
    return "cross_device";
  }
  // Generic web egress.
  if (bare === "web_search" || bare === "web_fetch" || bare === "fetch") {
    return "web";
  }
  // The PDH cookie-API tools transmit the user's auth cookie + query to a
  // remote 3rd-party API (to fetch the user's own data back). The cookie + the
  // query leave the device, so this IS an egress channel — honest disclosure.
  // The root / snapshot / salvage / system / files variants are purely on-device
  // reads and therefore fall through to null.
  if (bare === "collect_app_data" || bare === "query_app_data") {
    return "remote_api";
  }
  return null;
}

/**
 * Build the `egress` stream-json event the Android ledger records.
 *   kind:    "cloud_llm" | "tool"
 *   channel: provider name (cloud_llm) | egress channel (tool)
 */
export function buildEgressEvent(fields = {}) {
  const ev = { type: "egress", kind: fields.kind, channel: fields.channel };
  if (fields.provider) ev.provider = fields.provider;
  if (fields.model) ev.model = fields.model;
  if (fields.tool) ev.tool = fields.tool;
  if (fields.sessionId) ev.session_id = fields.sessionId;
  if (fields.turn != null) ev.turn = fields.turn;
  if (fields.tokens != null) ev.tokens = fields.tokens;
  return ev;
}

/**
 * Compute the egress events for one completed turn (cloud-LLM call + any
 * egress-classed tools). Pure over its inputs; the caller decides whether to
 * emit (PDH-gated). Returns [] when nothing left the device — the honest
 * "0 条出境" case (a fully local turn with only on-device tools).
 *
 * @param {object} p
 * @param {string} p.provider  effective provider used for this turn
 * @param {string} [p.baseUrl] effective baseUrl (localhost/LAN → not cloud)
 * @param {string} [p.model]   effective model
 * @param {Array<{tool:string}>} [p.toolCalls] tools executed this turn
 * @param {object} [p.usage]   { input_tokens, output_tokens } magnitude proxy
 * @param {string} [p.sessionId]
 * @param {number} [p.turn]
 * @returns {Array<object>} egress events (possibly empty)
 */
export function turnEgressEvents({
  provider,
  baseUrl,
  model,
  toolCalls = [],
  usage = null,
  sessionId = null,
  turn = null,
} = {}) {
  const events = [];
  if (isCloudProvider(provider, baseUrl)) {
    events.push(
      buildEgressEvent({
        kind: "cloud_llm",
        channel: provider,
        provider,
        model,
        sessionId,
        turn,
        tokens: usage
          ? (usage.input_tokens || 0) + (usage.output_tokens || 0)
          : null,
      }),
    );
  }
  for (const call of Array.isArray(toolCalls) ? toolCalls : []) {
    const channel = classifyEgressTool(call?.tool);
    if (channel) {
      events.push(
        buildEgressEvent({
          kind: "tool",
          channel,
          tool: call.tool,
          sessionId,
          turn,
        }),
      );
    }
  }
  return events;
}
