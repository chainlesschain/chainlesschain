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
import { collectProjectAssets } from "./project-assets-collector.js";
import { generatePkgConfig } from "./pkg-config-generator.js";
import { runPkg } from "./pkg-runner.js";
import { writeManifests } from "./manifest-writer.js";
import { smokeTestExe } from "./smoke-runner.js";
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
    projectMode: cliOpts.project, // tri-state: true / false / undefined
    projectConfigOverride: cliOpts.projectConfigOverride || null,
  });
  steps.push({ phase: "precheck", ok: true, ...pre });
  log(
    `        cliRoot=${pre.cliRoot}\n` +
      `        gitCommit=${pre.gitCommit || "(no git)"} dirty=${pre.dirty}\n` +
      `        projectMode=${pre.projectMode} ` +
      `projectConfig=${pre.projectConfigPath || "(none)"}`,
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

  // ── Phase 3.5 (project mode only) ─────────────────────────────────────
  // Snapshot projectRoot/.chainlesschain/ into tempDir/project/ so pkg can
  // bundle it as an asset. The runtime entry script materializes this at
  // first launch. See docs/design/CC_PACK_项目模式_设计文档.md §6.
  let project = null;
  if (pre.projectMode) {
    log(chalk.cyan("  [3.5/7] Collect project assets"));
    project = collectProjectAssets({
      projectRoot,
      tempDir,
      allowSecrets: Boolean(cliOpts.allowSecrets),
      forceLargeProject: Boolean(cliOpts.forceLargeProject),
      logger,
    });
    steps.push({
      phase: "project-assets",
      ok: true,
      projectName: project.projectName,
      fileCount: project.fileCount,
      totalBytes: project.totalBytes,
      bundledSkills: project.bundledSkills.map((s) => s.name),
      configSha: project.configSha,
    });
    log(
      `        projectName=${project.projectName}\n` +
        `        files=${project.fileCount} size=${formatMB(project.totalBytes)}\n` +
        `        bundledSkills=[${project.bundledSkills.map((s) => s.name).join(", ")}]\n` +
        `        configSha=${project.configSha.slice(0, 12)}...`,
    );
  }

  // ── Phase 4 ────────────────────────────────────────────────────────────
  // None of the native drivers are required anymore — the runtime falls
  // back to sql.js (WASM). Missing natives are reported, not fatal.
  log(chalk.cyan("  [4/7] Collect native prebuilds"));
  const native = collectPrebuilds({
    cliRoot: pre.cliRoot,
    targets,
    tempDir,
  });
  steps.push({
    phase: "native-prebuilds",
    ok: true,
    collected: native.collected.length,
    missing: native.missing.length,
    sqlJs: Boolean(native.sqlJs),
  });
  log(
    `        collected=${native.collected.length} missing=${native.missing.length}` +
      ` sqlJs=${native.sqlJs ? "bundled" : "absent"}`,
  );
  if (native.missing.length > 0) {
    for (const m of native.missing) {
      log(
        chalk.yellow(
          `        - missing: ${m.module} (${m.target}) — will fall back to sql.js at runtime`,
        ),
      );
    }
  }
  if (native.collected.length === 0 && !native.sqlJs) {
    log(
      chalk.red(
        "        WARN: no native SQLite driver found AND sql.js not installed.\n" +
          "              The packed binary will fail at DB init. Install sql.js" +
          " in the workspace before packing.",
      ),
    );
  }

  // ── Phase 5 ────────────────────────────────────────────────────────────
  log(chalk.cyan("  [5/7] Generate pkg config"));
  // In project mode the artifact is named after the project, not the CLI.
  const artifactBase =
    pre.projectMode && project?.projectName
      ? `${project.projectName}-portable-${targets[0]}`
      : `chainlesschain-portable-${targets[0]}`;
  const outputPath = path.resolve(
    cliOpts.output || path.join(projectRoot, "dist", artifactBase),
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
    runtime: {
      token: typeof cliOpts.token === "string" ? cliOpts.token : "auto",
      bindHost: cliOpts.bindHost,
      wsPort: parseInt(cliOpts.wsPort, 10),
      uiPort: parseInt(cliOpts.uiPort, 10),
    },
    project,
    projectEntry: cliOpts.entry || null,
    forceRefreshOnLaunch: Boolean(cliOpts.forceRefreshOnLaunch),
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
    return { steps, dryRun: true, tempDir, project };
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

  // Project manifest sidecar: <artifact>.project.json beside each exe.
  if (project && manifests.length > 0) {
    const projectManifest = {
      schema: 1,
      projectName: project.projectName,
      configSha: project.configSha,
      fileCount: project.fileCount,
      bundledSkills: project.bundledSkills.map((s) => ({
        name: s.name,
        dir: s.dir,
      })),
    };
    for (const { artifact } of manifests) {
      fs.writeFileSync(
        artifact + ".project.json",
        JSON.stringify(projectManifest, null, 2),
        "utf-8",
      );
    }
  }

  // ── Phase 8 (optional) ────────────────────────────────────────────────
  // The `--no-smoke-test` flag and cross-target builds skip this: pkg can
  // compile a linux-x64 artifact on Windows, but we can't execute it. We
  // also skip when the artifact is for an OS/arch other than the host.
  const hostTargetable = targets.filter((t) => isHostExecutable(t));
  const smokeable = built.outputs.filter((o) =>
    hostTargetable.some((t) => o.target === t),
  );
  if (cliOpts.smokeTest !== false && smokeable.length > 0) {
    log(chalk.cyan("  [8/8] Smoke-test artifact"));
    for (const out of smokeable) {
      log(`        probing: ${out.path}`);
      try {
        // Pick ports guaranteed not to clash with a user's running
        // instance on the defaults 18800/18810. These flow into the
        // spawned exe via CC_PACK_{UI,WS}_PORT env.
        const res = await smokeTestExe({
          exePath: out.path,
          uiPort: 18951,
          wsPort: 18950,
          bundledSkillNames: project?.bundledSkills?.map((s) => s.name) ?? null,
          logger,
        });
        steps.push({
          phase: "smoke",
          ok: true,
          target: out.target,
          uiStatus: res.uiStatus,
          wsListening: res.wsListening,
        });
      } catch (e) {
        steps.push({
          phase: "smoke",
          ok: false,
          target: out.target,
          error: e.message,
        });
        throw e;
      }
    }
  } else if (cliOpts.smokeTest === false) {
    log(chalk.dim("  [8/8] Smoke-test skipped (--no-smoke-test)"));
  } else {
    log(
      chalk.dim(
        `  [8/8] Smoke-test skipped — no host-executable target in ${targets.join(",")}`,
      ),
    );
  }

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
    project, // null in CLI-only mode
  };
}

/**
 * Return true if a pkg target can actually run on the current host. We
 * only smoke-test artifacts that match the host platform+arch — pkg can
 * cross-compile to other OS/arch combos, but we have no way to execute
 * them locally. The small shape of the target string (`nodeXX-<os>-<arch>`)
 * makes a purely string comparison safe.
 */
function isHostExecutable(target) {
  const parts = String(target).split("-");
  if (parts.length < 3) return false;
  const [, os, arch] = parts;
  const hostOs =
    process.platform === "win32"
      ? "win"
      : process.platform === "darwin"
        ? "macos"
        : "linux";
  const hostArch = process.arch; // 'x64' | 'arm64' | ...
  // 'alpine' is linux with musl; still host-executable on a glibc host in
  // practice for smoke tests, but skip to avoid false negatives.
  if (os === "alpine") return false;
  return os === hostOs && arch === hostArch;
}

function formatMB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

// Re-export the typed error so callers can introspect exit codes if needed.
export { PackError };
