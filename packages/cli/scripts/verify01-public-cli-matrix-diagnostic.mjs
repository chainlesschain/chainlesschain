#!/usr/bin/env node
/** Real public CLI onboarding on native hosts; never formal VERIFY01 evidence. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { runCaptured } from "./verify01-first-run-cli-diagnostic.mjs";
import { LLM_PROBE_SCHEMA } from "../src/lib/llm-connection-probe.js";
import {
  DIAGNOSTIC,
  inspectModelTrace,
} from "./verify01-volcengine-task-diagnostic.mjs";
import {
  BROKER,
  createVolcengineDiagnosticBroker,
} from "./verify01-volcengine-diagnostic-broker.mjs";

export const AUTHENTICATION_NODE_FLAGS = Object.freeze([
  "--enable-network-family-autoselection",
  "--network-family-autoselection-attempt-timeout=2000",
]);

export function npmEntrypoint(execPath = process.execPath) {
  const directory = path.dirname(execPath);
  const candidates = [
    process.env.npm_execpath,
    path.join(directory, "node_modules/npm/bin/npm-cli.js"),
    path.resolve(directory, "../lib/node_modules/npm/bin/npm-cli.js"),
  ].filter(Boolean);
  const found = candidates.find((file) => fs.existsSync(file));
  assert.ok(found, "npm CLI entrypoint not found beside installed Node");
  return found;
}

export function validateArtifact(workspace, nonce) {
  const target = path.join(workspace, "result.json");
  const stat = fs.lstatSync(target);
  assert.ok(
    stat.isFile() && !stat.isSymbolicLink(),
    "artifact must be a regular file",
  );
  assert.ok(stat.size < 4096, "artifact too large");
  const bytes = fs.readFileSync(target);
  const result = JSON.parse(bytes.toString("utf8"));
  assert.deepEqual(result, { nonce, sum: 23, sorted: [2, 4, 8, 9] });
  return {
    passed: true,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
  };
}

export async function runPublicCliMatrix({
  outputDir,
  confirmLive,
  key = process.env.VOLCENGINE_API_KEY,
}) {
  assert.equal(confirmLive, true, "--confirm-live required");
  assert.ok(key?.trim(), "VOLCENGINE_API_KEY required");
  const output = path.resolve(outputDir);
  assert.ok(!fs.existsSync(output), "output directory must be new");
  fs.mkdirSync(output, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "cc-public-cli-"));
  const directories = Object.fromEntries(
    [
      "home",
      "tmp",
      "profile",
      "install",
      "workspace",
      "cache",
      "appdata",
      "localappdata",
    ].map((name) => [name, path.join(scratch, name)]),
  );
  for (const directory of Object.values(directories)) fs.mkdirSync(directory);
  const npmrc = path.join(scratch, "npmrc");
  fs.writeFileSync(npmrc, "");
  const env = {
    PATH: process.env.PATH,
    HOME: directories.home,
    USERPROFILE: directories.home,
    TMPDIR: directories.tmp,
    TMP: directories.tmp,
    TEMP: directories.tmp,
    APPDATA: directories.appdata,
    LOCALAPPDATA: directories.localappdata,
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    ...(process.env.ComSpec ? { ComSpec: process.env.ComSpec } : {}),
    CHAINLESSCHAIN_HOME: directories.profile,
    XDG_CONFIG_HOME: path.join(directories.home, "config"),
    XDG_CACHE_HOME: directories.cache,
    npm_config_userconfig: npmrc,
    npm_config_globalconfig: path.join(scratch, "global-npmrc"),
    npm_config_cache: directories.cache,
    npm_config_registry: "https://registry.npmjs.org",
    CC_UPDATE_NOTICE: "0",
    CI: "true",
    NO_COLOR: "1",
    LANG: "C.UTF-8",
    CC_MAX_RETRIES: "0",
    CLAUDE_CODE_MAX_RETRIES: "0",
    ...(process.platform === "win32"
      ? { CC_SECURE_FS_WINDOWS_ACL_TIMEOUT_MS: "60000" }
      : {}),
  };
  fs.writeFileSync(env.npm_config_globalconfig, "");
  const taskId = `first-run-${process.platform}-cli`;
  const summary = {
    schema: "chainlesschain.public-cli-first-run-matrix/v1",
    taskId,
    formalSample: false,
    independentHumanReview: false,
    scope:
      "native-host public npm CLI installation, configuration, authentication and simple file-tool artifact",
    limitations: [
      "Not an IDE journey or frozen VERIFY01 task",
      "Tool stage uses diagnostic transport with thinking disabled",
      "No native database backend claim",
    ],
    platform: process.platform,
    arch: process.arch,
    release: os.release(),
    node: process.version,
    version: DIAGNOSTIC.publicVersion,
    sourceCommit: process.env.GITHUB_SHA || null,
    startedAt: new Date().toISOString(),
    stages: {},
    passed: false,
  };
  const save = (name, value) =>
    fs.writeFileSync(
      path.join(output, name),
      JSON.stringify(value, null, 2) + "\n",
      { flag: "wx" },
    );
  const run = async (
    name,
    args,
    {
      cwd = directories.install,
      environment = env,
      secret = key,
      timeout = 120000,
    } = {},
  ) => {
    const result = await runCaptured(process.execPath, args, {
      cwd,
      env: environment,
      secret,
      deadline: Date.now() + timeout,
      outputPrefix: path.join(output, "commands", name),
    });
    assert.ok(result.ok, `${name} failed; see preserved process receipt`);
    return result;
  };
  let broker;
  try {
    fs.writeFileSync(
      path.join(directories.install, "package.json"),
      '{"private":true}\n',
    );
    await run(
      "install",
      [
        npmEntrypoint(),
        "install",
        `chainlesschain@${DIAGNOSTIC.publicVersion}`,
        "--omit=dev",
        "--no-audit",
        "--no-fund",
        "--registry=https://registry.npmjs.org",
      ],
      { timeout: 600000 },
    );
    const cliRoot = path.join(
      directories.install,
      "node_modules/chainlesschain",
    );
    const manifest = JSON.parse(
      fs.readFileSync(path.join(cliRoot, "package.json"), "utf8"),
    );
    assert.equal(manifest.version, DIAGNOSTIC.publicVersion);
    const lockBytes = fs.readFileSync(
      path.join(directories.install, "package-lock.json"),
    );
    fs.writeFileSync(path.join(output, "package-lock.json"), lockBytes, {
      flag: "wx",
    });
    const locked =
      JSON.parse(lockBytes).packages["node_modules/chainlesschain"];
    assert.equal(locked.version, DIAGNOSTIC.publicVersion);
    assert.ok(
      !locked.link &&
        locked.resolved.startsWith("https://registry.npmjs.org/") &&
        locked.integrity,
    );
    const cli = path.join(cliRoot, "bin/chainlesschain.js");
    await run("identity", [cli, "--version"]);
    summary.stages.install = {
      passed: true,
      lifecycleScriptsEnabled: true,
      locked,
    };
    if (process.platform === "win32") {
      const acl = await run("windows-acl-allowance-preflight", [
        "--input-type=module",
        "--eval",
        "const api=await import(process.argv[1]);console.log(JSON.stringify({timeoutMs:api._resolveWindowsAclTimeout(15000)}));",
        pathToFileURL(path.join(cliRoot, "src/lib/secure-fs.js")).href,
      ]);
      const actual = JSON.parse(acl.stdout);
      assert.equal(actual.timeoutMs, 60000);
      summary.windowsAclAllowanceOverride = {
        ...actual,
        environmentVariable: "CC_SECURE_FS_WINDOWS_ACL_TIMEOUT_MS",
        defaultRepairTimeoutMs: 15000,
        verificationUnchanged: true,
        automaticRetry: false,
      };
    }
    for (const [field, value] of Object.entries({
      provider: DIAGNOSTIC.provider,
      model: BROKER.model,
      baseUrl: DIAGNOSTIC.endpoint,
    }))
      await run(`configure-${field}`, [
        cli,
        "config",
        "set",
        `llm.${field}`,
        value,
      ]);
    const readback = await run("configure-readback", [
      cli,
      "config",
      "get",
      "llm",
      "--json",
    ]);
    const configured = JSON.parse(readback.stdout).value;
    assert.equal(configured.provider, DIAGNOSTIC.provider);
    assert.equal(configured.model, BROKER.model);
    assert.equal(configured.baseUrl, DIAGNOSTIC.endpoint);
    summary.stages.configure = {
      passed: true,
      configured,
      credentialsPersisted: false,
    };
    const transportCheck = await run("authentication-transport-preflight", [
      ...AUTHENTICATION_NODE_FLAGS,
      "--input-type=module",
      "--eval",
      "import net from 'node:net'; console.log(JSON.stringify({node:process.version,autoSelectFamily:net.getDefaultAutoSelectFamily(),attemptTimeoutMs:net.getDefaultAutoSelectFamilyAttemptTimeout()}));",
    ]);
    const transport = JSON.parse(transportCheck.stdout);
    assert.equal(transport.autoSelectFamily, true);
    assert.equal(transport.attemptTimeoutMs, 2000);
    summary.authenticationTransportOverride = {
      ...transport,
      flags: AUTHENTICATION_NODE_FLAGS,
      scope: "authentication child connection establishment only",
      httpReplay: false,
      originalFailuresPreserved: true,
    };
    const auth = await run(
      "authenticate",
      [...AUTHENTICATION_NODE_FLAGS, cli, "llm", "test", "--json"],
      {
        environment: { ...env, VOLCENGINE_API_KEY: key },
        timeout: 90000,
      },
    );
    const probe = JSON.parse(auth.stdout.trim());
    assert.equal(probe.schema, LLM_PROBE_SCHEMA);
    assert.equal(probe.provider, DIAGNOSTIC.provider);
    assert.equal(probe.model, BROKER.model);
    assert.equal(probe.ok, true);
    assert.ok(
      probe.usage &&
        [
          "input_tokens",
          "output_tokens",
          "cache_read_input_tokens",
          "cache_creation_input_tokens",
        ].every(
          (name) =>
            Number.isSafeInteger(probe.usage[name]) && probe.usage[name] >= 0,
        ),
      "authentication usage not established; no further model request",
    );
    summary.stages.authenticate = {
      passed: true,
      usage: probe.usage,
      receipt: "commands/authenticate.stdout.log",
    };
    broker = await createVolcengineDiagnosticBroker({
      outputDir: path.join(output, "broker"),
      key,
      allowedTaskIds: [taskId],
      maximumRequestsPerTask: 14,
    });
    broker.beginTask(taskId);
    const nonce = randomBytes(12).toString("hex");
    const input = { nonce, values: [9, 2, 8, 4] };
    fs.writeFileSync(
      path.join(directories.workspace, "input.json"),
      JSON.stringify(input),
    );
    save("input.json", input);
    const prompt =
      "Read input.json using read_file. Write result.json using write_file with exactly three JSON fields: nonce copied from input, sum of values, and sorted containing values in ascending numerical order. Do not modify input.json. Use only file tools, then finish with a short statement. No shell or network calls.";
    const model = await run(
      "tool",
      [
        cli,
        "agent",
        "-p",
        prompt,
        "--provider",
        DIAGNOSTIC.provider,
        "--model",
        BROKER.model,
        "--base-url",
        broker.baseUrl,
        "--permission-mode",
        "acceptEdits",
        "--output-format",
        "stream-json",
        "--max-turns",
        "14",
        "--allowed-tools",
        "read_file,search_files,list_dir,write_file,edit_file,edit_file_hashed",
        "--ephemeral",
        "--no-project-memory",
        "--no-file-refs",
        "--no-slash-macros",
        "--no-mcp",
        "--no-ide",
        "--no-pdh",
        "--no-jetbrains",
      ],
      {
        cwd: directories.workspace,
        timeout: 480000,
        secret: broker.childKey,
        environment: {
          ...env,
          VOLCENGINE_API_KEY: broker.childKey,
          CC_FORMAL_QUALITY_EVAL_HERMETIC: "1",
          CC_FORMAL_QUALITY_EVAL_PROVIDER: DIAGNOSTIC.provider,
          CC_FORMAL_QUALITY_EVAL_ISOLATION_ROOT: scratch,
          CC_FORMAL_QUALITY_EVAL_ALLOWED_FILES: JSON.stringify(["result.json"]),
        },
      },
    );
    const trace = inspectModelTrace(
      model.stdout,
      ["result.json"],
      directories.workspace,
    );
    summary.stages.tool = {
      passed: trace.pass,
      terminal: trace.terminal,
      broker: broker.taskStatus(taskId),
    };
    assert.ok(
      trace.pass && summary.stages.tool.broker.passed,
      "model terminal/tool evidence failed",
    );
    assert.deepEqual(
      JSON.parse(
        fs.readFileSync(path.join(directories.workspace, "input.json")),
      ),
      input,
    );
    assert.deepEqual(fs.readdirSync(directories.workspace).sort(), [
      "input.json",
      "result.json",
    ]);
    summary.stages.artifact = validateArtifact(directories.workspace, nonce);
    fs.copyFileSync(
      path.join(directories.workspace, "result.json"),
      path.join(output, "result.json"),
    );
    summary.passed = true;
  } catch (error) {
    summary.failure = String(error.message).replaceAll(key, "[REDACTED]");
  } finally {
    if (broker) {
      try {
        summary.broker = await broker.close();
      } catch {
        summary.passed = false;
        summary.failure = "broker evidence finalization failed";
      }
    }
    summary.finishedAt = new Date().toISOString();
    save("summary.json", summary);
  }
  return summary;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { values } = parseArgs({
    options: {
      "confirm-live": { type: "boolean" },
      "output-dir": { type: "string" },
    },
  });
  const summary = await runPublicCliMatrix({
    confirmLive: values["confirm-live"],
    outputDir: values["output-dir"],
  });
  console.log(
    JSON.stringify({
      taskId: summary.taskId,
      passed: summary.passed,
      formalSample: false,
    }),
  );
  if (!summary.passed) process.exitCode = 1;
}
