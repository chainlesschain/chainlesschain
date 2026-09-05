import { types as utilTypes } from "node:util";
import { GovernedSkillMarketplace } from "./governed-skill-marketplace.js";
import { isGovernedSkillMarketplaceLedgerAdapter } from "./governed-skill-marketplace-ledger-adapter.js";
import { isGovernedSkillMarketplaceCandidateInstaller } from "./governed-skill-marketplace-candidate.js";

const HOSTS = new WeakSet();
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const TARGET_KEYS = ["model", "os", "runtime", "tool"];
export const GOVERNED_SKILL_MARKETPLACE_PUBLIC_BADGE_SCHEMA =
  "chainlesschain.governed-skill-marketplace-public-badge/v1";

function id(value, name) {
  if (typeof value !== "string" || !ID.test(value))
    throw new TypeError(`${name} is invalid`);
  return value;
}

function digest(value, name) {
  if (typeof value !== "string" || !DIGEST.test(value))
    throw new TypeError(`${name} is invalid`);
  return value;
}

function capture(owner, name) {
  const callable = owner?.[name];
  if (typeof callable !== "function")
    throw new TypeError(`marketplace ${name} port is required`);
  return (...args) => Reflect.apply(callable, owner, args);
}

function targetSnapshot(value) {
  if (
    !value ||
    utilTypes.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    JSON.stringify(Reflect.ownKeys(value).sort()) !==
      JSON.stringify(TARGET_KEYS)
  )
    throw new TypeError("marketplace deployment target is invalid");
  const result = {};
  for (const key of TARGET_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value"))
      throw new TypeError(
        "marketplace deployment target must contain data fields",
      );
    result[key] = id(descriptor.value, `target ${key}`);
  }
  return Object.freeze(result);
}

export function isGovernedSkillMarketplaceCliHost(value) {
  return HOSTS.has(value);
}

