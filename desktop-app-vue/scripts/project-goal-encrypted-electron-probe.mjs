import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { electron: { type: "string" }, output: { type: "string" } },
});
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const require = createRequire(path.join(root, "package.json"));
const executable = values.electron || require("electron");
const profile = fs.mkdtempSync(
  path.join(fs.realpathSync.native(os.tmpdir()), "cc-encrypted-goal-electron-"),
);
const resultFile = path.join(profile, "result.json");
const fixture = path.join(
  root,
  "desktop-app-vue/src/main/task/__tests__/fixtures/project-goal-encrypted-electron.cjs",
);
const env = {
  ...process.env,
  CC_GOAL_ELECTRON_PROBE_PROFILE: profile,
  CC_GOAL_ELECTRON_PROBE_RESULT: resultFile,
};
delete env.ELECTRON_RUN_AS_NODE;
let diagnostics = "";
await new Promise((resolve, reject) => {
  const child = spawn(executable, [fixture], {
    cwd: root,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const timer = setTimeout(() => {
    child.kill();
    reject(new Error("Encrypted goal Electron probe exceeded 120 seconds"));
  }, 120_000);
  const capture = (bytes) => {
    diagnostics = (diagnostics + bytes.toString()).slice(-1024 * 1024);
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  child.once("error", (error) => {
    clearTimeout(timer);
    reject(error);
  });
  child.once("exit", (code, signal) => {
    clearTimeout(timer);
    if (code !== 0 || signal)
      reject(
        new Error(`Electron probe failed (${code}/${signal})\n${diagnostics}`),
      );
    else resolve();
  });
});
const result = JSON.parse(fs.readFileSync(resultFile, "utf8"));
if (
  result.passed !== true ||
  Object.values(result.checks).some((value) => typeof value !== "boolean")
)
  throw new Error("Invalid probe result");
const sourceFiles = [
  "desktop-app-vue/src/main/task/project-goal-native-database.js",
  "desktop-app-vue/src/main/task/project-goal-ipc.js",
  "desktop-app-vue/src/main/task/project-goal-monitoring-host.js",
  "desktop-app-vue/src/main/database/sqlcipher-wrapper.js",
  "desktop-app-vue/src/main/task/__tests__/fixtures/project-goal-encrypted-electron.cjs",
  "desktop-app-vue/scripts/project-goal-encrypted-electron-probe.mjs",
];
result.sources = Object.fromEntries(
  sourceFiles.map((file) => [
    file,
    createHash("sha256")
      .update(fs.readFileSync(path.join(root, file)))
      .digest("hex"),
  ]),
);
result.executable = path.resolve(executable);
result.profile = profile;
if (values.output)
  fs.writeFileSync(
    path.resolve(values.output),
    JSON.stringify(result, null, 2) + "\n",
    { flag: "wx" },
  );
console.log(JSON.stringify(result));
