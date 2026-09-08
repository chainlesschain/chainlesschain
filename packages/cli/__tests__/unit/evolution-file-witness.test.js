import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EVOLUTION_FILE_WITNESS_STORE_SCHEMA,
  createEvolutionFileWitness,
} from "../../src/lib/evolution/evolution-file-witness.js";
import { EVOLUTION_SEGMENTED_WITNESS_SCHEMA } from "../../src/lib/evolution/evolution-witness-segments.js";

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
      path.join(
        fs.realpathSync.native(os.tmpdir()),
        "cc-evolution-file-witness-",
      ),
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

  // Independently signed legacy fixture. Only fixture setup uses direct bytes;
  // conversion, subsequent appends, ancestry and reopen use the real witness.
  function legacyHistory(lastGeneration, overrides = {}) {
    const witness = create(overrides);
    witness.initialize({
      expected: witness.read(),
      snapshot: snapshot(witnessId, 0),
    });
    const store = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const template = store.current;
    const history = [store.history[0]];
    for (let generation = 1; generation <= lastGeneration; generation++) {
      const core = {
        ...template,
        ...snapshot(witnessId, generation - 1),
        generation,
        previousWitnessDigest: history.at(-1).witnessDigest,
      };
      delete core.signature;
      delete core.witnessDigest;
      const message = Buffer.from(
        `chainlesschain.evolution-ledger-witness/v1\0${canonical(core)}`,
      );
      history.push({
        ...core,
        witnessDigest: digest(message),
        signature: ports.signer.sign({
          message,
          purpose: "evolution-ledger-witness",
          trust: TRUST,
        }),
      });
    }
    store.history = history;
    store.current = history.at(-1);
    fs.writeFileSync(filePath, `${canonical(store)}\n`);
    return { witness, head: store.current, history };
  }

  it("converts a complete legacy history to bounded immutable segments and preserves ancestry", () => {
    const { witness, head, history } = legacyHistory(1100, {
      verifier: { ...ports.verifier, getTrustEpoch: () => "segments-1" },
    });
    const next = witness.compareAndSwap({
      expected: head,
      next: snapshot(witnessId, 1100),
    });
    const encoded = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(encoded.schema).toBe(EVOLUTION_SEGMENTED_WITNESS_SCHEMA);
    expect(encoded.segments).toHaveLength(4);
    expect(encoded.history).toHaveLength(78);
    const segmentPath = path.join(
      `${filePath}.segments-v2`,
      `${encoded.segments[0].slice(7)}.json`,
    );
    const firstBytes = fs.readFileSync(segmentPath);
    const firstStat = fs.statSync(segmentPath);
    expect(witness.read()).toEqual(next);
    ports.verifier.verify.mockClear();
    expect(witness.read()).toEqual(next);
    expect(
      ports.verifier.verify.mock.calls.every(
        ([input]) =>
          JSON.parse(input.message.toString().split("\0")[1]).generation >=
          1024,
      ),
    ).toBe(true);
    const reopened = create();
    expect(reopened.read()).toEqual(next);
    expect(
      reopened.proveAncestry({ ancestor: history[1], descendant: next })
        .included,
    ).toBe(true);
    expect(
      reopened.proveAncestry({
        ancestor: history[513],
        descendant: history[1000],
      }).included,
    ).toBe(true);
    expect(() =>
      reopened.proveAncestry({
        ancestor: { ...history[513], generation: 1 },
        descendant: next,
      }),
    ).toThrow(/exactly bound/u);
    const following = reopened.compareAndSwap({
      expected: next,
      next: snapshot(witnessId, 1101),
    });
    expect(following.generation).toBe(1102);
    expect(fs.readFileSync(segmentPath)).toEqual(firstBytes);
    expect(fs.statSync(segmentPath).mtimeMs).toBe(firstStat.mtimeMs);
    expect(fs.statSync(filePath).size).toBeLessThan(200_000);
  });

  it("charges the whole committed history to the byte budget after segmentation", () => {
    const { witness, head } = legacyHistory(300);
    const next = witness.compareAndSwap({
      expected: head,
      next: snapshot(witnessId, 300),
    });
    const headBytes = fs.readFileSync(filePath);
    const manifest = JSON.parse(headBytes);
    const partSizes = manifest.segments.map(
      (entry) =>
        fs.statSync(
          path.join(`${filePath}.segments-v2`, `${entry.slice(7)}.json`),
        ).size,
    );
    const maximumBytes = Math.max(headBytes.length, ...partSizes);
    const totalBytes =
      headBytes.length + partSizes.reduce((sum, size) => sum + size, 0);
    expect(() => create({ maximumBytes }).read()).toThrow(/size/u);
    expect(() =>
      create({ maximumBytes, maximumHistoryBytes: totalBytes - 1 }).read(),
    ).toThrow(/size/u);
    const bounded = create({ maximumBytes, maximumHistoryBytes: totalBytes });
    expect(bounded.read()).toEqual(next);
    expect(() =>
      bounded.compareAndSwap({
        expected: next,
        next: snapshot(witnessId, 301),
      }),
    ).toThrow(/maximum size/u);
    expect(fs.readFileSync(filePath)).toEqual(headBytes);
    const expanded = create({
      maximumBytes,
      maximumHistoryBytes: totalBytes + 10_000,
    });
    const advanced = expanded.compareAndSwap({
      expected: next,
      next: snapshot(witnessId, 301),
    });
    expect(expanded.read()).toEqual(advanced);
  });

  it("keeps the aggregate byte budget on legacy reads and writes", () => {
    const witness = create({ maximumHistoryBytes: 4096 });
    const absent = witness.read();
    expect(() =>
      witness.initialize({
        expected: absent,
        snapshot: snapshot(witnessId, 0),
      }),
    ).toThrow(/maximum size/u);
    expect(fs.existsSync(filePath)).toBe(false);
    legacyHistory(10);
    expect(() => witness.read()).toThrow(/size/u);
  });

  it.each([0, 4095, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid aggregate history byte budget: %s",
    (maximumHistoryBytes) => {
      expect(() => create({ maximumHistoryBytes })).toThrow(
        /maximumHistoryBytes/u,
      );
    },
  );

  it("rejects old segment tampering even with a warm trust-epoch cache and applies revocation", () => {
    let epoch = "segments-1";
    const { witness, head, history } = legacyHistory(300, {
      verifier: { ...ports.verifier, getTrustEpoch: () => epoch },
    });
    const next = witness.compareAndSwap({
      expected: head,
      next: snapshot(witnessId, 300),
    });
    witness.read();
    const encoded = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const part = path.join(
      `${filePath}.segments-v2`,
      `${encoded.segments[0].slice(7)}.json`,
    );
    const originalBytes = fs.readFileSync(part);
    fs.appendFileSync(part, "\n");
    expect(() => witness.read()).toThrow(/segment bytes changed/u);
    fs.writeFileSync(part, originalBytes);
    const verify = ports.verifier.verify.getMockImplementation();
    ports.verifier.verify.mockImplementation(
      (input) =>
        input.signature.value !== history[20].signature.value && verify(input),
    );
    epoch = "segments-2";
    expect(() => witness.read()).toThrow(/authentication failed/u);
    expect(() =>
      witness.compareAndSwap({
        expected: next,
        next: snapshot(witnessId, 301),
      }),
    ).toThrow(/authentication failed/u);
  });

  it("rejects missing, repeated, reordered and truncated segment projections", () => {
    const { witness, head } = legacyHistory(800);
    witness.compareAndSwap({ expected: head, next: snapshot(witnessId, 800) });
    const original = JSON.parse(fs.readFileSync(filePath, "utf8"));
    for (const mutate of [
      (value) => value.segments.pop(),
      (value) => value.segments.reverse(),
      (value) => {
        value.segments[1] = value.segments[0];
      },
      (value) => value.history.pop(),
      (value) => {
        value.segments = Array(1024).fill(value.segments[0]);
      },
      (value) => {
        value.segments[0] = "../outside.json";
      },
    ]) {
      const changed = structuredClone(original);
      mutate(changed);
      fs.writeFileSync(filePath, `${canonical(changed)}\n`);
      expect(() => create().read()).toThrow();
    }
    fs.writeFileSync(filePath, `${canonical(original)}\n`);
    const missing = path.join(
      `${filePath}.segments-v2`,
      `${original.segments[0].slice(7)}.json`,
    );
    fs.unlinkSync(missing);
    expect(() => witness.read()).toThrow();
  });

  it.each([
    "before-segment-rename",
    "after-segment-rename",
    "before-head-rename",
    "after-head-rename",
  ])(
    "recovers segmented conversion without duplicate effects after %s",
    (phase) => {
      const { head } = legacyHistory(255);
      let fired = false;
      const witness = create({
        fsImpl: {
          ...fs,
          renameSync(from, to) {
            const isSegment =
              path.dirname(String(to)) === `${filePath}.segments-v2`;
            const matches = isSegment
              ? phase.endsWith("segment-rename")
              : String(to) === filePath && phase.endsWith("head-rename");
            if (!fired && matches && phase.startsWith("before-")) {
              fired = true;
              throw new Error("injected segment publication failure");
            }
            fs.renameSync(from, to);
            if (!fired && matches && phase.startsWith("after-")) {
              fired = true;
              throw new Error("injected segment publication failure");
            }
          },
        },
      });
      expect(() =>
        witness.compareAndSwap({
          expected: head,
          next: snapshot(witnessId, 255),
        }),
      ).toThrow(/injected segment publication failure/u);
      expect(fired).toBe(true);
      const reopened = create();
      expect(reopened.read().generation).toBe(
        phase === "after-head-rename" ? 256 : 255,
      );
      const retried = reopened.compareAndSwap({
        expected: head,
        next: snapshot(witnessId, 255),
      });
      expect(retried.generation).toBe(256);
      expect(create().read()).toEqual(retried);
      expect(
        fs
          .readdirSync(`${filePath}.segments-v2`)
          .filter((name) => name.endsWith(".json")),
      ).toHaveLength(1);
    },
  );

  it("preserves discard fences on both sides of segment boundaries", () => {
    const { witness, head } = legacyHistory(254, {
      verifier: {
        ...ports.verifier,
        getTrustEpoch: () => "discard-segments-1",
      },
    });
    const discardedGenerations = new Set([255, 256, 511, 512]);
    const discarded = [];
    let current = head;
    for (let generation = 255; generation <= 770; generation++) {
      let discard = null;
      if (discardedGenerations.has(generation)) {
        const rejected = snapshot(witnessId, 10_000 + generation);
        discard = {
          anchorDigest: rejected.anchorDigest,
          headDigest: rejected.headDigest,
          segmentDigest: rejected.segmentDigest,
          sequence: rejected.sequence,
        };
        discarded.push(rejected);
      }
      current = witness.compareAndSwap({
        expected: current,
        next: snapshot(witnessId, generation - 1),
        discard,
      });
    }
    for (const instance of [witness, create()]) {
      expect(instance.read()).toEqual(current);
      for (const next of discarded) {
        expect(instance.compareAndSwap({ expected: current, next })).toEqual(
          current,
        );
      }
    }
  });

  it("captures authority methods once and rejects accessors without invoking them", () => {
    const witness = create();
    const verify = ports.verifier.verify;
    ports.verifier.verify = () => {
      throw new Error("replacement verifier");
    };
    const head = witness.initialize({
      expected: witness.read(),
      snapshot: snapshot(witnessId, 0),
    });
    expect(witness.read()).toEqual(head);
    expect(verify).toHaveBeenCalled();
    const getter = vi.fn(() => verify);
    const verifier = Object.defineProperty({}, "verify", { get: getter });
    expect(() => create({ verifier })).toThrow(/own data function/u);
    expect(getter).not.toHaveBeenCalled();
    expect(() => create({ verifier: new Proxy({ verify }, {}) })).toThrow(
      /Proxy/u,
    );
  });

  it("owns the next snapshot before authority calls can change the caller's input", () => {
    const { witness, head } = legacyHistory(300);
    const next = snapshot(witnessId, 300);
    const originalVerify = ports.verifier.verify.getMockImplementation();
    ports.verifier.verify.mockImplementation((input) => {
      Object.assign(next, snapshot(witnessId, 99));
      return originalVerify(input);
    });
    const committed = witness.compareAndSwap({ expected: head, next });
    expect(next.sequence).toBe(99);
    expect(committed.sequence).toBe(300);
    expect(committed.headDigest).toBe(snapshot(witnessId, 300).headDigest);
  });

  it("does not advance HEAD when a segment write silently loses bytes", () => {
    const { head } = legacyHistory(255);
    const witness = create({
      fsImpl: {
        ...fs,
        writeFileSync(file, bytes, ...options) {
          if (
            typeof file === "number" &&
            Buffer.isBuffer(bytes) &&
            bytes.includes(Buffer.from("evolution-file-witness-segment/v1"))
          ) {
            return fs.writeFileSync(
              file,
              bytes.subarray(0, bytes.length - 1),
              ...options,
            );
          }
          return fs.writeFileSync(file, bytes, ...options);
        },
      },
    });
    expect(() =>
      witness.compareAndSwap({
        expected: head,
        next: snapshot(witnessId, 255),
      }),
    ).toThrow(/durable readback/u);
    expect(create().read()).toEqual(head);
    expect(JSON.parse(fs.readFileSync(filePath, "utf8")).schema).toBe(
      EVOLUTION_FILE_WITNESS_STORE_SCHEMA,
    );
  });

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

  it("reuses verified records only inside one authenticated trust epoch", () => {
    let epoch = "trust-epoch-1";
    const verifier = {
      ...ports.verifier,
      getTrustEpoch: vi.fn(() => epoch),
    };
    const witness = create({ verifier });
    const genesis = witness.initialize({
      expected: witness.read(),
      snapshot: snapshot(witnessId, 0),
    });
    const head = witness.compareAndSwap({
      expected: genesis,
      next: snapshot(witnessId, 1),
    });

    ports.verifier.verify.mockClear();
    expect(witness.read()).toEqual(head);
    expect(witness.read()).toEqual(head);
    expect(ports.verifier.verify).not.toHaveBeenCalled();

    epoch = "trust-epoch-2";
    expect(witness.read()).toEqual(head);
    // Genesis plus two committed history records are all rechecked.
    expect(ports.verifier.verify).toHaveBeenCalledTimes(3);

    const originalVerify = ports.verifier.verify.getMockImplementation();
    ports.verifier.verify.mockImplementation(
      (input) =>
        input.signature.value !== genesis.signature.value &&
        originalVerify(input),
    );
    epoch = "trust-epoch-3";
    expect(() => witness.read()).toThrow(/authentication failed/u);
  });

  it("fails closed when the optional trust epoch is malformed or unstable", () => {
    const malformed = create({
      verifier: { ...ports.verifier, getTrustEpoch: () => "" },
    });
    expect(() =>
      malformed.initialize({
        expected: malformed.read(),
        snapshot: snapshot(witnessId, 0),
      }),
    ).toThrow(/trust epoch is invalid/u);

    const seeded = create({
      verifier: { ...ports.verifier, getTrustEpoch: () => "stable-epoch" },
    });
    seeded.initialize({
      expected: seeded.read(),
      snapshot: snapshot(witnessId, 0),
    });

    let calls = 0;
    const unstable = create({
      verifier: {
        ...ports.verifier,
        getTrustEpoch: () => `epoch-${++calls}`,
      },
    });
    expect(() => unstable.read()).toThrow(/trust epoch changed/u);
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
