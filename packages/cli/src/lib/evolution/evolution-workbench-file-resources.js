import fs from "node:fs";
import path from "node:path";
import { types } from "node:util";
import { ArtifactStore } from "../artifact-store.js";
import { ensurePrivateDirectory } from "../secure-fs.js";
import { EvolutionArtifactPorts } from "./evolution-artifact-ports.js";
import { createEvolutionLedgerFileBackend } from "./evolution-ledger-file-backend.js";
import { createEvolutionLedgerPorts } from "./evolution-ledger-ports.js";
import { SkillReleaseRegistry } from "./skill-release-registry.js";
import { capturePruningData as capture } from "./governed-wiki-pruning-journal.js";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const STORAGE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const FILE_RESOURCES = new WeakSet();

export function captureWorkbenchFileResources(value) {
  if (!FILE_RESOURCES.has(value))
    throw new TypeError("genuine Workbench file resources are required");
  return value;
}
const DESCRIPTOR_KEYS = [
  "tenantId",
  "artifactTenantId",
  "streamId",
  "runId",
  "skillName",
  "audience",
  "purpose",
  "authorityId",
  "revision",
  "handlerArtifactDigest",
];
const STORAGE_KEYS = [
  "artifactDir",
  "ledgerRootDir",
  "ledgerAuthorityRootDir",
  "witnessFilePath",
  "witnessId",
  "releaseRootDir",
];

function record(
  value,
  required,
  optional = [],
  label = "Workbench file resources",
) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    types.isProxy(value)
  )
    throw new TypeError(`${label} must be an explicit data record`);
  const properties = Object.getOwnPropertyDescriptors(value);
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !Object.hasOwn(properties, key)) ||
    Reflect.ownKeys(properties).some((key) => !allowed.has(key))
  )
    throw new TypeError(`${label} has missing or unsupported fields`);
  const result = {};
  for (const [key, property] of Object.entries(properties)) {
    if (!Object.hasOwn(property, "value") || !property.enumerable)
      throw new TypeError(`${label}.${key} must be an own data field`);
    result[key] = property.value;
  }
  return result;
}

function fixed(owner, name, label) {
  if (!owner || typeof owner !== "object" || types.isProxy(owner))
    throw new TypeError(`${label}.${name} port is required`);
  const fn = Object.getOwnPropertyDescriptor(owner, name)?.value;
  if (typeof fn !== "function" || types.isProxy(fn))
    throw new TypeError(`${label}.${name} must be a fixed own method`);
  return Object.freeze(fn.bind(owner));
}

function signingAuthority(input, label) {
  const value = record(input, ["trust", "signer", "verifier"], [], label);
  const trust = capture(
    record(
      value.trust,
      ["algorithm", "keyId", "trustPolicyDigest"],
      [],
      `${label}.trust`,
    ),
  );
  if (
    typeof trust.algorithm !== "string" ||
    !/^[a-z0-9][a-z0-9._+-]{0,63}$/u.test(trust.algorithm) ||
    typeof trust.keyId !== "string" ||
    trust.keyId.length > 256 ||
    !/^[a-z][a-z0-9+.-]{1,31}:[^\s\\]+$/u.test(trust.keyId) ||
    !DIGEST.test(trust.trustPolicyDigest)
  )
    throw new TypeError(`${label} trust is invalid`);
  return Object.freeze({
    trust,
    signer: Object.freeze({ sign: fixed(value.signer, "sign", label) }),
    verifier: Object.freeze({ verify: fixed(value.verifier, "verify", label) }),
  });
}

function normalizedPath(value, label) {
  if (
    typeof value !== "string" ||
    !path.isAbsolute(value) ||
    value.includes("\0")
  )
    throw new TypeError(`${label} must be an absolute path`);
  const result = path.resolve(value);
  if (result === path.parse(result).root)
    throw new TypeError(`${label} must be a dedicated storage path`);
  return result;
}

