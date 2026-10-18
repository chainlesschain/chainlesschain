/** Real public JetBrains plugin UI task + restart; called by native campaign. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { cliShim } from "./verify01-public-first-run.mjs";
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
const digest = (bytes) =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");
async function robotReady() {
  try {
    return (
      await fetch("http://127.0.0.1:8082", {
        signal: AbortSignal.timeout(1000),
      })
    ).ok;
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
  assert.ok(
    response.ok && !(await response.json()).exception,
    "IDE graceful exit failed",
  );
}

// Serialized into the standalone adapter; no imports from the evaluated product.
function captureCliStderr(node, cli, args, options) {
  const fs = require("node:fs");
  const path = require("node:path");
  const { randomUUID, createHash } = require("node:crypto");
  const { StringDecoder } = require("node:string_decoder");
  const { spawn } = require("node:child_process");
  const decoder = new StringDecoder("utf8");
  const secrets = [
    ...new Set(
      Object.entries(process.env)
        .filter(([name]) =>
          /(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|CAPABILITY)/i.test(name),
        )
        .flatMap(([, value]) =>
          value ? [value, ...value.split(/[\r\n]+/)] : [],
        )
        .filter(Boolean),
    ),
  ].sort((a, b) => b.length - a.length);
  const metadata = {
    schema: "chainlesschain.cli-stderr-redacted/v1",
    raw: false,
    policy:
      "UTF-8 complete lines; runtime credential environment values redacted; overlong lines omitted entirely; bounded diagnostic copy only",
    maxBytes: options.maxBytes,
    maxLineBytes: options.maxLineBytes,
    bytesObserved: 0,
    bytesStored: 0,
    truncated: false,
    omittedLines: 0,
    captureErrors: [],
  };
  const base = path.join(options.captureDir, randomUUID() + ".stderr-redacted");
  let fd,
    line = "",
    lineBytes = 0,
    omitting = false;
  let capped = false;
  const failure = (stage, error) => {
    // Error messages may contain paths or credentials; retain only safe codes.
    metadata.captureErrors.push({
      stage,
      code: /^[A-Z0-9_]+$/.test(error.code || "")
        ? error.code
        : "CAPTURE_ERROR",
    });
  };
  try {
    fs.mkdirSync(options.captureDir, { recursive: true });
    fd = fs.openSync(base + ".txt", "wx", 0o600);
  } catch (error) {
    failure("open", error);
  }
  function emit() {
    if (omitting) {
      metadata.omittedLines++;
      metadata.truncated = true;
    } else if (fd !== undefined && !capped) {
      let redacted = line;
      for (const secret of secrets)
        redacted = redacted.split(secret).join("[REDACTED]");
      const bytes = Buffer.from(redacted, "utf8");
      if (metadata.bytesStored + bytes.length > options.maxBytes) {
        metadata.truncated = capped = true;
      } else {
        const before = metadata.bytesStored;
        try {
          let offset = 0;
          while (offset < bytes.length) {
            const written = fs.writeSync(
              fd,
              bytes,
              offset,
              bytes.length - offset,
            );
            if (!written) throw new Error("zero-byte diagnostic write");
            metadata.bytesStored += written;
            offset += written;
          }
        } catch (error) {
          failure("write", error);
          metadata.truncated = capped = true;
          try {
            fs.ftruncateSync(fd, before);
            metadata.bytesStored = before;
          } catch (rollbackError) {
            failure("discard-partial-line", rollbackError);
          }
        }
      }
    }
    line = "";
    lineBytes = 0;
    omitting = false;
  }
  function consume(text) {
    // Split only complete decoded text; never persist an unfinished secret.
    let start = 0;
    while (start < text.length) {
      const end = text.indexOf("\n", start);
      const piece = text.slice(start, end < 0 ? text.length : end + 1);
      if (!omitting && !capped) {
        lineBytes += Buffer.byteLength(piece);
        if (lineBytes > options.maxLineBytes) {
          omitting = true;
          line = "";
        } else line += piece;
      }
      if (end < 0) break;
      emit();
      start = end + 1;
    }
  }
  const child = spawn(node, [cli, ...args], {
    stdio: ["inherit", "inherit", "pipe"],
    env: { ...process.env, CC_TASK_WORKLOG: "0" },
  });
  child.stderr.pipe(process.stderr, { end: false });
  child.stderr.on("data", (chunk) => {
    metadata.bytesObserved += chunk.length;
    consume(decoder.write(chunk));
  });
  child.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
  child.on("close", (code, signal) => {
    consume(decoder.end());
    if (line || omitting) emit();
    metadata.childExitCode = code;
    metadata.childSignal = signal;
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch (error) {
        failure("close", error);
      }
    }
    metadata.redactedDigest = null;
    if (fd !== undefined) {
      try {
        metadata.redactedDigest =
          "sha256:" +
          createHash("sha256")
            .update(fs.readFileSync(base + ".txt"))
            .digest("hex");
      } catch (error) {
        failure("digest", error);
      }
    }
    try {
      fs.writeFileSync(
        base + ".json",
        JSON.stringify(metadata, null, 2) + "\n",
        { flag: "wx", mode: 0o600 },
      );
    } catch {
      /* A missing metadata file denotes failed capture, never success. */
    }
  });
}

