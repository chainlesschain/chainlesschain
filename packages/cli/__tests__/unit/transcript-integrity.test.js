import { describe, it, expect } from "vitest";
import {
  computeEventHash,
  latestChainHash,
  verifyTranscriptLines,
  verifyTranscriptText,
  TRANSCRIPT_CHAIN_STATUS,
} from "../../src/harness/transcript-integrity.js";

/** Build a valid chained transcript from event cores. */
function buildChain(cores) {
  let prevHash = null;
  return cores.map((core) => {
    const hash = computeEventHash(prevHash, core);
    const line = JSON.stringify({ ...core, prevHash, hash });
    prevHash = hash;
    return line;
  });
}

const CORES = [
  { type: "session_start", timestamp: 1000, data: { title: "t" } },
  {
    type: "user_message",
    timestamp: 2000,
    data: { role: "user", content: "hi" },
  },
  {
    type: "assistant_message",
    timestamp: 3000,
    data: { role: "assistant", content: "yo" },
  },
  {
    type: "tool_call",
    timestamp: 4000,
    data: { tool: "read_file", args: { path: "x" } },
  },
];

const legacyLine = (core) => JSON.stringify(core);

describe("transcript-integrity", () => {
  describe("computeEventHash", () => {
    it("is deterministic and ignores hash/prevHash fields on the record", () => {
      const core = CORES[0];
      const h1 = computeEventHash(null, core);
      const h2 = computeEventHash(null, { ...core, prevHash: "x", hash: "y" });
      expect(h1).toBe(h2);
      expect(h1).toMatch(/^[0-9a-f]{64}$/);
    });

    it("changes when prev hash, type, timestamp, or data change", () => {
      const core = CORES[1];
      const base = computeEventHash("abc", core);
      expect(computeEventHash("abd", core)).not.toBe(base);
      expect(computeEventHash("abc", { ...core, type: "system" })).not.toBe(
        base,
      );
      expect(computeEventHash("abc", { ...core, timestamp: 2001 })).not.toBe(
        base,
      );
      expect(
        computeEventHash("abc", {
          ...core,
          data: { role: "user", content: "hi!" },
        }),
      ).not.toBe(base);
    });

    it("survives a JSON round-trip (parse → stringify keeps key order)", () => {
      const core = CORES[3];
      const parsed = JSON.parse(JSON.stringify({ ...core, prevHash: null }));
      expect(computeEventHash(null, parsed)).toBe(computeEventHash(null, core));
    });
  });

  describe("verifyTranscriptLines — happy paths", () => {
    it("verifies a fully chained transcript", () => {
      const r = verifyTranscriptLines(buildChain(CORES));
      expect(r.status).toBe(TRANSCRIPT_CHAIN_STATUS.VERIFIED);
      expect(r.chainedEvents).toBe(4);
      expect(r.legacyEvents).toBe(0);
      expect(r.firstInvalidLine).toBeNull();
    });

    it("classifies a pre-chaining transcript as legacy", () => {
      const r = verifyTranscriptLines(CORES.map(legacyLine));
      expect(r.status).toBe(TRANSCRIPT_CHAIN_STATUS.LEGACY);
      expect(r.legacyEvents).toBe(4);
      expect(r.chainedEvents).toBe(0);
    });

    it("classifies legacy prefix + valid chain as partial", () => {
      const lines = [
        legacyLine(CORES[0]),
        legacyLine(CORES[1]),
        ...buildChain(CORES.slice(2)),
      ];
      const r = verifyTranscriptLines(lines);
      expect(r.status).toBe(TRANSCRIPT_CHAIN_STATUS.PARTIAL);
      expect(r.legacyEvents).toBe(2);
      expect(r.chainedEvents).toBe(2);
    });

    it("returns empty for a blank transcript", () => {
      expect(verifyTranscriptLines([]).status).toBe(
        TRANSCRIPT_CHAIN_STATUS.EMPTY,
      );
      expect(verifyTranscriptText("\n\n").status).toBe(
        TRANSCRIPT_CHAIN_STATUS.EMPTY,
      );
    });
  });

  describe("verifyTranscriptLines — tamper detection", () => {
    it("detects an edited chained record (content ≠ hash)", () => {
      const lines = buildChain(CORES);
      const rec = JSON.parse(lines[1]);
      rec.data.content = "HELLO INJECTED";
      lines[1] = JSON.stringify(rec);
      const r = verifyTranscriptLines(lines);
      expect(r.status).toBe(TRANSCRIPT_CHAIN_STATUS.TAMPERED);
      expect(r.firstInvalidLine).toBe(2);
      expect(r.reason).toMatch(/does not match its hash/);
    });

    it("detects a deleted middle record (linkage break)", () => {
      const lines = buildChain(CORES);
      lines.splice(1, 1);
      const r = verifyTranscriptLines(lines);
      expect(r.status).toBe(TRANSCRIPT_CHAIN_STATUS.TAMPERED);
      expect(r.reason).toMatch(/linkage broken/);
    });

    it("detects reordered records", () => {
      const lines = buildChain(CORES);
      [lines[1], lines[2]] = [lines[2], lines[1]];
      expect(verifyTranscriptLines(lines).status).toBe(
        TRANSCRIPT_CHAIN_STATUS.TAMPERED,
      );
    });

    it("detects an inserted forged record even with a self-consistent hash", () => {
      const lines = buildChain(CORES);
      // Forge a record that hashes correctly against line 2's hash, inserted
      // mid-chain — the FOLLOWING record's prevHash no longer matches.
      const prev = JSON.parse(lines[1]).hash;
      const forgedCore = {
        type: "user_message",
        timestamp: 2500,
        data: { role: "user", content: "forged" },
      };
      const forged = {
        ...forgedCore,
        prevHash: prev,
        hash: computeEventHash(prev, forgedCore),
      };
      lines.splice(2, 0, JSON.stringify(forged));
      const r = verifyTranscriptLines(lines);
      expect(r.status).toBe(TRANSCRIPT_CHAIN_STATUS.TAMPERED);
      expect(r.firstInvalidLine).toBe(4);
    });

    it("detects removed head records (chain no longer starts at genesis)", () => {
      const lines = buildChain(CORES).slice(1);
      const r = verifyTranscriptLines(lines);
      expect(r.status).toBe(TRANSCRIPT_CHAIN_STATUS.TAMPERED);
      expect(r.reason).toMatch(/genesis/);
    });

    it("detects an unchained record appended after the chain", () => {
      const lines = [...buildChain(CORES), legacyLine(CORES[1])];
      const r = verifyTranscriptLines(lines);
      expect(r.status).toBe(TRANSCRIPT_CHAIN_STATUS.TAMPERED);
      expect(r.reason).toMatch(/unchained record/);
    });

    it("flags a malformed line INSIDE the chain as tampered", () => {
      const lines = buildChain(CORES);
      lines.splice(2, 0, "{not json");
      expect(verifyTranscriptLines(lines).status).toBe(
        TRANSCRIPT_CHAIN_STATUS.TAMPERED,
      );
    });
  });

  describe("crash tolerance", () => {
    it("treats a half-written LAST line as truncatedTail, not tampered", () => {
      const lines = [...buildChain(CORES), '{"type":"user_mes'];
      const r = verifyTranscriptLines(lines);
      expect(r.status).toBe(TRANSCRIPT_CHAIN_STATUS.VERIFIED);
      expect(r.truncatedTail).toBe(true);
      expect(r.malformedLines).toBe(1);
    });

    it("latestChainHash skips a half-written tail and chains from the last intact record", () => {
      const lines = buildChain(CORES);
      const lastGood = JSON.parse(lines[lines.length - 1]).hash;
      const text = lines.join("\n") + "\n" + '{"type":"trunc';
      expect(latestChainHash(text)).toBe(lastGood);
    });

    it("latestChainHash returns null for legacy / empty transcripts", () => {
      expect(latestChainHash("")).toBeNull();
      expect(latestChainHash(CORES.map(legacyLine).join("\n"))).toBeNull();
    });

    it("latestChainHash returns the tail hash of a chained transcript", () => {
      const lines = buildChain(CORES);
      expect(latestChainHash(lines.join("\n") + "\n")).toBe(
        JSON.parse(lines[lines.length - 1]).hash,
      );
    });
  });
});
