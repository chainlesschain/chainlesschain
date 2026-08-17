import { createHash } from "node:crypto";
import {
  EXECUTION_LOCATION,
  clampPermissionsForLocation,
  normalizeExecutionLocation,
  redactCredentialRefs,
} from "./execution-location.js";
import { canonicalJson } from "./scheduler-kernel/contract.js";

export const EXECUTION_LOCATION_BINDING_SCHEMA =
  "cc-execution-location-binding/v1";
export const EXECUTION_LOCATION_CATALOG_SCHEMA =
  "cc-execution-location-catalog/v1";
export const EXECUTION_LOCATION_HANDOFF_FACTS_SCHEMA =
  "cc-execution-location-handoff-facts/v1";
export const EXECUTION_LOCATION_HANDOFF_SCHEMA =
  "cc-execution-location-handoff/v1";
export const EXECUTION_LOCATION_TARGET_ATTESTATION_SCHEMA =
  "cc-execution-location-target-attestation/v1";

const FORBIDDEN_SECRET_KEYS = new Set([
  "apikey",
  "credentialvalue",
  "password",
  "privatekey",
  "secret",
  "token",
  "value",
]);
const NETWORK_POLICIES = new Set([
  "offline",
  "restricted",
  "unrestricted",
  "unknown",
]);
const SANDBOX_STRENGTHS = new Set(["strong", "partial", "none", "unknown"]);
const DATA_BOUNDARY_KINDS = new Set([
  "working-directory",
  "repository",
  "declared",
  "unknown",
]);
const HANDOFF_STRATEGIES = new Set(["commit", "stash", "patch", "none"]);
const CREDENTIAL_SOURCES = new Set([
  "config",
  "env",
  "environment",
  "keychain",
  "local-provider",
  "managed-secret",
  "none",
  "not-observed",
  "unknown",
]);

function stringValue(value, { max = 256, nullable = true } = {}) {
  if (value == null && nullable) return null;
  if (typeof value !== "string") throw new TypeError("expected a string");
  const output = value.trim();
  if (
    !output ||
    output.length > max ||
    [...output].some((character) => {
      const code = character.codePointAt(0);
      return code < 32 || code === 127;
    })
  ) {
    throw new TypeError(
      "string is empty, too long, or contains control characters",
    );
  }
  return output;
}

function safeString(value, options) {
  try {
    return stringValue(value, options);
  } catch {
    return null;
  }
}

function enumValue(value, allowed, fallback = "unknown") {
  const normalized = safeString(value)?.toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function containsForbiddenSecretMaterial(value, seen = new Set()) {
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return true;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.some((item) => containsForbiddenSecretMaterial(item, seen));
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_SECRET_KEYS.has(key.toLowerCase()) && child != null) {
      return true;
    }
    if (containsForbiddenSecretMaterial(child, seen)) return true;
  }
  return false;
}

function normalizeNames(values, { max = 64 } = {}) {
  const output = [];
  for (const value of Array.isArray(values) ? values : []) {
    const name = safeString(value, { max });
    if (name && /^[A-Za-z0-9_.:/@+-]+$/u.test(name) && !output.includes(name)) {
      output.push(name);
    }
  }
  return output.sort();
}

function normalizeDataBoundary(value) {
  const input = value && typeof value === "object" ? value : {};
  return {
    kind: enumValue(input.kind, DATA_BOUNDARY_KINDS),
    root: safeString(input.root, { max: 4096 }),
  };
}

function normalizeGitSource(value) {
  const input = value && typeof value === "object" ? value : {};
  return {
    root: safeString(input.root, { max: 4096 }),
    head: safeString(input.head, { max: 512 }),
    commit: safeString(input.commit, { max: 128 }),
  };
}

function normalizeCredentials(value) {
  if (containsForbiddenSecretMaterial(value)) {
    throw new TypeError(
      "credential values are forbidden in execution-location data",
    );
  }
  return redactCredentialRefs(value).map((credential) =>
    Object.freeze({
      name: safeString(credential.name),
      source: enumValue(credential.source, CREDENTIAL_SOURCES),
      scope: safeString(credential.scope),
    }),
  );
}

