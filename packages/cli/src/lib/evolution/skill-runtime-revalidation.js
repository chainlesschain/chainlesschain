import { createHash } from "node:crypto";
import { types } from "node:util";
import { captureSkillReleaseRegistryReader } from "./skill-release-registry.js";
import {
  verifySkillDependencyLock,
  verifySkillRuntimeManifest,
} from "./skill-execution-manifest.js";
import { captureSkillExecutionSnapshot } from "../skill-execution-identity.js";

export const SKILL_RUNTIME_STATE_SCHEMA =
  "chainlesschain.skill-runtime-state/v1";
export const SKILL_RUNTIME_EVALUATION_SCHEMA =
  "chainlesschain.skill-runtime-evaluation/v1";
export const SKILL_RUNTIME_STALE_CODE = "CC_SKILL_STALE_NEEDS_REVALIDATION";
export const SKILL_RUNTIME_STALE = "stale-needs-revalidation";
const admissions = new WeakSet();
const proofs = new WeakSet();
const loaderAdmissions = new WeakMap();
const requiredLoaders = new WeakSet();
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

export function runtimeCanonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(runtimeCanonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${runtimeCanonical(value[key])}`)
    .join(",")}}`;
}

export function digestSkillRuntimeValue(value) {
  return `sha256:${createHash("sha256").update("chainlesschain.skill-runtime/v1\0").update(runtimeCanonical(value)).digest("hex")}`;
}

function fail(message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = SKILL_RUNTIME_STALE_CODE;
  error.status = SKILL_RUNTIME_STALE;
  throw error;
}

function text(value, name) {
  if (typeof value !== "string" || !value.trim() || value.length > 1024)
    fail(`${name} is unknown`);
  return value;
}

function digest(value, name) {
  if (typeof value !== "string" || !DIGEST.test(value))
    fail(`${name} is unknown`);
  return value;
}

function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function exact(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    types.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some(
      (key) =>
        !Object.getOwnPropertyDescriptor(value, key)?.enumerable ||
        !("value" in Object.getOwnPropertyDescriptor(value, key)),
    )
  )
    fail(`${label} is invalid`);
}

const BINDING_KEYS = [
  "tenantId",
  "skillName",
  "activeStateDigest",
  "releaseDigest",
  "contentDigest",
  "filesystemDigest",
  "runtimeManifestDigest",
  "dependencyLockDigest",
  "runtimeId",
  "targetEnvironmentRef",
  "environmentDigest",
  "modelDigest",
  "toolDigest",
  "hostRuntimeDigest",
];

function binding(value) {
  exact(value, BINDING_KEYS, "runtime binding");
  for (const key of BINDING_KEYS) {
    if (key.endsWith("Digest")) digest(value[key], key);
    else text(value[key], key);
  }
  return freeze({ ...value });
}

export function verifySkillRuntimeEvaluation(value) {
  exact(
    value,
    [
      "schema",
      "evaluationId",
      "binding",
      "expectedEligibilityDigest",
      "passed",
      "evidenceDigest",
      "receiptDigest",
    ],
    "runtime evaluation",
  );
  if (value.schema !== SKILL_RUNTIME_EVALUATION_SCHEMA || value.passed !== true)
    fail("evaluation did not pass");
  const core = {
    schema: value.schema,
    evaluationId: text(value.evaluationId, "evaluationId"),
    binding: binding(value.binding),
    expectedEligibilityDigest: digest(
      value.expectedEligibilityDigest,
      "expectedEligibilityDigest",
    ),
    passed: true,
    evidenceDigest: digest(value.evidenceDigest, "evidenceDigest"),
  };
  if (digestSkillRuntimeValue(core) !== value.receiptDigest)
    fail("evaluation receipt digest differs");
  return freeze({ ...core, receiptDigest: value.receiptDigest });
}

