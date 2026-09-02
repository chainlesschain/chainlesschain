import fs from "node:fs";
import path from "node:path";
import { createEvolutionFileWitness } from "./evolution-file-witness.js";
import { EvolutionLedger } from "./evolution-ledger.js";

export const EVOLUTION_LEDGER_FILE_BACKEND_SCHEMA =
  "chainlesschain.evolution-ledger-file-backend/v1";

const BACKENDS = new WeakSet();

function requiredString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} is required`);
  }
  return value;
}

function capture(owner, name, label) {
  if (typeof owner?.[name] !== "function") {
    throw new TypeError(`${label}.${name} port is required`);
  }
  const operation = owner[name].bind(owner);
  return Object.freeze((...args) => operation(...args));
}

function normalizeAuthority(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} authority is required`);
  }
  const trust = value.trust;
  return Object.freeze({
    trust,
    signerIdentity: value.signer,
    verifierIdentity: value.verifier,
    sign: capture(value.signer, "sign", `${label}.signer`),
    verify: capture(value.verifier, "verify", `${label}.verifier`),
  });
}

function contained(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function assertIndependentStorage(rootDir, authorityRootDir, witnessFilePath) {
  const eventRoot = path.resolve(rootDir);
  const authorityRoot = path.resolve(authorityRootDir);
  const witnessPath = path.resolve(witnessFilePath);
  if (
    contained(eventRoot, authorityRoot) ||
    contained(authorityRoot, eventRoot) ||
    contained(eventRoot, witnessPath) ||
    contained(authorityRoot, witnessPath)
  ) {
    throw new Error(
      "event, authority, and witness storage must be independent and non-overlapping",
    );
  }
  return Object.freeze({ eventRoot, authorityRoot, witnessPath });
}

function assertIndependentAuthorities(ledgerAuthority, witnessAuthority) {
  const ledgerTrust = ledgerAuthority.trust;
  const witnessTrust = witnessAuthority.trust;
  if (
    !ledgerTrust ||
    !witnessTrust ||
    ledgerAuthority.signerIdentity === witnessAuthority.signerIdentity ||
    ledgerAuthority.verifierIdentity === witnessAuthority.verifierIdentity ||
    ledgerTrust === witnessTrust ||
    ledgerTrust.keyId === witnessTrust.keyId ||
    ledgerTrust.trustPolicyDigest === witnessTrust.trustPolicyDigest
  ) {
    throw new Error(
      "ledger and witness must use independent trust, signer, verifier, keyId, and policy roots",
    );
  }
}

export function createEvolutionLedgerFileBackend({
  rootDir,
  authorityRootDir,
  witnessFilePath,
  witnessId,
  ledgerAuthority: ledgerAuthorityInput,
  witnessAuthority: witnessAuthorityInput,
  artifactResolver,
  secure = true,
  fsImpl = fs,
  clock = Date.now,
  lockClock = Date.now,
  random,
  lock,
  lockTimeoutMs,
  crashHook = null,
  witnessMaximumBytes,
} = {}) {
  if (typeof artifactResolver !== "function") {
    throw new TypeError("artifactResolver port is required");
  }
  const paths = assertIndependentStorage(
    requiredString(rootDir, "rootDir"),
    requiredString(authorityRootDir, "authorityRootDir"),
    requiredString(witnessFilePath, "witnessFilePath"),
  );
  const ledgerAuthority = normalizeAuthority(
    ledgerAuthorityInput,
    "ledgerAuthority",
  );
  const witnessAuthority = normalizeAuthority(
    witnessAuthorityInput,
    "witnessAuthority",
  );
  assertIndependentAuthorities(ledgerAuthority, witnessAuthority);

  const witnessOptions = {
    id: requiredString(witnessId, "witnessId"),
    filePath: paths.witnessPath,
    trust: witnessAuthority.trust,
    signer: { sign: witnessAuthority.sign },
    verifier: { verify: witnessAuthority.verify },
    fsImpl,
    ...(lock === undefined ? {} : { lock }),
    ...(random === undefined ? {} : { random }),
    ...(witnessMaximumBytes === undefined
      ? {}
      : { maximumBytes: witnessMaximumBytes }),
  };
  const witness = createEvolutionFileWitness(witnessOptions);
  const ledger = new EvolutionLedger({
    rootDir: paths.eventRoot,
    authorityRootDir: paths.authorityRoot,
    secure,
    fsImpl,
    clock,
    lockClock,
    trust: ledgerAuthority.trust,
    sign: ledgerAuthority.sign,
    verifySignature: ledgerAuthority.verify,
    verifyWitnessSignature: witnessAuthority.verify,
    artifactResolver,
    witness,
    witnessTrust: witnessAuthority.trust,
    ...(random === undefined ? {} : { random }),
    ...(lock === undefined ? {} : { lock }),
    ...(lockTimeoutMs === undefined ? {} : { lockTimeoutMs }),
    crashHook,
  });
  const backend = Object.freeze({
    schema: EVOLUTION_LEDGER_FILE_BACKEND_SCHEMA,
    descriptor: Object.freeze({
      rootDir: paths.eventRoot,
      authorityRootDir: paths.authorityRoot,
      witnessFilePath: paths.witnessPath,
      witnessId: witness.id,
      ledgerTrust: Object.freeze({ ...ledgerAuthority.trust }),
      witnessTrust: Object.freeze({ ...witnessAuthority.trust }),
    }),
    ledger,
    witness,
  });
  BACKENDS.add(backend);
  return backend;
}

export function captureEvolutionLedgerFileBackend(value) {
  if (!BACKENDS.has(value)) {
    throw new TypeError("a branded EvolutionLedger file backend is required");
  }
  return value;
}
