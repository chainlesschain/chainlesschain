#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  inspectJobRecovery,
  inspectUnassignedCleanup,
} from "./lib/windows-job-recovery-evidence.mjs";

const source = fileURLToPath(
  new URL("./diagnostics/windows-job-recovery-probe.cs", import.meta.url),
);
const digest = (file) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");

export function runJobRecoveryProbe(output) {
  const startedAt = new Date().toISOString();
  if (process.platform !== "win32")
    throw new Error("This native diagnostic requires Windows");
  if (!path.isAbsolute(output))
    throw new Error("A new absolute evidence directory is required");
  fs.mkdirSync(output); // Never overwrite an earlier diagnostic, including failure.
  const executionId = randomUUID();
  const capturedSource = path.join(output, "windows-job-recovery-probe.cs");
  const sourcePaths = [
    source,
    fileURLToPath(import.meta.url),
    fileURLToPath(
      new URL("./lib/windows-job-recovery-evidence.mjs", import.meta.url),
    ),
    fileURLToPath(
      new URL(
        "../test-node/windows-job-recovery-evidence.node-test.mjs",
        import.meta.url,
      ),
    ),
  ];
  const sources = sourcePaths.map((original) => {
    const sha256 = digest(original);
    const snapshot = path.join(output, path.basename(original));
    fs.copyFileSync(original, snapshot, fs.constants.COPYFILE_EXCL);
    if (digest(snapshot) !== sha256 || digest(original) !== sha256)
      throw new Error("Source changed while capturing");
    return { original, snapshot, sha256, bytes: fs.statSync(snapshot).size };
  });
  const executable = path.join(output, "windows-job-recovery-probe.exe");
  const compiler = path.join(
    process.env.SystemRoot || "C:\\Windows",
    "Microsoft.NET",
    "Framework64",
    "v4.0.30319",
    "csc.exe",
  );
  const compilerSha256 = digest(compiler);
  const build = spawnSync(
    compiler,
    [
      "/nologo",
      "/optimize+",
      "/target:exe",
      "/reference:System.Web.Extensions.dll",
      `/out:${executable}`,
      capturedSource,
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    },
  );
  fs.writeFileSync(
    path.join(output, "build.json"),
    JSON.stringify(
      {
        status: build.status,
        signal: build.signal,
        error: build.error?.message,
        stdout: build.stdout,
        stderr: build.stderr,
      },
      null,
      2,
    ),
  );
  if (build.status !== 0 || build.error)
    throw new Error("Native diagnostic build failed; build evidence retained");
  const sourceSha256 = digest(capturedSource),
    executableSha256 = digest(executable);
  const native = spawnSync(executable, ["probe", executionId], {
    windowsHide: true,
    timeout: 60000,
    maxBuffer: 1024 * 1024,
  });
  fs.writeFileSync(
    path.join(output, "native.stdout.json"),
    native.stdout || "",
  );
  fs.writeFileSync(path.join(output, "native.stderr.txt"), native.stderr || "");
  let value;
  try {
    value = JSON.parse(native.stdout);
  } catch {
    value = null;
  }
  const validation = inspectJobRecovery(value, executionId);
  if (native.status !== 0 || native.error || native.signal) {
    validation.errors.push(
      `native process did not complete: ${native.error?.message || native.signal || native.status}`,
    );
    validation.diagnosticCompleted = false;
  }
  if (native.stderr?.length) {
    validation.errors.push("native stderr is nonempty");
    validation.diagnosticCompleted = false;
  }
  // Independently exercise the suspended process that never entered a Job.
  // Its expected failure may confirm cleanup, never the successful experiment.
  const unassignedId = randomUUID();
  const unassignedAttempted = validation.diagnosticCompleted;
  const unassigned = unassignedAttempted
    ? spawnSync(executable, ["probe-unassigned", unassignedId], {
        windowsHide: true,
        timeout: 20000,
        maxBuffer: 1024 * 1024,
      })
    : { status: null }; // Never launch another tree after unconfirmed cleanup.
  fs.writeFileSync(
    path.join(output, "unassigned.stdout.json"),
    unassigned.stdout || "",
  );
  fs.writeFileSync(
    path.join(output, "unassigned.stderr.txt"),
    unassigned.stderr || "",
  );
  let unassignedValue;
  try {
    unassignedValue = JSON.parse(unassigned.stdout);
  } catch {
    unassignedValue = null;
  }
  const unassignedCleanupConfirmed =
    unassigned.status === 2 &&
    !unassigned.error &&
    !unassigned.signal &&
    !unassigned.stderr?.length &&
    inspectUnassignedCleanup(unassignedValue, unassignedId);
  if (!unassignedCleanupConfirmed) {
    validation.errors.push(
      "unassigned original HANDLE cleanup negative incomplete",
    );
    validation.diagnosticCompleted = false;
  }
  if (
    sources.some(
      ({ original, snapshot, sha256 }) =>
        digest(original) !== sha256 || digest(snapshot) !== sha256,
    ) ||
    digest(executable) !== executableSha256 ||
    digest(compiler) !== compilerSha256
  ) {
    validation.errors.push(
      "original/captured source, compiler or executable changed during experiment",
    );
    validation.diagnosticCompleted = false;
  }
  const report = {
    schema: "chainlesschain.windows-job-recovery-diagnostic/v1",
    executionId,
    sourceSha256,
    executableSha256,
    startedAt,
    finishedAt: new Date().toISOString(),
    sources,
    compiler: { path: compiler, sha256: compilerSha256, hermetic: false },
    evidence: [
      "native.stdout.json",
      "native.stderr.txt",
      "unassigned.stdout.json",
      "unassigned.stderr.txt",
      "build.json",
    ].map((name) => ({
      name,
      sha256: digest(path.join(output, name)),
      bytes: fs.statSync(path.join(output, name)).size,
    })),
    unassigned: {
      attempted: unassignedAttempted,
      executionId: unassignedId,
      nativeExit: unassigned.status,
      cleanupConfirmed: unassignedCleanupConfirmed,
    },
    host: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      release: os.release(),
    },
    nativeExit: native.status,
    ...validation,
  };
  fs.writeFileSync(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
    { flag: "wx" },
  );
  return report;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { values } = parseArgs({
      options: {
        output: { type: "string" },
        "confirm-native": { type: "boolean" },
      },
    });
    if (!values["confirm-native"] || !values.output)
      throw new Error("Use --confirm-native --output NEW_ABSOLUTE_DIRECTORY");
    const report = runJobRecoveryProbe(values.output);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.diagnosticCompleted ? 0 : 2;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
