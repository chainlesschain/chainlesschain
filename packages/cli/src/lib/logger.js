import chalk from "chalk";
import { bindOutputContext, getOutputContext } from "./output-context.js";

const ANSI_ESCAPE_PATTERN = new RegExp(
  String.raw`\u001B\[[0-?]*[ -/]*[@-~]`,
  "g",
);

function diagnosticMessage(message, args) {
  return [message, ...args]
    .map((value) => {
      if (value instanceof Error) return value.message;
      if (typeof value === "string") return value;
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    })
    .join(" ")
    .replace(ANSI_ESCAPE_PATTERN, "");
}

function machineDiagnostic(kind, message, args) {
  console.error(
    JSON.stringify({
      [kind]: { message: diagnosticMessage(message, args) },
    }),
  );
}

export function setVerbose(enabled) {
  const current = getOutputContext();
  bindOutputContext({ ...current, verbose: enabled === true });
}

export function setQuiet(enabled) {
  const current = getOutputContext();
  bindOutputContext({ ...current, quiet: enabled === true });
}

export function setMachineReadable(enabled) {
  const current = getOutputContext();
  bindOutputContext({ ...current, machineReadable: enabled === true });
}

export function info(message, ...args) {
  const context = getOutputContext();
  if (!context.quiet) {
    const sink = context.machineReadable ? console.error : console.log;
    sink(chalk.blue("ℹ"), message, ...args);
  }
}

export function success(message, ...args) {
  const context = getOutputContext();
  if (!context.quiet) {
    const sink = context.machineReadable ? console.error : console.log;
    sink(chalk.green("✔"), message, ...args);
  }
}

export function warn(message, ...args) {
  // stderr, not stdout: a warning must never interleave with a command's
  // machine-readable stdout (e.g. `--json` payloads), which `| jq` and other
  // consumers parse. Like error(), warn is never gated by quiet mode.
  if (getOutputContext().machineReadable) {
    machineDiagnostic("warning", message, args);
  } else {
    console.error(chalk.yellow("⚠"), message, ...args);
  }
}

export function error(message, ...args) {
  if (getOutputContext().machineReadable) {
    machineDiagnostic("error", message, args);
  } else {
    console.error(chalk.red("✖"), message, ...args);
  }
}

export function verbose(message, ...args) {
  const context = getOutputContext();
  if (context.verbose && !context.quiet) {
    // Verbose output is diagnostic by definition. Keeping it on stderr makes
    // `--json`/`--output-format stream-json` stdout safe to parse.
    console.error(chalk.gray("⋯"), message, ...args);
  }
}

export function log(message, ...args) {
  const context = getOutputContext();
  // Machine-readable payloads are explicit results and must survive --quiet.
  if (!context.quiet || context.machineReadable) {
    console.log(message, ...args);
  }
}

export function newline() {
  const context = getOutputContext();
  if (!context.quiet && !context.machineReadable) {
    console.log();
  }
}

export const logger = {
  info,
  success,
  warn,
  error,
  verbose,
  log,
  newline,
  setVerbose,
  setQuiet,
  setMachineReadable,
};
export default logger;
