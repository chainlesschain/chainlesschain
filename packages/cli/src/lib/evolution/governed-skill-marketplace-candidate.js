import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { types as utilTypes } from "node:util";
import {
  SkillCandidateRegistry,
  SKILL_CANDIDATE_MAX_ARTIFACT_BYTES,
  verifySkillCandidateDraft,
} from "./skill-candidate-registry.js";

export const GOVERNED_SKILL_MARKETPLACE_CANDIDATE_BINDING_SCHEMA =
  "chainlesschain.governed-skill-marketplace-candidate-binding/v1";
const INSTALLERS = new WeakSet();
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const BINDING_DIGESTS = [
  "manifestDigest",
  "packageDigest",
  "adaptedOutputDigest",
  "candidateId",
  "contentDigest",
  "dependencyLockDigest",
  "runtimeManifestDigest",
  "targetMatrixRoot",
  "sbomDigest",
  "permissionManifestDigest",
  "bindingDigest",
];
const BINDING_KEYS = new Set([
  "schema",
  "tenantId",
  "skillName",
  ...BINDING_DIGESTS,
]);

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function hash(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function bindingDigest(core) {
  return hash(
    `${GOVERNED_SKILL_MARKETPLACE_CANDIDATE_BINDING_SCHEMA}\0${canonical(core)}`,
  );
}

export function serializeGovernedSkillMarketplaceCandidatePackage(candidate) {
  return Buffer.from(
    `${canonical(verifySkillCandidateDraft(candidate))}\n`,
    "utf8",
  );
}

export function digestGovernedSkillMarketplaceCandidatePermissions(candidate) {
  const verified = verifySkillCandidateDraft(candidate);
  return hash(
    `chainlesschain.governed-skill-marketplace-permissions/v1\0${canonical({
      tenantId: verified.tenantId,
      skillName: verified.skillName,
      requestedCapabilities: verified.requestedCapabilities,
    })}`,
  );
}

export function verifyGovernedSkillMarketplaceCandidateBinding(
  value,
  expected,
) {
  if (
    !value ||
    utilTypes.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new TypeError("marketplace candidate binding is invalid");
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== BINDING_KEYS.size ||
    keys.some((key) => !BINDING_KEYS.has(key))
  )
    throw new TypeError("marketplace candidate binding has invalid fields");
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor ||
      !Object.hasOwn(descriptor, "value") ||
      !descriptor.enumerable
    )
      throw new TypeError(
        "marketplace candidate binding must contain data fields",
      );
  }
  const { bindingDigest: supplied, ...core } = value;
  if (
    value.schema !== GOVERNED_SKILL_MARKETPLACE_CANDIDATE_BINDING_SCHEMA ||
    BINDING_DIGESTS.some(
      (key) => typeof value[key] !== "string" || !DIGEST.test(value[key]),
    ) ||
    supplied !== bindingDigest(core) ||
    [
      "tenantId",
      "skillName",
      "manifestDigest",
      "packageDigest",
      "adaptedOutputDigest",
    ].some((key) => value[key] !== expected[key])
  )
    throw new Error("marketplace candidate binding does not match its state");
  return Object.freeze({ ...value });
}

function bytes(value, expectedDigest, name) {
  if (
    utilTypes.isProxy(value) ||
    !Buffer.isBuffer(value) ||
    value.length === 0 ||
    value.length > SKILL_CANDIDATE_MAX_ARTIFACT_BYTES
  )
    throw new TypeError(`marketplace ${name} must be bounded bytes`);
  const snapshot = Buffer.from(value);
  if (hash(snapshot) !== expectedDigest)
    throw new Error(`marketplace ${name} digest mismatch`);
  return snapshot;
}

function parsePackage(value) {
  let candidate;
  try {
    candidate = verifySkillCandidateDraft(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(value)),
    );
  } catch (cause) {
    throw new Error(
      "marketplace package is not a verified Candidate v2 artifact",
      { cause },
    );
  }
  if (
    !serializeGovernedSkillMarketplaceCandidatePackage(candidate).equals(value)
  )
    throw new Error("marketplace candidate package is not canonical");
  return candidate;
}

function matchManifest(candidate, manifest) {
  if (
    candidate.tenantId !== manifest.tenantId ||
    candidate.skillName !== manifest.skillName ||
    candidate.dependencyLockDigest !== manifest.dependencyLockDigest ||
    candidate.targetMatrixRoot !== manifest.targetMatrixDigest ||
    digestGovernedSkillMarketplaceCandidatePermissions(candidate) !==
      manifest.permissionManifestDigest ||
    candidate.sourceEvidenceRefs.some(
      ({ digest }) => !manifest.lineage.includes(digest),
    )
  )
    throw new Error(
      "marketplace candidate provenance, execution or permissions differ from the signed manifest",
    );
}

function candidateInput(candidate) {
  return Object.fromEntries(
    [
      "tenantId",
      "skillName",
      "content",
      "dependencyLock",
      "runtimeManifest",
      "targetMatrix",
      "sourceEvidenceRefs",
      "derivationMode",
      "wikiRevision",
      "proposerModel",
      "parentDigest",
      "requestedCapabilities",
    ].map((key) => [key, candidate[key]]),
  );
}

