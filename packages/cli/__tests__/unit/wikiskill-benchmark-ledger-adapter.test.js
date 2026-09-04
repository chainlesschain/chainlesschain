import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ArtifactStore } from "../../src/lib/artifact-store.js";
import {
  EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
  EvolutionArtifactPorts,
} from "../../src/lib/evolution/evolution-artifact-ports.js";
import { createEvolutionLedgerFileBackend } from "../../src/lib/evolution/evolution-ledger-file-backend.js";
import { EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA } from "../../src/lib/evolution/evolution-ledger.js";
import {
  buildWikiSkillBenchmarkReport,
  createWikiSkillBenchmarkPlan,
  signWikiSkillBenchmarkReport,
} from "../../src/lib/evolution/wikiskill-benchmark.js";
import {
  WIKISKILL_BENCHMARK_DATASET_RESOLUTION_SCHEMA,
  WIKISKILL_BENCHMARK_GRADER_RECEIPT_SCHEMA,
  WIKISKILL_BENCHMARK_REPORT_ATTESTATION_SCHEMA,
  WIKISKILL_BENCHMARK_RUNNER_RECEIPT_SCHEMA,
  computeWikiSkillBenchmarkExecutionDigest,
  createWikiSkillBenchmarkDatasetProvider,
  createWikiSkillBenchmarkExecutionManifest,
  createWikiSkillBenchmarkGrader,
  createWikiSkillBenchmarkReportAttestor,
  createWikiSkillBenchmarkRunner,
} from "../../src/lib/evolution/wikiskill-benchmark-execution-host.js";
import { createWikiSkillBenchmarkCliHost } from "../../src/lib/evolution/wikiskill-benchmark-cli-host.js";
import {
  WIKISKILL_BENCHMARK_LEDGER_EVENT,
  WikiSkillBenchmarkLedgerAdapter,
} from "../../src/lib/evolution/wikiskill-benchmark-ledger-adapter.js";

const roots = [];
const NOW = Date.parse("2026-09-05T00:00:00.000Z");
const SECRET = "wikiskill-benchmark-ledger-test-key";

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function hash(value) {
  return `sha256:${createHash("sha256")
    .update(typeof value === "string" ? value : canonical(value))
    .digest("hex")}`;
}

function environment() {
  return {
    containerDigest: hash("container"),
    vllmVersion: "0.10.1",
    hardware: "gpu-example",
  };
}

function executionManifest() {
  const authority = (name) => ({
    authorityId: `authority:benchmark-${name}`,
    revision: 1,
    handlerArtifactDigest: hash(`${name}-handler`),
  });
  return createWikiSkillBenchmarkExecutionManifest({
    datasetProvider: authority("datasets"),
    runner: {
      authorityId: "authority:benchmark-runner",
      revision: 1,
      handlerArtifactDigest: hash("runner"),
    },
    grader: authority("grader"),
    reportAttestor: authority("report"),
    targetEnvironmentDigest: computeWikiSkillBenchmarkExecutionDigest(
      "chainlesschain.wikiskill-benchmark-target-environment/v1",
      environment(),
    ),
  });
}

function plan(splitCount = 2) {
  return createWikiSkillBenchmarkPlan({
    gitCommit: "a".repeat(40),
    runnerDigest: hash("runner"),
    executionManifestDigest: executionManifest().manifestDigest,
    model: { checkpoint: "example/model@revision", digest: hash("model") },
    inference: { temperature: 0, topP: 1, maxTokens: 1024 },
    environment: environment(),
    datasets: Array.from({ length: 5 }, (_, index) => ({
      id: `dataset-${index}`,
      version: "1.0.0",
      digest: hash(`dataset-${index}`),
      splitIds: Array.from(
        { length: splitCount },
        (__, split) => `case-${String(split).padStart(4, "0")}`,
      ),
    })),
    toolDigest: hash("tools"),
    apiDigest: hash("api"),
    promptDigest: hash("prompt"),
    skillDigest: hash("skill"),
    wikiDigest: hash("wiki"),
    seedSchedule: [11, 22, 33],
    bootstrapSamples: 1_000,
  });
}

