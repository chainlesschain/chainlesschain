/**
 * Two-phase CLI dispatcher.
 *
 * Phase 0 handles version, root help and default-agent routing with built-in
 * Node modules plus the generated manifest only. Command modules, Commander,
 * the process broker, telemetry and the Event Runtime are loaded afterwards.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { buildHelpDocument, formatRootHelp } from "./cli-help.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(join(__dirname, "command-manifest.json"), "utf8"),
);
const packageMetadata = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf8"),
);

const ROOT_HELP_FLAGS = new Set(["--help", "-h"]);
const ROOT_VERSION_FLAGS = new Set(["--version", "-v", "-V"]);
const GLOBAL_BOOLEAN_FLAGS = new Set(["--verbose", "--quiet"]);
const GLOBAL_VALUE_FLAGS = new Set(["--otlp-endpoint", "--jsii-runtime"]);

function writeLine(stream, value) {
  stream.write(`${value}\n`);
}

function findManifestEntry(commandName, manifestData = manifest) {
  if (!commandName) return null;
  return (
    manifestData.commands.find(
      (entry) =>
        entry.name === commandName || entry.aliases?.includes(commandName),
    ) || null
  );
}

let commandHelpIndex = null;

function readCommandHelp(entry) {
  if (!commandHelpIndex) {
    try {
      commandHelpIndex = JSON.parse(
        readFileSync(join(__dirname, "command-help-index.json"), "utf8"),
      );
    } catch {
      commandHelpIndex = { commands: {} };
    }
  }
  return commandHelpIndex.commands?.[entry?.name] || null;
}

/** Return the first top-level command token in a process argv array. */
export function resolveCommandToken(argv = []) {
  const args = Array.isArray(argv) ? argv.slice(2) : [];
  for (let index = 0; index < args.length; index++) {
    const token = args[index];
    if (token === "--") return null;
    if (GLOBAL_BOOLEAN_FLAGS.has(token)) continue;
    if (GLOBAL_VALUE_FLAGS.has(token)) {
      index++;
      continue;
    }
    if (
      token.startsWith("--otlp-endpoint=") ||
      token.startsWith("--jsii-runtime=")
    ) {
      continue;
    }
    if (ROOT_HELP_FLAGS.has(token) || ROOT_VERSION_FLAGS.has(token))
      return null;
    if (!token.startsWith("-")) return token;
  }
  return null;
}

function hasOnlyGlobalOptions(argv = []) {
  const args = argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    const token = args[index];
    if (GLOBAL_BOOLEAN_FLAGS.has(token)) continue;
    if (GLOBAL_VALUE_FLAGS.has(token)) {
      if (index + 1 >= args.length) return false;
      index++;
      continue;
    }
    if (
      token.startsWith("--otlp-endpoint=") ||
      token.startsWith("--jsii-runtime=")
    ) {
      continue;
    }
    return false;
  }
  return true;
}

function helpRequest(argv, manifestData = manifest) {
  const args = argv.slice(2);
  const commandName = resolveCommandToken(argv);
  if (commandName === "help") {
    const helpIndex = args.indexOf("help");
    const rest = args.slice(helpIndex + 1);
    const requestedCommand = rest.find((token) => !token.startsWith("-"));
    return {
      all: rest.includes("--all") || rest.includes("-a"),
      json: rest.includes("--json"),
      entry: findManifestEntry(requestedCommand, manifestData),
      requestedCommand: requestedCommand || null,
    };
  }
  const entry = findManifestEntry(commandName, manifestData);
  if (entry && args.some((token) => ROOT_HELP_FLAGS.has(token))) {
    const commandIndex = args.indexOf(commandName);
    const hasAdditionalPositional = args
      .slice(commandIndex + 1)
      .some((token) => !token.startsWith("-") && !ROOT_HELP_FLAGS.has(token));
    // The generated index intentionally contains top-level command help only.
    // A positional after the domain may be a nested command (or a command
    // argument), so phase 0 must not replace its help with the parent page.
    // Loading the one manifest registrar remains lazy while allowing Commander
    // to resolve arbitrarily deep `cc <domain> <subcommand> --help` requests.
    if (hasAdditionalPositional) return null;
    return {
      all: false,
      json: args.includes("--json"),
      entry,
      requestedCommand: entry.name,
      direct: true,
    };
  }
  if (
    commandName === null &&
    args.some((token) => ROOT_HELP_FLAGS.has(token))
  ) {
    return {
      all: args.includes("--all") || args.includes("-a"),
      json: args.includes("--json"),
      entry: null,
      requestedCommand: null,
    };
  }
  return null;
}

function rewriteHelpCommand(argv, commandName) {
  const args = argv.slice(2);
  const helpIndex = args.indexOf("help");
  const beforeHelp = args.slice(0, helpIndex);
  const afterCommand = args
    .slice(helpIndex + 1)
    .filter((token) => token !== commandName && token !== "--json");
  return [
    argv[0],
    argv[1],
    ...beforeHelp,
    commandName,
    "--help",
    ...afterCommand,
  ];
}

