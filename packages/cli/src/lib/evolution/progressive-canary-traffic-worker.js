import { createHash } from "node:crypto";

import {
  isProgressiveCanaryAssignmentAuthority,
  verifyProgressiveCanaryPlan,
} from "./statistical-progressive-canary.js";

export const PROGRESSIVE_CANARY_TRAFFIC_MANIFEST_SCHEMA =
  "chainlesschain.progressive-canary-traffic-manifest/v1";
export const PROGRESSIVE_CANARY_PAIRED_OUTCOME_SCHEMA =
  "chainlesschain.progressive-canary-paired-outcome/v1";
export const PROGRESSIVE_CANARY_OBSERVATION_SCHEMA =
  "chainlesschain.progressive-canary-observation/v1";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const OUTCOME_AUTHORITIES = new WeakSet();
const OBSERVATION_STORES = new WeakSet();

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function hash(schema, value) {
  return `sha256:${createHash("sha256")
    .update(schema)
    .update("\0")
    .update(canonical(value))
    .digest("hex")}`;
}

function exact(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    canonical(Object.keys(value).sort()) !== canonical([...keys].sort())
  )
    throw new TypeError(`${label} has unexpected or missing fields`);
}

function digest(value, label) {
  if (!DIGEST.test(value ?? "")) throw new TypeError(`${label} is invalid`);
  return value;
}

function id(value, label) {
  if (typeof value !== "string" || !SAFE_ID.test(value))
    throw new TypeError(`${label} is invalid`);
  return value;
}

function integer(value, label) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new TypeError(`${label} is invalid`);
  return value;
}

function finite(value, label) {
  if (!Number.isFinite(value) || value < 0)
    throw new TypeError(`${label} is invalid`);
  return value;
}

function cloneJson(value, label, maxBytes = 1024 * 1024) {
  let encoded;
  let cloned;
  try {
    encoded = JSON.stringify(value);
    cloned = JSON.parse(encoded);
  } catch (cause) {
    throw new TypeError(`${label} must be JSON data`, { cause });
  }
  if (!encoded || Buffer.byteLength(encoded) > maxBytes)
    throw new TypeError(`${label} exceeds its size bound`);
  if (canonical(cloned) !== canonical(value))
    throw new TypeError(`${label} must not contain non-JSON values`);
  return cloned;
}

function normalizeAuthority(value, label) {
  exact(value, ["id", "revision", "handlerDigest"], label);
  if (!Number.isSafeInteger(value.revision) || value.revision < 1)
    throw new TypeError(`${label}.revision is invalid`);
  return Object.freeze({
    id: id(value.id, `${label}.id`),
    revision: value.revision,
    handlerDigest: digest(value.handlerDigest, `${label}.handlerDigest`),
  });
}

export function createProgressiveCanaryTrafficManifest(input = {}) {
  exact(
    input,
    ["planDigest", "baselineRunner", "candidateRunner", "outcomeAuthority"],
    "traffic manifest",
  );
  const core = {
    schema: PROGRESSIVE_CANARY_TRAFFIC_MANIFEST_SCHEMA,
    planDigest: digest(input.planDigest, "planDigest"),
    baselineRunner: normalizeAuthority(input.baselineRunner, "baselineRunner"),
    candidateRunner: normalizeAuthority(
      input.candidateRunner,
      "candidateRunner",
    ),
    outcomeAuthority: normalizeAuthority(
      input.outcomeAuthority,
      "outcomeAuthority",
    ),
  };
  return Object.freeze({
    ...core,
    manifestDigest: hash(PROGRESSIVE_CANARY_TRAFFIC_MANIFEST_SCHEMA, core),
  });
}

export function verifyProgressiveCanaryTrafficManifest(manifest) {
  if (manifest?.schema !== PROGRESSIVE_CANARY_TRAFFIC_MANIFEST_SCHEMA)
    throw new TypeError("a canonical traffic manifest is required");
  const core = structuredClone(manifest);
  delete core.manifestDigest;
  if (
    hash(PROGRESSIVE_CANARY_TRAFFIC_MANIFEST_SCHEMA, core) !==
    manifest.manifestDigest
  )
    throw new Error("traffic manifest digest mismatch");
  return manifest;
}

