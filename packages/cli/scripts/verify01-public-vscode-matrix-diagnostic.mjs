#!/usr/bin/env node
/** Public installed VSIX and CLI, real host DOM journey and restart. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import {
  npmEntrypoint,
  validateArtifact,
} from "./verify01-public-cli-matrix-diagnostic.mjs";
import { runCaptured } from "./verify01-first-run-cli-diagnostic.mjs";
import {
  BROKER,
  createVolcengineDiagnosticBroker,
} from "./verify01-volcengine-diagnostic-broker.mjs";
import { DIAGNOSTIC } from "./verify01-volcengine-task-diagnostic.mjs";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const digest = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
export const PUBLIC_VSCODE_VERSION = "0.37.143";
export const HOST_VERSION = "1.132.0";
export const ARTIFACT_PROMPT =
  "Read input.json with read_file. Write result.json with write_file: exactly nonce copied from input, sum of values, and sorted containing values in ascending numerical order. Do not modify input.json. Only file tools; finish briefly after writing.";

export function publicCliAdapterSource(node, cli) {
  const flags = [
    "--allowed-tools",
    "read_file,search_files,list_dir,write_file,edit_file,edit_file_hashed",
    "--no-ide",
    "--no-mcp",
    "--no-pdh",
    "--no-jetbrains",
  ];
  return `const {spawn}=require('node:child_process');const args=process.argv.slice(2);if(args[0]==='agent')args.push(...${JSON.stringify(flags)});const child=spawn(${JSON.stringify(node)},[${JSON.stringify(cli)},...args],{stdio:'inherit',env:process.env});child.on('error',e=>{console.error(e.message);process.exitCode=1});child.on('exit',(code)=>{process.exitCode=code??1});`;
}

export async function runPublicVSCode({
  outputDir,
  confirmLive,
  key = process.env.VOLCENGINE_API_KEY,
}) {
  assert.equal(confirmLive, true);
  assert.ok(key?.trim());
  assert.ok(ARTIFACT_PROMPT.length <= 512);
  const output = path.resolve(outputDir);
  assert.ok(!fs.existsSync(output), "new evidence directory required");
  fs.mkdirSync(output, { recursive: true });
  // native expands Windows 8.3 TEMP aliases; realpathSync may retain RUNNER~1.
  const scratch = fs.realpathSync.native(
    fs.mkdtempSync(
      path.join(process.platform === "darwin" ? "/tmp" : os.tmpdir(), "cc-vs-"),
    ),
  );
  const dirs = Object.fromEntries(
    [
      "workspace",
      "captureDir",
      "profileHome",
      "userDataDir",
      "extensionsDir",
      "install",
      "cache",
      "tmp",
      "appdata",
      "localappdata",
    ].map((name) => [name, path.join(scratch, name)]),
  );
  for (const directory of Object.values(dirs)) fs.mkdirSync(directory);
  const profile = path.join(dirs.profileHome, ".chainlesschain");
  fs.mkdirSync(profile);
  const npmrc = path.join(scratch, "npmrc"),
    globalNpmrc = path.join(scratch, "global-npmrc");
  fs.writeFileSync(npmrc, "");
  fs.writeFileSync(globalNpmrc, "");
  const env = {
    PATH: process.env.PATH,
    HOME: dirs.profileHome,
    USERPROFILE: dirs.profileHome,
    CHAINLESSCHAIN_HOME: profile,
    APPDATA: dirs.appdata,
    LOCALAPPDATA: dirs.localappdata,
    TMPDIR: dirs.tmp,
    TEMP: dirs.tmp,
    TMP: dirs.tmp,
    ...Object.fromEntries(
      ["SystemRoot", "ComSpec", "DISPLAY", "XAUTHORITY"]
        .filter((name) => process.env[name])
        .map((name) => [name, process.env[name]]),
    ),
    npm_config_userconfig: npmrc,
    npm_config_globalconfig: globalNpmrc,
    npm_config_cache: dirs.cache,
    npm_config_registry: "https://registry.npmjs.org",
    CC_UPDATE_NOTICE: "0",
    CC_MAX_RETRIES: "0",
    CLAUDE_CODE_MAX_RETRIES: "0",
    ...(process.platform === "win32"
      ? { CC_SECURE_FS_WINDOWS_ACL_TIMEOUT_MS: "60000" }
      : {}),
    CI: "true",
    NO_COLOR: "1",
    LANG: "C.UTF-8",
  };
  const taskId = `first-run-${process.platform}-vscode`;
  const summary = {
    taskId,
    formalSample: false,
    passed: false,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    node: process.version,
    sourceCommit: process.env.GITHUB_SHA || null,
    cliVersion: DIAGNOSTIC.publicVersion,
    extensionVersion: PUBLIC_VSCODE_VERSION,
    hostVersion: HOST_VERSION,
    startedAt: new Date().toISOString(),
    stages: {},
    limitations: [
      "Diagnostic file-tool journey; not a frozen formal sample",
      "Public installed packages; repository capture instrumentation",
      "Adapter restricts agent tools, without a deterministic peer",
      "IDE context bridge tools disabled for this file-tool journey; real panel protocol and UI remain in use",
      "Public capture incompatibility remains a failure; no replacement VSIX",
    ],
  };
  let broker,
    capability = "";
  const redact = (text) =>
    String(text)
      .replaceAll(key, "[REDACTED]")
      .replaceAll(capability || "__NO_CAPABILITY__", "[BROKER_CAPABILITY]");
  const save = (name, value) =>
    fs.writeFileSync(
      path.join(output, name),
      redact(JSON.stringify(value, null, 2)) + "\n",
      { flag: "wx" },
    );
  const run = async (
    name,
    args,
    { cwd = dirs.install, environment = env, timeout = 120000 } = {},
  ) => {
    const result = await runCaptured(process.execPath, args, {
      cwd,
      env: environment,
      deadline: Date.now() + timeout,
      secret: capability || key,
      outputPrefix: path.join(output, "commands", name),
    });
    assert.ok(result.ok, `${name} failed; inspect raw process receipt`);
    return result;
  };
  try {
    const metadataUrl = `https://open-vsx.org/api/chainlesschain/chainlesschain-ide/${PUBLIC_VSCODE_VERSION}`;
    const metadataResponse = await fetch(metadataUrl, {
      signal: AbortSignal.timeout(60000),
    });
    assert.equal(
      metadataResponse.status,
      200,
      "public OpenVSX metadata unavailable",
    );
    const metadata = await metadataResponse.json();
    assert.equal(metadata.version, PUBLIC_VSCODE_VERSION);
    assert.equal(metadata.namespace, "chainlesschain");
    assert.equal(metadata.name, "chainlesschain-ide");
    const download = new URL(metadata.files.download);
    assert.equal(download.protocol, "https:");
    const response = await fetch(download, {
      signal: AbortSignal.timeout(120000),
    });
    assert.equal(response.status, 200, "public VSIX download failed");
    const vsixBytes = Buffer.from(await response.arrayBuffer());
    assert.ok(vsixBytes.length > 0 && vsixBytes.length < 128 * 1024 * 1024);
    const vsix = path.join(scratch, "public.vsix");
    fs.writeFileSync(vsix, vsixBytes);
    save("public-extension.json", {
      metadataUrl,
      metadata,
      downloadedFrom: response.url,
      digest: digest(vsixBytes),
      bytes: vsixBytes.length,
    });
    fs.writeFileSync(
      path.join(dirs.install, "package.json"),
      '{"private":true}\n',
    );
    await run(
      "npm-install",
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
    const lock = JSON.parse(
      fs.readFileSync(path.join(dirs.install, "package-lock.json"), "utf8"),
    );
    const locked = lock.packages["node_modules/chainlesschain"];
    assert.equal(locked.version, DIAGNOSTIC.publicVersion);
    assert.ok(
      !locked.link &&
        locked.resolved.startsWith("https://registry.npmjs.org/") &&
        locked.integrity,
    );
    save("package-lock.json", lock);
    const cli = path.join(
      dirs.install,
      "node_modules/chainlesschain/bin/chainlesschain.js",
    );
    await run("cli-identity", [cli, "--version"]);
    summary.stages.install = {
      passed: true,
      lifecycleScriptsEnabled: true,
      locked,
    };
    broker = await createVolcengineDiagnosticBroker({
      outputDir: path.join(output, "broker"),
      key,
      allowedTaskIds: [taskId],
      maximumRequestsPerTask: 14,
    });
    capability = broker.childKey;
    broker.beginTask(taskId);
    for (const [field, value] of Object.entries({
      provider: DIAGNOSTIC.provider,
      model: BROKER.model,
      baseUrl: broker.baseUrl,
    }))
      await run(`config-${field}`, [
        cli,
        "config",
        "set",
        `llm.${field}`,
        value,
      ]);
    const configured = JSON.parse(
      (await run("config-readback", [cli, "config", "get", "llm", "--json"]))
        .stdout,
    ).value;
    assert.equal(configured.baseUrl, broker.baseUrl);
    assert.equal(configured.provider, DIAGNOSTIC.provider);
    assert.equal(configured.model, BROKER.model);
    summary.stages.configure = {
      passed: true,
      accountKeyInHost: false,
      brokerCapabilityInHost: true,
    };
    const adapter = path.join(scratch, "public-cli-adapter.cjs");
    fs.writeFileSync(adapter, publicCliAdapterSource(process.execPath, cli));
    const launcher = path.join(
      scratch,
      process.platform === "win32" ? "public-cli.cmd" : "public-cli",
    );
    const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
    fs.writeFileSync(
      launcher,
      process.platform === "win32"
        ? `@echo off\r\n"${process.execPath}" "${adapter}" %*\r\n`
        : `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(adapter)} "$@"\n`,
      { mode: 0o700 },
    );
    summary.adapter = {
      purpose:
        "delegate to installed public CLI with file-only agent tool restriction",
      digest: digest(fs.readFileSync(adapter)),
    };
    fs.mkdirSync(path.join(dirs.userDataDir, "User"));
    fs.writeFileSync(
      path.join(dirs.userDataDir, "User/settings.json"),
      JSON.stringify({
        "chainlesschain.ide.enabled": true,
        "chainlesschain.cli.managed.enabled": false,
        "chainlesschain.cli.path": launcher,
        "chainlesschain.chat.maxTurns": 14,
        "extensions.autoCheckUpdates": false,
        "extensions.autoUpdate": false,
        "telemetry.telemetryLevel": "off",
        "update.mode": "none",
      }),
    );
    const nonce = randomBytes(12).toString("hex"),
      input = { nonce, values: [9, 2, 8, 4] };
    fs.writeFileSync(
      path.join(dirs.workspace, "input.json"),
      JSON.stringify(input),
    );
    save("input.json", input);
    const config = {
      ...dirs,
      sampleId: taskId,
      prompt: ARTIFACT_PROMPT,
      provider: DIAGNOSTIC.provider,
      model: BROKER.model,
      permissionMode: "acceptEdits",
      hostVersion: HOST_VERSION,
      extensionVersion: PUBLIC_VSCODE_VERSION,
      deadline: Date.now() + 12 * 60 * 1000,
    };
    const configFile = path.join(scratch, "host-config.json");
    fs.writeFileSync(configFile, JSON.stringify(config));
    save("host-config.json", config);
    await run(
      "host-ui-restart",
      [
        path.join(
          repository,
          "packages/vscode-extension/test/extension-host/verify01-run.cjs",
        ),
        "--config",
        configFile,
        "--config-digest",
        digest(fs.readFileSync(configFile)),
        "--vsix",
        vsix,
        "--vsix-digest",
        digest(vsixBytes),
        "--confirm-live",
      ],
      {
        cwd: repository,
        timeout: 13 * 60 * 1000,
        environment: {
          ...env,
          VOLCENGINE_API_KEY: capability,
          CC_FORMAL_QUALITY_EVAL_HERMETIC: "1",
          CC_FORMAL_QUALITY_EVAL_PROVIDER: DIAGNOSTIC.provider,
          CC_FORMAL_QUALITY_EVAL_ISOLATION_ROOT: scratch,
          CC_FORMAL_QUALITY_EVAL_ALLOWED_FILES: JSON.stringify(["result.json"]),
        },
      },
    );
    const initial = JSON.parse(
      fs.readFileSync(
        path.join(dirs.captureDir, "vscode-initial.json"),
        "utf8",
      ),
    );
    const terminal = JSON.parse(
      fs.readFileSync(path.join(dirs.captureDir, "terminal.json"), "utf8"),
    );
    assert.equal(
      initial.recoveryRequired,
      true,
      `real UI terminal did not succeed: ${terminal.event.error || terminal.event.result || terminal.event.subtype}`,
    );
    assert.equal(terminal.event.subtype, "success");
    assert.equal(terminal.event.is_error, false);
    const restart = JSON.parse(
      fs.readFileSync(
        path.join(dirs.captureDir, "vscode-restart.json"),
        "utf8",
      ),
    );
    assert.ok(restart.completedAt && restart.restored);
    assert.ok(broker.taskStatus(taskId).passed);
    summary.stages.authenticate = {
      passed: true,
      evidence: "broker validated real-provider response from UI-triggered CLI",
    };
    summary.stages.host = { passed: true, restartVerified: true };
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(dirs.workspace, "input.json"))),
      input,
    );
    summary.stages.artifact = validateArtifact(dirs.workspace, nonce);
    summary.passed = true;
  } catch (error) {
    summary.failure = redact(error.message);
  } finally {
    if (broker) {
      try {
        summary.broker = await broker.close();
      } catch {
        summary.passed = false;
        summary.failure = "broker evidence finalization failed";
      }
    }
    const archive = (source, destination) => {
      fs.mkdirSync(destination, { recursive: true });
      for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
        const from = path.join(source, entry.name),
          to = path.join(destination, entry.name);
        if (entry.isDirectory()) archive(from, to);
        else if (entry.isFile() && fs.statSync(from).size <= 32 * 1024 * 1024)
          fs.writeFileSync(to, redact(fs.readFileSync(from, "utf8")), {
            flag: "wx",
          });
      }
    };
    try {
      archive(dirs.captureDir, path.join(output, "capture"));
      archive(dirs.workspace, path.join(output, "workspace"));
    } catch {
      summary.passed = false;
      summary.failure = "capture archival failed";
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
  const summary = await runPublicVSCode({
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
