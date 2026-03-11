/**
 * Knowledge import commands
 * chainlesschain import markdown|evernote|notion|pdf <path>
 */

import chalk from "chalk";
import ora from "ora";
import { existsSync, statSync } from "fs";
import { resolve } from "path";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  importMarkdownDir,
  importEnexFile,
  importNotionDir,
} from "../lib/knowledge-importer.js";

export function registerImportCommand(program) {
  const imp = program
    .command("import")
    .description("Import knowledge from external sources");

  // import markdown
  imp
    .command("markdown")
    .description("Import markdown files from a directory")
    .argument("<dir>", "Directory containing .md files")
    .option("--json", "Output as JSON")
    .action(async (dir, options) => {
      try {
        const absDir = resolve(dir);
        if (!existsSync(absDir) || !statSync(absDir).isDirectory()) {
          logger.error(`Directory not found: ${absDir}`);
          process.exit(1);
        }

        const spinner = ora("Importing markdown files...").start();
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          spinner.fail("Database not available");
          process.exit(1);
        }

        const db = ctx.db.getDatabase();
        const imported = importMarkdownDir(db, absDir);
        spinner.stop();

        if (options.json) {
          console.log(
            JSON.stringify(
              { count: imported.length, notes: imported },
              null,
              2,
            ),
          );
        } else if (imported.length === 0) {
          logger.info("No .md files found in the directory");
        } else {
          logger.success(
            `Imported ${chalk.cyan(imported.length)} markdown notes`,
          );
          for (const n of imported.slice(0, 10)) {
            logger.log(
              `  ${chalk.gray(n.id.slice(0, 8))}  ${chalk.white(n.title)}  ${chalk.gray(n.source || "")}`,
            );
          }
          if (imported.length > 10) {
            logger.log(chalk.gray(`  ... and ${imported.length - 10} more`));
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Import failed: ${err.message}`);
        process.exit(1);
      }
    });

  // import evernote
  imp
    .command("evernote")
    .description("Import from Evernote ENEX export file")
    .argument("<file>", "Path to .enex file")
    .option("--json", "Output as JSON")
    .action(async (file, options) => {
      try {
        const absFile = resolve(file);
        if (!existsSync(absFile)) {
          logger.error(`File not found: ${absFile}`);
          process.exit(1);
        }

        const spinner = ora("Importing Evernote notes...").start();
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          spinner.fail("Database not available");
          process.exit(1);
        }

        const db = ctx.db.getDatabase();
        const imported = importEnexFile(db, absFile);
        spinner.stop();

        if (options.json) {
          console.log(
            JSON.stringify(
              { count: imported.length, notes: imported },
              null,
              2,
            ),
          );
        } else if (imported.length === 0) {
          logger.info("No notes found in the ENEX file");
        } else {
          logger.success(
            `Imported ${chalk.cyan(imported.length)} Evernote notes`,
          );
          for (const n of imported.slice(0, 10)) {
            const tags =
              n.tags.length > 0 ? chalk.gray(` [${n.tags.join(", ")}]`) : "";
            logger.log(
              `  ${chalk.gray(n.id.slice(0, 8))}  ${chalk.white(n.title)}${tags}`,
            );
          }
          if (imported.length > 10) {
            logger.log(chalk.gray(`  ... and ${imported.length - 10} more`));
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Import failed: ${err.message}`);
        process.exit(1);
      }
    });

  // import notion
  imp
    .command("notion")
    .description("Import from Notion export directory")
    .argument("<dir>", "Notion export directory")
    .option("--json", "Output as JSON")
    .action(async (dir, options) => {
      try {
        const absDir = resolve(dir);
        if (!existsSync(absDir) || !statSync(absDir).isDirectory()) {
          logger.error(`Directory not found: ${absDir}`);
          process.exit(1);
        }

        const spinner = ora("Importing Notion pages...").start();
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          spinner.fail("Database not available");
          process.exit(1);
        }

        const db = ctx.db.getDatabase();
        const imported = importNotionDir(db, absDir);
        spinner.stop();

        if (options.json) {
          console.log(
            JSON.stringify(
              { count: imported.length, notes: imported },
              null,
              2,
            ),
          );
        } else if (imported.length === 0) {
          logger.info("No markdown pages found in Notion export");
        } else {
          logger.success(
            `Imported ${chalk.cyan(imported.length)} Notion pages`,
          );
          for (const n of imported.slice(0, 10)) {
            const tags =
              n.tags.length > 0 ? chalk.gray(` [${n.tags.join(", ")}]`) : "";
            logger.log(
              `  ${chalk.gray(n.id.slice(0, 8))}  ${chalk.white(n.title)}${tags}`,
            );
          }
          if (imported.length > 10) {
            logger.log(chalk.gray(`  ... and ${imported.length - 10} more`));
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Import failed: ${err.message}`);
        process.exit(1);
      }
    });

  // import pdf
  imp
    .command("pdf")
    .description("Import text from a PDF file")
    .argument("<file>", "Path to .pdf file")
    .option("--json", "Output as JSON")
    .action(async (file, options) => {
      try {
        const absFile = resolve(file);
        if (!existsSync(absFile)) {
          logger.error(`File not found: ${absFile}`);
          process.exit(1);
        }

        const spinner = ora("Extracting text from PDF...").start();
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          spinner.fail("Database not available");
          process.exit(1);
        }

        const db = ctx.db.getDatabase();

        // Lazy-load pdf-parser to keep it optional
        const { parsePdfText } = await import("../lib/pdf-parser.js");
        const { insertNote, ensureNotesTable } =
          await import("../lib/knowledge-importer.js");
        ensureNotesTable(db);

        const parsed = await parsePdfText(absFile);
        spinner.stop();

        if (!parsed.content || parsed.content.trim().length === 0) {
          logger.info("No text could be extracted from the PDF");
          await shutdown();
          return;
        }

        const note = insertNote(db, {
          title: parsed.title,
          content: parsed.content,
          tags: ["pdf"],
          category: "pdf",
        });

        if (options.json) {
          console.log(JSON.stringify(note, null, 2));
        } else {
          logger.success(`Imported PDF as note: ${chalk.cyan(parsed.title)}`);
          logger.log(`  ${chalk.gray("ID:")} ${note.id.slice(0, 8)}`);
          logger.log(
            `  ${chalk.gray("Length:")} ${parsed.content.length} chars`,
          );
          if (parsed.pages) {
            logger.log(`  ${chalk.gray("Pages:")} ${parsed.pages}`);
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`PDF import failed: ${err.message}`);
        process.exit(1);
      }
    });
}
