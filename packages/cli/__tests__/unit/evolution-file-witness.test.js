import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EVOLUTION_FILE_WITNESS_STORE_SCHEMA,
  createEvolutionFileWitness,
} from "../../src/lib/evolution/evolution-file-witness.js";

const SECRET = "test-only-independent-file-witness-key";
const TRUST = Object.freeze({
  algorithm: "hmac-sha256",
  keyId: "key://tests/independent-file-witness",
  trustPolicyDigest: digest("independent-file-witness-policy"),
});

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function hmac(message) {
  return crypto
    .createHmac("sha256", SECRET)
    .update(message)
    .digest("base64url");
}

function authorityPorts() {
  return {
    signer: {
      sign: vi.fn(({ message }) => ({ ...TRUST, value: hmac(message) })),
    },
    verifier: {
      verify: vi.fn(
        ({ message, signature, trust }) =>
          trust.algorithm === TRUST.algorithm &&
          trust.keyId === TRUST.keyId &&
          trust.trustPolicyDigest === TRUST.trustPolicyDigest &&
          signature.algorithm === TRUST.algorithm &&
          signature.keyId === TRUST.keyId &&
          signature.trustPolicyDigest === TRUST.trustPolicyDigest &&
          signature.value === hmac(message),
      ),
    },
  };
}

function sha(label) {
  return digest(Buffer.from(label, "utf8"));
}

function snapshot(witnessId, sequence) {
  return {
    ...TRUST,
    anchorDigest: sha(`anchor-${sequence}`),
    epoch: "epoch-file-witness-test",
    headDigest: sequence === 0 ? null : sha(`head-${sequence}`),
    identityDigest: sha("identity"),
    ledgerId: "ledger-file-witness-test",
    payloadDigest: sha(`payload-${sequence}`),
    segmentDigest: sequence === 0 ? null : sha(`segment-${sequence}`),
    sequence,
    storeMarkerDigest: sha("store-marker"),
    storeMarkerEntryDigest: sha("store-marker-entry"),
    storeMarkerId: "marker-file-witness-test",
    witnessId,
  };
}