export function adapterArgv(cliPath, capture) {
  if (capture) {
    const options = {
      maxBytes: 1024 * 1024,
      maxLineBytes: 64 * 1024,
      ...capture,
    };
    assert.ok(path.isAbsolute(options.captureDir));
    for (const key of ["maxBytes", "maxLineBytes"])
      assert.ok(Number.isSafeInteger(options[key]) && options[key] > 0);
    return (
      adapterArgv(cliPath).replace(
        "const child=spawn(",
        `if(args[0]==='agent'){(${captureCliStderr.toString()})(${JSON.stringify(process.execPath)},${JSON.stringify(cliPath)},args,${JSON.stringify(options)});}else{const child=spawn(`,
      ) + "}"
    );
  }
  return `const {spawn}=require('node:child_process');const args=process.argv.slice(2);if(args[0]==='agent')args.push('--allowed-tools','read_file,search_files,list_dir,write_file,edit_file,edit_file_hashed','--no-ide','--no-mcp','--no-pdh','--no-jetbrains','--no-project-memory','--no-file-refs','--no-slash-macros','--max-turns','20');const child=spawn(${JSON.stringify(process.execPath)},[${JSON.stringify(cliPath)},...args],{stdio:'inherit',env:{...process.env,CC_TASK_WORKLOG:'0'}});child.on('error',e=>{console.error(e.message);process.exitCode=1});child.on('exit',code=>{process.exitCode=code??1});`;
}

