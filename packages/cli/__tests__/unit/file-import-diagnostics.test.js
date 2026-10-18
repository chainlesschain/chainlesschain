import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectFileImportDiagnostics,
  FILE_IMPORT_LIMITS,
} from "../../src/lib/file-import-diagnostics.js";

describe("post-write relative import diagnostics", () => {
  let temporaryRoot;
  let workspaceRoot;

  function write(relative, content = "export const value = 1;") {
    const file = path.join(workspaceRoot, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    return file;
  }

  function check(content, relative = "packages/tool/__tests__/verify.test.js") {
    const filePath = write(relative, content);
    return collectFileImportDiagnostics({ filePath, content, workspaceRoot });
  }

  beforeEach(() => {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "import-feedback-"));
    workspaceRoot = path.join(temporaryRoot, "workspace");
    fs.mkdirSync(workspaceRoot);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  });

  it.each([
    ["scheduler", "import { value } from '../../src/lib/scheduler.js';"],
    ["sessions", "const { value } = require('../../src/lib/sessions.js');"],
    ["policy", "const value = await import('../../src/lib/policy.js');"],
  ])(
    "detects a copied unit-test path from a shallower verification file: %s",
    (name, content) => {
      write(`packages/tool/src/lib/${name}.js`);
      // The example works at its original depth.
      expect(
        check(content, `packages/tool/__tests__/unit/${name}.test.js`),
      ).toMatchObject({ checkedReferences: 1, diagnostics: [] });
      const result = check(
        content,
        `packages/tool/__tests__/verify-${name}.test.js`,
      );
      expect(result.status).toBe("checked");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]).toMatchObject({
        source: "relative-import",
        code: "UNRESOLVED_RELATIVE_IMPORT",
        severity: "error",
        specifier: `../../src/lib/${name}.js`,
        line: 1,
      });
      expect(check(content.replace("../../src", "../src"))).toMatchObject({
        checkedReferences: 1,
        diagnostics: [],
      });
    },
  );

  it("checks static import/export, dynamic literal import, and CommonJS paths", () => {
    write("packages/tool/src/esm.mjs");
    write("packages/tool/src/common.cjs", "module.exports = 1;");
    const result = check(
      [
        "import '../src/esm.mjs';",
        "export { value } from '../src/esm.mjs';",
        "export * from '../src/absent.js';",
        "const common = require('../src/common.cjs');",
        "const module = import('../src/missing.mjs');",
      ].join("\n"),
    );
    expect(result.checkedReferences).toBe(5);
    expect(
      result.diagnostics.map(({ line, specifier }) => [line, specifier]),
    ).toEqual([
      [3, "../src/absent.js"],
      [5, "../src/missing.mjs"],
    ]);
  });

  it("ignores import-like text in comments, strings, templates, and regex fixtures", () => {
    const content = [
      "// import './comment.js';",
      "/* require('./block.js'); */",
      String.raw`const fixture = "import './string.js'; require('./string.cjs')";`,
      "const template = `export * from './template.mjs'; ${'import(\"./nested.js\")'}`;",
      String.raw`const pattern = /require\(['"]\.\/regex.js['"]\)/;`,
      String.raw`if (true) /import\(['"]\.\/after-if.js['"]\)/.test(fixture);`,
      "const ratio = 8 / 2;",
    ].join("\n");
    expect(check(content)).toMatchObject({
      status: "checked",
      checkedReferences: 0,
      diagnostics: [],
    });
  });

  it("checks actual expressions inside template interpolation", () => {
    const result = check("const text = `fixture ${import('./actual.js')}`;");
    expect(result.diagnostics.map((item) => item.specifier)).toEqual([
      "./actual.js",
    ]);
  });

  it("skips package, alias, extensionless, encoded, URL, and dynamic references", () => {
    const content = [
      "import 'vitest';",
      "import '@app/absent.js';",
      "import '../src/extensionless';",
      "import '../src/file.ts';",
      "import '../src/file.js?raw';",
      "import '../src/%2e%2e/secret.js';",
      "import 'file:///secret.js';",
      "import(name);",
      "import(`../src/${name}.js`);",
      "import('../src/' + name + '.js');",
      "require.resolve('./resolve-only.js');",
      "object.require('./object-method.js');",
    ].join("\n");
    expect(check(content)).toMatchObject({
      status: "checked",
      checkedReferences: 0,
      diagnostics: [],
    });
  });

  it.each([
    "function fixture(require) { require('./custom.js'); }",
    "const require = (text) => text; require('./custom.js');",
    "require = customLoader; require('./custom.js');",
    "eval('var require = customLoader'); require('./custom.js');",
  ])("avoids assuming a shadowed require is a module loader: %s", (content) => {
    const result = check(content);
    expect(result.diagnostics).toEqual([]);
    expect(result.uncheckedReferences).toEqual([
      expect.objectContaining({ reason: "uncertain-require" }),
    ]);
  });

  it("supports CommonJS top-level return without executing source or dependencies", () => {
    const marker = path.join(workspaceRoot, "executed");
    write(
      "dependency.cjs",
      `require('fs').writeFileSync(${JSON.stringify(marker)}, 'bad');`,
    );
    const content =
      "require('./dependency.cjs'); return; throw new Error('never run');";
    const filePath = write("main.cjs", content);
    const read = vi.spyOn(fs, "readFileSync");
    expect(
      collectFileImportDiagnostics({ filePath, content, workspaceRoot }),
    ).toMatchObject({
      status: "checked",
      checkedReferences: 1,
      diagnostics: [],
    });
    expect(read).not.toHaveBeenCalled();
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("reports a directory with a JavaScript suffix as unresolved", () => {
    fs.mkdirSync(path.join(workspaceRoot, "directory.js"));
    expect(
      check("import './directory.js';", "main.js").diagnostics,
    ).toHaveLength(1);
  });

  it("does not report CommonJS directory or extension fallbacks as missing", () => {
    write("directory.js/index.js", "module.exports = 1;");
    write("fallback.js.json", "{}");
    const result = check(
      "require('./directory.js'); require('./fallback.js');",
      "main.cjs",
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.uncheckedReferences.map((item) => item.reason)).toEqual([
      "commonjs-resolution",
      "commonjs-resolution",
    ]);
  });

  it("rejects symlinks at the exact target, including links back into the workspace", () => {
    const actual = path.join(workspaceRoot, "actual");
    fs.mkdirSync(actual);
    const linked = path.join(workspaceRoot, "linked.js");
    fs.symlinkSync(
      actual,
      linked,
      process.platform === "win32" ? "junction" : "dir",
    );
    const result = check("import './linked.js';", "main.js");
    expect(result.diagnostics).toEqual([]);
    expect(result.uncheckedReferences[0]).toMatchObject({
      reason: "symbolic-link",
    });
  });

  it("does not inspect escaped targets, whether they exist or not", () => {
    fs.writeFileSync(path.join(temporaryRoot, "secret.js"), "secret");
    const content = "import '../secret.js'; import '../absent.js';";
    const filePath = write("main.js", content);
    const lstat = vi.spyOn(fs, "lstatSync");
    const result = collectFileImportDiagnostics({
      filePath,
      content,
      workspaceRoot,
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.uncheckedReferences.map((item) => item.reason)).toEqual([
      "outside-workspace",
      "outside-workspace",
    ]);
    expect(
      lstat.mock.calls.every(
        ([file]) =>
          file === workspaceRoot || file.startsWith(workspaceRoot + path.sep),
      ),
    ).toBe(true);
  });

  it("does not inspect a source outside the authorized workspace", () => {
    const lstat = vi.spyOn(fs, "lstatSync");
    const result = collectFileImportDiagnostics({
      filePath: path.join(temporaryRoot, "outside.js"),
      workspaceRoot,
      content: "import './secret.js';",
    });
    expect(result).toMatchObject({
      status: "skipped",
      reason: "outside-workspace",
    });
    expect(lstat).not.toHaveBeenCalled();
  });

  it("rejects directory symlinks before inspecting their external children", () => {
    const outside = path.join(temporaryRoot, "outside");
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "secret.js"), "secret");
    const link = path.join(workspaceRoot, "linked");
    fs.symlinkSync(
      outside,
      link,
      process.platform === "win32" ? "junction" : "dir",
    );
    const content = "import './linked/secret.js'; import './linked/absent.js';";
    const filePath = write("main.js", content);
    const lstat = vi.spyOn(fs, "lstatSync");
    const result = collectFileImportDiagnostics({
      filePath,
      content,
      workspaceRoot,
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.uncheckedReferences.map((item) => item.reason)).toEqual([
      "symbolic-link",
      "symbolic-link",
    ]);
    expect(
      lstat.mock.calls.some(([file]) => file.startsWith(link + path.sep)),
    ).toBe(false);
  });

  it("rejects a symlinked source directory and a symlinked workspace root", () => {
    const actual = path.join(temporaryRoot, "actual");
    fs.mkdirSync(actual);
    fs.writeFileSync(path.join(actual, "main.js"), "import './secret.js';");
    const linked = path.join(workspaceRoot, "linked");
    fs.symlinkSync(
      actual,
      linked,
      process.platform === "win32" ? "junction" : "dir",
    );
    for (const root of [workspaceRoot, linked]) {
      expect(
        collectFileImportDiagnostics({
          filePath: path.join(linked, "main.js"),
          workspaceRoot: root,
          content: "import './secret.js';",
        }),
      ).toMatchObject({ status: "skipped", reason: "symbolic-link" });
    }
  });

  it("turns permission failures into unchecked feedback without disclosing errors", () => {
    const content = "import './blocked/secret.js';";
    const filePath = write("main.js", content);
    const original = fs.lstatSync;
    vi.spyOn(fs, "lstatSync").mockImplementation((file, ...args) => {
      if (file === path.join(workspaceRoot, "blocked")) {
        throw Object.assign(new Error("outside private details"), {
          code: "EACCES",
        });
      }
      return original(file, ...args);
    });
    const result = collectFileImportDiagnostics({
      filePath,
      content,
      workspaceRoot,
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.uncheckedReferences[0].reason).toBe("unavailable");
    expect(JSON.stringify(result)).not.toContain("private details");
  });

  it("caps bytes before parsing or inspecting the filesystem", () => {
    const lstat = vi.spyOn(fs, "lstatSync");
    const result = collectFileImportDiagnostics({
      filePath: path.join(workspaceRoot, "main.js"),
      workspaceRoot,
      content: "//" + "中".repeat(FILE_IMPORT_LIMITS.contentBytes / 2),
    });
    expect(result).toMatchObject({
      status: "skipped",
      reason: "content-limit",
    });
    expect(lstat).not.toHaveBeenCalled();
  });

  it("caps checked references and feedback, and explicitly reports truncation", () => {
    const content = Array.from(
      { length: FILE_IMPORT_LIMITS.references + 5 },
      (_, index) => `import './absent-${index}.js';`,
    ).join("\n");
    const result = check(content, "main.js");
    expect(result.truncated).toBe(true);
    expect(result.checkedReferences).toBe(FILE_IMPORT_LIMITS.references);
    expect(result.diagnostics).toHaveLength(FILE_IMPORT_LIMITS.references);
  });

  it("caps long specifier feedback without filesystem probes for that target", () => {
    const specifier =
      "./" + "a".repeat(FILE_IMPORT_LIMITS.specifierChars) + ".js";
    const result = check(`import '${specifier}';`, "main.js");
    expect(result.checkedReferences).toBe(0);
    expect(result.uncheckedReferences[0]).toMatchObject({
      reason: "specifier-limit",
    });
    expect(result.uncheckedReferences[0].specifier.length).toBe(
      FILE_IMPORT_LIMITS.specifierChars,
    );
  });

  it.each([
    ["main.ts", "import type { X } from './missing.js';", "unsupported-file"],
    [
      "main.js",
      "const view = <div/>; import './missing.js';",
      "unsupported-syntax",
    ],
    ["main.js", "import { from './missing.js';", "unsupported-syntax"],
    ["main.mjs", "return; import './missing.js';", "unsupported-syntax"],
  ])("skips unsupported or malformed input: %s", (file, content, reason) => {
    expect(check(content, file)).toMatchObject({
      status: "skipped",
      reason,
      diagnostics: [],
    });
  });

  it("does not throw on invalid input or unexpected filesystem failures", () => {
    for (const input of [undefined, null, {}, { content: 42 }]) {
      expect(collectFileImportDiagnostics(input)).toMatchObject({
        status: "skipped",
      });
    }
    const filePath = write("main.js");
    vi.spyOn(fs, "lstatSync").mockImplementation(() => {
      throw new Error("failure");
    });
    expect(
      collectFileImportDiagnostics({ filePath, content: "", workspaceRoot }),
    ).toMatchObject({
      status: "skipped",
      reason: "unavailable",
      diagnostics: [],
    });
  });
});
