/**
 * aiChatPageWorktreeUtils 单元测试
 *
 * Focus: extractWorktreePatchForFile must not truncate a file's patch at a
 * literal "Z" (the old pattern used `\Z`, which JS treats as an identity
 * escape = literal "Z", not an end-of-string anchor).
 */

import { describe, it, expect } from "vitest";
import { extractWorktreePatchForFile } from "../aiChatPageWorktreeUtils";

const zooPatch = [
  "diff --git a/src/Zoo.js b/src/Zoo.js",
  "index 111..222 100644",
  "--- a/src/Zoo.js",
  "+++ b/src/Zoo.js",
  "@@ -1,2 +1,2 @@",
  "-const Zebra = 1;",
  "+const Zebra = 2;",
].join("\n");

const otherPatch = [
  "diff --git a/other.js b/other.js",
  "index 3..4 100644",
  "--- a/other.js",
  "+++ b/other.js",
  "@@ -1 +1 @@",
  "-x",
  "+y",
].join("\n");

describe("extractWorktreePatchForFile", () => {
  it("returns the full single-file patch even when it contains a literal 'Z'", () => {
    const out = extractWorktreePatchForFile(zooPatch, "src/Zoo.js");
    // The whole body must be present — previously truncated at the first "Z".
    expect(out).toContain("--- a/src/Zoo.js");
    expect(out).toContain("+const Zebra = 2;");
    expect(out).toBe(zooPatch);
  });

  it("extracts only the requested file from a multi-file diff", () => {
    const diff = `${zooPatch}\n${otherPatch}`;
    const out = extractWorktreePatchForFile(diff, "src/Zoo.js");
    expect(out).toContain("a/src/Zoo.js");
    expect(out).not.toContain("other.js");
    expect(out).toContain("+const Zebra = 2;");
  });

  it("extracts a non-first file too", () => {
    const diff = `${zooPatch}\n${otherPatch}`;
    const out = extractWorktreePatchForFile(diff, "other.js");
    expect(out).toContain("a/other.js");
    expect(out).not.toContain("Zoo.js");
  });

  it("normalizes Windows-style backslash paths", () => {
    const out = extractWorktreePatchForFile(zooPatch, "src\\Zoo.js");
    expect(out).toBe(zooPatch);
  });

  it("returns '' for a missing file or empty input", () => {
    expect(extractWorktreePatchForFile(zooPatch, "nope.js")).toBe("");
    expect(extractWorktreePatchForFile("", "src/Zoo.js")).toBe("");
    expect(extractWorktreePatchForFile(zooPatch, "")).toBe("");
  });

  it("does not let regex metacharacters in the path break matching", () => {
    const special = [
      "diff --git a/src/a(b).js b/src/a(b).js",
      "@@ -1 +1 @@",
      "-1",
      "+2",
    ].join("\n");
    const out = extractWorktreePatchForFile(special, "src/a(b).js");
    expect(out).toBe(special);
  });
});
