import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { executeTool } from "../../src/runtime/agent-core.js";
import { hashLine } from "../../src/lib/hashline.js";

const lsp = vi.hoisted(() => ({ probe: vi.fn(() => null) }));
vi.mock("../../src/lib/lsp/lsp-server-registry.js", () => ({
  languageIdForFile: lsp.probe,
  resolveServer: lsp.probe,
}));

describe("file mutation import feedback", () => {
  let root;
  let target;
  let context;
  const broken = 'import { value } from "../../src/value.js";\n';
  const correct = 'import { value } from "../src/value.js";\n';

  beforeEach(() => {
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "cc-import-feedback-")),
    );
    fs.mkdirSync(path.join(root, "pkg", "src"), { recursive: true });
    fs.mkdirSync(path.join(root, "pkg", "tests"));
    fs.writeFileSync(
      path.join(root, "pkg", "src", "value.js"),
      "export const value = 1;\n",
    );
    target = path.join(root, "pkg", "tests", "spec.js");
    // Exact mutation authority is bound to an existing regular-file identity.
    fs.writeFileSync(target, "// authorized output\n");
    context = {
      cwd: root,
      hermeticExecution: true,
      fileMutationScope: {
        exact: true,
        worktreeRoot: root,
        allowedPaths: ["pkg/tests/spec.js"],
      },
    };
    lsp.probe.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("reports a persisted wrong-depth import in a hermetic write without launching LSP", async () => {
    const result = await executeTool(
      "write_file",
      { path: "pkg/tests/spec.js", content: broken },
      context,
    );
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(fs.readFileSync(target, "utf8")).toBe(broken);
    expect(result.newDiagnostics).toEqual([
      expect.objectContaining({
        code: "UNRESOLVED_RELATIVE_IMPORT",
        specifier: "../../src/value.js",
      }),
    ]);
    expect(lsp.probe).not.toHaveBeenCalled();
  });

  it("literal edits inspect the replacement bytes and stop reporting an import after repair", async () => {
    await executeTool(
      "write_file",
      { path: "pkg/tests/spec.js", content: correct },
      context,
    );
    const brokenEdit = await executeTool(
      "edit_file",
      {
        path: "pkg/tests/spec.js",
        old_string: "../src/value.js",
        new_string: "../../src/value.js",
      },
      context,
    );
    expect(brokenEdit.success).toBe(true);
    expect(brokenEdit.newDiagnostics?.[0].code).toBe(
      "UNRESOLVED_RELATIVE_IMPORT",
    );
    const repaired = await executeTool(
      "edit_file",
      {
        path: "pkg/tests/spec.js",
        old_string: "../../src/value.js",
        new_string: "../src/value.js",
      },
      context,
    );
    expect(repaired.success).toBe(true);
    expect(repaired.newDiagnostics).toBeUndefined();
    expect(fs.readFileSync(target, "utf8")).toBe(correct);
    expect(lsp.probe).not.toHaveBeenCalled();
  });

  it("hashed edits also report mistakes from their newly persisted content", async () => {
    await executeTool(
      "write_file",
      { path: "pkg/tests/spec.js", content: correct },
      context,
    );
    const result = await executeTool(
      "edit_file_hashed",
      {
        path: "pkg/tests/spec.js",
        anchor_hash: hashLine(correct.trim()),
        expected_line: correct.trim(),
        new_line: broken.trim(),
      },
      context,
    );
    expect(result.success).toBe(true);
    expect(result.newDiagnostics?.[0].specifier).toBe("../../src/value.js");
    expect(fs.readFileSync(target, "utf8")).toContain(broken.trim());
  });

  it("keeps writes successful when syntax is unsupported and honors diagnostics opt-out", async () => {
    const unsupported = "export const view = <Widget />;\n";
    const first = await executeTool(
      "write_file",
      { path: "pkg/tests/spec.js", content: unsupported },
      context,
    );
    expect(first.success).toBe(true);
    expect(first.newDiagnostics).toBeUndefined();
    vi.stubEnv("CC_EDIT_DIAGNOSTICS", "0");
    const second = await executeTool(
      "write_file",
      { path: "pkg/tests/spec.js", content: broken },
      context,
    );
    expect(second.success).toBe(true);
    expect(second.newDiagnostics).toBeUndefined();
    expect(fs.readFileSync(target, "utf8")).toBe(broken);
    expect(lsp.probe).not.toHaveBeenCalled();
  });

  it("retains the exact mutation boundary when diagnostics are enabled", async () => {
    const forbidden = path.join(root, "pkg", "tests", "other.js");
    const result = await executeTool(
      "write_file",
      { path: "pkg/tests/other.js", content: broken },
      context,
    );
    expect(result.policy).toMatchObject({
      decision: "deny",
      via: "exact-file-mutation-scope",
    });
    expect(fs.existsSync(forbidden)).toBe(false);
    expect(result.newDiagnostics).toBeUndefined();
  });
});
