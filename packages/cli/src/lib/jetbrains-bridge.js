/**
 * JetBrains / IntelliJ IDEA built-in MCP discovery (cc-side).
 *
 * IntelliJ IDEA 2025.2+ ships a built-in MCP server (Settings | Tools | MCP
 * Server) exposing the IDE's own indexed operations (find usages, file-by-path,
 * search, run configs, VCS, …). Letting the agent call those instead of reading
 * and grepping files itself is cheaper (fewer tokens) and faster (rides the IDE
 * index) — that is the whole point of this bridge.
 *
 * Unlike our own ide/pdh bridges (ide-bridge.js / pdh-bridge.js), IDEA writes NO
 * discovery lockfile, so cc cannot scan for it. Instead the ChainlessChain
 * JetBrains plugin — which runs INSIDE the IDE and therefore knows whether MCP
 * is supported (IDE >= 2025.2) and enabled, and on which endpoint — injects the
 * exact endpoint into the env of the `cc agent` it spawns:
 *
 *     CHAINLESSCHAIN_JETBRAINS_MCP_URL    http://127.0.0.1:<port>/<path>
 *     CHAINLESSCHAIN_JETBRAINS_TOKEN      optional bearer token
 *     CHAINLESSCHAIN_JETBRAINS_TRANSPORT  optional: http | https | sse (else inferred)
 *
 * When the IDE does NOT support MCP (older than 2025.2) or it is disabled, the
 * plugin injects nothing -> cc connects nothing. This is the product decision:
 * if the IDE's MCP is unsupported, do not try to connect (no port scan, no
 * external proxy fallback). Reserved server name `idea` -> tools `mcp__idea__*`.
 *
 * Pure CLI, no network scan, no external dependency: a deterministic
 * env -> MCP-config mapping, fully unit-testable. The connect path reuses the
 * existing MCP client (Streamable-HTTP) via mcp-config.js `loadJetbrainsMcp`.
 */

/** Transports the CLI's MCP client can actually talk (see mcp-client.js). */
const SUPPORTED_TRANSPORTS = new Set(["http", "https", "sse"]);

/**
 * Only ever connect to a loopback endpoint. IDEA's built-in server binds
 * localhost; refusing anything else keeps an injected env var from pointing cc
 * at an arbitrary host. `new URL(...).hostname` strips the brackets from an
 * IPv6 literal on most Node builds but keeps them on some — accept both forms.
 */
function isLoopbackUrl(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return (
      h === "127.0.0.1" || h === "::1" || h === "[::1]" || h === "localhost"
    );
  } catch {
    return false;
  }
}

function inferTransportFromUrl(url) {
  if (/\/sse(\b|\/|$)/i.test(url)) return "sse";
  if (/^https:/i.test(url)) return "https";
  if (/^http:/i.test(url)) return "http";
  return null;
}

/**
 * Are we running under the ChainlessChain JetBrains plugin with IDE MCP
 * available? True iff the plugin injected an MCP URL — which it only does when
 * the IDE is >= 2025.2 and the MCP server is enabled. No URL = treat as
 * unsupported and stay out of the way.
 */
export function isInJetbrainsContext(env = process.env) {
  return !!(env && env.CHAINLESSCHAIN_JETBRAINS_MCP_URL);
}

/**
 * Resolve the IDEA built-in MCP server to connect to, or null.
 *
 * Deterministic: the plugin-injected `CHAINLESSCHAIN_JETBRAINS_MCP_URL` (a
 * loopback http/https/sse endpoint) is the single source of truth. A missing,
 * non-loopback, or unsupported-transport URL yields null (don't connect).
 *
 * @param {object} opts  { env? }
 * @returns {{url:string, transport:string, token:(string|null)}|null}
 */
export function discoverJetbrainsServer({ env = process.env } = {}) {
  const url = env && env.CHAINLESSCHAIN_JETBRAINS_MCP_URL;
  if (!url || !isLoopbackUrl(url)) return null;

  const transport = String(
    env.CHAINLESSCHAIN_JETBRAINS_TRANSPORT || inferTransportFromUrl(url) || "",
  ).toLowerCase();
  if (!SUPPORTED_TRANSPORTS.has(transport)) return null;

  return {
    url,
    transport,
    token:
      typeof env.CHAINLESSCHAIN_JETBRAINS_TOKEN === "string"
        ? env.CHAINLESSCHAIN_JETBRAINS_TOKEN
        : null,
  };
}

/**
 * A discovered server -> an MCP server config row for `setupMcpFromConfig`.
 * `longRunning` exempts it from the agent loop's per-call timeout (some IDE
 * operations — e.g. an indexing-gated search — can take a while), matching the
 * ide/pdh bridges.
 */
export function jetbrainsServerToMcpConfig(found) {
  if (!found || !found.url) return null;
  const headers = {};
  if (found.token) headers.Authorization = `Bearer ${found.token}`;
  return {
    url: found.url,
    transport: found.transport,
    headers,
    longRunning: true,
  };
}

/**
 * Human-readable explanation of why discovery did / didn't pick a server —
 * backs `cc ide jetbrains`. Never surfaces the raw token.
 */
export function diagnoseJetbrains({ env = process.env } = {}) {
  const rawUrl = (env && env.CHAINLESSCHAIN_JETBRAINS_MCP_URL) || null;
  const chosen = discoverJetbrainsServer({ env });

  let reason;
  if (chosen) {
    reason = "CHAINLESSCHAIN_JETBRAINS_MCP_URL injected by the IDE plugin";
  } else if (!rawUrl) {
    reason =
      "no CHAINLESSCHAIN_JETBRAINS_MCP_URL — IDE MCP is unsupported (IDEA < " +
      "2025.2) / disabled, or cc was not launched from the JetBrains plugin";
  } else if (!isLoopbackUrl(rawUrl)) {
    reason =
      "injected URL is not a loopback (127.0.0.1/::1/localhost) endpoint";
  } else {
    reason = "injected URL is not a supported transport (http/https/sse)";
  }

  return {
    supported: !!rawUrl,
    chosen: chosen
      ? {
          url: chosen.url,
          transport: chosen.transport,
          hasToken: !!chosen.token,
        }
      : null,
    reason,
  };
}
