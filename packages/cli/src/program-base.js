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
import {
  bindOutputContext,
  bindProgramOutputContext,
  getOutputContext,
} from "./lib/output-context.js";

export function createBaseProgram() {
  const program = new Command();
  const previousOutputContexts = new WeakMap();
  program
    .name("chainlesschain")
    .description(
      "CLI for ChainlessChain - install, configure, and manage your personal AI management system",
    )
    .version(VERSION, "-v, --version")
    .option("--verbose", "Enable verbose output")
    .option("--quiet", "Suppress non-essential output")
    // M5/M6 Runtime Convergence options
    .option(
      "--jsii-runtime <runtime>",
      "JSII runtime to use: native|quickjs",
      "native",
    )
    .option(
      "--otlp-endpoint <endpoint>",
      "OTel Collector endpoint (protocol via OTEL_EXPORTER_OTLP_PROTOCOL; HTTP example: http://localhost:4318)",
    );

  // Bind the output contract exactly once, after Commander has resolved both
  // global and leaf-command flags but before any action can print. Registrars
  // no longer need to remember to call logger.setQuiet/setVerbose themselves.
  program.hook("preAction", (_thisCommand, actionCommand) => {
    previousOutputContexts.set(actionCommand, getOutputContext());
    bindProgramOutputContext(program, actionCommand);
  });
  program.hook("postAction", (_thisCommand, actionCommand) => {
    bindOutputContext(previousOutputContexts.get(actionCommand));
    previousOutputContexts.delete(actionCommand);
  });
  return program;
}
