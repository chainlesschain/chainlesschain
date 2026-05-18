/**
 * `cc pack` — Bundle the current project environment into a standalone executable.
 *
 * See docs/design/CC_PACK_打包指令设计文档.md for the full design.
 *
 * Phase 1 scope: Windows x64 single target, dry-run + minimal pkg invocation,
 * no native module prebuild collection or smoke test yet.
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { runPack } from "../lib/packer/index.js";
import path from "node:path";
import {
  checkPackUpdate,
  PackUpdateError,
} from "../lib/packer/pack-update-checker.js";
import {
  downloadAndVerify,
  DownloadError,
} from "../lib/packer/pack-update-downloader.js";
import {
  scheduleReplace,
  ApplyError,
} from "../lib/packer/pack-update-applier.js";
import { VERSION } from "../constants.js";

/**
 * Default pkg target string for the host platform+arch. Falls back to
 * `node20-win-x64` for unknown combos so users on uncommon hosts still get
 * a sensible string to edit with `--targets`.
 */
export function defaultPkgTarget() {
  const osSlug =
    process.platform === "win32"
      ? "win"
      : process.platform === "darwin"
        ? "macos"
        : process.platform === "linux"
          ? "linux"
          : null;
  const archSlug =
    process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : null;
  if (!osSlug || !archSlug) return "node20-win-x64";
  return `node20-${osSlug}-${archSlug}`;
}

