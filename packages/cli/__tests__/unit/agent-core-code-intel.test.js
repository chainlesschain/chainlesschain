import { describe, it, expect, afterAll, beforeAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import {
  executeTool,
  disposeSharedCodeIntel,
  formatToolArgs,
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

// Live path — only when a TS server is actually installed. Skipped otherwise so
// the suite never fails for a missing external toolchain (undeclared-deps gate).
const tsAvailable = probeServers(process.cwd()).some(
  (s) => s.id === "typescript-language-server" && s.available,
);

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
