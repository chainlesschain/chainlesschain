import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EVOLUTION_ARTIFACT_REF_SCHEMA,
  EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
  EVOLUTION_LEDGER_ANCHOR_SCHEMA,
  EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
  EVOLUTION_LEDGER_EVENT_SCHEMA,
  EVOLUTION_LEDGER_IDENTITY_SCHEMA,
  EVOLUTION_LEDGER_QUERY_SCHEMA,
  EVOLUTION_LEDGER_RECEIPT_SCHEMA,
  EVOLUTION_LEDGER_WITNESS_SCHEMA,
  EvolutionLedger,
} from "../../src/lib/evolution/evolution-ledger.js";
import { createEvolutionFileWitness } from "../../src/lib/evolution/evolution-file-witness.js";

const SECRET = "test-only-evolution-ledger-v2-key";
const WITNESS_SECRET = "test-only-independent-witness-v1-key";
const TRUST_POLICY_DIGEST = digestBytes("evolution-trust-policy-v2");
const TRUST = {
  algorithm: "hmac-sha256",
  keyId: "key://tests/evolution-ledger-v2",
  trustPolicyDigest: TRUST_POLICY_DIGEST,
};
const WITNESS_TRUST = {
  algorithm: "hmac-sha256",
  keyId: "key://tests/evolution-witness-v1",
  trustPolicyDigest: digestBytes("independent-witness-trust-policy-v1"),
};
const EMPTY_DISCARD_ACCUMULATOR_DIGEST = digestBytes(
  Buffer.from(
    `chainlesschain.evolution-witness-discard-accumulator/v1\0${canonicalJson([])}`,
  ),
);
const WITNESS_HISTORIES = new WeakMap();
const WITNESS_DISCARDS = new WeakMap();

