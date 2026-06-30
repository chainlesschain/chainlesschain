/**
 * Shared base Commander program factory.
 *
 * Both the eager path (src/index.js `createProgram`, used by tests, help, and
 * the unknown-command fallback) and the lazy fast path (src/lazy-dispatch.js,
 * used by the bin for a resolved `cc <cmd>`) build their program from this so
 * the program name, version flag, and global options can never drift between
 * the two code paths.
 */
import { Command } from "commander";
import { VERSION } from "./constants.js";

export function createBaseProgram() {
  const program = new Command();
  program
    .name("chainlesschain")
    .description(
      "CLI for ChainlessChain - install, configure, and manage your personal AI management system",
    )
    .version(VERSION, "-v, --version")
    .option("--verbose", "Enable verbose output")
    .option("--quiet", "Suppress non-essential output");
  return program;
}
