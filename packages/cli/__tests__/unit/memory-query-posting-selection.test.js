import { describe, expect, it } from "vitest";
import {
  compareMemoryRows,
  compileQueryIndex,
  encodeQueryIndex,
  matchesListQuery,
  normalizeListQuery,
  selectQueryRows,
} from "../../src/lib/context-memory-kernel/memory-query-index.js";

function indexFor(count) {
  const records = Object.fromEntries(
    Array.from({ length: count }, (_, i) => {
      const memoryId = `record-${String(i).padStart(5, "0")}`;
      return [
        memoryId,
        {
          memoryId,
          category: i === 0 ? "rare" : i % 2 ? "odd" : "even",
          scope: "project",
          scopeId: `project-${i % 3}`,
          state: ["active", "deleted", "purged"][i % 3],
          importance: i % 7,
          updatedAt: `2026-10-${String(10 + (i % 3)).padStart(2, "0")}T00:00:00.000Z`,
          tags: [`tag-${i % 5}`, "all"],
          allowedSinks:
            i % 4 === 0
              ? ["*", "provider.local"]
              : i % 4 === 1
                ? ["provider.local"]
                : ["private"],
        },
      ];
    }),
  );
  const state = { digest: "sha256:fixture", records };
  return compileQueryIndex(encodeQueryIndex(state), {
    digest: state.digest,
    recordCount: count,
  });
}

describe("Memory posting selection", () => {
  it("does not expand broad sink/tag postings when a selective category exists", () => {
    const index = indexFor(1000);
    let broadEntriesRead = 0;
    for (const [field, keys] of [
      ["sink", ["*", "provider.local"]],
      ["tag", ["all", "tag-0"]],
    ]) {
      for (const key of keys) {
        const posting = index.postings[field].get(key);
        index.postings[field].set(
          key,
          new Proxy(posting, {
            get(target, property, receiver) {
              if (/^\d+$/u.test(String(property))) broadEntriesRead++;
              return Reflect.get(target, property, receiver);
            },
          }),
        );
      }
    }
    const rows = [
      ...selectQueryRows(
        index,
        normalizeListQuery({
          category: "rare",
          sink: "provider.local",
          tags: ["all", "tag-0"],
        }),
      ),
    ];
    expect(rows.map((row) => row.memoryId)).toEqual(["record-00000"]);
    expect(broadEntriesRead).toBe(0);
  });

  it("matches a full scan across filter combinations, tombstones and cursor ties", () => {
    const index = indexFor(150);
    for (const postings of Object.values(index.postings)) {
      for (const positions of postings.values()) Object.freeze(positions);
    }
    const queries = [
      {},
      { includeTombstones: true },
      { category: "missing" },
      { scopeAdmissions: [] },
      { states: [] },
      { tags: [] },
      { states: ["deleted", "purged"] },
      { includeTombstones: true, states: ["deleted", "purged"] },
      { tags: ["tag-1", "tag-2", "tag-1", "unknown"] },
      { sink: "provider.remote" },
    ];
    for (const category of ["odd", "even", "rare"]) {
      for (const tags of [["tag-1", "tag-3"], ["all", "tag-0"], ["unknown"]]) {
        queries.push({
          category,
          tags,
          sink: "provider.local",
          includeTombstones: true,
        });
        queries.push({
          category,
          tags,
          scopeAdmissions: [
            { scope: "project", scopeId: "project-1" },
            { scope: "project", scopeId: "project-2" },
          ],
        });
      }
    }
    for (const options of queries) {
      const query = normalizeListQuery(options);
      for (const after of [null, index.rows[40], index.rows[110]]) {
        const expected = index.rows.filter(
          (row) =>
            matchesListQuery(row, query) &&
            (!after || compareMemoryRows(row, after) > 0),
        );
        const actual = [...selectQueryRows(index, query, after)];
        expect(actual).toEqual(expected);
        expect(new Set(actual.map((row) => row.memoryId)).size).toBe(
          actual.length,
        );
      }
    }
  });

  it("returns a sorted sparse union when it is narrower than any individual filter", () => {
    const index = indexFor(80);
    const query = normalizeListQuery({
      category: "odd",
      tags: ["tag-0", "tag-1"],
      includeTombstones: true,
    });
    const expected = index.rows.filter((row) => matchesListQuery(row, query));
    expect([...selectQueryRows(index, query)]).toEqual(expected);
    expect([
      ...selectQueryRows(
        index,
        normalizeListQuery({ states: [], tags: ["all", "tag-0"] }),
      ),
    ]).toEqual([]);
    expect([
      ...selectQueryRows(indexFor(0), normalizeListQuery({ tags: ["all"] })),
    ]).toEqual([]);
  });
});
