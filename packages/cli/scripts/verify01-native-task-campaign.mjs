#!/usr/bin/env node
/** Native generation of the original 36 tasks and nine independent first runs.
 * Acceptance remains a separate, network-disabled Linux checker operation.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { npmEntrypoint } from "./verify01-public-cli-matrix-diagnostic.mjs";
import { runCaptured } from "./verify01-first-run-cli-diagnostic.mjs";
import {
  DIAGNOSTIC,
  inspectModelTrace,
  changedFiles,
} from "./verify01-volcengine-task-diagnostic.mjs";
import { createVolcengineDiagnosticBroker } from "./verify01-volcengine-diagnostic-broker.mjs";
import { VERIFY01_REVIEW_SPECS } from "./verify01-review-specs.mjs";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const planRoot = "docs/research/cli/verify01-plan-2026-10-13-volcengine";
export const VERSIONS = Object.freeze({
  cli: "0.166.99",
  vscode: "0.37.143",
  jetbrains: "0.4.161",
  vscodeHost: "1.132.0",
  jetbrainsHost: "2025.2",
});
export const FILE_TOOLS =
  "read_file,search_files,list_dir,write_file,edit_file,edit_file_hashed";
const hash = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const mkdir = (directory) => fs.mkdirSync(directory, { recursive: true });
const stamp = () => new Date().toISOString();

/** Git Bash may put GNU tar first, which parses C: as a remote archive host. */
export function archiveExtractor(
  platform = process.platform,
  systemRoot = process.env.SystemRoot,
) {
  if (platform !== "win32") return "tar";
  assert.ok(
    systemRoot && path.isAbsolute(systemRoot),
    "Windows system root required",
  );
  const executable = path.join(systemRoot, "System32", "tar.exe");
  assert.ok(
    fs.statSync(executable).isFile(),
    "native Windows archive extractor required",
  );
  return executable;
}

export function selectNativeSamples(plan, platform, entry) {
  assert.ok(["linux", "win32", "darwin"].includes(platform));
  assert.ok(["cli", "vscode", "jetbrains"].includes(entry));
  const samples = plan.samples.filter(
    (s) => s.stratum === `${platform}-${entry}-volcengine`,
  );
  const first = samples.filter((s) => s.kind === "first-run"),
    ordinary = samples.filter((s) => s.kind === "task");
  assert.equal(first.length, 1);
  assert.equal(ordinary.length, 4);
  assert.equal(first[0].taskId, ordinary[0].taskId);
  assert.equal(new Set(samples.map((s) => s.id)).size, 5);
  assert.notEqual(first[0].id, first[0].taskId);
  return [...first, ...ordinary];
}

export function nativeTaskPrompt(task, spec, sample) {
  return `${task.prompt}\n\nThis is an unseeded native ${sample.stratum} execution, sample ${sample.id}, kind ${sample.kind}. No previous candidate or repair feedback is supplied. First-run and ordinary samples use independent profiles and workspaces.
Read the frozen source and relevant existing tests before writing. Verify actual exported APIs, argument names, return fields and fixture construction. Read bounded slices and avoid repeated unchanged reads.
Frozen source files: ${task.sourcePaths.join(", ")}
Related existing tests: ${spec.baselineTests.join(", ")}
Only these deliverables may be changed: ${task.expectedFiles.join(", ")}
Use repository-relative mutation paths. Import paths are relative to the deliverable, not to an existing unit test directory: verify the resolved source path explicitly.
${spec.doc ? "Write the requested substantive Markdown runbook with source-verified commands and honest interpretation of insufficient evidence." : "Replace the non-answer placeholder with complete independent Vitest regression tests. Use focused positive and negative behavioral controls, at most six cases. Do not import an existing suite or assert on source text."}
Source and existing tests are read-only. Describe implementation defects in your final response instead of modifying source. Only six file tools are available; no shell, code execution, MCP or network tools. Do not inspect node_modules or paths outside the project.
An independent checker runs baseline, candidate and behavioral coverage tests later in network-disabled Linux Docker. Native generation does not imply native test execution. Do not claim tests passed.
You have 20 model turns. Write early enough to read back the completed deliverable, then finish with a concise account and limitations.`;
}

