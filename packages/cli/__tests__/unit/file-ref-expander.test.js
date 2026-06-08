/**
 * Unit tests for the `@file` reference expander.
 *
 * Filesystem access is injected via the `deps` seam so these tests never touch
 * real disk. Path keys are computed with the real `path.resolve(cwd, rel)` so
 * the fake matches whatever the expander resolves (Windows/posix agnostic).
 */

import { describe, it, expect } from "vitest";
import path from "path";
import {
  expandFileRefs,
  findFileRefTokens,
  DEFAULT_MAX_BYTES,
} from "../../src/runtime/file-ref-expander.js";

const cwd = process.cwd();

/**
 * Build a fake `fs` backed by in-memory maps.
 * @param {object} files  { relPath: string|Buffer }
 * @param {object} [dirs] { relPath: string[] }  entry names; trailing "/" = subdir
 */
function makeFs(files, dirs = {}) {
  const fileMap = new Map();
  for (const [rel, content] of Object.entries(files)) {
    const buf = Buffer.isBuffer(content)
      ? content
      : Buffer.from(content, "utf-8");
    fileMap.set(path.resolve(cwd, rel), buf);
  }
  const dirMap = new Map();
  for (const [rel, entries] of Object.entries(dirs)) {
    dirMap.set(path.resolve(cwd, rel), entries);
  }
  return {
    statSync(abs) {
      if (fileMap.has(abs)) {
        const b = fileMap.get(abs);
        return { isDirectory: () => false, isFile: () => true, size: b.length };
      }
      if (dirMap.has(abs)) {
        return { isDirectory: () => true, isFile: () => false, size: 0 };
      }
      const err = new Error(`ENOENT: ${abs}`);
      err.code = "ENOENT";
      throw err;
    },
    readFileSync(abs) {
      if (!fileMap.has(abs)) {
        const err = new Error(`ENOENT: ${abs}`);
        err.code = "ENOENT";
        throw err;
      }
      return fileMap.get(abs);
    },
    readdirSync(abs) {
      const entries = dirMap.get(abs) || [];
      return entries.map((e) => {
        const isDir = e.endsWith("/");
        return { name: isDir ? e.slice(0, -1) : e, isDirectory: () => isDir };
      });
    },
  };
}

const run = (prompt, files, dirs, extra = {}) =>
  expandFileRefs(prompt, { cwd, deps: { fs: makeFs(files, dirs) }, ...extra });

describe("findFileRefTokens", () => {
  it("matches @path at start and after whitespace/brackets", () => {
    const toks = findFileRefTokens("see @a/b.js and (@c.ts) `@d.md`");
    expect(toks.map((t) => t.raw)).toEqual(["a/b.js", "c.ts", "d.md"]);
  });

  it("skips emails — @ preceded by a word char", () => {
    expect(findFileRefTokens("contact me@example.com please")).toEqual([]);
  });

  it("dedupes repeated tokens", () => {
    const toks = findFileRefTokens("@x.js then @x.js again");
    expect(toks.map((t) => t.raw)).toEqual(["x.js"]);
  });
});

describe("expandFileRefs", () => {
  it("returns the prompt unchanged when there is no @", () => {
    const r = expandFileRefs("plain prompt, no refs");
    expect(r.prompt).toBe("plain prompt, no refs");
    expect(r.refs).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("injects a <file> block for an existing file", () => {
    const r = run("review @src/x.js", { "src/x.js": "const a = 1;\n" });
    expect(r.refs).toHaveLength(1);
    expect(r.refs[0].kind).toBe("file");
    expect(r.prompt).toContain("review @src/x.js");
    expect(r.prompt).toContain('<file path="src/x.js"');
    expect(r.prompt).toContain("const a = 1;");
    expect(r.prompt).toContain("</file>");
    expect(r.warnings).toEqual([]);
  });

  it("does not expand emails and emits no warning for them", () => {
    const r = run("ping user@example.com about it", {});
    expect(r.refs).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.prompt).toBe("ping user@example.com about it");
  });

  it("warns and leaves a path-like token that does not resolve", () => {
    const r = run("open @missing/file.js now", {});
    expect(r.refs).toEqual([]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain("missing/file.js");
    expect(r.prompt).toBe("open @missing/file.js now"); // unchanged
  });

  it("lists directory entries for a @dir reference", () => {
    const r = run("what's in @src", {}, { src: ["b.js", "a.js", "sub/"] });
    expect(r.refs[0].kind).toBe("dir");
    expect(r.prompt).toContain('<dir path="src"');
    // entries are sorted
    expect(r.prompt).toContain("a.js\nb.js\nsub/");
  });

  it("omits contents for binary files", () => {
    const bin = Buffer.from([0x89, 0x50, 0x00, 0x01, 0x02]);
    const r = run("inspect @img.png", { "img.png": bin });
    expect(r.refs[0].kind).toBe("binary");
    expect(r.prompt).toContain('binary="true"');
    expect(r.prompt).toContain("contents omitted");
  });

  it("truncates oversized files and marks them", () => {
    const big = "x".repeat(50);
    const r = run("read @big.txt", { "big.txt": big }, {}, { maxBytes: 10 });
    expect(r.refs[0].truncated).toBe(true);
    expect(r.prompt).toContain('truncated="true"');
    expect(r.prompt).toContain("[truncated");
    // only the first 10 bytes are inlined
    expect(r.prompt).toContain("xxxxxxxxxx");
  });

  it("handles trailing sentence punctuation around the token", () => {
    const r = run("see @config.json.", { "config.json": "{}" });
    expect(r.refs).toHaveLength(1);
    expect(r.refs[0].rel).toBe("config.json");
    expect(r.prompt).toContain('<file path="config.json"');
  });

  it("dedupes a file referenced twice into one block", () => {
    const r = run("@x.js vs @x.js", { "x.js": "1" });
    expect(r.refs).toHaveLength(1);
    expect(r.prompt.match(/<file /g)).toHaveLength(1);
  });

  it("expands multiple distinct refs in one prompt", () => {
    const r = run("diff @a.js and @b.js", { "a.js": "A", "b.js": "B" });
    expect(r.refs.map((x) => x.rel)).toEqual(["a.js", "b.js"]);
    expect(r.prompt).toContain("A");
    expect(r.prompt).toContain("B");
  });

  it("exposes a sane default truncation threshold", () => {
    expect(DEFAULT_MAX_BYTES).toBe(100 * 1024);
  });
});
