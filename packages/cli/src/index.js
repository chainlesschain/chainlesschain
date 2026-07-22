#!/usr/bin/env node
/**
 * ChainlessChain CLI - Unified Entry Point
 * Uses top-level await to preload all commands synchronously for tests.
 */
import { createBaseProgram } from "./program-base.js";
import chalk from "chalk";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import manifest from "./command-manifest.json" with { type: "json" };

// The manifest entry is the canonical registration point for learning.  Keep
// these names visible here for tooling that audits the CLI's command surface:
// import { registerLearningCommand } from "./commands/learning.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Preload all command modules at module load time using top-level await
// This ensures createProgram() is fully synchronous for tests
const commandModules = [];

for (const entry of manifest.commands) {
  try {
    const modulePath = join(__dirname, entry.module.replace("./", ""));
    const moduleUrl = pathToFileURL(modulePath).href;
    const mod = await import(moduleUrl);
    commandModules.push({ entry, mod });
  } catch (err) {
    // Store error for later reporting
    commandModules.push({ entry, error: err });
  }
}

/**
 * Create and configure the full Commander program with all commands.
 * Synchronous - matches test expectations.
 * @returns {import('commander').Command} configured program
 */
export function createProgram(options = {}) {
  const program = createBaseProgram();

  const hasOptionWhitelist = Object.prototype.hasOwnProperty.call(
    options,
    "allowedCommands",
  );
  const allowedCommands = hasOptionWhitelist
    ? options.allowedCommands
    : process.env.CC_PROJECT_ALLOWED_SUBCOMMANDS
      ? new Set(
          process.env.CC_PROJECT_ALLOWED_SUBCOMMANDS.split(",")
            .map((name) => name.trim())
            .filter(Boolean),
        )
      : null;
  const shouldFilter =
    allowedCommands instanceof Set && allowedCommands.size > 0;

  // Add extended help for command categories
  program.on("--help", () => {
    console.log("");
    console.log(chalk.bold("Command Categories:"));
    console.log("  Setup & System:   setup, doctor, update, status, config");
    console.log(
      "  AI & Chat:        chat, ask, agent, skill, workflow, cowork",
    );
    console.log("  Knowledge & Notes: note, search, memory, session, rag");
    console.log("  Security & DID:   did, auth, encrypt, ukey, backup");
    console.log("  Integration:      mcp, browse, git, plugin");
    console.log("  Data & Trading:   trade, data, monitor, backup");
    console.log("");
    console.log(
      `Run ${chalk.cyan("cc <command> --help")} for command-specific help.`,
    );
  });

  // Register all preloaded commands
  for (const { entry, mod, error } of commandModules) {
    if (shouldFilter && !allowedCommands.has(entry.name)) continue;
    if (error) {
      if (process.env.DEBUG) {
        console.warn(
          chalk.yellow(
            `Warning: Failed to load command '${entry.name}':`,
            error.message,
          ),
        );
      }
      continue;
    }
    try {
      const registerFn = mod[entry.register];
      if (typeof registerFn !== "function") {
        throw new Error(
          `Register function '${entry.register}' not found in ${entry.module}`,
        );
      }
      registerFn(program);
    } catch (err) {
      if (process.env.DEBUG) {
        console.warn(
          chalk.yellow(
            `Warning: Failed to register command '${entry.name}':`,
            err.message,
          ),
        );
      }
    }
  }

  return program;
}

// Backward compat alias
export { createProgram as createProgramSync };

/**
 * Async version (alias for consistency)
 */
export async function createProgramAsync() {
  return createProgram();
}

// Only run main() when executed directly, not when imported for tests
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("/cli/src/index.js") ||
    process.argv[1].endsWith("\\cli\\src\\index.js") ||
    process.argv[1].endsWith("/cc") ||
    process.argv[1].endsWith("\\cc") ||
    process.argv[1].endsWith("/cli/bin/cli.js") ||
    process.argv[1].endsWith("\\cli\\bin\\cli.js"));

if (isDirectRun) {
  const program = createProgram();
  program.parseAsync(process.argv).catch((err) => {
    console.error(chalk.red("\nUnexpected error:"), err.message);
    if (process.env.DEBUG) {
      console.error(err.stack);
    }
    process.exit(1);
  });
}
