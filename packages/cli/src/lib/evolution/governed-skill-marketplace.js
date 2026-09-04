import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

import {
  SKILL_REVOCATION_DEPENDENCY_REQUEST_SCHEMA,
  SKILL_REVOCATION_DEPENDENCY_RESULT_SCHEMA,
  digestSkillRevocationDependencyRequest,
} from "./skill-revocation-propagation.js";

export const GOVERNED_SKILL_MARKETPLACE_MANIFEST_SCHEMA =
  "chainlesschain.governed-skill-marketplace-manifest/v1";
export const GOVERNED_SKILL_MARKETPLACE_STATE_SCHEMA =
  "chainlesschain.governed-skill-marketplace-state/v1";
export const GOVERNED_SKILL_MARKETPLACE_RANKING_SCHEMA =
  "chainlesschain.governed-skill-marketplace-ranking/v1";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const STAGES = new Map([
  ["candidate", "shadow"],
  ["shadow", "canary"],
  ["canary", "active"],
]);
const REVOCATION_DEPENDENCY_REQUEST_KEYS = new Set([
  "schema",
  "tenantId",
  "streamId",
  "operationId",
  "transitionDigest",
  "candidateId",
  "skillName",
  "occurredAt",
  "sourceReceiptDigest",
  "resolutionDigest",
  "dependency",
  "requestDigest",
]);
const REVOCATION_DEPENDENCY_KEYS = new Set([
  "kind",
  "ref",
  "digest",
  "disposition",
]);

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function hash(domain, value) {
  return `sha256:${createHash("sha256")
    .update(`${domain}\0${canonical(value)}`)
    .digest("hex")}`;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function record(value, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new TypeError(`${label} must be a plain object`);
  return value;
}

function exact(value, keys, label) {
  record(value, label);
  const own = Reflect.ownKeys(value);
  if (
    own.length !== keys.size ||
    own.some((key) => typeof key !== "string" || !keys.has(key))
  ) {
    throw new TypeError(`${label} has an invalid shape`);
  }
  for (const key of own) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError(`${label}.${String(key)} is not a data field`);
    }
  }
  return value;
}

function id(value, label) {
  if (typeof value !== "string" || !ID.test(value))
    throw new TypeError(`${label} is invalid`);
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value))
    throw new TypeError(`${label} must be sha256-bound`);
  return value;
}

function capture(owner, method) {
  if (
    !owner ||
    typeof owner !== "object" ||
    utilTypes.isProxy(owner) ||
    typeof owner[method] !== "function"
  )
    throw new TypeError(`${method} authority is required`);
  return (...args) => Reflect.apply(owner[method], owner, args);
}

function normalizeManifest(input, tenantId) {
  record(input, "marketplace manifest");
  if (
    input.schema !== GOVERNED_SKILL_MARKETPLACE_MANIFEST_SCHEMA ||
    input.tenantId !== tenantId ||
    !Array.isArray(input.compatibilityMatrix) ||
    input.compatibilityMatrix.length < 1 ||
    input.compatibilityMatrix.length > 256 ||
    !Array.isArray(input.lineage) ||
    input.lineage.length < 1 ||
    input.lineage.length > 256 ||
    typeof input.signature !== "string" ||
    input.signature.length < 16
  )
    throw new TypeError("marketplace manifest is incomplete or cross-tenant");
  const core = { ...input };
  delete core.manifestDigest;
  delete core.signature;
  for (const field of [
    "packageDigest",
    "sourceCommitDigest",
    "sbomDigest",
    "dependencyLockDigest",
    "permissionManifestDigest",
    "targetMatrixDigest",
    "evalBadgeDigest",
  ])
    digest(input[field], field);
  id(input.skillName, "skillName");
  id(input.version, "version");
  id(input.sourceModel, "sourceModel");
  for (const value of input.lineage) digest(value, "lineage digest");
  const cells = input.compatibilityMatrix.map((cell) => {
    record(cell, "compatibility cell");
    if (
      typeof cell.accepted !== "boolean" ||
      typeof cell.safetyPassed !== "boolean" ||
      !Number.isFinite(cell.qualityScore) ||
      cell.qualityScore < 0 ||
      cell.qualityScore > 1 ||
      !Number.isSafeInteger(cell.sampleCount) ||
      cell.sampleCount < 1 ||
      !["model", "os", "tool", "runtime"].every((field) =>
        ID.test(cell[field] || ""),
      )
    )
      throw new TypeError("compatibility cell is invalid");
    digest(cell.evalReceiptDigest, "compatibility eval receipt");
    return clone(cell);
  });
  if (
    input.manifestDigest !==
    hash(GOVERNED_SKILL_MARKETPLACE_MANIFEST_SCHEMA, core)
  )
    throw new TypeError("marketplace manifest digest is invalid");
  return freeze({ ...clone(input), compatibilityMatrix: cells });
}