function arm(label, score) {
  return {
    score,
    traceDigest: hash(`${label}:trace`),
    graderReceiptDigest: hash(`${label}:grader`),
    failureClass: "none",
    tokens: 10,
    cost: 0.01,
    latencyMs: 100,
  };
}

function report(value) {
  return buildWikiSkillBenchmarkReport({
    plan: value,
    runs: value.seedSchedule.map((seed) => ({
      runId: `run-${seed}`,
      seed,
      cases: value.datasets.flatMap((dataset) =>
        dataset.splitIds.map((splitId) => ({
          datasetId: dataset.id,
          splitId,
          baseline: arm(`${seed}:${dataset.id}:${splitId}:baseline`, 0.5),
          skill: arm(`${seed}:${dataset.id}:${splitId}:skill`, 0.75),
        })),
      ),
    })),
  });
}

async function envelope(value) {
  return signWikiSkillBenchmarkReport({
    report: value,
    attestor: async (reportDigest) => ({
      authority: "benchmark-ci",
      signature: createHmac("sha256", SECRET)
        .update(reportDigest)
        .digest("hex"),
    }),
  });
}

function verifyAttestation({ digest, attestation }) {
  return (
    ["benchmark-ci", "authority:benchmark-report"].includes(
      attestation.authority ?? attestation.authorityId,
    ) &&
    attestation.signature ===
      createHmac("sha256", SECRET).update(digest).digest("hex")
  );
}

function executionReceipt(schema, authority, fields) {
  const core = {
    schema,
    authenticated: true,
    durable: true,
    ...authority,
    ...fields,
  };
  const receiptDigest = computeWikiSkillBenchmarkExecutionDigest(schema, core);
  return {
    ...core,
    receiptDigest,
    attestation: {
      signature: createHmac("sha256", SECRET)
        .update(receiptDigest)
        .digest("hex"),
    },
  };
}

