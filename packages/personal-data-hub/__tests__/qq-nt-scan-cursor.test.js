"use strict";

import { describe, expect, it } from "vitest";

const {
  CURSOR_PREFIX,
  MAX_CURSOR_BYTES,
  initCursor,
  beginScan,
  advanceCursor,
  completeStream,
  serializeCursor,
  parseCursor,
} = require("../lib/qq-nt/scan-cursor");

function encoded(payload) {
  return `${CURSOR_PREFIX}${JSON.stringify(payload)}`;
}

function activeCursor(overrides = {}) {
  return {
    v: 1,
    next: "c2c",
    after: { c2c: null, group: null },
    scan: {
      upper: { c2c: "10", group: "20" },
      done: { c2c: false, group: false },
    },
    ...overrides,
  };
}

describe("QQ NT scan cursor", () => {
  it("serializes deterministic v1 JSON and round-trips the reset cursor", () => {
    const expected =
      'qqnt:v1:{"v":1,"next":"c2c","after":{"c2c":null,"group":null},"scan":null}';

    expect(serializeCursor(initCursor())).toBe(expected);
    expect(
      serializeCursor({
        scan: null,
        after: { group: null, c2c: null },
        next: "c2c",
        v: 1,
      }),
    ).toBe(expected);
    expect(parseCursor(expected)).toEqual({
      kind: "v1",
      cursor: initCursor(),
    });
  });

  it("classifies empty state and legacy count watermarks as resets", () => {
    for (const value of [null, undefined, ""]) {
      expect(parseCursor(value)).toEqual({
        kind: "reset",
        cursor: initCursor(),
      });
    }
    for (const value of [
      "0",
      "1844674407370955161518446744073709551615",
      42,
      18446744073709551615n,
    ]) {
      expect(parseCursor(value)).toEqual({
        kind: "legacy-reset",
        cursor: initCursor(),
      });
    }
  });

  it("freezes exact per-stream uppers and advances in fair stream order", () => {
    let cursor = beginScan(initCursor(), {
      c2c: 100n,
      group: "900719925474099312345",
    });
    expect(cursor).toEqual({
      v: 1,
      next: "c2c",
      after: { c2c: null, group: null },
      scan: {
        upper: {
          c2c: "100",
          group: "900719925474099312345",
        },
        done: { c2c: false, group: false },
      },
    });

    cursor = advanceCursor(cursor, "c2c", "99");
    expect(cursor.next).toBe("group");
    expect(cursor.after.c2c).toBe("99");

    cursor = advanceCursor(cursor, "group", 7);
    expect(cursor.next).toBe("c2c");
    expect(cursor.after.group).toBe("7");

    // Length-first decimal comparison treats 100 as greater than 99 without
    // converting either source identifier through Number.
    cursor = advanceCursor(cursor, "c2c", "100");
    expect(cursor.after.c2c).toBe("100");
    expect(cursor.scan.done.c2c).toBe(true);
    expect(cursor.next).toBe("group");
    expect(parseCursor(serializeCursor(cursor))).toEqual({
      kind: "v1",
      cursor,
    });
  });

  it("marks exhausted streams complete and closes a finished scan", () => {
    let cursor = beginScan(initCursor(), {
      c2c: null,
      group: "25",
    });
    expect(cursor.next).toBe("group");
    expect(cursor.scan.done).toEqual({ c2c: true, group: false });

    cursor = completeStream(cursor, "group");
    expect(cursor).toEqual({
      v: 1,
      next: "c2c",
      after: { c2c: null, group: "25" },
      scan: null,
    });

    // A source boundary equal to the durable position requires no new scan.
    expect(beginScan(cursor, { c2c: null, group: "25" })).toEqual(cursor);
  });

  it("rejects non-canonical legacy values and unsafe numeric inputs", () => {
    for (const value of [
      "00",
      "+1",
      "-1",
      " 1",
      "1 ",
      "1.0",
      "1e3",
      "not-a-cursor",
    ]) {
      expect(() => parseCursor(value)).toThrow(/qq-nt scan cursor/u);
    }

    for (const value of [
      Number.MAX_SAFE_INTEGER + 1,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      -1n,
    ]) {
      expect(() => parseCursor(value)).toThrow(/qq-nt scan cursor/u);
    }
    expect(() =>
      beginScan(initCursor(), {
        c2c: Number.MAX_SAFE_INTEGER + 1,
        group: null,
      }),
    ).toThrow(/safe integer/u);
  });

  it("rejects wrong versions and non-exact object shapes", () => {
    const reset = initCursor();
    const malformed = [
      `${CURSOR_PREFIX}{`,
      encoded([]),
      encoded({ ...reset, v: 2 }),
      encoded({ ...reset, extra: true }),
      encoded({ v: 1, next: "c2c", after: reset.after }),
      encoded({ ...reset, next: "chat" }),
      encoded({ ...reset, after: { c2c: null } }),
      encoded({ ...reset, after: { c2c: 1, group: null } }),
      encoded({ ...reset, after: { c2c: "01", group: null } }),
      encoded({
        ...activeCursor(),
        scan: {
          ...activeCursor().scan,
          extra: true,
        },
      }),
      encoded({
        ...activeCursor(),
        scan: {
          upper: activeCursor().scan.upper,
          done: { c2c: 0, group: false },
        },
      }),
    ];

    expect(() => parseCursor("qqnt:v2:{}")).toThrowError(
      expect.objectContaining({ code: "QQNT_CURSOR_UNSUPPORTED" }),
    );
    for (const value of malformed) {
      expect(() => parseCursor(value)).toThrow();
    }
  });

  it("rejects impossible scan completion and upper-bound states", () => {
    const impossible = [
      activeCursor({
        after: { c2c: "11", group: null },
      }),
      activeCursor({
        after: { c2c: "10", group: null },
      }),
      activeCursor({
        after: { c2c: "9", group: null },
        scan: {
          upper: { c2c: "10", group: "20" },
          done: { c2c: true, group: false },
        },
      }),
      activeCursor({
        scan: {
          upper: { c2c: null, group: "20" },
          done: { c2c: false, group: false },
        },
      }),
      activeCursor({
        after: { c2c: "10", group: "20" },
        scan: {
          upper: { c2c: "10", group: "20" },
          done: { c2c: true, group: true },
        },
      }),
      activeCursor({
        next: "c2c",
        after: { c2c: "10", group: null },
        scan: {
          upper: { c2c: "10", group: "20" },
          done: { c2c: true, group: false },
        },
      }),
    ];

    for (const cursor of impossible) {
      expect(() => serializeCursor(cursor)).toThrow();
      expect(() => parseCursor(encoded(cursor))).toThrow();
    }
  });

  it("rejects invalid state transitions instead of guessing continuation", () => {
    expect(() => advanceCursor(initCursor(), "c2c", "1")).toThrow(
      /active scan/u,
    );
    expect(() => completeStream(initCursor(), "c2c")).toThrow(/active scan/u);

    let cursor = beginScan(initCursor(), { c2c: "10", group: "20" });
    expect(() => advanceCursor(cursor, "group", "1")).toThrow(/cursor.next/u);
    expect(() => completeStream(cursor, "group")).toThrow(/cursor.next/u);

    cursor = advanceCursor(cursor, "c2c", "5");
    expect(() => advanceCursor(cursor, "group", "21")).toThrow(/exceeds/u);
    cursor = advanceCursor(cursor, "group", "8");
    expect(() => advanceCursor(cursor, "c2c", "5")).toThrow(/strictly/u);
  });

  it("enforces the serialized UTF-8 byte limit on input and output", () => {
    expect(Buffer.byteLength("测", "utf8")).toBeGreaterThan(1);
    const oversizedUtf8 = `${CURSOR_PREFIX}${"测".repeat(
      Math.ceil(MAX_CURSOR_BYTES / 2),
    )}`;
    expect(oversizedUtf8.length).toBeLessThan(MAX_CURSOR_BYTES);
    expect(() => parseCursor(oversizedUtf8)).toThrowError(
      expect.objectContaining({ code: "QQNT_CURSOR_TOO_LARGE" }),
    );

    const oversizedId = `1${"0".repeat(MAX_CURSOR_BYTES)}`;
    expect(() =>
      beginScan(initCursor(), { c2c: oversizedId, group: null }),
    ).toThrowError(expect.objectContaining({ code: "QQNT_CURSOR_TOO_LARGE" }));
  });
});
