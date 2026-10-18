// TEST ONLY: actual signed journal files with independent local HMAC witness.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  EvolutionLedger,
  EVOLUTION_ARTIFACT_REF_SCHEMA,
  EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
} from "../../src/lib/evolution/evolution-ledger.js";
import { createEvolutionFileWitness } from "../../src/lib/evolution/evolution-file-witness.js";
import { evolutionDurableStoreConfiguration } from "./evolution-durable-store.js";

export const journalDigest = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

export function createJournalBoundaryIo(base) {
  const io = { live: new Map(), armed: false };
  const fsImpl = {
    ...base,
    lstatSync(target, options) {
      const stat = base.lstatSync(target, options);
      return io.armed && io.stat
        ? io.stat(stat, "path", target, options)
        : stat;
    },
    fstatSync(fd, options) {
      const stat = base.fstatSync(fd, options),
        target = io.live.get(fd);
      if (io.armed && target === io.target) io.fstats++;
      return io.armed && io.stat ? io.stat(stat, "fd", target, options) : stat;
    },
    openSync(target, flags, ...args) {
      if (io.armed) io.beforeAnyOpen?.(target, flags);
      const selected =
        io.armed &&
        target === io.target &&
        typeof flags === "number" &&
        !(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR));
      if (selected) io.beforeOpen?.(target, flags);
      const fd = base.openSync(target, flags, ...args);
      io.live.set(fd, target);
      if (io.armed) io.allOpens.push({ target, flags });
      if (selected) io.opens.push({ fd, flags });
      return fd;
    },
    closeSync(fd) {
      io.live.delete(fd);
      return base.closeSync(fd);
    },
    readSync(fd, buffer, offset, length, position) {
      const selected = io.armed && io.live.get(fd) === io.target,
        requested = length;
      if (selected && io.partial) length = Math.min(length, 31);
      const count = base.readSync(fd, buffer, offset, length, position);
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
        throw new Error("unbounded journal content read forbidden");
      }
      return base.readFileSync(target, ...args);
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
        beforeAnyOpen: null,
        afterRead: null,
        partial: false,
        opens: [],
        allOpens: [],
        reads: [],
        rawReads: 0,
        fstats: 0,
      });
    },
  };
}

export function openJournalBoundaryFixture(
  root,
  { Ledger = EvolutionLedger, seed = true } = {},
) {
  const config = evolutionDurableStoreConfiguration(root);
  const tracking = createJournalBoundaryIo(config.fsImpl);
  const witness = createEvolutionFileWitness({
    id: "journal-boundary-witness",
    filePath: path.join(root, "witness", "checkpoint.json"),
    trust: config.witnessAuthority.trust,
    signer: config.witnessAuthority.signer,
    verifier: config.witnessAuthority.verifier,
    fsImpl: tracking.fsImpl,
  });
  const payload = Buffer.from("journal-boundary-subject");
  const subjectRef = {
    schema: EVOLUTION_ARTIFACT_REF_SCHEMA,
    ref: "evidence://tests/journal-boundary",
    digest: journalDigest(payload),
  };
  const policy = { purposes: [], afterVerify: null };
  const options = {
    rootDir: path.join(root, "events"),
    authorityRootDir: path.join(root, "authority"),
    secure: false,
    fsImpl: tracking.fsImpl,
    clock: config.clock,
    trust: config.ledgerAuthority.trust,
    sign: config.ledgerAuthority.signer.sign,
    verifySignature(input) {
      policy.purposes.push(input.purpose);
      const result = config.ledgerAuthority.verifier.verify(input);
      policy.afterVerify?.(input);
      return result;
    },
    verifyWitnessSignature: config.witnessAuthority.verifier.verify,
    witness,
    witnessTrust: config.witnessAuthority.trust,
    artifactResolver: ({ ref }) => ({
      authenticated: true,
      bytes: Buffer.from(payload),
      digest: ref.digest,
      found: true,
      receiptDigest: journalDigest("test-journal-resolution"),
      ref: ref.ref,
      schema: EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
    }),
  };
  const open = (Type = EvolutionLedger) => new Type(options);
  const ledger = new Ledger(options);
  const append = (eventId, targetLedger = ledger) =>
    targetLedger.appendDomainEvent({
      artifactTenantId: "journal-artifacts",
      correlationId: null,
      decision: "committed",
      eventId,
      reason: "test journal boundary",
      skillName: null,
      sourceRefs: [],
      subjectRef,
      tenantId: "journal-tenant",
      type: "skill.mutation.nonce-claimed",
    });
  if (seed) append("journal-boundary-event");
  const files = {
    identity: ledger.identityPath,
    marker: ledger.storeMarkerPath,
    head: ledger.headPath,
    anchor: path.join(
      ledger.anchorDir,
      fs.readdirSync(ledger.anchorDir).sort().at(-1),
    ),
    ...(fs.readdirSync(ledger.segmentDir).length
      ? {
          segment: path.join(
            ledger.segmentDir,
            fs.readdirSync(ledger.segmentDir).sort().at(-1),
          ),
        }
      : {}),
  };
  return {
    root,
    ledger,
    open,
    append,
    options,
    witness,
    policy,
    files,
    ...tracking,
  };
}
