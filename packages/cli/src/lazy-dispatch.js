/**
 * Lazy CLI dispatch - fast path for single commands, full program for help/unknown
 */
import { createProgramAsync } from "./index.js";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import manifest from "./command-manifest.json" assert { type: "json" };

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Run the CLI with lazy dispatch optimization
 * @param {string[]} argv - process.argv
 * @returns {Promise<void>}
 */
export async function runCli(argv) {
  const args = argv.slice(2);

  // Fast path: if no args, or --help, or --version, use full program
  if (
    args.length === 0 ||
    args.includes("--help") ||
    args.includes("-h") ||
    args.includes("--version") ||
    args.includes("-V")
  ) {
    const program = await createProgramAsync();
    await program.parseAsync(argv);
    return;
  }

  // Try to find the command in manifest
  const commandName = args[0];
  const entry = manifest.commands.find(
    (c) =>
      c.name === commandName || (c.aliases && c.aliases.includes(commandName)),
  );

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
