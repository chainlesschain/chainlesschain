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
import {
  buildHelpDocument,
  buildNamespaceHelpDocument,
  formatNamespaceHelp,
  formatRootHelp,
} from "./cli-help.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(join(__dirname, "command-manifest.json"), "utf8"),
);
const packageMetadata = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf8"),
);

const ROOT_HELP_FLAGS = new Set(["--help", "-h"]);
const ROOT_VERSION_FLAGS = new Set(["--version", "-v", "-V"]);
const HELP_CONTROL_FLAGS = new Set(["--all", "-a", "--json"]);

/**
 * Dependency-free mirror of program-base.js' Commander root options. Tests
 * compare names and arity against createBaseProgram(), so phase 0 cannot
 * silently widen this allowlist or drift from phase 1.
 */
export const PHASE_ZERO_GLOBAL_OPTION_SCHEMA = Object.freeze([
  Object.freeze({ flag: "--verbose", arity: 0 }),
  Object.freeze({ flag: "--quiet", arity: 0 }),
  Object.freeze({
    flag: "--jsii-runtime",
    arity: 1,
    allowedValues: Object.freeze(["native", "quickjs"]),
  }),
  Object.freeze({
    flag: "--otlp-endpoint",
    arity: 1,
    allowedProtocols: Object.freeze(["http:", "https:"]),
  }),
]);

const GLOBAL_OPTION_BY_FLAG = new Map(
  PHASE_ZERO_GLOBAL_OPTION_SCHEMA.map((option) => [option.flag, option]),
);

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

function validateGlobalOptionValue(option, value) {
  if (typeof value !== "string" || value.length === 0) {
    return `Global option '${option.flag}' requires a value`;
  }
  if (option.allowedValues && !option.allowedValues.includes(value)) {
    return (
      `Global option '${option.flag}' must be one of: ` +
      option.allowedValues.join(", ")
    );
  }
  if (option.allowedProtocols) {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      return `Global option '${option.flag}' requires an absolute http(s) URL`;
    }
    if (
      !option.allowedProtocols.includes(parsed.protocol) ||
      !parsed.hostname
    ) {
      return `Global option '${option.flag}' requires an absolute http(s) URL`;
    }
  }
  return null;
}

function consumeGlobalOption(argv, index) {
  const token = argv[index];
  const equalsIndex = token.indexOf("=");
  const flag = equalsIndex < 0 ? token : token.slice(0, equalsIndex);
  const option = GLOBAL_OPTION_BY_FLAG.get(flag);
  if (!option) return null;

  if (option.arity === 0) {
    return {
      nextIndex: index + 1,
      error:
        equalsIndex < 0
          ? null
          : `Global option '${option.flag}' does not accept a value`,
    };
  }

  if (equalsIndex >= 0) {
    return {
      nextIndex: index + 1,
      error: validateGlobalOptionValue(option, token.slice(equalsIndex + 1)),
    };
  }

  const value = argv[index + 1];
  if (typeof value !== "string" || value.startsWith("-")) {
    return {
      nextIndex: index + 1,
      error: `Global option '${option.flag}' requires a value`,
    };
  }
  return {
    nextIndex: index + 2,
    error: validateGlobalOptionValue(option, value),
  };
}

function scanLeadingCommand(argv = []) {
  let firstError = null;
  for (let index = 2; index < argv.length;) {
    const token = argv[index];
    if (token === "--") return { location: null, error: firstError };
    if (ROOT_HELP_FLAGS.has(token) || ROOT_VERSION_FLAGS.has(token)) {
      return { location: null, error: firstError };
    }
    const globalOption = consumeGlobalOption(argv, index);
    if (globalOption) {
      firstError ||= globalOption.error;
      index = globalOption.nextIndex;
      continue;
    }
    if (token.startsWith("-")) {
      firstError ||= `Unknown global option '${token}'`;
      index++;
      continue;
    }
    return { location: { index, token }, error: firstError };
  }
  return { location: null, error: firstError };
}

function findCommandTokenLocation(argv = []) {
  return scanLeadingCommand(argv).location;
}

function commandNamespace(manifestData, name) {
  return (manifestData?.surface?.namespaces || []).find(
    (candidate) => candidate.name === name,
  );
}

