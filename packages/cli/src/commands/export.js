/**
 * Knowledge export commands
 * chainlesschain export markdown|site --output <dir>
 */

import chalk from "chalk";
import ora from "ora";
import { resolve } from "path";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import { exportToMarkdown, exportToSite } from "../lib/knowledge-exporter.js";

export function registerExportCommand(program) {
  const exp = program
    .command("export")
    .description("Export knowledge base to external formats");

  // export markdown
  exp
    .command("markdown")
    .description("Export notes as markdown files")
    .requiredOption("-o, --output <dir>", "Output directory")
    .option("--category <category>", "Filter by category")
    .option("--tag <tag>", "Filter by tag")
    .option("-n, --limit <n>", "Max notes to export")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const outputDir = resolve(options.output);
        const spinner = ora("Exporting to markdown...").start();
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          spinner.fail("Database not available");
          process.exit(1);
        }

        const db = ctx.db.getDatabase();
        const exported = exportToMarkdown(db, outputDir, {
          category: options.category,
          tag: options.tag,
          limit: options.limit ? parseInt(options.limit) : undefined,
        });
        spinner.stop();

        if (options.json) {
          console.log(
            JSON.stringify(
              { count: exported.length, output: outputDir, files: exported },
              null,
              2,
            ),
          );
        } else if (exported.length === 0) {
          logger.info("No notes to export");
        } else {
          logger.success(
            `Exported ${chalk.cyan(exported.length)} notes to ${chalk.gray(outputDir)}`,
          );
          for (const f of exported.slice(0, 10)) {
            logger.log(`  ${chalk.gray(f.path)}`);
          }
          if (exported.length > 10) {
            logger.log(chalk.gray(`  ... and ${exported.length - 10} more`));
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Export failed: ${err.message}`);
        process.exit(1);
      }
    });

  // export site
  exp
    .command("site")
    .description("Export notes as a static HTML website")
    .requiredOption("-o, --output <dir>", "Output directory")
    .option("--title <title>", "Site title", "ChainlessChain Knowledge Base")
    .option("--category <category>", "Filter by category")
    .option("--tag <tag>", "Filter by tag")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const outputDir = resolve(options.output);
        const spinner = ora("Generating static site...").start();
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          spinner.fail("Database not available");
          process.exit(1);
        }

        const db = ctx.db.getDatabase();
        const exported = exportToSite(db, outputDir, {
          title: options.title,
          category: options.category,
          tag: options.tag,
        });
        spinner.stop();

        if (options.json) {
          console.log(
            JSON.stringify(
              { count: exported.length, output: outputDir, files: exported },
              null,
              2,
            ),
          );
        } else {
          logger.success(
            `Generated static site with ${chalk.cyan(exported.length)} pages`,
          );
          logger.log(`  ${chalk.gray("Output:")} ${outputDir}`);
          logger.log(
            `  ${chalk.gray("Files:")} index.html, style.css, ${exported.length} note pages`,
          );
        }

        await shutdown();
      } catch (err) {
        logger.error(`Export failed: ${err.message}`);
        process.exit(1);
      }
    });
}
