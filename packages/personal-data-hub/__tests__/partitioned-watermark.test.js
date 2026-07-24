"use strict";

import { describe, expect, it } from "vitest";

const {
  MAX_PARTITIONED_WATERMARK_STREAMS,
  PARTITIONED_WATERMARK_PREFIX,
  normalizePartitionedWatermarks,
  parsePartitionedWatermark,
  serializePartitionedWatermark,
} = require("../lib/partitioned-watermark");

describe("partitioned watermark codec", () => {
  it("serializes deterministically and round-trips scalar stream cursors", () => {
    const left = serializePartitionedWatermark({
      play: 1700000000000,
      favorite: "1690000000000",
    });
    const right = serializePartitionedWatermark({
      favorite: "1690000000000",
      play: 1700000000000n,
    });

    expect(left).toBe(right);
    expect(left.startsWith(PARTITIONED_WATERMARK_PREFIX)).toBe(true);
    expect(parsePartitionedWatermark(left)).toEqual({
      favorite: "1690000000000",
      play: "1700000000000",
    });
  });

  it("fails closed to an empty replay for legacy or damaged stored values", () => {
    expect(parsePartitionedWatermark("1700000000000")).toEqual({});
    expect(parsePartitionedWatermark("pdh-partitioned-v2:e30")).toEqual({});
    expect(
      parsePartitionedWatermark(`${PARTITIONED_WATERMARK_PREFIX}!!!`),
    ).toEqual({});
    expect(
      parsePartitionedWatermark(
        `${PARTITIONED_WATERMARK_PREFIX}${Buffer.from("[]").toString("base64url")}`,
      ),
    ).toEqual({});
    expect(
      parsePartitionedWatermark(
        `${PARTITIONED_WATERMARK_PREFIX}${Buffer.from(
          '{"bad key":"1"}',
        ).toString("base64url")}`,
      ),
    ).toEqual({});
  });

  it("filters retired keys while rejecting unknown override keys on demand", () => {
    const encoded = serializePartitionedWatermark({
      play: "10",
      retired: "20",
    });
    expect(
      parsePartitionedWatermark(encoded, { allowedKeys: ["play"] }),
    ).toEqual({ play: "10" });
    expect(() =>
      normalizePartitionedWatermarks(
        { play: "10", retired: "20" },
        { allowedKeys: ["play"], rejectUnknown: true },
      ),
    ).toThrow(/unknown watermark stream key "retired"/);
  });

  it("rejects unsafe keys, unsupported values, and oversized aggregates", () => {
    expect(() => serializePartitionedWatermark({ "bad key": "1" })).toThrow(
      /stream key/,
    );
    expect(() =>
      serializePartitionedWatermark({ play: Number.POSITIVE_INFINITY }),
    ).toThrow(/safe epoch-millisecond integer/);
    expect(() => serializePartitionedWatermark({ play: "" })).toThrow(
      /epoch-millisecond integer/,
    );
    expect(() =>
      serializePartitionedWatermark({ play: "opaque-cursor" }),
    ).toThrow(/epoch-millisecond integer/);
    const tooMany = {};
    for (
      let index = 0;
      index <= MAX_PARTITIONED_WATERMARK_STREAMS;
      index += 1
    ) {
      tooMany[`stream-${index}`] = String(index);
    }
    expect(() => serializePartitionedWatermark(tooMany)).toThrow(
      /exceed 64 streams/,
    );
  });
});
