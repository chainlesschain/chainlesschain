/**
 * Unit tests: src/lib/packer/pkg-config-generator.js
 *
 * Verifies the synthesized package.json shape (assets / scripts / targets /
 * outputPath / compress) and the pack-entry.js bootstrap script.
 *
 * The generator never invokes pkg — it only writes files — so all assertions
 * are filesystem-readable.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generatePkgConfig } from "../../src/lib/packer/pkg-config-generator.js";

describe("generatePkgConfig", () => {
  let cliRoot;
  let tempDir;
  let distDir;
  let templatesDir;

  beforeEach(() => {
    cliRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-cli-"));
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-tmp-"));
    distDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-dist-"));
    templatesDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-tpl-"));

    // Minimal real package.json so the generator can read version
    fs.writeFileSync(
      path.join(cliRoot, "package.json"),
      JSON.stringify({ name: "chainlesschain", version: "0.156.6" }),
    );
    fs.mkdirSync(path.join(cliRoot, "bin"), { recursive: true });
    fs.writeFileSync(
      path.join(cliRoot, "bin", "chainlesschain.js"),
      "// fake bin",
    );
  });

  afterEach(() => {
    for (const d of [cliRoot, tempDir, distDir, templatesDir]) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  });

  function callGenerator(extraOpts = {}) {
    return generatePkgConfig({
      cliRoot,
      tempDir,
      distDir,
      prebuildsDir: null,
      templatesDir,
      targets: ["node20-win-x64"],
      outputPath: path.join(tempDir, "out", "myapp"),
      compress: true,
      ...extraOpts,
    });
  }

  it("creates pkg-config dir, package.json, and pack-entry.js", () => {
    const r = callGenerator();
    expect(fs.existsSync(r.pkgConfigDir)).toBe(true);
    expect(fs.existsSync(r.pkgConfigFile)).toBe(true);
    expect(fs.existsSync(r.entryScript)).toBe(true);
    expect(path.basename(r.pkgConfigFile)).toBe("package.json");
    expect(path.basename(r.entryScript)).toBe("pack-entry.js");
  });

  it("synthesized package.json inherits version from real CLI package", () => {
    const r = callGenerator();
    const synth = JSON.parse(fs.readFileSync(r.pkgConfigFile, "utf-8"));
    expect(synth.name).toBe("chainlesschain-pack");
    expect(synth.version).toBe("0.156.6");
    expect(synth.bin).toBe("pack-entry.js");
  });

  it("includes targets, outputPath, compress in pkg block", () => {
    const r = callGenerator();
    const synth = JSON.parse(fs.readFileSync(r.pkgConfigFile, "utf-8"));
    expect(synth.pkg.targets).toEqual(["node20-win-x64"]);
    expect(synth.pkg.compress).toBe("GZip");
    expect(typeof synth.pkg.outputPath).toBe("string");
  });

  it("compress=false yields None", () => {
    const r = callGenerator({ compress: false });
    const synth = JSON.parse(fs.readFileSync(r.pkgConfigFile, "utf-8"));
    expect(synth.pkg.compress).toBe("None");
  });

  it("assets always include distDir + templatesDir", () => {
    const r = callGenerator();
    const synth = JSON.parse(fs.readFileSync(r.pkgConfigFile, "utf-8"));
    const assetStr = synth.pkg.assets.join("|");
    expect(assetStr).toContain(distDir.replace(/\\/g, "/"));
    expect(assetStr).toContain(templatesDir.replace(/\\/g, "/"));
  });

  it("assets include prebuildsDir when provided", () => {
    const prebuildsDir = path.join(tempDir, "prebuilds");
    fs.mkdirSync(prebuildsDir);
    const r = callGenerator({ prebuildsDir });
    const synth = JSON.parse(fs.readFileSync(r.pkgConfigFile, "utf-8"));
    const assetStr = synth.pkg.assets.join("|");
    expect(assetStr).toContain(prebuildsDir.replace(/\\/g, "/"));
  });

  it("assets exclude prebuildsDir when null", () => {
    const r = callGenerator({ prebuildsDir: null });
    const synth = JSON.parse(fs.readFileSync(r.pkgConfigFile, "utf-8"));
    const assetStr = synth.pkg.assets.join("|");
    expect(assetStr).not.toContain("prebuilds");
  });

  it("scripts glob covers cli src + bin", () => {
    const r = callGenerator();
    const synth = JSON.parse(fs.readFileSync(r.pkgConfigFile, "utf-8"));
    const scripts = synth.pkg.scripts.join("|");
    expect(scripts).toContain("/src/**/*.js");
    expect(scripts).toContain("/bin/**/*.js");
  });

  it("pack-entry.js sets CC_PACK_MODE=1", () => {
    const r = callGenerator();
    const entry = fs.readFileSync(r.entryScript, "utf-8");
    expect(entry).toContain("CC_PACK_MODE");
    expect(entry).toContain("'1'");
  });

  it("pack-entry.js statically imports the real CLI bootstrap (not dynamic)", () => {
    const r = callGenerator();
    const entry = fs.readFileSync(r.entryScript, "utf-8");
    // Must use static imports — pkg's snapshot has no dynamic-import callback.
    expect(entry).toMatch(/import\s+\{\s*ensureUtf8\s*\}\s+from/);
    expect(entry).toMatch(/import\s+\{\s*createProgram\s*\}\s+from/);
    expect(entry).toContain("program.parse(process.argv)");
    expect(entry).not.toMatch(/\bimport\(/);
  });

  it("pack-entry.js defaults to `ui` when no subcommand is given (double-click friendliness)", () => {
    const r = callGenerator();
    const entry = fs.readFileSync(r.entryScript, "utf-8");
    expect(entry).toContain("process.argv.push('ui')");
    expect(entry).toContain("uncaughtException");
  });

  it("pack-entry.js bakes runtime defaults (token/ports/host) and honors env overrides", () => {
    const r = callGenerator({
      runtime: {
        token: "auto",
        bindHost: "0.0.0.0",
        wsPort: 29000,
        uiPort: 29010,
      },
    });
    const entry = fs.readFileSync(r.entryScript, "utf-8");
    // Defaults serialize into the frozen BAKED constant.
    expect(entry).toContain('"tokenMode":"auto"');
    expect(entry).toContain('"host":"0.0.0.0"');
    expect(entry).toContain('"wsPort":"29000"');
    expect(entry).toContain('"uiPort":"29010"');
    // Env-var overrides are honored before the frozen default.
    expect(entry).toContain("CC_PACK_UI_PORT");
    expect(entry).toContain("CC_PACK_WS_PORT");
    expect(entry).toContain("CC_PACK_HOST");
    expect(entry).toContain("CC_PACK_TOKEN");
    // Only inject a flag the user didn't already pass on the command line.
    expect(entry).toContain("_hasFlag('-p', '--port')");
    expect(entry).toContain("_hasFlag('--token')");
    // 'auto' token mode must generate a fresh random token each run.
    expect(entry).toContain("crypto.randomBytes(16)");
  });

  it("pack-entry.js token='' (empty) disables token injection entirely", () => {
    const r = callGenerator({ runtime: { token: "" } });
    const entry = fs.readFileSync(r.entryScript, "utf-8");
    expect(entry).toContain('"tokenMode":""');
    // The literal empty string is falsy, so the `&& BAKED.tokenMode` guard
    // in the entry skips `--token` injection — no-auth mode intentionally.
    expect(entry).toContain("&& BAKED.tokenMode");
  });

  it("pack-entry.js token='<literal>' hardcodes the baked value", () => {
    const r = callGenerator({ runtime: { token: "hunter2" } });
    const entry = fs.readFileSync(r.entryScript, "utf-8");
    expect(entry).toContain('"tokenMode":"hunter2"');
  });
});
