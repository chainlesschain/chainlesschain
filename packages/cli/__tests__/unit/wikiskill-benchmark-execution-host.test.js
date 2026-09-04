import { createHash, createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  createWikiSkillBenchmarkPlan,
  projectWikiSkillBenchmarkClaim,
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
  executeWikiSkillBenchmarkProduction,
} from "../../src/lib/evolution/wikiskill-benchmark-execution-host.js";

const SECRET = "independent-benchmark-authorities";
const D = (value) =>
  `sha256:${createHash("sha256").update(String(value)).digest("hex")}`;
const signature = (digest) =>
  createHmac("sha256", SECRET).update(digest).digest("base64url");
const verifyAttestation = ({ digest, attestation }) =>
  attestation.signature === signature(digest);

const descriptors = Object.freeze({
  datasetProvider: Object.freeze({
    authorityId: "authority:benchmark-datasets",
    revision: 1,
    handlerArtifactDigest: D("dataset-loader"),
  }),
  runner: Object.freeze({
    authorityId: "authority:benchmark-runner",
    revision: 1,
    handlerArtifactDigest: D("target-runner"),
  }),
  grader: Object.freeze({
    authorityId: "authority:benchmark-grader",
    revision: 1,
    handlerArtifactDigest: D("independent-grader"),
  }),
  reportAttestor: Object.freeze({
    authorityId: "authority:benchmark-report",
    revision: 1,
    handlerArtifactDigest: D("report-attestor"),
  }),
});

function receipt(schema, descriptor, fields, { forge = false } = {}) {
  const core = {
    schema,
    authenticated: true,
    durable: true,
    ...descriptor,
    ...fields,
  };
  const receiptDigest = computeWikiSkillBenchmarkExecutionDigest(schema, core);
  return {
    ...core,
    receiptDigest,
    attestation: {
      signature: forge ? signature(D("wrong")) : signature(receiptDigest),
    },
  };
}

function fixture({
  forgedRunner = false,
  graderDescriptor = descriptors.grader,
} = {}) {
  const environment = {
    containerDigest: D("container"),
    vllmVersion: "0.10.1",
    hardware: "gpu-example",
  };
  const executionManifest = createWikiSkillBenchmarkExecutionManifest({
    ...descriptors,
    targetEnvironmentDigest: computeWikiSkillBenchmarkExecutionDigest(
      "chainlesschain.wikiskill-benchmark-target-environment/v1",
      environment,
    ),
  });
  const plan = createWikiSkillBenchmarkPlan({
    gitCommit: "a".repeat(40),
    runnerDigest: descriptors.runner.handlerArtifactDigest,
    executionManifestDigest: executionManifest.manifestDigest,
    model: { checkpoint: "example/model@revision", digest: D("model") },
    inference: { temperature: 0, topP: 1, maxTokens: 1024 },
    environment,
    datasets: Array.from({ length: 5 }, (_, index) => ({
      id: `dataset-${index}`,
      version: "1.0.0",
      digest: D(`dataset-${index}`),
      splitIds: ["case-a"],
    })),
    toolDigest: D("tools"),
    apiDigest: D("api"),
    promptDigest: D("prompt"),
    skillDigest: D("skill"),
    wikiDigest: D("wiki"),
    seedSchedule: [11, 22, 33],
    bootstrapSamples: 1_000,
  });
  const calls = {
    dataset: vi.fn(),
    runner: vi.fn(),
    grader: vi.fn(),
    report: vi.fn(),
  };
  const datasetProvider = createWikiSkillBenchmarkDatasetProvider({
    descriptor: descriptors.datasetProvider,
    verifyAttestation,
    load: async (request) => {
      calls.dataset(request);
      const input = { prompt: `solve ${request.datasetId}/${request.version}` };
      return receipt(
        WIKISKILL_BENCHMARK_DATASET_RESOLUTION_SCHEMA,
        descriptors.datasetProvider,
        {
          requestDigest: request.requestDigest,
          datasetId: request.datasetId,
          version: request.version,
          datasetDigest: request.datasetDigest,
          splitDigest: request.splitDigest,
          cases: [
            {
              splitId: "case-a",
              input,
              inputDigest: computeWikiSkillBenchmarkExecutionDigest(
                "chainlesschain.wikiskill-benchmark-input/v1",
                input,
              ),
            },
          ],
        },
      );
    },
  });
  const runner = createWikiSkillBenchmarkRunner({
    descriptor: descriptors.runner,
    verifyAttestation,
    run: async (request) => {
      calls.runner(request);
      return receipt(
        WIKISKILL_BENCHMARK_RUNNER_RECEIPT_SCHEMA,
        descriptors.runner,
        {
          requestDigest: request.requestDigest,
          outputRef: `artifact://output/${request.seed}/${request.datasetId}/${request.arm}`,
          outputDigest: D(
            `${request.seed}:${request.datasetId}:${request.arm}:output`,
          ),
          traceDigest: D(
            `${request.seed}:${request.datasetId}:${request.arm}:trace`,
          ),
          failureClass: "none",
          tokens: 10,
          cost: 0.01,
          latencyMs: 100,
        },
        { forge: forgedRunner },
      );
    },
  });
  const grader = createWikiSkillBenchmarkGrader({
    descriptor: graderDescriptor,
    verifyAttestation,
    grade: async (request) => {
      calls.grader(request);
      return receipt(
        WIKISKILL_BENCHMARK_GRADER_RECEIPT_SCHEMA,
        graderDescriptor,
        {
          requestDigest: request.requestDigest,
          score: request.arm === "skill" ? 0.75 : 0.5,
        },
      );
    },
  });
  const reportAttestor = createWikiSkillBenchmarkReportAttestor({
    descriptor: descriptors.reportAttestor,
    verifyAttestation,
    attest: async (request) => {
      calls.report(request);
      return {
        schema: WIKISKILL_BENCHMARK_REPORT_ATTESTATION_SCHEMA,
        ...descriptors.reportAttestor,
        ...request,
        issuedAt: "2026-09-05T00:00:00.000Z",
        signature: signature(request.reportDigest),
      };
    },
  });
  return {
    calls,
    plan,
    executionManifest,
    datasetProvider,
    runner,
    grader,
    reportAttestor,
  };
}

