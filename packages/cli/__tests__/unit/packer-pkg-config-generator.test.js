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

  it("pack-entry.js imports the real CLI bin", () => {
    const r = callGenerator();
    const entry = fs.readFileSync(r.entryScript, "utf-8");
    expect(entry).toContain("chainlesschain.js");
  });
});
