import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

export const GOVERNED_SKILL_MARKETPLACE_MANIFEST_SCHEMA =
  "chainlesschain.governed-skill-marketplace-manifest/v1";
export const GOVERNED_SKILL_MARKETPLACE_STATE_SCHEMA =
  "chainlesschain.governed-skill-marketplace-state/v1";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const STAGES = new Map([
  ["candidate", "shadow"],
  ["shadow", "canary"],
  ["canary", "active"],
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

  async revoke({ skillName, expectedStateDigest, revocationReceipt } = {}) {
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
        transitionRequestDigest: requestDigest,
        transitionReceiptDigest: transition.receiptDigest,
      },
      current.stateDigest,
      "marketplace.revoked",
    );
  }

  async _exact(skillName, expectedStateDigest) {
    id(skillName, "skillName");
    digest(expectedStateDigest, "expectedStateDigest");
    const current = await this._load({ skillName });
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