export function createExecutionLocationBinding(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("execution location binding input must be an object");
  }
  if (containsForbiddenSecretMaterial(input)) {
    throw new TypeError(
      "secret material is forbidden in execution-location data",
    );
  }
  const location = normalizeExecutionLocation(input.location);
  const requestedPermissions =
    input.permissions && typeof input.permissions === "object"
      ? input.permissions
      : {};
  const permissionGrant = clampPermissionsForLocation(
    location,
    requestedPermissions,
  );
  const cwd = safeString(input.source?.cwd, { max: 4096 });
  const git = normalizeGitSource(input.source?.git);
  const boundary = normalizeDataBoundary(input.policy?.dataBoundary);
  return Object.freeze({
    schema: EXECUTION_LOCATION_BINDING_SCHEMA,
    location,
    observedAt: safeString(input.observedAt, { max: 64 }),
    observed: input.observed === true,
    signals: Object.freeze(normalizeNames(input.signals)),
    source: Object.freeze({ cwd, git: Object.freeze(git) }),
    runtime: Object.freeze({
      platform: safeString(input.runtime?.platform, { max: 64 }),
      arch: safeString(input.runtime?.arch, { max: 64 }),
      nodeVersion: safeString(input.runtime?.nodeVersion, { max: 64 }),
      cliVersion: safeString(input.runtime?.cliVersion, { max: 64 }),
      tools: Object.freeze(normalizeNames(input.runtime?.tools)),
    }),
    model: Object.freeze({
      provider: safeString(input.model?.provider),
      name: safeString(input.model?.name),
      credentialSource: enumValue(
        input.model?.credentialSource,
        CREDENTIAL_SOURCES,
        "not-observed",
      ),
    }),
    credentials: Object.freeze(normalizeCredentials(input.credentials)),
    permissions: Object.freeze({
      status:
        input.permissions?.status === "declared" ? "declared" : "not-observed",
      ...permissionGrant,
    }),
    policy: Object.freeze({
      network: enumValue(input.policy?.network, NETWORK_POLICIES),
      sandbox: enumValue(input.policy?.sandbox, SANDBOX_STRENGTHS),
      dataBoundary: Object.freeze(boundary),
    }),
    extension:
      location === EXECUTION_LOCATION.CONTAINER ? "chainlesschain" : null,
    controlPlane: Object.freeze({
      remoteControl: "controls-local-execution-only",
    }),
  });
}

export function normalizeExecutionLocationBinding(value) {
  if (value?.schema !== EXECUTION_LOCATION_BINDING_SCHEMA) {
    throw new TypeError(
      `execution location binding must use ${EXECUTION_LOCATION_BINDING_SCHEMA}`,
    );
  }
  return createExecutionLocationBinding(value);
}

/** Stable target identity used across separate ambient observations. */
export function computeExecutionLocationTargetFactsDigest(value) {
  const binding = normalizeExecutionLocationBinding(value);
  const stable = { ...binding };
  delete stable.observedAt;
  return `sha256:${createHash("sha256")
    .update("chainlesschain.execution-location.target-facts.v1\0", "utf8")
    .update(canonicalJson(stable, "executionLocationTargetFacts"), "utf8")
    .digest("hex")}`;
}

/** Canonical target attestation shared by the source launcher and target store. */
export function createExecutionLocationTargetAttestation(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("execution location target attestation is invalid");
  }
  const profileDigest = stringValue(input.profileDigest, {
    max: 80,
    nullable: false,
  }).toLowerCase();
  const sourceSessionId = stringValue(input.sourceSessionId, {
    max: 256,
    nullable: false,
  });
  const sourceHeadHash = stringValue(input.sourceHeadHash, {
    max: 64,
    nullable: false,
  }).toLowerCase();
  const sourceEventCount = Number(input.sourceEventCount);
  const targetEvidenceId = stringValue(input.targetEvidenceId, {
    max: 256,
    nullable: false,
  });
  const baseCommit = stringValue(input.baseCommit, {
    max: 64,
    nullable: false,
  }).toLowerCase();
  const binding = normalizeExecutionLocationBinding(input.binding);
  if (
    !/^sha256:[a-f0-9]{64}$/u.test(profileDigest) ||
    !/^[a-f0-9]{64}$/u.test(sourceHeadHash) ||
    !Number.isSafeInteger(sourceEventCount) ||
    sourceEventCount < 1 ||
    !/^[a-f0-9]{40,64}$/u.test(baseCommit) ||
    binding.observed !== true ||
    binding.source.git.commit !== baseCommit
  ) {
    throw new TypeError("execution location target attestation is invalid");
  }
  const targetFactsDigest = computeExecutionLocationTargetFactsDigest(binding);
  const material = {
    schema: EXECUTION_LOCATION_TARGET_ATTESTATION_SCHEMA,
    profileDigest,
    handoff: {
      sourceSessionId,
      sourceHeadHash,
      sourceEventCount,
      targetEvidenceId,
      baseCommit,
    },
    binding,
    targetFactsDigest,
    verified: {
      ambientLocation: true,
      cwd: true,
      gitCommit: true,
      platform: true,
      arch: true,
      cliVersion: true,
      requiredTools: true,
      networkPolicy: false,
      sandboxStrength: false,
      credentialAvailability: false,
    },
    gaps: [
      "target-network-policy-not-remotely-attested",
      "target-sandbox-strength-not-remotely-attested",
      "target-credential-availability-not-remotely-attested",
    ],
  };
  return Object.freeze({
    ...material,
    attestationDigest: `sha256:${createHash("sha256")
      .update(
        "chainlesschain.execution-location.target-attestation.v1\0",
        "utf8",
      )
      .update(canonicalJson(material, "executionLocationTarget"), "utf8")
      .digest("hex")}`,
  });
}

