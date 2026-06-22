import { describe, it, expect, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import mod from "../packfile-optimizer.js";
const { PackfileOptimizer, ObjectRef, DeltaObject } = mod;

// Decode a varint the way _encodeVarint writes it (LE base-128).
const decodeVarint = (buf, start = 0) => {
  let result = 0;
  let shift = 0;
  let pos = start;
  while (pos < buf.length) {
    const b = buf[pos++];
    result |= (b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7;
  }
  return { value: result >>> 0, next: pos };
};

describe("packfile-optimizer", () => {
  const p = new PackfileOptimizer();

  describe("value objects", () => {
    it("ObjectRef stores oid/type/size", () => {
      const r = new ObjectRef("abc", "blob", 42);
      expect(r).toMatchObject({ oid: "abc", type: "blob", size: 42 });
    });
    it("DeltaObject defaults depth to 1", () => {
      const d = new DeltaObject("base", "result", Buffer.from("x"));
      expect(d.depth).toBe(1);
      expect(d.baseOid).toBe("base");
    });
  });

  describe("_encodeVarint", () => {
    it("encodes single-byte values (<128) as themselves", () => {
      expect([...p._encodeVarint(0)]).toEqual([0]);
      expect([...p._encodeVarint(127)]).toEqual([127]);
    });
    it("uses a continuation bit for multi-byte values", () => {
      expect([...p._encodeVarint(128)]).toEqual([0x80, 1]);
    });
    it("round-trips a range of values", () => {
      for (const v of [0, 1, 127, 128, 255, 300, 16384, 1_000_000]) {
        expect(decodeVarint(p._encodeVarint(v)).value).toBe(v);
      }
    });
  });

  describe("_encodeInsert", () => {
    it("prefixes a 7-bit length byte before the data", () => {
      const b = p._encodeInsert(Buffer.from("abc"));
      expect(b[0]).toBe(3);
      expect(b.slice(1).toString()).toBe("abc");
    });
    it("returns an empty buffer for empty data", () => {
      expect(p._encodeInsert(Buffer.alloc(0)).length).toBe(0);
    });
  });

  describe("_encodeCopy", () => {
    it("writes flag + LE offset + LE length", () => {
      const b = p._encodeCopy(256, 16);
      expect(b[0]).toBe(0x80);
      expect(b.readUInt32LE(1)).toBe(256);
      expect(b.readUInt32LE(5)).toBe(16);
    });
  });

  describe("_createPackfileHeader", () => {
    it("emits PACK magic, version 2, and the object count", () => {
      const h = p._createPackfileHeader(7);
      expect(h.toString("ascii", 0, 4)).toBe("PACK");
      expect(h.readUInt32BE(4)).toBe(2);
      expect(h.readUInt32BE(8)).toBe(7);
      expect(h.length).toBe(12);
    });
  });

  describe("_createPackfileTrailer", () => {
    it("is a deterministic 20-byte SHA-1 digest", () => {
      const t1 = p._createPackfileTrailer();
      const t2 = p._createPackfileTrailer();
      expect(t1.length).toBe(20);
      expect(t1.equals(t2)).toBe(true);
    });
  });

  describe("_estimateSimilarity", () => {
    it("scores identical buffers 1 and disjoint buffers 0", () => {
      const a = Buffer.from("the quick brown fox jumps over");
      expect(p._estimateSimilarity(a, Buffer.from(a))).toBe(1);
      expect(
        p._estimateSimilarity(Buffer.from("aaaaaaaa"), Buffer.from("bbbbbbbb")),
      ).toBe(0);
    });
    it("returns 0 for null/empty inputs", () => {
      expect(p._estimateSimilarity(null, Buffer.from("x"))).toBe(0);
      expect(p._estimateSimilarity(Buffer.alloc(0), Buffer.from("x"))).toBe(0);
    });
  });

  describe("_computeDelta", () => {
    it("returns null when either side is missing", () => {
      expect(p._computeDelta(null, Buffer.from("x"))).toBeNull();
      expect(p._computeDelta(Buffer.from("x"), null)).toBeNull();
    });
    it("encodes base/target sizes as the leading varints", () => {
      const base = Buffer.from("a".repeat(40));
      const target = Buffer.from("a".repeat(40) + "tail");
      const delta = p._computeDelta(base, target);
      const first = decodeVarint(delta, 0);
      const second = decodeVarint(delta, first.next);
      expect(first.value).toBe(base.length);
      expect(second.value).toBe(target.length);
    });
  });

  describe("negotiateObjects", () => {
    it("splits remote refs into want vs common and lists all local as have", () => {
      const local = [{ oid: "a" }, { oid: "b" }, { oid: "c" }];
      const remote = [{ oid: "b" }, { oid: "c" }, { oid: "d" }];
      const r = p.negotiateObjects(local, remote);
      expect(r.want.sort()).toEqual(["d"]); // remote-only
      expect(r.common.sort()).toEqual(["b", "c"]); // shared
      expect(r.have.sort()).toEqual(["a", "b", "c"]); // everything local
    });
    it("handles empty sides", () => {
      expect(p.negotiateObjects([], [])).toEqual({
        want: [],
        have: [],
        common: [],
      });
      expect(p.negotiateObjects([], [{ oid: "x" }]).want).toEqual(["x"]);
    });
  });

  describe("generateThinPackfile", () => {
    it("streams PACK header, full entries for small blobs, and a trailer", async () => {
      const objects = {
        c1: { type: "commit", data: Buffer.from("commit-1"), parents: [] },
        b1: { type: "blob", data: Buffer.from("hello") },
      };
      const readObject = async (oid) => objects[oid] || null;
      const chunks = [];
      for await (const c of p.generateThinPackfile({
        wantOids: ["c1", "b1"],
        haveOids: [],
        readObject,
      })) {
        chunks.push(c);
      }
      // First chunk is the PACK header with 2 objects.
      expect(chunks[0].toString("ascii", 0, 4)).toBe("PACK");
      expect(chunks[0].readUInt32BE(8)).toBe(2);
      // Last chunk is the 20-byte trailer.
      expect(chunks[chunks.length - 1].length).toBe(20);
    });

    it("skips objects the receiver already has", async () => {
      const reads = [];
      const readObject = async (oid) => {
        reads.push(oid);
        return { type: "blob", data: Buffer.from(oid) };
      };
      const chunks = [];
      for await (const c of p.generateThinPackfile({
        wantOids: ["keep", "skip"],
        haveOids: ["skip"],
        readObject,
      })) {
        chunks.push(c);
      }
      // "skip" is in haveSet, so it is never read.
      expect(reads).not.toContain("skip");
      // header(2 oids? no — skip filtered) → header reflects only objectsToSend
      expect(chunks[0].readUInt32BE(8)).toBe(1);
    });
  });

  describe("stats", () => {
    it("resetStats zeroes counters", () => {
      const o = new PackfileOptimizer();
      o._stats.objectsProcessed = 5;
      o.resetStats();
      expect(o.getStats().objectsProcessed).toBe(0);
    });
  });
});
