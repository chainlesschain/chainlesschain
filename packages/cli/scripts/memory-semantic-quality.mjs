import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { createHash } from "node:crypto";

export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

export function binaryRetrievalMetrics(ranking, relevantIds) {
  assert.ok(Array.isArray(ranking), "ranking must be an array");
  const relevant = new Set(relevantIds);
  assert.ok(
    relevant.size > 0,
    "every evaluated query needs independent judgments",
  );
  assert.equal(
    new Set(ranking).size,
    ranking.length,
    "ranking contains duplicate IDs",
  );
  const metrics = {};
  for (const k of [1, 5, 10]) {
    metrics[`recall@${k}`] =
      ranking.slice(0, k).filter((id) => relevant.has(id)).length /
      relevant.size;
  }
  const top = ranking.slice(0, 10);
  const first = top.findIndex((id) => relevant.has(id));
  metrics["mrr@10"] = first < 0 ? 0 : 1 / (first + 1);
  const dcg = top.reduce(
    (sum, id, index) => sum + (relevant.has(id) ? 1 / Math.log2(index + 2) : 0),
    0,
  );
  const ideal = Array.from(
    { length: Math.min(10, relevant.size) },
    (_, index) => 1 / Math.log2(index + 2),
  ).reduce((sum, value) => sum + value, 0);
  metrics["ndcg@10"] = dcg / ideal;
  return metrics;
}

export function aggregateRetrievalMetrics(rows) {
  assert.ok(rows.length > 0, "cannot aggregate an empty evaluation");
  const names = Object.keys(rows[0]);
  assert.ok(
    rows.every((row) => Object.keys(row).join("\0") === names.join("\0")),
  );
  return Object.fromEntries(
    names.map((name) => {
      assert.ok(
        rows.every(
          (row) =>
            Number.isFinite(row[name]) && row[name] >= 0 && row[name] <= 1,
        ),
      );
      return [
        name,
        rows.reduce((sum, row) => sum + row[name], 0) / rows.length,
      ];
    }),
  );
}

export function readBinaryQrels(file) {
  const rows = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
  assert.equal(rows.shift(), "query-id\tcorpus-id\tscore");
  const qrels = new Map();
  let judgments = 0;
  for (const row of rows) {
    const parts = row.split("\t");
    assert.equal(parts.length, 3, "malformed relevance judgment");
    const [query, document, score] = parts;
    assert.ok(
      query && document && score === "1",
      "this comparison requires binary positive judgments",
    );
    const relevant = qrels.get(query) || new Set();
    assert.ok(!relevant.has(document), "duplicate relevance judgment");
    relevant.add(document);
    qrels.set(query, relevant);
    judgments += 1;
  }
  return { qrels, judgments };
}

export function readVectorMatrix(file, dimensions, ids, expectedIdentity) {
  assert.equal(
    os.endianness(),
    "LE",
    "float32 artifact requires a little-endian host",
  );
  assert.ok(
    Number.isSafeInteger(dimensions) && dimensions > 0 && dimensions <= 4096,
  );
  assert.ok(
    Array.isArray(ids) && ids.length > 0 && new Set(ids).size === ids.length,
  );
  const size = fs.statSync(file).size;
  assert.ok(size <= 512 * 1024 * 1024, "vector artifact exceeds 512 MiB");
  assert.equal(
    size,
    ids.length * dimensions * 4,
    "vector shape does not match ID order",
  );
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.length, expectedIdentity.bytes);
  assert.equal(
    sha256(bytes),
    expectedIdentity.sha256,
    "vector artifact digest mismatch",
  );
  const values = new Float32Array(
    bytes.buffer,
    bytes.byteOffset,
    bytes.length / 4,
  );
  for (let row = 0; row < ids.length; row += 1) {
    let squared = 0;
    for (let column = 0; column < dimensions; column += 1) {
      const value = values[row * dimensions + column];
      assert.ok(Number.isFinite(value), "nonfinite vector value");
      squared += value * value;
    }
    assert.ok(Math.abs(squared - 1) < 0.0001, "vector is not unit normalized");
  }
  return { values, dimensions, ids };
}

export function rankDenseVectors(matrix, query, maximum = 1000) {
  assert.equal(query.length, matrix.dimensions);
  assert.ok(query.every(Number.isFinite));
  assert.ok(
    Math.abs(query.reduce((sum, value) => sum + value * value, 0) - 1) < 0.0001,
    "query vector is not unit normalized",
  );
  assert.ok(Number.isSafeInteger(maximum) && maximum >= 1 && maximum <= 1000);
  const ranked = matrix.ids.map((id, row) => {
    let score = 0;
    for (let column = 0; column < matrix.dimensions; column += 1) {
      score += matrix.values[row * matrix.dimensions + column] * query[column];
    }
    return { id, score };
  });
  ranked.sort(
    (left, right) =>
      right.score - left.score || left.id.localeCompare(right.id, "en"),
  );
  return ranked.slice(0, maximum);
}