/** Deployment-owned catalog, verification and transition ports. No local fallback. */
export function createGovernedSkillMarketplaceCliHost({
  tenantId,
  target: inputTarget,
  ledgerAdapter,
  candidateInstaller,
  catalog,
  ports,
} = {}) {
  id(tenantId, "tenantId");
  if (
    !isGovernedSkillMarketplaceLedgerAdapter(ledgerAdapter) ||
    ledgerAdapter.descriptor.tenantId !== tenantId
  )
    throw new TypeError(
      "a same-tenant branded marketplace ledger adapter is required",
    );
  const target = targetSnapshot(inputTarget);
  if (
    !isGovernedSkillMarketplaceCandidateInstaller(candidateInstaller) ||
    candidateInstaller.tenantId !== tenantId
  )
    throw new TypeError(
      "a same-tenant branded marketplace candidate installer is required",
    );
  const resolve = capture(catalog, "resolve");
  const load = ledgerAdapter.load;
  const listSkillNames = ledgerAdapter.listSkillNames;
  const isManifestRevoked = ledgerAdapter.isManifestRevoked;
  const marketplace = new GovernedSkillMarketplace({
    tenantId,
    ports: {
      verifySignature: capture(ports, "verifySignature"),
      adapt: capture(ports, "adapt"),
      transition: capture(ports, "transition"),
      verifyPilot: capture(ports, "verifyPilot"),
      verifyRevocation: capture(ports, "verifyRevocation"),
      load,
      commit: ledgerAdapter.commit,
    },
  });

  const stateFor = async (skillName, verifyCandidate = true) => {
    id(skillName, "skillName");
    const state = await load({ skillName });
    if (state && TARGET_KEYS.some((key) => state.target[key] !== target[key]))
      throw new Error("marketplace state belongs to another deployment target");
    if (verifyCandidate && state?.candidateBinding && !state.revoked)
      candidateInstaller.verify(state);
    return state;
  };
  const resolveManifest = async (skillName, version) => {
    id(skillName, "skillName");
    if (version !== null) id(version, "version");
    const manifest = await resolve(
      Object.freeze({ tenantId, skillName, version }),
    );
    if (
      manifest?.tenantId !== tenantId ||
      manifest.skillName !== skillName ||
      (version !== null && manifest.version !== version)
    )
      throw new Error(
        "marketplace catalog returned a different Skill or version",
      );
    return manifest;
  };
  const exactState = async (
    skillName,
    expectedStateDigest,
    verifyCandidate = true,
  ) => {
    digest(expectedStateDigest, "expectedStateDigest");
    const state = await stateFor(skillName, verifyCandidate);
    if (!state || state.stateDigest !== expectedStateDigest)
      throw new Error("marketplace state baseline changed");
    return state;
  };

  const host = Object.freeze({
    tenantId,
    target,
    async list({ offset = 0, limit = 100 } = {}) {
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 500
      )
        throw new TypeError("marketplace list bounds are invalid");
      const names = listSkillNames();
      const items = [];
      for (const skillName of names.slice(offset, offset + limit))
        items.push(await stateFor(skillName));
      return Object.freeze({
        items: Object.freeze(items),
        total: names.length,
        offset,
        limit,
      });
    },
    async inspect({ skillName, version = null } = {}) {
      const manifest = await resolveManifest(skillName, version);
      const inspected = await marketplace.inspect(manifest, target);
      return Object.freeze({
        skillName,
        version: inspected.manifest.version,
        manifestDigest: inspected.manifest.manifestDigest,
        packageDigest: inspected.manifest.packageDigest,
        sourceModel: inspected.manifest.sourceModel,
        target,
        evalBadgeDigest: inspected.manifest.evalBadgeDigest,
        evalReceiptDigest: inspected.cell.evalReceiptDigest,
        qualityScore: inspected.cell.qualityScore,
        sampleCount: inspected.cell.sampleCount,
        adaptedOutputDigest: inspected.adapted.outputDigest,
        state: await stateFor(skillName),
      });
    },
    async preparePublicBadge({ skillName, version, manifestDigest } = {}) {
      id(version, "exact public badge version");
      digest(manifestDigest, "manifestDigest");
      const manifest = await resolveManifest(skillName, version);
      if (manifest.manifestDigest !== manifestDigest)
        throw new Error("public badge manifest changed");
      // Adaptation/evaluation happens only during explicit publication, never
      // in response to anonymous HTTP traffic. The server expires this snapshot.
      const inspected = await marketplace.inspect(manifest, target);
      const projection = Object.freeze({
        schema: GOVERNED_SKILL_MARKETPLACE_PUBLIC_BADGE_SCHEMA,
        skillName,
        version,
        manifestDigest,
        sourceModel: inspected.manifest.sourceModel,
        sourceCommitDigest: inspected.manifest.sourceCommitDigest,
        packageDigest: inspected.manifest.packageDigest,
        sbomDigest: inspected.manifest.sbomDigest,
        dependencyLockDigest: inspected.manifest.dependencyLockDigest,
        permissionManifestDigest: inspected.manifest.permissionManifestDigest,
        targetMatrixDigest: inspected.manifest.targetMatrixDigest,
        evalBadgeDigest: inspected.manifest.evalBadgeDigest,
        evalReceiptDigest: inspected.cell.evalReceiptDigest,
        qualityScore: inspected.cell.qualityScore,
        sampleCount: inspected.cell.sampleCount,
        adaptedOutputDigest: inspected.adapted.outputDigest,
        target,
      });
      return Object.freeze({
        read: async () => {
          const current = await resolveManifest(skillName, version);
          if (current.manifestDigest !== manifestDigest)
            throw new Error("public badge manifest changed");
          await marketplace.verifyListing(current, target);
          const revoked = await isManifestRevoked({
            skillName,
            manifestDigest,
          });
          return Object.freeze({ ...projection, revoked });
        },
      });
    },
    state: ({ skillName } = {}) => stateFor(skillName),
    async install({
      skillName,
      version = null,
      manifestDigest,
      expectedStateDigest = null,
    } = {}) {
      digest(manifestDigest, "manifestDigest");
      if (expectedStateDigest !== null)
        digest(expectedStateDigest, "expectedStateDigest");
      const manifest = await resolveManifest(skillName, version);
      if (manifest.manifestDigest !== manifestDigest)
        throw new Error("marketplace catalog manifest changed; inspect again");
      const inspected = await marketplace.inspect(manifest, target);
      if (await isManifestRevoked({ skillName, manifestDigest }))
        throw new Error(
          "marketplace manifest was revoked and cannot be staged again",
        );
      const isReplay = (state) =>
        state?.candidateBinding !== undefined &&
        state?.stage === "candidate" &&
        state.revoked === false &&
        state.manifestDigest === manifestDigest &&
        state.adaptedOutputDigest === inspected.adapted.outputDigest &&
        state.previousStateDigest === expectedStateDigest;
      const result = (state, recovered) => {
        candidateInstaller.verify(state);
        return Object.freeze({
          status: "candidate-staged",
          activated: false,
          materialized: true,
          recovered,
          state,
        });
      };
      const current = await stateFor(skillName);
      if (isReplay(current)) return result(current, true);
      if (
        current?.manifestDigest === manifestDigest &&
        (current.candidateBinding ||
          current.stage !== "candidate" ||
          current.revoked)
      )
        throw new Error(
          "marketplace manifest is already staged, advanced or revoked",
        );
      if ((current?.stateDigest ?? null) !== expectedStateDigest)
        throw new Error("marketplace install baseline changed");
      const candidateBinding = await candidateInstaller.materialize(inspected);
      try {
        return result(
          await marketplace.stage({
            manifest,
            target,
            expectedStateDigest,
            candidateBinding,
          }),
          false,
        );
      } catch (error) {
        // A durable append may have succeeded before its acknowledgement was lost.
        const recovered = await stateFor(skillName);
        if (isReplay(recovered)) return result(recovered, true);
        throw error;
      }
    },
    async rollout({ skillName, expectedStateDigest, receiptRef } = {}) {
      id(receiptRef, "Pilot receipt reference");
      const current = await exactState(skillName, expectedStateDigest);
      candidateInstaller.verify(current);
      return marketplace.advance({
        skillName,
        expectedStateDigest,
        pilotReceipt: receiptRef,
      });
    },
    async revoke({ skillName, expectedStateDigest, receiptRef } = {}) {
      id(receiptRef, "revocation receipt reference");
      // A missing/corrupt candidate must block rollout, not emergency rollback.
      await exactState(skillName, expectedStateDigest, false);
      return marketplace.revoke({
        skillName,
        expectedStateDigest,
        revocationReceipt: receiptRef,
      });
    },
  });
  HOSTS.add(host);
  return host;
}
