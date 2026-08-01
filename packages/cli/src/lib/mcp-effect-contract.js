/**
 * MCP effect contracts.
 *
 * MCP annotations are supplied by the server and remain hints. This module
 * preserves them verbatim in a normalized shape and classifies only the
 * server-declared effect. Source identity trust is recorded separately, but it
 * never turns the declaration into a host authorization. Plan-mode authority
 * requires a distinct host-owned per-tool policy that is intentionally not
 * minted by this module.
 */

export const MCP_EFFECT_CONTRACT_VERSION = 1;

function explicitBoolean(...values) {
  for (const value of values) {
    if (typeof value === "boolean") return value;
  }
  return null;
}

export function normalizeMcpToolAnnotations(tool = {}) {
  const annotations =
    tool?.annotations && typeof tool.annotations === "object"
      ? tool.annotations
      : {};

  return Object.freeze({
    readOnlyHint: explicitBoolean(
      annotations.readOnlyHint,
      annotations.read_only_hint,
      tool.readOnlyHint,
      tool.read_only_hint,
      tool.isReadOnly,
      tool.is_read_only,
    ),
    destructiveHint: explicitBoolean(
      annotations.destructiveHint,
      annotations.destructive_hint,
      tool.destructiveHint,
      tool.destructive_hint,
    ),
    idempotentHint: explicitBoolean(
      annotations.idempotentHint,
      annotations.idempotent_hint,
      tool.idempotentHint,
      tool.idempotent_hint,
    ),
    openWorldHint: explicitBoolean(
      annotations.openWorldHint,
      annotations.open_world_hint,
      tool.openWorldHint,
      tool.open_world_hint,
    ),
  });
}

export function classifyMcpDeclaredEffect(annotations = {}) {
  if (annotations.destructiveHint === true) return "destructive";
  if (
    annotations.readOnlyHint === true &&
    annotations.destructiveHint !== true
  ) {
    return "read";
  }
  if (annotations.readOnlyHint === false) return "write";
  return "unknown";
}

function riskForEffect(effect, annotations) {
  if (effect === "destructive") return "high";
  if (effect === "read" && annotations.openWorldHint !== true) return "low";
  return "medium";
}

export function buildMcpEffectContract(
  tool,
  { sourceTrusted = false, provenance = "untrusted-mcp-server" } = {},
) {
  const annotations = normalizeMcpToolAnnotations(tool);
  const declaredEffect = classifyMcpDeclaredEffect(annotations);
  return Object.freeze({
    version: MCP_EFFECT_CONTRACT_VERSION,
    declaredEffect,
    authorizedEffect: null,
    riskLevel: riskForEffect(declaredEffect, annotations),
    sourceTrusted: sourceTrusted === true,
    provenance: String(provenance || "untrusted-mcp-server"),
    annotations,
  });
}

export function mcpEffectDescriptorFields(tool, options = {}) {
  const effectContract = buildMcpEffectContract(tool, options);
  return {
    // Presentation/scheduling hint only. Security gates must not consume this
    // without an independent host authorization.
    isReadOnly: effectContract.declaredEffect === "read",
    riskLevel: effectContract.riskLevel,
    mcpAnnotations: effectContract.annotations,
    effectContract,
  };
}