describe("WikiSkill benchmark production execution host", () => {
  it("uses four independently bound authorities for every paired observation", async () => {
    const value = fixture();
    const result = await executeWikiSkillBenchmarkProduction(value);

    expect(result.report).toMatchObject({
      runCount: 3,
      pairedObservationCount: 15,
      metrics: { delta: 0.25 },
    });
    expect(value.calls.dataset).toHaveBeenCalledTimes(5);
    expect(value.calls.runner).toHaveBeenCalledTimes(30);
    expect(value.calls.grader).toHaveBeenCalledTimes(30);
    expect(value.calls.report).toHaveBeenCalledTimes(1);
    await expect(
      projectWikiSkillBenchmarkClaim({
        envelope: result.envelope,
        verifyAttestation,
      }),
    ).resolves.toMatchObject({
      provenance: "chainlesschain-measured",
      status: "VERIFIED",
      reportDigest: result.report.reportDigest,
    });
  });

  it("rejects a branded but unplanned grader before loading any dataset", async () => {
    const substituted = {
      authorityId: "authority:substituted-grader",
      revision: 1,
      handlerArtifactDigest: D("substituted-grader"),
    };
    const value = fixture({ graderDescriptor: substituted });

    await expect(executeWikiSkillBenchmarkProduction(value)).rejects.toThrow(
      "grader differs from the execution manifest",
    );
    expect(value.calls.dataset).not.toHaveBeenCalled();
    expect(value.calls.runner).not.toHaveBeenCalled();
  });

  it("does not invoke the grader after a forged runner receipt", async () => {
    const value = fixture({ forgedRunner: true });

    await expect(executeWikiSkillBenchmarkProduction(value)).rejects.toThrow(
      "runner receipt attestation rejected",
    );
    expect(value.calls.runner).toHaveBeenCalledTimes(1);
    expect(value.calls.grader).not.toHaveBeenCalled();
    expect(value.calls.report).not.toHaveBeenCalled();
  });
});
