/**
 * `cc pack` orchestrator. Runs the 7-phase pipeline:
 *   1. precheck            — git/node_modules sanity
 *   2. ensureWebPanel      — Vue panel built or buildable
 *   3. buildConfigTemplate — config.example.json with secret scan
 *   4. collectPrebuilds    — better-sqlite3 .node files per target
 *   5. generatePkgConfig   — synthesized package.json + pack-entry.js
 *   6. runPkg              — invoke @yao-pkg/pkg
 *   7. writeManifests      — sidecar metadata + SHA-256
 *
 * --dry-run stops after phase 5 and reports the build plan without
 * invoking pkg or writing the artifact.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import { precheck } from "./precheck.js";
import { ensureWebPanel } from "./web-panel-builder.js";
import {
  buildConfigTemplate,
  writeTemplate,
} from "./config-template-builder.js";
import { collectPrebuilds } from "./native-prebuild-collector.js";
import { generatePkgConfig } from "./pkg-config-generator.js";
import { runPkg } from "./pkg-runner.js";
import { writeManifests } from "./manifest-writer.js";
import { PackError } from "./errors.js";

/**
 * Public entry — invoked from packages/cli/src/commands/pack.js.
 *
 * @param {object} cliOpts                   raw Commander option object
 * @param {object} [deps]
 * @param {object} [deps.logger]             logger.log/info/error
 * @returns {Promise<{outputPath?:string, sha256?:string, steps:Array}>}
 */