function executionProviders(benchmarkPlan, manifest) {
  const receiptVerifier = ({ digest, attestation }) =>
    attestation.signature ===
    createHmac("sha256", SECRET).update(digest).digest("hex");
  return {
    datasetProvider: createWikiSkillBenchmarkDatasetProvider({
      descriptor: manifest.datasetProvider,
      verifyAttestation: receiptVerifier,
      load: async (request) => {
        const dataset = benchmarkPlan.datasets.find(
          (item) => item.id === request.datasetId,
        );
        return executionReceipt(
          WIKISKILL_BENCHMARK_DATASET_RESOLUTION_SCHEMA,
          manifest.datasetProvider,
          {
            requestDigest: request.requestDigest,
            datasetId: request.datasetId,
            version: request.version,
            datasetDigest: request.datasetDigest,
            splitDigest: request.splitDigest,
            cases: dataset.splitIds.map((splitId) => {
              const input = { datasetId: dataset.id, splitId };
              return {
                splitId,
                input,
                inputDigest: computeWikiSkillBenchmarkExecutionDigest(
                  "chainlesschain.wikiskill-benchmark-input/v1",
                  input,
                ),
              };
            }),
          },
        );
      },
    }),
    runner: createWikiSkillBenchmarkRunner({
      descriptor: manifest.runner,
      verifyAttestation: receiptVerifier,
      run: async (request) =>
        executionReceipt(
          WIKISKILL_BENCHMARK_RUNNER_RECEIPT_SCHEMA,
          manifest.runner,
          {
            requestDigest: request.requestDigest,
            outputRef: `artifact://benchmark/${request.seed}/${request.datasetId}/${request.arm}`,
            outputDigest: hash(
              `${request.seed}:${request.datasetId}:${request.arm}:output`,
            ),
            traceDigest: hash(
              `${request.seed}:${request.datasetId}:${request.arm}:trace`,
            ),
            failureClass: "none",
            tokens: 10,
            cost: 0.01,
            latencyMs: 100,
          },
        ),
    }),
    grader: createWikiSkillBenchmarkGrader({
      descriptor: manifest.grader,
      verifyAttestation: receiptVerifier,
      grade: async (request) =>
        executionReceipt(
          WIKISKILL_BENCHMARK_GRADER_RECEIPT_SCHEMA,
          manifest.grader,
          {
            requestDigest: request.requestDigest,
            score: request.arm === "skill" ? 0.75 : 0.5,
          },
        ),
    }),
    reportAttestor: createWikiSkillBenchmarkReportAttestor({
      descriptor: manifest.reportAttestor,
      verifyAttestation,
      attest: async (request) => ({
        schema: WIKISKILL_BENCHMARK_REPORT_ATTESTATION_SCHEMA,
        ...manifest.reportAttestor,
        ...request,
        issuedAt: "2026-09-05T00:00:00.000Z",
        signature: createHmac("sha256", SECRET)
          .update(request.reportDigest)
          .digest("hex"),
      }),
    }),
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

function ledgerAuthority(label) {
  const secret = `test-only-${label}-secret`;
  const trust = Object.freeze({
    algorithm: "hmac-sha256",
    keyId: `key://tests/${label}`,
    trustPolicyDigest: hash(`${label}-policy`),
  });
  const value = (message) =>
    createHmac("sha256", secret).update(message).digest("base64url");
  return {
    trust,
    signer: {
      sign: ({ message }) => ({ ...trust, value: value(message) }),
    },
    verifier: {
      verify: ({ message, signature }) =>
        signature.algorithm === trust.algorithm &&
        signature.keyId === trust.keyId &&
        signature.trustPolicyDigest === trust.trustPolicyDigest &&
        signature.value === value(message),
    },
  };
}

function storage(existing = null) {
  const root =
    existing?.root ??
    fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), "cc-wikiskill-benchmark-"),
    );
  if (!existing) roots.push(root);
  const state = existing?.state ?? { events: [], failAfterAppend: false };
  const algorithm = "hmac-sha256";
  const keyId = "test:wikiskill-benchmark";
  const policyDigest = hash("benchmark-artifact-policy");
  const sign = (message) =>
    createHmac("sha256", SECRET).update(message).digest("base64url");
  const artifactPorts = new EvolutionArtifactPorts({
    artifactStore: new ArtifactStore({
      dir: path.join(root, "artifacts"),
      now: () => NOW,
    }),
    audience: "evolution-runtime",
    tenantId: "tenant-a",
    now: () => NOW,
    envelopeSigner: {
      sign: ({ message }) => ({ algorithm, keyId, value: sign(message) }),
    },
    envelopeVerifier: {
      verify: ({ message, signature }) =>
        signature.algorithm === algorithm &&
        signature.keyId === keyId &&
        signature.value === sign(message),
    },
    currentAuthorityResolver: {
      resolve(request) {
        const core = {
          action: request.action,
          algorithm,
          allowed: true,
          audience: request.audience,
          checkedAt: new Date(NOW).toISOString(),
          decisionExpiresAt: new Date(NOW + 30_000).toISOString(),
          digest: request.digest,
          issuedAt: request.issuedAt,
          issuedPolicyDigest: request.issuedPolicyDigest,
          issuedPolicyRevision: request.issuedPolicyRevision,
          issuedPolicyTrusted: true,
          keyId: request.keyId || keyId,
          policyDigest,
          policyRevision: 1,
          purpose: request.purpose,
          requestedAt: request.requestedAt,
          retention: request.retention,
          revocationRevision: 1,
          revoked: false,
          schema: EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
          tenantId: request.tenantId,
          type: request.type,
        };
        return {
          ...core,
          receiptDigest: hash(
            `chainlesschain.evolution-artifact-authority-decision/v1\0${canonical(core)}`,
          ),
        };
      },
    },
  });
  const ledger = {
    read: () => structuredClone(state.events),
    verify: () => ({
      epoch: "epoch-benchmark",
      ledgerId: "ledger-benchmark",
      sequence: state.events.length,
      headDigest: state.events.at(-1)?.eventDigest ?? null,
    }),
    appendDomainEvent(input, expected) {
      if (
        expected.expectedSequence !== state.events.length ||
        expected.expectedHeadDigest !==
          (state.events.at(-1)?.eventDigest ?? null)
      ) {
        throw new Error("ledger head conflict");
      }
      const event = {
        ...structuredClone(input),
        schema: EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
        sequence: state.events.length + 1,
        eventDigest: hash(input),
      };
      state.events.push(event);
      if (state.failAfterAppend) {
        state.failAfterAppend = false;
        throw new Error("simulated append response loss");
      }
      return {
        authenticated: true,
        committed: true,
        durable: true,
        eventId: input.eventId,
        receiptDigest: hash(event),
      };
    },
  };
  return {
    root,
    state,
    artifactPorts,
    ledger,
    resolver: artifactPorts.createEvolutionLedgerArtifactResolver({
      purpose: "evolution-ledger",
    }),
  };
}

