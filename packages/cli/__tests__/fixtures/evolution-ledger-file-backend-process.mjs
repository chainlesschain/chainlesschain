import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createEvolutionLedgerFileBackend } from "../../src/lib/evolution/evolution-ledger-file-backend.js";
import {
  EVOLUTION_ARTIFACT_REF_SCHEMA,
  EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
} from "../../src/lib/evolution/evolution-ledger.js";

const verificationCounts = {};
const SEED_BATCH_SIZE = 256;
const RESOURCE_SAMPLE_MAXIMUM = 16;

function resourceSampleInterval(count) {
  const maximumAppendSamples = RESOURCE_SAMPLE_MAXIMUM - 1;
  return Math.max(
    1024,
    Math.ceil(count / maximumAppendSamples / SEED_BATCH_SIZE) *
      SEED_BATCH_SIZE,
  );
}

function measureStorage(root) {
  let bytes = 0;
  let files = 0;
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile()) {
        bytes += fs.statSync(target).size;
        files += 1;
      }
    }
  }
  return { bytes, files };
}

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function authority(label, secret) {
  if (!secret) throw new Error(`${label} test secret is unavailable`);
  const trust = Object.freeze({
    algorithm: "hmac-sha256",
    keyId: `key://process-test/${label}`,
    trustPolicyDigest: digest(`${label}-process-policy`),
  });
  const value = (message) =>
    crypto.createHmac("sha256", secret).update(message).digest("base64url");
  return {
    trust,
    signer: {
      sign: ({ message }) => ({ ...trust, value: value(message) }),
    },
    verifier: {
      getTrustEpoch: () => `${trust.keyId}:${trust.trustPolicyDigest}`,
      verify: ({ message, signature, purpose }) => {
        verificationCounts[`${label}:${purpose}`] =
          (verificationCounts[`${label}:${purpose}`] ?? 0) + 1;
        return (
          signature.algorithm === trust.algorithm &&
          signature.keyId === trust.keyId &&
          signature.trustPolicyDigest === trust.trustPolicyDigest &&
          signature.value === value(message)
        );
      },
    },
  };
}

function durableFilesystem() {
  const directories = new Set();
  let nextDescriptor = -40_000;
  return {
    ...fs,
    constants: fs.constants,
    realpathSync: fs.realpathSync,
    closeSync(descriptor) {
      if (directories.delete(descriptor)) return;
      return fs.closeSync(descriptor);
    },
    fsyncSync(descriptor) {
      if (directories.has(descriptor)) return;
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
          const descriptor = nextDescriptor;
          nextDescriptor -= 1;
          directories.add(descriptor);
          return descriptor;
        }
        throw error;
      }
    },
  };
}

