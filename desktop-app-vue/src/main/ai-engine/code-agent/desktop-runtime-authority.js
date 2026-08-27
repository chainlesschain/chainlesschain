"use strict";

const {
  createRuntimeGraphCutoverAuthorityResolver,
} = require("../../../../../packages/cli/src/lib/graph-kernel/cutover-authority-resolver.js");
const graphRuntimeSurfaceManifest = require("../../../../../packages/cli/src/lib/graph-kernel/graph-runtime-surfaces.json");

const DESKTOP_GRAPH_MODES = Object.freeze(["legacy", "shadow", "canonical"]);
const DESKTOP_ENTRYPOINTS = Object.freeze([
  ["AIEngineManagerP1.", "desktop-legacy-ai-engine"],
  ["AIEngineManagerOptimized.", "desktop-legacy-ai-engine"],
  ["AIEngineManager.", "desktop-legacy-ai-engine"],
  ["TaskPlannerEnhanced.", "desktop-legacy-ai-engine"],
  ["TaskPlanner.", "desktop-legacy-ai-engine"],
  ["CheckpointValidator.", "desktop-legacy-ai-engine"],
  ["SelfCorrectionLoop.", "desktop-legacy-ai-engine"],
  ["PerformanceMonitor.", "desktop-legacy-ai-engine"],
  ["AutonomousAgentRunner.", "desktop-autonomous-agent"],
  ["AgentTaskQueue.", "desktop-autonomous-agent"],
  ["LongRunningTaskManager.", "desktop-long-running-task"],
  ["TeammateTool.", "desktop-legacy-cowork-team"],
  ["AgentPool.", "desktop-legacy-cowork-team"],
  ["PipelineOrchestrator.", "desktop-dev-pipeline"],
  ["DeployAgent.", "desktop-dev-pipeline"],
  ["PostDeployMonitor.", "desktop-dev-pipeline"],
  ["AutoRemediator.", "desktop-autonomous-ops"],
  ["RollbackManager.", "desktop-autonomous-ops"],
  ["HybridExecutor.", "desktop-hybrid-executor"],
  ["P2PAgentNetwork.", "desktop-p2p-agent"],
  ["CrossOrgTaskRouter.", "desktop-p2p-agent"],
  ["WorkflowPipeline.", "desktop-workflow-manager"],
  ["AgentCoordinator.", "desktop-specialized-agents"],
  ["AgentOrchestrator.", "desktop-legacy-multi-agent"],
  ["SkillPipelineEngine.", "desktop-skill-workflow"],
  ["SkillWorkflowEngine.", "desktop-skill-workflow"],
  ["WorkflowAutomation.", "desktop-skill-workflow"],
  ["WorkflowEngine.", "desktop-legacy-workflow"],
]);
const resolverCache = new Map();

function fallbackMode(env) {
  const mode = String(env.CHAINLESSCHAIN_GRAPH_DESKTOP || "legacy")
    .trim()
    .toLowerCase();
  if (!DESKTOP_GRAPH_MODES.includes(mode)) {
    const error = new Error(
      "CHAINLESSCHAIN_GRAPH_DESKTOP must be legacy, shadow, or canonical",
    );
    error.code = "CC_GRAPH_AUTHORITY_MODE_INVALID";
    throw error;
  }
  return mode;
}

function entryIdFor(entrypoint) {
  const value = String(entrypoint || "");
  return DESKTOP_ENTRYPOINTS.find(([prefix]) => value.startsWith(prefix))?.[1];
}

function retirementContractFor(entryId) {
  if (!entryId) return null;
  const desktop = graphRuntimeSurfaceManifest.surfaces.find(
    (surface) => surface.originSurface === "desktop",
  );
  const entry = desktop?.entries.find((candidate) => candidate.id === entryId);
  if (!entry) return null;
  const replacementTargets = (entry.replacementEntryIds || []).map(
    (replacementEntryId) => {
      for (const surface of graphRuntimeSurfaceManifest.surfaces || []) {
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

function desktopGraphAuthorityMode(env = process.env, options = {}) {
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
        surface: "desktop",
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
  if (!DESKTOP_GRAPH_MODES.includes(mode)) {
    const error = new Error(
      "Desktop Graph authority resolver returned an invalid mode",
    );
    error.code = "CC_GRAPH_AUTHORITY_MODE_INVALID";
    throw error;
  }
  return mode;
}

function desktopLegacyRuntimeReadOnly(env = process.env, options = {}) {
  return (
    desktopGraphAuthorityMode(env, options) === "canonical" ||
    String(env.CHAINLESSCHAIN_DESKTOP_LEGACY_READ_ONLY || "") === "1"
  );
}

function assertDesktopLegacyMutationAllowed(
  entrypoint,
  env = process.env,
  options = {},
) {
  const entryId = options.entryId || entryIdFor(entrypoint);
  const mode =
    options.authorityMode ||
    desktopGraphAuthorityMode(env, {
      ...options,
      entryId,
    });
  if (
    mode !== "canonical" &&
    String(env.CHAINLESSCHAIN_DESKTOP_LEGACY_READ_ONLY || "") !== "1"
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
  const error = new Error(
    `Desktop legacy runtime is read-only; '${entrypoint}' must use ${replacementEntrypoint || "the fixed Graph App Server adapter"}`,
  );
  error.name = "DesktopRuntimeAuthorityError";
  error.code = "CC_DESKTOP_LEGACY_RUNTIME_READ_ONLY";
  error.entrypoint = String(entrypoint);
  error.entryId = entryId;
  error.replacementEntrypoint = replacementEntrypoint;
  error.replacementEntryIds = retirementContract?.replacementEntryIds || [];
  error.historicalReadFunctions =
    retirementContract?.historicalReadFunctions || [];
  error.replacementTargets = retirementContract?.replacementTargets || [];
  error.authorityMode = "canonical";
  error.authoritySource = "graph_kernel";
  throw error;
}

function desktopLegacyRuntimeClaims(env = process.env, options = {}) {
  const mode = desktopGraphAuthorityMode(env, options);
  const readOnly = desktopLegacyRuntimeReadOnly(env, options);
  return Object.freeze({
    surface: "desktop",
    originSurface: "desktop",
    authorityMode: mode,
    authoritySource:
      mode === "canonical"
        ? "graph_kernel"
        : mode === "shadow"
          ? "graph_kernel_shadow"
          : "legacy_runtime",
    execution: readOnly ? "designer-only" : "legacy",
    persistence: "legacy",
    legacyReadOnly: readOnly,
  });
}

module.exports = {
  DESKTOP_GRAPH_MODES,
  assertDesktopLegacyMutationAllowed,
  desktopGraphAuthorityMode,
  desktopLegacyRuntimeClaims,
  desktopLegacyRuntimeReadOnly,
};