function findHelpSubjectLocation(argv, helpIndex) {
  let firstError = null;
  for (let index = helpIndex + 1; index < argv.length;) {
    const token = argv[index];
    if (token === "--") return { location: null, error: firstError };
    if (
      HELP_CONTROL_FLAGS.has(token) ||
      ROOT_HELP_FLAGS.has(token) ||
      ROOT_VERSION_FLAGS.has(token)
    ) {
      index++;
      continue;
    }
    const globalOption = consumeGlobalOption(argv, index);
    if (globalOption) {
      firstError ||= globalOption.error;
      index = globalOption.nextIndex;
      continue;
    }
    if (token.startsWith("-")) {
      firstError ||= `Unknown global option '${token}'`;
      index++;
      continue;
    }
    return { location: { index, token }, error: firstError };
  }
  return { location: null, error: firstError };
}

function namespaceEntry(manifestData, namespace, target) {
  if (!namespace?.commands?.includes(target)) return null;
  const entry = findManifestEntry(target, manifestData);
  if (!entry || entry.replacement !== `${namespace.name} ${entry.name}`) {
    return null;
  }
  return entry;
}

function scanNamespaceTarget(
  argv,
  namespaceIndex,
  { helpInvocation = false } = {},
) {
  for (let index = namespaceIndex + 1; index < argv.length;) {
    const token = argv[index];
    if (token === "--") {
      return {
        error: "'--' may only appear after a lab command target",
      };
    }
    if (ROOT_HELP_FLAGS.has(token)) return { help: true };
    if (ROOT_VERSION_FLAGS.has(token)) return { version: true };
    if (HELP_CONTROL_FLAGS.has(token)) {
      if (helpInvocation) {
        index++;
        continue;
      }
      return {
        error: `Option '${token}' must follow a lab command target`,
      };
    }
    const globalOption = consumeGlobalOption(argv, index);
    if (globalOption) {
      if (globalOption.error) return { error: globalOption.error };
      index = globalOption.nextIndex;
      continue;
    }
    if (token.startsWith("-")) {
      return { error: `Unknown option '${token}' before lab command target` };
    }
    return { index, target: token };
  }
  return { help: true };
}

function rewriteNamespaceArgv(argv, namespaceIndex, targetIndex, target) {
  return [
    ...argv.slice(0, namespaceIndex),
    ...argv.slice(namespaceIndex + 1, targetIndex),
    target,
    ...argv.slice(targetIndex + 1),
  ];
}

function namespaceError(message) {
  return {
    kind: "namespace-error",
    message: `${message}. Run 'cc lab --help' for available commands.`,
  };
}

/**
 * Resolve virtual compatibility namespaces before Commander is imported.
 * Rewrites only argv; the selected legacy manifest entry and registrar remain
 * the sole route that can execute the action.
 */
export function resolveCommandLifecycleInvocation(
  argv,
  manifestData = manifest,
) {
  const leading = scanLeadingCommand(argv);
  const location = leading.location;
  const args = argv.slice(2);
  const endOfOptions = args.indexOf("--");
  if (!location) {
    if (endOfOptions >= 0 && args[endOfOptions + 1] === "lab") {
      return namespaceError("The lab namespace must appear before '--'");
    }
    return { kind: "passthrough", argv };
  }

  if (location.token === "help") {
    const subjectScan = findHelpSubjectLocation(argv, location.index);
    const subject = subjectScan.location;
    if (!subject) return { kind: "passthrough", argv };
    const namespaceIndex = subject.index;
    const namespace = commandNamespace(manifestData, subject.token);
    if (!namespace) return { kind: "passthrough", argv };
    if (leading.error || subjectScan.error) {
      return namespaceError(leading.error || subjectScan.error);
    }
    const target = scanNamespaceTarget(argv, namespaceIndex, {
      helpInvocation: true,
    });
    if (target.error) return namespaceError(target.error);
    if (target.help || target.version) {
      return {
        kind: "namespace-help",
        namespace,
        json: args.includes("--json"),
      };
    }
    const entry = namespaceEntry(manifestData, namespace, target.target);
    if (!entry) {
      return namespaceError(
        `Unknown ${namespace.name} command '${target.target}'`,
      );
    }
    return {
      kind: "namespace-rewrite",
      namespace,
      entry,
      argv: rewriteNamespaceArgv(
        argv,
        namespaceIndex,
        target.index,
        entry.name,
      ),
    };
  }

  const namespace = commandNamespace(manifestData, location.token);
  if (!namespace) return { kind: "passthrough", argv };
  if (leading.error) return namespaceError(leading.error);
  const target = scanNamespaceTarget(argv, location.index);
  if (target.error) return namespaceError(target.error);
  if (target.version) return { kind: "namespace-version", namespace };
  if (target.help) {
    return { kind: "namespace-help", namespace, json: args.includes("--json") };
  }
  const entry = namespaceEntry(manifestData, namespace, target.target);
  if (!entry) {
    return namespaceError(
      `Unknown ${namespace.name} command '${target.target}'`,
    );
  }
  return {
    kind: "namespace-rewrite",
    namespace,
    entry,
    argv: rewriteNamespaceArgv(argv, location.index, target.index, entry.name),
  };
}

