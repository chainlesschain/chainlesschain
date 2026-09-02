import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ensurePrivateDirectory, ensurePrivateFile } from "../secure-fs.js";
import { withFileLock } from "../with-file-lock.js";
import {
  EVOLUTION_LEDGER_WITNESS_ANCESTRY_SCHEMA,
  EVOLUTION_LEDGER_WITNESS_SCHEMA,
} from "./evolution-ledger.js";

export const EVOLUTION_FILE_WITNESS_STORE_SCHEMA =
  "chainlesschain.evolution-file-witness-store/v1";

const WITNESS_DOMAIN = `${EVOLUTION_LEDGER_WITNESS_SCHEMA}\0`;
const ANCESTRY_DOMAIN = `${EVOLUTION_LEDGER_WITNESS_ANCESTRY_SCHEMA}\0`;
const DISCARD_DOMAIN =
  "chainlesschain.evolution-witness-discard-accumulator/v1\0";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;
const DEFAULT_MAXIMUM_BYTES = 64 * 1024 * 1024;
const STORE_KEYS = new Set([
  "current",
  "discardedAnchors",
  "history",
  "schema",
]);
const RECORD_KEYS = new Set([
  "algorithm",
  "anchorDigest",
  "authenticated",
  "discardAccumulatorDigest",
  "durable",
  "epoch",
  "generation",
  "headDigest",
  "identityDigest",
  "keyId",
  "ledgerId",
  "payloadDigest",
  "previousWitnessDigest",
  "schema",
  "segmentDigest",
  "sequence",
  "signature",
  "status",
  "storeMarkerDigest",
  "storeMarkerEntryDigest",
  "storeMarkerId",
  "trustPolicyDigest",
  "witnessDigest",
  "witnessId",
]);
const SIGNATURE_KEYS = new Set([
  "algorithm",
  "keyId",
  "trustPolicyDigest",
  "value",
]);
const DISCARD_KEYS = new Set([
  "anchorDigest",
  "headDigest",
  "segmentDigest",
  "sequence",
]);

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function hash(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${name} is required`);
  }
  return value;
}

function normalizeTrust(value) {
  const algorithm = requiredString(value?.algorithm, "trust.algorithm");
  const keyId = requiredString(value?.keyId, "trust.keyId");
  if (algorithm.length > 64 || keyId.length > 256) {
    throw new TypeError("witness trust descriptor is too large");
  }
  if (!DIGEST.test(value?.trustPolicyDigest || "")) {
    throw new TypeError("trust.trustPolicyDigest must be sha256-bound");
  }
  return Object.freeze({
    algorithm,
    keyId,
    trustPolicyDigest: value.trustPolicyDigest,
  });
}

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is invalid`);
  }
  const keys = Object.keys(value);
  if (keys.length !== expected.size || keys.some((key) => !expected.has(key))) {
    throw new Error(`${label} fields are invalid`);
  }
  return value;
}