/** Includes links and empty directories; never follows links. */
export function snapshotNativeTree(root) {
  const result = {};
  function visit(relative) {
    for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
      const file = path.posix.join(relative, name),
        absolute = path.join(root, file),
        stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink())
        result[file] = { type: "link", target: fs.readlinkSync(absolute) };
      else if (stat.isDirectory()) {
        result[file] = { type: "directory" };
        visit(file);
      } else {
        assert.ok(stat.isFile(), `unsupported tree entry ${file}`);
        result[file] = {
          type: "file",
          bytes: stat.size,
          digest: hash(fs.readFileSync(absolute)),
          mode: stat.mode & 0o777,
        };
      }
    }
  }
  visit("");
  return result;
}

export function inspectNativeScope(before, after, expectedFiles) {
  const changedPaths = changedFiles(before, after);
  const metadataChanges = changedPaths.filter((f) =>
    /^(?:\.idea|\.vscode)(?:\/|$)/u.test(f),
  );
  const expected = new Set(expectedFiles);
  const sourceChanges = changedPaths.filter(
    (f) => !metadataChanges.includes(f),
  );
  const unexpectedChanges = sourceChanges.filter(
    (f) =>
      !expected.has(f) &&
      !(
        after[f]?.type === "directory" &&
        !before[f] &&
        expectedFiles.some((e) => e.startsWith(f + "/"))
      ),
  );
  const safeCandidates = expectedFiles.every(
    (f) => after[f]?.type === "file" && after[f].bytes > 0,
  );
  return {
    changedPaths,
    metadataChanges,
    unexpectedChanges,
    sourceScopePassed: unexpectedChanges.length === 0 && safeCandidates,
  };
}

export function nativeEnvironment(
  root,
  profileHome,
  profile,
  expectedFiles,
  capability = "",
) {
  const env = {
    PATH: process.env.PATH || "",
    HOME: profileHome,
    USERPROFILE: profileHome,
    CHAINLESSCHAIN_HOME: profile,
    APPDATA: path.join(root, "appdata"),
    LOCALAPPDATA: path.join(root, "localappdata"),
    TMPDIR: path.join(root, "tmp"),
    TEMP: path.join(root, "tmp"),
    TMP: path.join(root, "tmp"),
    npm_config_userconfig: path.join(root, "npmrc"),
    npm_config_globalconfig: path.join(root, "global-npmrc"),
    npm_config_cache: path.join(root, "npm-cache"),
    npm_config_registry: "https://registry.npmjs.org",
    CC_UPDATE_NOTICE: "0",
    CC_MAX_RETRIES: "0",
    CLAUDE_CODE_MAX_RETRIES: "0",
    CC_TASK_WORKLOG: "0",
    CI: "true",
    NO_COLOR: "1",
    LANG: "C.UTF-8",
    CC_FORMAL_QUALITY_EVAL_HERMETIC: "1",
    CC_FORMAL_QUALITY_EVAL_PROVIDER: DIAGNOSTIC.provider,
    CC_FORMAL_QUALITY_EVAL_ISOLATION_ROOT: root,
    CC_FORMAL_QUALITY_EVAL_ALLOWED_FILES: JSON.stringify(expectedFiles),
    VOLCENGINE_API_KEY: capability,
  };
  for (const name of [
    "SystemRoot",
    "ComSpec",
    "DISPLAY",
    "XAUTHORITY",
    "JAVA_HOME",
  ])
    if (process.env[name]) env[name] = process.env[name];
  if (process.platform === "win32") {
    env.CC_SECURE_FS_WINDOWS_ACL_TIMEOUT_MS = "60000";
    // Windows PowerShell's .NET KnownFolder lookup follows USERPROFILE,
    // not LOCALAPPDATA. Missing standard directories can make its cache path
    // relative to the task workspace even when LOCALAPPDATA is absolute.
    mkdir(path.join(profileHome, "AppData", "Local"));
    mkdir(path.join(profileHome, "AppData", "Roaming"));
    env.PSModuleAnalysisCachePath = path.resolve(
      root,
      "powershell-cache",
      "ModuleAnalysisCache",
    );
    mkdir(path.dirname(env.PSModuleAnalysisCachePath));
  }
  for (const name of ["APPDATA", "LOCALAPPDATA", "TMPDIR", "npm_config_cache"])
    mkdir(env[name]);
  for (const name of ["npm_config_userconfig", "npm_config_globalconfig"])
    fs.writeFileSync(env[name], "");
  return env;
}

