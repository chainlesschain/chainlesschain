// Configured probe coverage is not evidence that a workflow passed. Admission
// stays separate from both probe configuration and the experimental allowlist.
export const CODEX_APP_SERVER_PROTOCOL = "codex-app-server-experimental-v1";
export const CODEX_APP_SERVER_FEATURE_FLAG = "CC_EXPERIMENTAL_CODEX_APP_SERVER";
export const CODEX_APP_SERVER_FALLBACK_PROTOCOL = "codex-exec-jsonl-v1";

export const CODEX_APP_SERVER_SUPPORT = Object.freeze({
  revision: "2026-10-28",
  defaultEnabled: false,
  productionAdmitted: false,
  platforms: Object.freeze([
    Object.freeze({ platform: "linux", runner: "ubuntu-latest" }),
    Object.freeze({ platform: "windows", runner: "windows-latest" }),
    Object.freeze({ platform: "macos", runner: "macos-latest" }),
  ]),
  versions: Object.freeze([
    ...["0.149.0", "0.150.0", "0.150.1", "0.154.0"].map((version) =>
      Object.freeze({
        version,
        experimentalAllowed: true,
        compatibilityProbeConfigured: true,
        schemaAndTurnProbeConfigured: false,
      }),
    ),
    Object.freeze({
      version: "0.160.0",
      experimentalAllowed: false,
      compatibilityProbeConfigured: false,
      schemaAndTurnProbeConfigured: true,
    }),
  ]),
});

export const CODEX_APP_SERVER_COMPATIBILITY_MATRIX = Object.freeze(
  CODEX_APP_SERVER_SUPPORT.versions
    .filter((entry) => entry.experimentalAllowed)
    .map(({ version }) => Object.freeze({ version })),
);

export const CODEX_APP_SERVER_SCHEMA_PROBE_VERSION =
  CODEX_APP_SERVER_SUPPORT.versions.find(
    (entry) => entry.schemaAndTurnProbeConfigured,
  ).version;

export function parseCodexVersion(value) {
  const match = String(value || "")
    .trim()
    .match(/^(?:codex(?:-cli)?\s+)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u);
  return match ? match.slice(1).join(".") : null;
}

export function getCodexAppServerSupport(version) {
  const upstreamVersion = parseCodexVersion(version);
  const entry = CODEX_APP_SERVER_SUPPORT.versions.find(
    (candidate) => candidate.version === upstreamVersion,
  );
  return Object.freeze({
    manifestRevision: CODEX_APP_SERVER_SUPPORT.revision,
    upstreamVersion,
    knownVersion: Boolean(entry),
    defaultEnabled: CODEX_APP_SERVER_SUPPORT.defaultEnabled,
    productionAdmitted: CODEX_APP_SERVER_SUPPORT.productionAdmitted,
    experimentalAllowed: entry?.experimentalAllowed === true,
    compatibilityProbeConfigured: entry?.compatibilityProbeConfigured === true,
    schemaAndTurnProbeConfigured: entry?.schemaAndTurnProbeConfigured === true,
  });
}

export function codexAppServerCiMatrices() {
  const entries = (predicate) => ({
    include: CODEX_APP_SERVER_SUPPORT.versions
      .filter(predicate)
      .flatMap(({ version }) =>
        CODEX_APP_SERVER_SUPPORT.platforms.map(({ platform, runner }) => ({
          platform,
          runner,
          codex_version: version,
        })),
      ),
  });
  return {
    compatibility: entries((entry) => entry.compatibilityProbeConfigured),
    schema: entries((entry) => entry.schemaAndTurnProbeConfigured),
  };
}
