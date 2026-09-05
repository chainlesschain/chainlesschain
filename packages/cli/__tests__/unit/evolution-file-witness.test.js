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
    vi.restoreAllMocks();
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

  function populatedWitness() {
    const witness = create();
    const genesis = witness.initialize({
      expected: witness.read(),
      snapshot: snapshot(witnessId, 0),
    });
    const head = witness.compareAndSwap({
      expected: genesis,
      next: snapshot(witnessId, 1),
    });
    witness.read();
    return { witness, head, genesis };
  }

  it("reuses canonical encodings but reverifies every historical and current signature", () => {
    const { witness, head } = populatedWitness();
    const hashCalls = vi.spyOn(crypto, "createHash");
    ports.verifier.verify.mockClear();
    expect(witness.read()).toEqual(head);
    expect(witness.read()).toEqual(head);
    expect(hashCalls).not.toHaveBeenCalled();
    // Absent genesis, committed genesis, head, and current pointer on EACH read.
    expect(ports.verifier.verify).toHaveBeenCalledTimes(8);
    const storeBytes = fs.readFileSync(filePath, "utf8");
    expect(storeBytes).toBe(`${canonical(JSON.parse(storeBytes))}\n`);
  });

  it("rejects a revoked historical signature even when the current signature remains valid", () => {
    const { witness, head, genesis } = populatedWitness();
    const originalVerify = ports.verifier.verify.getMockImplementation();
    ports.verifier.verify.mockImplementation(
      (input) =>
        input.signature.value !== genesis.signature.value &&
        originalVerify(input),
    );
    // The independently signed latest record is still authorized.
    expect(
      originalVerify({
        message: Buffer.from(
          `chainlesschain.evolution-ledger-witness/v1\0${canonicalCore(head, "witnessDigest")}`,
        ),
        signature: head.signature,
        trust: TRUST,
      }),
    ).toBe(true);
    expect(() => witness.read()).toThrow(/authentication failed/u);
    expect(() =>
      witness.compareAndSwap({
        expected: head,
        next: snapshot(witnessId, 2),
      }),
    ).toThrow(/authentication failed/u);
    ports.verifier.verify.mockImplementation(originalVerify);
    expect(witness.read()).toEqual(head);
  });

  it("isolates cached data from returned records and verifier input mutation", () => {
    const { witness, head } = populatedWitness();
    const returned = witness.read();
    returned.signature.value = "caller mutation";
    returned.sequence = 99;
    const originalVerify = ports.verifier.verify.getMockImplementation();
    ports.verifier.verify.mockImplementation((input) => {
      const result = originalVerify(input);
      input.message.fill(0);
      input.signature.value = "verifier mutation";
      return result;
    });
    expect(witness.read()).toEqual(head);
    expect(witness.read()).toEqual(head);
    // Cover cold cache population too, not only cache hits.
    const reopened = create();
    expect(reopened.read()).toEqual(head);
    expect(reopened.read()).toEqual(head);
  });

  it.each([
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
    "status",
    "storeMarkerDigest",
    "storeMarkerEntryDigest",
    "storeMarkerId",
    "trustPolicyDigest",
    "witnessDigest",
    "witnessId",
    "signature.algorithm",
    "signature.keyId",
    "signature.trustPolicyDigest",
    "signature.value",
    "extra-field",
    "missing-field",
    "extra-signature-field",
    "missing-signature-field",
    "object-field",
    "array-signature",
    "null-signature",
  ])("rejects warm-cache history tampering: %s", (field) => {
    const { witness, head } = populatedWitness();
    const original = fs.readFileSync(filePath, "utf8");
    const store = JSON.parse(original);
    const record = store.history[1];
    if (field === "extra-field") record.extra = true;
    else if (field === "missing-field") delete record.epoch;
    else if (field === "extra-signature-field") record.signature.extra = true;
    else if (field === "missing-signature-field") delete record.signature.value;
    else if (field === "object-field") record.epoch = { epoch: record.epoch };
    else if (field === "array-signature") record.signature = [record.signature];
    else if (field === "null-signature") record.signature = null;
    else if (field.startsWith("signature."))
      record.signature[field.slice(10)] += "tampered";
    else if (typeof record[field] === "number") record[field] += 1;
    else if (typeof record[field] === "boolean") record[field] = !record[field];
    else record[field] = `${record[field]}tampered`;
    fs.writeFileSync(filePath, `${JSON.stringify(store)}\n`, "utf8");
    expect(() => witness.read()).toThrow();
    fs.writeFileSync(filePath, original, "utf8");
    expect(witness.read()).toEqual(head);
  });

  it("checks same-size tampering with restored mtime on a warm cache", () => {
    const { witness } = populatedWitness();
    const stat = fs.statSync(filePath);
    const store = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const oldDigest = store.history[1].anchorDigest;
    store.history[1].anchorDigest = `${oldDigest.slice(0, -1)}${oldDigest.endsWith("0") ? "1" : "0"}`;
    fs.writeFileSync(filePath, `${canonical(store)}\n`, "utf8");
    fs.utimesSync(filePath, stat.atime, stat.mtime);
    expect(fs.statSync(filePath).size).toBe(stat.size);
    expect(() => witness.read()).toThrow(/authentication failed/u);
  });

  it("does not reuse a cached current record based only on its digest or key count", () => {
    const { witness } = populatedWitness();
    const original = fs.readFileSync(filePath, "utf8");
    for (const target of ["current", "history"]) {
      for (const signature of [false, true]) {
        const store = JSON.parse(original);
        const record = target === "current" ? store.current : store.history[1];
        const fields = signature ? record.signature : record;
        const field = signature ? "value" : "sequence";
        fields.substituted = fields[field];
        delete fields[field];
        fs.writeFileSync(filePath, `${canonical(store)}\n`, "utf8");
        expect(() => witness.read()).toThrow(/fields are invalid/u);
      }
    }
  });

  it.each([
    { label: "entry count", records: 1100, paddedSignature: false },
    { label: "retained text", records: 300, paddedSignature: true },
  ])(
    "bounds the encoding cache by $label and validates uncached records",
    ({ records, paddedSignature }) => {
      const { head } = populatedWitness();
      const store = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const signatureValue = (message) =>
        paddedSignature ? hmac(message).padEnd(16_384, ".") : hmac(message);
      const signRecord = (record) => {
        const message = Buffer.from(
          `chainlesschain.evolution-ledger-witness/v1\0${canonicalCore(record, "witnessDigest")}`,
        );
        record.witnessDigest = digest(message);
        record.signature = { ...TRUST, value: signatureValue(message) };
        return record;
      };
      const history = [signRecord(store.history[0])];
      // Generate signed input once, without an O(N²) append loop in a unit test.
      for (let generation = 1; generation <= records; generation += 1) {
        history.push(
          signRecord({
            ...head,
            generation,
            previousWitnessDigest: history.at(-1).witnessDigest,
          }),
        );
      }
      store.history = history;
      store.current = history.at(-1);
      fs.writeFileSync(filePath, `${canonical(store)}\n`, "utf8");
      const verifier = {
        verify: vi.fn(
          ({ message, signature }) =>
            signature.value === signatureValue(message),
        ),
      };
      const witness = create({ verifier });
      expect(witness.read()).toEqual(store.current);
      const hashCalls = vi.spyOn(crypto, "createHash");
      verifier.verify.mockClear();
      expect(witness.read()).toEqual(store.current);
      expect(verifier.verify).toHaveBeenCalledTimes(records + 2);
      if (paddedSignature) {
        expect(hashCalls.mock.calls.length).toBeGreaterThan(0);
        expect(hashCalls.mock.calls.length).toBeLessThan(records);
      } else {
        // Only the first 1,024 records fit; current is separately reverified.
        expect(hashCalls).toHaveBeenCalledTimes(records + 2 - 1024);
      }
      store.history.at(-1).anchorDigest = digest("uncached tamper");
      fs.writeFileSync(filePath, `${canonical(store)}\n`, "utf8");
      expect(() => witness.read()).toThrow(/authentication failed/u);
    },
  );

  it.each(["grow", "truncate", "replace"])(
    "rejects a witness that changes during descriptor IO: %s",
    (change) => {
      const first = create();
      first.initialize({
        expected: first.read(),
        snapshot: snapshot(witnessId, 0),
      });
      const checkedSize = fs.statSync(filePath).size;
      let altered = false;
      let bytesRead = 0;
      const descriptors = new Set();
      const witness = create({
        fsImpl: {
          ...fs,
          openSync(file, flags, mode) {
            const fd = fs.openSync(file, flags, mode);
            descriptors.add(fd);
            return fd;
          },
          closeSync(fd) {
            descriptors.delete(fd);
            return fs.closeSync(fd);
          },
          readFileSync() {
            throw new Error("unbounded witness read is forbidden");
          },
          readSync(fd, buffer, offset, length, position) {
            if (!altered) {
              altered = true;
              if (change === "grow")
                fs.appendFileSync(filePath, Buffer.alloc(256 * 1024, 32));
              else if (change === "truncate") fs.truncateSync(filePath, 1);
              else {
                fs.renameSync(filePath, `${filePath}.old`);
                fs.copyFileSync(`${filePath}.old`, filePath);
              }
            }
            const count = fs.readSync(fd, buffer, offset, length, position);
            bytesRead += count;
            expect(length).toBeLessThanOrEqual(64 * 1024);
            return count;
          },
        },
      });
      expect(() => witness.read()).toThrow(
        /bounded read|changed while reading/u,
      );
      expect(altered).toBe(true);
      expect(bytesRead).toBeLessThanOrEqual(checkedSize + 1);
      expect(descriptors.size).toBe(0);
    },
  );

  it("accepts short reads and checks the size bound before reading a witness", () => {
    const witness = create();
    const committed = witness.initialize({
      expected: witness.read(),
      snapshot: snapshot(witnessId, 0),
    });
    const read = vi.fn((fd, buffer, offset, length, position) =>
      fs.readSync(fd, buffer, offset, Math.min(length, 19), position),
    );
    const reopened = create({
      fsImpl: {
        ...fs,
        readSync: read,
        readFileSync() {
          throw new Error("unbounded witness read is forbidden");
        },
      },
    });
    expect(reopened.read()).toEqual(committed);
    read.mockClear();
    fs.appendFileSync(filePath, Buffer.alloc(8192, 32));
    expect(() =>
      create({ maximumBytes: 4096, fsImpl: { ...fs, readSync: read } }).read(),
    ).toThrow(/size is invalid/u);
    expect(read).not.toHaveBeenCalled();
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