function targetCell(manifest, target) {
  record(target, "marketplace target");
  const matches = manifest.compatibilityMatrix.filter(
    (cell) =>
      cell.model === target.model &&
      cell.os === target.os &&
      cell.tool === target.tool &&
      cell.runtime === target.runtime,
  );
  if (matches.length !== 1 || matches[0].accepted !== true)
    throw new Error("target has no unique accepted compatibility evaluation");
  return matches[0];
}

export function buildGovernedSkillMarketplaceManifest(input, signature) {
  record(input, "marketplace manifest input");
  const core = {
    schema: GOVERNED_SKILL_MARKETPLACE_MANIFEST_SCHEMA,
    ...clone(input),
  };
  const manifestDigest = hash(GOVERNED_SKILL_MARKETPLACE_MANIFEST_SCHEMA, core);
  return freeze({ ...core, manifestDigest, signature });
}

export class GovernedSkillMarketplace {
  constructor({ tenantId, ports } = {}) {
    this.tenantId = id(tenantId, "tenantId");
    this._verifySignature = capture(ports, "verifySignature");
    this._adapt = capture(ports, "adapt");
    this._load = capture(ports, "load");
    this._commit = capture(ports, "commit");
    this._transition = capture(ports, "transition");
    this._verifyPilot = capture(ports, "verifyPilot");
    this._verifyRevocation = capture(ports, "verifyRevocation");
  }

  async inspect(input, target) {
    const manifest = normalizeManifest(input, this.tenantId);
    if ((await this._verifySignature({ manifest })) !== true)
      throw new Error("marketplace manifest signature is invalid");
    const cell = targetCell(manifest, target);
    if (cell.safetyPassed !== true)
      throw new Error("marketplace target safety gate failed");
    const adapted = await this._adapt({
      manifest,
      target: clone(target),
      cell,
    });
    if (
      adapted?.authenticated !== true ||
      adapted.manifestDigest !== manifest.manifestDigest ||
      adapted.evalReceiptDigest !== cell.evalReceiptDigest ||
      !DIGEST.test(adapted.outputDigest || "") ||
      !DIGEST.test(adapted.adapterDigest || "")
    )
      throw new Error(
        "target adapter did not bind its output to the evaluation",
      );
    return freeze({
      manifest,
      target: clone(target),
      cell,
      adapted: clone(adapted),
    });
  }

  async stage({ manifest: input, target, expectedStateDigest = null } = {}) {
    const inspected = await this.inspect(input, target);
    const current = await this._load({
      skillName: inspected.manifest.skillName,
    });
    if ((current?.stateDigest || null) !== expectedStateDigest)
      throw new Error("marketplace install baseline changed");
    const state = {
      schema: GOVERNED_SKILL_MARKETPLACE_STATE_SCHEMA,
      tenantId: this.tenantId,
      skillName: inspected.manifest.skillName,
      version: inspected.manifest.version,
      manifestDigest: inspected.manifest.manifestDigest,
      packageDigest: inspected.manifest.packageDigest,
      adaptedOutputDigest: inspected.adapted.outputDigest,
      target: clone(target),
      stage: "candidate",
      previousStateDigest: expectedStateDigest,
      revoked: false,
    };
    return this._persist(state, expectedStateDigest, "marketplace.staged");
  }

  async rank({ listings, target, outcomeMetrics = {} } = {}) {
    if (
      !Array.isArray(listings) ||
      listings.length < 1 ||
      listings.length > 1000
    )
      throw new TypeError("marketplace ranking listings are invalid");
    const ranked = [];
    for (const listing of listings) {
      record(listing, "marketplace listing");
      const inspected = await this.inspect(listing.manifest, target);
      if (inspected.cell.safetyPassed !== true)
        throw new Error("marketplace ranking requires a passing safety gate");
      const metric = outcomeMetrics[inspected.manifest.manifestDigest] ?? {
        samples: 0,
        successRate: 0,
        correctionRate: 0,
      };
      if (
        !Number.isSafeInteger(metric.samples) ||
        metric.samples < 0 ||
        !Number.isFinite(metric.successRate) ||
        metric.successRate < 0 ||
        metric.successRate > 1 ||
        !Number.isFinite(metric.correctionRate) ||
        metric.correctionRate < 0 ||
        metric.correctionRate > 1
      )
        throw new TypeError("marketplace ranking outcome metric is invalid");
      const outcomeScore =
        metric.samples >= 20
          ? metric.successRate * (1 - metric.correctionRate)
          : 0.5;
      const score = inspected.cell.qualityScore * 0.75 + outcomeScore * 0.25;
      ranked.push({
        skillName: inspected.manifest.skillName,
        version: inspected.manifest.version,
        manifestDigest: inspected.manifest.manifestDigest,
        evalBadgeDigest: inspected.manifest.evalBadgeDigest,
        evalReceiptDigest: inspected.cell.evalReceiptDigest,
        target: clone(target),
        score,
        scores: {
          targetEval: inspected.cell.qualityScore,
          verifiedOutcome: outcomeScore,
        },
        outcomeSamples: metric.samples,
        reason: `target-eval=${inspected.cell.qualityScore.toFixed(3)}, verified-outcome=${outcomeScore.toFixed(3)}`,
      });
    }
    ranked.sort(
      (left, right) =>
        right.score - left.score ||
        left.manifestDigest.localeCompare(right.manifestDigest),
    );
    const core = {
      schema: GOVERNED_SKILL_MARKETPLACE_RANKING_SCHEMA,
      tenantId: this.tenantId,
      target: clone(target),
      ranked,
    };
    return freeze({
      ...core,
      rankingDigest: hash(GOVERNED_SKILL_MARKETPLACE_RANKING_SCHEMA, core),
    });
  }