export function verifySkillRuntimeState(value, tenantId, skillName) {
  exact(
    value,
    [
      "schema",
      "tenantId",
      "skillName",
      "revision",
      "previousStateDigest",
      "status",
      "binding",
      "reason",
      "evaluationReceipt",
      "stateDigest",
    ],
    "runtime state",
  );
  const { stateDigest, ...core } = value;
  if (
    core.schema !== SKILL_RUNTIME_STATE_SCHEMA ||
    core.tenantId !== tenantId ||
    core.skillName !== skillName ||
    !Number.isSafeInteger(core.revision) ||
    core.revision < 1 ||
    ![SKILL_RUNTIME_STALE, "eligible"].includes(core.status) ||
    digestSkillRuntimeValue(core) !== stateDigest
  )
    fail("runtime state bindings are invalid");
  if (core.previousStateDigest !== null)
    digest(core.previousStateDigest, "previousStateDigest");
  text(core.reason, "reason");
  if (core.binding !== null) binding(core.binding);
  if (core.status === "eligible") {
    const receipt = verifySkillRuntimeEvaluation(core.evaluationReceipt);
    if (
      !core.binding ||
      runtimeCanonical(receipt.binding) !== runtimeCanonical(core.binding) ||
      receipt.expectedEligibilityDigest !== core.previousStateDigest
    )
      fail("eligible state lacks exact evaluation evidence");
  } else if (core.evaluationReceipt !== null)
    fail("stale state cannot carry eligibility evidence");
  return freeze(structuredClone(value));
}