const LOCATION_PROFILES = Object.freeze({
  [EXECUTION_LOCATION.LOCAL]: {
    label: "Local",
    executor: "local-process",
    launch: "available",
    resume: "available",
    startup: "immediate",
    continuity: "host-process-dependent",
    cost: "local-resource",
    connectors: ["local-files", "local-git"],
  },
  [EXECUTION_LOCATION.WSL]: {
    label: "WSL",
    executor: "wsl-fixed-cli-launcher",
    launch: "requires-configuration",
    resume: "requires-configuration",
    startup: "distro-profile-and-session-replica-required",
    continuity: "wsl-host-dependent",
    cost: "local-resource",
    connectors: ["wsl-files", "wsl-git"],
  },
  [EXECUTION_LOCATION.SSH]: {
    label: "SSH",
    executor: "strict-ssh-fixed-cli-launcher",
    launch: "requires-configuration",
    resume: "requires-configuration",
    startup: "target-and-auth-required",
    continuity: "remote-host-dependent",
    cost: "remote-host-dependent",
    connectors: ["ssh"],
  },
  [EXECUTION_LOCATION.CONTAINER]: {
    label: "Container",
    executor: "docker-fixed-cli-launcher",
    launch: "requires-configuration",
    resume: "requires-configuration",
    startup: "image-and-runtime-required",
    continuity: "container-lifecycle-dependent",
    cost: "runtime-dependent",
    connectors: ["docker"],
    extension: "chainlesschain",
  },
  [EXECUTION_LOCATION.CLOUD]: {
    label: "Cloud",
    executor: "self-hosted-handoff",
    launch: "requires-configuration",
    resume: "not-implemented",
    startup: "provider-and-auth-required",
    continuity: "provider-dependent",
    cost: "provider-dependent",
    connectors: ["self-hosted-cloud-handoff"],
  },
});

function catalogEntry(location, current) {
  const profile = LOCATION_PROFILES[location];
  const isCurrent = current.location === location;
  return Object.freeze({
    location,
    label: profile.label,
    availability: isCurrent
      ? "current"
      : profile.launch === "not-implemented"
        ? "unavailable"
        : "requires-configuration",
    current: isCurrent,
    extension: profile.extension || null,
    source: isCurrent ? current.source : null,
    supportedTools: isCurrent ? current.runtime.tools : Object.freeze([]),
    model: isCurrent
      ? current.model
      : Object.freeze({
          provider: null,
          name: null,
          credentialSource: "unknown",
        }),
    permissions: isCurrent
      ? current.permissions
      : Object.freeze({ status: "unknown" }),
    policy: isCurrent
      ? current.policy
      : Object.freeze({
          network: "unknown",
          sandbox: "unknown",
          dataBoundary: Object.freeze({ kind: "unknown", root: null }),
        }),
    startup: profile.startup,
    continuity: profile.continuity,
    cost: profile.cost,
    connectors: Object.freeze([...profile.connectors]),
    capabilities: Object.freeze({
      execute: isCurrent ? "available" : profile.launch,
      launch: profile.launch,
      resume: profile.resume,
      handoffPreview: "available",
    }),
    mechanism: profile.executor,
  });
}

