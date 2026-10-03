import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hash, delay, writeJson } from "./shared.mjs";

const EXPECTED_SOURCE = "1fe7a46c0f97b93fb5110ea3427cc8551d0dab37";
const source = path.resolve(process.argv[2]);
const output = path.resolve(process.argv[3]);
fs.mkdirSync(path.join(output, "blobs"), { recursive: true });
const directory = path.dirname(fileURLToPath(import.meta.url));
const git = (...args) => {
  const result = spawnSync("git", ["-C", source, ...args], {
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
};
function peMachine(file) {
  const bytes = fs.readFileSync(file);
  return `0x${bytes.readUInt16LE(bytes.readUInt32LE(0x3c) + 4).toString(16)}`;
}
const sourceFiles = [
  "packages/cli/src/lib/packer/pack-update-applier.js",
  "packages/cli/src/lib/packer/native-update-state.js",
  "packages/cli/__tests__/unit/packer-pack-update-applier.test.js",
];
const fileHashes = () =>
  Object.fromEntries(
    sourceFiles.map((file) => [
      file,
      hash(fs.readFileSync(path.join(source, file))),
    ]),
  );
const identity = {
  schema: "chainlesschain.windows-arm64-updater-diagnostic.v1",
  sourceSha: git("rev-parse", "HEAD"),
  driverSha: process.env.GITHUB_SHA ?? null,
  platform: process.platform,
  arch: process.arch,
  nodeVersion: process.version,
  nodeExecPath: process.execPath,
  nodePeMachine: peMachine(process.execPath),
  os: {
    type: os.type(),
    release: os.release(),
    machine: os.machine(),
    cpus: os.cpus().length,
  },
  processorArchitecture: process.env.PROCESSOR_ARCHITECTURE,
  runnerArch: process.env.RUNNER_ARCH,
  sourceCleanBefore:
    git("status", "--porcelain", "--untracked-files=no") === "",
  sourceHashesBefore: fileHashes(),
  driverHashes: Object.fromEntries(
    fs
      .readdirSync(directory)
      .filter((name) => name.endsWith(".mjs"))
      .map((name) => [name, hash(fs.readFileSync(path.join(directory, name)))]),
  ),
  releaseEligible: false,
  boundary:
    "diagnostic instrumentation only; original tests/production bytes/deadlines unchanged; late observations never convert failed assertions to passes; file observations are sampled at 100ms and observer startup adds measured pre-call overhead",
};
writeJson(path.join(output, "identity.json"), identity);
if (
  identity.sourceSha !== EXPECTED_SOURCE ||
  !identity.sourceCleanBefore ||
  process.platform !== "win32" ||
  process.arch !== "arm64" ||
  identity.nodePeMachine !== "0xaa64" ||
  process.env.RUNNER_ARCH !== "ARM64"
) {
  throw new Error("exact source/native ARM64 identity mismatch");
}

const systemRoot = process.env.SystemRoot;
const powershell = path.join(
  systemRoot,
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);
const hostStart = Date.now();
const host = spawnSync(
  powershell,
  [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "$o=Get-CimInstance Win32_OperatingSystem; $p=Get-CimInstance Win32_Processor; @{OSArchitecture=$o.OSArchitecture;Version=$o.Version;ProcessorArchitecture=$p.Architecture;PowerShellVersion=$PSVersionTable.PSVersion.ToString();ProcessArchitecture=$env:PROCESSOR_ARCHITECTURE}|ConvertTo-Json -Compress",
  ],
  { encoding: "utf8", timeout: 30_000, windowsHide: true },
);
writeJson(path.join(output, "host.json"), {
  elapsedMs: Date.now() - hostStart,
  status: host.status,
  signal: host.signal,
  errorCode: host.error?.code ?? null,
  stdout: host.stdout,
  stderr: host.stderr,
  powershellPeMachine: peMachine(powershell),
  cmdPeMachine: peMachine(path.join(systemRoot, "System32", "cmd.exe")),
});

const names = [
  "transfers the real lock only after a sidecar readiness handshake",
  "commits the canonical binary and alias with lineage/result persistence",
  "rolls the canonical binary and alias back after verification fails",
  "restores prior backup and lineage generations after verification fails",
  "commits an independent rescue without consuming its canonical backup",
];
const args = [
  path.join(source, "node_modules/vitest/vitest.mjs"),
  "run",
  "packages/cli/__tests__/unit/packer-pack-update-applier.test.js",
  "--maxWorkers=1",
  "--testNamePattern",
  names.join("|"),
  "--reporter=verbose",
  "--reporter=json",
  `--outputFile.json=${path.join(output, "vitest.json")}`,
];
const testStart = Date.now();
const stdout = fs.createWriteStream(path.join(output, "vitest.stdout.log"));
const stderr = fs.createWriteStream(path.join(output, "vitest.stderr.log"));
const child = spawn(process.execPath, args, {
  cwd: source,
  env: {
    ...process.env,
    CC_UPDATER_DIAGNOSTIC_OUTPUT: output,
    NODE_OPTIONS: `--import=${pathToFileURL(path.join(directory, "preload.mjs")).href}`,
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
child.stdout.on("data", (bytes) => {
  stdout.write(bytes);
  process.stdout.write(bytes);
});
child.stderr.on("data", (bytes) => {
  stderr.write(bytes);
  process.stderr.write(bytes);
});
const testResult = await new Promise((resolve) => {
  child.once("error", (error) =>
    resolve({ errorCode: error.code, status: null, signal: null }),
  );
  child.once("close", (status, signal) => resolve({ status, signal }));
});
stdout.end();
stderr.end();
writeJson(path.join(output, "test-result.json"), {
  ...testResult,
  elapsedMs: Date.now() - testStart,
  originalTestNames: names,
  releaseEligible: false,
});
// This is observation after test completion, not an extension of any test deadline.
const observationDeadline = Date.now() + 185_000;
while (Date.now() < observationDeadline) {
  const configs = fs
    .readdirSync(output)
    .filter((name) => name.endsWith(".config.json"));
  if (
    configs.every((name) =>
      fs.existsSync(
        path.join(output, name.replace(".config.json", ".observer-done")),
      ),
    )
  )
    break;
  await delay(500);
}
writeJson(path.join(output, "completion.json"), {
  sourceSha: git("rev-parse", "HEAD"),
  sourceCleanAfter: git("status", "--porcelain", "--untracked-files=no") === "",
  sourceHashesAfter: fileHashes(),
  observers: fs
    .readdirSync(output)
    .filter((name) => name.endsWith(".observer-done")),
  releaseEligible: false,
});
process.exitCode = testResult.status === 0 ? 0 : 1;