function normalizeArmResult(value, arm, manifest) {
  exact(
    value,
    [
      "authenticated",
      "durable",
      "runnerId",
      "runnerRevision",
      "handlerDigest",
      "success",
      "cost",
      "latencyMs",
      "toolCalls",
      "securityEvents",
      "permissionEvents",
      "resultDigest",
    ],
    `${arm} result`,
  );
  const authority = manifest[`${arm}Runner`];
  if (
    value.authenticated !== true ||
    value.durable !== true ||
    value.runnerId !== authority.id ||
    value.runnerRevision !== authority.revision ||
    value.handlerDigest !== authority.handlerDigest ||
    typeof value.success !== "boolean"
  )
    throw new Error(`${arm} runner did not authenticate the exact execution`);
  return Object.freeze({
    authenticated: true,
    durable: true,
    runnerId: value.runnerId,
    runnerRevision: value.runnerRevision,
    handlerDigest: value.handlerDigest,
    success: value.success,
    cost: finite(value.cost, `${arm}.cost`),
    latencyMs: finite(value.latencyMs, `${arm}.latencyMs`),
    toolCalls: integer(value.toolCalls, `${arm}.toolCalls`),
    securityEvents: integer(value.securityEvents, `${arm}.securityEvents`),
    permissionEvents: integer(
      value.permissionEvents,
      `${arm}.permissionEvents`,
    ),
    resultDigest: digest(value.resultDigest, `${arm}.resultDigest`),
  });
}

export function createProgressiveCanaryPairedOutcomeAuthority({
  manifest: manifestInput,
  executeBaseline,
  executeCandidate,
  verifyBaseline,
  verifyCandidate,
  attestor,
  verifier,
  now = Date.now,
} = {}) {
  const manifest = verifyProgressiveCanaryTrafficManifest(manifestInput);
  if (
    typeof executeBaseline !== "function" ||
    typeof executeCandidate !== "function" ||
    typeof verifyBaseline !== "function" ||
    typeof verifyCandidate !== "function" ||
    typeof attestor !== "function" ||
    typeof verifier !== "function" ||
    typeof now !== "function"
  )
    throw new TypeError("paired outcome authority ports are required");

  async function verify(receipt, binding = {}) {
    exact(
      receipt,
      [
        "schema",
        "manifestDigest",
        "planDigest",
        "stepId",
        "subjectDigest",
        "requestDigest",
        "baseline",
        "candidate",
        "authorityId",
        "authorityRevision",
        "handlerDigest",
        "issuedAt",
        "signature",
        "receiptDigest",
      ],
      "paired outcome receipt",
    );
    if (
      receipt.schema !== PROGRESSIVE_CANARY_PAIRED_OUTCOME_SCHEMA ||
      receipt.manifestDigest !== manifest.manifestDigest ||
      receipt.planDigest !== manifest.planDigest ||
      receipt.stepId !== binding.stepId ||
      receipt.subjectDigest !== binding.subjectDigest ||
      receipt.requestDigest !== binding.requestDigest ||
      receipt.authorityId !== manifest.outcomeAuthority.id ||
      receipt.authorityRevision !== manifest.outcomeAuthority.revision ||
      receipt.handlerDigest !== manifest.outcomeAuthority.handlerDigest ||
      !Number.isSafeInteger(receipt.issuedAt) ||
      receipt.issuedAt > Number(now()) ||
      typeof receipt.signature !== "string" ||
      receipt.signature.length < 32
    )
      throw new Error("paired outcome receipt binding is invalid");
    normalizeArmResult(receipt.baseline, "baseline", manifest);
    normalizeArmResult(receipt.candidate, "candidate", manifest);
    const core = structuredClone(receipt);
    delete core.receiptDigest;
    if (
      hash(PROGRESSIVE_CANARY_PAIRED_OUTCOME_SCHEMA, core) !==
      receipt.receiptDigest
    )
      throw new Error("paired outcome receipt digest mismatch");
    const payload = structuredClone(core);
    delete payload.signature;
    if (!(await verifier({ payload, signature: receipt.signature })))
      throw new Error("paired outcome signature rejected");
    return Object.freeze(structuredClone(receipt));
  }

  const authority = Object.freeze({
    manifestDigest: manifest.manifestDigest,
    planDigest: manifest.planDigest,
    async execute({ stepId, subjectDigest, requestDigest, request }) {
      id(stepId, "stepId");
      digest(subjectDigest, "subjectDigest");
      digest(requestDigest, "requestDigest");
      const execution = Object.freeze({
        manifestDigest: manifest.manifestDigest,
        planDigest: manifest.planDigest,
        stepId,
        subjectDigest,
        requestDigest,
        request: Object.freeze(cloneJson(request, "traffic request")),
      });
      const [baselineValue, candidateValue] = await Promise.all([
        executeBaseline(execution),
        executeCandidate(execution),
      ]);
      const baseline = normalizeArmResult(baselineValue, "baseline", manifest);
      const candidate = normalizeArmResult(
        candidateValue,
        "candidate",
        manifest,
      );
      const [baselineVerified, candidateVerified] = await Promise.all([
        verifyBaseline({ execution, receipt: baseline }),
        verifyCandidate({ execution, receipt: candidate }),
      ]);
      if (baselineVerified !== true || candidateVerified !== true)
        throw new Error("a paired runner receipt was rejected");
      const payload = {
        schema: PROGRESSIVE_CANARY_PAIRED_OUTCOME_SCHEMA,
        manifestDigest: manifest.manifestDigest,
        planDigest: manifest.planDigest,
        stepId,
        subjectDigest,
        requestDigest,
        baseline,
        candidate,
        authorityId: manifest.outcomeAuthority.id,
        authorityRevision: manifest.outcomeAuthority.revision,
        handlerDigest: manifest.outcomeAuthority.handlerDigest,
        issuedAt: integer(Number(now()), "outcome clock"),
      };
      const signature = await attestor(Object.freeze(structuredClone(payload)));
      if (typeof signature !== "string" || signature.length < 32)
        throw new Error(
          "paired outcome attestor returned an invalid signature",
        );
      const core = { ...payload, signature };
      return verify(
        Object.freeze({
          ...core,
          receiptDigest: hash(PROGRESSIVE_CANARY_PAIRED_OUTCOME_SCHEMA, core),
        }),
        { stepId, subjectDigest, requestDigest },
      );
    },
    verify,
  });
  OUTCOME_AUTHORITIES.add(authority);
  return authority;
}