function contained(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function assertNoAliases(io, target, directory = true) {
  for (let current = target; ; current = path.dirname(current)) {
    let stat;
    try {
      stat = io.lstatSync(current);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (stat) {
      const actual = io.realpathSync(current);
      if (stat.isSymbolicLink() || path.relative(actual, current) !== "")
        throw new Error("Workbench storage aliases/symlinks are not allowed");
      if (
        current === target &&
        (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)
      )
        throw new Error(
          "Workbench storage path has an invalid file type or link count",
        );
      if (current !== target && !stat.isDirectory())
        throw new Error("Workbench storage ancestor is not a directory");
    }
    if (path.dirname(current) === current) break;
  }
}

/**
 * Opens real persistence, not a fixture or a permission authority. The caller
 * still provides identity, human approval and mutation authority to the host.
 * Returned writers are for the authenticated deployment module only, never RPC.
 */
export function openEvolutionWorkbenchFileResources(input) {
  const options = record(
    input,
    ["descriptor", "storage", "authorities"],
    ["secure", "fsImpl", "now"],
  );
  const descriptor = capture(
    record(options.descriptor, DESCRIPTOR_KEYS, [], "Workbench descriptor"),
  );
  for (const key of [
    "tenantId",
    "artifactTenantId",
    "streamId",
    "runId",
    "skillName",
    "audience",
    "authorityId",
  ])
    if (typeof descriptor[key] !== "string" || !ID.test(descriptor[key]))
      throw new TypeError(`Workbench ${key} is invalid`);
  for (const key of ["artifactTenantId", "audience"])
    if (!STORAGE_ID.test(descriptor[key]))
      throw new TypeError(`Workbench storage ${key} is invalid`);
  if (
    descriptor.purpose !== "evolution-ledger" ||
    !Number.isSafeInteger(descriptor.revision) ||
    descriptor.revision < 1 ||
    !DIGEST.test(descriptor.handlerArtifactDigest)
  )
    throw new TypeError(
      "Workbench descriptor purpose/revision/handler digest is invalid",
    );
  const storage = record(
    options.storage,
    STORAGE_KEYS,
    [],
    "Workbench storage",
  );
  if (
    typeof storage.witnessId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u.test(storage.witnessId)
  )
    throw new TypeError("Workbench witnessId is invalid");
  for (const key of STORAGE_KEYS.filter((key) => key !== "witnessId"))
    storage[key] = normalizedPath(storage[key], key);
  const directories = [
    storage.artifactDir,
    storage.ledgerRootDir,
    storage.ledgerAuthorityRootDir,
    storage.releaseRootDir,
    path.dirname(storage.witnessFilePath),
  ];
  for (let i = 0; i < directories.length; i++)
    for (let j = i + 1; j < directories.length; j++)
      if (
        contained(directories[i], directories[j]) ||
        contained(directories[j], directories[i])
      )
        throw new Error(
          "Workbench artifact, Ledger, authority, witness and Registry storage must be non-overlapping",
        );

  const secure = options.secure === undefined ? true : options.secure;
  if (typeof secure !== "boolean")
    throw new TypeError("Workbench secure must be boolean");
  const io = options.fsImpl ?? fs;
  if (!io || typeof io !== "object" || types.isProxy(io))
    throw new TypeError("Workbench filesystem is invalid");
  const clock = options.now ?? Date.now;
  if (typeof clock !== "function" || types.isProxy(clock))
    throw new TypeError("Workbench clock must be a fixed function");
  const now = Object.freeze(() => {
    const value = Number(clock());
    if (!Number.isFinite(value) || Math.abs(value) > 8_640_000_000_000_000)
      throw new TypeError("Workbench clock is invalid");
    return value;
  });
  now();
  const authorities = record(
    options.authorities,
    ["artifact", "ledger", "witness", "releaseDurability"],
    [],
    "Workbench authorities",
  );
  const artifact = record(
    authorities.artifact,
    ["envelopeSigner", "envelopeVerifier", "currentAuthorityResolver"],
    [],
    "Workbench artifact authority",
  );
  const artifactAuthority = {
    envelopeSigner: Object.freeze({
      sign: fixed(artifact.envelopeSigner, "sign", "artifact"),
    }),
    envelopeVerifier: Object.freeze({
      verify: fixed(artifact.envelopeVerifier, "verify", "artifact"),
    }),
    currentAuthorityResolver: Object.freeze({
      resolve: fixed(artifact.currentAuthorityResolver, "resolve", "artifact"),
    }),
  };
  const ledgerAuthority = signingAuthority(authorities.ledger, "ledger");
  const witnessAuthority = signingAuthority(authorities.witness, "witness");
  // Check original identities before capturing wrappers, which must not disguise
  // use of the same authority for the event log and its independent witness.
  if (
    authorities.ledger === authorities.witness ||
    authorities.ledger.signer === authorities.witness.signer ||
    authorities.ledger.verifier === authorities.witness.verifier ||
    ledgerAuthority.trust.keyId === witnessAuthority.trust.keyId ||
    ledgerAuthority.trust.trustPolicyDigest ===
      witnessAuthority.trust.trustPolicyDigest
  )
    throw new TypeError(
      "Workbench Ledger and witness authorities must be independent",
    );
  const durability = record(
    authorities.releaseDurability,
    ["id", "retain", "resolve"],
    [],
    "release durability authority",
  );
  if (typeof durability.id !== "string" || !STORAGE_ID.test(durability.id))
    throw new TypeError("release durability authority id is invalid");
  const artifactDurabilityAuthority = Object.freeze({
    id: durability.id,
    retain: fixed(
      authorities.releaseDurability,
      "retain",
      "release durability",
    ),
    resolve: fixed(
      authorities.releaseDurability,
      "resolve",
      "release durability",
    ),
  });
  // All configuration and authority ports are captured before any storage opens.
  for (const target of directories) assertNoAliases(io, target);
  assertNoAliases(io, storage.witnessFilePath, false);
  if (secure) {
    for (const target of [
      storage.artifactDir,
      path.dirname(storage.witnessFilePath),
    ])
      ensurePrivateDirectory(target, {
        applyWindowsAcl: true,
        failIfUnavailable: true,
        deps: { fs: io },
      });
  } else {
    io.mkdirSync(path.dirname(storage.witnessFilePath), {
      recursive: true,
      mode: 0o700,
    });
  }
  function open() {
    for (const target of directories) assertNoAliases(io, target);
    const artifactPorts = new EvolutionArtifactPorts({
      artifactStore: new ArtifactStore({ dir: storage.artifactDir, now }),
      tenantId: descriptor.artifactTenantId,
      audience: descriptor.audience,
      ...artifactAuthority,
      now,
    });
    const ledgerArtifactResolver =
      artifactPorts.createEvolutionLedgerArtifactResolver({
        purpose: descriptor.purpose,
      });
    const { ledger } = createEvolutionLedgerFileBackend({
      rootDir: storage.ledgerRootDir,
      authorityRootDir: storage.ledgerAuthorityRootDir,
      witnessFilePath: storage.witnessFilePath,
      witnessId: storage.witnessId,
      ledgerAuthority,
      witnessAuthority,
      artifactResolver: ledgerArtifactResolver,
      secure,
      fsImpl: io,
      clock: now,
    });
    const ports = createEvolutionLedgerPorts({
      artifactPorts,
      ledger,
      artifactTenantId: descriptor.artifactTenantId,
      audience: descriptor.audience,
      purpose: descriptor.purpose,
      artifactDurabilityAuthority,
    });
    // Constructor authenticates and recovers the actual Registry journal.
    const releaseRegistry = new SkillReleaseRegistry({
      tenantId: descriptor.tenantId,
      rootDir: storage.releaseRootDir,
      transactionLedger: ports.transactionLedger,
      secure,
      fsImpl: io,
    });
    return {
      artifactPorts,
      ledger,
      ledgerArtifactResolver,
      releaseRegistry,
      ...ports,
    };
  }
  const primary = open();
  const verifier = open();
  for (const target of directories) assertNoAliases(io, target);
  assertNoAliases(io, storage.witnessFilePath, false);
  // Authenticate both complete stores now, not just their constructor shapes.
  const left = primary.ledger.verify();
  const right = verifier.ledger.verify();
  for (const key of [
    "epoch",
    "ledgerId",
    "identityDigest",
    "sequence",
    "headDigest",
  ])
    if (left[key] !== right[key])
      throw new Error("Workbench file readers disagree at startup");
  const result = Object.freeze({
    runtimeResources: Object.freeze({
      descriptor,
      artifactPorts: primary.artifactPorts,
      ledger: primary.ledger,
      ledgerArtifactResolver: primary.ledgerArtifactResolver,
      releaseRegistry: primary.releaseRegistry,
      transactionLedger: primary.transactionLedger,
      verifierLedger: verifier.ledger,
      verifierLedgerArtifactResolver: verifier.ledgerArtifactResolver,
      verifierReleaseRegistry: verifier.releaseRegistry,
      verifierTransactionLedger: verifier.transactionLedger,
      now,
    }),
    mutationPorts: Object.freeze({
      auditSink: primary.auditSink,
      nonceStore: primary.nonceStore,
    }),
  });
  FILE_RESOURCES.add(result);
  return result;
}
