/**
 * cc statusline — preview the configured `statusLine` (Claude-Code parity).
 *
 *   cc statusline            preview the rendered status line
 *   cc statusline show       show the resolved config (+ source)
 *
 * Configure in .claude/settings.json:
 *   { "statusLine": { "type": "command", "command": "~/.claude/status.sh" } }
 * The command receives a JSON context on stdin and its first stdout line is the
 * status line (shown above the REPL prompt each turn).
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";

export function registerStatuslineCommand(program) {
  const cmd = program
    .command("statusline")
    .alias("status-line")
    .description("Preview / show the .claude/settings.json statusLine");

  cmd
    .command("preview", { isDefault: true })
    .description("Render the configured status line once")
    .option("--model <m>", "Model to pass in the context", "opus")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const { loadStatusLineConfig, buildContext, renderStatusLine } =
          await import("../lib/status-line.cjs");
        const cfg = loadStatusLineConfig({ cwd: process.cwd() });
        if (!cfg) {
          logger.log(
            chalk.gray(
              'No statusLine configured. Add to .claude/settings.json:\n' +
                '  { "statusLine": { "type": "command", "command": "./status.sh" } }',
            ),
          );
          return;
        }
        const line = renderStatusLine(
          cfg,
          buildContext({
            sessionId: "preview",
            model: options.model,
            cwd: process.cwd(),
          }),
          { cwd: process.cwd() },
        );
        if (options.json) {
          console.log(JSON.stringify({ config: cfg, line }, null, 2));
          return;
        }
        if (line == null) {
          logger.error(
            chalk.red(
              `statusLine command produced no output (or failed): ${cfg.command}`,
            ),
          );
          process.exitCode = 1;
          return;
        }
        process.stdout.write(line + "\n");
      } catch (err) {
        logger.error(chalk.red(`statusline preview failed: ${err.message}`));
        process.exitCode = 1;
      }
    });

  cmd
    .command("show")
    .description("Show the resolved statusLine config")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const { loadStatusLineConfig } = await import("../lib/status-line.cjs");
        const cfg = loadStatusLineConfig({ cwd: process.cwd() });
        if (options.json) {
          console.log(JSON.stringify(cfg, null, 2));
          return;
        }
        if (!cfg) {
          logger.log(chalk.gray("No statusLine configured."));
          return;
        }
        logger.log(`command: ${chalk.cyan(cfg.command)}`);
        logger.log(chalk.gray(`type: ${cfg.type}  padding: ${cfg.padding}`));
      } catch (err) {
        logger.error(chalk.red(`statusline show failed: ${err.message}`));
        process.exitCode = 1;
      }
    });
}