try {
  const startedAt = performance.now();
  const root = path.resolve(process.argv[2]);
  const mode = process.argv[3] ?? "verify";
  const count = Number(process.argv[4] ?? 0);
  const crashPhases = [
    "after-segment-link",
    "after-segment",
    "after-anchor-link",
    "after-anchor",
    "after-witness",
    "after-head",
  ];
  const crashPhase = mode.startsWith("crash:") ? mode.slice(6) : null;
  if (
    (!["verify", "seed"].includes(mode) && !crashPhases.includes(crashPhase)) ||
    !Number.isSafeInteger(count) ||
    count < 0 ||
    count > 10_000
  )
    throw new Error("invalid process test mode/count");
  const subjectBytes = Buffer.from('{"testOnly":"long-ledger-subject"}\n');
  const subjectPath = path.join(root, "subject.json");
  const subjectRef = {
    schema: EVOLUTION_ARTIFACT_REF_SCHEMA,
    ref: "artifact://long-ledger/subject",
    digest: digest(subjectBytes),
  };
  if (mode === "seed")
    fs.writeFileSync(subjectPath, subjectBytes, { flag: "wx", mode: 0o600 });
  const backend = createEvolutionLedgerFileBackend({
    rootDir: path.join(root, "events"),
    authorityRootDir: path.join(root, "authority"),
    witnessFilePath: path.join(root, "witness", "checkpoint.json"),
    witnessId: "witness-process-restart",
    ledgerAuthority: authority(
      "ledger-restart",
      process.env.CC_TEST_LEDGER_SECRET,
    ),
    witnessAuthority: authority(
      "witness-restart",
      process.env.CC_TEST_WITNESS_SECRET,
    ),
    artifactResolver: ({ ref }) => {
      if (ref.ref !== subjectRef.ref || ref.digest !== subjectRef.digest)
        throw new Error("unknown process test artifact");
      const bytes = fs.readFileSync(subjectPath);
      return {
        schema: EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
        authenticated: true,
        bytes,
        digest: digest(bytes),
        found: true,
        receiptDigest: digest(`test-resolution:${subjectRef.digest}`),
        ref: ref.ref,
      };
    },
    fsImpl: durableFilesystem(),
    secure: false,
    clock: () => Date.parse("2026-09-02T00:00:00.000Z"),
    crashHook(phase) {
      if (phase !== crashPhase) return;
      fs.writeSync(
        1,
        `${JSON.stringify({ ok: false, forcedExit: true, phase, pid: process.pid })}\n`,
      );
      process.exit(86);
    },
  });
  const append = (index) =>
    backend.ledger.appendDomainEvent({
      artifactTenantId: "artifact-long-ledger-test",
      correlationId: null,
      decision: "rejected",
      eventId: `long-event-${index}`,
      reason: "CC_SKILL_MUTATION_REQUEST_INVALID",
      skillName: null,
      sourceRefs: [],
      subjectRef,
      tenantId: null,
      type: "skill.mutation.audit",
    });
  if (crashPhase !== null) {
    append(backend.ledger.verify().sequence + 1);
    throw new Error("the requested crash phase did not terminate the process");
  }
  const seedResourceSamples = [];
  let checkpointMs = null;
  if (mode === "seed") {
    if (backend.ledger.verify().sequence !== 0)
      throw new Error("seed requires an empty ledger");
    const sampleInterval = resourceSampleInterval(count);
    for (let start = 1; start <= count; start += SEED_BATCH_SIZE) {
      const end = Math.min(count, start + SEED_BATCH_SIZE - 1);
      backend.ledger.appendDomainEventBatch(
        Array.from({ length: end - start + 1 }, (_, offset) => ({
          artifactTenantId: "artifact-long-ledger-test",
          correlationId: null,
          decision: "rejected",
          eventId: `long-event-${start + offset}`,
          reason: "CC_SKILL_MUTATION_REQUEST_INVALID",
          skillName: null,
          sourceRefs: [],
          subjectRef,
          tenantId: null,
          type: "skill.mutation.audit",
        })),
      );
      if (end === count || end % sampleInterval === 0) {
        const sample = {
          disk: measureStorage(root),
          elapsedMs: performance.now() - startedAt,
          eventCount: end,
          maxRssKiB: process.resourceUsage().maxRSS,
          phase: "append",
        };
        seedResourceSamples.push(sample);
        process.stderr.write(`resource-sample ${JSON.stringify(sample)}\n`);
      }
      process.stderr.write(`seeded ${end}/${count}\n`);
    }
    const checkpointStartedAt = performance.now();
    backend.ledger.checkpointState();
    checkpointMs = performance.now() - checkpointStartedAt;
    const checkpointSample = {
      checkpointMs,
      disk: measureStorage(root),
      elapsedMs: performance.now() - startedAt,
      eventCount: count,
      maxRssKiB: process.resourceUsage().maxRSS,
      phase: "checkpoint",
    };
    seedResourceSamples.push(checkpointSample);
    process.stderr.write(
      `resource-sample ${JSON.stringify(checkpointSample)}\n`,
    );
  }
  const verification = backend.ledger.verify();
  const samples =
    count === 0
      ? []
      : backend.ledger
          .queryMany(
            [1, Math.ceil(count / 2), count].map((sequence) => ({ sequence })),
          )
          .map((entry) => entry?.event.eventId);
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      pid: process.pid,
      verification,
      witness: backend.witness.read(),
      samples,
      checkpointMs,
      seedBatchSize: mode === "seed" ? SEED_BATCH_SIZE : null,
      seedResourceSamples,
      verificationCounts,
      elapsedMs: performance.now() - startedAt,
      maxRssKiB: process.resourceUsage().maxRSS,
    })}\n`,
  );
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({
      ok: false,
      pid: process.pid,
      code: error?.code ?? null,
      message: error?.message ?? String(error),
    })}\n`,
  );
  process.exitCode = 2;
}
