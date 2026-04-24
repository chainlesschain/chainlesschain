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

export function registerPackCommand(program) {
  program
    .command("pack")
    .description(
      "Bundle the current project environment into a standalone executable",
    )
    .option(
      "-o, --output <path>",
      "Output path (no extension; pkg appends .exe on Windows)",
    )
    .option(
      "-t, --targets <list>",
      "Comma-separated pkg targets (default: current platform)",
      "node20-win-x64",
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
}
