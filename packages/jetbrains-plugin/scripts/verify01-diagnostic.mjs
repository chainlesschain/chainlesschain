#!/usr/bin/env node
// Real IDE, deterministic peer. No account, provider billing or formal sample.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import {
  createFakeCliEnvironment,
  readPluginVersion,
  findPluginArchive,
} from "./run-ui-host-journey.mjs";
import {
  launchLogged,
  requireSuccess,
  stopOwned,
} from "../../../scripts/lib/verify01-diagnostic-process.mjs";
import {
  reserveArtifactDirectory,
  archiveDiagnostic,
  verifyDiagnosticCapture,
} from "../../../scripts/lib/verify01-diagnostic-evidence.mjs";
import { createHash } from "node:crypto";
import {
  canonicalTraceOffset,
  waitForCanonicalCommands,
} from "../../../scripts/lib/verify01-diagnostic-command-drain.mjs";

const pkg = path.resolve(import.meta.dirname, "..");
const robotUrl = "http://127.0.0.1:8082";

async function requestIdeExit({ signal }) {
  const response = await fetch(`${robotUrl}/js/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      runInEdt: false,
      script:
        "importClass(com.intellij.openapi.application.ApplicationManager); importClass(java.lang.Runnable); const app=ApplicationManager.getApplication(); app.invokeLater(new Runnable({run:function(){app.exit(Packages.com.intellij.openapi.application.ex.ApplicationEx.EXIT_CONFIRMED | Packages.com.intellij.openapi.application.ex.ApplicationEx.SAVE);}}));",
    }),
  });
  if (!response.ok)
    throw new Error(`IDE exit request returned HTTP ${response.status}`);
  const body = await response.json();
  if (body.exception)
    throw new Error(
      `IDE exit request failed: ${body.message || "Remote Robot exception"}`,
    );
}

async function robotReady() {
  try {
    const response = await fetch(robotUrl, {
      signal: AbortSignal.timeout(1000),
    });
    return response.status >= 200 && response.status < 400;
  } catch {
    return false;
  }
}

async function assertPortFree() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(8082, "127.0.0.1", resolve);
  });
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      "ide-version": { type: "string", default: "2024.2" },
      "artifact-dir": { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "Real IntelliJ initial/restart diagnostic with deterministic local peer.\n--ide-version 2024.2 --artifact-dir NEW_DIRECTORY\nRequires JDK 21; downloads/builds during bounded preparation. No provider call or formal observations.",
    );
    return;
  }
  if (!/^\d{4}\.\d+(?:\.\d+)?$/u.test(values["ide-version"]))
    throw new Error("Exact IntelliJ release required");
  const destination = reserveArtifactDirectory(values["artifact-dir"]);
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "cc-verify01-jetbrains-")),
  );
  const dirs = Object.fromEntries(
    ["workspace", "capture", "home"].map((key) => [key, path.join(root, key)]),
  );
  for (const directory of Object.values(dirs)) fs.mkdirSync(directory);
  fs.mkdirSync(path.join(dirs.home, ".chainlesschain"));
  fs.writeFileSync(
    path.join(dirs.home, ".chainlesschain", "config.json"),
    JSON.stringify({
      llm: {
        provider: "ollama",
        model: "deterministic-host-peer",
        baseUrl: "http://127.0.0.1:11434",
      },
    }),
  );
  const prompt = path.join(root, "prompt.txt");
  fs.writeFileSync(prompt, "journey:history-A");
  const scope = {
    root,
    scope: "real-jetbrains-host-with-deterministic-peer",
    formalSample: false,
    providerAssessed: false,
    observationsCreated: false,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    sourceCommit: process.env.GITHUB_SHA || null,
    hostVersion: values["ide-version"],
  };
  fs.writeFileSync(
    path.join(root, "diagnostic-scope.json"),
    JSON.stringify(scope, null, 2),
  );
  const env = createFakeCliEnvironment(root, {
    ...process.env,
    CC_UI_CONVERSATION_RECOVERY: "1",
  });
  const gradle =
    process.env.CC_JETBRAINS_GRADLE_EXECUTABLE ||
    path.join(pkg, process.platform === "win32" ? "gradlew.bat" : "gradlew");
  const localIde = process.env.CC_JETBRAINS_IDE_LOCAL_PATH;
  if (
    localIde &&
    (!path.isAbsolute(localIde) || !fs.statSync(localIde).isDirectory())
  )
    throw new Error(
      "CC_JETBRAINS_IDE_LOCAL_PATH must be an existing absolute directory",
    );
  const base = [
    "--no-daemon",
    // IntelliJ Gradle 2.1 tasks still access Task.project during execution.
    // A natural IDE exit exposes that incompatibility when Gradle saves its
    // configuration cache; keep this isolated diagnostic uncached.
    "--no-configuration-cache",
    "--console=plain",
    `-PuiJourneyRunId=${path.basename(root)}`,
    `-PhostIdeVersion=${values["ide-version"]}`,
    ...(localIde ? [`-PhostIdeLocalPath=${localIde}`] : []),
  ];
  const launch = (args, label) =>
    launchLogged(gradle, args, {
      cwd: pkg,
      env,
      logFile: path.join(root, `${label}.log`),
    });
  let active;
  let result = { ...scope, passed: false };
  console.log(`Diagnostic evidence: ${root}`);
  try {
    await assertPortFree();
    await requireSuccess(
      launch(["buildPlugin", "compileUiTestJava", ...base], "prepare"),
      Date.now() + 30 * 60 * 1000,
      "preparation",
    );
    const version = readPluginVersion(
      path.join(pkg, "src/main/resources/META-INF/plugin.xml"),
    );
    const archive = findPluginArchive(
      path.join(pkg, "build/distributions"),
      version,
    );
    if (!archive) throw new Error("Built plugin archive missing");
    result.pluginVersion = version;
    result.pluginDigest = `sha256:${createHash("sha256").update(fs.readFileSync(archive)).digest("hex")}`;
    const deadline = Date.now() + 12 * 60 * 1000;
    const params = [
      ...base,
      `-Dui.verify01.captureRoot=${dirs.capture}`,
      `-Dui.verify01.workspace=${dirs.workspace}`,
      `-Dui.verify01.home=${dirs.home}`,
      "-Dui.verify01.sampleId=verify-03",
      `-Dui.verify01.promptFile=${prompt}`,
      `-Dui.verify01.deadlineMs=${deadline}`,
      "-Dui.verify01.permissionMode=acceptEdits",
    ];
    const traceFile = path.join(root, "fake-cli-protocol.jsonl");
    for (const phase of ["initial", "restart"]) {
      const traceOffset = canonicalTraceOffset(traceFile);
      console.log(`Starting ${phase} actual IDE`);
      active = launch(["runIdeForUiTests", ...params], `ide-${phase}`);
      try {
        const startup = Math.min(deadline, Date.now() + 5 * 60 * 1000);
        while (!(await robotReady())) {
          if (active.closed)
            throw new Error(`${phase} IDE exited during startup`);
          if (Date.now() >= startup)
            throw new Error("Robot startup deadline exceeded");
          await delay(500);
        }
        await requireSuccess(
          launch(
            ["uiSmokeTest", `-Dui.journey.phase=${phase}`, ...params],
            `test-${phase}`,
          ),
          deadline,
          `${phase} UI capture`,
        );
        // Returning to the tab can start a real CLI history read after the
        // rendered result is visible. Let that short command close normally
        // before requesting IDE shutdown.
        const drain = await waitForCanonicalCommands(traceFile, {
          offset: traceOffset,
          deadline,
          // Restoring unused tabs also probes missing canonical sessions.
          // Drain all children; require successful history for this task and
          // retain unrelated query failures without inventing empty sessions.
          requiredSessionId: JSON.parse(
            fs.readFileSync(
              path.join(dirs.capture, "restart-state.json"),
              "utf8",
            ),
          ).sessionId,
        });
        result.canonicalCommandDrain ??= {};
        result.canonicalCommandDrain[phase] = drain;
      } finally {
        await stopOwned(active, {
          requireRunningOwner: true,
          gracefulStop: requestIdeExit,
          gracefulDeadline: Math.min(deadline, Date.now() + 30000),
        });
        active = null;
      }
      const shutdown = Math.min(deadline, Date.now() + 30000);
      while (await robotReady()) {
        if (Date.now() >= shutdown)
          throw new Error("Robot endpoint did not stop");
        await delay(250);
      }
      await assertPortFree();
    }
    result.capture = verifyDiagnosticCapture(dirs.capture, "jetbrains");
    result.passed = true;
  } catch (error) {
    result.error = error.stack;
    process.exitCode = 1;
  } finally {
    try {
      await stopOwned(active, { requireRunningOwner: true });
    } catch (error) {
      result.passed = false;
      result.cleanupError = error.stack;
      process.exitCode = 1;
    }
    fs.writeFileSync(
      path.join(root, "diagnostic-result.json"),
      JSON.stringify(result, null, 2),
    );
    archiveDiagnostic(root, destination);
  }
  console.log(
    JSON.stringify({
      root,
      destination,
      passed: result.passed,
      error: result.error,
    }),
  );
  return result;
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
