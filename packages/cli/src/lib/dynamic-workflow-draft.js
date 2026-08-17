import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { types as utilTypes } from "node:util";
import { createDynamicWorkflowManifest } from "./dynamic-workflow-facade.js";
import { containsSecret } from "./secret-scan.js";
import {
  sameFileStatIdentity,
  samePathHandleFileIdentity,
  withTrustedFileParentSync,
} from "./secure-file-identity.js";
import { canonicalJson } from "./scheduler-kernel/contract.js";
import {
  MAX_WORKFLOW_DEFINITION_BYTES,
  WORKFLOW_DEFINITION_SCHEMA,
} from "./workflow-definition-contract.js";

export const DYNAMIC_WORKFLOW_DRAFT_SCHEMA = "cc-dynamic-workflow-draft/v1";
export const DYNAMIC_WORKFLOW_GENERATION_SCHEMA =
  "cc-dynamic-workflow-generation/v1";
export const DYNAMIC_WORKFLOW_REVIEW_SCHEMA = "cc-dynamic-workflow-review/v1";
export const MAX_DYNAMIC_WORKFLOW_PROMPT_BYTES = 16 * 1024;
export const MAX_DYNAMIC_WORKFLOW_DRAFT_BYTES =
  MAX_WORKFLOW_DEFINITION_BYTES + 256 * 1024;

const SHA256_RE = /^sha256:[a-f0-9]{64}$/u;
const DRAFT_FIELDS = new Set([
  "schema",
  "status",
  "promptDigest",
  "generator",
  "createdAt",
  "definitionSchema",
  "definitionDigest",
  "definition",
  "projection",
  "draftDigest",
]);
const GENERATOR_FIELDS = new Set(["provider", "model"]);
const PROJECTION_FIELDS = new Set([
  "adapter",
  "engineCapabilities",
  "usedCapabilities",
  "plan",
  "governance",
  "runtimeClaims",
]);

function digest(domain, value) {
  return `sha256:${createHash("sha256")
    .update(domain, "utf8")
    .update(canonicalJson(value, "dynamicWorkflowDraft"), "utf8")
    .digest("hex")}`;
}

function canonicalTimestamp(value, field) {
  const raw = typeof value === "function" ? value() : value;
  const date = raw == null ? new Date() : new Date(raw);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(`${field} must be a canonical timestamp`);
  }
  return date.toISOString();
}

function boundedString(value, field, max = 256) {
  if (typeof value !== "string") throw new TypeError(`${field} is required`);
  const output = value.trim();
  let hasControlCharacter = false;
  for (let index = 0; index < output.length; index += 1) {
    const code = output.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      hasControlCharacter = true;
      break;
    }
  }
  if (!output || output.length > max || hasControlCharacter) {
    throw new TypeError(`${field} is invalid`);
  }
  return output;
}

function assertExactObject(value, fields, field) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError(`${field} must be a plain object`);
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== fields.size ||
    keys.some((key) => typeof key !== "string" || !fields.has(key))
  ) {
    throw new TypeError(`${field} contains missing or unknown fields`);
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor ||
      descriptor.enumerable !== true ||
      !Object.hasOwn(descriptor, "value")
    ) {
      throw new TypeError(`${field}.${key} must be an enumerable data field`);
    }
  }
}

function snapshotJson(value, field) {
  let encoded;
  try {
    encoded = canonicalJson(value, field);
  } catch {
    throw new TypeError(`${field} must contain canonical JSON`);
  }
  if (Buffer.byteLength(encoded, "utf8") > MAX_DYNAMIC_WORKFLOW_DRAFT_BYTES) {
    throw new TypeError(`${field} exceeds the draft byte limit`);
  }
  return JSON.parse(encoded);
}

