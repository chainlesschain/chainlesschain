"use strict";

const MAX_MCP_RESOURCES = 20;
const DEFAULT_CACHE_MS = 30_000;

function bounded(value, limit) {
  return String(value ?? "")
    .trim()
    .slice(0, limit);
}

function compareText(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function parseMcpResourceCandidates(value, capturedAt = null) {
  let resources = value;
  if (typeof value === "string") {
    try {
      resources = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(resources)) return [];
  return resources
    .slice(0, MAX_MCP_RESOURCES)
    .map((resource) => {
      if (!resource || typeof resource !== "object") return null;
      const uri = bounded(resource.uri, 512);
      const server = bounded(resource.server, 128);
      if (!uri || !server) return null;
      const name = bounded(resource.name, 160) || null;
      const description = bounded(resource.description, 512) || null;
      const mimeType = bounded(resource.mimeType, 128) || null;
      return {
        kind: "mcp-resource",
        label: `MCP resource: ${name || uri}`,
        source: `mcp:${server}`,
        identity: uri,
        content: JSON.stringify({
          server,
          uri,
          name,
          description,
          mimeType,
        }),
        range: null,
        freshness: {
          state: "connected-catalog",
          capturedAt:
            typeof capturedAt === "string" ? capturedAt.slice(0, 64) : null,
        },
        autoReason: "resource advertised by a connected MCP server",
        refreshable: true,
      };
    })
    .filter(Boolean)
    .sort(
      (left, right) =>
        compareText(left.source, right.source) ||
        compareText(left.identity, right.identity),
    );
}

function createMcpResourceCandidateProvider({
  runCliText,
  getCommand,
  getCwd,
  now = Date.now,
  cacheMs = DEFAULT_CACHE_MS,
} = {}) {
  let cached = [];
  let expiresAt = 0;
  let inFlight = null;
  return async function getMcpResourceCandidates() {
    const current = Number(now()) || 0;
    if (current < expiresAt) return cached;
    if (inFlight) return inFlight;
    inFlight = Promise.resolve()
      .then(() =>
        runCliText({
          command: getCommand(),
          args: ["mcp", "resources", "--json"],
          cwd: getCwd(),
          timeoutMs: 5_000,
        }),
      )
      .then((text) =>
        parseMcpResourceCandidates(
          text,
          new Date(Number(now()) || 0).toISOString(),
        ),
      )
      .catch(() => [])
      .then((next) => {
        cached = next;
        expiresAt =
          (Number(now()) || 0) + Math.max(1_000, Number(cacheMs) || 0);
        return cached;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };
}

module.exports = {
  DEFAULT_CACHE_MS,
  createMcpResourceCandidateProvider,
  parseMcpResourceCandidates,
};