describe("createEvolutionFileWitness", () => {
  let root;
  let filePath;
  let ports;
  const witnessId = "witness-file-production-test";

  beforeEach(() => {
    root = fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), "cc-evolution-file-witness-"),
    );
    filePath = path.join(root, "authority", "witness.json");
    fs.mkdirSync(path.dirname(filePath), { mode: 0o700 });
    ports = authorityPorts();
  });

  afterEach(() => {
    fs.rmSync(root, { force: true, recursive: true });
  });

  function create(overrides = {}) {
    return createEvolutionFileWitness({
      filePath,
      id: witnessId,
      trust: TRUST,
      ...ports,
      ...overrides,
    });
  }

  it("persists monotonic CAS history and authenticated ancestry across reopen", () => {
    const first = create();
    const absent = first.read();
    expect(absent).toMatchObject({ generation: 0, status: "absent" });

    const genesis = first.initialize({
      expected: absent,
      snapshot: snapshot(witnessId, 0),
    });
    const head = first.compareAndSwap({
      expected: genesis,
      next: snapshot(witnessId, 1),
    });
    expect(head).toMatchObject({
      generation: 2,
      previousWitnessDigest: genesis.witnessDigest,
      sequence: 1,
      status: "committed",
    });

    const reopened = create();
    expect(reopened.read()).toEqual(head);
    const proof = reopened.proveAncestry({
      ancestor: genesis,
      descendant: head,
    });
    expect(proof).toMatchObject({
      ancestorDigest: genesis.witnessDigest,
      authenticated: true,
      descendantDigest: head.witnessDigest,
      durable: true,
      included: true,
    });
    expect(
      ports.verifier.verify({
        message: Buffer.from(
          `chainlesschain.evolution-ledger-witness-ancestry/v1\0${canonicalCore(proof, "proofDigest")}`,
          "utf8",
        ),
        signature: proof.signature,
        trust: TRUST,
      }),
    ).toBe(true);
    expect(() =>
      reopened.proveAncestry({
        ancestor: { ...genesis, generation: 99 },
        descendant: head,
      }),
    ).toThrow(/exactly bound/u);

    const stale = reopened.compareAndSwap({
      expected: genesis,
      next: snapshot(witnessId, 2),
    });
    expect(stale).toEqual(head);
  });

  it("durably fences a discarded anchor against stale revival", () => {
    const witness = create();
    const genesis = witness.initialize({
      expected: witness.read(),
      snapshot: snapshot(witnessId, 0),
    });
    const orphan = witness.compareAndSwap({
      expected: genesis,
      next: snapshot(witnessId, 1),
    });
    const discarded = {
      anchorDigest: orphan.anchorDigest,
      headDigest: orphan.headDigest,
      segmentDigest: orphan.segmentDigest,
      sequence: orphan.sequence,
    };
    const fenced = witness.compareAndSwap({
      discard: discarded,
      expected: orphan,
      next: snapshot(witnessId, 0),
    });
    expect(fenced.discardAccumulatorDigest).not.toBe(
      orphan.discardAccumulatorDigest,
    );

    const reopened = create();
    expect(
      reopened.compareAndSwap({
        expected: fenced,
        next: snapshot(witnessId, 1),
      }),
    ).toEqual(fenced);
    expect(reopened.read()).toEqual(fenced);
    expect(
      reopened.compareAndSwap({
        discard: discarded,
        expected: fenced,
        next: snapshot(witnessId, 0),
      }),
    ).toEqual(fenced);
  });

  it("allows exactly one contender to advance a stale expected checkpoint", () => {
    const left = create();
    const right = create();
    const genesis = left.initialize({
      expected: left.read(),
      snapshot: snapshot(witnessId, 0),
    });
    const winner = left.compareAndSwap({
      expected: genesis,
      next: snapshot(witnessId, 1),
    });
    const loser = right.compareAndSwap({
      expected: genesis,
      next: snapshot(witnessId, 2),
    });
    expect(loser).toEqual(winner);
    expect(right.read()).toEqual(winner);
  });

  it("fails closed for tampered durable history", () => {
    const witness = create();
    witness.initialize({
      expected: witness.read(),
      snapshot: snapshot(witnessId, 0),
    });
    const store = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(store.schema).toBe(EVOLUTION_FILE_WITNESS_STORE_SCHEMA);
    store.history[0].generation = 7;
    fs.writeFileSync(filePath, `${JSON.stringify(store)}\n`, "utf8");
    expect(() => create().read()).toThrow(/genesis|authentication/u);
  });

  it("does not trust a substituted current pointer with a copied digest", () => {
    const witness = create();
    witness.initialize({
      expected: witness.read(),
      snapshot: snapshot(witnessId, 0),
    });
    const store = JSON.parse(fs.readFileSync(filePath, "utf8"));
    store.current.sequence = 1;
    fs.writeFileSync(filePath, `${JSON.stringify(store)}\n`, "utf8");
    expect(() => create().read()).toThrow(/authentication|current state/u);
  });

  it("requires external synchronous signing and verification authorities", () => {
    expect(() =>
      createEvolutionFileWitness({ filePath, id: witnessId, trust: TRUST }),
    ).toThrow(/port is required/u);
    expect(() =>
      create({
        signer: { sign: () => Promise.resolve({ ...TRUST, value: "async" }) },
      }).read(),
    ).toThrow(/invalid trust binding/u);
    expect(() =>
      create({ verifier: { verify: () => Promise.resolve(true) } }).read(),
    ).toThrow(/authentication failed/u);
  });
});

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function canonicalCore(record, digestField) {
  const core = structuredClone(record);
  delete core.signature;
  delete core[digestField];
  return canonical(core);
}