function appendDefaultCommand(argv, manifestData, prompt = null) {
  const defaultCommand = manifestData?.surface?.defaultCommand || "agent";
  const next = [...argv, defaultCommand];
  // Inline form keeps prompts beginning with '-' from being reinterpreted as
  // another option by Commander after stdin has already been consumed.
  if (prompt !== null) next.push(`--print=${prompt}`);
  return next;
}

function readInput(stream) {
  return new Promise((resolve) => {
    let data = "";
    stream.setEncoding?.("utf8");
    stream.on("data", (chunk) => {
      data += chunk;
    });
    stream.on("end", () => resolve(data));
    stream.on("error", () => resolve(data));
    stream.resume?.();
  });
}

/**
 * Resolve phase-0 requests without importing Commander or any command module.
 * Returns either a handled result or the argv that should enter phase 1.
 */
export async function prepareInvocation(
  argv,
  {
    stdin = process.stdin,
    stdout = process.stdout,
    manifestData = manifest,
    version = packageMetadata.version,
    readStdin = readInput,
  } = {},
) {
  const args = argv.slice(2);
  const commandName = resolveCommandToken(argv);

  if (
    commandName === null &&
    args.some((token) => ROOT_VERSION_FLAGS.has(token))
  ) {
    writeLine(stdout, version);
    return { handled: true, kind: "version" };
  }

  const help = helpRequest(argv, manifestData);
  if (help) {
    if (help.requestedCommand) {
      if (!help.entry) return { handled: false, argv, kind: "unknown-help" };
      if (help.json) {
        const command = buildHelpDocument(manifestData, {
          all: true,
        }).commands.find((candidate) => candidate.name === help.entry.name);
        writeLine(
          stdout,
          JSON.stringify({
            schema: "chainlesschain.command-help.v1",
            command,
          }),
        );
        return { handled: true, kind: "command-help-json" };
      }
      const generatedHelp = readCommandHelp(help.entry);
      if (generatedHelp) {
        stdout.write(
          generatedHelp.endsWith("\n") ? generatedHelp : `${generatedHelp}\n`,
        );
        return { handled: true, kind: "command-help" };
      }
      if (help.direct) {
        return { handled: false, argv, kind: "command-help" };
      }
      return {
        handled: false,
        argv: rewriteHelpCommand(argv, help.requestedCommand),
        kind: "command-help",
      };
    }
    if (help.json) {
      writeLine(stdout, JSON.stringify(buildHelpDocument(manifestData, help)));
    } else {
      stdout.write(formatRootHelp(manifestData, help));
    }
    return { handled: true, kind: help.all ? "help-all" : "help" };
  }

  if (commandName === null && hasOnlyGlobalOptions(argv)) {
    if (stdin.isTTY && stdout.isTTY) {
      return {
        handled: false,
        argv: appendDefaultCommand(argv, manifestData),
        kind: "default-agent",
      };
    }
    if (!stdin.isTTY) {
      const piped = await readStdin(stdin);
      if (piped.trim()) {
        return {
          handled: false,
          argv: appendDefaultCommand(argv, manifestData, piped),
          kind: "default-agent-stdin",
        };
      }
    }
    stdout.write(formatRootHelp(manifestData));
    return { handled: true, kind: "non-interactive-help" };
  }

  return { handled: false, argv, kind: "command" };
}

export async function withDefaultEventRuntimeLifecycle(
  task,
  { hostOptions = {}, runtimeModule = null } = {},
) {
  if (typeof task !== "function") {
    throw new TypeError("Event Runtime lifecycle task must be a function");
  }
  const runtime =
    runtimeModule || (await import("./lib/event-runtime-host.js"));
  const host = runtime.startDefaultEventRuntimeHost({
    ...hostOptions,
    // Let the selected command finish registering its handlers before the
    // first claim. Resident commands then run on the normal interval; short
    // commands receive a bounded final drain in the finally block.
    immediate: false,
  });
  try {
    return await task(host);
  } finally {
    if (host) await runtime.stopDefaultEventRuntimeHost({ drain: true });
  }
}

async function defaultLoadCommandModule(entry) {
  const modulePath = join(__dirname, entry.module.replace("./", ""));
  return import(pathToFileURL(modulePath).href);
}

async function defaultCreateBaseProgram() {
  const { createBaseProgram } = await import("./program-base.js");
  return createBaseProgram();
}

async function defaultLoadFullProgram() {
  const { createProgramAsync } = await import("./index.js");
  return createProgramAsync();
}

/**
 * Load/register may fall back to the compatibility program. parseAsync is
 * intentionally outside that catch: once an action begins, any failure must
 * propagate and the command must never be run for a second time.
 */