function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function digestBytes(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function hmac(message) {
  return crypto
    .createHmac("sha256", SECRET)
    .update(message)
    .digest("base64url");
}

function witnessHmac(message) {
  return crypto
    .createHmac("sha256", WITNESS_SECRET)
    .update(message)
    .digest("base64url");
}

function signingPorts() {
  return {
    sign: vi.fn(({ message }) => ({
      ...TRUST,
      value: hmac(message),
    })),
    verifySignature: vi.fn(({ message, signature, trust }) =>
      Boolean(
        trust.algorithm === TRUST.algorithm &&
        trust.keyId === TRUST.keyId &&
        trust.trustPolicyDigest === TRUST.trustPolicyDigest &&
        signature.algorithm === TRUST.algorithm &&
        signature.keyId === TRUST.keyId &&
        signature.trustPolicyDigest === TRUST.trustPolicyDigest &&
        signature.value === hmac(message),
      ),
    ),
    verifyWitnessSignature: vi.fn(({ message, signature, trust }) =>
      Boolean(
        trust.algorithm === WITNESS_TRUST.algorithm &&
        trust.keyId === WITNESS_TRUST.keyId &&
        trust.trustPolicyDigest === WITNESS_TRUST.trustPolicyDigest &&
        signature.algorithm === WITNESS_TRUST.algorithm &&
        signature.keyId === WITNESS_TRUST.keyId &&
        signature.trustPolicyDigest === WITNESS_TRUST.trustPolicyDigest &&
        signature.value === witnessHmac(message),
      ),
    ),
  };
}

function discardAccumulator(previous, discard) {
  return digestBytes(
    Buffer.from(
      `chainlesschain.evolution-witness-discard-accumulator/v1\0${canonicalJson(
        {
          discard,
          previousDiscardAccumulatorDigest: previous.discardAccumulatorDigest,
          previousWitnessDigest: previous.witnessDigest,
        },
      )}`,
    ),
  );
}

function signedWitness(witnessId, snapshot = null, transition = {}) {
  const previousWitnessDigest = snapshot
    ? transition.previousWitnessDigest || signedWitness(witnessId).witnessDigest
    : null;
  const core = {
    ...WITNESS_TRUST,
    anchorDigest: snapshot?.anchorDigest || null,
    authenticated: true,
    durable: true,
    discardAccumulatorDigest:
      transition.discardAccumulatorDigest || EMPTY_DISCARD_ACCUMULATOR_DIGEST,
    epoch: snapshot?.epoch || null,
    generation: snapshot ? (transition.generation ?? 1) : 0,
    headDigest: snapshot?.headDigest || null,
    identityDigest: snapshot?.identityDigest || null,
    ledgerId: snapshot?.ledgerId || null,
    payloadDigest: snapshot?.payloadDigest || null,
    previousWitnessDigest,
    schema: EVOLUTION_LEDGER_WITNESS_SCHEMA,
    segmentDigest: snapshot?.segmentDigest || null,
    sequence: snapshot?.sequence ?? null,
    status: snapshot ? "committed" : "absent",
    storeMarkerDigest: snapshot?.storeMarkerDigest || null,
    storeMarkerEntryDigest: snapshot?.storeMarkerEntryDigest || null,
    storeMarkerId: snapshot?.storeMarkerId || null,
    witnessId,
  };
  const message = Buffer.from(
    `chainlesschain.evolution-ledger-witness/v1\0${canonicalJson(core)}`,
  );
  return {
    ...core,
    witnessDigest: digestBytes(message),
    signature: { ...WITNESS_TRUST, value: witnessHmac(message) },
  };
}

function advancedWitness(witnessId, previous, snapshot, discard = null) {
  return signedWitness(witnessId, snapshot, {
    discardAccumulatorDigest: discard
      ? discardAccumulator(previous, discard)
      : previous.discardAccumulatorDigest,
    generation: previous.generation + 1,
    previousWitnessDigest: previous.witnessDigest,
  });
}

function rememberWitness(states, witnessId, record) {
  let byWitness = WITNESS_HISTORIES.get(states);
  if (!byWitness) {
    byWitness = new Map();
    WITNESS_HISTORIES.set(states, byWitness);
  }
  const history = byWitness.get(witnessId) || [];
  if (!history.some((entry) => entry.witnessDigest === record.witnessDigest)) {
    history.push(structuredClone(record));
    byWitness.set(witnessId, history);
  }
  return history;
}

function witnessDiscards(states, witnessId) {
  let byWitness = WITNESS_DISCARDS.get(states);
  if (!byWitness) {
    byWitness = new Map();
    WITNESS_DISCARDS.set(states, byWitness);
  }
  const discards = byWitness.get(witnessId) || [];
  byWitness.set(witnessId, discards);
  return discards;
}

function signedWitnessAncestry(witnessId, ancestor, descendant) {
  const core = {
    ...WITNESS_TRUST,
    ancestorDigest: ancestor.witnessDigest,
    ancestorGeneration: ancestor.generation,
    authenticated: true,
    descendantDigest: descendant.witnessDigest,
    descendantGeneration: descendant.generation,
    durable: true,
    epoch: ancestor.epoch,
    included: true,
    ledgerId: ancestor.ledgerId,
    schema: "chainlesschain.evolution-ledger-witness-ancestry/v1",
    witnessId,
  };
  const message = Buffer.from(
    `chainlesschain.evolution-ledger-witness-ancestry/v1\0${canonicalJson(core)}`,
  );
  return {
    ...core,
    proofDigest: digestBytes(message),
    signature: { ...WITNESS_TRUST, value: witnessHmac(message) },
  };
}

function authorityWitness(witnessId, states) {
  const current = () => {
    const record = states.get(witnessId) || signedWitness(witnessId);
    rememberWitness(states, witnessId, record);
    return record;
  };
  return {
    id: witnessId,
    read: vi.fn(current),
    initialize: vi.fn(({ expected, snapshot }) => {
      const existing = states.get(witnessId) || signedWitness(witnessId);
      if (existing.witnessDigest !== expected.witnessDigest) return existing;
      const next = advancedWitness(witnessId, existing, snapshot);
      states.set(witnessId, next);
      rememberWitness(states, witnessId, next);
      return next;
    }),
    compareAndSwap: vi.fn(({ discard, expected, next }) => {
      const existing = states.get(witnessId) || signedWitness(witnessId);
      if (existing.witnessDigest !== expected.witnessDigest) {
        return existing;
      }
      const discards = witnessDiscards(states, witnessId);
      if (
        !discard &&
        discards.some(
          (entry) =>
            entry.anchorDigest === next.anchorDigest ||
            entry.headDigest === next.headDigest ||
            entry.segmentDigest === next.segmentDigest,
        )
      ) {
        return existing;
      }
      if (
        discard &&
        !discards.some((entry) => entry.anchorDigest === discard.anchorDigest)
      ) {
        discards.push(structuredClone(discard));
      }
      const committed = advancedWitness(witnessId, existing, next, discard);
      states.set(witnessId, committed);
      rememberWitness(states, witnessId, committed);
      return committed;
    }),
    proveAncestry: vi.fn(({ ancestor, descendant }) => {
      const history = rememberWitness(states, witnessId, current());
      const ancestorIndex = history.findIndex(
        (entry) => entry.witnessDigest === ancestor.witnessDigest,
      );
      const descendantIndex = history.findIndex(
        (entry) => entry.witnessDigest === descendant.witnessDigest,
      );
      if (ancestorIndex < 0 || descendantIndex < ancestorIndex) {
        throw new Error("witness ancestry is absent");
      }
      for (
        let index = ancestorIndex + 1;
        index <= descendantIndex;
        index += 1
      ) {
        if (
          history[index].previousWitnessDigest !==
            history[index - 1].witnessDigest ||
          history[index].generation !== history[index - 1].generation + 1
        ) {
          throw new Error("witness ancestry is not contiguous");
        }
      }
      return signedWitnessAncestry(witnessId, ancestor, descendant);
    }),
  };
}

function fileAuthorityWitness(witnessId, witnessPath) {
  const lockPath = `${witnessPath}.lock`;
  const durableFs = filesystemWith();
  const emptyStore = () => {
    const current = signedWitness(witnessId);
    return {
      current,
      discardedAnchors: [],
      history: [current],
      schema: "chainlesschain.test-durable-witness-store/v1",
    };
  };
  const validateRecord = (record) => {
    const { signature, witnessDigest, ...core } = record;
    const message = Buffer.from(
      `chainlesschain.evolution-ledger-witness/v1\0${canonicalJson(core)}`,
    );
    if (
      witnessDigest !== digestBytes(message) ||
      signature.value !== witnessHmac(message)
    ) {
      throw new Error("file witness contains an unauthenticated record");
    }
  };
  const validateStore = (store) => {
    if (
      store.schema !== "chainlesschain.test-durable-witness-store/v1" ||
      !Array.isArray(store.history) ||
      !Array.isArray(store.discardedAnchors) ||
      store.history.length < 1
    ) {
      throw new Error("file witness store schema is invalid");
    }
    let discardIndex = 0;
    for (const [index, record] of store.history.entries()) {
      validateRecord(record);
      if (index === 0) continue;
      const previous = store.history[index - 1];
      if (
        record.previousWitnessDigest !== previous.witnessDigest ||
        record.generation !== previous.generation + 1
      ) {
        throw new Error("file witness history is not monotonic");
      }
      if (
        record.discardAccumulatorDigest !== previous.discardAccumulatorDigest
      ) {
        const descriptor = store.discardedAnchors[discardIndex];
        if (
          !descriptor ||
          record.discardAccumulatorDigest !==
            discardAccumulator(previous, descriptor)
        ) {
          throw new Error("file witness discard history is unauthenticated");
        }
        discardIndex += 1;
      }
    }
    if (
      discardIndex !== store.discardedAnchors.length ||
      store.current.witnessDigest !== store.history.at(-1).witnessDigest
    ) {
      throw new Error("file witness current state is not its durable history");
    }
    return store;
  };
  const readStore = () =>
    fs.existsSync(witnessPath)
      ? validateStore(JSON.parse(fs.readFileSync(witnessPath, "utf8")))
      : emptyStore();
  const syncParent = () => {
    const descriptor = durableFs.openSync(path.dirname(witnessPath), "r");
    durableFs.fsyncSync(descriptor);
    durableFs.closeSync(descriptor);
  };
  const publish = (store) => {
    const temporaryPath = `${witnessPath}.${crypto.randomBytes(16).toString("hex")}.tmp`;
    const bytes = Buffer.from(`${canonicalJson(store)}\n`, "utf8");
    const descriptor = fs.openSync(temporaryPath, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    fs.renameSync(temporaryPath, witnessPath);
    const committedDescriptor = fs.openSync(witnessPath, "r+");
    fs.fsyncSync(committedDescriptor);
    fs.closeSync(committedDescriptor);
    syncParent();
    return store.current;
  };
  const withExclusiveLock = (callback) => {
    const descriptor = fs.openSync(lockPath, "wx", 0o600);
    try {
      fs.fsyncSync(descriptor);
      syncParent();
      return callback();
    } finally {
      fs.closeSync(descriptor);
      fs.unlinkSync(lockPath);
      syncParent();
    }
  };
  const appendHistory = (store, record) => {
    if (
      !store.history.some(
        (entry) => entry.witnessDigest === record.witnessDigest,
      )
    ) {
      store.history.push(record);
    }
  };
  const read = () => readStore().current;
  const discarded = (store, snapshot) =>
    store.discardedAnchors.some(
      (entry) =>
        entry.anchorDigest === snapshot.anchorDigest ||
        entry.headDigest === snapshot.headDigest ||
        entry.segmentDigest === snapshot.segmentDigest,
    );
  const proveAncestry = ({ ancestor, descendant }) => {
    const store = readStore();
    const ancestorIndex = store.history.findIndex(
      (entry) => entry.witnessDigest === ancestor.witnessDigest,
    );
    const descendantIndex = store.history.findIndex(
      (entry) => entry.witnessDigest === descendant.witnessDigest,
    );
    if (ancestorIndex < 0 || descendantIndex < ancestorIndex) {
      throw new Error("file witness ancestry is absent");
    }
    for (let index = ancestorIndex + 1; index <= descendantIndex; index += 1) {
      if (
        store.history[index].previousWitnessDigest !==
          store.history[index - 1].witnessDigest ||
        store.history[index].generation !==
          store.history[index - 1].generation + 1
      ) {
        throw new Error("file witness ancestry is not contiguous");
      }
    }
    return signedWitnessAncestry(witnessId, ancestor, descendant);
  };
  return {
    id: witnessId,
    read,
    initialize: ({ expected, snapshot }) => {
      return withExclusiveLock(() => {
        const store = readStore();
        if (store.current.witnessDigest !== expected.witnessDigest) {
          return store.current;
        }
        store.current = advancedWitness(witnessId, store.current, snapshot);
        appendHistory(store, store.current);
        return publish(store);
      });
    },
    compareAndSwap: ({ discard, expected, next }) => {
      return withExclusiveLock(() => {
        const store = readStore();
        if (store.current.witnessDigest !== expected.witnessDigest) {
          return store.current;
        }
        if (!discard && discarded(store, next)) return store.current;
        if (
          discard &&
          !store.discardedAnchors.some(
            (entry) => entry.anchorDigest === discard.anchorDigest,
          )
        ) {
          store.discardedAnchors.push(discard);
        }
        store.current = advancedWitness(
          witnessId,
          store.current,
          next,
          discard,
        );
        appendHistory(store, store.current);
        return publish(store);
      });
    },
    proveAncestry,
  };
}

function productionFileAuthorityWitness(witnessId, witnessPath) {
  return createEvolutionFileWitness({
    filePath: witnessPath,
    id: witnessId,
    signer: {
      sign: ({ message }) => ({
        ...WITNESS_TRUST,
        value: witnessHmac(message),
      }),
    },
    trust: WITNESS_TRUST,
    verifier: {
      verify: ({ message, signature }) =>
        signature.value === witnessHmac(message),
    },
  });
}

function witnessIdFor(authorityRoot) {
  return `witness-${digestBytes(path.resolve(authorityRoot)).slice("sha256:".length)}`;
}

async function evolutionLedgerWorkerMain() {
  const crypto = require("node:crypto");
  const fs = require("node:fs");
  const { parentPort, workerData } = require("node:worker_threads");
  // Keep this import inside the worker instead of Vitest's transformed module.
  const importModule = new Function("specifier", "return import(specifier)");
  const ledgerModule = await importModule(workerData.moduleUrl);
  const secret = "test-only-evolution-ledger-v2-key";
  const witnessSecret = "test-only-independent-witness-v1-key";
  const canonical = (value) => {
    if (value === null || typeof value !== "object") {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map((entry) => canonical(entry)).join(",")}]`;
    }
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  };
  const digest = (value) =>
    `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
  const hmac = (message) =>
    crypto.createHmac("sha256", secret).update(message).digest("base64url");
  const witnessHmac = (message) =>
    crypto
      .createHmac("sha256", witnessSecret)
      .update(message)
      .digest("base64url");
  const trust = {
    algorithm: "hmac-sha256",
    keyId: "key://tests/evolution-ledger-v2",
    trustPolicyDigest: digest("evolution-trust-policy-v2"),
  };
  const witnessTrust = {
    algorithm: "hmac-sha256",
    keyId: "key://tests/evolution-witness-v1",
    trustPolicyDigest: digest("independent-witness-trust-policy-v1"),
  };
  const emptyDiscardAccumulatorDigest = digest(
    Buffer.from(
      `chainlesschain.evolution-witness-discard-accumulator/v1\0${canonical([])}`,
    ),
  );
  const discardAccumulator = (previous, discard) =>
    digest(
      Buffer.from(
        `chainlesschain.evolution-witness-discard-accumulator/v1\0${canonical({
          discard,
          previousDiscardAccumulatorDigest: previous.discardAccumulatorDigest,
          previousWitnessDigest: previous.witnessDigest,
        })}`,
      ),
    );
  const signedWitnessRecord = (snapshot = null, transition = {}) => {
    const core = {
      ...witnessTrust,
      anchorDigest: snapshot?.anchorDigest || null,
      authenticated: true,
      durable: true,
      discardAccumulatorDigest:
        transition.discardAccumulatorDigest || emptyDiscardAccumulatorDigest,
      epoch: snapshot?.epoch || null,
      generation: snapshot ? (transition.generation ?? 1) : 0,
      headDigest: snapshot?.headDigest || null,
      identityDigest: snapshot?.identityDigest || null,
      ledgerId: snapshot?.ledgerId || null,
      payloadDigest: snapshot?.payloadDigest || null,
      previousWitnessDigest: snapshot
        ? transition.previousWitnessDigest ||
          signedWitnessRecord().witnessDigest
        : null,
      schema: ledgerModule.EVOLUTION_LEDGER_WITNESS_SCHEMA,
      segmentDigest: snapshot?.segmentDigest || null,
      sequence: snapshot?.sequence ?? null,
      status: snapshot ? "committed" : "absent",
      storeMarkerDigest: snapshot?.storeMarkerDigest || null,
      storeMarkerEntryDigest: snapshot?.storeMarkerEntryDigest || null,
      storeMarkerId: snapshot?.storeMarkerId || null,
      witnessId: workerData.witnessId,
    };
    const message = Buffer.from(
      `chainlesschain.evolution-ledger-witness/v1\0${canonical(core)}`,
    );
    return {
      ...core,
      signature: { ...witnessTrust, value: witnessHmac(message) },
      witnessDigest: digest(message),
    };
  };
  const advancedWitnessRecord = (previous, snapshot, discard = null) =>
    signedWitnessRecord(snapshot, {
      discardAccumulatorDigest: discard
        ? discardAccumulator(previous, discard)
        : previous.discardAccumulatorDigest,
      generation: previous.generation + 1,
      previousWitnessDigest: previous.witnessDigest,
    });
  const emptyWitnessStore = () => {
    const current = signedWitnessRecord();
    return {
      current,
      discardedAnchors: [],
      history: [current],
      schema: "chainlesschain.test-durable-witness-store/v1",
    };
  };
  const readWitnessStore = () =>
    fs.existsSync(workerData.witnessPath)
      ? JSON.parse(fs.readFileSync(workerData.witnessPath, "utf8"))
      : emptyWitnessStore();
  const syncWitnessParent = () => {
    const descriptor = durableFs.openSync(
      require("node:path").dirname(workerData.witnessPath),
      "r",
    );
    durableFs.fsyncSync(descriptor);
    durableFs.closeSync(descriptor);
  };
  const publishWitnessStore = (store) => {
    const temporaryPath = `${workerData.witnessPath}.${crypto.randomBytes(16).toString("hex")}.tmp`;
    const bytes = Buffer.from(`${canonical(store)}\n`, "utf8");
    const descriptor = fs.openSync(temporaryPath, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    fs.renameSync(temporaryPath, workerData.witnessPath);
    const committedDescriptor = fs.openSync(workerData.witnessPath, "r+");
    fs.fsyncSync(committedDescriptor);
    fs.closeSync(committedDescriptor);
    syncWitnessParent();
    return store.current;
  };
  const withWitnessLock = (callback) => {
    const lockPath = `${workerData.witnessPath}.lock`;
    const descriptor = fs.openSync(lockPath, "wx", 0o600);
    try {
      fs.fsyncSync(descriptor);
      syncWitnessParent();
      return callback();
    } finally {
      fs.closeSync(descriptor);
      fs.unlinkSync(lockPath);
      syncWitnessParent();
    }
  };
  const appendWitnessHistory = (store, record) => {
    if (
      !store.history.some(
        (entry) => entry.witnessDigest === record.witnessDigest,
      )
    ) {
      store.history.push(record);
    }
  };
  const signedAncestryProof = (ancestor, descendant) => {
    const core = {
      ...witnessTrust,
      ancestorDigest: ancestor.witnessDigest,
      ancestorGeneration: ancestor.generation,
      authenticated: true,
      descendantDigest: descendant.witnessDigest,
      descendantGeneration: descendant.generation,
      durable: true,
      epoch: ancestor.epoch,
      included: true,
      ledgerId: ancestor.ledgerId,
      schema: ledgerModule.EVOLUTION_LEDGER_WITNESS_ANCESTRY_SCHEMA,
      witnessId: workerData.witnessId,
    };
    const message = Buffer.from(
      `chainlesschain.evolution-ledger-witness-ancestry/v1\0${canonical(core)}`,
    );
    return {
      ...core,
      proofDigest: digest(message),
      signature: { ...witnessTrust, value: witnessHmac(message) },
    };
  };
  const readWitness = () => readWitnessStore().current;
  const witness = {
    id: workerData.witnessId,
    read: readWitness,
    initialize: ({ expected, snapshot }) => {
      return withWitnessLock(() => {
        const store = readWitnessStore();
        if (store.current.witnessDigest !== expected.witnessDigest) {
          return store.current;
        }
        store.current = advancedWitnessRecord(store.current, snapshot);
        appendWitnessHistory(store, store.current);
        return publishWitnessStore(store);
      });
    },
    compareAndSwap: ({ discard, expected, next }) => {
      return withWitnessLock(() => {
        const store = readWitnessStore();
        if (store.current.witnessDigest !== expected.witnessDigest) {
          return store.current;
        }
        if (
          !discard &&
          store.discardedAnchors.some(
            (entry) =>
              entry.anchorDigest === next.anchorDigest ||
              entry.headDigest === next.headDigest ||
              entry.segmentDigest === next.segmentDigest,
          )
        ) {
          return store.current;
        }
        if (discard) store.discardedAnchors.push(discard);
        store.current = advancedWitnessRecord(store.current, next, discard);
        appendWitnessHistory(store, store.current);
        return publishWitnessStore(store);
      });
    },
    proveAncestry: ({ ancestor, descendant }) => {
      const history = readWitnessStore().history;
      const ancestorIndex = history.findIndex(
        (entry) => entry.witnessDigest === ancestor.witnessDigest,
      );
      const descendantIndex = history.findIndex(
        (entry) => entry.witnessDigest === descendant.witnessDigest,
      );
      if (ancestorIndex < 0 || descendantIndex < ancestorIndex) {
        throw new Error("worker witness ancestry is absent");
      }
      return signedAncestryProof(ancestor, descendant);
    },
  };
  const directoryDescriptors = new Set();
  let nextDirectoryDescriptor = -10_000;
  const durableFs = {
    ...fs,
    closeSync(descriptor) {
      if (directoryDescriptors.delete(descriptor)) return;
      return fs.closeSync(descriptor);
    },
    constants: fs.constants,
    fsyncSync(descriptor) {
      if (directoryDescriptors.has(descriptor)) return;
      try {
        return fs.fsyncSync(descriptor);
      } catch (error) {
        if (
          process.platform === "win32" &&
          ["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error?.code) &&
          fs.fstatSync(descriptor).isDirectory()
        ) {
          return;
        }
        throw error;
      }
    },
    openSync(target, flags, mode) {
      try {
        return fs.openSync(target, flags, mode);
      } catch (error) {
        if (
          process.platform === "win32" &&
          flags === "r" &&
          ["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error?.code) &&
          fs.statSync(target).isDirectory()
        ) {
          const descriptor = nextDirectoryDescriptor;
          nextDirectoryDescriptor -= 1;
          directoryDescriptors.add(descriptor);
          return descriptor;
        }
        throw error;
      }
    },
    realpathSync: fs.realpathSync,
  };
  const artifactRef = (label, scheme = "artifact") => ({
    digest: digest(Buffer.from(label)),
    ref: `${scheme}://evolution/${label}`,
    schema: ledgerModule.EVOLUTION_ARTIFACT_REF_SCHEMA,
  });
  const event = (index) => ({
    actorRef: artifactRef(`actor-${index}`, "did"),
    candidateRef: artifactRef(`candidate-${index}`),
    decision: "proposed",
    derivationMode: "record-replay",
    diffRef: artifactRef(`diff-${index}`),
    evalRef: artifactRef(`eval-${index}`),
    eventId: `event-${index}`,
    parentRef: index === 1 ? null : artifactRef(`parent-${index}`),
    policyRef: artifactRef(`policy-${index}`),
    reason: `candidate ${index} was derived from verified evidence`,
    revocationState: "not-revoked",
    runId: "run-alpha",
    skillName: "repair-unit-tests",
    sourceRefs: [
      artifactRef(`source-z-${index}`, "recording"),
      artifactRef(`source-a-${index}`, "recording"),
    ],
    targetRef: artifactRef(`target-${index}`, "runtime"),
    tenantId: "tenant-a",
    type: "candidate.proposed",
  });
  const domainEvent = (index) => ({
    artifactTenantId: "artifact-tenant-a",
    correlationId: null,
    decision: "committed",
    eventId: `shared-domain-event-${index}`,
    reason: "nonce claim was durably committed",
    skillName: null,
    sourceRefs: [],
    subjectRef: artifactRef(`domain-subject-${index}`, "evidence"),
    tenantId: "tenant-a",
    type: "skill.mutation.nonce-claimed",
  });
  const ledger = new ledgerModule.EvolutionLedger({
    artifactResolver: ({ ref }) => {
      const label = ref.ref.slice(ref.ref.lastIndexOf("/") + 1);
      const bytes = Buffer.from(label);
      return {
        authenticated: true,
        bytes,
        digest: ref.digest,
        found: true,
        receiptDigest: digest(`resolution\0${ref.ref}\0${ref.digest}`),
        ref: ref.ref,
        schema: ledgerModule.EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
      };
    },
    authorityRootDir: workerData.authorityRootDir,
    clock: () => Date.parse("2026-09-01T10:00:00.000Z"),
    fsImpl: durableFs,
    lockTimeoutMs: 120_000,
    rootDir: workerData.rootDir,
    secure: false,
    sign: ({ message }) => ({ ...trust, value: hmac(message) }),
    trust,
    verifySignature: ({ message, signature }) =>
      signature.algorithm === trust.algorithm &&
      signature.keyId === trust.keyId &&
      signature.trustPolicyDigest === trust.trustPolicyDigest &&
      signature.value === hmac(message),
    verifyWitnessSignature: ({ message, signature }) =>
      signature.algorithm === witnessTrust.algorithm &&
      signature.keyId === witnessTrust.keyId &&
      signature.trustPolicyDigest === witnessTrust.trustPolicyDigest &&
      signature.value === witnessHmac(message),
    witness,
    witnessTrust,
  });
  const outcomes = workerData.indices.map((index) => {
    try {
      const receipt = workerData.domainEvent
        ? ledger.appendDomainEvent(domainEvent(index))
        : ledger.append(event(index));
      const { anchorDigest, eventDigest, eventId, sequence } = receipt;
      return { anchorDigest, eventDigest, eventId, ok: true, sequence };
    } catch (error) {
      if (!workerData.captureErrors) throw error;
      return {
        code: error?.code || null,
        commitState: error?.commitState || null,
        message: error?.message || String(error),
        ok: false,
      };
    }
  });
  parentPort.postMessage(outcomes);
}

function runEvolutionLedgerWorker(workerData) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(`(${evolutionLedgerWorkerMain.toString()})()`, {
      eval: true,
      workerData,
    });
    let settled = false;
    worker.once("message", (message) => {
      settled = true;
      resolve(message);
    });
    worker.once("error", (error) => {
      settled = true;
      reject(error);
    });
    worker.once("exit", (code) => {
      if (!settled) {
        reject(
          new Error(
            `evolution ledger worker exited without a result (code ${code})`,
          ),
        );
      }
    });
  });
}

function artifactRef(label, artifacts, scheme = "artifact") {
  const bytes = Buffer.from(label, "utf8");
  const ref = `${scheme}://evolution/${label}`;
  const digest = digestBytes(bytes);
  artifacts.set(ref, bytes);
  return {
    schema: EVOLUTION_ARTIFACT_REF_SCHEMA,
    ref,
    digest,
  };
}

function eventInput(index, artifacts, overrides = {}) {
  return {
    runId: "run-alpha",
    eventId: `event-${index}`,
    type: "candidate.proposed",
    tenantId: "tenant-a",
    skillName: "repair-unit-tests",
    derivationMode: "record-replay",
    sourceRefs: [
      artifactRef(`source-z-${index}`, artifacts, "recording"),
      artifactRef(`source-a-${index}`, artifacts, "recording"),
    ],
    parentRef: index === 1 ? null : artifactRef(`parent-${index}`, artifacts),
    candidateRef: artifactRef(`candidate-${index}`, artifacts),
    diffRef: artifactRef(`diff-${index}`, artifacts),
    evalRef: artifactRef(`eval-${index}`, artifacts),
    policyRef: artifactRef(`policy-${index}`, artifacts),
    actorRef: artifactRef(`actor-${index}`, artifacts, "did"),
    targetRef: artifactRef(`target-${index}`, artifacts, "runtime"),
    decision: "proposed",
    reason: `candidate ${index} was derived from verified evidence`,
    revocationState: "not-revoked",
    ...overrides,
  };
}

function domainEventInput(index, artifacts, overrides = {}) {
  return {
    artifactTenantId: "artifact-tenant-a",
    correlationId: null,
    decision: "rejected",
    eventId: `domain-event-${index}`,
    reason: "CC_SKILL_MUTATION_REQUEST_INVALID",
    skillName: null,
    sourceRefs: [],
    subjectRef: artifactRef(`domain-subject-${index}`, artifacts, "evidence"),
    tenantId: null,
    type: "skill.mutation.audit",
    ...overrides,
  };
}

function artifactResolver(artifacts) {
  return vi.fn(({ ref }) => {
    const bytes = artifacts.get(ref.ref);
    return {
      schema: EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
      authenticated: true,
      bytes: bytes == null ? Buffer.alloc(0) : Buffer.from(bytes),
      digest: ref.digest,
      found: bytes != null,
      receiptDigest: digestBytes(`resolution\0${ref.ref}\0${ref.digest}`),
      ref: ref.ref,
    };
  });
}

function capturedError(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  throw new Error("expected callback to throw");
}

function trapProxy(target, onTrap) {
  const trap = (name) => {
    onTrap(name);
    throw new Error(`unexpected proxy trap: ${name}`);
  };
  return new Proxy(target, {
    get: () => trap("get"),
    getOwnPropertyDescriptor: () => trap("getOwnPropertyDescriptor"),
    getPrototypeOf: () => trap("getPrototypeOf"),
    has: () => trap("has"),
    ownKeys: () => trap("ownKeys"),
  });
}

function filesystemWith(overrides = {}) {
  const directoryDescriptors = new Set();
  let nextDirectoryDescriptor = -10_000;
  return {
    ...fs,
    closeSync(descriptor) {
      if (directoryDescriptors.delete(descriptor)) return;
      return fs.closeSync(descriptor);
    },
    constants: fs.constants,
    fsyncSync(descriptor) {
      if (directoryDescriptors.has(descriptor)) return;
      try {
        return fs.fsyncSync(descriptor);
      } catch (error) {
        if (
          process.platform === "win32" &&
          ["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error?.code) &&
          fs.fstatSync(descriptor).isDirectory()
        ) {
          return;
        }
        throw error;
      }
    },
    openSync(target, flags, mode) {
      try {
        return fs.openSync(target, flags, mode);
      } catch (error) {
        if (
          process.platform === "win32" &&
          flags === "r" &&
          ["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error?.code) &&
          fs.statSync(target).isDirectory()
        ) {
          const descriptor = nextDirectoryDescriptor;
          nextDirectoryDescriptor -= 1;
          directoryDescriptors.add(descriptor);
          return descriptor;
        }
        throw error;
      }
    },
    realpathSync: fs.realpathSync,
    ...overrides,
  };
}

function incarnationBlindFilesystem() {
  const base = filesystemWith();
  return filesystemWith({
    lstatSync(target, options) {
      const stat = fs.lstatSync(target, options);
      if (!stat.isDirectory()) return stat;
      const stableInode = Number.parseInt(
        crypto
          .createHash("sha256")
          .update(path.resolve(target))
          .digest("hex")
          .slice(0, 12),
        16,
      );
      return new Proxy(stat, {
        get(object, property, receiver) {
          if (property === "dev") return 4242;
          if (property === "ino") return stableInode;
          return Reflect.get(object, property, receiver);
        },
      });
    },
    openSync: base.openSync,
    closeSync: base.closeSync,
    fsyncSync: base.fsyncSync,
  });
}

function jsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeCanonical(filePath, value) {
  fs.writeFileSync(filePath, `${canonicalJson(value)}\n`, "utf8");
}

function regularFiles(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
}

describe("EvolutionLedger v2", () => {
  let tempRoot;
  let eventRoot;
  let authorityRoot;
  let artifacts;
  let ports;
  let witnessStates;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-evolution-ledger-v2-"),
    );
    eventRoot = path.join(tempRoot, "events");
    authorityRoot = path.join(tempRoot, "authority");
    artifacts = new Map();
    ports = signingPorts();
    witnessStates = new Map();
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  function createLedger(overrides = {}) {
    const selectedAuthorityRoot =
      overrides.authorityRootDir === undefined
        ? authorityRoot
        : overrides.authorityRootDir;
    const witnessId = witnessIdFor(selectedAuthorityRoot);
    return new EvolutionLedger({
      rootDir: eventRoot,
      authorityRootDir: authorityRoot,
      secure: false,
      clock: () => Date.parse("2026-09-01T10:00:00.000Z"),
      fsImpl: filesystemWith(),
      trust: TRUST,
      witnessTrust: WITNESS_TRUST,
      artifactResolver: artifactResolver(artifacts),
      witness: authorityWitness(witnessId, witnessStates),
      ...ports,
      ...overrides,
    });
  }

  it("initializes an independent signed identity, epoch, genesis anchor, and HEAD", () => {
    const ledger = createLedger();
    const identity = jsonFile(ledger.identityPath);
    const storeMarker = jsonFile(ledger.storeMarkerPath);
    const head = jsonFile(ledger.headPath);
    const authority = ledger.verify();
    const witnessed = witnessStates.get(witnessIdFor(authorityRoot));

    expect(path.dirname(ledger.rootDir)).toBe(
      path.dirname(ledger.authorityRootDir),
    );
    expect(ledger.rootDir).not.toBe(ledger.authorityRootDir);
    expect(identity).toMatchObject({
      schema: EVOLUTION_LEDGER_IDENTITY_SCHEMA,
      algorithm: TRUST.algorithm,
      keyId: TRUST.keyId,
      trustPolicyDigest: TRUST.trustPolicyDigest,
    });
    expect(identity.ledgerId).toMatch(/^ledger-[A-Za-z0-9-]{16,128}$/u);
    expect(identity.epoch).toMatch(/^epoch-[A-Za-z0-9-]{16,128}$/u);
    expect(identity.identityDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(identity.storeMarkerEntryDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(identity.storeMarkerId).toMatch(/^marker-[A-Za-z0-9-]{16,128}$/u);
    expect(storeMarker).toMatchObject({
      schema: "chainlesschain.evolution-ledger-store-marker/v1",
      ledgerId: identity.ledgerId,
      epoch: identity.epoch,
      storeMarkerId: identity.storeMarkerId,
      storeMarkerDigest: identity.storeMarkerDigest,
      witnessAlgorithm: WITNESS_TRUST.algorithm,
      witnessKeyId: WITNESS_TRUST.keyId,
      witnessTrustPolicyDigest: WITNESS_TRUST.trustPolicyDigest,
    });
    expect(storeMarker.signature).toMatchObject(TRUST);
    expect(witnessed).toMatchObject({
      ...WITNESS_TRUST,
      generation: 1,
      previousWitnessDigest: signedWitness(witnessIdFor(authorityRoot))
        .witnessDigest,
      discardAccumulatorDigest: EMPTY_DISCARD_ACCUMULATOR_DIGEST,
      storeMarkerDigest: identity.storeMarkerDigest,
      storeMarkerEntryDigest: identity.storeMarkerEntryDigest,
      storeMarkerId: identity.storeMarkerId,
    });
    expect(witnessed.signature).toMatchObject(WITNESS_TRUST);
    expect(witnessed.signature.keyId).not.toBe(identity.signature.keyId);
    expect(head).toMatchObject({
      schema: EVOLUTION_LEDGER_ANCHOR_SCHEMA,
      sequence: 0,
      headDigest: null,
      segmentDigest: null,
      identityDigest: identity.identityDigest,
    });
    expect(authority).toMatchObject({
      authenticated: true,
      durable: true,
      sequence: 0,
      eventCount: 0,
      headDigest: null,
      identityDigest: identity.identityDigest,
      ledgerId: identity.ledgerId,
      epoch: identity.epoch,
    });
    expect(regularFiles(ledger.anchorDir)).toHaveLength(1);
    expect(regularFiles(ledger.segmentDir)).toHaveLength(0);
    expect(Object.isFrozen(ledger)).toBe(true);
    expect(Object.isFrozen(authority)).toBe(true);
  });

  it("recovers an identity-only bootstrap before the witness ever becomes active", () => {
    let failGenesisLink = true;
    const failingFs = filesystemWith({
      linkSync(source, target) {
        if (
          failGenesisLink &&
          path.dirname(target).endsWith("head-anchors-v1")
        ) {
          failGenesisLink = false;
          const error = new Error("simulated bootstrap genesis failure");
          error.code = "EIO";
          throw error;
        }
        return fs.linkSync(source, target);
      },
    });
    expect(() => createLedger({ fsImpl: failingFs })).toThrow();
    expect(fs.existsSync(path.join(authorityRoot, "identity-v1.json"))).toBe(
      true,
    );
    expect(witnessStates.size).toBe(0);

    const recovered = createLedger();
    expect(recovered.verify()).toMatchObject({
      authenticated: true,
      durable: true,
      sequence: 0,
    });
  });

  it("rejects replacing an initialized empty event-store incarnation", () => {
    const ledger = createLedger();
    fs.rmSync(ledger.rootDir, { recursive: true, force: true });

    expect(capturedError(() => createLedger()).code).toBe(
      "CC_EVOLUTION_LEDGER_CORRUPT",
    );
  });

  it("rejects deletion or substitution of the random signed store marker", () => {
    const ledger = createLedger();
    const markerPath = ledger.storeMarkerPath;
    const marker = jsonFile(markerPath);
    fs.unlinkSync(markerPath);

    const missing = capturedError(() => createLedger());
    expect(missing).toMatchObject({
      code: "CC_EVOLUTION_LEDGER_CORRUPT",
    });
    expect(missing.message).toContain("store incarnation marker");

    writeCanonical(markerPath, {
      ...marker,
      storeMarkerId: `${marker.storeMarkerId}-substituted`,
    });
    expect(capturedError(() => createLedger()).code).toBe(
      "CC_EVOLUTION_LEDGER_CORRUPT",
    );
  });

  it("detects event-root reincarnation even when filesystem dev/ino are replayed", () => {
    const blindFs = incarnationBlindFilesystem();
    const ledger = createLedger({ fsImpl: blindFs });
    ledger.append(eventInput(1, artifacts));
    const replayedMarker = fs.readFileSync(ledger.storeMarkerPath);
    fs.rmSync(ledger.rootDir, { recursive: true, force: true });
    fs.mkdirSync(ledger.segmentDir, { recursive: true });
    fs.writeFileSync(ledger.storeMarkerPath, replayedMarker, {
      flag: "wx",
      mode: 0o600,
    });

    const error = capturedError(() =>
      createLedger({ fsImpl: incarnationBlindFilesystem() }),
    );
    expect(error).toMatchObject({ code: "CC_EVOLUTION_LEDGER_CORRUPT" });
    expect(error.message).toContain("replaced or replayed");
  });

  it("commits an immutable segment and signed head anchor before issuing a bound receipt", () => {
    const resolver = artifactResolver(artifacts);
    const ledger = createLedger({ artifactResolver: resolver });
    const receipt = ledger.append(eventInput(1, artifacts));
    const event = ledger.read()[0];

    expect(event).toMatchObject({
      schema: EVOLUTION_LEDGER_EVENT_SCHEMA,
      sequence: 1,
      prevDigest: null,
      algorithm: TRUST.algorithm,
      keyId: TRUST.keyId,
      trustPolicyDigest: TRUST.trustPolicyDigest,
      eventId: "event-1",
    });
    expect(event.artifactValidationDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(receipt).toMatchObject({
      schema: EVOLUTION_LEDGER_RECEIPT_SCHEMA,
      ledgerId: event.ledgerId,
      epoch: event.epoch,
      identityDigest: event.identityDigest,
      eventId: event.eventId,
      eventDigest: event.eventDigest,
      headDigest: event.eventDigest,
      sequence: 1,
      authenticated: true,
      committed: true,
      durable: true,
      persisted: true,
      algorithm: TRUST.algorithm,
      keyId: TRUST.keyId,
      trustPolicyDigest: TRUST.trustPolicyDigest,
    });
    expect(receipt.anchorDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(receipt.segmentDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(receipt.receiptDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(receipt.signature.value).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(receipt.headSignature).toEqual(jsonFile(ledger.headPath).signature);
    expect(resolver).toHaveBeenCalledTimes(8);
    expect(regularFiles(ledger.segmentDir)).toHaveLength(1);
    expect(regularFiles(ledger.anchorDir)).toHaveLength(2);
    expect(
      fs.statSync(
        path.join(ledger.segmentDir, regularFiles(ledger.segmentDir)[0]),
      ).nlink,
    ).toBe(1);
  });

  it("chains strict domain events with legacy v2 events and routes artifacts through the real artifact tenant", () => {
    const resolver = artifactResolver(artifacts);
    const ledger = createLedger({ artifactResolver: resolver });
    const first = ledger.append(eventInput(1, artifacts));
    const domainReceipt = ledger.appendDomainEvent(
      domainEventInput(1, artifacts),
    );
    const third = ledger.append(eventInput(2, artifacts));
    const events = ledger.read();

    expect(
      events.map(({ schema, sequence }) => ({ schema, sequence })),
    ).toEqual([
      { schema: EVOLUTION_LEDGER_EVENT_SCHEMA, sequence: 1 },
      { schema: EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA, sequence: 2 },
      { schema: EVOLUTION_LEDGER_EVENT_SCHEMA, sequence: 3 },
    ]);
    expect(events[1]).toMatchObject({
      artifactTenantId: "artifact-tenant-a",
      correlationId: null,
      eventId: "domain-event-1",
      prevDigest: first.eventDigest,
      skillName: null,
      sourceRefs: [],
      tenantId: null,
    });
    expect(third.sequence).toBe(3);
    expect(third.eventDigest).toBe(events[2].eventDigest);
    expect(domainReceipt).toMatchObject({
      eventDigest: events[1].eventDigest,
      eventId: events[1].eventId,
      sequence: 2,
    });
    expect(
      resolver.mock.calls.find(
        ([request]) => request.ref.ref === events[1].subjectRef.ref,
      )?.[0],
    ).toMatchObject({ tenantId: "artifact-tenant-a" });
    const domainSigningRequest = ports.sign.mock.calls.find(
      ([request]) => request.purpose === "domain-event",
    )?.[0];
    expect(
      domainSigningRequest.message
        .toString("utf8")
        .startsWith("chainlesschain.evolution-domain-event/v1\0"),
    ).toBe(true);
    expect(ledger.query({ eventId: events[1].eventId })).toMatchObject({
      authenticated: true,
      durable: true,
      event: { schema: EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA, sequence: 2 },
    });
    expect(createLedger().verify()).toMatchObject({
      eventCount: 3,
      headDigest: third.eventDigest,
      sequence: 3,
    });
  });

  it("requires a distinct subject ref while allowing nullable context and empty domain sources", () => {
    const resolver = artifactResolver(artifacts);
    const ledger = createLedger({ artifactResolver: resolver });
    const valid = domainEventInput(1, artifacts);

    expect(() => ledger.appendDomainEvent(valid)).not.toThrow();
    expect(resolver).toHaveBeenCalledTimes(1);

    const duplicateSource = artifactRef(
      "duplicate-domain-source",
      artifacts,
      "evidence",
    );
    const duplicateError = capturedError(() =>
      ledger.appendDomainEvent(
        domainEventInput(2, artifacts, {
          sourceRefs: [duplicateSource, duplicateSource],
        }),
      ),
    );
    expect(duplicateError).toMatchObject({
      code: "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
      commitState: "not-committed",
    });

    const digestAliasedSource = {
      ...duplicateSource,
      ref: "evidence://evolution/duplicate-domain-source-alias",
    };
    expect(
      capturedError(() =>
        ledger.appendDomainEvent(
          domainEventInput(3, artifacts, {
            sourceRefs: [duplicateSource, digestAliasedSource],
          }),
        ),
      ),
    ).toMatchObject({
      code: "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
      commitState: "not-committed",
    });

    const aliased = domainEventInput(4, artifacts);
    expect(
      capturedError(() =>
        ledger.appendDomainEvent({
          ...aliased,
          sourceRefs: [
            {
              ...aliased.subjectRef,
              ref: "evidence://evolution/domain-subject-alias",
            },
          ],
        }),
      ),
    ).toMatchObject({
      code: "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
      commitState: "not-committed",
    });

    const missingSubject = domainEventInput(5, artifacts);
    Reflect.deleteProperty(missingSubject, "subjectRef");
    expect(
      capturedError(() => ledger.appendDomainEvent(missingSubject)),
    ).toMatchObject({
      code: "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
      commitState: "not-committed",
    });
    expect(ledger.verify()).toMatchObject({ eventCount: 1, sequence: 1 });
  });

  it("rejects proxy and accessor schema inputs without invoking external traps", () => {
    let trapCount = 0;
    const recordTrap = () => {
      trapCount += 1;
    };
    const ledger = createLedger();

    expect(
      capturedError(() =>
        ledger.appendDomainEvent(
          trapProxy(domainEventInput(10, artifacts), recordTrap),
        ),
      ),
    ).toMatchObject({
      code: "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
      commitState: "not-committed",
    });

    const getterInput = domainEventInput(11, artifacts);
    Object.defineProperty(getterInput, "tenantId", {
      configurable: true,
      enumerable: true,
      get() {
        trapCount += 1;
        return "tenant-a";
      },
    });
    expect(
      capturedError(() => ledger.appendDomainEvent(getterInput)),
    ).toMatchObject({
      code: "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
      commitState: "not-committed",
    });

    const proxiedSources = domainEventInput(12, artifacts, {
      sourceRefs: trapProxy([], recordTrap),
    });
    expect(
      capturedError(() => ledger.appendDomainEvent(proxiedSources)),
    ).toMatchObject({
      code: "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
      commitState: "not-committed",
    });

    const unsafePrototypeSources = [];
    let prototypeTrapArmed = false;
    const unsafeArrayPrototype = new Proxy(Object.create(null), {
      get: () => {
        if (prototypeTrapArmed) recordTrap();
        throw new Error("unexpected array prototype get trap");
      },
      getPrototypeOf: () => {
        if (prototypeTrapArmed) {
          recordTrap();
          throw new Error("unexpected array prototype getPrototypeOf trap");
        }
        return null;
      },
      ownKeys: () => {
        if (prototypeTrapArmed) recordTrap();
        throw new Error("unexpected array prototype ownKeys trap");
      },
    });
    Object.setPrototypeOf(unsafePrototypeSources, unsafeArrayPrototype);
    prototypeTrapArmed = true;
    expect(
      capturedError(() =>
        ledger.appendDomainEvent(
          domainEventInput(13, artifacts, {
            sourceRefs: unsafePrototypeSources,
          }),
        ),
      ),
    ).toMatchObject({
      code: "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
      commitState: "not-committed",
    });

    const resolverCases = [
      (resolution) => trapProxy(resolution, recordTrap),
      (resolution) => {
        Object.defineProperty(resolution, "bytes", {
          configurable: true,
          enumerable: true,
          get() {
            trapCount += 1;
            return Buffer.alloc(0);
          },
        });
        return resolution;
      },
      (resolution) => ({
        ...resolution,
        bytes: trapProxy(resolution.bytes, recordTrap),
      }),
    ];
    for (const [index, mutate] of resolverCases.entries()) {
      const validResolver = artifactResolver(artifacts);
      const invalidLedger = createLedger({
        artifactResolver: (request) => mutate(validResolver(request)),
        authorityRootDir: path.join(
          tempRoot,
          `descriptor-artifact-authority-${index}`,
        ),
        rootDir: path.join(tempRoot, `descriptor-artifact-events-${index}`),
      });
      expect(
        capturedError(() =>
          invalidLedger.appendDomainEvent(
            domainEventInput(20 + index, artifacts),
          ),
        ),
      ).toMatchObject({
        code: "CC_EVOLUTION_LEDGER_ARTIFACT_INVALID",
        commitState: "not-committed",
      });
      expect(invalidLedger.read()).toEqual([]);
    }

    expect(trapCount).toBe(0);
    expect(ledger.read()).toEqual([]);
  });

  it("detects canonical tamper in the independently signed domain-event variant", () => {
    const ledger = createLedger();
    ledger.append(eventInput(1, artifacts));
    ledger.appendDomainEvent(domainEventInput(1, artifacts));
    const segmentPath = path.join(
      ledger.segmentDir,
      regularFiles(ledger.segmentDir)[1],
    );
    const tampered = jsonFile(segmentPath);
    tampered.reason = "CC_SKILL_MUTATION_SCOPE_DENIED";
    writeCanonical(segmentPath, tampered);

    expect(capturedError(() => createLedger()).code).toBe(
      "CC_EVOLUTION_LEDGER_CORRUPT",
    );
  });

  it("fails closed when an authenticated segment is rewritten to an unknown future event schema", () => {
    const ledger = createLedger();
    ledger.appendDomainEvent(domainEventInput(30, artifacts));
    const segmentPath = path.join(
      ledger.segmentDir,
      regularFiles(ledger.segmentDir)[0],
    );
    const future = jsonFile(segmentPath);
    future.schema = "chainlesschain.evolution-domain-event/v999";
    writeCanonical(segmentPath, future);

    const error = capturedError(() => createLedger());
    expect([
      "CC_EVOLUTION_LEDGER_CORRUPT",
      "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
    ]).toContain(error.code);
  });

  it("rejects replaying legacy and domain signatures across their independent signing domains", () => {
    const scenarios = [
      {
        appendFirst(ledger) {
          ledger.append(eventInput(40, artifacts));
        },
        appendSecond(ledger) {
          ledger.appendDomainEvent(domainEventInput(40, artifacts));
        },
      },
      {
        appendFirst(ledger) {
          ledger.appendDomainEvent(domainEventInput(41, artifacts));
        },
        appendSecond(ledger) {
          ledger.append(eventInput(41, artifacts));
        },
      },
    ];
    for (const [index, scenario] of scenarios.entries()) {
      const rootDir = path.join(tempRoot, `cross-domain-events-${index}`);
      const authorityRootDir = path.join(
        tempRoot,
        `cross-domain-authority-${index}`,
      );
      const ledger = createLedger({ rootDir, authorityRootDir });
      scenario.appendFirst(ledger);
      scenario.appendSecond(ledger);
      const [firstName, secondName] = regularFiles(ledger.segmentDir);
      const first = jsonFile(path.join(ledger.segmentDir, firstName));
      const secondPath = path.join(ledger.segmentDir, secondName);
      const replayed = jsonFile(secondPath);
      replayed.eventDigest = first.eventDigest;
      replayed.signature = first.signature;
      writeCanonical(secondPath, replayed);

      expect(
        capturedError(() => createLedger({ rootDir, authorityRootDir })).code,
      ).toBe("CC_EVOLUTION_LEDGER_CORRUPT");
    }
  });

  it("derives committedAt from the trusted clock instead of caller event time", () => {
    const ledger = createLedger();
    const receipt = ledger.append(
      eventInput(1, artifacts, { timestamp: "2001-01-01T00:00:00.000Z" }),
    );
    expect(ledger.read()[0].timestamp).toBe("2001-01-01T00:00:00.000Z");
    expect(receipt.committedAt).toBe("2026-09-01T10:00:00.000Z");
  });

  it("provides authenticated query, receipt recovery, and receipt verification ports", () => {
    const ledger = createLedger();
    const receipt = ledger.append(eventInput(1, artifacts));
    const query = ledger.query({ eventId: "event-1" });

    expect(query).toMatchObject({
      schema: EVOLUTION_LEDGER_QUERY_SCHEMA,
      authenticated: true,
      durable: true,
      event: { eventId: "event-1", sequence: 1 },
      receipt: { eventId: "event-1", authenticated: true, durable: true },
      authority: { ledgerId: receipt.ledgerId, epoch: receipt.epoch },
    });
    expect(ledger.query({ eventId: "missing-event" })).toBeNull();
    expect(ledger.findByEventId("event-1")).toEqual(query.event);
    expect(
      ledger.recoverReceipt({ eventDigest: receipt.eventDigest }),
    ).toMatchObject({
      eventId: "event-1",
      eventDigest: receipt.eventDigest,
      durabilityMechanism: "verified-existing",
    });
    expect(
      ledger.verifyReceipt(receipt, { requireCurrentHead: true }),
    ).toMatchObject({
      valid: true,
      authenticated: true,
      durable: true,
      event: { eventId: "event-1" },
    });

    const tampered = structuredClone(receipt);
    tampered.ledgerId = "ledger-tampered";
    expect(capturedError(() => ledger.verifyReceipt(tampered)).code).toBe(
      "CC_EVOLUTION_LEDGER_RECEIPT_INVALID",
    );
  });

  it("recovers and verifies receipts for domain events after reopen", () => {
    const ledger = createLedger();
    const committed = ledger.appendDomainEvent(domainEventInput(50, artifacts));
    const reopened = createLedger();
    const recovered = reopened.recoverReceipt({
      eventId: committed.eventId,
    });

    expect(recovered).toMatchObject({
      durabilityMechanism: "verified-existing",
      eventDigest: committed.eventDigest,
      eventId: committed.eventId,
      sequence: 1,
    });
    expect(reopened.verifyReceipt(recovered)).toMatchObject({
      authenticated: true,
      durable: true,
      event: {
        eventId: committed.eventId,
        schema: EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
      },
      valid: true,
    });
  });

  it("rejects stale-current, cross-ledger, and signature-header receipt replay", () => {
    const ledger = createLedger();
    const first = ledger.append(eventInput(1, artifacts));
    ledger.append(eventInput(2, artifacts));
    expect(ledger.verifyReceipt(first)).toMatchObject({ valid: true });
    expect(
      capturedError(() =>
        ledger.verifyReceipt(first, { requireCurrentHead: true }),
      ).code,
    ).toBe("CC_EVOLUTION_LEDGER_RECEIPT_INVALID");

    const other = createLedger({
      rootDir: path.join(tempRoot, "receipt-replay-events"),
      authorityRootDir: path.join(tempRoot, "receipt-replay-authority"),
    });
    expect(capturedError(() => other.verifyReceipt(first)).code).toBe(
      "CC_EVOLUTION_LEDGER_RECEIPT_INVALID",
    );

    const substituted = structuredClone(first);
    substituted.signature.keyId = "key://tests/substituted";
    expect(capturedError(() => ledger.verifyReceipt(substituted)).code).toBe(
      "CC_EVOLUTION_LEDGER_RECEIPT_INVALID",
    );
  });

  it("fails closed when an older receipt lacks authenticated witness ancestry", () => {
    const rootDir = path.join(tempRoot, "receipt-proof-events");
    const authorityRootDir = path.join(tempRoot, "receipt-proof-authority");
    const witnessId = witnessIdFor(authorityRootDir);
    const baseWitness = authorityWitness(witnessId, witnessStates);
    const prooflessWitness = {
      ...baseWitness,
      proveAncestry() {
        throw new Error("simulated missing witness history");
      },
    };
    const ledger = createLedger({
      rootDir,
      authorityRootDir,
      witness: prooflessWitness,
    });
    const first = ledger.append(eventInput(11, artifacts));
    ledger.append(eventInput(12, artifacts));

    expect(capturedError(() => ledger.verifyReceipt(first)).code).toBe(
      "CC_EVOLUTION_LEDGER_RECEIPT_INVALID",
    );
  });

  it("binds algorithm, keyId, and trustPolicyDigest into identity, event, anchor, digest, and signature", () => {
    const ledger = createLedger();
    const receipt = ledger.append(eventInput(1, artifacts));
    const event = ledger.read()[0];
    const head = jsonFile(ledger.headPath);

    for (const record of [event, head, receipt]) {
      expect(record.algorithm).toBe(TRUST.algorithm);
      expect(record.keyId).toBe(TRUST.keyId);
      expect(record.trustPolicyDigest).toBe(TRUST.trustPolicyDigest);
      expect(record.signature).toMatchObject(TRUST);
      expect(record).toMatchObject({
        witnessAlgorithm: WITNESS_TRUST.algorithm,
        witnessId: witnessIdFor(authorityRoot),
        witnessKeyId: WITNESS_TRUST.keyId,
        witnessTrustPolicyDigest: WITNESS_TRUST.trustPolicyDigest,
      });
    }
    expect(receipt.witnessCheckpoint.signature).toMatchObject(WITNESS_TRUST);
    expect(receipt.witnessCheckpoint.keyId).not.toBe(receipt.keyId);

    const differentTrust = {
      ...TRUST,
      trustPolicyDigest: digestBytes("different-trust-policy"),
    };
    const error = capturedError(() =>
      createLedger({
        trust: differentTrust,
        sign: ({ message }) => ({
          ...differentTrust,
          value: hmac(message),
        }),
        verifySignature: ({ message, signature }) =>
          signature.value === hmac(message),
      }),
    );
    expect([
      "CC_EVOLUTION_LEDGER_TRUST_MISMATCH",
      "CC_EVOLUTION_LEDGER_SIGNATURE_INVALID",
      "CC_EVOLUTION_LEDGER_WITNESS_INVALID",
    ]).toContain(error.code);
  });

  it("requires an authenticated artifact resolver and validates resolved bytes", () => {
    const ledger = createLedger({
      artifactResolver: ({ ref }) => ({
        schema: EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
        authenticated: true,
        bytes: Buffer.from("wrong-bytes"),
        digest: ref.digest,
        found: true,
        receiptDigest: digestBytes("bad-resolution"),
        ref: ref.ref,
      }),
    });
    const error = capturedError(() => ledger.append(eventInput(1, artifacts)));
    expect(error).toMatchObject({
      code: "CC_EVOLUTION_LEDGER_ARTIFACT_INVALID",
      commitState: "not-committed",
    });
    expect(ledger.read()).toEqual([]);

    const invalidResolutions = [
      (resolution) => ({ ...resolution, found: false }),
      (resolution) => ({ ...resolution, authenticated: false }),
      (resolution) => ({ ...resolution, ref: `${resolution.ref}-substituted` }),
      (resolution) => ({
        ...resolution,
        receiptDigest: "sha256:invalid",
      }),
    ];
    for (const [index, mutate] of invalidResolutions.entries()) {
      const validResolver = artifactResolver(artifacts);
      const invalidLedger = createLedger({
        rootDir: path.join(tempRoot, `invalid-artifact-events-${index}`),
        authorityRootDir: path.join(
          tempRoot,
          `invalid-artifact-authority-${index}`,
        ),
        artifactResolver: (request) => mutate(validResolver(request)),
      });
      expect(
        capturedError(() =>
          invalidLedger.append(eventInput(index + 10, artifacts)),
        ).code,
      ).toBe("CC_EVOLUTION_LEDGER_ARTIFACT_INVALID");
    }

    expect(
      capturedError(
        () =>
          new EvolutionLedger({
            rootDir: path.join(tempRoot, "missing-resolver-events"),
            authorityRootDir: path.join(tempRoot, "missing-resolver-authority"),
            secure: false,
            trust: TRUST,
            ...ports,
          }),
      ).code,
    ).toBe("CC_EVOLUTION_LEDGER_TRUST_PORT_REQUIRED");
  });

  it("captures and freezes trusted ports and paths against post-construction mutation", () => {
    const mutableFs = filesystemWith();
    const mutableTrust = { ...TRUST };
    const mutablePorts = signingPorts();
    const mutableWitness = authorityWitness(
      witnessIdFor(authorityRoot),
      witnessStates,
    );
    const ledger = createLedger({
      fsImpl: mutableFs,
      trust: mutableTrust,
      witness: mutableWitness,
      ...mutablePorts,
    });
    mutableFs.openSync = () => {
      throw new Error("mutated filesystem port");
    };
    mutableTrust.algorithm = "none";
    mutablePorts.sign = () => {
      throw new Error("mutated signer container");
    };
    mutableWitness.read = () => {
      throw new Error("mutated witness container");
    };

    expect(ledger.append(eventInput(1, artifacts))).toMatchObject({
      committed: true,
      durable: true,
      algorithm: TRUST.algorithm,
    });
    expect(ledger.verify()).toMatchObject({
      algorithm: TRUST.algorithm,
      sequence: 1,
    });

    const receiverFs = filesystemWith({
      deny: false,
      openSync(...args) {
        if (this?.deny) throw new Error("mutable receiver was consulted");
        return fs.openSync(...args);
      },
    });
    const receiverLedger = createLedger({
      rootDir: path.join(tempRoot, "receiver-events"),
      authorityRootDir: path.join(tempRoot, "receiver-authority"),
      fsImpl: receiverFs,
    });
    receiverFs.deny = true;
    expect(receiverLedger.append(eventInput(2, artifacts))).toMatchObject({
      committed: true,
    });
  });

  it("rejects deleting the complete event log after an authority was initialized", () => {
    const ledger = createLedger();
    ledger.append(eventInput(1, artifacts));
    fs.rmSync(ledger.rootDir, { recursive: true, force: true });

    const error = capturedError(() => createLedger());
    expect(error.code).toBe("CC_EVOLUTION_LEDGER_CORRUPT");
    expect(fs.existsSync(path.join(authorityRoot, "identity-v1.json"))).toBe(
      true,
    );
    expect(jsonFile(path.join(authorityRoot, "head-v1.json")).sequence).toBe(1);
  });

  it("rejects deleting every local ledger file while the monotonic witness remains active", () => {
    const ledger = createLedger();
    ledger.append(eventInput(1, artifacts));
    fs.rmSync(ledger.rootDir, { recursive: true, force: true });
    fs.rmSync(ledger.authorityRootDir, { recursive: true, force: true });

    expect(capturedError(() => createLedger()).code).toBe(
      "CC_EVOLUTION_LEDGER_CORRUPT",
    );
  });

  it("rejects a coordinated rollback of segments, anchors, and HEAD to an older signed snapshot", () => {
    const ledger = createLedger();
    ledger.append(eventInput(1, artifacts));
    const oldHeadBytes = fs.readFileSync(ledger.headPath);
    ledger.append(eventInput(2, artifacts));

    fs.unlinkSync(
      path.join(ledger.segmentDir, regularFiles(ledger.segmentDir).at(-1)),
    );
    fs.unlinkSync(
      path.join(ledger.anchorDir, regularFiles(ledger.anchorDir).at(-1)),
    );
    fs.writeFileSync(ledger.headPath, oldHeadBytes);

    expect(capturedError(() => createLedger()).code).toBe(
      "CC_EVOLUTION_LEDGER_CORRUPT",
    );
  });

  it("rejects substituting a different fully signed ledger under the same trust key", () => {
    const original = createLedger();
    original.append(eventInput(1, artifacts));

    const alternateEventRoot = path.join(tempRoot, "alternate-events");
    const alternateAuthorityRoot = path.join(tempRoot, "alternate-authority");
    const isolatedWitnessStates = new Map();
    const alternate = createLedger({
      rootDir: alternateEventRoot,
      authorityRootDir: alternateAuthorityRoot,
      witness: authorityWitness(
        witnessIdFor(authorityRoot),
        isolatedWitnessStates,
      ),
    });
    alternate.append(eventInput(9, artifacts));

    fs.rmSync(original.rootDir, { recursive: true, force: true });
    fs.rmSync(original.authorityRootDir, { recursive: true, force: true });
    fs.cpSync(alternate.rootDir, original.rootDir, { recursive: true });
    fs.cpSync(alternate.authorityRootDir, original.authorityRootDir, {
      recursive: true,
    });
    expect(capturedError(() => createLedger()).code).toBe(
      "CC_EVOLUTION_LEDGER_CORRUPT",
    );
  });

  it("rejects deleting HEAD or rolling the immutable log prefix behind HEAD", () => {
    const ledger = createLedger();
    ledger.append(eventInput(1, artifacts));
    ledger.append(eventInput(2, artifacts));
    const segmentNames = regularFiles(ledger.segmentDir);
    const anchorNames = regularFiles(ledger.anchorDir);

    fs.unlinkSync(path.join(ledger.segmentDir, segmentNames.at(-1)));
    fs.unlinkSync(path.join(ledger.anchorDir, anchorNames.at(-1)));
    expect(capturedError(() => createLedger()).code).toBe(
      "CC_EVOLUTION_LEDGER_CORRUPT",
    );

    const otherRoot = path.join(tempRoot, "head-delete-events");
    const otherAuthority = path.join(tempRoot, "head-delete-authority");
    const other = createLedger({
      rootDir: otherRoot,
      authorityRootDir: otherAuthority,
    });
    other.append(eventInput(3, artifacts));
    fs.unlinkSync(other.headPath);
    expect(
      capturedError(() =>
        createLedger({ rootDir: otherRoot, authorityRootDir: otherAuthority }),
      ).code,
    ).toBe("CC_EVOLUTION_LEDGER_CORRUPT");
  });

  it("rejects signature-header substitution in identity and event segments", () => {
    const ledger = createLedger();
    ledger.append(eventInput(1, artifacts));
    const segmentPath = path.join(
      ledger.segmentDir,
      regularFiles(ledger.segmentDir)[0],
    );
    const segment = jsonFile(segmentPath);
    segment.signature.keyId = "key://tests/substituted";
    writeCanonical(segmentPath, segment);
    expect(capturedError(() => ledger.verify()).code).toBe(
      "CC_EVOLUTION_LEDGER_SIGNATURE_INVALID",
    );

    const otherRoot = path.join(tempRoot, "identity-header-events");
    const otherAuthority = path.join(tempRoot, "identity-header-authority");
    const other = createLedger({
      rootDir: otherRoot,
      authorityRootDir: otherAuthority,
    });
    const identity = jsonFile(other.identityPath);
    identity.algorithm = "none";
    writeCanonical(other.identityPath, identity);
    expect(
      capturedError(() =>
        createLedger({ rootDir: otherRoot, authorityRootDir: otherAuthority }),
      ).code,
    ).toBe("CC_EVOLUTION_LEDGER_TRUST_MISMATCH");

    const witnessRoot = path.join(tempRoot, "witness-header-events");
    const witnessAuthority = path.join(tempRoot, "witness-header-authority");
    createLedger({
      rootDir: witnessRoot,
      authorityRootDir: witnessAuthority,
    });
    const witnessId = witnessIdFor(witnessAuthority);
    const witnessRecord = structuredClone(witnessStates.get(witnessId));
    witnessRecord.signature.keyId = "key://tests/substituted";
    witnessStates.set(witnessId, witnessRecord);
    expect(
      capturedError(() =>
        createLedger({
          rootDir: witnessRoot,
          authorityRootDir: witnessAuthority,
        }),
      ).code,
    ).toBe("CC_EVOLUTION_LEDGER_WITNESS_INVALID");
  });

  it("rejects hard-link aliases and permanently fences marker alias replay", () => {
    const ledger = createLedger();
    ledger.append(eventInput(1, artifacts));
    const targets = [
      ledger.identityPath,
      ledger.headPath,
      path.join(ledger.segmentDir, regularFiles(ledger.segmentDir)[0]),
      path.join(ledger.anchorDir, regularFiles(ledger.anchorDir).at(-1)),
      ledger.storeMarkerPath,
    ];
    for (const [index, target] of targets.entries()) {
      const alias = path.join(tempRoot, `alias-${index}.json`);
      fs.linkSync(target, alias);
      expect(capturedError(() => ledger.verify()).code).toBe(
        "CC_EVOLUTION_LEDGER_CORRUPT",
      );
      fs.unlinkSync(alias);
      if (index < targets.length - 1) {
        expect(ledger.verify()).toMatchObject({ sequence: 1 });
      }
    }
    expect(capturedError(() => ledger.verify()).code).toBe(
      "CC_EVOLUTION_LEDGER_CORRUPT",
    );
  });

  it("recovers a torn unanchored segment and hard-link staging debris without moving HEAD", () => {
    const torn = createLedger({
      crashHook(phase) {
        if (phase === "after-segment-link") {
          throw new Error(
            "simulated process death after hard-link publication",
          );
        }
      },
    });
    const error = capturedError(() => torn.append(eventInput(1, artifacts)));
    expect(error.commitState).toBe("not-committed");
    expect(
      fs
        .readdirSync(torn.segmentDir)
        .some((name) => name.startsWith(".stage-")),
    ).toBe(true);

    const reopened = createLedger();
    expect(reopened.read()).toEqual([]);
    expect(reopened.verify()).toMatchObject({ sequence: 0, headDigest: null });
    expect(fs.readdirSync(reopened.segmentDir)).toEqual([]);

    const tail = createLedger({
      crashHook(phase) {
        if (phase === "after-segment") {
          throw new Error("simulated death before anchor");
        }
      },
    });
    expect(
      capturedError(() => tail.append(eventInput(2, artifacts))).commitState,
    ).toBe("not-committed");
    expect(regularFiles(tail.segmentDir)).toHaveLength(1);
    expect(createLedger().read()).toEqual([]);
  });

  it("fails closed on malformed immutable and HEAD staging debris", () => {
    const ledger = createLedger();
    const malformedImmutable = path.join(ledger.segmentDir, ".stage-garbage");
    fs.writeFileSync(malformedImmutable, "garbage");
    expect(capturedError(() => createLedger()).code).toBe(
      "CC_EVOLUTION_LEDGER_STORE_UNSAFE",
    );
    fs.unlinkSync(malformedImmutable);

    const malformedHead = path.join(
      ledger.authorityRootDir,
      ".replace-garbage",
    );
    fs.writeFileSync(malformedHead, "garbage");
    expect(capturedError(() => createLedger()).code).toBe(
      "CC_EVOLUTION_LEDGER_STORE_UNSAFE",
    );
  });

  it("removes a fully written but unwitnessed anchor tail on reopen", () => {
    const unwitnessed = createLedger({
      crashHook(phase) {
        if (phase === "after-anchor") {
          throw new Error("simulated death before witness CAS");
        }
      },
    });
    const error = capturedError(() =>
      unwitnessed.append(eventInput(1, artifacts)),
    );
    const witnessId = witnessIdFor(authorityRoot);
    const beforeFence = structuredClone(witnessStates.get(witnessId));
    expect(error.commitState).toBe("not-committed");
    expect(regularFiles(unwitnessed.anchorDir)).toHaveLength(2);

    const reopened = createLedger();
    expect(reopened.read()).toEqual([]);
    expect(regularFiles(reopened.anchorDir)).toHaveLength(1);
    expect(regularFiles(reopened.segmentDir)).toHaveLength(0);
    const afterFence = witnessStates.get(witnessId);
    expect(afterFence).toMatchObject({
      generation: beforeFence.generation + 1,
      previousWitnessDigest: beforeFence.witnessDigest,
      sequence: beforeFence.sequence,
      anchorDigest: beforeFence.anchorDigest,
    });
    expect(afterFence.discardAccumulatorDigest).not.toBe(
      beforeFence.discardAccumulatorDigest,
    );
    expect(createLedger().verify()).toMatchObject({
      witnessDigest: afterFence.witnessDigest,
    });
    expect(witnessStates.get(witnessId)).toEqual(afterFence);
  });

  it("rejects a witness that echoes the old state instead of persisting a discard fence", () => {
    const rootDir = path.join(tempRoot, "echo-fence-events");
    const authorityRootDir = path.join(tempRoot, "echo-fence-authority");
    const witnessId = witnessIdFor(authorityRootDir);
    const baseWitness = authorityWitness(witnessId, witnessStates);
    const ledger = createLedger({
      rootDir,
      authorityRootDir,
      witness: baseWitness,
      crashHook(phase) {
        if (phase === "after-anchor") {
          throw new Error("simulated death before witness CAS");
        }
      },
    });
    capturedError(() => ledger.append(eventInput(1, artifacts)));
    const before = structuredClone(witnessStates.get(witnessId));
    const echoWitness = {
      ...baseWitness,
      compareAndSwap(request) {
        if (request.discard) return request.expected;
        return baseWitness.compareAndSwap(request);
      },
    };

    const error = capturedError(() =>
      createLedger({ rootDir, authorityRootDir, witness: echoWitness }),
    );
    expect(error.code).toBe("CC_EVOLUTION_LEDGER_WITNESS_CONFLICT");
    expect(witnessStates.get(witnessId)).toEqual(before);
    expect(regularFiles(ledger.anchorDir)).toHaveLength(2);
    expect(regularFiles(ledger.segmentDir)).toHaveLength(1);
  });

  it("durably persists a file-witness discard and rejects stale orphan revival", () => {
    const rootDir = path.join(tempRoot, "file-fence-events");
    const authorityRootDir = path.join(tempRoot, "file-fence-authority");
    const witnessId = witnessIdFor(authorityRootDir);
    const witnessPath = path.join(tempRoot, "external-witness.json");
    const persistentWitness = productionFileAuthorityWitness(
      witnessId,
      witnessPath,
    );
    const ledger = createLedger({
      rootDir,
      authorityRootDir,
      witness: persistentWitness,
      crashHook(phase) {
        if (phase === "after-anchor") {
          throw new Error("simulated death before witness CAS");
        }
      },
    });
    capturedError(() => ledger.append(eventInput(1, artifacts)));
    const staleWitness = persistentWitness.read();
    const identity = jsonFile(ledger.identityPath);
    const storeMarker = jsonFile(ledger.storeMarkerPath);
    const orphanAnchor = jsonFile(
      path.join(ledger.anchorDir, regularFiles(ledger.anchorDir).at(-1)),
    );
    const orphanEvent = jsonFile(
      path.join(ledger.segmentDir, regularFiles(ledger.segmentDir).at(-1)),
    );
    const orphanSnapshot = {
      ...WITNESS_TRUST,
      anchorDigest: orphanAnchor.anchorDigest,
      epoch: identity.epoch,
      headDigest: orphanAnchor.headDigest,
      identityDigest: identity.identityDigest,
      ledgerId: identity.ledgerId,
      payloadDigest: digestBytes(
        Buffer.from(
          `chainlesschain.evolution-witness-payload/v1\0${canonicalJson({
            anchor: orphanAnchor,
            event: orphanEvent,
            identity,
            storeMarker,
          })}`,
        ),
      ),
      segmentDigest: orphanAnchor.segmentDigest,
      sequence: orphanAnchor.sequence,
      storeMarkerDigest: identity.storeMarkerDigest,
      storeMarkerEntryDigest: identity.storeMarkerEntryDigest,
      storeMarkerId: identity.storeMarkerId,
      witnessId,
    };
    let discardRequest;
    const recordingWitness = {
      ...persistentWitness,
      compareAndSwap(request) {
        if (request.discard) discardRequest = structuredClone(request);
        return persistentWitness.compareAndSwap(request);
      },
    };

    const reopened = createLedger({
      rootDir,
      authorityRootDir,
      witness: recordingWitness,
    });
    const fenced = persistentWitness.read();
    expect(fenced).toMatchObject({
      generation: staleWitness.generation + 1,
      previousWitnessDigest: staleWitness.witnessDigest,
      sequence: staleWitness.sequence,
    });
    expect(fenced.discardAccumulatorDigest).not.toBe(
      staleWitness.discardAccumulatorDigest,
    );
    expect(discardRequest.discard.sequence).toBe(1);

    const staleRevival = persistentWitness.compareAndSwap({
      expected: fenced,
      next: orphanSnapshot,
    });
    expect(staleRevival.witnessDigest).toBe(fenced.witnessDigest);
    expect(persistentWitness.read()).toEqual(fenced);
    expect(
      createLedger({
        rootDir,
        authorityRootDir,
        witness: productionFileAuthorityWitness(witnessId, witnessPath),
      }).verify(),
    ).toMatchObject({ sequence: 0, witnessDigest: fenced.witnessDigest });
    expect(reopened.read()).toEqual([]);
  });

  it("does not delete an orphan tail when the witness advances during its discard fence", () => {
    const rootDir = path.join(tempRoot, "fence-race-events");
    const authorityRootDir = path.join(tempRoot, "fence-race-authority");
    const ledger = createLedger({
      rootDir,
      authorityRootDir,
      crashHook(phase) {
        if (phase === "after-anchor") {
          throw new Error("simulated death before witness CAS");
        }
      },
    });
    capturedError(() => ledger.append(eventInput(1, artifacts)));
    const identity = jsonFile(ledger.identityPath);
    const storeMarker = jsonFile(ledger.storeMarkerPath);
    const anchor = jsonFile(
      path.join(ledger.anchorDir, regularFiles(ledger.anchorDir).at(-1)),
    );
    const event = jsonFile(
      path.join(ledger.segmentDir, regularFiles(ledger.segmentDir)[0]),
    );
    const witnessId = witnessIdFor(authorityRootDir);
    const advancedSnapshot = {
      ...witnessStates.get(witnessId),
      anchorDigest: anchor.anchorDigest,
      epoch: identity.epoch,
      headDigest: anchor.headDigest,
      identityDigest: identity.identityDigest,
      ledgerId: identity.ledgerId,
      payloadDigest: digestBytes(
        Buffer.from(
          `chainlesschain.evolution-witness-payload/v1\0${canonicalJson({ anchor, event, identity, storeMarker })}`,
        ),
      ),
      segmentDigest: anchor.segmentDigest,
      sequence: anchor.sequence,
    };
    const baseWitness = authorityWitness(witnessId, witnessStates);
    const racingWitness = {
      ...baseWitness,
      compareAndSwap: (request) => {
        if (request.discard) {
          const advanced = advancedWitness(
            witnessId,
            witnessStates.get(witnessId),
            advancedSnapshot,
          );
          witnessStates.set(witnessId, advanced);
          return advanced;
        }
        return baseWitness.compareAndSwap(request);
      },
    };
    expect(
      capturedError(() =>
        createLedger({
          rootDir,
          authorityRootDir,
          witness: racingWitness,
        }),
      ).code,
    ).toBe("CC_EVOLUTION_LEDGER_WITNESS_CONFLICT");
    expect(regularFiles(ledger.anchorDir)).toHaveLength(2);
    expect(regularFiles(ledger.segmentDir)).toHaveLength(1);

    expect(createLedger({ rootDir, authorityRootDir }).verify()).toMatchObject({
      sequence: 1,
    });
  });

  it("reports commit unknown after witness CAS and completes HEAD forward on reopen", () => {
    const uncertain = createLedger({
      crashHook(phase) {
        if (phase === "after-witness") {
          throw new Error("simulated death before HEAD replacement");
        }
      },
    });
    const error = capturedError(() =>
      uncertain.append(eventInput(1, artifacts)),
    );
    expect(error).toMatchObject({
      code: "CC_EVOLUTION_LEDGER_COMMIT_UNKNOWN",
      commitState: "unknown",
      eventId: "event-1",
    });
    expect(jsonFile(uncertain.headPath).sequence).toBe(0);

    const reopened = createLedger();
    expect(reopened.verify()).toMatchObject({ sequence: 1 });
    expect(jsonFile(reopened.headPath).sequence).toBe(1);
    expect(reopened.query({ eventId: "event-1" })).toMatchObject({
      authenticated: true,
      durable: true,
      event: { eventId: "event-1", sequence: 1 },
    });
  });

  it("resolves a witness CAS response-loss ambiguity by authenticated query on reopen", () => {
    const rootDir = path.join(tempRoot, "cas-loss-events");
    const authorityRootDir = path.join(tempRoot, "cas-loss-authority");
    const witnessId = witnessIdFor(authorityRootDir);
    const durableWitness = authorityWitness(witnessId, witnessStates);
    const responseLossWitness = {
      ...durableWitness,
      compareAndSwap: (request) => {
        durableWitness.compareAndSwap(request);
        throw new Error("simulated response loss after durable CAS");
      },
    };
    const uncertain = createLedger({
      rootDir,
      authorityRootDir,
      witness: responseLossWitness,
    });
    const error = capturedError(() =>
      uncertain.append(eventInput(1, artifacts)),
    );
    expect(error).toMatchObject({
      code: "CC_EVOLUTION_LEDGER_COMMIT_UNKNOWN",
      commitState: "unknown",
      eventId: "event-1",
    });
    expect(jsonFile(uncertain.headPath).sequence).toBe(0);

    const reopened = createLedger({ rootDir, authorityRootDir });
    const recovered = reopened.recoverReceipt({ eventId: "event-1" });
    expect(reopened.verifyReceipt(recovered)).toMatchObject({
      valid: true,
      event: { eventId: "event-1", sequence: 1 },
    });
  });

  it("recovers a domain event after witness CAS commits but its response is lost", () => {
    const rootDir = path.join(tempRoot, "domain-cas-loss-events");
    const authorityRootDir = path.join(tempRoot, "domain-cas-loss-authority");
    const witnessId = witnessIdFor(authorityRootDir);
    const durableWitness = authorityWitness(witnessId, witnessStates);
    const responseLossWitness = {
      ...durableWitness,
      compareAndSwap: (request) => {
        durableWitness.compareAndSwap(request);
        throw new Error("simulated domain witness CAS response loss");
      },
    };
    const uncertain = createLedger({
      rootDir,
      authorityRootDir,
      witness: responseLossWitness,
    });
    const error = capturedError(() =>
      uncertain.appendDomainEvent(domainEventInput(60, artifacts)),
    );
    expect(error).toMatchObject({
      code: "CC_EVOLUTION_LEDGER_COMMIT_UNKNOWN",
      commitState: "unknown",
      eventId: "domain-event-60",
      witnessPublished: false,
    });
    expect(jsonFile(uncertain.headPath).sequence).toBe(0);

    const reopened = createLedger({ rootDir, authorityRootDir });
    expect(reopened.query({ eventId: "domain-event-60" })).toMatchObject({
      authenticated: true,
      durable: true,
      event: {
        eventId: "domain-event-60",
        schema: EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
        sequence: 1,
      },
    });
    const recovered = reopened.recoverReceipt({ eventId: "domain-event-60" });
    expect(reopened.verifyReceipt(recovered)).toMatchObject({
      event: { eventId: "domain-event-60" },
      valid: true,
    });
  });

  it("reports commit unknown when local HEAD publication fails after witness commit", () => {
    let failHeadRename = false;
    const failingFs = filesystemWith({
      renameSync(source, target) {
        if (failHeadRename && path.basename(target) === "head-v1.json") {
          const error = new Error("simulated HEAD rename failure");
          error.code = "EIO";
          throw error;
        }
        return fs.renameSync(source, target);
      },
    });
    const ledger = createLedger({ fsImpl: failingFs });
    failHeadRename = true;
    const error = capturedError(() => ledger.append(eventInput(1, artifacts)));
    expect(error).toMatchObject({
      code: "CC_EVOLUTION_LEDGER_COMMIT_UNKNOWN",
      commitState: "unknown",
      eventId: "event-1",
    });

    expect(createLedger().query({ eventId: "event-1" })).toMatchObject({
      authenticated: true,
      durable: true,
      event: { sequence: 1 },
    });
  });

  it("recovers a domain event after local HEAD publication fails post-witness", () => {
    let failHeadRename = false;
    const failingFs = filesystemWith({
      renameSync(source, target) {
        if (failHeadRename && path.basename(target) === "head-v1.json") {
          const error = new Error("simulated domain HEAD rename failure");
          error.code = "EIO";
          throw error;
        }
        return fs.renameSync(source, target);
      },
    });
    const ledger = createLedger({ fsImpl: failingFs });
    failHeadRename = true;
    const error = capturedError(() =>
      ledger.appendDomainEvent(domainEventInput(61, artifacts)),
    );
    expect(error).toMatchObject({
      code: "CC_EVOLUTION_LEDGER_COMMIT_UNKNOWN",
      commitState: "unknown",
      eventId: "domain-event-61",
      witnessPublished: true,
    });

    const reopened = createLedger();
    expect(reopened.query({ eventId: "domain-event-61" })).toMatchObject({
      authenticated: true,
      durable: true,
      event: {
        eventId: "domain-event-61",
        schema: EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
        sequence: 1,
      },
    });
    const recovered = reopened.recoverReceipt({ eventId: "domain-event-61" });
    expect(reopened.verifyReceipt(recovered)).toMatchObject({
      event: { eventId: "domain-event-61" },
      valid: true,
    });
  });

  it.runIf(process.platform === "win32")(
    "fails before witness CAS when native Windows directory fsync is unavailable",
    () => {
      createLedger();
      const witnessId = witnessIdFor(authorityRoot);
      const before = structuredClone(witnessStates.get(witnessId));
      const nativeLedger = createLedger({ fsImpl: fs });

      const error = capturedError(() =>
        nativeLedger.append(eventInput(1, artifacts)),
      );
      expect(error).toMatchObject({
        code: "CC_EVOLUTION_LEDGER_DURABILITY_UNAVAILABLE",
        commitState: "not-committed",
      });
      expect(error).not.toHaveProperty("receipt");
      expect(witnessStates.get(witnessId)).toEqual(before);
    },
  );

  it("fails before publication on disk error and preserves the anchored head", () => {
    const base = createLedger();
    const before = base.verify();
    let failNextFsync = true;
    const failingFs = filesystemWith({
      fsyncSync(descriptor) {
        if (failNextFsync) {
          failNextFsync = false;
          const error = new Error("disk full");
          error.code = "ENOSPC";
          throw error;
        }
        return fs.fsyncSync(descriptor);
      },
    });
    const ledger = createLedger({ fsImpl: failingFs });
    const error = capturedError(() => ledger.append(eventInput(1, artifacts)));
    expect(error).toMatchObject({ commitState: "not-committed" });
    expect(createLedger().verify()).toMatchObject({
      sequence: before.sequence,
      anchorDigest: before.anchorDigest,
    });
    expect(createLedger().read()).toEqual([]);
  });

  it("detects canonical-byte tamper, truncation, and missing anchored segments", () => {
    const mutations = [
      (ledger) => {
        const segmentPath = path.join(
          ledger.segmentDir,
          regularFiles(ledger.segmentDir)[0],
        );
        const bytes = fs.readFileSync(segmentPath);
        fs.writeFileSync(segmentPath, bytes.subarray(0, bytes.length - 1));
      },
      (ledger) => {
        const segmentPath = path.join(
          ledger.segmentDir,
          regularFiles(ledger.segmentDir)[0],
        );
        fs.writeFileSync(
          segmentPath,
          ` ${fs.readFileSync(segmentPath, "utf8")}`,
        );
      },
      (ledger) => {
        fs.unlinkSync(
          path.join(ledger.segmentDir, regularFiles(ledger.segmentDir)[0]),
        );
      },
    ];
    for (const [index, mutate] of mutations.entries()) {
      const rootDir = path.join(tempRoot, `tamper-events-${index}`);
      const authorityDir = path.join(tempRoot, `tamper-authority-${index}`);
      const ledger = createLedger({
        rootDir,
        authorityRootDir: authorityDir,
      });
      ledger.append(eventInput(index + 10, artifacts));
      mutate(ledger);
      expect(
        capturedError(() =>
          createLedger({ rootDir, authorityRootDir: authorityDir }),
        ).code,
      ).toBe("CC_EVOLUTION_LEDGER_CORRUPT");
    }
  });

  it("rejects reordered canonical event records", () => {
    const ledger = createLedger();
    ledger.append(eventInput(1, artifacts));
    ledger.append(eventInput(2, artifacts));
    const [firstName, secondName] = regularFiles(ledger.segmentDir);
    const firstPath = path.join(ledger.segmentDir, firstName);
    const secondPath = path.join(ledger.segmentDir, secondName);
    const firstBytes = fs.readFileSync(firstPath);
    const secondBytes = fs.readFileSync(secondPath);
    fs.writeFileSync(firstPath, secondBytes);
    fs.writeFileSync(secondPath, firstBytes);

    expect(capturedError(() => createLedger()).code).toBe(
      "CC_EVOLUTION_LEDGER_CORRUPT",
    );
  });

  it("rehashes a warm incremental prefix and rejects same-length in-place tamper", () => {
    const ledger = createLedger();
    ledger.append(eventInput(1, artifacts));
    const segmentPath = path.join(
      ledger.segmentDir,
      regularFiles(ledger.segmentDir)[0],
    );
    const before = fs.readFileSync(segmentPath);
    const tampered = jsonFile(segmentPath);
    tampered.reason = tampered.reason.replace("candidate 1", "candidate 9");
    writeCanonical(segmentPath, tampered);
    expect(fs.statSync(segmentPath).size).toBe(before.length);

    expect(
      capturedError(() => ledger.append(eventInput(2, artifacts))).code,
    ).toBe("CC_EVOLUTION_LEDGER_CORRUPT");
  });

  it("admits exactly one of two concurrent domain appends with the same eventId", async () => {
    const witnessPath = path.join(tempRoot, "domain-conflict-witness.json");
    const witnessId = witnessIdFor(authorityRoot);
    const moduleUrl = new URL(
      "../../src/lib/evolution/evolution-ledger.js",
      import.meta.url,
    ).href;
    const outcomes = (
      await Promise.all(
        Array.from({ length: 2 }, () =>
          runEvolutionLedgerWorker({
            authorityRootDir: authorityRoot,
            captureErrors: true,
            domainEvent: true,
            indices: [1],
            moduleUrl,
            rootDir: eventRoot,
            witnessId,
            witnessPath,
          }),
        ),
      )
    ).flat();

    expect(outcomes.filter(({ ok }) => ok)).toHaveLength(1);
    expect(outcomes.find(({ ok }) => !ok)).toMatchObject({
      code: "CC_EVOLUTION_LEDGER_EVENT_CONFLICT",
      commitState: "not-committed",
      ok: false,
    });
    const ledger = createLedger({
      lockTimeoutMs: 120_000,
      witness: fileAuthorityWitness(witnessId, witnessPath),
    });
    expect(ledger.read()).toMatchObject([
      {
        eventId: "shared-domain-event-1",
        schema: EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
        sequence: 1,
      },
    ]);
    expect(ledger.verify()).toMatchObject({ eventCount: 1, sequence: 1 });
  }, 120_000);

  it("serializes one hundred concurrent fenced appends without loss, duplication, or head drift", async () => {
    const workerCount = 4;
    const witnessPath = path.join(tempRoot, "concurrent-witness.json");
    const witnessId = witnessIdFor(authorityRoot);
    const moduleUrl = new URL(
      "../../src/lib/evolution/evolution-ledger.js",
      import.meta.url,
    ).href;
    const groups = Array.from({ length: workerCount }, () => []);
    for (let index = 1; index <= 100; index += 1) {
      groups[(index - 1) % workerCount].push(index);
    }
    const receipts = (
      await Promise.all(
        groups.map((indices) =>
          runEvolutionLedgerWorker({
            authorityRootDir: authorityRoot,
            indices,
            moduleUrl,
            rootDir: eventRoot,
            witnessId,
            witnessPath,
          }),
        ),
      )
    ).flat();
    expect(new Set(receipts.map((receipt) => receipt.eventId)).size).toBe(100);
    expect(new Set(receipts.map((receipt) => receipt.eventDigest)).size).toBe(
      100,
    );
    expect(
      receipts.map((receipt) => receipt.sequence).sort((a, b) => a - b),
    ).toEqual(Array.from({ length: 100 }, (_, index) => index + 1));
    const ledger = createLedger({
      lockTimeoutMs: 120_000,
      witness: fileAuthorityWitness(witnessId, witnessPath),
    });
    expect(ledger.read({ limit: 100 })).toHaveLength(100);
    const finalReceipt = receipts.find((receipt) => receipt.sequence === 100);
    expect(ledger.verify()).toMatchObject({
      sequence: 100,
      eventCount: 100,
      headDigest: finalReceipt.eventDigest,
      anchorDigest: finalReceipt.anchorDigest,
    });
    expect(regularFiles(ledger.segmentDir)).toHaveLength(100);
    expect(regularFiles(ledger.anchorDir)).toHaveLength(101);
  }, 240_000);
});
