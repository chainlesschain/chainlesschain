/**
 * Deterministic-headless manifest helpers (gap-analysis 2026-07-11,
 * docs/CLAUDE_CODE_CLI_GAP_ANALYSIS.md P0 "确定性 Headless").
 *
 * The stream-json init event carries a protocol version, whether this run
 * persists its session, which ambient customization sources are live, and
 * short digests of the resolved permission policy + tool surface — so a CI
 * caller can assert "same run shape" across invocations without diffing the
 * whole event stream.
 *
 * STREAM_PROTOCOL_VERSION mirrors packages/agent-sdk/src/protocol.ts
 * PROTOCOL_VERSION — a BREAKING stream-json change must bump both in the same
 * commit (see agent-sdk docs/PROTOCOL.md). Additive optional fields stay on
 * the current version.
 */

import crypto from "node:crypto";
import { createRequire } from "node:module";
import { PROTOCOL_MIN_VERSION } from "./capability-negotiation.js";

export const STREAM_PROTOCOL_VERSION = 1;

const _require = createRequire(import.meta.url);

function shortHash(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 16);
}

const sortedList = (v) =>
  [...new Set((Array.isArray(v) ? v : []).filter(Boolean))].sort();

// null = "no explicit list" (the default full tool set) — kept distinct from
// an explicit empty list so the digest can tell the two apart.
const sortedListOrNull = (v) => (Array.isArray(v) ? sortedList(v) : null);

/**
 * Digest of the resolved permission policy: permission mode + allow/deny tool
 * lists + settings permission rules. Stable across key order / duplicates so
 * two runs with the same effective policy produce the same digest.
 *
 * @param {object} p
 * @param {string} [p.permissionMode]
 * @param {string[]} [p.allowedTools]
 * @param {string[]} [p.disallowedTools]
 * @param {{allow?:string[],ask?:string[],deny?:string[]}|null} [p.permissionRules]
 * @returns {string} 16-hex-char sha256 prefix
 */
export function computePolicyDigest({
  permissionMode,
  allowedTools,
  disallowedTools,
  permissionRules,
} = {}) {
  const rules = permissionRules
    ? {
        allow: sortedList(permissionRules.allow),
        ask: sortedList(permissionRules.ask),
        deny: sortedList(permissionRules.deny),
      }
    : null;
  return shortHash({
    v: 1,
    permissionMode: permissionMode || "default",
    allowedTools: sortedListOrNull(allowedTools),
    disallowedTools: sortedList(disallowedTools),
    rules,
  });
}

/**
 * Digest of the tool surface exposed to the model (name set, order-independent).
 * @param {string[]} toolNames
 * @returns {string} 16-hex-char sha256 prefix
 */
export function computeToolsHash(toolNames) {
  return shortHash({ v: 1, tools: sortedListOrNull(toolNames) });
}

/**
 * Which ambient customization sources are LIVE for this run. Reflects the
 * kill-switch env vars (--safe-mode / --bare flip these) plus what the runner
 * actually wired. Under `--bare` this collapses to at most
 * ["settings-permissions"] (+ explicit MCP), which is the reproducibility
 * signal CI wants.
 *
 * @param {object} p
 * @param {object|null} [p.permissionRules]  resolved settings permission rules
 * @param {object|null} [p.settingsHooks]    resolved settings hooks
 * @param {boolean} [p.mcp]                  MCP surface enabled/connected
 * @param {string[]} [p.enabledToolNames]
 * @param {object} [p.env=process.env]
 * @returns {string[]}
 */
export function buildLoadedSources({
  permissionRules = null,
  settingsHooks = null,
  mcp = false,
  enabledToolNames = null,
  env = process.env,
} = {}) {
  const on = (k) => env[k] !== "0";
  // null tool list = "default full set" → run_skill is available.
  const skillToolAvailable =
    !Array.isArray(enabledToolNames) || enabledToolNames.includes("run_skill");
  const sources = [];
  if (permissionRules) sources.push("settings-permissions");
  if (settingsHooks) sources.push("settings-hooks");
  if (on("CC_PROJECT_MEMORY")) sources.push("project-memory");
  if (on("CC_MEMORY_INJECT")) sources.push("memory-recall");
  if (on("CC_SKILLS") && skillToolAvailable) {
    sources.push("skills");
  }
  if (on("CC_PLUGINS")) sources.push("plugins");
  if (mcp) sources.push("mcp");
  return sources;
}

/**
 * Machine-readable capability manifest for `cc agent --capabilities`:
 * everything a programmatic caller needs to know up front to drive this CLI
 * (protocol version, tool names, permission modes, IO formats, exit codes,
 * feature flags) without parsing --help text.
 */
export function buildAgentCapabilities() {
  let version = null;
  try {
    version = _require("../../package.json").version || null;
  } catch {
    /* manifest stays usable without a version */
  }
  const contract = _require("../runtime/coding-agent-contract-shared.cjs");
  const { HEADLESS_EXIT_CODES } = _require("./exit-codes.cjs");
  return {
    name: "chainlesschain-cli",
    version,
    protocol_version: STREAM_PROTOCOL_VERSION,
    // Oldest wire version this CLI can still negotiate down to (the N-1 in the
    // capability handshake, agent-sdk docs/PROTOCOL.md §1.3). At v1 there is no
    // older line shape, so min === current.
    min_protocol_version: PROTOCOL_MIN_VERSION,
    agent_tools: contract.listCodingAgentToolNames(),
    permission_modes: [
      "default",
      "manual",
      "auto",
      "dontAsk",
      "plan",
      "acceptEdits",
      "bypassPermissions",
    ],
    output_formats: ["text", "json", "stream-json"],
    input_formats: ["text", "stream-json"],
    exit_codes: HEADLESS_EXIT_CODES,
    features: {
      bare: true,
      safe_mode: true,
      ephemeral: true,
      background: true,
      worktree: true,
      checkpoint: true,
      json_schema_output: true,
      partial_messages: true,
      interactive_approvals: true,
      permission_prompt_tool: true,
      remote_control: true,
      // Additive protocol-v1 stream fields (agent-sdk docs/PROTOCOL.md §1.2.1):
      // every stream-json stdout line carries a monotonic `seq` and a
      // run-scoped `trace_id`, and tool_use/tool_result lines carry a pairing
      // `id` ("tu-<n>"). `trace_id` is caller-injectable (--trace-id /
      // CC_TRACE_ID) for end-to-end IDE ↔ CLI correlation.
      tool_use_id: true,
      event_seq: true,
      trace_id: true,
      mcp: {
        config_file: true,
        registry: true,
        tool_search: true,
        oauth: true,
        managed_allowlist: true,
      },
      sandbox_engines: ["docker", "bubblewrap"],
    },
  };
}