export function createProgressiveCanaryObservationStore({
  reserve,
  commit,
  load,
  list,
} = {}) {
  if (
    typeof reserve !== "function" ||
    typeof commit !== "function" ||
    typeof load !== "function" ||
    typeof list !== "function"
  )
    throw new TypeError("observation store ports are required");
  const store = Object.freeze({
    reserve: (...args) => reserve(...args),
    commit: (...args) => commit(...args),
    load: (...args) => load(...args),
    list: (...args) => list(...args),
  });
  OBSERVATION_STORES.add(store);
  return store;
}

function verifyObservation(value, { plan, manifest, stepId, subjectDigest }) {
  if (
    value?.schema !== PROGRESSIVE_CANARY_OBSERVATION_SCHEMA ||
    value.planDigest !== plan.planDigest ||
    value.manifestDigest !== manifest.manifestDigest ||
    value.stepId !== stepId ||
    value.subjectDigest !== subjectDigest ||
    !DIGEST.test(value.observationDigest ?? "")
  )
    throw new Error("persisted Canary observation binding is invalid");
  const core = structuredClone(value);
  delete core.observationDigest;
  if (
    hash(PROGRESSIVE_CANARY_OBSERVATION_SCHEMA, core) !==
    value.observationDigest
  )
    throw new Error("persisted Canary observation digest mismatch");
  const expectedOperationDigest = hash(PROGRESSIVE_CANARY_OBSERVATION_SCHEMA, {
    planDigest: plan.planDigest,
    manifestDigest: manifest.manifestDigest,
    stepId,
    subjectDigest,
    requestDigest: value.requestDigest,
  });
  if (value.operationDigest !== expectedOperationDigest)
    throw new Error(
      "persisted Canary observation operation binding is invalid",
    );
  return Object.freeze(structuredClone(value));
}