// The privileged controller owns persistence, a genuine registry reader and a
// deployment-owned evaluation verifier. Execution receives only admission.
// No caller-supplied `passed` / descriptor field can restore eligibility.
export function createSkillRuntimeRevalidationAuthority({
  releaseRegistry,
  persistence,
  resolveRuntime,
  verifyEvaluation,
} = {}) {
  const registry = captureSkillReleaseRegistryReader(releaseRegistry);
  if (
    typeof persistence?.load !== "function" ||
    typeof persistence?.commit !== "function" ||
    typeof resolveRuntime !== "function" ||
    typeof verifyEvaluation !== "function"
  ) {
    throw new TypeError(
      "runtime revalidation requires persistence, runtime and evaluation authority ports",
    );
  }
  const load = persistence.load.bind(persistence);
  const commit = persistence.commit.bind(persistence);
  const tenantId = registry.tenantId;
  function read(skillName) {
    const result = load({ tenantId, skillName });
    if (
      !result ||
      result.authenticated !== true ||
      result.durable !== true ||
      typeof result.found !== "boolean" ||
      result.found !== (result.state !== null)
    )
      fail("runtime state is unavailable");
    return result.found
      ? verifySkillRuntimeState(result.state, tenantId, skillName)
      : null;
  }
  function write(
    skillName,
    previous,
    status,
    observed,
    reason,
    receipt = null,
  ) {
    const core = {
      schema: SKILL_RUNTIME_STATE_SCHEMA,
      tenantId,
      skillName,
      revision: (previous?.revision ?? 0) + 1,
      previousStateDigest: previous?.stateDigest ?? null,
      status,
      binding: observed,
      reason,
      evaluationReceipt: receipt,
    };
    const state = verifySkillRuntimeState(
      { ...core, stateDigest: digestSkillRuntimeValue(core) },
      tenantId,
      skillName,
    );
    const result = commit({
      state,
      expectedStateDigest: previous?.stateDigest ?? null,
    });
    if (
      result?.authenticated !== true ||
      result.durable !== true ||
      result.committed !== true ||
      result.stateDigest !== state.stateDigest ||
      read(skillName)?.stateDigest !== state.stateDigest
    )
      fail("runtime state commit was not confirmed");
    return state;
  }
  function observe(skill, context, active) {
    const declared = skill.releaseBinding ?? skill.evolutionRelease ?? skill;
    for (const [key, expected] of [
      ["tenantId", tenantId],
      ["skillName", active.state.skillName],
      ["releaseDigest", active.release.releaseDigest],
      ["activeReleaseDigest", active.release.releaseDigest],
      ["activeStateDigest", active.state.stateDigest],
    ]) {
      if (declared[key] != null && declared[key] !== expected)
        fail("descriptor release binding differs from active release");
    }
    const runtime = resolveRuntime({
      tenantId,
      skillName: active.state.skillName,
      context,
    });
    if (!runtime || typeof runtime.then === "function")
      fail("current runtime is unknown");
    const manifest = verifySkillRuntimeManifest(runtime.runtimeManifest);
    const lock = verifySkillDependencyLock(runtime.dependencyLock);
    if (
      manifest.tenantId !== tenantId ||
      lock.tenantId !== tenantId ||
      !manifest.runtimes.some((entry) => entry.runtimeId === runtime.runtimeId)
    )
      fail("current runtime tenant or runtime is invalid");
    const model = context.llmOptions;
    text(model?.provider, "model provider");
    text(model?.model, "model identity");
    const toolNames = context.effectiveAllowedToolNames;
    if (
      !Array.isArray(toolNames) ||
      toolNames.some((name) => typeof name !== "string" || !name)
    )
      fail("current tool surface is unknown");
    const snapshot = captureSkillExecutionSnapshot({
      skillDir: skill.skillDir,
      skillId: active.state.skillName,
      source: skill.source,
    });
    const contentDigest = `sha256:${createHash("sha256").update(snapshot.skillMdContent, "utf8").digest("hex")}`;
    if (contentDigest !== active.release.contentDigest)
      fail("filesystem content differs from the active release");
    return binding({
      tenantId,
      skillName: active.state.skillName,
      activeStateDigest: active.state.stateDigest,
      releaseDigest: active.release.releaseDigest,
      contentDigest,
      filesystemDigest: snapshot.contentDigest,
      runtimeManifestDigest: manifest.runtimeManifestDigest,
      dependencyLockDigest: lock.dependencyLockDigest,
      runtimeId: runtime.runtimeId,
      targetEnvironmentRef: runtime.targetEnvironmentRef,
      environmentDigest: runtime.environmentDigest,
      modelDigest: digestSkillRuntimeValue({
        provider: model.provider,
        model: model.model,
        baseUrl: model.baseUrl ?? null,
      }),
      toolDigest: digestSkillRuntimeValue({
        names: [...new Set(toolNames)].sort(),
        manifestDigest: digest(
          runtime.toolManifestDigest,
          "toolManifestDigest",
        ),
      }),
      hostRuntimeDigest: digestSkillRuntimeValue({
        node: process.versions.node,
        platform: process.platform,
        arch: process.arch,
      }),
    });
  }
  function inspect({ skill, context = {} }) {
    const skillName = text(skill?.id || skill?.dirName, "skillName");
    const previous = read(skillName);
    let active;
    let observed = null;
    let reason = "runtime binding changed";
    try {
      active = registry.readActive(skillName);
      if (!active && !previous && !hasSkillReleaseBinding(skill))
        return Object.freeze({ governed: false, status: "unassessed" });
      if (!active) fail("active release is unknown");
      observed = observe(skill, context, active);
    } catch {
      reason = "active release or current runtime is unknown";
    }
    if (
      observed &&
      previous?.status === "eligible" &&
      runtimeCanonical(previous.binding) === runtimeCanonical(observed)
    ) {
      // Re-check trust on every execution; a persisted eligible flag alone is
      // insufficient after evaluator revocation or verifier failure.
      try {
        if (verifyEvaluation(previous.evaluationReceipt) === true) {
          const freshActive = registry.readActive(skillName);
          const freshBinding = observe(skill, context, freshActive);
          if (
            runtimeCanonical(freshBinding) !== runtimeCanonical(observed) ||
            read(skillName)?.stateDigest !== previous.stateDigest
          ) {
            observed = freshBinding;
            fail("runtime or active release changed during admission");
          }
          const proof = freeze({
            governed: true,
            status: "eligible",
            binding: observed,
            eligibilityDigest: previous.stateDigest,
          });
          proofs.add(proof);
          return proof;
        }
      } catch {
        /* Unknown trust is stale. */
      }
      reason = "evaluation authority is unavailable or revoked";
    }
    const state =
      previous?.status === SKILL_RUNTIME_STALE &&
      runtimeCanonical(previous.binding) === runtimeCanonical(observed) &&
      previous.reason === reason
        ? previous
        : write(skillName, previous, SKILL_RUNTIME_STALE, observed, reason);
    return freeze({
      governed: true,
      status: SKILL_RUNTIME_STALE,
      binding: observed,
      eligibilityDigest: state.stateDigest,
    });
  }
  const admission = Object.freeze({
    tenantId,
    inspect,
    assertEligible(request) {
      try {
        const result = inspect(request);
        if (result.status === SKILL_RUNTIME_STALE)
          fail(`Skill requires revalidation (${result.eligibilityDigest})`);
        return result;
      } catch (cause) {
        fail("Skill runtime admission failed closed", cause);
      }
    },
  });
  admissions.add(admission);
  return Object.freeze({
    admission,
    inspect,
    revalidate({ skill, context = {}, receipt: input }) {
      const current = inspect({ skill, context });
      if (
        !current.governed ||
        !current.binding ||
        current.status !== SKILL_RUNTIME_STALE
      )
        fail("revalidation requires a stale active release and known runtime");
      const receipt = verifySkillRuntimeEvaluation(input);
      if (
        receipt.expectedEligibilityDigest !== current.eligibilityDigest ||
        runtimeCanonical(receipt.binding) !==
          runtimeCanonical(current.binding) ||
        verifyEvaluation(receipt) !== true
      )
        fail(
          "fresh evaluation does not bind the current active release and runtime",
        );
      // Verifiers may call external authority: repeat both release CAS and all
      // observed bindings before committing eligibility.
      const checked = inspect({ skill, context });
      if (
        checked.eligibilityDigest !== current.eligibilityDigest ||
        runtimeCanonical(checked.binding) !== runtimeCanonical(current.binding)
      )
        fail("active release or runtime changed during revalidation");
      const previous = read(receipt.binding.skillName);
      if (previous?.stateDigest !== current.eligibilityDigest)
        fail("runtime eligibility changed during revalidation");
      write(
        receipt.binding.skillName,
        previous,
        "eligible",
        current.binding,
        "fresh evaluation accepted",
        receipt,
      );
      return admission.assertEligible({ skill, context });
    },
  });
}

