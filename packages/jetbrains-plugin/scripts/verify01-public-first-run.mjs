#!/usr/bin/env node
/** Public Marketplace plugin + public npm CLI, real Swing task and recovery.
 * Diagnostic only: no frozen observations, no claimed native DB acceptance.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { runCaptured } from "../../cli/scripts/verify01-first-run-cli-diagnostic.mjs";
import {
  npmEntrypoint,
  validateArtifact,
} from "../../cli/scripts/verify01-public-cli-matrix-diagnostic.mjs";
import {
  DIAGNOSTIC,
  inspectModelTrace,
  redactDiagnostic,
} from "../../cli/scripts/verify01-volcengine-task-diagnostic.mjs";
import { createVolcengineDiagnosticBroker } from "../../cli/scripts/verify01-volcengine-diagnostic-broker.mjs";
import {
  launchLogged,
  requireSuccess,
  stopOwned,
} from "../../../scripts/lib/verify01-diagnostic-process.mjs";
import {
  assertPortFree,
  waitForPortFree,
} from "../../../scripts/lib/verify01-diagnostic-port.mjs";
import { verifyDiagnosticCapture } from "../../../scripts/lib/verify01-diagnostic-evidence.mjs";

const pkg = fileURLToPath(new URL("../", import.meta.url));
const pluginVersion = "0.4.161";
const ideVersion = "2025.2";
const hash = (bytes) =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");

export function publicPluginRecord(rows) {
  const row = rows.find((row) => row.version === pluginVersion);
  assert.ok(
    row?.approve === true && row.listed === true && row.hidden === false,
    "exact public plugin is unavailable",
  );
  assert.match(
    row.file,
    /^32208\/\d+\/chainlesschain-ide-bridge-0\.4\.161\.zip$/u,
  );
  return {
    id: row.id,
    version: row.version,
    approve: row.approve,
    listed: row.listed,
    hidden: row.hidden,
    file: row.file,
  };
}

export function cliShim(node, cli, windows = process.platform === "win32") {
  if (windows) {
    assert.ok(!/["%!&|<>^\r\n]/u.test(node + cli), "unsafe Windows CLI path");
    return `@echo off\r\n"${node}" "${cli}" %*\r\n`;
  }
  const quote = (value) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
  return `#!/bin/sh\nexec ${quote(node)} ${quote(cli)} "$@"\n`;
}

async function publicFetch(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(90000) });
  assert.ok(response.ok, `public download returned HTTP ${response.status}`);
  return response;
}
async function robotReady() {
  try {
    const response = await fetch("http://127.0.0.1:8082", {
      signal: AbortSignal.timeout(1000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
async function requestIdeExit({ signal }) {
  const response = await fetch("http://127.0.0.1:8082/js/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      runInEdt: false,
      script:
        "importClass(com.intellij.openapi.application.ApplicationManager); importClass(java.lang.Runnable); const app=ApplicationManager.getApplication(); app.invokeLater(new Runnable({run:function(){app.exit(Packages.com.intellij.openapi.application.ex.ApplicationEx.EXIT_CONFIRMED | Packages.com.intellij.openapi.application.ex.ApplicationEx.SAVE);}}));",
    }),
  });
  assert.ok(response.ok, "IDE exit request failed");
  assert.ok(!(await response.json()).exception, "IDE refused graceful exit");
}

export async function runPublicFirstRun({ outputDir, key }) {
  assert.ok(key?.trim(), "VOLCENGINE_API_KEY required");
  const output = path.resolve(outputDir);
  assert.ok(!fs.existsSync(output), "output must be new");
  fs.mkdirSync(output, { recursive: true });
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "cc-jb-public-")),
  );
  const dirs = Object.fromEntries(
    ["home", "install", "workspace", "capture", "bin", "tmp", "cache"].map(
      (name) => [name, path.join(root, name)],
    ),
  );
  for (const directory of Object.values(dirs)) fs.mkdirSync(directory);
  const profile = path.join(dirs.home, ".chainlesschain");
  fs.mkdirSync(profile);
  const npmrc = path.join(root, "npmrc");
  fs.writeFileSync(npmrc, "");
  const environment = {};
  for (const name of [
    "PATH",
    "SystemRoot",
    "WINDIR",
    "ComSpec",
    "PATHEXT",
    "JAVA_HOME",
    "JAVA_HOME_21_X64",
    "JAVA_HOME_21_ARM64",
    "GRADLE_USER_HOME",
    "DISPLAY",
    "XAUTHORITY",
  ])
    if (process.env[name]) environment[name] = process.env[name];
  Object.assign(environment, {
    HOME: dirs.home,
    USERPROFILE: dirs.home,
    CHAINLESSCHAIN_HOME: profile,
    TMPDIR: dirs.tmp,
    TEMP: dirs.tmp,
    TMP: dirs.tmp,
    CI: "true",
    NO_COLOR: "1",
    CC_UPDATE_NOTICE: "0",
    CC_MAX_RETRIES: "0",
    CLAUDE_CODE_MAX_RETRIES: "0",
    ...(process.platform === "win32"
      ? { CC_SECURE_FS_WINDOWS_ACL_TIMEOUT_MS: "60000" }
      : {}),
    npm_config_userconfig: npmrc,
    npm_config_globalconfig: npmrc,
    npm_config_registry: "https://registry.npmjs.org",
    npm_config_cache: dirs.cache,
  });
  const summary = {
    schema: "chainlesschain.public-jetbrains-first-run/v1",
    sampleId: `first-run-${process.platform}-jetbrains`,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    node: process.version,
    sourceCommit: process.env.GITHUB_SHA || null,
    pluginVersion,
    ideVersion,
    cliVersion: DIAGNOSTIC.publicVersion,
    formalSample: false,
    providerAssessed: false,
    startedAt: new Date().toISOString(),
    stages: {},
    passed: false,
    limitations: [
      "Simple file-tool task, not a frozen VERIFY01 project task",
      "Diagnostic broker disables thinking",
      "Installation and configuration are automated; not a human usability study",
      "No native database or frozen host identity claim",
    ],
  };
  let broker, active;
  const save = (file, value) =>
    fs.writeFileSync(
      path.join(output, file),
      redactDiagnostic(
        typeof value === "string"
          ? value
          : JSON.stringify(value, null, 2) + "\n",
        key,
      ),
      { flag: "wx" },
    );
  const runCli = async (
    name,
    args,
    { env = environment, timeoutMs = 120000 } = {},
  ) => {
    const result = await runCaptured(process.execPath, args, {
      cwd: dirs.install,
      env,
      secret: key,
      deadline: Date.now() + timeoutMs,
      outputPrefix: path.join(output, "commands", name),
    });
    assert.ok(result.ok, `${name} failed; see process receipt`);
    return result;
  };
  try {
    const record = publicPluginRecord(
      await (
        await publicFetch(
          "https://plugins.jetbrains.com/api/plugins/32208/updates?size=100",
        )
      ).json(),
    );
    const archive = path.join(
      root,
      `chainlesschain-ide-bridge-${pluginVersion}.zip`,
    );
    const bytes = Buffer.from(
      await (
        await publicFetch(`https://plugins.jetbrains.com/files/${record.file}`)
      ).arrayBuffer(),
    );
    assert.ok(
      bytes.length > 100000 && bytes.length < 10 * 1024 * 1024,
      "unexpected public plugin size",
    );
    fs.writeFileSync(archive, bytes);
    save("marketplace.json", {
      ...record,
      digest: hash(bytes),
      bytes: bytes.length,
    });
    summary.stages.pluginDownload = {
      passed: true,
      digest: hash(bytes),
      public: true,
    };
    fs.writeFileSync(
      path.join(dirs.install, "package.json"),
      '{"private":true}\n',
    );
    await runCli(
      "install",
      [
        npmEntrypoint(),
        "install",
        `chainlesschain@${DIAGNOSTIC.publicVersion}`,
        "--omit=dev",
        "--no-audit",
        "--no-fund",
      ],
      { timeoutMs: 600000 },
    );
    const cli = path.join(
      dirs.install,
      "node_modules/chainlesschain/bin/chainlesschain.js",
    );
    const lockBytes = fs.readFileSync(
      path.join(dirs.install, "package-lock.json"),
    );
    const locked =
      JSON.parse(lockBytes).packages["node_modules/chainlesschain"];
    assert.equal(locked.version, DIAGNOSTIC.publicVersion);
    assert.ok(
      !locked.link &&
        locked.resolved.startsWith("https://registry.npmjs.org/") &&
        locked.integrity,
    );
    save("package-lock.json", lockBytes.toString("utf8"));
    await runCli("identity", [cli, "--version"]);
    summary.stages.cliInstall = {
      passed: true,
      locked,
      lifecycleScriptsEnabled: true,
    };
    for (const [name, value] of Object.entries({
      provider: DIAGNOSTIC.provider,
      model: DIAGNOSTIC.model,
      baseUrl: DIAGNOSTIC.endpoint,
    }))
      await runCli(`configure-${name}`, [
        cli,
        "config",
        "set",
        `llm.${name}`,
        value,
      ]);
    const auth = JSON.parse(
      (
        await runCli("authenticate", [cli, "llm", "test", "--json"], {
          env: { ...environment, VOLCENGINE_API_KEY: key },
          timeoutMs: 90000,
        })
      ).stdout.trim(),
    );
    assert.equal(auth.ok, true);
    assert.equal(auth.provider, DIAGNOSTIC.provider);
    assert.equal(auth.model, DIAGNOSTIC.model);
    assert.ok(
      auth.usage &&
        Number.isSafeInteger(auth.usage.input_tokens) &&
        Number.isSafeInteger(auth.usage.output_tokens),
    );
    summary.stages.authentication = { passed: true, usage: auth.usage };
    broker = await createVolcengineDiagnosticBroker({
      outputDir: path.join(output, "broker"),
      key,
      allowedTaskIds: [summary.sampleId],
    });
    const configPath = path.join(profile, "config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    config.llm.baseUrl = broker.baseUrl;
    fs.writeFileSync(configPath, JSON.stringify(config));
    const nonce = randomBytes(12).toString("hex");
    const input = { nonce, values: [9, 2, 8, 4] };
    fs.writeFileSync(
      path.join(dirs.workspace, "input.json"),
      JSON.stringify(input),
    );
    save("input.json", input);
    const promptFile = path.join(root, "prompt.txt");
    fs.writeFileSync(
      promptFile,
      "Read input.json using read_file. Write result.json using write_file with exactly three JSON fields: nonce copied from input, sum of values, and sorted containing values in ascending numerical order. Do not modify input.json. Use only file tools, then finish with a short statement.",
    );
    const shim = path.join(
      dirs.bin,
      process.platform === "win32" ? "cc.cmd" : "cc",
    );
    fs.writeFileSync(shim, cliShim(process.execPath, cli), { mode: 0o700 });
    const ideEnv = {
      ...environment,
      PATH: dirs.bin + path.delimiter + environment.PATH,
      VOLCENGINE_API_KEY: broker.childKey,
      CC_FORMAL_QUALITY_EVAL_HERMETIC: "1",
      CC_FORMAL_QUALITY_EVAL_PROVIDER: DIAGNOSTIC.provider,
      CC_FORMAL_QUALITY_EVAL_ISOLATION_ROOT: root,
      CC_FORMAL_QUALITY_EVAL_ALLOWED_FILES: JSON.stringify(["result.json"]),
      CC_IDE_REQUIRED_HOST_VERSION: ideVersion,
    };
    const gradle = path.join(
      pkg,
      process.platform === "win32" ? "gradlew.bat" : "gradlew",
    );
    const base = [
      "--no-daemon",
      "--no-configuration-cache",
      "--console=plain",
      `-PuiJourneyRunId=${path.basename(root)}`,
      `-PhostIdeVersion=${ideVersion}`,
      `-PpublicUiPluginArchive=${archive}`,
      `-PpublicUiPluginDigest=${hash(bytes)}`,
    ];
    const launch = (args, label, env = ideEnv) =>
      launchLogged(gradle, args, {
        cwd: pkg,
        env,
        logFile: path.join(output, `${label}.log`),
      });
    // The build subprocess has no provider key, including broker capability.
    await requireSuccess(
      launch(
        ["buildPlugin", "compileUiTestJava", ...base],
        "prepare",
        environment,
      ),
      Date.now() + 30 * 60 * 1000,
      "UI driver preparation",
    );
    const deadline = Date.now() + 20 * 60 * 1000;
    const params = [
      ...base,
      `-Dui.verify01.captureRoot=${dirs.capture}`,
      `-Dui.verify01.workspace=${dirs.workspace}`,
      `-Dui.verify01.home=${dirs.home}`,
      `-Dui.verify01.sampleId=${summary.sampleId}`,
      `-Dui.verify01.promptFile=${promptFile}`,
      `-Dui.verify01.deadlineMs=${deadline}`,
      "-Dui.verify01.permissionMode=acceptEdits",
      `-Dui.verify01.pluginVersion=${pluginVersion}`,
    ];
    await assertPortFree({ port: 8082 });
    broker.beginTask(summary.sampleId);
    for (const phase of ["initial", "restart"]) {
      console.log(
        JSON.stringify({
          sampleId: summary.sampleId,
          phase,
          realProvider: true,
        }),
      );
      active = launch(["runIdeForUiTests", ...params], `ide-${phase}`);
      try {
        const startup = Math.min(deadline, Date.now() + 8 * 60 * 1000);
        while (!(await robotReady())) {
          assert.ok(!active.closed, `${phase} IDE exited during startup`);
          assert.ok(Date.now() < startup, "Robot startup deadline exceeded");
          await delay(500);
        }
        await requireSuccess(
          launch(["uiSmokeTest", `-Dui.journey.phase=${phase}`, ...params]),
          deadline,
          `${phase} real UI capture`,
        );
      } finally {
        await stopOwned(active, {
          requireRunningOwner: true,
          gracefulStop: requestIdeExit,
          gracefulDeadline: Math.min(deadline, Date.now() + 30000),
        });
        active = null;
      }
      await waitForPortFree({
        port: 8082,
        deadline: Math.min(deadline, Date.now() + 30000),
      });
    }
    summary.stages.capture = verifyDiagnosticCapture(dirs.capture, "jetbrains");
    const records = JSON.parse(
      fs.readFileSync(path.join(dirs.capture, "protocol.json"), "utf8"),
    );
    const stream = records
      .filter((row) => row.direction === "output")
      .map((row) => JSON.stringify(row.event))
      .join("\n");
    const trace = inspectModelTrace(stream, ["result.json"], dirs.workspace);
    summary.stages.model = {
      passed: trace.pass,
      terminal: trace.terminal,
      broker: broker.taskStatus(summary.sampleId),
    };
    assert.ok(
      trace.pass && summary.stages.model.broker.passed,
      "real model/tool terminal verification failed",
    );
    summary.stages.artifact = validateArtifact(dirs.workspace, nonce);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(dirs.workspace, "input.json"))),
      input,
    );
    fs.copyFileSync(
      path.join(dirs.workspace, "result.json"),
      path.join(output, "result.json"),
    );
    summary.providerAssessed = true;
    summary.passed = true;
  } catch (error) {
    summary.failure = redactDiagnostic(String(error.message), key);
  } finally {
    if (active) {
      try {
        await stopOwned(active);
      } catch (error) {
        summary.cleanupFailure = error.message;
        summary.passed = false;
      }
    }
    if (broker) {
      try {
        summary.broker = await broker.close();
      } catch {
        summary.passed = false;
        summary.failure = "broker finalization failed";
      }
    }
    fs.cpSync(dirs.capture, path.join(output, "capture"), { recursive: true });
    for (const file of fs
      .readdirSync(output)
      .filter((name) => name.endsWith(".log"))) {
      const target = path.join(output, file);
      const bytes = fs.readFileSync(target, "utf8");
      fs.writeFileSync(
        target,
        redactDiagnostic(redactDiagnostic(bytes, key), broker?.childKey),
      );
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
  assert.ok(
    values["confirm-live"] && values["output-dir"],
    "--confirm-live and --output-dir required",
  );
  const summary = await runPublicFirstRun({
    outputDir: values["output-dir"],
    key: process.env.VOLCENGINE_API_KEY,
  });
  console.log(
    JSON.stringify({
      sampleId: summary.sampleId,
      passed: summary.passed,
      failure: summary.failure,
      formalSample: false,
    }),
  );
  if (!summary.passed) process.exitCode = 1;
}
