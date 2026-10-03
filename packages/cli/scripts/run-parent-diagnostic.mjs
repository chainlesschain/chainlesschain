import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const expectedSource = "1fe7a46c0f97b93fb5110ea3427cc8551d0dab37";
const root = process.cwd();
const output = path.resolve(root, ".work/worker-parent-diagnostic");
fs.mkdirSync(output, { recursive: true });
const driver = path.dirname(fileURLToPath(import.meta.url));
const probe = path.join(driver, "vitest-parent-diagnostic.cjs");
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const identity = () => ({
  sha: git("rev-parse", "HEAD"),
  trackedDiff: git("status", "--porcelain", "--untracked-files=no"),
});
const before = identity();
if (before.sha !== expectedSource || before.trackedDiff)
  throw new Error(`Source identity mismatch: ${JSON.stringify(before)}`);
if (
  process.version !== "v22.22.2" ||
  process.platform !== "win32" ||
  process.arch !== "x64"
)
  throw new Error(
    "Diagnostic requires original Node 22.22.2 Windows x64 runtime",
  );
const args = [
  "scripts/run-vitest-with-worker-retry.mjs",
  "--",
  "run",
  "--shard=14/16",
  "--reporter=default",
  "--reporter=junit",
  "--outputFile.junit=test-results/unit-14.xml",
  "--silent=passed-only",
  "--maxWorkers=1",
  "--no-file-parallelism",
  "__tests__/unit/",
];
const metadata = {
  releaseEligible: false,
  purpose: "parent-only observation of exact full Windows unit shard 14/16",
  before,
  args,
  cwd: path.join(root, "packages/cli"),
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  probeSha256: createHash("sha256")
    .update(fs.readFileSync(probe))
    .digest("hex"),
  started: new Date().toISOString(),
  driverSha: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: driver,
    encoding: "utf8",
  }).trim(),
  priorNodeOptions: process.env.NODE_OPTIONS || "",
};
fs.writeFileSync(
  path.join(output, "invocation.json"),
  JSON.stringify(metadata, null, 2),
);
const log = fs.createWriteStream(path.join(output, "test-output.log"));
const child = spawn(process.execPath, args, {
  cwd: metadata.cwd,
  windowsHide: true,
  env: {
    ...process.env,
    NODE_OPTIONS:
      `${process.env.NODE_OPTIONS || ""} --require="${probe}"`.trim(),
    CC_PARENT_DIAGNOSTIC_DIR: path.join(output, "parents"),
  },
  stdio: ["inherit", "pipe", "pipe"],
});
child.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  log.write(chunk);
});
child.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
  log.write(chunk);
});
let launchError;
child.on("error", (error) => {
  launchError = { message: error.message, code: error.code };
});
child.on("close", (code, signal) => {
  log.end();
  const after = identity();
  const receipt = {
    ...metadata,
    ended: new Date().toISOString(),
    wrapperPid: child.pid,
    code,
    signal,
    launchError,
    after,
    sourceUnchanged: JSON.stringify(before) === JSON.stringify(after),
  };
  fs.writeFileSync(
    path.join(output, "result.json"),
    JSON.stringify(receipt, null, 2),
  );
  const junit = path.join(root, "packages/cli/test-results/unit-14.xml");
  if (fs.existsSync(junit))
    fs.copyFileSync(junit, path.join(output, "unit-14.xml"));
  fs.copyFileSync(
    path.join(driver, "worker-parent-expected-files.json"),
    path.join(output, "expected-files.json"),
  );
  // Preserve nonzero teardown exits; deliberately no JSON reporter.
  process.exitCode = !receipt.sourceUnchanged
    ? 1
    : Number.isInteger(code)
      ? code
      : 1;
});