function adapter(value, verifier = verifyAttestation) {
  return new WikiSkillBenchmarkLedgerAdapter({
    descriptor: {
      tenantId: "tenant-a",
      artifactTenantId: "tenant-a",
      skillName: "wikiskill-benchmark",
      audience: "evolution-runtime",
      purpose: "evolution-ledger",
    },
    artifactPorts: value.artifactPorts,
    ledger: value.ledger,
    ledgerArtifactResolver: value.resolver,
    verifyAttestation: verifier,
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true });
});

describe("WikiSkillBenchmarkLedgerAdapter", () => {
  it("runs the branded CLI host through execution, attestation, retention, and show", async () => {
    const value = storage();
    const benchmarkPlan = plan();
    const manifest = executionManifest();
    const providers = executionProviders(benchmarkPlan, manifest);
    const host = createWikiSkillBenchmarkCliHost({
      ...providers,
      ledgerAdapter: adapter(value),
      now: () => NOW,
    });

    const executed = await host.run({
      plan: benchmarkPlan,
      executionManifest: manifest,
      effectiveAt: null,
    });
    expect(executed).toMatchObject({
      status: "VERIFIED",
      provenance: "chainlesschain-measured",
      committed: true,
      recovered: false,
      metrics: { delta: 0.25 },
    });
    expect(value.state.events).toHaveLength(1);

    const reopened = storage(value);
    const reopenedHost = createWikiSkillBenchmarkCliHost({
      ...providers,
      ledgerAdapter: adapter(reopened),
      now: () => NOW,
    });
    await expect(
      reopenedHost.show(executed.reportDigest),
    ).resolves.toMatchObject({
      status: "VERIFIED",
      reportDigest: executed.reportDigest,
      effectiveAt: "2026-09-05T00:00:00.000Z",
    });
  });

  it("reopens through real Ledger files and an independently signed witness", async () => {
    const value = storage();
    const witnessDir = path.join(value.root, "witness");
    fs.mkdirSync(witnessDir, { mode: 0o700 });
    const backendOptions = {
      rootDir: path.join(value.root, "ledger-events"),
      authorityRootDir: path.join(value.root, "ledger-authority"),
      witnessFilePath: path.join(witnessDir, "checkpoint.json"),
      witnessId: "witness-wikiskill-benchmark",
      ledgerAuthority: ledgerAuthority("wikiskill-benchmark-ledger"),
      witnessAuthority: ledgerAuthority("wikiskill-benchmark-witness"),
      artifactResolver: value.resolver,
      clock: () => NOW,
      fsImpl: durableFilesystem(),
      secure: false,
    };
    const benchmarkPlan = plan();
    const benchmarkReport = report(benchmarkPlan);
    const signed = await envelope(benchmarkReport);
    const firstBackend = createEvolutionLedgerFileBackend(backendOptions);
    await adapter({ ...value, ledger: firstBackend.ledger }).commit({
      plan: benchmarkPlan,
      executionManifest: executionManifest(),
      envelope: signed,
      effectiveAt: "2026-09-05T00:00:00.000Z",
    });
    expect(firstBackend.ledger.verify()).toMatchObject({ sequence: 1 });

    const reopenedPorts = storage(value);
    const reopenedBackend = createEvolutionLedgerFileBackend(backendOptions);
    await expect(
      adapter({ ...reopenedPorts, ledger: reopenedBackend.ledger }).load(
        benchmarkReport.reportDigest,
      ),
    ).resolves.toMatchObject({
      plan: { planDigest: benchmarkPlan.planDigest },
      envelope: { report: { reportDigest: benchmarkReport.reportDigest } },
    });
    expect(reopenedBackend.ledger.verify()).toMatchObject({ sequence: 1 });
  });

  it("recovers an authenticated immutable bundle through fresh ArtifactStore ports", async () => {
    const first = storage();
    const benchmarkPlan = plan();
    const benchmarkReport = report(benchmarkPlan);
    const signed = await envelope(benchmarkReport);

    await expect(
      adapter(first).commit({
        plan: benchmarkPlan,
        executionManifest: executionManifest(),
        envelope: signed,
        effectiveAt: "2026-09-05T00:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      committed: true,
      recovered: false,
      reportDigest: benchmarkReport.reportDigest,
    });
    expect(first.state.events).toMatchObject([
      { type: WIKISKILL_BENCHMARK_LEDGER_EVENT },
    ]);

    const reopened = storage(first);
    await expect(
      adapter(reopened).load(benchmarkReport.reportDigest),
    ).resolves.toMatchObject({
      plan: { planDigest: benchmarkPlan.planDigest },
      envelope: { report: { reportDigest: benchmarkReport.reportDigest } },
    });
  });

  it("chunks a report larger than one ArtifactStore canonical record", async () => {
    const value = storage();
    const benchmarkPlan = plan(100);
    const benchmarkReport = report(benchmarkPlan);
    expect(Buffer.byteLength(JSON.stringify(benchmarkReport))).toBeGreaterThan(
      512 * 1024,
    );

    const committed = await adapter(value).commit({
      plan: benchmarkPlan,
      executionManifest: executionManifest(),
      envelope: await envelope(benchmarkReport),
      effectiveAt: "2026-09-05T00:00:00.000Z",
    });
    expect(committed).toMatchObject({ committed: true });
    await expect(
      adapter(storage(value)).load(benchmarkReport.reportDigest),
    ).resolves.toMatchObject({
      envelope: { report: { pairedObservationCount: 1_500 } },
    });
  }, 30_000);

  it("recovers a committed Ledger event after append response loss", async () => {
    const value = storage();
    const benchmarkPlan = plan();
    const signed = await envelope(report(benchmarkPlan));
    value.state.failAfterAppend = true;

    await expect(
      adapter(value).commit({
        plan: benchmarkPlan,
        executionManifest: executionManifest(),
        envelope: signed,
        effectiveAt: "2026-09-05T00:00:00.000Z",
      }),
    ).resolves.toMatchObject({ committed: true, recovered: true });
    expect(value.state.events).toHaveLength(1);
    await expect(
      adapter(storage(value)).commit({
        plan: benchmarkPlan,
        executionManifest: executionManifest(),
        envelope: signed,
        effectiveAt: "2026-09-05T00:00:00.000Z",
      }),
    ).resolves.toMatchObject({ committed: true, recovered: true });
    expect(value.state.events).toHaveLength(1);
  });

  it("rejects an unauthenticated envelope before publishing a Ledger event", async () => {
    const value = storage();
    const benchmarkPlan = plan();
    const signed = await envelope(report(benchmarkPlan));
    const forged = {
      ...signed,
      attestation: { ...signed.attestation, signature: "forged" },
    };

    await expect(
      adapter(value).commit({
        plan: benchmarkPlan,
        executionManifest: executionManifest(),
        envelope: forged,
        effectiveAt: "2026-09-05T00:00:00.000Z",
      }),
    ).rejects.toThrow("attestation rejected");
    expect(value.state.events).toHaveLength(0);
  });
});