export async function dispatchManifestEntry(
  argv,
  entry,
  {
    loadCommandModule = defaultLoadCommandModule,
    createBaseProgram = defaultCreateBaseProgram,
    loadFullProgram = defaultLoadFullProgram,
    stderr = process.stderr,
    env = process.env,
  } = {},
) {
  let program;
  try {
    program = await createBaseProgram();
    const mod = await loadCommandModule(entry);
    const registerFn = mod[entry.register];
    if (typeof registerFn !== "function") {
      throw new Error(
        `Register function '${entry.register}' not found in ${entry.module}`,
      );
    }
    registerFn(program);
  } catch (error) {
    if (env.DEBUG || env.CC_DEBUG) {
      stderr.write(
        `Lazy command registration failed; loading compatibility program: ${error.message}\n`,
      );
    }
    program = await loadFullProgram();
  }

  // Do not wrap this call in the registration fallback above. An action may
  // have already written files, sent a request, or emitted an event.
  await program.parseAsync(argv);
}

export async function dispatchCli(
  argv,
  { manifestData = manifest, ...dispatchOptions } = {},
) {
  const commandName = resolveCommandToken(argv);
  const entry = findManifestEntry(commandName, manifestData);
  if (!entry) {
    const program = await (
      dispatchOptions.loadFullProgram || defaultLoadFullProgram
    )();
    await program.parseAsync(argv);
    return;
  }
  await dispatchManifestEntry(argv, entry, dispatchOptions);
}

export function isFastReadOnlyInvocation(argv, env = process.env) {
  const args = argv.slice(2);
  return (
    resolveCommandToken(argv) === "status" &&
    !args.includes("--deep") &&
    !args.includes("--otlp-endpoint") &&
    !args.some((token) => token.startsWith("--otlp-endpoint=")) &&
    !env.OTEL_EXPORTER_OTLP_ENDPOINT &&
    !env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT &&
    !env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT
  );
}

let processHandlersInstalled = false;

async function initializeCommandRuntime(argv) {
  // The broker must patch child_process before a command graph can cache a
  // native reference. Phase-0 requests execute before this expensive import.
  await import("./lib/process-execution-broker/patch-child-process.js");
  const [{ ensureUtf8 }, observabilityModule, fatalModule] = await Promise.all([
    import("./lib/ensure-utf8.js"),
    import("./lib/observability/index.js"),
    import("./lib/fatal-handler.js"),
  ]);
  ensureUtf8();

  for (const stream of [process.stdout, process.stderr]) {
    if (!stream.isTTY && stream._handle?.setBlocking) {
      stream._handle.setBlocking(true);
    }
  }

  const observability = observabilityModule.initObservability({
    endpoint: observabilityModule.resolveOtlpEndpointFromArgv(argv),
  });
  if (!processHandlersInstalled) {
    fatalModule.installGlobalErrorHandlers(process, async (error) => {
      await observability.shutdown().catch(() => {});
      fatalModule.reportFatal(error);
    });
    processHandlersInstalled = true;
  }
  return observability;
}

async function withInvocationOutputContext(argv, task) {
  const output = await import("./lib/output-context.js");
  const previous = output.getOutputContext();
  const args = argv.slice(2);
  output.bindOutputContext({
    quiet: args.includes("--quiet"),
    verbose: args.includes("--verbose"),
    machineReadable: output.argvRequestsMachineReadableOutput(argv),
  });
  try {
    return await task();
  } finally {
    // Keep diagnostics emitted while the Event Runtime and observability are
    // shutting down under the same contract as the command itself, then put
    // the process singleton back for programmatic/repeated invocations.
    output.bindOutputContext(previous);
  }
}

export async function runCli(argv, options = {}) {
  const prepared = await prepareInvocation(argv, options);
  if (prepared.handled) return;

  const dispatchArgv = prepared.argv;
  return withInvocationOutputContext(dispatchArgv, async () => {
    const commandHelp =
      prepared.kind === "command-help" ||
      dispatchArgv.slice(2).some((token) => ROOT_HELP_FLAGS.has(token));
    if (commandHelp) {
      await dispatchCli(dispatchArgv, options);
      return;
    }

    // Quick status performs filesystem/PID/PATH/TCP reads only. Keeping it in
    // phase 1 avoids initializing the process sandbox and telemetry solely to
    // report that those services are absent. --deep and explicit OTLP probes
    // still enter the full managed runtime below.
    if (isFastReadOnlyInvocation(dispatchArgv)) {
      await dispatchCli(dispatchArgv, options);
      return;
    }

    const observability = await initializeCommandRuntime(dispatchArgv);
    try {
      return await withDefaultEventRuntimeLifecycle(
        () => dispatchCli(dispatchArgv, options),
        options,
      );
    } finally {
      await observability.shutdown().catch(() => {});
    }
  });
}