export function captureSkillRuntimeAdmission(value) {
  if (!admissions.has(value))
    fail("a branded Skill runtime admission port is required");
  return value;
}

export function bindSkillRuntimeAdmission(
  loader,
  admission,
  { required = false } = {},
) {
  if (required) requiredLoaders.add(loader);
  if (admission === null) return;
  const captured = captureSkillRuntimeAdmission(admission);
  if (loaderAdmissions.has(loader) && loaderAdmissions.get(loader) !== captured)
    fail("loader runtime admission cannot be replaced");
  loaderAdmissions.set(loader, captured);
}

export function hasSkillReleaseBinding(skill) {
  return [
    "evolutionRelease",
    "releaseBinding",
    "activeReleaseDigest",
    "releaseDigest",
    "runtimeManifest",
    "runtimeManifestDigest",
  ].some((key) => skill?.[key] != null);
}

export function assertSkillRuntimeAdmission({
  skill,
  loader,
  admission = null,
  required = false,
  expectedSkillName = null,
  context = {},
}) {
  if (
    expectedSkillName !== null &&
    (skill?.id || skill?.dirName) !== expectedSkillName
  )
    fail("materialization changed the admitted Skill identity");
  const bound = loaderAdmissions.get(loader);
  if (
    bound &&
    admission !== null &&
    admission !== undefined &&
    bound !== admission
  )
    fail("loader and execution runtime admission differ");
  const port = bound ?? admission;
  if (port !== null && port !== undefined)
    return captureSkillRuntimeAdmission(port).assertEligible({
      skill,
      context,
    });
  if (required || requiredLoaders.has(loader) || hasSkillReleaseBinding(skill))
    fail("governed Skill is missing its runtime admission port");
  return Object.freeze({ governed: false, status: "unassessed" });
}

export function captureSkillRuntimeDependencies(options = {}, tenantId = null) {
  const admission =
    options.skillRuntimeAdmission == null
      ? null
      : captureSkillRuntimeAdmission(options.skillRuntimeAdmission);
  if (admission && tenantId && admission.tenantId !== tenantId)
    fail("runtime admission tenant differs from the execution tenant");
  return Object.freeze({
    ...(admission === null ? {} : { skillRuntimeAdmission: admission }),
    ...(options.skillRuntimeAdmissionRequired === true
      ? { skillRuntimeAdmissionRequired: true }
      : {}),
  });
}

export function isSkillRuntimeAdmissionProof(value) {
  return proofs.has(value);
}