export function buildExecutionLocationCatalog(binding) {
  const current = normalizeExecutionLocationBinding(binding);
  const locations = [
    EXECUTION_LOCATION.LOCAL,
    EXECUTION_LOCATION.WSL,
    EXECUTION_LOCATION.SSH,
    EXECUTION_LOCATION.CONTAINER,
    EXECUTION_LOCATION.CLOUD,
  ];
  return Object.freeze({
    schema: EXECUTION_LOCATION_CATALOG_SCHEMA,
    currentLocation: current.location,
    currentBinding: current,
    controlPlane: Object.freeze({
      remoteControl: Object.freeze({
        executionLocation: false,
        meaning:
          "remote UI control of execution that remains on the local host",
      }),
    }),
    locations: Object.freeze(
      locations.map((location) => catalogEntry(location, current)),
    ),
  });
}

function pushUnique(output, value) {
  if (!output.includes(value)) output.push(value);
}

function validDigest(value) {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
}

function validReference(value) {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._/@:+-]{2,255}$/u.test(value)
  );
}

export function buildExecutionLocationHandoffPreview(input = {}) {
  const source = normalizeExecutionLocationBinding(input.sourceBinding);
  const target = normalizeExecutionLocation(input.target);
  const facts =
    input.facts && typeof input.facts === "object" ? input.facts : {};
  const expectedAuthority =
    input.sourceAuthority && typeof input.sourceAuthority === "object"
      ? input.sourceAuthority
      : {};
  const blockers = [];
  const warnings = [];

  if (facts.schema !== EXECUTION_LOCATION_HANDOFF_FACTS_SCHEMA) {
    pushUnique(blockers, "handoff-facts-schema-invalid");
  }
  if (target === EXECUTION_LOCATION.UNKNOWN) {
    pushUnique(blockers, "target-location-unknown");
  }
  if (containsForbiddenSecretMaterial(facts)) {
    pushUnique(blockers, "credential-value-present");
  }

  const factsAuthority =
    facts.authority && typeof facts.authority === "object"
      ? facts.authority
      : {};
  const expectedSessionId = safeString(expectedAuthority.sessionId);
  const expectedHeadHash = safeString(expectedAuthority.headHash, { max: 64 });
  const expectedEventCount = Number(expectedAuthority.eventCount);
  const factsSessionId = safeString(factsAuthority.sessionId);
  const factsHeadHash = safeString(factsAuthority.headHash, { max: 64 });
  const factsEventCount = Number(factsAuthority.eventCount);
  const expectedAuthorityValid =
    expectedSessionId != null &&
    /^[a-f0-9]{64}$/u.test(expectedHeadHash || "") &&
    Number.isSafeInteger(expectedEventCount) &&
    expectedEventCount > 0;
  const factsAuthorityValid =
    factsSessionId != null &&
    /^[a-f0-9]{64}$/u.test(factsHeadHash || "") &&
    Number.isSafeInteger(factsEventCount) &&
    factsEventCount > 0;
  if (!expectedAuthorityValid || !factsAuthorityValid) {
    pushUnique(blockers, "session-authority-evidence-missing");
  } else if (
    factsSessionId !== expectedSessionId ||
    factsHeadHash !== expectedHeadHash ||
    factsEventCount !== expectedEventCount
  ) {
    pushUnique(blockers, "session-authority-evidence-mismatch");
  }

  const targetEvidence =
    facts.target && typeof facts.target === "object" ? facts.target : {};
  const crossingLocation = target !== source.location;
  if (
    crossingLocation &&
    (targetEvidence.configured !== true ||
      !validReference(targetEvidence.evidenceId))
  ) {
    pushUnique(blockers, "target-configuration-evidence-missing");
  }
  const targetNetwork = enumValue(
    targetEvidence.networkPolicy,
    NETWORK_POLICIES,
  );
  const targetSandbox = enumValue(
    targetEvidence.sandboxStrength,
    SANDBOX_STRENGTHS,
  );
  const targetBoundary = normalizeDataBoundary(targetEvidence.dataBoundary);
  if (crossingLocation && targetNetwork === "unknown") {
    pushUnique(blockers, "target-network-policy-unknown");
  }
  if (crossingLocation && targetSandbox === "unknown") {
    pushUnique(blockers, "target-sandbox-strength-unknown");
  }
  if (crossingLocation && targetBoundary.kind === "unknown") {
    pushUnique(blockers, "target-data-boundary-unknown");
  }

  const git = facts.git && typeof facts.git === "object" ? facts.git : {};
  const gitStatus = ["clean", "dirty"].includes(git.status)
    ? git.status
    : "unknown";
  const sourceCommit = safeString(source.source.git.commit, { max: 128 });
  const baseCommit = safeString(git.baseCommit, { max: 128 });
  const strategy = HANDOFF_STRATEGIES.has(facts.strategy?.kind)
    ? facts.strategy.kind
    : "none";
  const strategyRef = safeString(facts.strategy?.ref, { max: 256 });
  const strategyDigest = safeString(facts.strategy?.artifactDigest, {
    max: 80,
  });
  if (gitStatus === "unknown") {
    pushUnique(blockers, "git-state-unknown");
  } else if (!sourceCommit || baseCommit !== sourceCommit) {
    pushUnique(blockers, "git-base-commit-mismatch");
  } else if (gitStatus === "clean") {
    if (strategy !== "commit" || strategyRef !== sourceCommit) {
      pushUnique(blockers, "clean-worktree-commit-missing");
    }
  } else if (!(
    (strategy === "stash" && validReference(strategyRef)) ||
    (strategy === "patch" && validDigest(strategyDigest))
  )) {
    pushUnique(blockers, "dirty-worktree-without-stash-or-patch");
  }

  if (facts.summary?.included !== true || !validDigest(facts.summary?.digest)) {
    pushUnique(blockers, "session-summary-missing");
  }
  if (
    facts.permissions?.included !== true ||
    !validDigest(facts.permissions?.digest)
  ) {
    pushUnique(blockers, "permission-handoff-missing");
  }

  const artifacts = [];
  if (!Array.isArray(facts.artifacts)) {
    pushUnique(blockers, "artifact-inventory-missing");
  }
  for (const item of Array.isArray(facts.artifacts) ? facts.artifacts : []) {
    const name = safeString(item?.name);
    const digest = safeString(item?.digest, { max: 80 });
    if (name && validDigest(digest)) {
      artifacts.push(Object.freeze({ name, digest }));
    } else pushUnique(blockers, "artifact-evidence-invalid");
  }
  if (
    strategy === "patch" &&
    validDigest(strategyDigest) &&
    !artifacts.some((artifact) => artifact.digest === strategyDigest)
  ) {
    pushUnique(blockers, "patch-artifact-not-in-inventory");
  }
  if (!Array.isArray(facts.credentials)) {
    pushUnique(blockers, "credential-inventory-missing");
  }
  const credentials = containsForbiddenSecretMaterial(facts.credentials)
    ? []
    : normalizeCredentials(facts.credentials);
  const requiredCapabilities = normalizeNames(facts.requiredCapabilities);
  const evidencedCapabilities = normalizeNames(targetEvidence.capabilities);
  for (const capability of requiredCapabilities) {
    if (!evidencedCapabilities.includes(capability)) {
      pushUnique(blockers, `target-capability-unavailable:${capability}`);
    }
  }
  if (credentials.length > 0) {
    warnings.push(
      "credential references require target-side re-authorization; values are never transferred",
    );
  }

  return Object.freeze({
    schema: EXECUTION_LOCATION_HANDOFF_SCHEMA,
    allowed: blockers.length === 0,
    source: Object.freeze({
      location: source.location,
      sessionBindingSchema: source.schema,
      authority: Object.freeze({
        sessionId: expectedSessionId,
        headHash: expectedHeadHash,
        eventCount: Number.isSafeInteger(expectedEventCount)
          ? expectedEventCount
          : null,
      }),
      git: source.source.git,
      policy: source.policy,
    }),
    target: Object.freeze({
      location: target,
      configured: targetEvidence.configured === true,
      evidenceId: safeString(targetEvidence.evidenceId),
      networkPolicy: targetNetwork,
      sandboxStrength: targetSandbox,
      dataBoundary: Object.freeze(targetBoundary),
      capabilities: Object.freeze(evidencedCapabilities),
      evidenceAuthority: "operator-supplied-facts",
    }),
    transfer: Object.freeze({
      git: Object.freeze({
        status: gitStatus,
        baseCommit,
        strategy,
        ref: strategyRef,
        artifactDigest: strategyDigest,
      }),
      summaryDigest: validDigest(facts.summary?.digest)
        ? facts.summary.digest
        : null,
      permissionDigest: validDigest(facts.permissions?.digest)
        ? facts.permissions.digest
        : null,
      artifacts: Object.freeze(artifacts),
      credentialRefs: Object.freeze(credentials),
      credentialValuesTransferred: false,
    }),
    blockers: Object.freeze(blockers),
    warnings: Object.freeze(warnings),
  });
}
