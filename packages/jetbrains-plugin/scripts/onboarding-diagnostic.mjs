#!/usr/bin/env node
// Windows real-host command discovery diagnostics, never formal/provider evidence.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import {
  launchLogged,
  requireSuccess,
  stopOwned,
} from "../../../scripts/lib/verify01-diagnostic-process.mjs";
import {
  reserveArtifactDirectory,
  archiveDiagnostic,
} from "../../../scripts/lib/verify01-diagnostic-evidence.mjs";
import {
  readPluginVersion,
  findPluginArchive,
} from "./run-ui-host-journey.mjs";

const pkg = path.resolve(import.meta.dirname, "..");
const { values } = parseArgs({
  options: {
    "artifact-dir": { type: "string" },
    "ide-version": { type: "string", default: "2024.2" },
  },
});
if (process.platform !== "win32")
  throw new Error(
    "This command-absence diagnostic currently isolates Windows PATH only",
  );
if (!/^\d{4}\.\d+(?:\.\d+)?$/u.test(values["ide-version"]))
  throw new Error("Exact IDE version required");
const destination = reserveArtifactDirectory(values["artifact-dir"]);
const root = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "cc-onboard-")),
);
const dirs = Object.fromEntries(
  ["workspace", "home", "capture", "bin"].map((k) => [k, path.join(root, k)]),
);
for (const directory of Object.values(dirs)) fs.mkdirSync(directory);
const deadline = Date.now() + 25 * 60 * 1000;
const fixture = path.join(root, "identity-peer.cjs");
const trace = path.join(root, "identity-trace.jsonl");
const mode = path.join(dirs.capture, "version-mode.txt");
fs.writeFileSync(mode, "valid");
fs.writeFileSync(trace, "");
fs.writeFileSync(
  fixture,
  `const fs=require('node:fs');
const identity=process.argv[2],args=process.argv.slice(3);
const mode=identity==='managed'?'valid':fs.readFileSync(${JSON.stringify(mode)},'utf8');
fs.appendFileSync(${JSON.stringify(trace)},JSON.stringify({at:new Date().toISOString(),pid:process.pid,identity,args,mode})+'\\n');
if(args.includes('--version'))console.log(mode==='gcc'?'cc (GCC) 12.2.0':'0.166.89');
else if(args[0]==='agent'){console.error('Agent invocation forbidden in identity diagnostic');process.exitCode=98;}
else console.log('{}');
`,
);
const shim = (file, identity) =>
  fs.writeFileSync(
    file,
    `@echo off\r\n"${process.execPath}" "${fixture}" "${identity}" %*\r\n`,
  );
const goodCommand = path.join(root, "good.cmd");
const globalCommand = path.join(dirs.bin, "cc.cmd");
shim(goodCommand, "explicit");
shim(globalCommand, "global");
// Deterministic local managed layout; this does not claim registry installation.
const managed = path.join(
  dirs.home,
  ".chainlesschain",
  "ide",
  "managed-cli-jetbrains",
);
const managedPackage = path.join(managed, "0.166.89", "package");
fs.mkdirSync(managedPackage, { recursive: true });
fs.writeFileSync(
  path.join(managedPackage, "package.json"),
  JSON.stringify({
    name: "chainlesschain",
    version: "0.166.89",
    bin: { cc: "entry.cjs" },
  }),
);
fs.writeFileSync(
  path.join(managedPackage, "entry.cjs"),
  "// Deterministic fixture entry; shim invokes the traced peer.\n",
);
fs.writeFileSync(
  path.join(managed, "current.json"),
  JSON.stringify({ version: "0.166.89", previousVersion: null }),
);
shim(path.join(managed, "cc-managed.cmd"), "managed");
fs.writeFileSync(
  path.join(dirs.capture, "onboarding-config.json"),
  JSON.stringify(
    {
      deadlineMs: deadline,
      goodCommand,
      globalCommand,
      missingCommand: path.join(root, "not-installed.cmd"),
    },
    null,
    2,
  ),
);

const env = {
  ...process.env,
  HOME: dirs.home,
  USERPROFILE: dirs.home,
  CHAINLESSCHAIN_HOME: path.join(dirs.home, ".chainlesschain"),
};
for (const key of Object.keys(env))
  if (
    /^(?:path|nvm_bin|nvm_symlink|volta_home|fnm_multishell_path)$/iu.test(key)
  )
    delete env[key];
env.PATH = `${dirs.bin};${path.join(process.env.SystemRoot || "C:\\Windows", "System32")}`;
for (const key of ["APPDATA", "LOCALAPPDATA", "ProgramFiles"]) {
  env[key] = path.join(root, key);
  fs.mkdirSync(env[key]);
}
const gradle =
  process.env.CC_JETBRAINS_GRADLE_EXECUTABLE || path.join(pkg, "gradlew.bat");