export class ProgressiveCanaryTrafficWorker {
  constructor({
    plan: planInput,
    manifest: manifestInput,
    assignmentAuthority,
    outcomeAuthority,
    observationStore,
    now = Date.now,
  } = {}) {
    this.plan = verifyProgressiveCanaryPlan(planInput);
    this.manifest = verifyProgressiveCanaryTrafficManifest(manifestInput);
    if (this.manifest.planDigest !== this.plan.planDigest)
      throw new TypeError("traffic manifest belongs to another plan");
    if (!isProgressiveCanaryAssignmentAuthority(assignmentAuthority))
      throw new TypeError("a branded assignment authority is required");
    if (
      assignmentAuthority.planDigest !== this.plan.planDigest ||
      assignmentAuthority.tenantId !== this.plan.tenantId ||
      assignmentAuthority.pilotId !== this.plan.pilotId
    )
      throw new TypeError("assignment authority belongs to another plan");
    if (
      !OUTCOME_AUTHORITIES.has(outcomeAuthority) ||
      outcomeAuthority.manifestDigest !== this.manifest.manifestDigest
    )
      throw new TypeError("a branded paired outcome authority is required");
    if (!OBSERVATION_STORES.has(observationStore))
      throw new TypeError("a branded durable observation store is required");
    if (typeof now !== "function")
      throw new TypeError("traffic worker clock is required");
    this._assignment = assignmentAuthority;
    this._outcomes = outcomeAuthority;
    this._store = observationStore;
    this._now = now;
    Object.freeze(this);
  }

  async process({ stepId, subjectDigest, request } = {}) {
    const step = this.plan.steps.find((value) => value.id === stepId);
    if (!step) throw new TypeError("traffic step is invalid");
    digest(subjectDigest, "subjectDigest");
    const requestValue = Object.freeze(cloneJson(request, "traffic request"));
    const requestDigest = hash(
      PROGRESSIVE_CANARY_TRAFFIC_MANIFEST_SCHEMA,
      requestValue,
    );
    const operationDigest = hash(PROGRESSIVE_CANARY_OBSERVATION_SCHEMA, {
      planDigest: this.plan.planDigest,
      manifestDigest: this.manifest.manifestDigest,
      stepId,
      subjectDigest,
      requestDigest,
    });
    const prior = await this._store.load({
      planDigest: this.plan.planDigest,
      stepId,
      subjectDigest,
    });
    if (prior !== null && prior !== undefined) {
      const recovered = verifyObservation(prior, {
        plan: this.plan,
        manifest: this.manifest,
        stepId,
        subjectDigest,
      });
      if (recovered.requestDigest !== requestDigest)
        throw new Error("a Canary subject cannot replace its traffic request");
      await this._outcomes.verify(recovered.outcomeReceipt, {
        stepId,
        subjectDigest,
        requestDigest,
      });
      return Object.freeze({
        assigned: true,
        observation: recovered,
        recovered: true,
      });
    }
    const assignmentReceipt = await this._assignment.assign({
      stepId,
      subjectDigest,
    });
    const assignment = await this._assignment.verify(assignmentReceipt, {
      stepId,
      subjectDigest,
    });
    if (!assignment.assigned)
      return Object.freeze({
        assigned: false,
        assignmentReceipt,
        observation: null,
        recovered: false,
      });
    const reservation = await this._store.reserve({
      planDigest: this.plan.planDigest,
      manifestDigest: this.manifest.manifestDigest,
      stepId,
      subjectDigest,
      requestDigest,
      operationDigest,
    });
    if (
      reservation?.authenticated !== true ||
      reservation?.durable !== true ||
      reservation.operationDigest !== operationDigest ||
      typeof reservation.acquired !== "boolean"
    )
      throw new Error(
        "Canary execution reservation was not durably authenticated",
      );
    if (!reservation.acquired) {
      const completed = await this._store.load({
        planDigest: this.plan.planDigest,
        stepId,
        subjectDigest,
      });
      if (completed === null || completed === undefined)
        throw new Error(
          "Canary execution is already reserved by another worker",
        );
      const recovered = verifyObservation(completed, {
        plan: this.plan,
        manifest: this.manifest,
        stepId,
        subjectDigest,
      });
      if (
        recovered.requestDigest !== requestDigest ||
        recovered.operationDigest !== operationDigest
      )
        throw new Error("Canary execution reservation binding differs");
      await this._outcomes.verify(recovered.outcomeReceipt, {
        stepId,
        subjectDigest,
        requestDigest,
      });
      return Object.freeze({
        assigned: true,
        observation: recovered,
        recovered: true,
      });
    }
    const outcome = await this._outcomes.execute({
      stepId,
      subjectDigest,
      requestDigest,
      request: requestValue,
    });
    const verified = await this._outcomes.verify(outcome, {
      stepId,
      subjectDigest,
      requestDigest,
    });
    const core = {
      schema: PROGRESSIVE_CANARY_OBSERVATION_SCHEMA,
      planDigest: this.plan.planDigest,
      manifestDigest: this.manifest.manifestDigest,
      stepId,
      subjectDigest,
      requestDigest,
      operationDigest,
      assignmentReceipt,
      outcomeReceipt: verified,
      observedAt: integer(Number(this._now()), "traffic worker clock"),
    };
    const observation = Object.freeze({
      ...core,
      observationDigest: hash(PROGRESSIVE_CANARY_OBSERVATION_SCHEMA, core),
    });
    const acknowledgement = await this._store.commit(observation);
    if (
      acknowledgement?.authenticated !== true ||
      acknowledgement?.durable !== true ||
      acknowledgement.operationDigest !== operationDigest ||
      acknowledgement.observationDigest !== observation.observationDigest
    )
      throw new Error("Canary observation was not durably authenticated");
    const readback = verifyObservation(
      await this._store.load({
        planDigest: this.plan.planDigest,
        stepId,
        subjectDigest,
      }),
      { plan: this.plan, manifest: this.manifest, stepId, subjectDigest },
    );
    if (readback.observationDigest !== observation.observationDigest)
      throw new Error("Canary observation durable readback differs");
    return Object.freeze({
      assigned: true,
      observation: readback,
      recovered: false,
    });
  }

