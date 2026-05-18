/**
 * Integration test: src/lib/packer/index.js – dry-run mode end-to-end
 *
 * Exercises phases 1-5 of the pipeline against the real CLI workspace,
 * stops before pkg invocation. Validates that a full build plan (steps[])
 * is returned and the synthesized pkg config is structurally sound.
 *
 * Native prebuild collection is best-effort in dry-run (see orchestrator),
 * so the test passes whether or not better-sqlite3 is present locally.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { runPack } from "../../src/lib/packer/index.js";

describe("runPack – dry-run end-to-end", () => {
  it("completes phases 1-5 and stops before pkg invocation", async () => {
    const silent = { log: () => {}, info: () => {}, error: () => {} };
    const result = await runPack(
      {
        dryRun: true,
        targets: "node20-win-x64",
        wsPort: "18800",
        uiPort: "18810",
        bindHost: "127.0.0.1",
        compress: true,
        skipWebPanelBuild: true,
        allowDirty: true,
        project: false,
      },
      { logger: silent },
    );

    expect(result.dryRun).toBe(true);
    expect(Array.isArray(result.steps)).toBe(true);

    // Phases 1, 2, 3, 4, 5 should have run; 6 (pkg-run) and 7 (manifest) skipped.
    const phases = result.steps.map((s) => s.phase);
    expect(phases).toContain("precheck");
    expect(phases).toContain("web-panel");
    expect(phases).toContain("config-template");
    expect(phases).toContain("native-prebuilds");
    expect(phases).toContain("pkg-config");
    expect(phases).not.toContain("pkg-run");
    expect(phases).not.toContain("manifest");

    // outputPath/sha256 are not set in dry-run
    expect(result.outputPath).toBeUndefined();
    expect(result.sha256).toBeUndefined();
  }, 30_000);

  it("synthesized pkg config is valid JSON with expected pkg key", async () => {
    const silent = { log: () => {}, info: () => {}, error: () => {} };
    const result = await runPack(
      {
        dryRun: true,
        targets: "node20-win-x64",
        wsPort: "18800",
        uiPort: "18810",
        bindHost: "127.0.0.1",
        compress: true,
        skipWebPanelBuild: true,
        allowDirty: true,
        project: false,
      },
      { logger: silent },
    );

    const pkgConfigStep = result.steps.find((s) => s.phase === "pkg-config");
    expect(pkgConfigStep).toBeDefined();
    expect(fs.existsSync(pkgConfigStep.pkgConfigFile)).toBe(true);
    const synth = JSON.parse(
      fs.readFileSync(pkgConfigStep.pkgConfigFile, "utf-8"),
    );
    expect(synth.name).toBe("chainlesschain-pack");
    expect(synth.pkg).toBeDefined();
    expect(Array.isArray(synth.pkg.assets)).toBe(true);
    expect(Array.isArray(synth.pkg.scripts)).toBe(true);
    expect(synth.pkg.targets).toEqual(["node20-win-x64"]);

    // pack-entry.js exists and contains the pack-mode flip
    expect(fs.existsSync(pkgConfigStep.entryScript)).toBe(true);
    const entry = fs.readFileSync(pkgConfigStep.entryScript, "utf-8");
    expect(entry).toContain("CC_PACK_MODE");
  }, 30_000);

  it("propagates PackError exit codes for bad input", async () => {
    const silent = { log: () => {}, info: () => {}, error: () => {} };
    await expect(
      runPack(
        {
          dryRun: true,
          targets: "node20-win-x64",
          wsPort: "18800",
          uiPort: "18810",
          bindHost: "127.0.0.1",
          presetConfig: "/nonexistent/preset.json",
          allowDirty: true,
          skipWebPanelBuild: true,
          project: false,
        },
        { logger: silent },
      ),
    ).rejects.toThrow(/preset-config file not found|not found/);
  }, 30_000);
});
