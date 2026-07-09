/**
 * diff-hunks — hunk-level partial accept for openDiff. Pure logic:
 * computeHunks (LCS line diff → contiguous change blocks) + applyHunks
 * (rebuild with only the picked blocks). The two invariants are the heart:
 * apply-ALL reproduces the proposal, apply-NONE reproduces the original.
 */
import { describe, it, expect } from "vitest";
import {
  computeHunks,
  applyHunks,
} from "../../../vscode-extension/src/diff-hunks.js";

const roundTrip = (original, modified) => {
  const hunks = computeHunks(original, modified);
  const all = hunks.map((h) => h.index);
  expect(applyHunks(original, hunks, all)).toBe(modified);
  expect(applyHunks(original, hunks, [])).toBe(original);
  return hunks;
};

describe("computeHunks", () => {
  it("identical texts → no hunks", () => {
    expect(computeHunks("a\nb", "a\nb")).toEqual([]);
  });

  it("single replacement is one hunk with 1-based header", () => {
    const hunks = roundTrip("a\nb\nc", "a\nX\nc");
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({
      oldStart: 1,
      oldLines: ["b"],
      newLines: ["X"],
      header: "lines 2-2 (-1 +1)",
      preview: "X",
    });
  });

  it("pure insertion and pure deletion", () => {
    const ins = roundTrip("a\nc", "a\nb\nc");
    expect(ins).toHaveLength(1);
    expect(ins[0]).toMatchObject({ oldLines: [], newLines: ["b"] });
    const del = roundTrip("a\nb\nc", "a\nc");
    expect(del).toHaveLength(1);
    expect(del[0]).toMatchObject({ oldLines: ["b"], newLines: [] });
    expect(del[0].preview).toBe("- b");
  });

  it("separates independent changes into pickable hunks", () => {
    const original = "one\ntwo\nthree\nfour\nfive\nsix";
    const modified = "ONE\ntwo\nthree\nfour\nfive\nSIX";
    const hunks = roundTrip(original, modified);
    expect(hunks).toHaveLength(2);
    // partial: apply only the first
    expect(applyHunks(original, hunks, [0])).toBe(
      "ONE\ntwo\nthree\nfour\nfive\nsix",
    );
    expect(applyHunks(original, hunks, [1])).toBe(
      "one\ntwo\nthree\nfour\nfive\nSIX",
    );
  });

  it("mixed insert+replace+delete round-trips with any subset", () => {
    const original = "h1\nkeep\nold-a\nold-b\nkeep2\ntail";
    const modified = "h1\nnew-top\nkeep\nnew-a\nkeep2";
    const hunks = roundTrip(original, modified);
    expect(hunks.length).toBeGreaterThanOrEqual(2);
    // every single-hunk subset must still be internally consistent:
    for (const h of hunks) {
      const out = applyHunks(original, hunks, [h.index]);
      expect(typeof out).toBe("string");
      // unselected regions stay original
      expect(out).toContain("keep");
    }
  });

  it("empty-file edges", () => {
    roundTrip("", "a\nb");
    roundTrip("a\nb", "");
  });

  it("huge pathological diff degrades to ONE whole hunk (size guard)", () => {
    const original = Array.from({ length: 2500 }, (_, i) => "o" + i).join("\n");
    const modified = Array.from({ length: 2500 }, (_, i) => "n" + i).join("\n");
    const hunks = roundTrip(original, modified);
    expect(hunks).toHaveLength(1); // pick-all-or-nothing fallback
  });
});