  async observations({ stepId } = {}) {
    if (!this.plan.steps.some((value) => value.id === stepId))
      throw new TypeError("traffic step is invalid");
    const values = await this._store.list({
      planDigest: this.plan.planDigest,
      stepId,
    });
    if (!Array.isArray(values) || values.length > 1_000_000)
      throw new Error("Canary observation store returned an invalid list");
    const subjects = new Set();
    const result = [];
    for (const value of values) {
      const subjectDigest = digest(
        value?.subjectDigest,
        "observation subjectDigest",
      );
      if (subjects.has(subjectDigest))
        throw new Error("Canary observation store returned duplicate subjects");
      subjects.add(subjectDigest);
      const row = verifyObservation(value, {
        plan: this.plan,
        manifest: this.manifest,
        stepId,
        subjectDigest,
      });
      await this._outcomes.verify(row.outcomeReceipt, {
        stepId,
        subjectDigest,
        requestDigest: row.requestDigest,
      });
      const { baseline, candidate } = row.outcomeReceipt;
      result.push(
        Object.freeze({
          subjectDigest,
          assignmentReceipt: row.assignmentReceipt,
          outcomeReceiptDigest: row.outcomeReceipt.receiptDigest,
          observedAt: row.observedAt,
          baselineSuccess: baseline.success,
          candidateSuccess: candidate.success,
          baselineCost: baseline.cost,
          candidateCost: candidate.cost,
          baselineLatencyMs: baseline.latencyMs,
          candidateLatencyMs: candidate.latencyMs,
          baselineToolCalls: baseline.toolCalls,
          candidateToolCalls: candidate.toolCalls,
          securityEvents: baseline.securityEvents + candidate.securityEvents,
          permissionEvents:
            baseline.permissionEvents + candidate.permissionEvents,
        }),
      );
    }
    return Object.freeze(
      result.sort((left, right) =>
        left.subjectDigest.localeCompare(right.subjectDigest),
      ),
    );
  }
}
