/**
 * Review-comment anchoring + staleness (P1-1 "行评论 ... 不错误复用旧行号" —
 * CLAUDE_CODE_IDE_INCREMENTAL_GAP_ANALYSIS_2026-07-13.md). Pure module: no fs /
 * clock / RNG — deterministic content hashing + relocation.
 */
import { describe, it, expect } from "vitest";
import {
  ANCHOR_STATUS,
  hashContent,
  makeCommentAnchor,
  reanchorComment,
  markResolved,
  reconcileComments,
} from "../../src/lib/review-comment-anchor.js";

const BASE = ["function a() {", "  const x = 1;", "  return x;", "}"].join(
  "\n",
);

function anchorOnReturn() {
  return makeCommentAnchor({
    id: "c1",
    file: "a.js",
    content: BASE,
    line: 3, // "  return x;"
    comment: "should return x + 1",
  });
}

describe("makeCommentAnchor", () => {
  it("captures file, base hash, line and the anchored line text", () => {
    const a = anchorOnReturn();
    expect(a.file).toBe("a.js");
    expect(a.baseHash).toBe(hashContent(BASE));
    expect(a.line).toBe(3);
    expect(a.anchorLine).toBe("  return x;");
    expect(a.contextBefore).toEqual(["function a() {", "  const x = 1;"]);
    expect(a.contextAfter).toEqual(["}"]);
  });

  it("nulls the line when the requested line is out of range", () => {
    const a = makeCommentAnchor({
      file: "a.js",
      content: BASE,
      line: 99,
      comment: "x",
    });
    expect(a.line).toBe(null);
    expect(a.anchorLine).toBe("");
  });
});

describe("reanchorComment — current", () => {
  it("keeps the line when content is byte-identical (hash match)", () => {
    const r = reanchorComment(anchorOnReturn(), BASE);
    expect(r.status).toBe(ANCHOR_STATUS.CURRENT);
    expect(r.line).toBe(3);
  });
});

describe("reanchorComment — moved", () => {
  it("relocates the comment when lines are inserted above", () => {
    const shifted = ["// new header", "// another", BASE].join("\n");
    const r = reanchorComment(anchorOnReturn(), shifted);
    expect(r.status).toBe(ANCHOR_STATUS.MOVED);
    expect(r.line).toBe(5); // 3 + 2 inserted lines
    expect(r.previousLine).toBe(3);
  });
});

describe("reanchorComment — outdated (never reuse the old line)", () => {
  it("marks outdated with line=null when the anchored line is edited away", () => {
    const fixed = [
      "function a() {",
      "  const x = 1;",
      "  return x + 1;",
      "}",
    ].join("\n");
    const r = reanchorComment(anchorOnReturn(), fixed);
    expect(r.status).toBe(ANCHOR_STATUS.OUTDATED);
    expect(r.line).toBe(null);
  });

  it("marks outdated when the whole region is deleted", () => {
    const r = reanchorComment(anchorOnReturn(), "function a() {}\n");
    expect(r.status).toBe(ANCHOR_STATUS.OUTDATED);
    expect(r.line).toBe(null);
  });

  it("is outdated when the anchor captured no text", () => {
    const a = makeCommentAnchor({
      file: "a.js",
      content: BASE,
      line: 99,
      comment: "x",
    });
    const r = reanchorComment(a, BASE + "\n// changed");
    expect(r.status).toBe(ANCHOR_STATUS.OUTDATED);
    expect(r.line).toBe(null);
  });
});

describe("reanchorComment — ambiguous", () => {
  it("refuses to guess when several identical lines match equally", () => {
    // Two identical `  return x;` bodies, and we change something else so the
    // hash differs; context on both sides is symmetric → ambiguous.
    const dup = [
      "function a() {",
      "  return x;",
      "}",
      "// edit forces new hash",
      "function b() {",
      "  return x;",
      "}",
    ].join("\n");
    const a = makeCommentAnchor({
      file: "a.js",
      content: ["function a() {", "  return x;", "}"].join("\n"),
      line: 2,
      comment: "check",
      contextRadius: 0, // no context to disambiguate
    });
    const r = reanchorComment(a, dup);
    expect(r.status).toBe(ANCHOR_STATUS.AMBIGUOUS);
    expect(r.line).toBe(null);
  });

  it("uses context to disambiguate identical lines uniquely → moved", () => {
    const dup = [
      "// header shifts everything down",
      "function a() {",
      "  const x = 1;", // distinctive context before the CORRECT return
      "  return x;",
      "}",
      "function b() {",
      "  const y = 2;",
      "  return x;",
      "}",
    ].join("\n");
    const r = reanchorComment(anchorOnReturn(), dup);
    expect(r.status).toBe(ANCHOR_STATUS.MOVED);
    expect(r.line).toBe(4); // the return preceded by `const x = 1;`, shifted down 1
  });
});

describe("markResolved", () => {
  it("sets a distinct RESOLVED terminal state with null line", () => {
    const r = markResolved(anchorOnReturn(), "fixed in follow-up");
    expect(r.status).toBe(ANCHOR_STATUS.RESOLVED);
    expect(r.line).toBe(null);
    expect(r.resolvedReason).toBe("fixed in follow-up");
  });
});

describe("reconcileComments", () => {
  it("buckets a mixed set by status and honors resolvedIds", () => {
    const a1 = makeCommentAnchor({
      id: "keep",
      file: "a.js",
      content: BASE,
      line: 2,
      comment: "x",
    });
    const a2 = anchorOnReturn(); // id c1, will go outdated after the fix
    const a3 = makeCommentAnchor({
      id: "done",
      file: "a.js",
      content: BASE,
      line: 1,
      comment: "y",
    });
    const fixed = [
      "function a() {",
      "  const x = 1;",
      "  return x + 1;",
      "}",
    ].join("\n");

    const out = reconcileComments([a1, a2, a3], fixed, {
      resolvedIds: ["done"],
    });
    expect(out.resolved).toContain("done");
    expect(out.outdated).toContain("c1");
    expect(out.current).toContain("keep"); // `const x = 1;` unchanged at line 2
    // every stale bucket carries a null line on its comment record
    for (const c of out.comments) {
      if (
        c.status === ANCHOR_STATUS.OUTDATED ||
        c.status === ANCHOR_STATUS.AMBIGUOUS
      ) {
        expect(c.line).toBe(null);
      }
    }
  });
});
