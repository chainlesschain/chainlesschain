import { graphDigest } from "./compiler.js";
import {
  GRAPH_AUTHORITY_MODES,
  GraphRunAuthorityRegistry,
  createGraphAuthorityBinding,
} from "./authority.js";

export const GRAPH_RUNTIME_SURFACES = Object.freeze([
  "cli_team",
  "cowork",
  "scheduler",
  "desktop",
  "browser",
]);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function contractError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "GraphRuntimeAdapterError";
  error.code = code;
  Object.assign(error, details);
  return error;
}

export function validateRuntimeClaims(claims) {
  const errors = [];
  const originSurface = claims?.originSurface || claims?.surface;
  if (!GRAPH_RUNTIME_SURFACES.includes(originSurface)) {
    errors.push("originSurface must identify a known execution plane");
  }
  if (
    claims?.originSurface &&
    claims?.surface &&
    claims.originSurface !== claims.surface
  ) {
    errors.push("surface compatibility alias must match originSurface");
  }
  if (!new Set(["real", "simulated", "planned"]).has(claims?.execution)) {
    errors.push("execution must be real, simulated, or planned");
  }
  if (!new Set(["durable", "non_durable"]).has(claims?.persistence)) {
    errors.push("persistence must be durable or non_durable");
  }
  if (typeof claims?.isolated !== "boolean") {
    errors.push("isolated must be explicit");
  }
  if (typeof claims?.terminalEvidence !== "boolean") {
    errors.push("terminalEvidence must be explicit");
  }
  if (
    !Array.isArray(claims?.authorityModes) ||
    claims.authorityModes.length === 0 ||
    claims.authorityModes.some((mode) => !GRAPH_AUTHORITY_MODES.includes(mode))
  ) {
    errors.push(
      "authorityModes must declare supported per-run authority modes",
    );
  }
  if (claims?.authoritative === true) {
    errors.push(
      "authoritative is not a surface claim; authority must be bound per GraphRun",
    );
  }
  if (originSurface === "browser") {
    if (
      claims.persistence !== "non_durable" &&
      claims.restartHydration !== true
    ) {
      errors.push("browser may claim durable only with restart hydration");
    }
    if (claims.persistence === "non_durable" && claims.featureGated !== true) {
      errors.push("non-durable browser runtime must remain feature-gated");
    }
  }
  if (
    claims?.authorityModes?.includes("canonical") &&
    (claims.execution !== "real" ||
      claims.persistence !== "durable" ||
      claims.terminalEvidence !== true)
  ) {
    errors.push(
      "canonical authority requires real durable evidence-bound execution",
    );
  }
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
  });
}

export class GraphRuntimeAdapterRegistry {
  constructor({ authorityRegistry = new GraphRunAuthorityRegistry() } = {}) {
    this.adapters = new Map();
    this.authorityRegistry = authorityRegistry;
  }

  register(adapter) {
    if (typeof adapter?.runtimeClaims !== "function") {
      throw contractError(
        "CC_GRAPH_ADAPTER_CLAIMS_REQUIRED",
        "graph runtime adapter must publish machine-readable runtime claims",
      );
    }
    const claims = clone(adapter.runtimeClaims());
    claims.originSurface ||= claims.surface;
    claims.surface ||= claims.originSurface;
    const validation = validateRuntimeClaims(claims);
    if (!validation.valid) {
      throw contractError(
        "CC_GRAPH_ADAPTER_CLAIMS_INVALID",
        validation.errors.join("; "),
        { errors: validation.errors },
      );
    }
    if (this.adapters.has(claims.originSurface)) {
      throw contractError(
        "CC_GRAPH_ADAPTER_ALREADY_REGISTERED",
        `graph runtime adapter is already registered: ${claims.originSurface}`,
      );
    }
    this.adapters.set(claims.originSurface, {
      adapter,
      claims: Object.freeze(claims),
    });
    return this.claims(claims.originSurface);
  }

  claims(surface) {
    const entry = this.adapters.get(surface);
    return entry ? Object.freeze(clone(entry.claims)) : null;
  }

  listClaims() {
    return Object.freeze(
      [...this.adapters.values()]
        .map((entry) => clone(entry.claims))
        .sort((left, right) => left.surface.localeCompare(right.surface)),
    );
  }

  adapter(surface) {
    return this.adapters.get(surface)?.adapter || null;
  }

