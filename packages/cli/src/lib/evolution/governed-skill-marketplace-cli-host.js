import { types as utilTypes } from "node:util";
import { GovernedSkillMarketplace } from "./governed-skill-marketplace.js";
import { isGovernedSkillMarketplaceLedgerAdapter } from "./governed-skill-marketplace-ledger-adapter.js";

const HOSTS = new WeakSet();
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const TARGET_KEYS = ["model", "os", "runtime", "tool"];

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
  const resolve = capture(catalog, "resolve");
  const load = ledgerAdapter.load;
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

  const stateFor = async (skillName) => {
    id(skillName, "skillName");
    const state = await load({ skillName });
    if (state && TARGET_KEYS.some((key) => state.target[key] !== target[key]))
      throw new Error("marketplace state belongs to another deployment target");
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
  const exactState = async (skillName, expectedStateDigest) => {
    digest(expectedStateDigest, "expectedStateDigest");
    const state = await stateFor(skillName);
    if (!state || state.stateDigest !== expectedStateDigest)
      throw new Error("marketplace state baseline changed");
    return state;
  };

  const host = Object.freeze({
    tenantId,
    target,
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
        state?.stage === "candidate" &&
        state.revoked === false &&
        state.manifestDigest === manifestDigest &&
        state.adaptedOutputDigest === inspected.adapted.outputDigest &&
        state.previousStateDigest === expectedStateDigest;
      const result = (state, recovered) =>
        Object.freeze({
          status: "candidate-staged",
          activated: false,
          recovered,
          state,
        });
      const current = await stateFor(skillName);
      if (isReplay(current)) return result(current, true);
      if (current?.manifestDigest === manifestDigest)
        throw new Error(
          "marketplace manifest is already staged, advanced or revoked",
        );
      if ((current?.stateDigest ?? null) !== expectedStateDigest)
        throw new Error("marketplace install baseline changed");
      try {
        return result(
          await marketplace.stage({ manifest, target, expectedStateDigest }),
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
      await exactState(skillName, expectedStateDigest);
      return marketplace.advance({
        skillName,
        expectedStateDigest,
        pilotReceipt: receiptRef,
      });
    },
    async revoke({ skillName, expectedStateDigest, receiptRef } = {}) {
      id(receiptRef, "revocation receipt reference");
      await exactState(skillName, expectedStateDigest);
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
