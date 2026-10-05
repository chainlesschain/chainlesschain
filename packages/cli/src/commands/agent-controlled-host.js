import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  normalizeAgentSandbox,
  assertSandboxCapabilities,
  assertSandboxAvailable,
} from "../lib/agent-sandbox.js";
import { isFormalQualityHermeticRuntime } from "../lib/formal-quality-eval-runtime.js";
import { resolveCredentialEnvironmentValue } from "../lib/process-execution-broker/credential-transport.js";

const MAX_JSON_BYTES = 1024 * 1024;

function invalid(message, code = "CC_CONTROLLED_HOST_INVALID") {
  return Object.assign(new Error(message), { code });
}

/** Read one bounded regular file through its opened identity, never create it. */
function readJson(file) {
  if (typeof file !== "string" || !path.isAbsolute(file))
    throw invalid("Controlled-host JSON paths must be absolute");
  const before = fs.lstatSync(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink())
    throw invalid("Controlled-host JSON must be a regular non-symlink file");
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size < 1n ||
      opened.size > BigInt(MAX_JSON_BYTES)
    )
      throw invalid("Controlled-host JSON identity or size is invalid");
    const bytes = Buffer.alloc(Number(opened.size) + 1);
    let size = 0;
    while (size < bytes.length) {
      const read = fs.readSync(fd, bytes, size, bytes.length - size, null);
      if (!read) break;
      size += read;
    }
    const after = fs.fstatSync(fd, { bigint: true });
    if (
      BigInt(size) !== opened.size ||
      after.size !== opened.size ||
      after.mtimeNs !== opened.mtimeNs ||
      after.ctimeNs !== opened.ctimeNs
    )
      throw invalid("Controlled-host JSON changed while reading");
    const value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size)),
    );
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw invalid("Controlled-host JSON must contain an object");
    return value;
  } finally {
    fs.closeSync(fd);
  }
}

/** Explicit one-shot entry. Provisioning is deliberately not available here. */
export async function runControlledHost(options, dependencies = {}) {
  const platform = dependencies.platform ?? process.platform;
  if (platform !== "linux")
    throw invalid(
      "Controlled-host permission authority requires Linux",
      "CC_SETTINGS_AUTHORITY_PLATFORM_UNSUPPORTED",
    );
  const env = dependencies.env ?? process.env;
  if (isFormalQualityHermeticRuntime(env))
    throw invalid(
      "Controlled-host authority cannot run in a hermetic evaluator that suppresses permission providers",
    );
  if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(options.context || ""))
    throw invalid("An explicit controlled-host context is required");
  if (
    (options.check === true) ===
    (typeof options.prompt === "string" && options.prompt.trim().length > 0)
  )
    throw invalid("Choose exactly one of --check or a non-empty --prompt");
  if (
    !options.check &&
    ["provider", "model", "baseUrl"].some(
      (key) => typeof options[key] !== "string" || !options[key].trim(),
    )
  )
    throw invalid("A run requires explicit --provider, --model and --base-url");
  const maxTurns =
    options.maxTurns === undefined ? 10 : Number(options.maxTurns);
  if (!Number.isSafeInteger(maxTurns) || maxTurns < 1 || maxTurns > 100)
    throw invalid("--max-turns must be an integer from 1 to 100");
  if (!["text", "json", "stream-json"].includes(options.outputFormat || "text"))
    throw invalid("--output-format must be text, json or stream-json");
  const cwd = dependencies.cwd ?? process.cwd();
  const launch = readJson(options.launch);
  const settings = readJson(options.sandboxSettings);
  if (settings.engine !== "docker-egress" || settings.enabled === false)
    throw invalid(
      "Controlled-host entry requires enabled docker-egress sandbox settings",
    );
  const sandbox = normalizeAgentSandbox(true, { cwd, settings, network: true });
  assertSandboxCapabilities(sandbox, {
    host: { platform, arch: process.arch, release: os.release() },
  });
  const open =
    dependencies.openHost ??
    (await import("../runtime/permission-authority-host.js"))
      .openPermissionAuthorityHost;
  const host = open({ launch, contextId: options.context, env });
  try {
    // Reopening never provisions; runtimeOptions checks the actual invocation
    // workspace and rejects writable roots overlapping the fixed authority.
    host.runtimeOptions({ cwd, sandbox });
    if (options.check) {
      const capabilities = host.capabilities(sandbox);
      const report = {
        schema: "chainlesschain.controlled-host-check/v1",
        authorityIdentityVerified: true,
        backendExecutionVerified: false,
        backendAvailabilityProbed: false,
        capabilities,
      };
      (dependencies.writeOut ?? ((text) => process.stdout.write(text)))(
        JSON.stringify(report) + "\n",
      );
      return { exitCode: 0, report };
    }
    // Availability is checked before resolving credentials or calling a model.
    (dependencies.assertAvailable ?? assertSandboxAvailable)(sandbox);
    let apiKey;
    if (options.apiKeyEnv) {
      apiKey = await resolveCredentialEnvironmentValue(options.apiKeyEnv, {
        env,
      });
      if (!apiKey)
        throw invalid("The selected API key environment source is unavailable");
    }
    return await host.runHeadless(
      {
        cwd,
        sandbox,
        prompt: options.prompt,
        provider: options.provider,
        model: options.model,
        baseUrl: options.baseUrl,
        apiKey,
        maxTurns,
        outputFormat: options.outputFormat || "text",
        permissionMode: "dontAsk",
        useRegisteredMcp: false,
        strictMcpConfig: true,
        ide: false,
        pdh: false,
        jetbrains: false,
        slashMacros: false,
        expandFileRefs: false,
      },
      dependencies.runtimeDependencies,
    );
  } finally {
    host.close();
  }
}

export function registerControlledHostCommand(agent, dependencies = {}) {
  agent
    .command("controlled-host")
    .description(
      "Run against a pre-provisioned Linux permission authority (one-shot, dontAsk)",
    )
    .requiredOption(
      "--launch <file>",
      "Absolute pre-provisioned launch descriptor JSON",
    )
    .requiredOption("--context <id>", "Exact provisioned workspace context ID")
    .requiredOption(
      "--sandbox-settings <file>",
      "Absolute docker-egress sandbox settings JSON",
    )
    .option(
      "--check",
      "Verify configuration and authority identity only; no backend or model execution",
    )
    .option(
      "--prompt <text>",
      "Run one headless task in the bound current workspace",
    )
    .option("--provider <name>", "Explicit model provider")
    .option("--model <name>", "Explicit model name")
    .option("--base-url <url>", "Explicit provider endpoint")
    .option(
      "--api-key-env <name>",
      "Credential environment variable or broker reference",
    )
    .option("--max-turns <n>", "Maximum task turns, 1-100", "10")
    .option("--output-format <format>", "text | json | stream-json", "text")
    .action(async (options, command) => {
      try {
        // Parent agent flags are a different launch contract. Never silently
        // ignore a supplied --yolo, --bg, --settings or model override there.
        if (
          agent.options.some(
            (option) =>
              agent.getOptionValueSource(option.attributeName()) === "cli",
          )
        )
          throw invalid(
            "Place only controlled-host options after the subcommand; parent agent flags are unsupported",
          );
        const outcome = await runControlledHost(command.opts(), dependencies);
        process.exitCode = outcome.exitCode;
      } catch (error) {
        process.stderr.write(
          `${error.code || "CC_CONTROLLED_HOST_FAILED"}: ${error.message}\n`,
        );
        process.exitCode = 1;
      }
    });
}