  async advance({ skillName, expectedStateDigest, pilotReceipt } = {}) {
    const current = await this._exact(skillName, expectedStateDigest);
    const nextStage = STAGES.get(current.stage);
    if (!nextStage || current.revoked)
      throw new Error("marketplace update cannot advance");
    const verified = await this._verifyPilot({
      state: current,
      nextStage,
      pilotReceipt,
    });
    if (
      verified?.authenticated !== true ||
      verified.accepted !== true ||
      verified.stateDigest !== current.stateDigest ||
      verified.nextStage !== nextStage ||
      !DIGEST.test(verified.receiptDigest || "")
    )
      throw new Error(
        "marketplace rollout lacks an accepted exact-stage pilot receipt",
      );
    const transitionRequest = freeze({
      stateDigest: current.stateDigest,
      manifestDigest: current.manifestDigest,
      nextStage,
      authorityReceiptDigest: verified.receiptDigest,
    });
    const requestDigest = hash(
      "chainlesschain.governed-skill-marketplace-transition/v1",
      transitionRequest,
    );
    const transition = await this._transition({
      request: transitionRequest,
      requestDigest,
      state: current,
      receipt: verified,
    });
    if (
      transition?.authenticated !== true ||
      transition.durable !== true ||
      transition.requestDigest !== requestDigest ||
      transition.nextStage !== nextStage ||
      !DIGEST.test(transition.receiptDigest || "")
    )
      throw new Error(
        "marketplace transition authority did not durably apply the stage",
      );
    return this._persist(
      {
        ...current,
        stage: nextStage,
        transitionRequestDigest: requestDigest,
        transitionReceiptDigest: transition.receiptDigest,
      },
      current.stateDigest,
      "marketplace.advanced",
    );
  }

  async revoke({
    skillName,
    expectedStateDigest,
    revocationReceipt,
    propagationRequestDigest = null,
  } = {}) {
    if (propagationRequestDigest !== null) {
      digest(propagationRequestDigest, "propagationRequestDigest");
    }
    const current = await this._exact(skillName, expectedStateDigest);
    const verified = await this._verifyRevocation({
      state: current,
      revocationReceipt,
    });
    if (
      verified?.authenticated !== true ||
      verified.revoked !== true ||
      verified.manifestDigest !== current.manifestDigest ||
      !DIGEST.test(verified.receiptDigest || "")
    )
      throw new Error("marketplace revocation is invalid");
    const transitionRequest = freeze({
      stateDigest: current.stateDigest,
      manifestDigest: current.manifestDigest,
      nextStage: "rolled-back",
      authorityReceiptDigest: verified.receiptDigest,
    });
    const requestDigest = hash(
      "chainlesschain.governed-skill-marketplace-transition/v1",
      transitionRequest,
    );
    const transition = await this._transition({
      request: transitionRequest,
      requestDigest,
      state: current,
      receipt: verified,
    });
    if (
      transition?.authenticated !== true ||
      transition.durable !== true ||
      transition.requestDigest !== requestDigest ||
      transition.nextStage !== "rolled-back" ||
      !DIGEST.test(transition.receiptDigest || "")
    )
      throw new Error("marketplace rollback was not durably applied");
    return this._persist(
      {
        ...current,
        stage: "rolled-back",
        revoked: true,
        revocationReceiptDigest: verified.receiptDigest,
        ...(propagationRequestDigest === null
          ? {}
          : {
              revocationPropagationRequestDigest: propagationRequestDigest,
              revocationBaselineStateDigest: current.stateDigest,
            }),
        transitionRequestDigest: requestDigest,
        transitionReceiptDigest: transition.receiptDigest,
      },
      current.stateDigest,
      "marketplace.revoked",
    );
  }