export function nativeCliAdapterSource(cliPath) {
  const flags = [
    "--allowed-tools",
    FILE_TOOLS,
    "--no-ide",
    "--no-mcp",
    "--no-pdh",
    "--no-jetbrains",
    "--no-project-memory",
    "--no-file-refs",
    "--no-slash-macros",
  ];
  return `const {spawn}=require('node:child_process');const a=process.argv.slice(2);if(a[0]==='agent')a.push(...${JSON.stringify(flags)});const c=spawn(${JSON.stringify(process.execPath)},[${JSON.stringify(cliPath)},...a],{stdio:'inherit',env:{...process.env,CC_TASK_WORKLOG:'0'}});c.on('error',e=>{console.error(e.message);process.exitCode=1});c.on('exit',code=>{process.exitCode=code??1});`;
}

export async function runVSCodeNativeTask({
  sample,
  prompt,
  workspace,
  profileHome,
  cliPath,
  outputDir,
  deadline,
  environment,
  pluginArchive,
  pluginDigest,
  versions,
}) {
  const root = path.dirname(profileHome),
    captureDir = path.join(root, "capture"),
    userDataDir = path.join(root, "vscode-user"),
    extensionsDir = path.join(root, "vscode-extensions");
  [captureDir, userDataDir, extensionsDir].forEach(mkdir);
  const adapter = path.join(root, "cli-adapter.cjs"),
    launcher = path.join(
      root,
      process.platform === "win32" ? "cli.cmd" : "cli",
    );
  fs.writeFileSync(adapter, nativeCliAdapterSource(cliPath));
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  fs.writeFileSync(
    launcher,
    process.platform === "win32"
      ? `@echo off\r\n"${process.execPath}" "${adapter}" %*\r\n`
      : `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(adapter)} "$@"\n`,
    { mode: 0o700 },
  );
  mkdir(path.join(userDataDir, "User"));
  fs.writeFileSync(
    path.join(userDataDir, "User/settings.json"),
    JSON.stringify({
      "chainlesschain.ide.enabled": true,
      "chainlesschain.cli.managed.enabled": false,
      "chainlesschain.cli.path": launcher,
      "chainlesschain.chat.maxTurns": 20,
      "extensions.autoCheckUpdates": false,
      "extensions.autoUpdate": false,
      "telemetry.telemetryLevel": "off",
      "update.mode": "none",
    }),
  );
  const config = {
    sampleId: sample.id,
    prompt,
    workspace,
    captureDir,
    profileHome,
    userDataDir,
    extensionsDir,
    provider: DIAGNOSTIC.provider,
    model: DIAGNOSTIC.model,
    permissionMode: "acceptEdits",
    hostVersion: versions.vscodeHost,
    extensionVersion: versions.vscode,
    deadline,
  };
  const configFile = path.join(root, "host-config.json");
  fs.writeFileSync(configFile, JSON.stringify(config));
  fs.copyFileSync(configFile, path.join(outputDir, "host-config.json"));
  const result = await runCaptured(
    process.execPath,
    [
      path.join(
        repository,
        "packages/vscode-extension/test/extension-host/verify01-run.cjs",
      ),
      "--config",
      configFile,
      "--config-digest",
      hash(fs.readFileSync(configFile)),
      "--vsix",
      pluginArchive,
      "--vsix-digest",
      pluginDigest,
      "--confirm-live",
    ],
    {
      cwd: repository,
      env: environment,
      deadline,
      secret: environment.VOLCENGINE_API_KEY,
      outputPrefix: path.join(outputDir, "commands/host-ui"),
    },
  );
  let ok = result.ok;
  try {
    const initial = json(path.join(captureDir, "vscode-initial.json")),
      restart = json(path.join(captureDir, "vscode-restart.json")),
      terminal = json(path.join(captureDir, "terminal.json"));
    ok &&=
      initial.recoveryRequired === true &&
      !!restart.completedAt &&
      !!restart.restored &&
      terminal.event.subtype === "success" &&
      terminal.event.is_error === false;
  } catch {
    ok = false;
  }
  return {
    ok,
    captureDir,
    failure: ok
      ? null
      : ["initial", "restart"]
          .map((phase) => path.join(captureDir, `driver-${phase}.failure.json`))
          .filter((file) => fs.existsSync(file))
          .map((file) => json(file).error.message)
          .join("; ") || "VSCode initial/UI/restart validation failed",
  };
}