export function registerPackCommand(program) {
  const packCmd = program
    .command("pack")
    .description(
      "Bundle the current project environment into a standalone executable",
    );

  packCmd
    .option(
      "-o, --output <path>",
      "Output path without extension. pkg appends .exe for win targets only.",
    )
    .option(
      "-t, --targets <list>",
      "Comma-separated pkg targets (defaults to current host platform)",
      defaultPkgTarget(),
    )
    .option("--ws-port <n>", "Default WS port baked into the artifact", "18800")
    .option(
      "--ui-port <n>",
      "Default Web UI port baked into the artifact",
      "18810",
    )
    .option(
      "--token <str>",
      'Default access token; "auto" generates a fresh one at first run',
      "auto",
    )
    .option(
      "--preset-config <path>",
      "Pre-bundled config.json template (will be scanned for secrets)",
    )
    .option(
      "--allow-secrets",
      "Skip secret scanning of preset config (DANGEROUS)",
      false,
    )
    .option("--include-db", "Bundle the DB initialization template", true)
    .option("--no-include-db", "Skip bundling the DB template")
    .option(
      "--include-models",
      "Bundle local LLM models (HUGE artifact size warning)",
      false,
    )
    .option("--compress", "Enable pkg GZip compression", true)
    .option("--no-compress", "Disable pkg compression")
    .option("--sign <cert>", "Code-signing certificate (Phase 2)")
    .option(
      "--sign-password <pass>",
      "Code-signing certificate password; supports env:NAME",
    )
    .option("--smoke-test", "Run smoke test on the produced artifact", true)
    .option("--no-smoke-test", "Skip smoke test")
    .option("--dry-run", "Print the build plan without invoking pkg", false)
    .option(
      "--bind-host <host>",
      "Default bind host baked into the artifact",
      "127.0.0.1",
    )
    .option("--allow-remote", "Default to 0.0.0.0 binding at runtime", false)
    .option("--enable-tls", "Enable TLS in the artifact runtime", false)
    .option("--tls-cert <path>", "TLS certificate path (PEM)")
    .option("--tls-key <path>", "TLS private key path (PEM)")
    .option("--access-policy <path>", "Pre-bundled access policy JSON")
    .option(
      "--skip-web-panel-build",
      "Reuse existing web-panel/dist without rebuilding",
      false,
    )
    .option(
      "--allow-dirty",
      "Allow packing with uncommitted changes in the working tree",
      false,
    )
    .option(
      "--cwd <dir>",
      "Override the project root (defaults to process.cwd())",
    )
    .option(
      "--project",
      "Project mode: bundle .chainlesschain/ from cwd into the artifact",
    )
    .option(
      "--no-project",
      "Disable project-mode auto-detection; pack CLI-only (legacy behavior)",
    )
    .option(
      "--project-config-override <path>",
      "Use an alternate config.json instead of cwd/.chainlesschain/config.json",
    )
    .option(
      "--force-large-project",
      "Bypass the 50MB .chainlesschain/ size cap (DANGEROUS — bloats the exe)",
      false,
    )
    .option(
      "--entry <subcommand>",
      "Override the default subcommand from config.pack.entry (project mode only)",
    )
    .option(
      "--force-refresh-on-launch",
      "Re-materialize project assets on every launch (project mode only)",
      false,
    )
    .option(
      "--update-manifest-url <url>",
      "OTA manifest URL to bake into the artifact (enables `cc pack check-update`)",
    )
    .action(async (opts) => {
      try {
        const result = await runPack(opts, { logger });
        if (opts.dryRun) {
          logger.log(
            chalk.green(
              `\n  ✓ Dry-run complete. ${result.steps?.length || 0} step(s) planned.`,
            ),
          );
        } else if (result.outputPath) {
          logger.log(chalk.green(`\n  ✓ Pack succeeded: ${result.outputPath}`));
          if (result.sha256) {
            logger.log(chalk.dim(`    SHA-256: ${result.sha256}`));
          }
        }
      } catch (err) {
        logger.error(`pack failed: ${err.message}`);
        if (err.exitCode) process.exit(err.exitCode);
        process.exit(1);
      }
    });

  // Phase 5a: check-only OTA probe. Packed exes can't use `cc update`
  // (that runs `npm install -g`), so this subcommand fetches a manifest
  // and reports whether a newer packed artifact exists. Download +
  // self-replace are Phase 5b/5c. See design doc §17.5-17.7.
  packCmd
    .command("check-update")
    .description(
      "Check whether a newer packed artifact is published (no download)",
    )
    .option(
      "--manifest-url <url>",
      "Manifest URL (falls back to BAKED.updateManifestUrl or CC_PACK_UPDATE_MANIFEST env)",
    )
    .option(
      "--target <slug>",
      "pkg target to match against manifest.latest.artifacts (e.g. node20-win-x64); defaults to current host",
    )
    .option(
      "--current <version>",
      "Override the current version (defaults to CLI VERSION or BAKED.packedCliVersion)",
    )
    .option("--json", "Emit JSON instead of human-readable output", false)
    .option(
      "--download",
      "Phase 5b: after the check, download + SHA-256 verify the artifact (no install)",
      false,
    )
    .option(
      "--dest <path>",
      "Phase 5b: download destination. Defaults to `<currentExePath>.new` inside a packed exe, or `./<basename(artifactUrl)>` otherwise. (Named `--dest`, not `--output`, to avoid colliding with the parent `pack -o`.)",
    )
    .option(
      "--apply",
      "Phase 5c: after download, replace the current exe with the new one. Requires --download. On Windows a sidecar cmd runs the move after this process exits",
      false,
    )
    .option(
      "--target-exe <path>",
      "Phase 5c: path of the exe to replace. Defaults to process.execPath (the currently-running binary)",
    )
    .option(
      "--restart",
      "Phase 5c: spawn the new exe after replacement (default: exit without restart)",
      false,
    )
    .action(async (opts) => {
      const manifestUrl =
        opts.manifestUrl ||
        process.env.CC_PACK_UPDATE_MANIFEST ||
        (typeof globalThis.BAKED === "object" &&
          globalThis.BAKED?.updateManifestUrl) ||
        null;

      if (!manifestUrl) {
        const msg =
          "No manifest URL. Provide --manifest-url, set CC_PACK_UPDATE_MANIFEST, or bake one via `cc pack --update-manifest-url`.";
        if (opts.json) {
          logger.log(JSON.stringify({ error: msg, code: "NO_MANIFEST_URL" }));
        } else {
          logger.error(msg);
        }
        process.exit(2);
      }

      const currentVersion =
        opts.current ||
        (typeof globalThis.BAKED === "object" &&
          globalThis.BAKED?.packedCliVersion) ||
        VERSION;

      const target = opts.target || defaultPkgTarget();

      let result;
      try {
        result = await checkPackUpdate({
          manifestUrl,
          currentVersion,
          target,
        });
      } catch (err) {
        const code = err instanceof PackUpdateError ? err.code : "UNKNOWN";
        if (opts.json) {
          logger.log(JSON.stringify({ error: err.message, code }));
        } else {
          logger.error(`check-update failed [${code}]: ${err.message}`);
        }
        // Network / schema issues are non-zero but distinct from "pack failed"
        process.exit(3);
      }

      // Human or JSON report for the check result.
      if (!opts.download) {
        if (opts.json) {
          logger.log(JSON.stringify(result, null, 2));
          return;
        }
        if (result.updateAvailable) {
          logger.log(
            chalk.bold(
              `\n  Update available: ${result.currentVersion} → ${chalk.green(result.latestVersion)}\n`,
            ),
          );
          if (result.artifact) {
            logger.log(`  Artifact (${target}):`);
            logger.log(`    ${result.artifact.url}`);
            logger.log(chalk.dim(`    sha256: ${result.artifact.sha256}`));
          } else {
            logger.log(
              chalk.yellow(
                `  No artifact for target "${target}" in this manifest.`,
              ),
            );
          }
          if (result.releaseNotes) {
            logger.log(chalk.dim(`  Release notes: ${result.releaseNotes}`));
          }
        } else {
          logger.log(
            chalk.green(
              `  ✓ You are on the latest version (${result.currentVersion}).`,
            ),
          );
        }
        return;
      }

      // ── --download branch (Phase 5b) ─────────────────────────────────────
      if (!result.updateAvailable) {
        const msg = `Already on the latest version (${result.currentVersion}); nothing to download.`;
        if (opts.json) logger.log(JSON.stringify({ skipped: msg, ...result }));
        else logger.log(chalk.green(`  ✓ ${msg}`));
        return;
      }
      if (!result.artifact) {
        const msg = `No artifact for target "${target}" in this manifest.`;
        if (opts.json)
          logger.log(JSON.stringify({ error: msg, code: "NO_ARTIFACT" }));
        else logger.error(msg);
        process.exit(3);
      }

      // Default output path. Inside a pkg-packed exe, `process.execPath` is the
      // exe itself — writing `<exe>.new` alongside is conventional for the
      // future Phase 5c self-replacer. Outside pkg, fall back to a filename
      // under cwd so `cc pack check-update --download` from a dev checkout
      // drops the artifact where the user can find it.
      const outputPath = opts.dest
        ? path.resolve(opts.dest)
        : process.pkg
          ? process.execPath + ".new"
          : path.resolve(
              process.cwd(),
              path.basename(new URL(result.artifact.url).pathname) ||
                "pack-update-artifact",
            );

      if (!opts.json) {
        logger.log(
          chalk.bold(
            `\n  Downloading ${result.currentVersion} → ${chalk.green(result.latestVersion)}`,
          ),
        );
        logger.log(`  ${result.artifact.url}`);
        logger.log(chalk.dim(`  → ${outputPath}`));
      }

      let lastPercent = -1;
      try {
        const dl = await downloadAndVerify({
          url: result.artifact.url,
          sha256: result.artifact.sha256,
          outputPath,
          onProgress: opts.json
            ? undefined
            : ({ bytes, total }) => {
                if (!total) return;
                const pct = Math.floor((bytes / total) * 100);
                if (pct !== lastPercent && pct % 10 === 0) {
                  lastPercent = pct;
                  logger.log(
                    chalk.dim(
                      `    ${pct}% (${formatMB(bytes)}/${formatMB(total)})`,
                    ),
                  );
                }
              },
        });
        if (opts.json) {
          logger.log(
            JSON.stringify(
              {
                downloaded: true,
                outputPath: dl.outputPath,
                bytes: dl.bytes,
                sha256: dl.sha256,
                latestVersion: result.latestVersion,
              },
              null,
              2,
            ),
          );
        } else {
          logger.log(
            chalk.green(
              `\n  ✓ Downloaded + verified ${formatMB(dl.bytes)} to ${dl.outputPath}`,
            ),
          );
          if (!opts.apply) {
            logger.log(
              chalk.dim(
                `    sha256 OK. Pass --apply to replace the running exe automatically.`,
              ),
            );
          }
        }

        // ── --apply branch (Phase 5c) ──────────────────────────────────────
        if (!opts.apply) return;

        const targetExe = opts.targetExe || process.execPath;
        if (!opts.json) {
          logger.log(chalk.bold(`\n  Applying update → ${targetExe}`));
          if (process.platform === "win32") {
            logger.log(
              chalk.yellow(
                `  [Windows] This process will exit after scheduling a sidecar cmd; the replacement runs detached. ${opts.restart ? "The new exe will start automatically." : "Re-launch the exe yourself after exit."}`,
              ),
            );
          } else {
            logger.log(
              chalk.dim(
                `  [POSIX] Atomic rename; the currently-running inode survives until exit. ${opts.restart ? "A detached copy will be started now." : "Next launch picks up the new bytes."}`,
              ),
            );
          }
        }

        try {
          const plan = await scheduleReplace({
            newExePath: dl.outputPath,
            targetExePath: targetExe,
            restart: Boolean(opts.restart),
          });
          if (opts.json) {
            logger.log(JSON.stringify({ applied: true, ...plan }, null, 2));
          } else {
            logger.log(
              chalk.green(
                `  ✓ Apply scheduled: action=${plan.action}${plan.sidecarPath ? `, sidecar=${plan.sidecarPath}` : ""}`,
              ),
            );
          }
          // On Windows the sidecar waits for us to exit. On POSIX the rename
          // already happened; if we were asked to restart, the detached child
          // is running. Either way the parent's job is done.
          if (plan.action === "sidecar-cmd") {
            // Give the sidecar a moment to start waiting on our PID before we
            // actually exit. Without this, process.exit(0) can race ahead and
            // the sidecar's tasklist check may spuriously see us as gone
            // before it has even polled once (harmless, but nicer to avoid).
            setTimeout(() => process.exit(0), 500).unref?.();
          }
        } catch (err) {
          const code = err instanceof ApplyError ? err.code : "UNKNOWN";
          if (opts.json) {
            logger.log(JSON.stringify({ error: err.message, code }));
          } else {
            logger.error(`apply failed [${code}]: ${err.message}`);
          }
          process.exit(5);
        }
      } catch (err) {
        const code = err instanceof DownloadError ? err.code : "UNKNOWN";
        if (opts.json) {
          logger.log(JSON.stringify({ error: err.message, code }));
        } else {
          logger.error(`download failed [${code}]: ${err.message}`);
        }
        process.exit(4);
      }
    });
}

function formatMB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
