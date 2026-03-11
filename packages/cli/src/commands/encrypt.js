/**
 * Encryption commands
 * chainlesschain encrypt <file> | decrypt <file> | db encrypt | db decrypt | info <file>
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  encryptFile,
  decryptFile,
  isEncryptedFile,
  getEncryptedFileInfo,
  getDbEncryptionStatus,
  setDbEncryptionStatus,
  hashPassword,
} from "../lib/crypto-manager.js";

async function promptPassword(message = "Password:") {
  const { password } = await import("@inquirer/prompts");
  return password({ message });
}

export function registerEncryptCommand(program) {
  const enc = program
    .command("encrypt")
    .description("File encryption and database encryption management");

  // encrypt file
  enc
    .command("file")
    .description("Encrypt a file with AES-256-GCM")
    .argument("<path>", "File to encrypt")
    .option("-o, --output <path>", "Output file path (default: <file>.enc)")
    .option("-p, --password <pass>", "Password (prompted if not given)")
    .action(async (filePath, options) => {
      try {
        const pass =
          options.password || (await promptPassword("Encryption password:"));
        if (!pass) {
          logger.error("Password is required");
          process.exit(1);
        }

        // Confirm password
        if (!options.password) {
          const confirm = await promptPassword("Confirm password:");
          if (pass !== confirm) {
            logger.error("Passwords do not match");
            process.exit(1);
          }
        }

        const result = encryptFile(filePath, pass, options.output);
        logger.success("File encrypted");
        logger.log(
          `  ${chalk.bold("Input:")}    ${result.inputPath} (${result.originalSize} bytes)`,
        );
        logger.log(
          `  ${chalk.bold("Output:")}   ${result.outputPath} (${result.encryptedSize} bytes)`,
        );
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // decrypt file
  const dec = program
    .command("decrypt")
    .description("Decrypt an encrypted file");

  dec
    .command("file")
    .description("Decrypt an AES-256-GCM encrypted file")
    .argument("<path>", "File to decrypt (.enc)")
    .option("-o, --output <path>", "Output file path")
    .option("-p, --password <pass>", "Password (prompted if not given)")
    .action(async (filePath, options) => {
      try {
        const pass =
          options.password || (await promptPassword("Decryption password:"));
        if (!pass) {
          logger.error("Password is required");
          process.exit(1);
        }

        const result = decryptFile(filePath, pass, options.output);
        logger.success("File decrypted");
        logger.log(
          `  ${chalk.bold("Input:")}    ${result.inputPath} (${result.encryptedSize} bytes)`,
        );
        logger.log(
          `  ${chalk.bold("Output:")}   ${result.outputPath} (${result.decryptedSize} bytes)`,
        );
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // encrypt db
  enc
    .command("db")
    .description("Enable database encryption tracking")
    .option("-p, --password <pass>", "Password (prompted if not given)")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();

        if (getDbEncryptionStatus(db)) {
          logger.info("Database is already marked as encrypted");
          await shutdown();
          return;
        }

        const pass =
          options.password ||
          (await promptPassword("Database encryption password:"));
        if (!pass) {
          logger.error("Password is required");
          process.exit(1);
        }

        const { hash, salt } = hashPassword(pass);
        setDbEncryptionStatus(db, true, hash, salt);
        logger.success(
          "Database encryption status set. Note: full SQLCipher encryption requires the desktop app.",
        );

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // decrypt db
  dec
    .command("db")
    .description("Disable database encryption tracking")
    .option("--force", "Skip confirmation")
    .action(async (options) => {
      try {
        if (!options.force) {
          const { confirm } = await import("@inquirer/prompts");
          const ok = await confirm({
            message: "Disable database encryption tracking?",
          });
          if (!ok) {
            logger.info("Cancelled");
            return;
          }
        }

        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        setDbEncryptionStatus(db, false);
        logger.success("Database encryption status cleared");

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // encrypt info
  enc
    .command("info")
    .description("Check if a file is encrypted")
    .argument("<path>", "File to check")
    .option("--json", "Output as JSON")
    .action(async (filePath, options) => {
      try {
        const info = getEncryptedFileInfo(filePath);

        if (options.json) {
          console.log(JSON.stringify(info, null, 2));
        } else {
          logger.log(chalk.bold("File Info:\n"));
          logger.log(`  ${chalk.bold("Path:")}      ${info.path}`);
          logger.log(`  ${chalk.bold("Size:")}      ${info.size} bytes`);
          logger.log(
            `  ${chalk.bold("Encrypted:")} ${info.encrypted ? chalk.green("yes (ChainlessChain format)") : chalk.gray("no")}`,
          );
          logger.log(`  ${chalk.bold("Modified:")}  ${info.modified}`);
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // encrypt status (db status)
  enc
    .command("status")
    .description("Show database encryption status")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const encrypted = getDbEncryptionStatus(db);

        if (options.json) {
          console.log(JSON.stringify({ encrypted }, null, 2));
        } else {
          logger.log(
            `Database encryption: ${encrypted ? chalk.green("enabled") : chalk.gray("not enabled")}`,
          );
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });
}