export function protocolStream(captureDir) {
  const protocol = path.join(captureDir, "protocol.json");
  if (fs.existsSync(protocol))
    return (
      json(protocol)
        .filter((row) => row.direction === "output")
        .map((row) => JSON.stringify(row.event))
        .join("\n") + "\n"
    );
  const files = fs
    .readdirSync(captureDir)
    .filter(
      (f) =>
        f.endsWith(".ndjson") &&
        f !== "ui.ndjson" &&
        f !== "cdp-discovery.ndjson",
    );
  assert.equal(files.length, 1, "exactly one raw protocol generation required");
  return (
    fs
      .readFileSync(path.join(captureDir, files[0]), "utf8")
      .split(/\r?\n/u)
      .filter(Boolean)
      .map(JSON.parse)
      .filter((row) => row.direction === "output")
      .map((row) => JSON.stringify(row.event))
      .join("\n") + "\n"
  );
}

/** Windows filesystem identity ignores spelling case. Raw stream is archived
 * unchanged; this copy is used only by the shared trace scope validator. */
export function inspectionStream(
  stream,
  workspace,
  platform = process.platform,
) {
  if (platform !== "win32") return { stream, workspace };
  const lowered =
    stream
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => {
        const event = JSON.parse(line);
        if (event.type === "tool_use" && event.args) {
          for (const field of ["path", "directory"])
            if (typeof event.args[field] === "string")
              event.args[field] = event.args[field].toLowerCase();
        }
        return JSON.stringify(event);
      })
      .join("\n") + "\n";
  return { stream: lowered, workspace: workspace.toLowerCase() };
}

