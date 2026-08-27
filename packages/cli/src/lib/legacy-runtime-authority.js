import { createRuntimeGraphCutoverAuthorityResolver } from "./graph-kernel/cutover-authority-resolver.js";
import {
  graphRuntimeSurfaceEntry,
  loadGraphRuntimeSurfaceManifest,
} from "./graph-kernel/runtime-surface-manifest.js";

const AUTHORITY_MODES = new Set(["legacy", "shadow", "canonical"]);
const ENTRYPOINTS = Object.freeze([
  ["CLIAutonomousAgent.", "cli-legacy-autonomous"],
  ["Orchestrator.", "cli-legacy-orchestrate"],
]);
const resolverCache = new Map();
const runtimeManifest = loadGraphRuntimeSurfaceManifest();

function authorityError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "CLILegacyRuntimeAuthorityError";
  error.code = code;
  Object.assign(error, details);
  return error;
}

function fallbackMode(env) {
  const mode = String(env.CHAINLESSCHAIN_GRAPH_COWORK || "legacy")
    .trim()
    .toLowerCase();
  if (!AUTHORITY_MODES.has(mode)) {
    throw authorityError(
      "CC_GRAPH_AUTHORITY_MODE_INVALID",
      "CHAINLESSCHAIN_GRAPH_COWORK must be legacy, shadow, or canonical",
    );
  }
  return mode;
}

function entryIdFor(entrypoint) {
  const value = String(entrypoint || "");
  return ENTRYPOINTS.find(([prefix]) => value.startsWith(prefix))?.[1];
}

function retirementContractFor(entryId) {
  if (!entryId) return null;
  const entry = graphRuntimeSurfaceEntry(
    runtimeManifest,
    "cowork",
    entryId,
  ).entry;
  const replacementTargets = (entry.replacementEntryIds || []).map(
    (replacementEntryId) => {
      for (const surface of runtimeManifest.surfaces || []) {
        const target = (surface.entries || []).find(
          (candidate) => candidate.id === replacementEntryId,
        );
        if (!target) continue;
        return Object.freeze({
          entryId: target.id,
          originSurface: surface.originSurface,
          rolloutKey: target.rolloutKey,
          entrypoints: Object.freeze([...(target.entrypoints || [])]),
          recoveryEntrypoints: Object.freeze([
            ...(target.recoveryEntrypoints || []),
          ]),
        });
      }
      return null;
    },
  );
  return Object.freeze({
    replacementEntrypoint: entry.replacementEntrypoint || null,
    replacementEntryIds: Object.freeze([...(entry.replacementEntryIds || [])]),
    historicalReadFunctions: Object.freeze([
      ...(entry.historicalReadFunctions || []),
    ]),
    replacementTargets: Object.freeze(replacementTargets.filter(Boolean)),
  });
}

export function cliLegacyRuntimeAuthorityMode(env = process.env, options = {}) {
  const configured = fallbackMode(env);
  const entryId = options.entryId;
  if (!entryId) return configured;
  let resolver = options.resolver;
  if (!resolver) {
    const key = `${entryId}\0${configured}\0${
      env.CHAINLESSCHAIN_GRAPH_CUTOVER_STATE_DIR || ""
    }`;
    resolver = resolverCache.get(key);
    if (!resolver) {
      resolver = createRuntimeGraphCutoverAuthorityResolver({
        env,
        surface: "cowork",
        entryId,
        fallbackMode: configured,
      });
      resolverCache.set(key, resolver);
    }
  }
  const resolved =
    typeof resolver === "function"
      ? resolver({ runKey: options.runKey, optIn: options.optIn === true })
      : resolver.resolve({
          runKey: options.runKey,
          optIn: options.optIn === true,
          fallbackMode: configured,
        });
  const mode = typeof resolved === "string" ? resolved : resolved?.mode;
  if (!AUTHORITY_MODES.has(mode)) {
    throw authorityError(
      "CC_GRAPH_AUTHORITY_MODE_INVALID",
      "CLI legacy runtime authority resolver returned an invalid mode",
    );
  }
  return mode;
}

export function assertCLILegacyMutationAllowed(
  entrypoint,
  env = process.env,
  options = {},
) {
  const entryId = options.entryId || entryIdFor(entrypoint);
  const mode =
    options.authorityMode ||
    cliLegacyRuntimeAuthorityMode(env, { ...options, entryId });
  if (
    mode !== "canonical" &&
    String(env.CHAINLESSCHAIN_CLI_LEGACY_READ_ONLY || "") !== "1"
  ) {
    return Object.freeze({
      authorityMode: mode,
      authoritySource:
        mode === "shadow" ? "graph_kernel_shadow" : "legacy_runtime",
      legacyReadOnly: false,
    });
  }
  const retirementContract = retirementContractFor(entryId);
  const replacementEntrypoint = retirementContract?.replacementEntrypoint;
  throw authorityError(
    "CC_CLI_LEGACY_RUNTIME_READ_ONLY",
    `CLI legacy runtime is read-only; '${entrypoint}' must use ${replacementEntrypoint || "the canonical Graph Kernel entrypoint"}`,
    {
      entrypoint: String(entrypoint),
      entryId,
      replacementEntrypoint,
      replacementEntryIds: retirementContract?.replacementEntryIds || [],
      historicalReadFunctions:
        retirementContract?.historicalReadFunctions || [],
      replacementTargets: retirementContract?.replacementTargets || [],
      authorityMode: "canonical",
      authoritySource: "graph_kernel",
    },
  );
}

export function cliLegacyRuntimeReadOnly(env = process.env, options = {}) {
  return (
    cliLegacyRuntimeAuthorityMode(env, options) === "canonical" ||
    String(env.CHAINLESSCHAIN_CLI_LEGACY_READ_ONLY || "") === "1"
  );
}