  bindRunAuthority(originSurface, input, options = {}) {
    const claims = this.claims(originSurface);
    if (!claims) {
      throw contractError(
        "CC_GRAPH_ADAPTER_NOT_REGISTERED",
        `graph runtime adapter is not registered: ${originSurface}`,
      );
    }
    const authorityMode = String(input?.authorityMode || "");
    if (!claims.authorityModes.includes(authorityMode)) {
      throw contractError(
        "CC_GRAPH_AUTHORITY_MODE_UNSUPPORTED",
        `${originSurface} does not support ${authorityMode} authority`,
      );
    }
    if (originSurface === "browser" && authorityMode === "canonical") {
      throw contractError(
        "CC_GRAPH_BROWSER_NON_DURABLE",
        "browser runtime cannot acquire canonical authority while non-durable",
      );
    }
    const authoritySource =
      authorityMode === "canonical"
        ? "graph_kernel"
        : authorityMode === "shadow"
          ? "graph_kernel_shadow"
          : "legacy_runtime";
    const binding = createGraphAuthorityBinding({
      ...input,
      originSurface,
      authorityMode,
      authoritySource,
    });
    return this.authorityRegistry.bind(binding, options);
  }

  runAuthority(logicalRunId) {
    return this.authorityRegistry.get(logicalRunId);
  }

  transitionSurface(originSurface, stage) {
    if (!this.adapters.has(originSurface)) {
      throw contractError(
        "CC_GRAPH_ADAPTER_NOT_REGISTERED",
        `graph runtime adapter is not registered: ${originSurface}`,
      );
    }
    return this.authorityRegistry.transition(originSurface, stage);
  }
}

function terminalProjection(value) {
  return {
    status: value.status,
    evidenceStatus: value.terminalEvidence?.status || null,
    eventDigest: value.terminalEvidence?.eventDigest || null,
    outputDigest: value.terminalEvidence?.outputDigest || null,
    artifactDigests: [...(value.artifacts || [])]
      .map((artifact) => artifact.digest)
      .filter(Boolean)
      .sort(),
    commit: value.terminalEvidence?.commit || null,
    testReceiptIds: [...(value.terminalEvidence?.testReceiptIds || [])].sort(),
  };
}

function causalProjection(events = []) {
  return events
    .map((event) => ({
      type: event.type,
      itemId: event.itemId || null,
      parentId: event.parentId || null,
      causationId: event.causationId || null,
      correlationId: event.correlationId || null,
      status: event.status || null,
    }))
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
}

export function compareGraphRuntimeShadow(legacy, canonical) {
  const left = {
    terminal: terminalProjection(legacy),
    causalEvents: causalProjection(legacy.events),
  };
  const right = {
    terminal: terminalProjection(canonical),
    causalEvents: causalProjection(canonical.events),
  };
  const terminalEquivalent =
    JSON.stringify(left.terminal) === JSON.stringify(right.terminal);
  const causalEquivalent =
    JSON.stringify(left.causalEvents) === JSON.stringify(right.causalEvents);
  const report = {
    schema: "chainlesschain.graph-runtime-shadow/v1",
    surface: legacy.surface,
    terminalEquivalent,
    causalEquivalent,
    equivalent: terminalEquivalent && causalEquivalent,
    left,
    right,
  };
  return Object.freeze({
    ...report,
    reportDigest: graphDigest(report, "cc.graph.runtime-shadow/v1"),
  });
}

export function assertRuntimeTerminalSuccess(result) {
  if (result?.status !== "succeeded") return result;
  const evidence = result.terminalEvidence;
  if (
    evidence?.status !== "succeeded" ||
    !/^sha256:[a-f0-9]{64}$/u.test(evidence?.eventDigest || "") ||
    !(
      /^sha256:[a-f0-9]{64}$/u.test(evidence?.outputDigest || "") ||
      (result.artifacts || []).some((artifact) =>
        /^sha256:[a-f0-9]{64}$/u.test(artifact?.digest || ""),
      ) ||
      evidence?.commit ||
      evidence?.testReceiptIds?.length
    )
  ) {
    throw contractError(
      "CC_GRAPH_TERMINAL_EVIDENCE_REQUIRED",
      "adapter success must bind a terminal event and immutable output evidence",
    );
  }
  return result;
}

export function assertGraphKernelCutover(
  shadowReports,
  { rollbackVerified = false, legacyWriteEntrypoints = [] } = {},
) {
  const failures = shadowReports.filter((report) => !report.equivalent);
  if (failures.length) {
    throw contractError(
      "CC_GRAPH_SHADOW_DIVERGENCE",
      "authoritative cutover is blocked by shadow projection differences",
      { surfaces: failures.map((report) => report.surface) },
    );
  }
  if (!rollbackVerified) {
    throw contractError(
      "CC_GRAPH_ROLLBACK_UNVERIFIED",
      "authoritative cutover requires a verified rollback exercise",
    );
  }
  if (legacyWriteEntrypoints.length) {
    throw contractError(
      "CC_GRAPH_LEGACY_WRITERS_REMAIN",
      "legacy shell write entrypoints must be removed before cutover",
      { legacyWriteEntrypoints: [...legacyWriteEntrypoints] },
    );
  }
  return Object.freeze({
    ready: true,
    surfaces: Object.freeze(
      shadowReports.map((report) => report.surface).sort(),
    ),
  });
}
