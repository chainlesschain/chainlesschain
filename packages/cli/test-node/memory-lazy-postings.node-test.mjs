import assert from "node:assert/strict";
import test from "node:test";
import {
  MEMORY_QUERY_INDEX_SCHEMA,
  compileQueryIndex,
  selectQueryRows,
} from "../src/lib/context-memory-kernel/memory-query-index.js";

const descriptor = { digest: "sha256:fixture", recordCount: 400 };
const rows = Array.from({ length: descriptor.recordCount }, (_, index) => ({
  memoryId: `memory-${index}`,
  category: `category-${index % 7}`,
  scope: "project",
  scopeId: `project-${index % 3}`,
  state: index % 5 === 0 ? "deleted" : "active",
  importance: 1 - index / descriptor.recordCount,
  updatedAt: "2026-11-08T00:00:00.000Z",
  tags: [`tag-${index % 4}`, "shared"],
  allowedSinks: index % 3 === 0 ? ["*"] : ["provider.local"],
}));
const bytes = Buffer.from(
  JSON.stringify({
    schema: MEMORY_QUERY_INDEX_SCHEMA,
    shardDigest: descriptor.digest,
    rows,
  }),
);

test("lazy postings preserve selective, combined and cursor queries in any access order", () => {
  const eager = compileQueryIndex(bytes, descriptor);
  const lazy = compileQueryIndex(bytes, descriptor, { lazyPostings: true });
  const queries = [
    { category: "category-2" },
    { scopeAdmissions: [{ scope: "project", scopeId: "project-1" }] },
    { sink: "provider.local" },
    { tags: ["tag-3", "tag-1"] },
    { states: ["active"], category: "category-4", sink: "provider.local" },
    { includeTombstones: true, states: ["deleted"] },
    { scopeAdmissions: [], tags: ["missing"] },
    {},
  ];
  for (const query of [...queries, ...queries.toReversed()]) {
    for (const after of [null, rows[100], rows[399]]) {
      assert.deepEqual(
        [...selectQueryRows(lazy, query, after)],
        [...selectQueryRows(eager, query, after)],
      );
    }
  }
  for (const field of ["category", "scope", "state", "tag", "sink"]) {
    assert.deepEqual(lazy.postings[field], eager.postings[field]);
  }
});

for (const [field, invalid] of [
  ["tags", null],
  ["tags", 1],
  ["tags", {}],
  ["allowedSinks", null],
  ["allowedSinks", 1],
  ["allowedSinks", {}],
]) {
  test(`lazy compilation rejects invalid ${field} before any query`, () => {
    const invalidRows = rows.map((row, index) =>
      index === rows.length - 1 ? { ...row, [field]: invalid } : row,
    );
    const invalidBytes = Buffer.from(
      JSON.stringify({
        schema: MEMORY_QUERY_INDEX_SCHEMA,
        shardDigest: descriptor.digest,
        rows: invalidRows,
      }),
    );
    for (const lazyPostings of [false, true]) {
      assert.throws(() =>
        compileQueryIndex(invalidBytes, descriptor, { lazyPostings }),
      );
    }
  });
}

test("lazy compilation retains deep scope-key rejection even for category-only queries", () => {
  const deepScope = `${"[".repeat(12000)}0${"]".repeat(12000)}`;
  const deepRow = JSON.stringify(rows[0]).replace('"project"', deepScope);
  const deepBytes = Buffer.from(
    `{"schema":${JSON.stringify(MEMORY_QUERY_INDEX_SCHEMA)},"shardDigest":${JSON.stringify(descriptor.digest)},"rows":[${deepRow}]}`,
  );
  for (const lazyPostings of [false, true]) {
    assert.throws(
      () =>
        compileQueryIndex(
          deepBytes,
          { ...descriptor, recordCount: 1 },
          { lazyPostings },
        ),
      RangeError,
    );
  }
});

test("lazy compilation retains iteration semantics for string tags and sinks", () => {
  const stringBytes = Buffer.from(
    JSON.stringify({
      schema: MEMORY_QUERY_INDEX_SCHEMA,
      shardDigest: descriptor.digest,
      rows: [{ ...rows[0], tags: "abc", allowedSinks: "xyz" }],
    }),
  );
  const single = { ...descriptor, recordCount: 1 };
  const eager = compileQueryIndex(stringBytes, single);
  const lazy = compileQueryIndex(stringBytes, single, { lazyPostings: true });
  for (const field of ["category", "scope", "state", "tag", "sink"]) {
    assert.deepEqual(lazy.postings[field], eager.postings[field]);
  }
});