export async function runNativeCampaign({
  entry,
  outputDir,
  sourceSha,
  confirmLive,
  key = process.env.VOLCENGINE_API_KEY,
}) {
  assert.equal(confirmLive, true);
  assert.ok(key?.trim());
  assert.match(sourceSha || "", /^[a-f0-9]{40}$/u);
  const git = (args) =>
    execFileSync("git", args, {
      cwd: repository,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
  assert.equal(
    git(["rev-parse", "HEAD"]).trim(),
    sourceSha,
    "execution commit must equal checkout HEAD",
  );
  const executionSourceBindings = [];
  const bindingFiles = [
    "packages/cli/scripts/verify01-native-task-campaign.mjs",
    "packages/cli/scripts/verify01-volcengine-task-diagnostic.mjs",
    "packages/cli/scripts/verify01-volcengine-diagnostic-broker.mjs",
    "packages/cli/scripts/verify01-review-specs.mjs",
    "packages/cli/src/lib/eval/stream-terminal.js",
    "packages/cli/scripts/verify01-first-run-cli-diagnostic.mjs",
    `${planRoot}/plan.json`,
    `${planRoot}/tasks.json`,
    `${planRoot}/plan.sha256`,
  ];
  if (entry === "vscode")
    bindingFiles.push(
      "packages/vscode-extension/test/extension-host/verify01-run.cjs",
      "packages/vscode-extension/test/extension-host/driver/verify01.cjs",
      "packages/vscode-extension/test/extension-host/driver/verify01-composer.cjs",
      "packages/vscode-extension/test/extension-host/driver/noop.cjs",
      "packages/vscode-extension/test/extension-host/driver/failure-receipt.cjs",
      "packages/vscode-extension/test/extension-host/cdp-journey.cjs",
      "packages/vscode-extension/test/extension-host/run.cjs",
    );
  if (entry === "jetbrains")
    bindingFiles.push(
      "packages/jetbrains-plugin/scripts/verify01-native-task-adapter.mjs",
    );
  for (const file of bindingFiles) {
    const bytes = fs.readFileSync(path.join(repository, file));
    const committed = execFileSync("git", ["show", `${sourceSha}:${file}`], {
      cwd: repository,
      maxBuffer: 32 * 1024 * 1024,
    });
    assert.equal(
      hash(bytes),
      hash(committed),
      `execution file differs from commit: ${file}`,
    );
    executionSourceBindings.push({ file, digest: hash(bytes) });
  }
  const output = path.resolve(outputDir);
  assert.ok(!fs.existsSync(output), "new output directory required");
  mkdir(output);
  const plan = json(path.join(repository, planRoot, "plan.json")),
    catalog = json(path.join(repository, planRoot, "tasks.json"));
  assert.equal(plan.commitSha, DIAGNOSTIC.projectCommit);
  assert.equal(catalog.projectCommit, DIAGNOSTIC.projectCommit);
  assert.equal(
    fs
      .readFileSync(path.join(repository, planRoot, "plan.sha256"), "utf8")
      .trim(),
    DIAGNOSTIC.planDigest,
  );
  const samples = selectNativeSamples(plan, process.platform, entry);
  const scratch = fs.realpathSync.native(
    fs.mkdtempSync(
      path.join(
        process.platform === "darwin" ? "/tmp" : os.tmpdir(),
        "cc-native-",
      ),
    ),
  );
  const install = path.join(scratch, "install");
  mkdir(install);
  const archive = path.join(scratch, "frozen.tar");
  git([
    "archive",
    "--format=tar",
    "--output",
    archive,
    DIAGNOSTIC.projectCommit,
  ]);
  const summary = {
    schema: "chainlesschain.verify01-native-task-campaign/v1",
    executionSourceCommit: sourceSha,
    projectCommit: DIAGNOSTIC.projectCommit,
    planDigest: DIAGNOSTIC.planDigest,
    frozenArchiveDigest: hash(fs.readFileSync(archive)),
    versions: VERSIONS,
    actualPlatform: process.platform,
    actualArch: process.arch,
    actualEntry: entry,
    startedAt: stamp(),
    samples: [],
    generationPassed: false,
    acceptancePending: true,
    formalSample: false,
    limitations: [
      "Native generation; independent Linux acceptance pending",
      "Broker thinking disabled, six file tools only, 20 model turns, 24 requests, 180 second request timeout, 8192 output tokens, 16 MiB response transport limit",
      "IDE context bridges and optional task worklog disabled; real UI and restart retained",
      "No prior candidates or repair seeds supplied",
    ],
  };
  Object.assign(summary, {
    group: `${process.platform}-${entry}`,
    entry,
    platform: process.platform,
    executionSourceBindings,
  });
  const secrets = [key];
  const redactAll = (value) =>
    secrets.reduce(
      (text, secret) => text.replaceAll(secret, "[REDACTED]"),
      String(value),
    );
  let cliPath, pluginArchive, pluginDigest;
  const save = (file, value) => {
    mkdir(path.dirname(path.join(output, file)));
    fs.writeFileSync(
      path.join(output, file),
      redactAll(
        typeof value === "string"
          ? value
          : JSON.stringify(value, null, 2) + "\n",
      ),
    );
  };
  const publicFetch = async (url) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
    assert.equal(
      response.status,
      200,
      `public download failed: ${response.status}`,
    );
    return response;
  };
  for (const sample of samples) {
    const task = catalog.tasks.find((t) => t.id === sample.taskId);
    assert.ok(task);
    const runId = randomUUID(),
      root = path.join(scratch, runId),
      workspace = path.join(root, "workspace"),
      profileHome = path.join(root, "home"),
      profile = path.join(profileHome, ".chainlesschain"),
      sampleOutput = path.join(output, sample.id);
    [workspace, profile].forEach(mkdir);
    mkdir(sampleOutput);
    const deadline =
      Date.now() + (sample.kind === "first-run" ? 1800000 : 1200000);
    const row = {
      schema: "chainlesschain.verify01-native-task-sample/v1",
      sampleId: sample.id,
      taskId: task.id,
      kind: sample.kind,
      runId,
      stratum: sample.stratum,
      declaredActualEntry: { platform: process.platform, entry },
      actualPlatform: process.platform,
      actualEntry: entry,
      executionSourceCommit: sourceSha,
      projectCommit: DIAGNOSTIC.projectCommit,
      planDigest: DIAGNOSTIC.planDigest,
      versions: VERSIONS,
      expectedFiles: task.expectedFiles,
      startedAt: stamp(),
      deadline: new Date(deadline).toISOString(),
      candidates: [],
      sourceScopePassed: false,
      metadataChanges: [],
      unexpectedChanges: [],
      generationPassed: false,
      passed: false,
      acceptancePending: true,
      formalSample: false,
    };
    summary.samples.push(row);
    let broker,
      before,
      capability = "";
    const redact = (value) =>
      String(value)
        .replaceAll(key, "[REDACTED]")
        .replaceAll(capability || "__NO_CAPABILITY__", "[BROKER_CAPABILITY]");
    const environment = nativeEnvironment(
      root,
      profileHome,
      profile,
      task.expectedFiles,
    );
    const run = (name, args, cwd = workspace, env = environment) =>
      runCaptured(process.execPath, args, {
        cwd,
        env,
        deadline,
        secret: capability || key,
        outputPrefix: path.join(sampleOutput, "commands", name),
      });
    try {
      execFileSync(archiveExtractor(), ["-xf", archive, "-C", workspace], {
        timeout: 120000,
      });
      for (const file of task.expectedFiles) {
        assert.ok(!path.isAbsolute(file) && !file.split("/").includes(".."));
        mkdir(path.dirname(path.join(workspace, file)));
        assert.ok(
          !fs.existsSync(path.join(workspace, file)),
          "frozen archive already contains deliverable",
        );
        fs.writeFileSync(
          path.join(workspace, file),
          file.endsWith(".md")
            ? "<!-- Non-answer placeholder. -->\n"
            : "// Non-answer placeholder.\n",
        );
      }
      before = snapshotNativeTree(workspace);
      save(`${sample.id}/tree-before.json`, before);
      if (!cliPath) {
        const start = stamp();
        fs.writeFileSync(
          path.join(install, "package.json"),
          '{"private":true}\n',
        );
        const installed = await run(
          "npm-install",
          [
            npmEntrypoint(),
            "install",
            `chainlesschain@${VERSIONS.cli}`,
            "--omit=dev",
            "--no-audit",
            "--no-fund",
            "--registry=https://registry.npmjs.org",
          ],
          install,
        );
        assert.ok(installed.ok, "public CLI install failed");
        const lock = json(path.join(install, "package-lock.json")),
          locked = lock.packages["node_modules/chainlesschain"];
        assert.equal(locked.version, VERSIONS.cli);
        assert.ok(
          !locked.link &&
            locked.integrity &&
            locked.resolved.startsWith("https://registry.npmjs.org/"),
        );
        save("package-lock.json", lock);
        const installedCli = path.join(
          install,
          "node_modules/chainlesschain/bin/chainlesschain.js",
        );
        const identity = await run(
          "cli-identity",
          [installedCli, "--version"],
          install,
        );
        assert.ok(
          identity.ok && identity.stdout.includes(VERSIONS.cli),
          "installed CLI identity mismatch",
        );
        if (entry !== "cli") {
          let url, metadata;
          if (entry === "vscode") {
            metadata = await (
              await publicFetch(
                `https://open-vsx.org/api/chainlesschain/chainlesschain-ide/${VERSIONS.vscode}`,
              )
            ).json();
            assert.equal(metadata.version, VERSIONS.vscode);
            assert.equal(metadata.namespace, "chainlesschain");
            assert.equal(metadata.name, "chainlesschain-ide");
            url = metadata.files.download;
          } else {
            const updates = await (
              await publicFetch(
                "https://plugins.jetbrains.com/api/plugins/32208/updates?size=100",
              )
            ).json();
            metadata = updates.find((r) => r.version === VERSIONS.jetbrains);
            assert.ok(metadata?.file);
            url = `https://plugins.jetbrains.com/files/${metadata.file}`;
          }
          assert.equal(new URL(url).protocol, "https:");
          const bytes = Buffer.from(
            await (await publicFetch(url)).arrayBuffer(),
          );
          assert.ok(bytes.length > 100000 && bytes.length < 128 * 1024 * 1024);
          pluginArchive = path.join(
            scratch,
            entry === "vscode" ? "public.vsix" : "public.zip",
          );
          fs.writeFileSync(pluginArchive, bytes);
          pluginDigest = hash(bytes);
          save("public-extension.json", {
            metadata,
            url,
            digest: pluginDigest,
            bytes: bytes.length,
          });
        }
        cliPath = installedCli;
        summary.install = {
          passed: true,
          startedAt: start,
          finishedAt: stamp(),
          lifecycleScriptsEnabled: true,
          sampleId: sample.id,
          locked,
        };
        row.install = summary.install;
      } else
        row.install = {
          reusedHostInstallation: true,
          independentProfile: true,
          evidence: "package-lock.json",
        };
      broker = await createVolcengineDiagnosticBroker({
        outputDir: path.join(sampleOutput, "broker"),
        key,
        allowedTaskIds: [sample.id],
        maximumRequestsPerTask: 24,
        requestTimeoutMs: 180000,
        maximumResponseBytes: 16 * 1024 * 1024,
        allowTextOnlyRequests: true,
      });
      capability = broker.childKey;
      secrets.push(capability);
      environment.VOLCENGINE_API_KEY = capability;
      broker.beginTask(sample.id);
      for (const [field, value] of Object.entries({
        provider: DIAGNOSTIC.provider,
        model: DIAGNOSTIC.model,
        baseUrl: broker.baseUrl,
      }))
        assert.ok(
          (
            await run(`config-${field}`, [
              cliPath,
              "config",
              "set",
              `llm.${field}`,
              value,
            ])
          ).ok,
          `config ${field} failed`,
        );
      const readback = await run("config-readback", [
        cliPath,
        "config",
        "get",
        "llm",
        "--json",
      ]);
      assert.ok(readback.ok);
      const configured = JSON.parse(readback.stdout).value;
      assert.equal(configured.provider, DIAGNOSTIC.provider);
      assert.equal(configured.model, DIAGNOSTIC.model);
      assert.equal(configured.baseUrl, broker.baseUrl);
      row.configure = {
        passed: true,
        accountKeyInHost: false,
        independentProfile: true,
      };
      const prompt = nativeTaskPrompt(
        task,
        VERIFY01_REVIEW_SPECS.find((spec) => spec.taskId === task.id),
        sample,
      );
      save(`${sample.id}/prompt.txt`, prompt);
      const args = {
        sample,
        task,
        prompt,
        workspace,
        profileHome,
        profile,
        cliPath,
        outputDir: sampleOutput,
        deadline,
        environment,
        pluginArchive,
        pluginDigest,
        versions: VERSIONS,
      };
      let result;
      if (entry === "cli")
        result = await run("model", [
          cliPath,
          "agent",
          "-p",
          prompt,
          "--provider",
          DIAGNOSTIC.provider,
          "--model",
          DIAGNOSTIC.model,
          "--base-url",
          broker.baseUrl,
          "--permission-mode",
          "acceptEdits",
          "--output-format",
          "stream-json",
          "--max-turns",
          "20",
          "--allowed-tools",
          FILE_TOOLS,
          "--ephemeral",
          "--no-project-memory",
          "--no-file-refs",
          "--no-slash-macros",
          "--no-mcp",
          "--no-ide",
          "--no-pdh",
          "--no-jetbrains",
        ]);
      else if (entry === "vscode") result = await runVSCodeNativeTask(args);
      else {
        const { runJetBrainsNativeTask } = await import(
          "../../jetbrains-plugin/scripts/verify01-native-task-adapter.mjs"
        );
        result = await runJetBrainsNativeTask(args);
      }
      row.host = {
        passed: result.ok,
        failure: result.failure || null,
        restartRequired: entry !== "cli",
      };
      if (result.captureDir) {
        const destination = path.join(sampleOutput, "capture");
        if (path.resolve(result.captureDir) !== path.resolve(destination))
          fs.cpSync(result.captureDir, destination, { recursive: true });
        row.capturePath = `${sample.id}/capture`;
      }
      const stream = result.stdout || protocolStream(result.captureDir);
      save(`${sample.id}/model-stream.ndjson`, redact(stream));
      const inspected = inspectionStream(stream, workspace);
      row.model = inspectModelTrace(
        inspected.stream,
        task.expectedFiles,
        inspected.workspace,
        { allowSessionEnd: entry !== "cli" },
      );
      row.model.scopePathComparison =
        process.platform === "win32"
          ? "windows-case-insensitive; raw stream retained"
          : "native-case-sensitive";
      row.brokerStatus = broker.taskStatus(sample.id);
      row.generationPassed =
        result.ok && row.model.pass && row.brokerStatus.passed;
    } catch (error) {
      row.failure = redact(
        [row.host?.failure, error.stack || error.message]
          .filter(Boolean)
          .join("\n"),
      );
    } finally {
      if (broker) {
        try {
          row.broker = await broker.close();
        } catch (error) {
          row.generationPassed = false;
          row.failure = redact(error.message);
        }
      }
      try {
        if (before) {
          const after = snapshotNativeTree(workspace);
          save(`${sample.id}/tree-after.json`, after);
          Object.assign(
            row,
            inspectNativeScope(before, after, task.expectedFiles),
          );
          row.generationPassed &&= row.sourceScopePassed;
          for (const file of task.expectedFiles)
            if (after[file]?.type === "file") {
              const bytes = fs.readFileSync(path.join(workspace, file));
              assert.ok(
                secrets.every((secret) => !bytes.includes(Buffer.from(secret))),
                "candidate contains protected capability",
              );
              const relative = `${sample.id}/candidate/${file}`;
              mkdir(path.dirname(path.join(output, relative)));
              fs.writeFileSync(path.join(output, relative), bytes);
              row.candidates.push({
                file,
                path: relative,
                digest: hash(bytes),
                bytes: bytes.length,
              });
            }
          for (const file of row.metadataChanges)
            if (after[file]?.type === "file") {
              const destination = path.join(sampleOutput, "metadata", file);
              mkdir(path.dirname(destination));
              fs.copyFileSync(path.join(workspace, file), destination);
            }
        }
      } catch (error) {
        row.generationPassed = false;
        row.failure = redact(error.message);
      }
      row.finishedAt = stamp();
      save(
        `${sample.id}/summary.json`,
        JSON.parse(redact(JSON.stringify(row))),
      );
      save("summary.json", JSON.parse(redact(JSON.stringify(summary))));
      console.log(
        JSON.stringify({
          sampleId: row.sampleId,
          taskId: row.taskId,
          generationPassed: row.generationPassed,
          hostPassed: row.host?.passed ?? false,
          sourceScopePassed: row.sourceScopePassed,
          acceptancePending: true,
        }),
      );
    }
  }
  summary.generationPassed =
    summary.samples.length === 5 &&
    summary.samples.every((s) => s.generationPassed);
  summary.finishedAt = stamp();
  save("summary.json", summary);
  return summary;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { values } = parseArgs({
    options: {
      entry: { type: "string" },
      "output-dir": { type: "string" },
      "source-sha": { type: "string" },
      "confirm-live": { type: "boolean" },
    },
  });
  const summary = await runNativeCampaign({
    entry: values.entry,
    outputDir: values["output-dir"],
    sourceSha: values["source-sha"],
    confirmLive: values["confirm-live"],
  });
  console.log(
    JSON.stringify({
      generationPassed: summary.generationPassed,
      acceptancePending: true,
      samples: summary.samples.map((s) => ({
        sampleId: s.sampleId,
        generationPassed: s.generationPassed,
      })),
    }),
  );
  if (!summary.generationPassed) process.exitCode = 1;
}
