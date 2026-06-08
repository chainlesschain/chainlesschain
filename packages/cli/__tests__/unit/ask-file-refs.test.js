import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expandQuestionRefs } from "../../src/commands/ask.js";

describe("ask — @file reference expansion wiring", () => {
  let dir;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "ask-fileref-"));
    writeFileSync(join(dir, "notes.md"), "SECRET-MARKER-123", "utf-8");
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("expands an @path into the prompt when enabled", () => {
    const { prompt, warnings } = expandQuestionRefs("summarize @notes.md", {
      cwd: dir,
      enabled: true,
    });
    expect(prompt).toContain("summarize @notes.md"); // original prose kept
    expect(prompt).toContain("SECRET-MARKER-123"); // file content injected
    expect(prompt).toContain("<referenced-files");
    expect(warnings).toEqual([]);
  });

  it("passes the question through untouched when disabled (--no-file-refs)", () => {
    const { prompt } = expandQuestionRefs("summarize @notes.md", {
      cwd: dir,
      enabled: false,
    });
    expect(prompt).toBe("summarize @notes.md");
    expect(prompt).not.toContain("SECRET-MARKER-123");
  });

  it("warns (does not throw) on a typo'd path and leaves prose intact", () => {
    const { prompt, warnings } = expandQuestionRefs("see @nope/missing.md", {
      cwd: dir,
      enabled: true,
    });
    expect(prompt).toBe("see @nope/missing.md");
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/no such file/i);
  });

  it("leaves a plain question (no @) unchanged", () => {
    const { prompt, warnings } = expandQuestionRefs("what is 2+2?", {
      cwd: dir,
    });
    expect(prompt).toBe("what is 2+2?");
    expect(warnings).toEqual([]);
  });
});
