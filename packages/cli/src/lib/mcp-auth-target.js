/**
 * mcp-auth-target — resolve a `cc mcp login|logout <target>` argument.
 *
 * Claude-Code 2.1.186 parity: `mcp login <name>` / `mcp logout <name>` accept
 * the NAME of a configured MCP server, not only a raw URL. A `target` that
 * already looks like a `scheme://…` URL is used verbatim (fast path — no DB
 * needed); otherwise it is treated as a configured-server name and resolved to
 * its stored url via the injected `lookupServer(name)` callback.
 *
 * Pure (no DB / IO of its own) so it is unit-testable; the caller supplies the
 * `lookupServer` resolver (DB-backed in the command, a stub in tests).
 */

/** A `scheme://` URL (http, https, …) — not a bare host or a server name. */
export function isUrlLike(s) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(String(s || "").trim());
}

/**
 * Resolve a login/logout target to a concrete server URL.
 *
 * @param {string} target  a URL or a configured MCP server name
 * @param {(name: string) => ({ name?: string, url?: string|null,
 *   transport?: string }|null)} [lookupServer]  name → server config (or null)
 * @returns {{ url: string, name: string|null, source: "url"|"config" }}
 * @throws {Error} when target is empty, names an unknown server, or names a
 *   server that has no http(s) url (stdio servers cannot do OAuth login)
 */
export function resolveMcpAuthTarget(target, lookupServer) {
  const t = typeof target === "string" ? target.trim() : "";
  if (!t) {
    throw new Error("a server URL or configured server name is required");
  }
  if (isUrlLike(t)) {
    return { url: t, name: null, source: "url" };
  }
  const server = typeof lookupServer === "function" ? lookupServer(t) : null;
  if (!server) {
    throw new Error(
      `no configured MCP server named "${t}" (and it is not a URL) — ` +
        `run "cc mcp servers" to list, or pass the full https:// URL`,
    );
  }
  const url = server.url || null;
  if (!url || !isUrlLike(url)) {
    throw new Error(
      `configured server "${t}" has no http(s) URL (transport: ` +
        `${server.transport || "stdio"}); OAuth login only applies to remote ` +
        `http/sse MCP servers`,
    );
  }
  return { url, name: server.name || t, source: "config" };
}
