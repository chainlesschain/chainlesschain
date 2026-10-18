// TEST ONLY: local signed witness bytes, never independent installation trust.
import fs from "node:fs";
import path from "node:path";
import { createHash, createHmac } from "node:crypto";
import { createEvolutionFileWitness } from "../../src/lib/evolution/evolution-file-witness.js";

export const witnessBoundaryDigest = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
};
const trust = Object.freeze({
  algorithm: "hmac-sha256",
  keyId: "key://tests/witness-physical-boundary",
  trustPolicyDigest: witnessBoundaryDigest("test-only-witness-boundary-policy"),
});
const sign = (message) => ({
  ...trust,
  value: createHmac("sha256", "test-only-witness-boundary-key")
    .update(message)
    .digest("base64url"),
});
export function createWitnessBoundaryIo() {
  const io = {
    live: new Map(),
    armed: false,
    target: null,
    stat: null,
    beforeOpen: null,
    afterRead: null,
    partial: false,
    opens: [],
    reads: [],
    rawReads: 0,
    fstats: 0,
  };
  const fsImpl = {
    ...fs,
    realpathSync(target) {
      if (this !== fsImpl) throw new Error("original filesystem receiver lost");
      return fs.realpathSync.native(target);
    },
    lstatSync(target, options) {
      const stat = fs.lstatSync(target, options);
      return io.armed && io.stat
        ? io.stat(stat, "path", target, options)
        : stat;
    },
    fstatSync(fd, options) {
      const stat = fs.fstatSync(fd, options),
        target = io.live.get(fd);
      if (io.armed && target === io.target) io.fstats++;
      return io.armed && io.stat ? io.stat(stat, "fd", target, options) : stat;
    },
    openSync(target, flags, ...args) {
      const selected =
        io.armed &&
        target === io.target &&
        typeof flags === "number" &&
        !(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR));
      if (selected) io.beforeOpen?.(target, flags);
      const fd = fs.openSync(target, flags, ...args);
      io.live.set(fd, target);
      if (selected) io.opens.push({ fd, flags });
      return fd;
    },
    closeSync(fd) {
      io.live.delete(fd);
      return fs.closeSync(fd);
    },
    readSync(fd, buffer, offset, length, position) {
      const selected = io.armed && io.live.get(fd) === io.target,
        requested = length;
      if (selected && io.partial) length = Math.min(length, 37);
      const count = fs.readSync(fd, buffer, offset, length, position);
      if (selected) {
        io.reads.push({ requested, count, position });
        io.afterRead?.(fd, count, position);
      }
      return count;
    },
    readFileSync(target, ...args) {
      if (
        io.armed &&
        (target === io.target || io.live.get(target) === io.target)
      ) {
        io.rawReads++;
        throw new Error("whole-file witness read forbidden");
      }
      return fs.readFileSync(target, ...args);
    },
  };
  return {
    io,
    fsImpl,
    arm(target) {
      Object.assign(io, {
        armed: true,
        target,
        stat: null,
        beforeOpen: null,
        afterRead: null,
        partial: false,
        opens: [],
        reads: [],
        rawReads: 0,
        fstats: 0,
      });
    },
  };
}

export function openWitnessBoundaryFixture(
  root,
  { segmented = true, reopenOnly = false, fsImpl = fs, ...overrides } = {},
) {
  const file = path.join(root, "witness", "checkpoint.json"),
    id = "test-witness-physical-boundary";
  const policy = { epoch: "physical-boundary-1", revoked: false };
  const signer = { sign: ({ message }) => sign(message) };
  const verifier = {
    getTrustEpoch: () => policy.epoch,
    verify: ({ message, signature, trust: supplied }) => {
      const verified =
        !policy.revoked &&
        supplied.keyId === trust.keyId &&
        supplied.trustPolicyDigest === trust.trustPolicyDigest &&
        signature.algorithm === trust.algorithm &&
        signature.keyId === trust.keyId &&
        signature.trustPolicyDigest === trust.trustPolicyDigest &&
        signature.value === sign(message).value;
      policy.afterVerify?.();
      return verified;
    },
  };
  const create = (options = {}) =>
    createEvolutionFileWitness({
      id,
      filePath: file,
      trust,
      signer,
      verifier,
      fsImpl,
      maximumBytes: 1024 * 1024,
      maximumHistoryBytes: 2 * 1024 * 1024,
      ...overrides,
      ...options,
    });
  const snapshot = (sequence) => ({
    ...trust,
    anchorDigest: witnessBoundaryDigest(`anchor-${sequence}`),
    epoch: "witness-physical-boundary",
    headDigest:
      sequence === 0 ? null : witnessBoundaryDigest(`head-${sequence}`),
    identityDigest: witnessBoundaryDigest("identity"),
    ledgerId: "ledger-witness-physical-boundary",
    payloadDigest: witnessBoundaryDigest(`payload-${sequence}`),
    segmentDigest:
      sequence === 0 ? null : witnessBoundaryDigest(`segment-${sequence}`),
    sequence,
    storeMarkerDigest: witnessBoundaryDigest("marker"),
    storeMarkerEntryDigest: witnessBoundaryDigest("marker-entry"),
    storeMarkerId: "marker-witness-physical-boundary",
    witnessId: id,
  });
  const witness = create();
  const genesis = reopenOnly
    ? null
    : witness.initialize({
        expected: witness.read(),
        snapshot: snapshot(0),
      });
  let current = genesis,
    history = null;
  if (reopenOnly) current = witness.read();
  else if (segmented) {
    // Prepare independently signed complete legacy bytes, then use the actual
    // CAS implementation for conversion, bounded segment publication and reads.
    const store = JSON.parse(fs.readFileSync(file, "utf8")),
      template = store.current;
    history = [store.history[0]];
    for (let generation = 1; generation <= 256; generation++) {
      const core = {
        ...template,
        ...snapshot(generation - 1),
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
        witnessDigest: witnessBoundaryDigest(message),
        signature: sign(message),
      });
    }
    store.history = history;
    store.current = history.at(-1);
    fs.writeFileSync(file, canonical(store) + "\n");
    current = witness.compareAndSwap({
      expected: store.current,
      next: snapshot(256),
    });
  }
  const encoded = JSON.parse(fs.readFileSync(file, "utf8"));
  const segmentDirectory = `${file}.segments-v2`;
  const segmentFiles = (encoded.segments ?? []).map((digest) =>
    path.join(segmentDirectory, `${digest.slice(7)}.json`),
  );
  return {
    root,
    file,
    segmentDirectory,
    segmentFiles,
    current,
    genesis,
    history,
    snapshot,
    policy,
    witness,
    create,
  };
}
