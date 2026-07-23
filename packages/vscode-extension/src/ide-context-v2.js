/**
 * Versioned, content-free metadata envelope for IDE context reads.
 *
 * Workspace paths are reduced to a stable digest; source text and paths never
 * enter workspaceId. The same algorithm is mirrored by JetBrains and pinned to
 * a shared JSON fixture.
 */
const crypto = require("crypto");

const IDE_CONTEXT_SCHEMA = "cc-ide-context/v2";

function normalizeWorkspaceRoot(root) {
  const normalized = String(root || "")
    .trim()
    .replace(/\\/g, "/");
  if (normalized === "/") return normalized;
  if (/^[A-Za-z]:\/+$/.test(normalized)) {
    return `${normalized.slice(0, 2)}/`;
  }
  return normalized.replace(/\/+$/, "");
}

function workspaceId(workspaceRoots) {
  const canonical = [
    ...new Set(
      (Array.isArray(workspaceRoots) ? workspaceRoots : [])
        .map(normalizeWorkspaceRoot)
        .filter(Boolean),
    ),
  ]
    .sort()
    .join("\n");
  if (!canonical) return null;
  return `ws-${crypto
    .createHash("sha256")
    .update(canonical, "utf8")
    .digest("hex")
    .slice(0, 16)}`;
}

function buildIdeContextV2({
  workspaceRoots,
  documentUri,
  documentVersion,
  isDirty,
  permissionSource = "host-policy",
  freshnessState = "live-host",
  capturedAtMs = Date.now(),
} = {}) {
  const timestamp = Number.isFinite(Number(capturedAtMs))
    ? Number(capturedAtMs)
    : Date.now();
  return {
    schema: IDE_CONTEXT_SCHEMA,
    workspaceId: workspaceId(workspaceRoots),
    documentUri:
      typeof documentUri === "string" && documentUri ? documentUri : null,
    documentVersion:
      Number.isFinite(Number(documentVersion)) && documentVersion !== null
        ? Number(documentVersion)
        : null,
    isDirty: typeof isDirty === "boolean" ? isDirty : null,
    permissionSource:
      String(permissionSource || "")
        .trim()
        .slice(0, 96) || "host-policy",
    freshness: {
      state:
        String(freshnessState || "")
          .trim()
          .slice(0, 48) || "live-host",
      capturedAt: new Date(timestamp).toISOString(),
    },
  };
}

module.exports = {
  IDE_CONTEXT_SCHEMA,
  normalizeWorkspaceRoot,
  workspaceId,
  buildIdeContextV2,
};