function safeCounter(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function nullableDigest(value, label) {
  if (value !== null && !DIGEST.test(value || "")) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function nullableIdentifier(value, label) {
  if (value !== null && !IDENTIFIER.test(value || "")) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function capture(owner, name) {
  if (typeof owner?.[name] !== "function")
    throw new TypeError(`${name} port is required`);
  return (...args) => Reflect.apply(owner[name], owner, args);
}

function sameTrust(value, trust) {
  return (
    value?.algorithm === trust.algorithm &&
    value.keyId === trust.keyId &&
    value.trustPolicyDigest === trust.trustPolicyDigest
  );
}

function clone(value) {
  return structuredClone(value);
}

export function createEvolutionFileWitness({
  id,
  filePath,
  trust: trustInput,
  signer,
  verifier,
  fsImpl = fs,
  lock = withFileLock,
  random = () => crypto.randomBytes(16).toString("hex"),
  maximumBytes = DEFAULT_MAXIMUM_BYTES,
} = {}) {
  if (!IDENTIFIER.test(id || "")) throw new TypeError("witness id is invalid");
  const target = path.resolve(requiredString(filePath, "filePath"));
  const directory = path.dirname(target);
  const trust = normalizeTrust(trustInput);
  const sign = capture(signer, "sign");
  const verify = capture(verifier, "verify");
  if (typeof lock !== "function" || typeof random !== "function") {
    throw new TypeError("witness lock and random ports are required");
  }
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 4096) {
    throw new TypeError("maximumBytes must be a safe integer of at least 4096");
  }
  const secureOptions = { deps: { fs: fsImpl }, failIfUnavailable: true };
  ensurePrivateDirectory(directory, secureOptions);

  const signed = (domain, core, digestField, purpose) => {
    const message = Buffer.from(`${domain}${canonical(core)}`, "utf8");
    const signature = sign({ message, purpose, trust });
    if (
      !sameTrust(signature, trust) ||
      typeof signature.value !== "string" ||
      signature.value === "" ||
      signature.value.length > 16_384
    ) {
      throw new Error("witness signer returned an invalid trust binding");
    }
    assertExactKeys(signature, SIGNATURE_KEYS, "witness signature");
    return Object.freeze({
      ...core,
      [digestField]: hash(message),
      signature: Object.freeze({ ...signature }),
    });
  };

  const verifySigned = (record, domain, digestField, purpose) => {
    assertExactKeys(record, RECORD_KEYS, "witness record");
    const core = clone(record);
    const signature = core.signature;
    const observedDigest = core[digestField];
    delete core.signature;
    delete core[digestField];
    const message = Buffer.from(`${domain}${canonical(core)}`, "utf8");
    assertExactKeys(signature, SIGNATURE_KEYS, "witness signature");
    if (
      !DIGEST.test(observedDigest || "") ||
      observedDigest !== hash(message) ||
      !sameTrust(signature, trust) ||
      verify({ message, purpose, signature, trust }) !== true
    ) {
      throw new Error("witness record authentication failed");
    }
    if (
      record.schema !== EVOLUTION_LEDGER_WITNESS_SCHEMA ||
      record.authenticated !== true ||
      record.durable !== true ||
      record.witnessId !== id ||
      !sameTrust(record, trust) ||
      !["absent", "committed"].includes(record.status)
    ) {
      throw new Error("witness record authority is invalid");
    }
    safeCounter(record.generation, "witness generation");
    nullableDigest(record.anchorDigest, "witness anchorDigest");
    nullableDigest(record.headDigest, "witness headDigest");
    nullableDigest(record.identityDigest, "witness identityDigest");
    nullableDigest(record.payloadDigest, "witness payloadDigest");
    nullableDigest(
      record.previousWitnessDigest,
      "witness previousWitnessDigest",
    );
    nullableDigest(record.segmentDigest, "witness segmentDigest");
    nullableDigest(record.storeMarkerDigest, "witness storeMarkerDigest");
    nullableDigest(
      record.storeMarkerEntryDigest,
      "witness storeMarkerEntryDigest",
    );
    if (!DIGEST.test(record.discardAccumulatorDigest || "")) {
      throw new Error("witness discardAccumulatorDigest is invalid");
    }
    nullableIdentifier(record.epoch, "witness epoch");
    nullableIdentifier(record.ledgerId, "witness ledgerId");
    nullableIdentifier(record.storeMarkerId, "witness storeMarkerId");
    if (record.sequence !== null) {
      safeCounter(record.sequence, "witness sequence");
    }
    const committedRequired = [
      record.anchorDigest,
      record.epoch,
      record.identityDigest,
      record.ledgerId,
      record.payloadDigest,
      record.storeMarkerDigest,
      record.storeMarkerEntryDigest,
      record.storeMarkerId,
    ];
    if (
      (record.status === "absent" &&
        (record.generation !== 0 ||
          record.previousWitnessDigest !== null ||
          record.discardAccumulatorDigest !== emptyDiscardDigest ||
          [
            ...committedRequired,
            record.headDigest,
            record.segmentDigest,
            record.sequence,
          ].some((entry) => entry !== null))) ||
      (record.status === "committed" &&
        (record.generation < 1 ||
          record.previousWitnessDigest === null ||
          record.sequence === null ||
          committedRequired.some((entry) => entry === null) ||
          (record.sequence === 0 &&
            (record.headDigest !== null || record.segmentDigest !== null)) ||
          (record.sequence > 0 &&
            (record.headDigest === null || record.segmentDigest === null))))
    ) {
      throw new Error("witness record state is inconsistent");
    }
    return record;
  };

  const emptyDiscardDigest = hash(
    Buffer.from(`${DISCARD_DOMAIN}${canonical([])}`, "utf8"),
  );
  const witnessRecord = (snapshot = null, previous = null, discard = null) => {
    const discardAccumulatorDigest = discard
      ? hash(
          Buffer.from(
            `${DISCARD_DOMAIN}${canonical({
              discard,
              previousDiscardAccumulatorDigest:
                previous.discardAccumulatorDigest,
              previousWitnessDigest: previous.witnessDigest,
            })}`,
            "utf8",
          ),
        )
      : (previous?.discardAccumulatorDigest ?? emptyDiscardDigest);
    const core = {
      ...trust,
      anchorDigest: snapshot?.anchorDigest ?? null,
      authenticated: true,
      durable: true,
      discardAccumulatorDigest,
      epoch: snapshot?.epoch ?? null,
      generation: previous ? previous.generation + 1 : 0,
      headDigest: snapshot?.headDigest ?? null,
      identityDigest: snapshot?.identityDigest ?? null,
      ledgerId: snapshot?.ledgerId ?? null,
      payloadDigest: snapshot?.payloadDigest ?? null,
      previousWitnessDigest: previous?.witnessDigest ?? null,
      schema: EVOLUTION_LEDGER_WITNESS_SCHEMA,
      segmentDigest: snapshot?.segmentDigest ?? null,
      sequence: snapshot?.sequence ?? null,
      status: snapshot ? "committed" : "absent",
      storeMarkerDigest: snapshot?.storeMarkerDigest ?? null,
      storeMarkerEntryDigest: snapshot?.storeMarkerEntryDigest ?? null,
      storeMarkerId: snapshot?.storeMarkerId ?? null,
      witnessId: id,
    };
    const record = signed(
      WITNESS_DOMAIN,
      core,
      "witnessDigest",
      "evolution-ledger-witness",
    );
    return verifySigned(
      record,
      WITNESS_DOMAIN,
      "witnessDigest",
      "evolution-ledger-witness",
    );
  };

  const emptyStore = () => {
    const current = witnessRecord();
    return {
      schema: EVOLUTION_FILE_WITNESS_STORE_SCHEMA,
      current,
      history: [current],
      discardedAnchors: [],
    };
  };

  const validateStore = (store) => {
    assertExactKeys(store, STORE_KEYS, "witness store");
    if (
      store.schema !== EVOLUTION_FILE_WITNESS_STORE_SCHEMA ||
      !Array.isArray(store.history) ||
      !Array.isArray(store.discardedAnchors) ||
      store.history.length < 1
    ) {
      throw new Error("witness store schema is invalid");
    }
    const genesis = store.history[0];
    if (
      genesis.status !== "absent" ||
      genesis.generation !== 0 ||
      genesis.previousWitnessDigest !== null ||
      genesis.discardAccumulatorDigest !== emptyDiscardDigest ||
      [
        genesis.anchorDigest,
        genesis.epoch,
        genesis.headDigest,
        genesis.identityDigest,
        genesis.ledgerId,
        genesis.payloadDigest,
        genesis.segmentDigest,
        genesis.sequence,
        genesis.storeMarkerDigest,
        genesis.storeMarkerEntryDigest,
        genesis.storeMarkerId,
      ].some((entry) => entry !== null)
    ) {
      throw new Error("witness genesis is invalid");
    }
    for (const discard of store.discardedAnchors) {
      assertExactKeys(discard, DISCARD_KEYS, "witness discard descriptor");
      if (
        !DIGEST.test(discard.anchorDigest || "") ||
        !DIGEST.test(discard.headDigest || "") ||
        !DIGEST.test(discard.segmentDigest || "")
      ) {
        throw new Error("witness discard descriptor digest is invalid");
      }
      safeCounter(discard.sequence, "witness discard sequence");
    }
    let discardIndex = 0;
    for (const [index, record] of store.history.entries()) {
      verifySigned(
        record,
        WITNESS_DOMAIN,
        "witnessDigest",
        "evolution-ledger-witness",
      );
      if (index === 0) continue;
      const previous = store.history[index - 1];
      if (
        record.status !== "committed" ||
        record.previousWitnessDigest !== previous.witnessDigest ||
        record.generation !== previous.generation + 1
      ) {
        throw new Error("witness history is not monotonic");
      }
      if (
        record.discardAccumulatorDigest !== previous.discardAccumulatorDigest
      ) {
        const discard = store.discardedAnchors[discardIndex++];
        const expected = hash(
          Buffer.from(
            `${DISCARD_DOMAIN}${canonical({
              discard,
              previousDiscardAccumulatorDigest:
                previous.discardAccumulatorDigest,
              previousWitnessDigest: previous.witnessDigest,
            })}`,
            "utf8",
          ),
        );
        if (!discard || record.discardAccumulatorDigest !== expected) {
          throw new Error("witness discard history is invalid");
        }
      }
    }
    if (
      discardIndex !== store.discardedAnchors.length ||
      store.current?.witnessDigest !== store.history.at(-1).witnessDigest ||
      canonical(
        verifySigned(
          store.current,
          WITNESS_DOMAIN,
          "witnessDigest",
          "evolution-ledger-witness",
        ),
      ) !== canonical(store.history.at(-1))
    ) {
      throw new Error("witness current state is not its durable history");
    }
    return store;
  };

  const readStore = () => {
    if (!fsImpl.existsSync(target)) return emptyStore();
    ensurePrivateFile(target, secureOptions);
    const stat = fsImpl.statSync(target);
    if (!stat.isFile() || stat.size < 2 || stat.size > maximumBytes) {
      throw new Error("witness store size is invalid");
    }
    const bytes = fsImpl.readFileSync(target, "utf8");
    return validateStore(JSON.parse(bytes));
  };

  const syncDirectory = () => {
    let descriptor;
    try {
      descriptor = fsImpl.openSync(directory, "r");
      fsImpl.fsyncSync(descriptor);
    } catch (error) {
      if (
        process.platform !== "win32" ||
        !["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error?.code)
      )
        throw error;
    } finally {
      if (descriptor !== undefined) fsImpl.closeSync(descriptor);
    }
  };

  const publish = (store) => {
    const temporary = `${target}.${requiredString(random(), "random token")}.tmp`;
    const bytes = Buffer.from(`${canonical(store)}\n`, "utf8");
    if (bytes.length > maximumBytes) {
      throw new Error("witness store exceeds its configured maximum size");
    }
    let descriptor;
    try {
      descriptor = fsImpl.openSync(temporary, "wx", 0o600);
      fsImpl.writeFileSync(descriptor, bytes);
      fsImpl.fsyncSync(descriptor);
      fsImpl.closeSync(descriptor);
      descriptor = undefined;
      fsImpl.renameSync(temporary, target);
      ensurePrivateFile(target, secureOptions);
      descriptor = fsImpl.openSync(target, "r+");
      fsImpl.fsyncSync(descriptor);
      fsImpl.closeSync(descriptor);
      descriptor = undefined;
      syncDirectory();
      return store.current;
    } finally {
      if (descriptor !== undefined) fsImpl.closeSync(descriptor);
      try {
        if (fsImpl.existsSync(temporary)) fsImpl.unlinkSync(temporary);
      } catch {
        // A private orphan cannot affect the committed path.
      }
    }
  };

  const underLock = (operation) =>
    lock(target, operation, { failIfUnavailable: true, _fs: fsImpl });
  const discarded = (store, snapshot) =>
    store.discardedAnchors.some(
      (entry) =>
        entry.anchorDigest === snapshot.anchorDigest ||
        entry.headDigest === snapshot.headDigest ||
        entry.segmentDigest === snapshot.segmentDigest,
    );

  const port = {
    id,
    read: () => readStore().current,
    initialize: ({ expected, snapshot }) =>
      underLock(() => {
        const store = readStore();
        if (store.current.witnessDigest !== expected.witnessDigest) {
          return store.current;
        }
        if (store.current.status !== "absent") return store.current;
        store.current = witnessRecord(snapshot, store.current);
        store.history.push(store.current);
        return publish(store);
      }),
    compareAndSwap: ({ discard = null, expected, next }) =>
      underLock(() => {
        const store = readStore();
        if (store.current.witnessDigest !== expected.witnessDigest) {
          return store.current;
        }
        if (!discard && discarded(store, next)) return store.current;
        if (discard) {
          assertExactKeys(discard, DISCARD_KEYS, "witness discard descriptor");
          if (
            !DIGEST.test(discard.anchorDigest || "") ||
            !DIGEST.test(discard.headDigest || "") ||
            !DIGEST.test(discard.segmentDigest || "")
          ) {
            throw new Error("witness discard descriptor digest is invalid");
          }
          safeCounter(discard.sequence, "witness discard sequence");
          if (discarded(store, discard)) return store.current;
          store.discardedAnchors.push(clone(discard));
        }
        store.current = witnessRecord(next, store.current, discard);
        store.history.push(store.current);
        return publish(store);
      }),
    proveAncestry: ({ ancestor, descendant }) => {
      const store = readStore();
      const first = store.history.findIndex(
        (entry) => entry.witnessDigest === ancestor.witnessDigest,
      );
      const last = store.history.findIndex(
        (entry) => entry.witnessDigest === descendant.witnessDigest,
      );
      if (first < 0 || last < first)
        throw new Error("witness ancestry is absent");
      const persistedAncestor = store.history[first];
      const persistedDescendant = store.history[last];
      if (
        ancestor.generation !== persistedAncestor.generation ||
        descendant.generation !== persistedDescendant.generation
      ) {
        throw new Error("witness ancestry checkpoint is not exactly bound");
      }
      for (let index = first + 1; index <= last; index += 1) {
        if (
          store.history[index].previousWitnessDigest !==
            store.history[index - 1].witnessDigest ||
          store.history[index].generation !==
            store.history[index - 1].generation + 1
        ) {
          throw new Error("witness ancestry is not contiguous");
        }
      }
      const core = {
        ...trust,
        ancestorDigest: persistedAncestor.witnessDigest,
        ancestorGeneration: persistedAncestor.generation,
        authenticated: true,
        descendantDigest: persistedDescendant.witnessDigest,
        descendantGeneration: persistedDescendant.generation,
        durable: true,
        epoch: persistedAncestor.epoch,
        included: true,
        ledgerId: persistedAncestor.ledgerId,
        schema: EVOLUTION_LEDGER_WITNESS_ANCESTRY_SCHEMA,
        witnessId: id,
      };
      return signed(
        ANCESTRY_DOMAIN,
        core,
        "proofDigest",
        "evolution-ledger-witness-ancestry",
      );
    },
  };
  return Object.freeze(port);
}