export async function runJetBrainsNativeTask({
  sample,
  task,
  prompt,
  workspace,
  profileHome,
  profile,
  cliPath,
  outputDir,
  deadline,
  environment,
  pluginArchive,
  pluginDigest,
  versions,
}) {
  assert.equal(profile, path.join(profileHome, ".chainlesschain"));
  assert.ok(deadline > Date.now() && deadline - Date.now() <= 30 * 60 * 1000);
  const uiDeadline = Math.min(deadline, Date.now() + 20 * 60 * 1000);
  assert.equal(digest(fs.readFileSync(pluginArchive)), pluginDigest);
  const captureDir = path.join(outputDir, "capture");
  fs.mkdirSync(captureDir);
  const promptFile = path.join(outputDir, "prompt.txt");
  if (fs.existsSync(promptFile))
    assert.equal(
      fs.readFileSync(promptFile, "utf8"),
      prompt,
      "frozen prompt differs",
    );
  else fs.writeFileSync(promptFile, prompt, { flag: "wx" });
  const bin = path.join(profileHome, "bin");
  fs.mkdirSync(bin);
  const adapter = path.join(bin, "public-cli.cjs");
  fs.writeFileSync(
    adapter,
    adapterArgv(cliPath, {
      captureDir: path.join(outputDir, "cli-stderr-diagnostics"),
    }),
    { flag: "wx" },
  );
  fs.writeFileSync(
    path.join(bin, process.platform === "win32" ? "cc.cmd" : "cc"),
    cliShim(process.execPath, adapter),
    { flag: "wx", mode: 0o700 },
  );
  const env = {
    ...environment,
    PATH: bin + path.delimiter + environment.PATH,
    HOME: profileHome,
    USERPROFILE: profileHome,
    CHAINLESSCHAIN_HOME: profile,
    CC_IDE_REQUIRED_HOST_VERSION: versions.jetbrainsHost,
  };
  for (const name of [
    "JAVA_HOME",
    "GRADLE_USER_HOME",
    "DISPLAY",
    "XAUTHORITY",
    "SystemRoot",
    "WINDIR",
    "ComSpec",
    "PATHEXT",
  ])
    if (!env[name] && process.env[name]) env[name] = process.env[name];
  const buildEnv = { ...env };
  delete buildEnv.VOLCENGINE_API_KEY;
  const gradle = path.join(
    pkg,
    process.platform === "win32" ? "gradlew.bat" : "gradlew",
  );
  const journey = `native-${sample.id}-${Date.now()}`;
  assert.ok(journey.length <= 80);
  const base = [
    "--no-daemon",
    "--no-configuration-cache",
    "--console=plain",
    `-PuiJourneyRunId=${journey}`,
    `-PhostIdeVersion=${versions.jetbrainsHost}`,
    `-PpublicUiPluginArchive=${pluginArchive}`,
    `-PpublicUiPluginDigest=${pluginDigest}`,
  ];
  const params = [
    ...base,
    `-Dui.verify01.captureRoot=${captureDir}`,
    `-Dui.verify01.workspace=${workspace}`,
    `-Dui.verify01.home=${profileHome}`,
    `-Dui.verify01.sampleId=${sample.id}`,
    `-Dui.verify01.promptFile=${promptFile}`,
    `-Dui.verify01.deadlineMs=${uiDeadline}`,
    "-Dui.verify01.permissionMode=acceptEdits",
    `-Dui.verify01.pluginVersion=${versions.jetbrains}`,
  ];
  const launch = (args, label, childEnv = env) => {
    assert.ok(
      typeof label === "string" && label.length > 0,
      "explicit unique process label required",
    );
    return launchLogged(gradle, args, {
      cwd: pkg,
      env: childEnv,
      logFile: path.join(outputDir, `${label}.log`),
    });
  };
  let active;
  const result = {
    ok: false,
    captureDir,
    sampleId: sample.id,
    taskId: task.id,
    publicPluginDigest: pluginDigest,
    cliAdapterDigest: digest(fs.readFileSync(adapter)),
  };
  try {
    await assertPortFree({ port: 8082 });
    await requireSuccess(
      launch(
        ["buildPlugin", "compileUiTestJava", ...base],
        "prepare",
        buildEnv,
      ),
      deadline,
      "native UI preparation",
    );
    for (const phase of ["initial", "restart"]) {
      active = launch(["runIdeForUiTests", ...params], `ide-${phase}`);
      try {
        const startup = Math.min(deadline, Date.now() + 8 * 60 * 1000);
        while (!(await robotReady())) {
          assert.ok(!active.closed, `${phase} IDE exited before readiness`);
          assert.ok(
            Date.now() < startup,
            "native Robot startup deadline exceeded",
          );
          await delay(500);
        }
        await requireSuccess(
          launch(
            ["uiSmokeTest", `-Dui.journey.phase=${phase}`, ...params],
            `test-${phase}`,
            buildEnv,
          ),
          deadline,
          `${phase} native UI task`,
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
      if (
        phase === "initial" &&
        !fs.existsSync(path.join(captureDir, "restart-state.json"))
      )
        throw new Error(
          "model task failed before a restartable result; see real protocol",
        );
    }
    result.capture = verifyDiagnosticCapture(captureDir, "jetbrains");
    result.ok = true;
  } catch (error) {
    result.failure = error.message;
  } finally {
    if (active) {
      try {
        await stopOwned(active);
      } catch (error) {
        result.cleanupFailure = error.message;
        result.ok = false;
      }
    }
    const protocol = path.join(captureDir, "protocol.json");
    if (fs.existsSync(protocol)) {
      try {
        result.stdout = JSON.parse(fs.readFileSync(protocol, "utf8"))
          .filter((row) => row.direction === "output")
          .map((row) => JSON.stringify(row.event))
          .join("\n");
      } catch {
        result.ok = false;
        result.failure ||= "invalid native protocol capture";
      }
    }
  }
  return result;
}
