import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  sha256,
  binaryRetrievalMetrics,
  aggregateRetrievalMetrics,
  readBinaryQrels,
  readVectorMatrix,
  rankDenseVectors,
} from "./memory-semantic-quality.mjs";

function fixture(t) {
  const parent = fs.realpathSync.native(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(parent, "cc-semantic-metrics-"));
  assert.equal(path.dirname(directory), parent);
  assert.ok(path.basename(directory).startsWith("cc-semantic-metrics-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("independent binary judgments distinguish missed recall and discounted rank", () => {
  const metrics = binaryRetrievalMetrics(["a", "irrelevant", "b"], ["a", "b"]);
  assert.equal(metrics["recall@1"], 0.5);
  assert.equal(metrics["recall@5"], 1);
  assert.equal(metrics["mrr@10"], 1);
  assert(Math.abs(metrics["ndcg@10"] - 1.5 / (1 + 1 / Math.log2(3))) < 1e-12);
  assert.deepEqual(binaryRetrievalMetrics([], ["a"]), {
    "recall@1": 0,
    "recall@5": 0,
    "recall@10": 0,
    "mrr@10": 0,
    "ndcg@10": 0,
  });
});

test("missing judgments and repeated result IDs cannot inflate metrics", () => {
  assert.throws(() => binaryRetrievalMetrics(["a"], []));
  assert.throws(() => binaryRetrievalMetrics(["a", "a"], ["a"]));
  assert.equal(binaryRetrievalMetrics(["x", "a"], ["a"])["mrr@10"], 0.5);
});

test("aggregate recall is a macro average over queries, not pooled positives", () => {
  const values = aggregateRetrievalMetrics([
    binaryRetrievalMetrics(["a"], ["a", "b"]),
    binaryRetrievalMetrics(["x"], ["x"]),
  ]);
  assert.equal(values["recall@1"], 0.75);
  assert.throws(() => aggregateRetrievalMetrics([]));
});

test("qrels accept only unique binary positive labels", (t) => {
  const file = path.join(fixture(t), "qrels.tsv");
  fs.writeFileSync(
    file,
    "query-id\tcorpus-id\tscore\nq1\td1\t1\nq1\td2\t1\nq2\td3\t1\n",
  );
  const loaded = readBinaryQrels(file);
  assert.equal(loaded.qrels.size, 2);
  assert.equal(loaded.judgments, 3);
  fs.appendFileSync(file, "q1\td1\t1\n");
  assert.throws(() => readBinaryQrels(file), /duplicate/);
  fs.writeFileSync(file, "query-id\tcorpus-id\tscore\nq1\td1\t2\n");
  assert.throws(() => readBinaryQrels(file), /binary/);
});

test("float32 source integrity, shape and normalization are independently checked", (t) => {
  const file = path.join(fixture(t), "vectors.f32");
  const values = new Float32Array([1, 0, 0, 1]);
  const bytes = Buffer.from(values.buffer);
  fs.writeFileSync(file, bytes);
  const identity = { sha256: sha256(bytes), bytes: bytes.length };
  const matrix = readVectorMatrix(file, 2, ["a", "b"], identity);
  assert.deepEqual(
    rankDenseVectors(matrix, new Float32Array([0, 1]), 2).map(({ id }) => id),
    ["b", "a"],
  );
  const wrong = Buffer.from(bytes);
  wrong.writeFloatLE(0.5, 0);
  fs.writeFileSync(file, wrong);
  assert.throws(
    () => readVectorMatrix(file, 2, ["a", "b"], identity),
    /digest/,
  );
  assert.throws(
    () =>
      readVectorMatrix(file, 2, ["a", "b"], {
        sha256: sha256(wrong),
        bytes: wrong.length,
      }),
    /normalized/,
  );
  assert.throws(() => readVectorMatrix(file, 3, ["a", "b"], identity), /shape/);
});

test("dense ordering keeps negative cosine and deterministic tie breaks", () => {
  const matrix = {
    dimensions: 2,
    ids: ["b", "a", "c"],
    values: new Float32Array([1, 0, 1, 0, -1, 0]),
  };
  assert.deepEqual(rankDenseVectors(matrix, new Float32Array([1, 0]), 3), [
    { id: "a", score: 1 },
    { id: "b", score: 1 },
    { id: "c", score: -1 },
  ]);
  assert.throws(
    () => rankDenseVectors(matrix, new Float32Array([2, 0])),
    /normalized/,
  );
  assert.throws(() => rankDenseVectors(matrix, new Float32Array([1, 0]), 1001));
});
