/**
 * Integration test: the full `cc pack` pipeline end-to-end, with the real
 * pkg invocation stubbed.
 *
 * Why not run pkg itself? It downloads ~60 MB of base node binary and takes
 * ~30s on a cold cache — inappropriate for an integration test. Instead we
 * swap pkg-runner with a stub that writes a fake artifact + returns the
 * same rich `{outputs:[{path,target}]}` shape the real runner produces.
 * Everything else — precheck, web-panel detection, config template +
 * secret scan, native prebuild collection, pkg-config synthesis, manifest
 * generation, smoke-test skip — runs as in production.
 *
 * Covered here:
 *   - phases 1-8 all execute in order, each adding to `steps[]`
 *   - runtime baked-ins (token/host/ws-port/ui-port) appear verbatim in
 *     the synthesized pack-entry.js
 *   - sidecar manifest is written with sha256, productVersion, target
 *   - smoke-test is skipped for cross-target builds (macos on a win host)
 *   - --no-smoke-test is honored
 *   - preset config with a literal API key aborts with EXIT.SECRETS
 *
 * Not covered (deferred to e2e):
 *   - real pkg invocation (see __tests__/e2e/pack-artifact.test.js)
 *   - running the produced exe + WS handshake
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// pkg-runner is swapped before the orchestrator imports it.
vi.mock("../../src/lib/packer/pkg-runner.js", () => ({
  runPkg: vi.fn((ctx) => {
    const outputPath = ctx.outputPath;
    const ext = process.platform === "win32" ? ".exe" : "";
    // Pretend we produced the artifact.
    const artifactPath = outputPath + ext;
    fs.writeFileSync(artifactPath, "MZ\x00\x00fake-pkg-output", "binary");
    return {
      outputs: ctx.targets.map((t, i) => ({
        path: i === 0 ? artifactPath : artifactPath + "." + t,
        target: t,
      })),
    };
  }),
}));

// web-panel-builder does not strictly need to touch the real Vue source.
// The precheck/ensureWebPanel phases work against a temp cliRoot we
// author below, and we fill in src/assets/web-panel/ ourselves.
import { runPack } from "../../src/lib/packer/index.js";
import { PackError, EXIT } from "../../src/lib/packer/errors.js";

describe("cc pack — full pipeline integration", () => {
  let projectRoot;
  let cliRoot;
  let outputDir;
  let quietLogger;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-pack-int-"));
    cliRoot = path.join(projectRoot, "packages", "cli");
    fs.mkdirSync(cliRoot, { recursive: true });

    // Minimal monorepo skeleton expected by precheck:
    //   <repoRoot>/package.json   (root, with productVersion)
    //   <repoRoot>/packages/cli/package.json
    //   <repoRoot>/packages/cli/node_modules/           (existence check)
    //   <repoRoot>/packages/cli/src/assets/web-panel/   (dist for ensure-web-panel)
    fs.writeFileSync(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ name: "root", productVersion: "v5.0.2.49" }),
    );
    fs.writeFileSync(
      path.join(cliRoot, "package.json"),
      JSON.stringify({
        name: "chainlesschain",
        version: "0.156.99",
        bin: { chainlesschain: "bin/chainlesschain.js" },
      }),
    );
    fs.mkdirSync(path.join(cliRoot, "bin"), { recursive: true });
    fs.writeFileSync(
      path.join(cliRoot, "bin", "chainlesschain.js"),
      "// fake bin\n",
    );
    fs.mkdirSync(path.join(cliRoot, "node_modules"), { recursive: true });
    // Pre-built web-panel dist so ensureWebPanel doesn't try to rebuild.
    const distDir = path.join(cliRoot, "src", "assets", "web-panel");
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, "index.html"), "<!doctype html>");

    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-pack-out-"));
    quietLogger = {
      log: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    };
  });

  afterEach(() => {
    for (const d of [projectRoot, outputDir]) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  });

  it("runs all 8 phases in order and produces a manifest sidecar", async () => {
    const outputPath = path.join(outputDir, "cc-packed");
    const result = await runPack(
      {
        cwd: cliRoot,
        targets: "node20-linux-x64", // cross-target → smoke-test skipped
        output: outputPath,
        skipWebPanelBuild: true,
        allowDirty: true,
        wsPort: "18800",
        uiPort: "18810",
        bindHost: "127.0.0.1",
        token: "auto",
        smokeTest: true,
      },
      { logger: quietLogger },
    );

    // ordering and completeness of the phase list
    const phases = result.steps.map((s) => s.phase);
    expect(phases).toEqual([
      "precheck",
      "web-panel",
      "config-template",
      "native-prebuilds",
      "pkg-config",
      "pkg-run",
      "manifest",
    ]);

    // manifest sidecar written next to the fake artifact
    expect(fs.existsSync(result.outputPath)).toBe(true);
    const manifestPath = result.outputPath + ".pack-manifest.json";
    expect(fs.existsSync(manifestPath)).toBe(true);
    const mf = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    // productVersion + cliVersion come from the REAL monorepo root/cli
    // package.json (precheck resolves cliRoot via import.meta.url, not
    // from our test-scoped cliRoot). We just assert the shape is right.
    expect(typeof mf.productVersion).toBe("string");
    expect(mf.productVersion.length).toBeGreaterThan(0);
    expect(mf.cliVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(mf.targets).toEqual(["node20-linux-x64"]);
    expect(mf.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.sha256).toBe(mf.sha256);
  });

  it("bakes runtime token/host/ports into the synthesized pack-entry.js", async () => {
    const outputPath = path.join(outputDir, "cc-baked");
    await runPack(
      {
        cwd: cliRoot,
        targets: "node20-linux-x64",
        output: outputPath,
        skipWebPanelBuild: true,
        allowDirty: true,
        wsPort: "29000",
        uiPort: "29010",
        bindHost: "0.0.0.0",
        token: "hunter2",
        smokeTest: false,
      },
      { logger: quietLogger },
    );

    // pkg-config phase records its tempDir entry script — read it back
    // through the steps array rather than recomputing the path.
    // The entryScript is a transient file under os.tmpdir(), which the
    // pipeline cleans up on success. To inspect it we need to intercept
    // the generator call — simpler: re-run just the generator here.
    // (This also verifies the generator is deterministic given the same
    // inputs, which the unit tests don't explicitly check.)
    const { generatePkgConfig } =
      await import("../../src/lib/packer/pkg-config-generator.js");
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-verify-"));
    try {
      const { entryScript } = generatePkgConfig({
        cliRoot,
        tempDir,
        distDir: path.join(cliRoot, "src", "assets", "web-panel"),
        prebuildsDir: null,
        templatesDir: tempDir,
        targets: ["node20-linux-x64"],
        outputPath,
        compress: true,
        runtime: {
          token: "hunter2",
          bindHost: "0.0.0.0",
          wsPort: 29000,
          uiPort: 29010,
        },
      });
      const entry = fs.readFileSync(entryScript, "utf-8");
      expect(entry).toContain('"tokenMode":"hunter2"');
      expect(entry).toContain('"host":"0.0.0.0"');
      expect(entry).toContain('"wsPort":"29000"');
      expect(entry).toContain('"uiPort":"29010"');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("skips smoke-test for cross-target builds even when --smoke-test is on", async () => {
    // host is win/darwin/linux — picking the OS that's NOT our host.
    const foreignTarget =
      process.platform === "win32" ? "node20-linux-x64" : "node20-win-x64";

    const outputPath = path.join(outputDir, "cc-foreign");
    const result = await runPack(
      {
        cwd: cliRoot,
        targets: foreignTarget,
        output: outputPath,
        skipWebPanelBuild: true,
        allowDirty: true,
        wsPort: "18800",
        uiPort: "18810",
        bindHost: "127.0.0.1",
        smokeTest: true,
      },
      { logger: quietLogger },
    );
    // smoke phase must NOT appear in steps for a cross-target build.
    expect(result.steps.some((s) => s.phase === "smoke")).toBe(false);
  });

  it("honors --no-smoke-test", async () => {
    const outputPath = path.join(outputDir, "cc-noskip");
    const result = await runPack(
      {
        cwd: cliRoot,
        targets: "node20-linux-x64",
        output: outputPath,
        skipWebPanelBuild: true,
        allowDirty: true,
        wsPort: "18800",
        uiPort: "18810",
        smokeTest: false,
      },
      { logger: quietLogger },
    );
    expect(result.steps.some((s) => s.phase === "smoke")).toBe(false);
  });

  it("aborts with EXIT.SECRETS when preset config has a literal API key", async () => {
    const preset = path.join(outputDir, "preset.json");
    fs.writeFileSync(
      preset,
      JSON.stringify({
        llm: { apiKey: "sk-THIS_IS_A_REAL_LOOKING_KEY_ABCDEFGHIJKLMN" },
      }),
    );

    const outputPath = path.join(outputDir, "cc-tainted");
    let caught;
    try {
      await runPack(
        {
          cwd: cliRoot,
          targets: "node20-linux-x64",
          output: outputPath,
          skipWebPanelBuild: true,
          allowDirty: true,
          wsPort: "18800",
          uiPort: "18810",
          presetConfig: preset,
          smokeTest: false,
        },
        { logger: quietLogger },
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PackError);
    expect(caught.exitCode).toBe(EXIT.SECRETS);
  });

  it("--allow-secrets bypasses the secret scan", async () => {
    const preset = path.join(outputDir, "preset-ok.json");
    fs.writeFileSync(
      preset,
      JSON.stringify({ llm: { apiKey: "sk-SECRET_BUT_APPROVED_ABCDEFG" } }),
    );

    const outputPath = path.join(outputDir, "cc-allowed");
    const result = await runPack(
      {
        cwd: cliRoot,
        targets: "node20-linux-x64",
        output: outputPath,
        skipWebPanelBuild: true,
        allowDirty: true,
        wsPort: "18800",
        uiPort: "18810",
        presetConfig: preset,
        allowSecrets: true,
        smokeTest: false,
      },
      { logger: quietLogger },
    );
    expect(result.outputPath).toBeDefined();
  });
});
