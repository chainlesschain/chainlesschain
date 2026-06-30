/**
 * Unit tests for the `@file` reference expander.
 *
 * Filesystem access is injected via the `deps` seam so these tests never touch
 * real disk. Path keys are computed with the real `path.resolve(cwd, rel)` so
 * the fake matches whatever the expander resolves (Windows/posix agnostic).
 */

import { describe, it, expect, vi } from "vitest";
import path from "path";
import {
  expandFileRefs,
  expandFileRefsAsync,
  findFileRefTokens,
  parseLineRange,
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
  const fds = new Map();
  let nextFd = 100;
  const calls = { readFileSyncBytes: 0, readSyncBytes: 0 };
  return {
    _calls: calls, // test-only instrumentation
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
      const b = fileMap.get(abs);
      calls.readFileSyncBytes += b.length;
      return b;
    },
    openSync(abs) {
      if (!fileMap.has(abs)) {
        const err = new Error(`ENOENT: ${abs}`);
        err.code = "ENOENT";
        throw err;
      }
      const fd = nextFd++;
      fds.set(fd, fileMap.get(abs));
      return fd;
    },
    readSync(fd, buffer, offset, length, position) {
      const src = fds.get(fd);
      const start = position == null ? 0 : position;
      const n = src.copy(
        buffer,
        offset,
        start,
        Math.min(start + length, src.length),
      );
      calls.readSyncBytes += n;
      return n;
    },
    closeSync(fd) {
      fds.delete(fd);
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

  it("does not read the whole file when only the first maxBytes are shown", () => {
    const fs = makeFs({ "big.txt": "x".repeat(50_000) });
    const r = expandFileRefs("read @big.txt", {
      cwd,
      deps: { fs },
      maxBytes: 100,
    });
    expect(r.refs[0].truncated).toBe(true);
    expect(r.refs[0].bytes).toBe(50_000); // full size still reported
    // The plain inline path reads a bounded slice (maxBytes + 1), never slurps
    // the whole 50 KB file into memory.
    expect(fs._calls.readFileSyncBytes).toBe(0);
    expect(fs._calls.readSyncBytes).toBeLessThanOrEqual(101);
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

describe("expandFileRefs — credential/secret file guard", () => {
  it("refuses to inject a .env file — warns, never reads or inlines it", () => {
    const fs = makeFs({ ".env": "API_KEY=supersecret\nDB_PASS=hunter2\n" });
    const r = expandFileRefs("check @.env please", { cwd, deps: { fs } });
    // Not expanded → no <file> block, secret bytes never appear in the prompt.
    expect(r.refs).toEqual([]);
    expect(r.prompt).toBe("check @.env please");
    expect(r.prompt).not.toContain("supersecret");
    expect(r.prompt).not.toContain("hunter2");
    expect(r.warnings.join("\n")).toMatch(/@\.env — refused:.*not injected/);
    // The secret file's bytes were never loaded into memory.
    expect(fs._calls.readFileSyncBytes).toBe(0);
    expect(fs._calls.readSyncBytes).toBe(0);
  });

  it("refuses other secret-classed files (private key ext, SSH key, aws credentials)", () => {
    for (const [token, files] of [
      ["@deploy.key", { "deploy.key": "-----BEGIN PRIVATE KEY-----\n" }],
      ["@secrets/id_rsa", { "secrets/id_rsa": "ssh-rsa-private\n" }],
      ["@.aws/credentials", { ".aws/credentials": "aws_secret=x\n" }],
    ]) {
      const fs = makeFs(files);
      const r = expandFileRefs(`look at ${token}`, { cwd, deps: { fs } });
      expect(r.refs).toEqual([]);
      expect(r.warnings.join("\n")).toMatch(/refused:.*not injected/);
      expect(fs._calls.readFileSyncBytes + fs._calls.readSyncBytes).toBe(0);
    }
  });

  it("still injects an ordinary (non-secret) file next to a refused one", () => {
    const fs = makeFs({
      ".env": "SECRET=1\n",
      "src/app.js": "export const x = 1;\n",
    });
    const r = expandFileRefs("diff @.env vs @src/app.js", {
      cwd,
      deps: { fs },
    });
    expect(r.refs.map((x) => x.rel)).toEqual(["src/app.js"]);
    expect(r.prompt).toContain("export const x = 1;");
    expect(r.prompt).not.toContain("SECRET=1");
  });

  it("honors the CC_CREDENTIAL_GUARD=0 opt-out (injects the secret)", () => {
    const prev = process.env.CC_CREDENTIAL_GUARD;
    process.env.CC_CREDENTIAL_GUARD = "0";
    try {
      const fs = makeFs({ ".env": "API_KEY=visible\n" });
      const r = expandFileRefs("check @.env", { cwd, deps: { fs } });
      expect(r.refs).toHaveLength(1);
      expect(r.prompt).toContain("API_KEY=visible");
    } finally {
      if (prev === undefined) delete process.env.CC_CREDENTIAL_GUARD;
      else process.env.CC_CREDENTIAL_GUARD = prev;
    }
  });
});

describe("expandFileRefs — @folder/ recursive tree", () => {
  it("walks nested directories into an indented tree", () => {
    const r = run(
      "what's in @src",
      { "src/a.js": "1", "src/sub/c.js": "2" },
      { src: ["a.js", "sub/"], "src/sub": ["c.js"] },
    );
    expect(r.refs[0].kind).toBe("dir");
    expect(r.prompt).toContain('<dir path="src"');
    // top-level un-indented, child indented by two spaces under sub/
    expect(r.prompt).toContain("a.js\nsub/\n  c.js");
    expect(r.refs[0].total).toBe(3); // a.js, sub/, c.js
  });

  it("treats @src/ (trailing slash) the same as @src", () => {
    const r = run(
      "look at @src/",
      { "src/a.js": "1" },
      { src: ["a.js", "sub/"], "src/sub": ["c.js"] },
    );
    expect(r.refs[0].kind).toBe("dir");
    expect(r.prompt).toContain('<dir path="src/"');
    expect(r.prompt).toContain("a.js\nsub/\n  c.js");
  });

  it("stops descending at maxDirDepth", () => {
    const r = run(
      "@src",
      {},
      { src: ["a.js", "sub/"], "src/sub": ["c.js"] },
      { maxDirDepth: 1 },
    );
    // depth 1 lists sub/ but never reaches its child c.js
    expect(r.prompt).toContain("a.js\nsub/");
    expect(r.prompt).not.toContain("c.js");
  });

  it("lists but never descends into ignored dirs (node_modules, .git)", () => {
    const r = run(
      "@root",
      { "root/src/a.js": "1", "root/node_modules/lib.js": "x" },
      {
        root: ["node_modules/", "src/", ".git/"],
        "root/node_modules": ["lib.js"],
        "root/src": ["a.js"],
        "root/.git": ["HEAD"],
      },
    );
    expect(r.prompt).toContain("node_modules/  (not expanded)");
    expect(r.prompt).toContain(".git/  (not expanded)");
    expect(r.prompt).toContain("src/\n  a.js");
    // contents of ignored dirs are never pulled in
    expect(r.prompt).not.toContain("lib.js");
    expect(r.prompt).not.toContain("HEAD");
  });

  it("caps the node count and marks the listing truncated", () => {
    const names = Array.from({ length: 10 }, (_, i) => `f${i}.js`);
    const r = run("@big", {}, { big: names }, { maxDirEntries: 4 });
    expect(r.refs[0].truncated).toBe(true);
    expect(r.refs[0].total).toBe(4);
    expect(r.prompt).toContain('truncated="true"');
    expect(r.prompt).toContain("listing capped at 4 entries");
  });
});

describe("parseLineRange", () => {
  it("parses #L5-10, #5-10, #L5, #5", () => {
    expect(parseLineRange("src/x.js#L5-10")).toEqual({
      path: "src/x.js",
      start: 5,
      end: 10,
    });
    expect(parseLineRange("src/x.js#5-10")).toEqual({
      path: "src/x.js",
      start: 5,
      end: 10,
    });
    expect(parseLineRange("a.ts#L7")).toEqual({
      path: "a.ts",
      start: 7,
      end: 7,
    });
    expect(parseLineRange("a.ts#7")).toEqual({
      path: "a.ts",
      start: 7,
      end: 7,
    });
  });

  it("returns null for no range / invalid / non-positive", () => {
    expect(parseLineRange("src/x.js")).toBe(null);
    expect(parseLineRange("notes#section")).toBe(null);
    expect(parseLineRange("a.ts#0")).toBe(null);
  });

  it("normalizes an inverted range to a single line", () => {
    expect(parseLineRange("a.ts#L10-5")).toEqual({
      path: "a.ts",
      start: 10,
      end: 10,
    });
  });
});

describe("expandFileRefs — @file#Lstart-end line ranges", () => {
  const SRC = "L1\nL2\nL3\nL4\nL5\nL6\n";

  it("injects only the requested lines with a lines= attribute", () => {
    const r = run("see @src/x.js#L2-4", { "src/x.js": SRC });
    expect(r.refs).toHaveLength(1);
    expect(r.refs[0]).toMatchObject({
      rel: "src/x.js",
      lineStart: 2,
      lineEnd: 4,
    });
    expect(r.prompt).toContain('<file path="src/x.js" bytes="');
    expect(r.prompt).toContain('lines="2-4"');
    expect(r.prompt).toContain("L2\nL3\nL4");
    expect(r.prompt).not.toContain("L1");
    expect(r.prompt).not.toContain("L5");
    // the @token (with range) stays in the prose
    expect(r.prompt).toContain("see @src/x.js#L2-4");
  });

  it("supports a single line (#L3) and the no-L form (#2-3)", () => {
    const one = run("@src/x.js#L3", { "src/x.js": SRC });
    expect(one.refs[0]).toMatchObject({ lineStart: 3, lineEnd: 3 });
    expect(one.prompt).toContain('lines="3-3"');
    expect(one.prompt).toContain("L3");

    const noL = run("@src/x.js#2-3", { "src/x.js": SRC });
    expect(noL.prompt).toContain('lines="2-3"');
    expect(noL.prompt).toContain("L2\nL3");
  });

  it("clamps a range past EOF to the last line", () => {
    const r = run("@src/x.js#L5-99", { "src/x.js": "a\nb\nc\n" });
    // file has 4 lines (trailing newline → ['a','b','c','']) → clamp to 4
    expect(r.refs[0].lineEnd).toBeLessThanOrEqual(4);
    expect(r.refs[0].lineStart).toBeLessThanOrEqual(r.refs[0].lineEnd);
  });

  it("whole-file and ranged refs to the same path are distinct blocks", () => {
    const r = run("@src/x.js and @src/x.js#L2-2", { "src/x.js": SRC });
    expect(r.refs).toHaveLength(2);
    expect(r.prompt.match(/<file /g)).toHaveLength(2);
  });

  it("warns when the ranged path does not exist", () => {
    const r = run("@nope/missing.ts#L1-2", {});
    expect(r.refs).toEqual([]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain("missing.ts");
  });
});

describe("expandFileRefsAsync — @file.pdf page extraction", () => {
  const runAsync = (prompt, files, deps = {}) =>
    expandFileRefsAsync(prompt, { cwd, deps: { fs: makeFs(files), ...deps } });

  it("extracts a page range via the injected extractor, with a pages= attr", async () => {
    const extractPdfPages = vi.fn(async (_buf, { firstPage, lastPage }) => ({
      text: `pages ${firstPage}-${lastPage} text`,
      truncated: false,
    }));
    const r = await runAsync(
      "read @doc.pdf#2-3",
      { "doc.pdf": "%PDF-1.4" },
      { extractPdfPages },
    );
    expect(extractPdfPages).toHaveBeenCalledTimes(1);
    expect(extractPdfPages.mock.calls[0][1]).toMatchObject({
      firstPage: 2,
      lastPage: 3,
    });
    expect(r.prompt).toContain('<file path="doc.pdf"');
    expect(r.prompt).toContain('type="pdf"');
    expect(r.prompt).toContain('pages="2-3"');
    expect(r.prompt).toContain("pages 2-3 text");
  });

  it("extracts the whole PDF (null range) when no #pages given", async () => {
    const extractPdfPages = vi.fn(async () => ({
      text: "all pages",
      truncated: false,
    }));
    const r = await runAsync(
      "@doc.pdf",
      { "doc.pdf": "%PDF-1.4" },
      { extractPdfPages },
    );
    expect(extractPdfPages.mock.calls[0][1]).toMatchObject({
      firstPage: null,
      lastPage: null,
    });
    expect(r.prompt).toContain("all pages");
    expect(r.prompt).not.toContain("pages="); // no page attr for a whole-file ref
  });

  it("degrades to a note + warning when pdf-parse is missing", async () => {
    const extractPdfPages = async () => {
      const e = new Error("nope");
      e.code = "PDF_LIB_MISSING";
      throw e;
    };
    const r = await runAsync(
      "@doc.pdf#1",
      { "doc.pdf": "%PDF-1.4" },
      { extractPdfPages },
    );
    expect(r.prompt).toContain('type="pdf"');
    expect(r.prompt).toContain("install the optional");
    expect(r.warnings.some((w) => /pdf-parse/.test(w))).toBe(true);
  });

  it("still expands plain text files (non-PDF) like the sync path", async () => {
    const r = await runAsync("@a.js", { "a.js": "const x = 1;" });
    expect(r.prompt).toContain('<file path="a.js"');
    expect(r.prompt).toContain("const x = 1;");
  });

  it("sync expandFileRefs leaves a PDF un-extracted (a note, no page text)", () => {
    const r = run("@doc.pdf", { "doc.pdf": "%PDF-1.4" });
    expect(r.prompt).toContain('type="pdf"');
    expect(r.prompt).toContain("not extracted in this context");
  });
});
