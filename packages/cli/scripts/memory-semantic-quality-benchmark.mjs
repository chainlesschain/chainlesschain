#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { performance } from "node:perf_hooks";
import {
  canonicalDigest,
  createMemoryCandidate,
  rankMemoryRecords,
} from "@chainlesschain/context-memory-kernel";
import {
  captureSourceIdentity,
  captureGitIdentity,
} from "./memory-compound-query-benchmark.mjs";
import {
  sha256,
  binaryRetrievalMetrics,
  aggregateRetrievalMetrics,
  readBinaryQrels,
  readVectorMatrix,
  rankDenseVectors,
} from "./memory-semantic-quality.mjs";

const ownFile = fileURLToPath(import.meta.url);
const scripts = path.dirname(ownFile);
const root = path.resolve(scripts, "../../..");
const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const identity = (file) => ({
  sha256: sha256(fs.readFileSync(file)),
  bytes: fs.statSync(file).size,
});
const fixedInputs = {
  "corpus.jsonl":
    "dec31c8182f3d744c7d2c09423756fd1d17cbef75808db13ba01cc0aab4d1ac6",
  "queries.jsonl":
    "8ff84a7c903f722981cd8d595c022660140c51867b27608a6d4910db86080313",
  "qrels/test.tsv":
    "0864bb985e0ca2367ba217977e72004d549054b2b06666ed9d4825ac7c21284c",
};

function sourceIdentity() {
  const common = captureSourceIdentity();
  const evaluationFiles = [
    ownFile,
    path.join(scripts, "memory-semantic-quality.mjs"),
    path.join(scripts, "memory-semantic-encode.py"),
  ];
  return {
    ...common,
    evaluationSha256: Object.fromEntries(
      evaluationFiles.map((file) => [
        path.relative(root, file).replaceAll("\\", "/"),
        sha256(fs.readFileSync(file)),
      ]),
    ),
  };
}

