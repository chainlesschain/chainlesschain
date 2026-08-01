/**
 * Process-wide CLI output contract.
 *
 * Command actions historically import a singleton logger, so the context is
 * intentionally mutable and bound once by Commander's preAction lifecycle.
 * New code may use OutputContext directly; legacy logger calls are adapted by
 * src/lib/logger.js.
 */

export class OutputContext {
  constructor({
    quiet = false,
    verbose = false,
    machineReadable = false,
  } = {}) {
    this.quiet = quiet === true;
    this.verbose = verbose === true;
    this.machineReadable = machineReadable === true;
  }
}

let currentContext = new OutputContext();
const MACHINE_READABLE_FORMATS = new Set([
  "json",
  "jsonl",
  "ndjson",
  "stream-json",
]);

export function getOutputContext() {
  return currentContext;
}

export function bindOutputContext(options = {}) {
  currentContext =
    options instanceof OutputContext ? options : new OutputContext(options);
  return currentContext;
}

export function resetOutputContext() {
  return bindOutputContext();
}

export function isMachineReadableOptions(options = {}) {
  if (options.json === true) return true;
  if (options.jsonSchema) return true;
  const format = String(
    options.outputFormat || options.format || "",
  ).toLowerCase();
  return MACHINE_READABLE_FORMATS.has(format);
}

export function bindProgramOutputContext(program, actionCommand) {
  const current = getOutputContext();
  const globalOptions = program?.opts?.() || {};
  const commandOptions = actionCommand?.opts?.() || {};
  return bindOutputContext({
    quiet: current.quiet || globalOptions.quiet === true,
    verbose: current.verbose || globalOptions.verbose === true,
    machineReadable:
      current.machineReadable || isMachineReadableOptions(commandOptions),
  });
}

export function argvRequestsMachineReadableOutput(argv = process.argv) {
  const args = Array.isArray(argv) ? argv : [];
  for (let index = 0; index < args.length; index++) {
    const arg = String(args[index]);
    if (arg === "--") break;
    if (
      arg === "--json" ||
      arg === "--json-schema" ||
      arg.startsWith("--json-schema=")
    ) {
      return true;
    }
    const separator = arg.indexOf("=");
    const flag = separator === -1 ? arg : arg.slice(0, separator);
    if (flag !== "--output-format" && flag !== "--format") continue;
    const value = separator === -1 ? args[index + 1] : arg.slice(separator + 1);
    if (MACHINE_READABLE_FORMATS.has(String(value || "").toLowerCase())) {
      return true;
    }
  }
  return false;
}
