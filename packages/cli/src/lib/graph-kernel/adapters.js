import { graphDigest } from "./compiler.js";

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
  if (!GRAPH_RUNTIME_SURFACES.includes(claims?.surface)) {
    errors.push("surface must identify a known execution plane");
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
  if (claims?.surface === "browser") {
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
    claims?.authoritative === true &&
    (claims.execution !== "real" ||
      claims.persistence !== "durable" ||
      claims.terminalEvidence !== true)
  ) {
    errors.push(
      "authoritative runtime requires real durable evidence-bound execution",
    );
  }
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
  });
}

export class GraphRuntimeAdapterRegistry {
  constructor() {
    this.adapters = new Map();
    this.authoritativeSurface = null;
  }

  register(adapter) {
    if (typeof adapter?.runtimeClaims !== "function") {
      throw contractError(
        "CC_GRAPH_ADAPTER_CLAIMS_REQUIRED",
        "graph runtime adapter must publish machine-readable runtime claims",
      );
    }
    const claims = clone(adapter.runtimeClaims());
    const validation = validateRuntimeClaims(claims);
    if (!validation.valid) {
      throw contractError(
        "CC_GRAPH_ADAPTER_CLAIMS_INVALID",
        validation.errors.join("; "),
        { errors: validation.errors },
      );
    }
    if (claims.authoritative) {
      if (
        this.authoritativeSurface &&
        this.authoritativeSurface !== claims.surface
      ) {
        throw contractError(
          "CC_GRAPH_MULTIPLE_AUTHORITATIVE_WRITERS",
          "only one Graph Kernel adapter may write authoritative run state",
        );
      }
      this.authoritativeSurface = claims.surface;
    }
    this.adapters.set(claims.surface, {
      adapter,
      claims: Object.freeze(claims),
    });
    return this.claims(claims.surface);
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