function parseGeneratedDefinition(value) {
  if (typeof value !== "string") {
    throw new TypeError("workflow generator must return text");
  }
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes <= 0 || bytes > MAX_WORKFLOW_DEFINITION_BYTES) {
    throw new TypeError("workflow generator response exceeds its byte limit");
  }
  const trimmed = value.trim();
  const fenced = /^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```$/iu.exec(trimmed);
  const json = fenced ? fenced[1] : trimmed;
  if (!fenced && !json.startsWith("{")) {
    throw new TypeError("workflow generator response must be one JSON object");
  }
  let definition;
  try {
    definition = JSON.parse(json);
  } catch {
    throw new TypeError("workflow generator response is not valid JSON");
  }
  if (
    !definition ||
    typeof definition !== "object" ||
    Array.isArray(definition)
  ) {
    throw new TypeError("workflow generator response must be one JSON object");
  }
  if (
    definition.facade?.generation != null ||
    definition.facade?.review != null
  ) {
    throw new TypeError("workflow generator may not declare review authority");
  }
  if (containsSecret(JSON.stringify(definition))) {
    throw new TypeError(
      "workflow generator response contains secret-shaped data",
    );
  }
  return definition;
}

function projectionFromManifest(manifest) {
  return Object.freeze({
    adapter: manifest.adapter,
    engineCapabilities: manifest.engineCapabilities,
    usedCapabilities: manifest.usedCapabilities,
    plan: manifest.plan,
    governance: manifest.governance,
    runtimeClaims: manifest.runtimeClaims,
  });
}

function assertReviewableManifest(manifest) {
  const { requirements, estimates, budget } = manifest.governance;
  const problems = [];
  if (
    requirements.capabilityDeclarationInvalid ||
    canonicalJson(requirements.capabilities) !==
      canonicalJson(manifest.usedCapabilities)
  ) {
    problems.push("capabilities-must-exactly-match-plan");
  }
  if (
    requirements.executionLocationDeclarationInvalid ||
    requirements.executionLocations.length === 0
  ) {
    problems.push("execution-location-required");
  }
  if (!requirements.permissions || requirements.permissionDeclarationInvalid) {
    problems.push("permission-declaration-required");
  }
  if (!requirements.sandbox) problems.push("sandbox-declaration-required");
  if (!requirements.dataBoundary) {
    problems.push("data-boundary-declaration-required");
  }
  if (
    requirements.credentialValuePresent ||
    requirements.credentialDeclarationInvalid
  ) {
    problems.push("credential-reference-invalid");
  }
  if (Object.values(estimates).some((value) => value == null)) {
    problems.push("estimates-required");
  }
  if (Object.values(budget).some((value) => value == null)) {
    problems.push("budget-required");
  }
  const taskCalls = manifest.plan.worstCaseTaskCalls;
  if (taskCalls == null)
    problems.push("runtime-expansion-unsupported-for-draft");
  if (
    budget.maxExpandedTasks != null &&
    (budget.maxExpandedTasks > 64 || taskCalls > budget.maxExpandedTasks)
  ) {
    problems.push("expanded-task-budget-invalid");
  }
  if (
    budget.maxParallel != null &&
    (budget.maxParallel > 64 || budget.maxParallel > budget.maxExpandedTasks)
  ) {
    problems.push("parallel-budget-invalid");
  }
  if (
    taskCalls != null &&
    estimates.tokensPerTask != null &&
    budget.maxTokens != null &&
    taskCalls * estimates.tokensPerTask > budget.maxTokens
  ) {
    problems.push("token-budget-exceeded");
  }
  if (
    taskCalls != null &&
    estimates.usdPerTask != null &&
    budget.maxUsd != null &&
    taskCalls * estimates.usdPerTask > budget.maxUsd
  ) {
    problems.push("usd-budget-exceeded");
  }
  const durationSlots = manifest.plan.steps.reduce(
    (total, step) => total + (step.worstCaseDurationSlots ?? 0),
    0,
  );
  if (
    estimates.durationMsPerTask != null &&
    budget.maxDurationMs != null &&
    durationSlots * estimates.durationMsPerTask > budget.maxDurationMs
  ) {
    problems.push("duration-budget-exceeded");
  }
  if (problems.length > 0) {
    throw new TypeError(
      `generated workflow is not reviewable: ${problems.join(", ")}`,
    );
  }
}

function generationPrompt(prompt) {
  return [
    "Return exactly one JSON object and no prose.",
    "Create a cc dynamic workflow definition with id, name, non-empty steps, and facade.",
    "Each step needs id and message; use dependsOn for the DAG.",
    "facade.requirements must exactly declare the capabilities used by the plan, one or more executionLocations, explicit permissions, sandbox, dataBoundary, and credential references containing only name/source/scope.",
    "facade.estimates must declare positive tokensPerTask, usdPerTask, and durationMsPerTask.",
    "facade.budget must declare maxExpandedTasks (at most 64), maxParallel (at most maxExpandedTasks), maxTokens, maxUsd, and maxDurationMs covering the projected plan.",
    "Do not include credentials, secrets, generation metadata, review metadata, or unsupported capabilities.",
    "Requested workflow:",
    prompt,
  ].join("\n");
}

function draftMaterial(value) {
  const material = { ...value };
  delete material.draftDigest;
  return material;
}

export async function generateDynamicWorkflowDraft(input = {}, deps = {}) {
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  const promptBytes = Buffer.byteLength(prompt, "utf8");
  if (promptBytes <= 0 || promptBytes > MAX_DYNAMIC_WORKFLOW_PROMPT_BYTES) {
    throw new TypeError(
      `workflow prompt must be 1..${MAX_DYNAMIC_WORKFLOW_PROMPT_BYTES} bytes`,
    );
  }
  const provider = boundedString(input.provider, "provider", 128);
  const model = boundedString(input.model, "model", 256);
  if (typeof deps.chat !== "function") {
    throw new TypeError("workflow draft chat provider is required");
  }
  const createdAt = canonicalTimestamp(deps.now, "createdAt");
  const promptDigest = digest(
    "chainlesschain.dynamic-workflow.prompt.v1\0",
    prompt,
  );
  const response = await deps.chat(
    [
      {
        role: "system",
        content:
          "You generate bounded workflow JSON for explicit human review. You never execute or persist it.",
      },
      { role: "user", content: generationPrompt(prompt) },
    ],
    { maxTokens: 8192 },
  );
  const proposed = parseGeneratedDefinition(response);
  const definition = {
    ...proposed,
    facade: {
      ...(proposed.facade || {}),
      generation: {
        schema: DYNAMIC_WORKFLOW_GENERATION_SCHEMA,
        promptDigest,
        provider,
        model,
        generatedAt: createdAt,
      },
    },
  };
  const manifest = createDynamicWorkflowManifest(definition);
  assertReviewableManifest(manifest);
  const material = Object.freeze({
    schema: DYNAMIC_WORKFLOW_DRAFT_SCHEMA,
    status: "pending-review",
    promptDigest,
    generator: Object.freeze({ provider, model }),
    createdAt,
    definitionSchema: WORKFLOW_DEFINITION_SCHEMA,
    definitionDigest: manifest.definitionDigest,
    definition: manifest.definition,
    projection: projectionFromManifest(manifest),
  });
  return Object.freeze({
    ...material,
    draftDigest: digest("chainlesschain.dynamic-workflow.draft.v1\0", material),
  });
}

export function verifyDynamicWorkflowDraft(value) {
  assertExactObject(value, DRAFT_FIELDS, "workflow draft");
  assertExactObject(
    value.generator,
    GENERATOR_FIELDS,
    "workflow draft generator",
  );
  assertExactObject(
    value.projection,
    PROJECTION_FIELDS,
    "workflow draft projection",
  );
  const snapshot = snapshotJson(value, "workflow draft");
  if (
    snapshot.schema !== DYNAMIC_WORKFLOW_DRAFT_SCHEMA ||
    snapshot.status !== "pending-review" ||
    !SHA256_RE.test(snapshot.promptDigest) ||
    !SHA256_RE.test(snapshot.definitionDigest) ||
    !SHA256_RE.test(snapshot.draftDigest) ||
    snapshot.definitionSchema !== WORKFLOW_DEFINITION_SCHEMA ||
    canonicalTimestamp(snapshot.createdAt, "createdAt") !== snapshot.createdAt
  ) {
    throw new TypeError("workflow draft identity is invalid");
  }
  const provider = boundedString(snapshot.generator.provider, "provider", 128);
  const model = boundedString(snapshot.generator.model, "model", 256);
  const generation = snapshot.definition?.facade?.generation;
  if (
    generation?.schema !== DYNAMIC_WORKFLOW_GENERATION_SCHEMA ||
    generation.promptDigest !== snapshot.promptDigest ||
    generation.provider !== provider ||
    generation.model !== model ||
    generation.generatedAt !== snapshot.createdAt ||
    snapshot.definition?.facade?.review != null
  ) {
    throw new TypeError("workflow draft generation authority is invalid");
  }
  if (containsSecret(JSON.stringify(snapshot.definition))) {
    throw new TypeError("workflow draft contains secret-shaped data");
  }
  const manifest = createDynamicWorkflowManifest(snapshot.definition);
  assertReviewableManifest(manifest);
  if (
    manifest.definitionDigest !== snapshot.definitionDigest ||
    canonicalJson(projectionFromManifest(manifest)) !==
      canonicalJson(snapshot.projection)
  ) {
    throw new TypeError(
      "workflow draft projection does not match its definition",
    );
  }
  const expectedDigest = digest(
    "chainlesschain.dynamic-workflow.draft.v1\0",
    draftMaterial(snapshot),
  );
  if (expectedDigest !== snapshot.draftDigest) {
    throw new TypeError("workflow draft digest mismatch");
  }
  return Object.freeze(snapshot);
}

export function reviewDynamicWorkflowDraft(input = {}, deps = {}) {
  const draft = verifyDynamicWorkflowDraft(input.draft);
  const expectedDraftDigest = String(input.expectedDraftDigest || "")
    .trim()
    .toLowerCase();
  if (!SHA256_RE.test(expectedDraftDigest)) {
    throw new TypeError("expected draft digest is required");
  }
  if (expectedDraftDigest !== draft.draftDigest) {
    throw new TypeError("workflow draft changed before review");
  }
  if (!new Set(["accept", "reject"]).has(input.decision)) {
    throw new TypeError("workflow review decision must be accept or reject");
  }
  const reviewer = boundedString(input.reviewer, "reviewer", 256);
  const reason =
    input.reason == null
      ? null
      : boundedString(input.reason, "review reason", 2048);
  if (reason && containsSecret(reason)) {
    throw new TypeError("workflow review reason contains secret-shaped data");
  }
  const reviewedAt = canonicalTimestamp(deps.now, "reviewedAt");
  let definition = null;
  let acceptedDefinitionDigest = null;
  if (input.decision === "accept") {
    const reviewedDefinition = {
      ...draft.definition,
      facade: {
        ...draft.definition.facade,
        review: {
          schema: DYNAMIC_WORKFLOW_REVIEW_SCHEMA,
          decision: "accepted",
          draftDigest: draft.draftDigest,
          sourceDefinitionDigest: draft.definitionDigest,
          reviewer,
          reason,
          reviewedAt,
        },
      },
    };
    const manifest = createDynamicWorkflowManifest(reviewedDefinition);
    assertReviewableManifest(manifest);
    definition = manifest.definition;
    acceptedDefinitionDigest = manifest.definitionDigest;
  }
  const material = Object.freeze({
    schema: DYNAMIC_WORKFLOW_REVIEW_SCHEMA,
    status: input.decision === "accept" ? "accepted" : "rejected",
    draftDigest: draft.draftDigest,
    promptDigest: draft.promptDigest,
    sourceDefinitionDigest: draft.definitionDigest,
    acceptedDefinitionDigest,
    reviewer,
    reason,
    reviewedAt,
    definition,
  });
  return Object.freeze({
    ...material,
    reviewDigest: digest(
      "chainlesschain.dynamic-workflow.review.v1\0",
      material,
    ),
  });
}

function parseDraftFile(raw) {
  const text =
    typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8");
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= 0 || bytes > MAX_DYNAMIC_WORKFLOW_DRAFT_BYTES) {
    throw new TypeError(
      `workflow draft file must be 1..${MAX_DYNAMIC_WORKFLOW_DRAFT_BYTES} bytes`,
    );
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new TypeError("workflow draft file is not valid JSON");
  }
  return verifyDynamicWorkflowDraft(value);
}

export function readDynamicWorkflowDraftFile(filePath, deps = {}) {
  const runtimeFs = deps.fs || fs;
  const resolved = path.resolve(filePath);
  return withTrustedFileParentSync(
    runtimeFs,
    resolved,
    ({ canonicalPath, parentDevice }) => {
      const before = runtimeFs.lstatSync(canonicalPath, { bigint: true });
      if (
        !before.isFile() ||
        before.isSymbolicLink() ||
        Number(before.nlink) !== 1 ||
        Number(before.size) <= 0 ||
        Number(before.size) > MAX_DYNAMIC_WORKFLOW_DRAFT_BYTES
      ) {
        throw new TypeError(
          "workflow draft must be a bounded, regular, single-link file",
        );
      }
      let descriptor;
      try {
        let flags = Number(runtimeFs.constants.O_RDONLY || 0);
        if (typeof runtimeFs.constants.O_NOFOLLOW === "number") {
          flags |= runtimeFs.constants.O_NOFOLLOW;
        }
        descriptor = runtimeFs.openSync(canonicalPath, flags);
        const opened = runtimeFs.fstatSync(descriptor, { bigint: true });
        if (
          !opened.isFile() ||
          Number(opened.nlink) !== 1 ||
          !samePathHandleFileIdentity(before, opened, parentDevice)
        ) {
          throw new TypeError("workflow draft identity changed while opening");
        }
        const draft = parseDraftFile(
          runtimeFs.readFileSync(descriptor, "utf8"),
        );
        const after = runtimeFs.fstatSync(descriptor, { bigint: true });
        if (!sameFileStatIdentity(opened, after)) {
          throw new TypeError("workflow draft changed while being read");
        }
        return draft;
      } finally {
        if (descriptor !== undefined) runtimeFs.closeSync(descriptor);
      }
    },
  );
}