export function isGovernedSkillMarketplaceCandidateInstaller(value) {
  return INSTALLERS.has(value);
}

/** Owns an actual candidate-only registry; never accepts a caller-supplied write acknowledgement. */
export function createGovernedSkillMarketplaceCandidateInstaller({
  tenantId,
  registryOptions,
  artifacts,
} = {}) {
  const resolve = artifacts?.resolve;
  if (typeof resolve !== "function")
    throw new TypeError("marketplace artifact resolver is required");
  if (
    !registryOptions ||
    typeof registryOptions.rootDir !== "string" ||
    !isAbsolute(registryOptions.rootDir) ||
    (registryOptions.tenantId !== undefined &&
      registryOptions.tenantId !== tenantId)
  )
    throw new TypeError(
      "marketplace candidate registry requires an explicit same-tenant root",
    );
  const authority = registryOptions.targetMatrixAdmissionAuthority;
  if (!authority || typeof authority.resolve !== "function")
    throw new TypeError(
      "marketplace candidate admission authority is required",
    );
  const admissionResolve = authority.resolve;
  const options = Object.freeze({
    ...registryOptions,
    tenantId,
    targetMatrixAdmissionAuthority: Object.freeze({
      ...authority,
      resolve: (...args) => Reflect.apply(admissionResolve, authority, args),
    }),
  });
  // Opening the registry validates every stored artifact. Defer that operation
  // so a fresh CLI process can still revoke a corrupted candidate using Ledger
  // authority alone. Materialize/read never fall back to an unverified store.
  let registry = null;
  const open = () => (registry ??= new SkillCandidateRegistry(options));
  const read = (candidateId) => open().read(candidateId);
  const create = (input) => open().create(input);
  const verifyStored = (binding) => {
    const candidate = read(binding.candidateId);
    if (
      candidate.tenantId !== tenantId ||
      candidate.skillName !== binding.skillName ||
      [
        "contentDigest",
        "dependencyLockDigest",
        "runtimeManifestDigest",
        "targetMatrixRoot",
      ].some((key) => candidate[key] !== binding[key]) ||
      hash(serializeGovernedSkillMarketplaceCandidatePackage(candidate)) !==
        binding.adaptedOutputDigest ||
      digestGovernedSkillMarketplaceCandidatePermissions(candidate) !==
        binding.permissionManifestDigest
    )
      throw new Error(
        "marketplace stored candidate does not match its durable binding",
      );
    return binding;
  };
  const installer = Object.freeze({
    tenantId,
    async materialize(inspected) {
      const { manifest, adapted, target } = inspected;
      if (manifest.tenantId !== tenantId)
        throw new Error("marketplace candidate tenant mismatch");
      const request = Object.freeze({
        tenantId,
        skillName: manifest.skillName,
        version: manifest.version,
        packageDigest: manifest.packageDigest,
        adaptedOutputDigest: adapted.outputDigest,
        sbomDigest: manifest.sbomDigest,
      });
      const resolved = await Reflect.apply(resolve, artifacts, [request]);
      const sourceBytes = bytes(
        resolved?.packageBytes,
        request.packageDigest,
        "source package",
      );
      const adaptedBytes = bytes(
        resolved?.adaptedBytes,
        request.adaptedOutputDigest,
        "adapted package",
      );
      bytes(resolved?.sbomBytes, request.sbomDigest, "SBOM");
      const source = parsePackage(sourceBytes);
      const candidate = parsePackage(adaptedBytes);
      matchManifest(source, manifest);
      matchManifest(candidate, manifest);
      const runtime = candidate.runtimeManifest.runtimes.find(
        ({ runtimeId }) => runtimeId === target.tool,
      );
      if (
        !candidate.targetRuntimes.includes(target.tool) ||
        runtime?.descriptor.platform !== target.os ||
        runtime.descriptor.runtime !== target.runtime
      )
        throw new Error(
          "marketplace adapted candidate runtime does not match the evaluated target",
        );
      const core = {
        schema: GOVERNED_SKILL_MARKETPLACE_CANDIDATE_BINDING_SCHEMA,
        tenantId,
        skillName: manifest.skillName,
        manifestDigest: manifest.manifestDigest,
        ...request,
        candidateId: candidate.candidateId,
        contentDigest: candidate.contentDigest,
        dependencyLockDigest: candidate.dependencyLockDigest,
        runtimeManifestDigest: candidate.runtimeManifestDigest,
        targetMatrixRoot: candidate.targetMatrixRoot,
        permissionManifestDigest: manifest.permissionManifestDigest,
      };
      delete core.version;
      const binding = Object.freeze({
        ...core,
        bindingDigest: bindingDigest(core),
      });
      const result = create(candidateInput(candidate));
      if (result.candidate.candidateId !== candidate.candidateId)
        throw new Error(
          "marketplace candidate registry returned a different candidate",
        );
      return verifyStored(binding);
    },
    verify(state) {
      if (state?.tenantId !== tenantId)
        throw new Error("marketplace candidate tenant mismatch");
      return verifyStored(
        verifyGovernedSkillMarketplaceCandidateBinding(
          state.candidateBinding,
          state,
        ),
      );
    },
  });
  INSTALLERS.add(installer);
  return installer;
}