const base = [
  "--no-daemon",
  "--no-configuration-cache",
  "--console=plain",
  `-PuiJourneyRunId=${path.basename(root)}`,
  `-PhostIdeVersion=${values["ide-version"]}`,
  ...(process.env.CC_JETBRAINS_IDE_LOCAL_PATH
    ? [`-PhostIdeLocalPath=${process.env.CC_JETBRAINS_IDE_LOCAL_PATH}`]
    : []),
];
const params = [
  ...base,
  `-Dui.verify01.captureRoot=${dirs.capture}`,
  `-Dui.verify01.workspace=${dirs.workspace}`,
  `-Dui.verify01.home=${dirs.home}`,
  `-Dui.onboarding.root=${dirs.capture}`,
];
const launch = (args, name, childEnv = process.env) =>
  launchLogged(gradle, args, {
    cwd: pkg,
    env: childEnv,
    logFile: path.join(root, `${name}.log`),
  });
let active;
const result = {
  scope: "real-windows-intellij-onboarding-local-command-fixtures",
  formalSample: false,
  providerAssessed: false,
  publicInstallationAssessed: false,
  passed: false,
  root,
  platform: process.platform,
  node: process.version,
  hostVersion: values["ide-version"],
};
result.source = {
  commit: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: pkg,
    encoding: "utf8",
    windowsHide: true,
  }).trim(),
  dirty:
    execFileSync(
      "git",
      ["status", "--porcelain", "--", "packages/jetbrains-plugin"],
      { cwd: path.resolve(pkg, "../.."), encoding: "utf8", windowsHide: true },
    ).trim().length > 0,
  files: Object.fromEntries(
    [
      "src/main/java/com/chainlesschain/ide/AgentChatSession.java",
      "src/main/java/com/chainlesschain/ide/intellij/ConversationView.java",
      "src/main/java/com/chainlesschain/ide/intellij/CcConfigurable.java",
      "src/uiTest/java/com/chainlesschain/ide/uitest/OnboardingIdentityJourney.java",
      "scripts/onboarding-diagnostic.mjs",
    ].map((file) => [
      file,
      `sha256:${createHash("sha256")
        .update(fs.readFileSync(path.join(pkg, file)))
        .digest("hex")}`,
    ]),
  ),
};
console.log(`Onboarding diagnostic: ${root}`);
async function portFree() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(8082, "127.0.0.1", resolve);
  });
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
async function exitIde({ signal }) {
  const response = await fetch("http://127.0.0.1:8082/js/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      runInEdt: false,
      script:
        "importClass(com.intellij.openapi.application.ApplicationManager); importClass(java.lang.Runnable); var app=ApplicationManager.getApplication(); app.invokeLater(new Runnable({run:function(){app.exit(Packages.com.intellij.openapi.application.ex.ApplicationEx.EXIT_CONFIRMED | Packages.com.intellij.openapi.application.ex.ApplicationEx.SAVE);}}));",
    }),
  });
  if (!response.ok || (await response.json()).exception)
    throw new Error("IDE normal exit request failed");
}
try {
  await portFree();
  await requireSuccess(
    launch(["buildPlugin", "compileUiTestJava", ...base], "prepare"),
    deadline,
    "onboarding preparation",
  );
  const version = readPluginVersion(
    path.join(pkg, "src/main/resources/META-INF/plugin.xml"),
  );
  const archive = findPluginArchive(
    path.join(pkg, "build/distributions"),
    version,
  );
  result.pluginVersion = version;
  result.pluginDigest = `sha256:${createHash("sha256").update(fs.readFileSync(archive)).digest("hex")}`;
  active = launch(["runIdeForUiTests", ...params], "ide", env);
  const startup = Math.min(deadline, Date.now() + 5 * 60 * 1000);
  while (true) {
    if (active.closed || Date.now() >= startup)
      throw new Error("IDE did not start within deadline");
    try {
      if (
        (
          await fetch("http://127.0.0.1:8082", {
            signal: AbortSignal.timeout(1000),
          })
        ).ok
      )
        break;
    } catch {}
    await delay(500);
  }
  await requireSuccess(
    launch(["uiSmokeTest", ...params], "ui"),
    deadline,
    "onboarding UI journey",
  );
  const records = fs
    .readFileSync(trace, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  if (records.some((r) => r.args[0] === "agent"))
    throw new Error("Unexpected agent invocation");
  if (
    !records.some(
      (r) => r.identity === "managed" && r.args.includes("--version"),
    )
  )
    throw new Error("Managed CLI was never actually probed");
  const cases = JSON.parse(
    fs.readFileSync(path.join(dirs.capture, "onboarding-ui.json"), "utf8"),
  );
  if (
    cases.length !== 8 ||
    new Set(cases.map((c) => c.snapshot.processId)).size !== 1
  )
    throw new Error("Eight observations from one IDE process required");
  result.cases = cases.map((c) => c.case);
  result.commandInvocations = records.length;
  result.passed = true;
} catch (error) {
  result.error = error.stack;
  process.exitCode = 1;
} finally {
  try {
    await stopOwned(active, {
      requireRunningOwner: true,
      gracefulStop: exitIde,
      gracefulDeadline: Math.min(deadline, Date.now() + 30000),
    });
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
    cleanupError: result.cleanupError,
  }),
);
