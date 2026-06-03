/**
 * Phase 5a: cc pack check-update — manifest-based version check for packed exes.
 *
 * Unlike `cc update` (which runs `npm install -g chainlesschain@<v>`), a packed
 * exe has no Node/npm to rely on. Instead, we publish a small JSON manifest at
 * a known URL and have the exe fetch + compare + surface the diff. Download +
 * self-replace are the job of Phase 5b/5c; this module only does the check.
 *
 * See docs/design/CC_PACK_打包指令设计文档.md §17.5-17.7.
 *
 * The expected manifest shape is:
 *   {
 *     schema: 1,
 *     channel: "stable" | "beta",
 *     latest: {
 *       cliVersion: "0.157.0",
 *       productVersion: "v5.0.3.0",
 *       publishedAt: "2026-04-25T00:00:00Z",
 *       releaseNotes: "https://…",
 *       artifacts: [{ target, url, sha256 }, …]
 *     }
 *   }
 *
 * `target` matches pkg's `node20-<os>-<arch>` convention.
 */

import semver from "semver";

const SUPPORTED_SCHEMA = 1;
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Fetch a manifest URL and compare against the current version.
 *
 * @param {object} ctx
 * @param {string} ctx.manifestUrl          absolute http(s) URL
 * @param {string} ctx.currentVersion       e.g. BAKED.packedCliVersion or VERSION
 * @param {string} [ctx.target]             e.g. "node20-win-x64"; if set, the
 *                                          returned artifact matches it
 * @param {number} [ctx.timeoutMs=10000]
 * @param {typeof fetch} [ctx.fetchImpl]    injected for tests
 * @returns {Promise<{
 *   updateAvailable: boolean,
 *   currentVersion: string,
 *   latestVersion: string,
 *   artifact: {target:string,url:string,sha256:string}|null,
 *   releaseNotes: string|null,
 *   channel: string,
 *   publishedAt: string|null,
 * }>}
 */
export async function checkPackUpdate(ctx) {
  const {
    manifestUrl,
    currentVersion,
    target,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = fetch,
  } = ctx;

  if (!manifestUrl || typeof manifestUrl !== "string") {
    throw new PackUpdateError("manifestUrl is required", "NO_MANIFEST_URL");
  }
  if (!currentVersion || typeof currentVersion !== "string") {
    throw new PackUpdateError(
      "currentVersion is required",
      "NO_CURRENT_VERSION",
    );
  }

  let body;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(manifestUrl, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new PackUpdateError(
          `manifest fetch failed: HTTP ${response.status}`,
          "FETCH_FAILED",
        );
      }
      body = await response.text();
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    if (err instanceof PackUpdateError) throw err;
    const kind = err?.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR";
    throw new PackUpdateError(`manifest fetch failed: ${err.message}`, kind);
  }

  let manifest;
  try {
    manifest = JSON.parse(body);
  } catch (err) {
    throw new PackUpdateError(
      `manifest JSON parse failed: ${err.message}`,
      "PARSE_FAILED",
    );
  }

  return parseAndCompare(manifest, { currentVersion, target });
}

/**
 * Pure parser — separated so tests can pass a manifest object directly
 * without stubbing fetch.
 *
 * @param {object} manifest
 * @param {object} ctx
 * @param {string} ctx.currentVersion
 * @param {string} [ctx.target]
 */
export function parseAndCompare(manifest, ctx) {
  const { currentVersion, target } = ctx;

  if (!manifest || typeof manifest !== "object") {
    throw new PackUpdateError("manifest must be an object", "SCHEMA_MISMATCH");
  }
  if (manifest.schema !== SUPPORTED_SCHEMA) {
    throw new PackUpdateError(
      `unsupported manifest schema ${manifest.schema} (expected ${SUPPORTED_SCHEMA})`,
      "SCHEMA_MISMATCH",
    );
  }
  const latest = manifest.latest;
  if (!latest || typeof latest.cliVersion !== "string") {
    throw new PackUpdateError(
      "manifest.latest.cliVersion missing",
      "SCHEMA_MISMATCH",
    );
  }

  const latestVersion = latest.cliVersion;
  if (!semver.valid(latestVersion)) {
    throw new PackUpdateError(
      `manifest.latest.cliVersion "${latestVersion}" is not a valid semver`,
      "INVALID_VERSION",
    );
  }
  if (!semver.valid(currentVersion)) {
    throw new PackUpdateError(
      `currentVersion "${currentVersion}" is not a valid semver`,
      "INVALID_VERSION",
    );
  }

  const updateAvailable = semver.gt(latestVersion, currentVersion);

  let artifact = null;
  if (target && Array.isArray(latest.artifacts)) {
    artifact =
      latest.artifacts.find(
        (a) => a && typeof a.target === "string" && a.target === target,
      ) || null;
  }

  return {
    updateAvailable,
    currentVersion,
    latestVersion,
    artifact,
    releaseNotes:
      typeof latest.releaseNotes === "string" ? latest.releaseNotes : null,
    channel: typeof manifest.channel === "string" ? manifest.channel : "stable",
    publishedAt:
      typeof latest.publishedAt === "string" ? latest.publishedAt : null,
  };
}

/**
 * Typed error with a machine-readable `code`. The `cc pack check-update`
 * command turns these into friendly messages and non-zero exit codes.
 */
export class PackUpdateError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "PackUpdateError";
    this.code = code;
  }
}