function checkpoint(output, report) {
  const temporary = `${output}.partial`;
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`);
  fs.renameSync(temporary, output);
}

export function createScifactMemoryRecords(corpus) {
  const now = "2026-11-08T00:00:00.000Z";
  return corpus.map((row) =>
    createMemoryCandidate(
      {
        memoryId: `scifact-${row._id}`,
        scope: "project",
        scopeId: "scifact-eval",
        category: "research",
        content: `${row.title}\n\n${row.text}`.trim(),
        provenance: {
          source: "BEIR-SciFact",
          actor: "offline-evaluation",
          observedAt: now,
        },
        evidenceRefs: [{ store: "BEIR-SciFact-corpus", id: row._id }],
        confidence: 0.8,
        importance: 0.5,
        tags: [],
        sensitivity: "public",
        allowedSinks: ["provider.local"],
        retentionPolicy: { mode: "durable" },
        activate: true,
      },
      { clock: () => Date.parse(now) },
    ),
  );
}

export async function runSemanticQualityBenchmark({
  datasetDirectory,
  embeddingDirectory,
  output,
}) {
  output = path.resolve(output);
  assert.ok(
    !fs.existsSync(output),
    "retain prior evidence; choose a new report path",
  );
  const source = sourceIdentity();
  const git = captureGitIdentity();
  const inputs = Object.fromEntries(
    Object.keys(fixedInputs).map((name) => [
      name,
      identity(path.join(datasetDirectory, name)),
    ]),
  );
  for (const [name, expected] of Object.entries(fixedInputs))
    assert.equal(
      inputs[name].sha256,
      expected,
      `dataset ${name} differs from the fixed official SciFact bytes`,
    );
  const encodingFile = path.join(embeddingDirectory, "encoding-state.json");
  const encodingIdentity = identity(encodingFile);
  const encoding = json(encodingFile);
  assert.equal(
    encoding.complete,
    true,
    "encoding must have completed successfully",
  );
  assert.equal(
    encoding.networkCalls,
    0,
    "offline encoder attempted networking",
  );
  assert.equal(encoding.modelId, "BAAI/bge-base-en-v1.5");
  assert.equal(
    encoding.modelRevision,
    "a5beb1e3e68b9ab74eb54cfd186867f64f240e1a",
  );
  assert.equal(
    encoding.modelFiles["model.safetensors"].sha256,
    "c7c1988aae201f80cf91a5dbbd5866409503b89dcaba877ca6dba7dd0a5167d7",
  );
  assert.equal(
    encoding.worker.sha256,
    source.evaluationSha256["packages/cli/scripts/memory-semantic-encode.py"],
  );
  assert.equal(encoding.dimensions, 768);
  for (const kind of ["corpus", "queries"]) {
    assert.equal(
      encoding.inputFiles[kind].sha256,
      inputs[`${kind}.jsonl`].sha256,
    );
    assert.equal(encoding.artifacts[kind].specialTokensVerified, true);
  }
  const corpus = fs
    .readFileSync(path.join(datasetDirectory, "corpus.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map(JSON.parse);
  const queries = fs
    .readFileSync(path.join(datasetDirectory, "queries.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map(JSON.parse);
  const corpusIdsFile = path.join(embeddingDirectory, "corpus-ids.json");
  const queryIdsFile = path.join(embeddingDirectory, "queries-ids.json");
  assert.deepEqual(identity(corpusIdsFile), encoding.artifacts.corpus.ids);
  assert.deepEqual(identity(queryIdsFile), encoding.artifacts.queries.ids);
  const corpusIds = json(corpusIdsFile);
  const queryIds = json(queryIdsFile);
  assert.equal(corpus.length, 5183);
  assert.equal(queries.length, 1109);
  assert.deepEqual(corpusIds, corpus.map((row) => row._id).sort());
  assert.deepEqual(queryIds, queries.map((row) => row._id).sort());
  const matrix = readVectorMatrix(
    path.join(embeddingDirectory, "corpus.f32"),
    768,
    corpusIds,
    encoding.artifacts.corpus.vectors,
  );
  const queryMatrix = readVectorMatrix(
    path.join(embeddingDirectory, "queries.f32"),
    768,
    queryIds,
    encoding.artifacts.queries.vectors,
  );
  const embeddingFiles = Object.fromEntries(
    ["corpus.f32", "queries.f32", "corpus-ids.json", "queries-ids.json"].map(
      (name) => [name, identity(path.join(embeddingDirectory, name))],
    ),
  );
  const { qrels, judgments } = readBinaryQrels(
    path.join(datasetDirectory, "qrels", "test.tsv"),
  );
  assert.equal(qrels.size, 300);
  assert.equal(judgments, 339);
  const queryLookup = new Map(queries.map((row) => [row._id, row.text]));
  const queryRows = new Map(queryIds.map((id, index) => [id, index]));
  const documentLookup = new Map(corpus.map((row) => [row._id, row]));
  for (const [queryId, relevant] of qrels) {
    assert.ok(queryLookup.has(queryId) && queryRows.has(queryId));
    for (const documentId of relevant)
      assert.ok(
        documentLookup.has(documentId),
        "judged document missing from full corpus",
      );
  }
  const now = "2026-11-08T00:00:00.000Z";
  const records = createScifactMemoryRecords(
    corpusIds.map((id) => documentLookup.get(id)),
  );
  const byId = new Map(
    records.map((record, index) => [corpusIds[index], record]),
  );
  const report = {
    schema: "chainlesschain.memory-semantic-quality/v1",
    complete: false,
    source,
    git,
    sourceStable: false,
    inputStable: false,
    encodingIdentity,
    embeddingFiles,
    dataset: {
      name: "BEIR/SciFact",
      split: "test",
      source: "https://huggingface.co/datasets/BeIR/scifact",
      license: "CC-BY-SA-4.0",
      files: inputs,
      corpus: 5183,
      queryUniverse: 1109,
      evaluatedQueries: 300,
      positiveJudgments: 339,
    },
    encoding,
    scope:
      "Full fixed SciFact test split; canonical in-process reducer over equally weighted benchmark records. Dense is a model-only diagnostic; canonical_hybrid uses the existing maximum-of-lexical-and-semantic policy and top-1000 model candidates. Not a live CLI candidate service, user Memory corpus or multilingual/business acceptance.",
    modes: ["canonical_lexical", "model_dense", "canonical_hybrid"],
    queries: [],
    metrics: {},
    productionCandidateSourceConnected: false,
    semanticQualityAccepted: false,
    modelTrainingOverlapKnown: false,
    paidReady: false,
    performanceAccepted: false,
  };
  const started = performance.now();
  checkpoint(output, report);
  try {
    for (const queryId of [...qrels.keys()].sort()) {
      const index = queryRows.get(queryId);
      const queryVector = queryMatrix.values.subarray(
        index * 768,
        (index + 1) * 768,
      );
      const dense = rankDenseVectors(matrix, queryVector, 1000);
      const candidates = dense.map(({ id, score }) => {
        const record = byId.get(id);
        return {
          memoryId: record.memoryId,
          revision: record.revision,
          recordDigest: record.digest,
          score: Math.max(0, Math.min(1, score)),
        };
      });
      const request = {
        query: queryLookup.get(queryId),
        sink: "provider.local",
        scopeAdmissions: [{ scope: "project", scopeId: "scifact-eval" }],
        limit: 100,
        tokenBudget: 1_048_576,
        now,
      };
      const lexical = rankMemoryRecords(records, request);
      const hybrid = rankMemoryRecords(records, {
        ...request,
        semanticCandidates: candidates,
      });
      const project = (results) =>
        results.map((entry) => ({
          id: entry.memoryId.slice("scifact-".length),
          score: entry.relevance,
        }));
      const rankings = {
        canonical_lexical: project(lexical.results),
        model_dense: dense.slice(0, 100),
        canonical_hybrid: project(hybrid.results),
      };
      const relevant = [...qrels.get(queryId)].sort();
      report.queries.push({
        queryId,
        relevantIds: relevant,
        semanticCandidateDigest: canonicalDigest(
          candidates,
          "chainlesschain.semantic-evaluation-candidates/v1",
        ),
        rankings,
        metrics: Object.fromEntries(
          Object.entries(rankings).map(([mode, rows]) => [
            mode,
            binaryRetrievalMetrics(
              rows.map(({ id }) => id),
              relevant,
            ),
          ]),
        ),
      });
      if (report.queries.length % 10 === 0) {
        report.elapsedMs = performance.now() - started;
        checkpoint(output, report);
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
    assert.equal(report.queries.length, 300);
    for (const mode of report.modes)
      report.metrics[mode] = aggregateRetrievalMetrics(
        report.queries.map((query) => query.metrics[mode]),
      );
    assert.deepEqual(
      sourceIdentity(),
      source,
      "executed source bindings changed during evaluation",
    );
    assert.deepEqual(
      captureGitIdentity(),
      git,
      "Git identity changed during evaluation",
    );
    assert.deepEqual(identity(encodingFile), encodingIdentity);
    for (const [name, value] of Object.entries(embeddingFiles))
      assert.deepEqual(identity(path.join(embeddingDirectory, name)), value);
    for (const [name, value] of Object.entries(inputs))
      assert.deepEqual(identity(path.join(datasetDirectory, name)), value);
    report.complete = true;
    report.sourceStable = true;
    report.inputStable = true;
    report.elapsedMs = performance.now() - started;
    checkpoint(output, report);
    return report;
  } catch (error) {
    report.error = {
      name: error.name,
      code: error.code ?? null,
      message: error.message,
    };
    checkpoint(output, report);
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === ownFile) {
  const { values } = parseArgs({
    options: {
      dataset: { type: "string" },
      embeddings: { type: "string" },
      output: { type: "string" },
    },
  });
  runSemanticQualityBenchmark({
    datasetDirectory: values.dataset,
    embeddingDirectory: values.embeddings,
    output: values.output,
  })
    .then((report) => {
      process.stdout.write(
        `${JSON.stringify({ complete: report.complete, queries: report.queries.length, metrics: report.metrics, semanticQualityAccepted: false })}\n`,
      );
    })
    .catch((error) => {
      process.stderr.write(
        `${JSON.stringify({ name: error.name, message: error.message })}\n`,
      );
      process.exitCode = 1;
    });
}