  async revokeMarketplaceBadge(request) {
    exact(
      request,
      REVOCATION_DEPENDENCY_REQUEST_KEYS,
      "marketplace revocation dependency request",
    );
    exact(
      request.dependency,
      REVOCATION_DEPENDENCY_KEYS,
      "marketplace revocation dependency",
    );
    const expectedRef = `marketplace-state:${this.tenantId}:${request.skillName}`;
    if (
      request.schema !== SKILL_REVOCATION_DEPENDENCY_REQUEST_SCHEMA ||
      request.tenantId !== this.tenantId ||
      request.dependency.kind !== "marketplace-badge" ||
      request.dependency.disposition !== "revoke" ||
      request.dependency.ref !== expectedRef ||
      request.requestDigest !==
        digestSkillRevocationDependencyRequest(request) ||
      !DIGEST.test(request.dependency.digest ?? "") ||
      !DIGEST.test(request.transitionDigest ?? "") ||
      !DIGEST.test(request.candidateId ?? "") ||
      !DIGEST.test(request.sourceReceiptDigest ?? "") ||
      !DIGEST.test(request.resolutionDigest ?? "")
    ) {
      throw new Error("marketplace revocation dependency is not exactly bound");
    }
    id(request.skillName, "skillName");
    id(request.streamId, "streamId");
    id(request.operationId, "operationId");
    if (new Date(request.occurredAt).toISOString() !== request.occurredAt) {
      throw new Error("marketplace revocation timestamp is invalid");
    }
    let current = await this._verifiedState(request.skillName);
    const expectedStateDigest = request.dependency.digest;
    if (!(
      current.revoked === true &&
      current.stage === "rolled-back" &&
      current.revocationBaselineStateDigest === expectedStateDigest &&
      current.revocationPropagationRequestDigest === request.requestDigest
    )) {
      if (current.stateDigest !== expectedStateDigest) {
        throw new Error("marketplace revocation dependency baseline changed");
      }
      try {
        current = await this.revoke({
          skillName: request.skillName,
          expectedStateDigest,
          revocationReceipt: request,
          propagationRequestDigest: request.requestDigest,
        });
      } catch (cause) {
        const recovered = await this._verifiedState(request.skillName);
        if (
          recovered.revoked !== true ||
          recovered.stage !== "rolled-back" ||
          recovered.revocationBaselineStateDigest !== expectedStateDigest ||
          recovered.revocationPropagationRequestDigest !== request.requestDigest
        ) {
          throw cause;
        }
        current = recovered;
      }
    }
    return freeze({
      schema: SKILL_REVOCATION_DEPENDENCY_RESULT_SCHEMA,
      authenticated: true,
      durable: true,
      applied: true,
      idempotent: true,
      tenantId: this.tenantId,
      operationId: request.operationId,
      requestDigest: request.requestDigest,
      dependencyKind: request.dependency.kind,
      dependencyRef: request.dependency.ref,
      dependencyDigest: request.dependency.digest,
      disposition: request.dependency.disposition,
      receiptDigest: current.stateDigest,
    });
  }

  async _verifiedState(skillName) {
    const current = await this._load({ skillName });
    record(current, "marketplace state");
    for (const key of Reflect.ownKeys(current)) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new Error("marketplace state contains an unsafe field");
      }
    }
    const core = clone(current);
    delete core.stateDigest;
    if (
      current.schema !== GOVERNED_SKILL_MARKETPLACE_STATE_SCHEMA ||
      current.tenantId !== this.tenantId ||
      current.skillName !== skillName ||
      current.stateDigest !==
        hash(GOVERNED_SKILL_MARKETPLACE_STATE_SCHEMA, core)
    ) {
      throw new Error("marketplace state is unauthenticated or corrupt");
    }
    return current;
  }

  async _exact(skillName, expectedStateDigest) {
    id(skillName, "skillName");
    digest(expectedStateDigest, "expectedStateDigest");
    const current = await this._verifiedState(skillName);
    if (!current || current.stateDigest !== expectedStateDigest)
      throw new Error("marketplace state changed or is missing");
    return current;
  }

  async _persist(input, expectedStateDigest, event) {
    const core = { ...clone(input) };
    delete core.stateDigest;
    const state = freeze({
      ...core,
      stateDigest: hash(GOVERNED_SKILL_MARKETPLACE_STATE_SCHEMA, core),
    });
    const result = await this._commit({ state, expectedStateDigest, event });
    if (
      result?.authenticated !== true ||
      result.durable !== true ||
      result.stateDigest !== state.stateDigest ||
      result.expectedStateDigest !== expectedStateDigest
    )
      throw new Error("marketplace governance state was not durably committed");
    return state;
  }
}
