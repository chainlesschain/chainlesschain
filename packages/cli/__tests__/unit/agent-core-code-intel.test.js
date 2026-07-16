import { describe, it, expect, afterAll, beforeAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import {
  executeTool,
  disposeSharedCodeIntel,
  formatToolArgs,
  _getSharedCodeIntel,
} from "../../src/runtime/agent-core.js";
import { probeServers } from "../../src/lib/lsp/lsp-server-registry.js";

// The `code_intelligence` agent tool wraps the LSP layer. These tests assert the
// behavior that is deterministic WITHOUT any language server installed: argument
// validation and graceful degradation. A skip-guarded live test exercises the
// real path only when a TypeScript server happens to be on the machine.

describe("code_intelligence tool — argument validation", () => {
  afterAll(async () => {
    await disposeSharedCodeIntel();
  });

  it("requires file for position actions", async () => {
    const res = await executeTool("code_intelligence", {
      action: "definition",
    });
    expect(res.error).toMatch(/requires "file"/);
  });

  it("requires line and col for definition/references/hover/rename_preview", async () => {
    const res = await executeTool("code_intelligence", {
      action: "references",
      file: "src/index.js",
    });
    expect(res.error).toMatch(/requires 1-based "line" and "col"/);
  });

  it("requires query for workspace_symbols", async () => {
    const res = await executeTool("code_intelligence", {
      action: "workspace_symbols",
    });
    expect(res.error).toMatch(/requires "query"/);
  });

  it("requires new_name for rename_preview", async () => {
    const res = await executeTool("code_intelligence", {
      action: "rename_preview",
      file: "src/index.js",
      line: 1,
      col: 1,
    });
    expect(res.error).toMatch(/requires "new_name"/);
  });

  it("rejects an unknown action", async () => {
    const res = await executeTool("code_intelligence", {
      action: "teleport",
      file: "src/index.js",
      line: 1,
      col: 1,
    });
    expect(res.error).toMatch(/Unknown code_intelligence action/);
  });
});

describe("code_intelligence tool — graceful degradation", () => {
  let tmpDir;
  let tmpFile;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-ci-"));
    tmpFile = path.join(tmpDir, "sample.rkt"); // extension with no language server
    fs.writeFileSync(tmpFile, "let x = 1\n", "utf8");
  });

  afterAll(async () => {
    await disposeSharedCodeIntel();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it("degrades to unavailable for an unsupported file type instead of throwing", async () => {
    const res = await executeTool(
      "code_intelligence",
      { action: "document_symbols", file: tmpFile },
      { cwd: tmpDir },
    );
    expect(res.unavailable).toBe(true);
    expect(typeof res.reason).toBe("string");
    expect(res.hint).toMatch(/search_files/);
  });
});

// The shared LSP pool must be race-safe: the parallel read-only batch fires
// several `code_intelligence` calls concurrently, and each resolves through
// _getSharedCodeIntel. A check-then-act across the `await import` would let two
// concurrent callers each construct a CodeIntelligence (double-spawning a
// language server + leaking one) — the exact trap the pool exists to prevent.
describe("shared code-intelligence pool — concurrency", () => {
  afterAll(async () => {
    await disposeSharedCodeIntel();
  });

  it("concurrent callers share ONE pooled instance (no double-spawn race)", async () => {
    await disposeSharedCodeIntel(); // start from an empty pool
    const cwd = process.cwd();
    // Both calls observe the empty pool before either sets it, so they exercise
    // the post-await window. With the fix they must resolve to the SAME instance.
    const [a, b, c] = await Promise.all([
      _getSharedCodeIntel(cwd),
      _getSharedCodeIntel(cwd),
      _getSharedCodeIntel(cwd),
    ]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    await disposeSharedCodeIntel();
  });
});

describe("code_intelligence tool — display formatting", () => {
  it("formats a position query", () => {
    expect(
      formatToolArgs("code_intelligence", {
        action: "definition",
        file: "a.ts",
        line: 3,
        col: 5,
      }),
    ).toBe("definition a.ts:3:5");
  });

  it("formats a workspace symbol query", () => {
    expect(
      formatToolArgs("code_intelligence", {
        action: "workspace_symbols",
        query: "MyClass",
      }),
    ).toBe("workspace_symbols MyClass");
  });
});

// Post-edit diagnostics are best-effort and only fire when a language server is
// installed. On a machine WITHOUT one (CI default), the edit result must be
// unchanged — no newDiagnostics field, no crash, no hang.
describe("post-edit diagnostics — zero cost without a language server", () => {
  let tmpDir;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-edit-"));
  });

  afterAll(async () => {
    await disposeSharedCodeIntel();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it("write_file to an unsupported file type never attaches newDiagnostics", async () => {
    const file = path.join(tmpDir, "notes.txt");
    const res = await executeTool(
      "write_file",
      { path: file, content: "hello\n" },
      { cwd: tmpDir },
    );
    expect(res.success).toBe(true);
    expect(res.newDiagnostics).toBeUndefined();
  });

  it("edit_file returns quickly and unchanged when no server is available", async () => {
    const file = path.join(tmpDir, "sample.ts");
    fs.writeFileSync(file, "const x = 1;\n", "utf8");
    const started = Date.now();
    const res = await executeTool(
      "edit_file",
      { path: file, old_string: "const x = 1;", new_string: "const x = 2;" },
      { cwd: tmpDir },
    );
    expect(res.success).toBe(true);
    expect(res.replaced).toBe(1);
    // No server installed → helper short-circuits without cold-starting anything.
    expect(res.newDiagnostics).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(4000);
  });

  it("respects CC_EDIT_DIAGNOSTICS=0", async () => {
    const prev = process.env.CC_EDIT_DIAGNOSTICS;
    process.env.CC_EDIT_DIAGNOSTICS = "0";
    try {
      const file = path.join(tmpDir, "disabled.ts");
      fs.writeFileSync(file, "const y = 1;\n", "utf8");
      const res = await executeTool(
        "edit_file",
        { path: file, old_string: "const y = 1;", new_string: "const y = 3;" },
        { cwd: tmpDir },
      );
      expect(res.success).toBe(true);
      expect(res.newDiagnostics).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.CC_EDIT_DIAGNOSTICS;
      else process.env.CC_EDIT_DIAGNOSTICS = prev;
    }
  });
});

// Live path — only when a TS server is actually installed. Skipped otherwise so
// the suite never fails for a missing external toolchain (undeclared-deps gate).
const tsAvailable = probeServers(process.cwd()).some(
  (s) => s.id === "typescript-language-server" && s.available,
);

describe.skipIf(!tsAvailable)("post-edit diagnostics — live TS server", () => {
  let tmpDir;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-edit-live-"));
    fs.writeFileSync(
      path.join(tmpDir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true } }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(tmpDir, "m.ts"),
      "export function add(a: number, b: number): number {\n  return a + b;\n}\n",
      "utf8",
    );
  });

  afterAll(async () => {
    await disposeSharedCodeIntel();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it("attaches newDiagnostics when an edit introduces a type error", async () => {
    const res = await executeTool(
      "edit_file",
      {
        path: path.join(tmpDir, "m.ts"),
        old_string: "return a + b;",
        new_string: "return a + b + c;",
      },
      { cwd: tmpDir },
    );
    expect(res.success).toBe(true);
    expect(Array.isArray(res.newDiagnostics)).toBe(true);
    expect(res.newDiagnostics.some((d) => d.severity === "error")).toBe(true);
  });
});

describe.skipIf(!tsAvailable)("code_intelligence tool — live TS server", () => {
  afterAll(async () => {
    await disposeSharedCodeIntel();
  });

  it("returns document symbols for this file without throwing", async () => {
    const res = await executeTool(
      "code_intelligence",
      { action: "document_symbols", file: "src/index.js" },
      { cwd: process.cwd() },
    );
    // Either the server answered (available) or it genuinely could not — but
    // never a thrown error.
    expect(res.error).toBeUndefined();
    expect(res.available === true || res.unavailable === true).toBe(true);
  });
});

describe("shared code-intelligence pool — restart backoff default", () => {
  afterAll(async () => {
    await disposeSharedCodeIntel();
    delete process.env.CC_LSP_RESTART_BACKOFF_MS;
  });

  it("constructs the pooled manager with backoff ON by default (1s base)", async () => {
    delete process.env.CC_LSP_RESTART_BACKOFF_MS;
    await disposeSharedCodeIntel(); // fresh pool so the env is honored
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-ci-backoff-"));
    try {
      const ci = await _getSharedCodeIntel(dir);
      expect(ci.manager.restartBackoffBaseMs).toBe(1000);
      // Exponential schedule is live: 1s → 2s → 4s → 8s (capped).
      expect(ci.manager._restartBackoffMs(1)).toBe(1000);
      expect(ci.manager._restartBackoffMs(2)).toBe(2000);
      expect(ci.manager._restartBackoffMs(4)).toBe(8000);
    } finally {
      await disposeSharedCodeIntel();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("CC_LSP_RESTART_BACKOFF_MS=0 restores immediate respawn (legacy)", async () => {
    process.env.CC_LSP_RESTART_BACKOFF_MS = "0";
    await disposeSharedCodeIntel();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-ci-backoff0-"));
    try {
      const ci = await _getSharedCodeIntel(dir);
      expect(ci.manager.restartBackoffBaseMs).toBe(0);
      expect(ci.manager._restartBackoffMs(3)).toBe(0);
    } finally {
      delete process.env.CC_LSP_RESTART_BACKOFF_MS;
      await disposeSharedCodeIntel();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("code_intelligence tool — multi-root workspace", () => {
  afterAll(async () => {
    await disposeSharedCodeIntel();
  });

  it("keys the server pool on the root containing the file (--add-dir root)", async () => {
    const rootA = fs.mkdtempSync(path.join(os.tmpdir(), "cc-ci-rootA-"));
    const rootB = fs.mkdtempSync(path.join(os.tmpdir(), "cc-ci-rootB-"));
    try {
      // An unsupported file type inside rootB degrades gracefully, but the
      // pool must have been keyed on rootB (the containing root), not rootA.
      const target = path.join(rootB, "notes.xyz");
      fs.writeFileSync(target, "hello", "utf-8");
      const res = await executeTool(
        "code_intelligence",
        { action: "document_symbols", file: target },
        { cwd: rootA, additionalDirectories: [rootB] },
      );
      expect(res.unavailable).toBe(true); // no server for .xyz — degradation path
      const pooledB = await _getSharedCodeIntel(rootB);
      expect(pooledB.manager.projectRoot).toBe(path.resolve(rootB));
      // rootA's ci (created by the fallback below) differs from rootB's.
      const pooledA = await _getSharedCodeIntel(rootA);
      expect(pooledA).not.toBe(pooledB);
    } finally {
      await disposeSharedCodeIntel();
      fs.rmSync(rootA, { recursive: true, force: true });
      fs.rmSync(rootB, { recursive: true, force: true });
    }
  });
});
