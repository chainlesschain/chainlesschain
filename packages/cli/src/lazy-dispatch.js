/**
 * Lazy CLI dispatch - fast path for single commands, full program for help/unknown
 */
import { createProgramAsync } from "./index.js";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(join(__dirname, "command-manifest.json"), "utf8"),
);

/**
 * Run the CLI with lazy dispatch optimization
 * @param {string[]} argv - process.argv
 * @returns {Promise<void>}
 */
/** Return the first top-level command token in a process argv array. */
export function resolveCommandToken(argv = []) {
  const args = Array.isArray(argv) ? argv.slice(2) : [];
  for (const token of args) {
    if (token === "--") return null;
    if (token === "--verbose" || token === "--quiet") continue;
    if (["--help", "-h", "--version", "-v", "-V"].includes(token)) return null;
    if (!token.startsWith("-")) return token;
  }
  return null;
}

export async function runCli(argv) {
  const args = argv.slice(2);

  // Resolve the command before deciding whether help/version needs the eager
  // program. `cc <command> --help` is command-scoped help and must load only
  // that command; treating every `--help` as root help silently discards the
  // command token (and broke `cc agent --help` after lazy dispatch landed).
  const commandName = resolveCommandToken(argv);
  const entry = manifest.commands.find(
    (c) =>
      c.name === commandName || (c.aliases && c.aliases.includes(commandName)),
  );

  // Fast path: if no args, or --help, or --version, use full program
  if (
    args.length === 0 ||
    (!entry &&
      (args.includes("--help") ||
        args.includes("-h") ||
        args.includes("--version") ||
        args.includes("-V")))
  ) {
    const program = await createProgramAsync();
    await program.parseAsync(argv);
    return;
  }

  // Try to find the command in manifest
  // Unknown command, use full program to show error/help
  if (!entry) {
    const program = await createProgramAsync();
    await program.parseAsync(argv);
    return;
  }

  // Known command: lazy-load just that command, create minimal program
  try {
    const { createBaseProgram } = await import("./program-base.js");
    const program = createBaseProgram();

    const modulePath = join(__dirname, entry.module.replace("./", ""));
    const moduleUrl = pathToFileURL(modulePath).href;
    const mod = await import(moduleUrl);
    const registerFn = mod[entry.register];

    if (typeof registerFn !== "function") {
      throw new Error(
        `Register function '${entry.register}' not found in ${entry.module}`,
      );
    }

    registerFn(program);
    await program.parseAsync(argv);
  } catch (err) {
    // Fallback to full program on any error
    if (process.env.DEBUG) {
      console.warn(
        "Lazy dispatch failed, falling back to full program:",
        err.message,
      );
    }
    const program = await createProgramAsync();
    await program.parseAsync(argv);
  }
}

export class LazyDispatch {
  constructor(manifest) {
    this.manifest = manifest;
  }
  matches(argv) {
    return false;
  }
  async spawn(argv) {
    return false;
  }
}