export async function runPack(cliOpts, deps = {}) {
  const logger = deps.logger || console;
  const log = (msg) => {
    if (typeof logger.log === "function") logger.log(msg);
    else if (typeof logger.info === "function") logger.info(msg);
  };

  const projectRoot = path.resolve(cliOpts.cwd || process.cwd());
  const targets = (cliOpts.targets || "node20-win-x64")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  log(
    chalk.bold("\n  cc pack — bundling project into standalone executable\n"),
  );
  log(`  Project root : ${projectRoot}`);
  log(`  Targets      : ${targets.join(", ")}`);
  log(`  Dry-run      : ${cliOpts.dryRun ? "YES" : "no"}`);
  log("");

  const steps = [];

  // ── Phase 1 ────────────────────────────────────────────────────────────
  log(chalk.cyan("  [1/7] Precheck"));
  const pre = precheck({
    projectRoot,
    allowDirty: Boolean(cliOpts.allowDirty),
  });
  steps.push({ phase: "precheck", ok: true, ...pre });
  log(
    `        cliRoot=${pre.cliRoot}\n` +
      `        gitCommit=${pre.gitCommit || "(no git)"} dirty=${pre.dirty}`,
  );

  // ── Phase 2 ────────────────────────────────────────────────────────────
  log(chalk.cyan("  [2/7] Ensure web-panel"));
  const wp = ensureWebPanel({
    cliRoot: pre.cliRoot,
    skipBuild: Boolean(cliOpts.skipWebPanelBuild),
    logger,
  });
  steps.push({ phase: "web-panel", ok: true, ...wp });
  log(
    `        distDir=${wp.distDir}\n` +
      `        rebuilt=${wp.rebuilt} assetCount=${wp.assetCount}`,
  );

  // ── Build temp dir (lives under OS tmp; cleaned on success) ────────────
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-pack-"));
  log(chalk.dim(`        tempDir=${tempDir}`));

  // ── Phase 3 ────────────────────────────────────────────────────────────
  log(chalk.cyan("  [3/7] Build config template"));
  const cfg = buildConfigTemplate({
    presetConfigPath: cliOpts.presetConfig || null,
    allowSecrets: Boolean(cliOpts.allowSecrets),
    bindHost: cliOpts.bindHost,
    wsPort: parseInt(cliOpts.wsPort, 10),
    uiPort: parseInt(cliOpts.uiPort, 10),
    enableTls: Boolean(cliOpts.enableTls),
    logger,
  });
  const templatesDir = path.join(tempDir, "templates");
  const templateFile = writeTemplate(cfg.template, templatesDir);
  steps.push({
    phase: "config-template",
    ok: true,
    file: templateFile,
    secretsFound: cfg.secrets.length,
  });
  log(`        template=${templateFile}`);
  log(`        secretsFound=${cfg.secrets.length}`);

  // ── Phase 4 ────────────────────────────────────────────────────────────
  // In dry-run we want a complete plan even if native modules aren't
  // installed in this workspace, so we downgrade the required-missing
  // error to a logged warning. Real builds still fail hard.
  log(chalk.cyan("  [4/7] Collect native prebuilds"));
  let native;
  try {
    native = collectPrebuilds({
      cliRoot: pre.cliRoot,
      targets,
      tempDir,
    });
  } catch (e) {
    if (cliOpts.dryRun && e instanceof PackError) {
      log(
        chalk.yellow(
          `        WARN (dry-run only): ${e.message.split("\n")[0]}`,
        ),
      );
      native = { prebuildsDir: null, collected: [], missing: [] };
    } else {
      throw e;
    }
  }
  steps.push({
    phase: "native-prebuilds",
    ok: true,
    collected: native.collected.length,
    missing: native.missing.length,
  });
  log(
    `        collected=${native.collected.length} missing=${native.missing.length}`,
  );
  if (native.missing.length > 0) {
    for (const m of native.missing) {
      log(
        chalk.yellow(
          `        - missing: ${m.module} (${m.target}) ${m.required ? "REQUIRED" : "optional"}`,
        ),
      );
    }
  }

  // ── Phase 5 ────────────────────────────────────────────────────────────
  log(chalk.cyan("  [5/7] Generate pkg config"));
  const outputPath = path.resolve(
    cliOpts.output ||
      path.join(projectRoot, "dist", `chainlesschain-portable-${targets[0]}`),
  );
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const pkgCfg = generatePkgConfig({
    cliRoot: pre.cliRoot,
    tempDir,
    distDir: wp.distDir,
    prebuildsDir: native.prebuildsDir,
    templatesDir,
    targets,
    outputPath,
    compress: cliOpts.compress !== false,
  });
  steps.push({
    phase: "pkg-config",
    ok: true,
    pkgConfigFile: pkgCfg.pkgConfigFile,
    entryScript: pkgCfg.entryScript,
  });
  log(`        pkgConfig=${pkgCfg.pkgConfigFile}`);
  log(`        entry=${pkgCfg.entryScript}`);

  if (cliOpts.dryRun) {
    log(chalk.yellow("\n  [dry-run] Stopping before pkg invocation."));
    log(chalk.dim(`  Plan written to: ${pkgCfg.pkgConfigFile}`));
    return { steps, dryRun: true, tempDir };
  }

  // ── Phase 6 ────────────────────────────────────────────────────────────
  log(chalk.cyan("  [6/7] Run pkg"));
  const built = runPkg({
    cliRoot: pre.cliRoot,
    pkgConfigFile: pkgCfg.pkgConfigFile,
    outputPath,
    targets,
    logger,
  });
  steps.push({ phase: "pkg-run", ok: true, outputs: built.outputs });
  log(`        outputs=${built.outputs.length}`);

  // ── Phase 7 ────────────────────────────────────────────────────────────
  log(chalk.cyan("  [7/7] Write manifest"));
  const manifests = writeManifests({
    outputs: built.outputs,
    cliRoot: pre.cliRoot,
    gitCommit: pre.gitCommit,
    gitDirty: pre.dirty,
    targets,
    ports: {
      ws: parseInt(cliOpts.wsPort, 10),
      ui: parseInt(cliOpts.uiPort, 10),
    },
    includeDb: cliOpts.includeDb !== false,
    includeModels: Boolean(cliOpts.includeModels),
    commands: [],
  });
  steps.push({ phase: "manifest", ok: true, count: manifests.length });

  // Optional cleanup of temp dir on success
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }

  // For UX, return the first artifact path
  const first = manifests[0] || {};
  return {
    outputPath: first.artifact,
    sha256: first.sha256,
    manifests,
    steps,
  };
}

// Re-export the typed error so callers can introspect exit codes if needed.
export { PackError };
