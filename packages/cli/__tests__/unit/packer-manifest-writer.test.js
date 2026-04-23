/**
 * Unit tests: src/lib/packer/manifest-writer.js
 *
 * The manifest is the only "spec" downstream tooling has for what's inside
 * a pack artifact (CI signature checks, in-app diagnostics). Its schema
 * needs to stay stable, so the tests assert on every field.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { writeManifests } from "../../src/lib/packer/manifest-writer.js";

describe("writeManifests", () => {
  let cliRoot;
  let outDir;
  let artifact;

  beforeEach(() => {
    cliRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-cli-"));
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-out-"));
    fs.writeFileSync(
      path.join(cliRoot, "package.json"),
      JSON.stringify({ name: "chainlesschain", version: "0.156.6" }),
    );

    artifact = path.join(outDir, "myapp.exe");
    fs.writeFileSync(artifact, "fake-binary-content-1234", "utf-8");
  });

  afterEach(() => {
    for (const d of [cliRoot, outDir]) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  });

  function callWriter(extra = {}) {
    return writeManifests({
      outputs: [artifact],
      cliRoot,
      gitCommit: "abc1234",
      gitDirty: false,
      targets: ["node20-win-x64"],
      ports: { ws: 18800, ui: 18810 },
      includeDb: true,
      includeModels: false,
      commands: ["init", "ui", "chat"],
      ...extra,
    });
  }

  it("writes one manifest per output", () => {
    const r = callWriter();
    expect(r.length).toBe(1);
    expect(fs.existsSync(r[0].manifestPath)).toBe(true);
    expect(r[0].manifestPath).toBe(artifact + ".pack-manifest.json");
  });

  it("manifest schema is 1", () => {
    const r = callWriter();
    const m = JSON.parse(fs.readFileSync(r[0].manifestPath, "utf-8"));
    expect(m.schema).toBe(1);
  });

  it("manifest includes cliVersion and nodeVersion", () => {
    const r = callWriter();
    const m = JSON.parse(fs.readFileSync(r[0].manifestPath, "utf-8"));
    expect(m.cliVersion).toBe("0.156.6");
    expect(m.nodeVersion).toBe(process.version);
  });

  it("manifest preserves git metadata", () => {
    const r = callWriter({ gitCommit: "deadbeef", gitDirty: true });
    const m = JSON.parse(fs.readFileSync(r[0].manifestPath, "utf-8"));
    expect(m.gitCommit).toBe("deadbeef");
    expect(m.gitDirty).toBe(true);
  });

  it("manifest sha256 matches the artifact bytes", () => {
    const r = callWriter();
    const m = JSON.parse(fs.readFileSync(r[0].manifestPath, "utf-8"));
    const expected = crypto
      .createHash("sha256")
      .update(fs.readFileSync(artifact))
      .digest("hex");
    expect(m.sha256).toBe(expected);
    expect(r[0].sha256).toBe(expected);
  });

  it("manifest preserves ports and feature flags", () => {
    const r = callWriter();
    const m = JSON.parse(fs.readFileSync(r[0].manifestPath, "utf-8"));
    expect(m.ports).toEqual({ ws: 18800, ui: 18810 });
    expect(m.includeDb).toBe(true);
    expect(m.includeModels).toBe(false);
    expect(m.signed).toBe(false);
  });

  it("manifest commands list reflects input", () => {
    const r = callWriter({ commands: ["a", "b"] });
    const m = JSON.parse(fs.readFileSync(r[0].manifestPath, "utf-8"));
    expect(m.commands).toEqual(["a", "b"]);
  });

  it("buildTime is a valid ISO timestamp", () => {
    const r = callWriter();
    const m = JSON.parse(fs.readFileSync(r[0].manifestPath, "utf-8"));
    expect(() => new Date(m.buildTime).toISOString()).not.toThrow();
  });

  it("handles multiple outputs", () => {
    const second = path.join(outDir, "myapp-mac.bin");
    fs.writeFileSync(second, "second-fake-binary", "utf-8");
    const r = writeManifests({
      outputs: [artifact, second],
      cliRoot,
      gitCommit: null,
      gitDirty: false,
      targets: ["node20-win-x64", "node20-macos-x64"],
      ports: { ws: 1, ui: 2 },
      includeDb: false,
      includeModels: false,
      commands: [],
    });
    expect(r.length).toBe(2);
    expect(r[0].sha256).not.toBe(r[1].sha256);
  });
});