/**
 * Build the bounded, content-free lifecycle usage dimensions for a migrated
 * command. The original argv is inspected only to distinguish the retained
 * top-level spelling from its virtual namespace replacement; arguments and
 * nested command names are never copied into telemetry.
 */
export function resolveCommandLifecycleTelemetry(
  argv,
  manifestData = manifest,
) {
  const invocation = resolveCommandLifecycleInvocation(argv, manifestData);
  let entry = null;
  let route = null;
  if (invocation.kind === "namespace-rewrite") {
    entry = invocation.entry;
    route = "replacement";
  } else if (invocation.kind === "passthrough") {
    const commandName = resolveCommandToken(argv);
    entry = findManifestEntry(commandName, manifestData);
    route = "legacy";
  }
  if (
    entry?.lifecycle?.state !== "deprecated" ||
    typeof entry.name !== "string" ||
    !entry.replacement
  ) {
    return null;
  }
  return Object.freeze({
    command: entry.name,
    route,
    version: packageMetadata.version,
    deprecatedSince: entry.lifecycle.deprecatedSince,
    removalNotBefore: entry.lifecycle.removalNotBefore,
  });
}

export function formatCommandDeprecationWarning(entry, invokedName) {
  const lifecycle = entry?.lifecycle;
  if (lifecycle?.state !== "deprecated" || !entry.replacement) return null;
  return (
    `Deprecated command 'cc ${invokedName}' (since ${lifecycle.deprecatedSince}); ` +
    `use 'cc ${entry.replacement}'. Removal will not occur before ` +
    `${lifecycle.removalNotBefore} (${lifecycle.minimumReleaseCycles} ` +
    `${lifecycle.releaseCycle} release cycles).`
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
  return findCommandTokenLocation(argv)?.token || null;
}

function hasOnlyGlobalOptions(argv = []) {
  for (let index = 2; index < argv.length;) {
    const globalOption = consumeGlobalOption(argv, index);
    if (!globalOption || globalOption.error) return false;
    index = globalOption.nextIndex;
  }
  return true;
}

function helpRequest(argv, manifestData = manifest) {
  const args = argv.slice(2);
  const commandName = resolveCommandToken(argv);
  if (commandName === "help") {
    const helpIndex = args.indexOf("help");
    const rest = args.slice(helpIndex + 1);
    const subjectScan = findHelpSubjectLocation(argv, helpIndex + 2);
    if (subjectScan.error) return null;
    const requestedCommand = subjectScan.location?.token;
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
    stderr = process.stderr,
    manifestData = manifest,
    version = packageMetadata.version,
    readStdin = readInput,
  } = {},
) {
  const lifecycleInvocation = resolveCommandLifecycleInvocation(
    argv,
    manifestData,
  );
  if (lifecycleInvocation.kind === "namespace-error") {
    writeLine(stderr, lifecycleInvocation.message);
    return { handled: true, kind: "namespace-error", exitCode: 1 };
  }
  if (lifecycleInvocation.kind === "namespace-version") {
    writeLine(stdout, version);
    return { handled: true, kind: "version" };
  }
  if (lifecycleInvocation.kind === "namespace-help") {
    if (lifecycleInvocation.json) {
      writeLine(
        stdout,
        JSON.stringify(
          buildNamespaceHelpDocument(
            manifestData,
            lifecycleInvocation.namespace.name,
          ),
        ),
      );
    } else {
      stdout.write(
        formatNamespaceHelp(manifestData, lifecycleInvocation.namespace.name),
      );
    }
    return { handled: true, kind: "namespace-help" };
  }

  argv = lifecycleInvocation.argv;
  const args = argv.slice(2);
  const commandName = resolveCommandToken(argv);

  if (lifecycleInvocation.kind !== "namespace-rewrite") {
    const invokedEntry = findManifestEntry(commandName, manifestData);
    const warning = formatCommandDeprecationWarning(invokedEntry, commandName);
    if (warning) writeLine(stderr, warning);
  }

  if (
    commandName === null &&
    args.some((token) => ROOT_VERSION_FLAGS.has(token))
  ) {
    writeLine(stdout, version);
    return { handled: true, kind: "version" };
  }

  const help = helpRequest(argv, manifestData);
  if (help) {
    if (
      lifecycleInvocation.kind !== "namespace-rewrite" &&
      commandName === "help" &&
      help.entry
    ) {
      const warning = formatCommandDeprecationWarning(
        help.entry,
        help.requestedCommand,
      );
      if (warning) writeLine(stderr, warning);
    }
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

async function defaultLoadCommandDependencies(commandName) {
  const { loadEvolutionDeploymentCommandDependencies } =
    await import("./lib/evolution/evolution-deployment-loader.js");
  return loadEvolutionDeploymentCommandDependencies(commandName);
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
    loadCommandDependencies = defaultLoadCommandDependencies,
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
    const dependencies = await loadCommandDependencies(entry.name);
    registerFn(program, dependencies ?? undefined);
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
  let entry = findManifestEntry(commandName, manifestData);
  if (!entry) {
    const program = await (
      dispatchOptions.loadFullProgram || defaultLoadFullProgram
    )();
    await program.parseAsync(argv);
    return;
  }
  const commandLocation = findCommandTokenLocation(argv);
  if (entry.name === "session" && argv[commandLocation?.index + 1] === "show") {
    entry = {
      ...entry,
      module: "./commands/session-show.js",
      register: "registerSessionShowCommand",
    };
  }
  await dispatchManifestEntry(argv, entry, dispatchOptions);
}

export function isFastReadOnlyInvocation(argv, env = process.env) {
  const args = argv.slice(2);
  const explicitOtlp =
    args.includes("--otlp-endpoint") ||
    args.some((token) => token.startsWith("--otlp-endpoint=")) ||
    env.OTEL_EXPORTER_OTLP_ENDPOINT ||
    env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
    env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT;
  const quickStatus =
    resolveCommandToken(argv) === "status" &&
    !args.includes("--deep") &&
    !explicitOtlp;
  const commandLocation = findCommandTokenLocation(argv);
  const sessionShow =
    commandLocation?.token === "session" &&
    argv[commandLocation.index + 1] === "show" &&
    !explicitOtlp;
  return quickStatus || sessionShow;
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
  const lifecycleTelemetry = resolveCommandLifecycleTelemetry(
    argv,
    options.manifestData || manifest,
  );
  const prepared = await prepareInvocation(argv, options);
  if (prepared.handled) {
    if (prepared.exitCode) {
      if (typeof options.setExitCode === "function") {
        options.setExitCode(prepared.exitCode);
      } else {
        process.exitCode = prepared.exitCode;
      }
    }
    return;
  }

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
    const lifecycleStartedAt = performance.now();
    let lifecycleOutcome = "completed";
    try {
      return await withDefaultEventRuntimeLifecycle(
        () => dispatchCli(dispatchArgv, options),
        options,
      );
    } catch (error) {
      lifecycleOutcome = "error";
      throw error;
    } finally {
      if (lifecycleTelemetry) {
        observability.exportCommandLifecycleInvocation({
          ...lifecycleTelemetry,
          outcome: lifecycleOutcome,
          durationMs: performance.now() - lifecycleStartedAt,
        });
      }
      await observability.shutdown().catch(() => {});
    }
  });
}
