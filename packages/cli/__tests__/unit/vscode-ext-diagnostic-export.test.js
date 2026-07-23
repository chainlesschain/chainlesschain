import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DIAGNOSTIC_BUNDLE_SCHEMA,
  buildDiagnosticExportArgs,
  validateDiagnosticBundleText,
  temporaryDiagnosticPath,
  exportDiagnosticBundleToPath,
} from "../../../vscode-extension/src/diagnostic-export.js";

function bundle(extra = {}) {
  return JSON.stringify({
    schema: DIAGNOSTIC_BUNDLE_SCHEMA,
    meta: {
      excluded: [
        "source code body",
        "API keys / tokens",
        "cookies",
        "full environment variable values",
        "unpermitted terminal output",
      ],
    },
    ...extra,
  });
}

describe("diagnostic export pure helpers", () => {
  it("is declared in the extension manifest and both locale bundles", () => {
    const ext = (relative) =>
      fileURLToPath(
        new URL("../../../vscode-extension/" + relative, import.meta.url),
      );
    const pkg = JSON.parse(fs.readFileSync(ext("package.json"), "utf8"));
    const en = JSON.parse(fs.readFileSync(ext("package.nls.json"), "utf8"));
    const zh = JSON.parse(
      fs.readFileSync(ext("package.nls.zh-cn.json"), "utf8"),
    );
    expect(
      pkg.contributes.commands.some(
        (command) => command.command === "chainlesschain.ide.exportDiagnostics",
      ),
    ).toBe(true);
    expect(en["cmd.ide.exportDiagnostics.title"]).toBeTruthy();
    expect(zh["cmd.ide.exportDiagnostics.title"]).toBeTruthy();
  });

  it("builds the CLI contract and validates the privacy-bearing schema", () => {
    expect(buildDiagnosticExportArgs("C:\\tmp\\bundle.json")).toEqual([
      "doctor",
      "--export-bundle",
      "C:\\tmp\\bundle.json",
    ]);
    expect(validateDiagnosticBundleText(bundle())).toMatchObject({
      ok: true,
      bundle: { schema: DIAGNOSTIC_BUNDLE_SCHEMA },
    });
    expect(validateDiagnosticBundleText("{}")).toMatchObject({ ok: false });
    expect(
      validateDiagnosticBundleText(
        JSON.stringify({ schema: DIAGNOSTIC_BUNDLE_SCHEMA, meta: {} }),
      ),
    ).toMatchObject({ ok: false });
  });

  it("keeps its private temp beside the target and sanitizes the nonce", () => {
    const target = path.resolve("reports", "support.json");
    const temp = temporaryDiagnosticPath(target, "../unsafe nonce");
    expect(path.dirname(temp)).toBe(path.dirname(target));
    expect(path.basename(temp)).toContain(".support.json.cc-export-");
    expect(path.basename(temp)).not.toContain("..");
    expect(path.basename(temp)).not.toContain(" ");
  });
});

describe("exportDiagnosticBundleToPath", () => {
  it("validates a CLI temp export before replacing the approved target", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-ide-export-"));
    const target = path.join(dir, "support.json");
    fs.writeFileSync(target, "old bundle");
    const calls = [];
    try {
      const result = await exportDiagnosticBundleToPath({
        command: "cc",
        cwd: dir,
        targetPath: target,
        nonce: "ok",
        runCliText: async (request) => {
          calls.push(request);
          fs.writeFileSync(request.args[2], bundle({ connection: {} }));
          return "written";
        },
      });
      expect(result).toEqual({
        ok: true,
        path: target,
        schema: DIAGNOSTIC_BUNDLE_SCHEMA,
      });
      expect(calls[0]).toMatchObject({
        command: "cc",
        args: ["doctor", "--export-bundle", expect.any(String)],
        cwd: dir,
        timeoutMs: 60000,
      });
      expect(JSON.parse(fs.readFileSync(target, "utf8")).schema).toBe(
        DIAGNOSTIC_BUNDLE_SCHEMA,
      );
      expect(
        fs.readdirSync(dir).filter((name) => name.includes(".cc-export-")),
      ).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps an existing target byte-identical when the CLI output is invalid", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-ide-export-bad-"));
    const target = path.join(dir, "support.json");
    fs.writeFileSync(target, "keep me");
    try {
      const result = await exportDiagnosticBundleToPath({
        targetPath: target,
        nonce: "bad",
        runCliText: async (request) => {
          fs.writeFileSync(request.args[2], '{"schema":"wrong"}');
          return "failed";
        },
      });
      expect(result).toMatchObject({ ok: false });
      expect(fs.readFileSync(target, "utf8")).toBe("keep me");
      expect(
        fs.readdirSync(dir).filter((name) => name.includes(".cc-export-")),
      ).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects symlink targets instead of following them", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-ide-export-link-"));
    const real = path.join(dir, "real.json");
    const link = path.join(dir, "support.json");
    fs.writeFileSync(real, "real");
    try {
      try {
        fs.symlinkSync(real, link, "file");
      } catch {
        return;
      }
      const result = await exportDiagnosticBundleToPath({
        targetPath: link,
        runCliText: async () => {
          throw new Error("must not run");
        },
      });
      expect(result).toMatchObject({
        ok: false,
        reason: expect.stringContaining("regular file"),
      });
      expect(fs.readFileSync(real, "utf8")).toBe("real");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
