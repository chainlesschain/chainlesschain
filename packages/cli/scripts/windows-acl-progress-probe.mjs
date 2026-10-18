#!/usr/bin/env node
// Zero-provider Windows diagnostic. Each ACL process retains its 60s budget.
// Run on windows-latest: node packages/cli/scripts/windows-acl-progress-probe.mjs
//   --output <artifact.json> [--root-parent <temporary directory>]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import storage from "../../session-core/lib/private-storage.js";

if (process.platform !== "win32") throw new Error("Windows host required");
const args = process.argv.slice(2);
if (args[0] === "--child") {
  const profile = process.env.CHAINLESSCHAIN_HOME;
  const anchor = path.join(
    process.env.LOCALAPPDATA,
    "ChainlessChain",
    "SecurityAnchors",
  );
  const file = path.join(process.env.TEMP, "acl-file-fixture.txt");
  fs.writeFileSync(file, "owner-only ACL probe\n", { flag: "wx" });
  const report = {
    schema: 1,
    diagnosticOnly: true,
    releaseGate: false,
    modelCalls: 0,
    sourceCommit: process.env.CC_ACL_DIAGNOSTIC_SOURCE_SHA || null,
    sourceSha256: createHash("sha256")
      .update(
        fs.readFileSync(
          new URL("../../session-core/lib/private-storage.js", import.meta.url),
        ),
      )
      .digest("hex"),
    startedAt: new Date().toISOString(),
    platform: process.platform,
    windowsBuild: os.release(),
    node: process.version,
    timeoutMs: 60000,
    probes: [],
  };
  let calls = [];
  const deps = {
    fs,
    platform: () => process.platform,
    spawnSync(exe, commandArgs, options) {
      const start = performance.now();
      const result = spawnSync(exe, commandArgs, options);
      const stages = [
        ...String(result.stderr || "")
          .slice(0, 8192)
          .matchAll(
            /^CC_WINDOWS_ACL_ELAPSED_MS=(initialize|traversal|lookup|repair-lock|repair-inspect|repair-write|repair-wait|repair-traversal|repair-read|repair-owner|repair-protect|repair-rules|repair-persist|repair-unlock|verify|verify-read|verify-rules|serialize|output-complete):(0|[1-9][0-9]{0,5})\r?$/gm,
          ),
      ]
        .map((m) => ({ stage: m[1], elapsedMs: Number(m[2]) }))
        .filter((m) => m.elapsedMs <= 300000);
      calls.push({
        elapsedMs: Math.round(performance.now() - start),
        timeoutMs: options.timeout,
        cwdIsProfile: options.cwd === profile,
        status: result.status,
        signal: result.signal,
        errorCode: ["ETIMEDOUT", "EACCES", "EPERM", "ENOENT"].includes(
          result.error?.code,
        )
          ? result.error.code
          : result.error
            ? "UNKNOWN"
            : null,
        stages,
      });
      return result;
    },
  };
  for (const [name, target] of [
    ["cold-profile", profile],
    ["security-anchor", anchor],
    ["repeat-batch", profile],
  ]) {
    calls = [];
    const start = performance.now();
    let passed = false;
    let directoryWitnessesUnchanged = null;
    let fileContentUnchanged = null;
    try {
      if (name === "repeat-batch") {
        const witness = (target) => {
          const entry = fs.statSync(target, { bigint: true });
          return `${entry.dev}:${entry.ino}:${entry.ctimeNs}`;
        };
        const before = [profile, anchor].map(witness);
        const results = storage.repairPrivatePaths([profile, anchor, file], {
          deps,
        });
        directoryWitnessesUnchanged = [profile, anchor].every(
          (target, index) => witness(target) === before[index],
        );
        fileContentUnchanged =
          fs.readFileSync(file, "utf8") === "owner-only ACL probe\n";
        passed =
          results.length === 3 &&
          results.every((result) => result.ok) &&
          directoryWitnessesUnchanged &&
          fileContentUnchanged;
      } else {
        storage.ensurePrivateDirectory(target, {
          applyWindowsAcl: true,
          failIfUnavailable: true,
          deps,
        });
        passed = true;
      }
    } catch {
      // Keep all raw errors, paths and identity data out of the evidence.
    }
    report.probes.push({
      name,
      elapsedMs: Math.round(performance.now() - start),
      passed,
      directoryWitnessesUnchanged,
      fileContentUnchanged,
      calls,
    });
    if (!passed) break;
  }
  report.finishedAt = new Date().toISOString();
  process.stdout.write(JSON.stringify(report));
  process.exitCode = report.probes.every((p) => p.passed) ? 0 : 1;
} else {
  const value = (flag) => {
    const index = args.indexOf(flag);
    return index < 0 ? null : args[index + 1];
  };
  const output = value("--output");
  if (!output) throw new Error("--output is required");
  const root = fs.mkdtempSync(
    path.join(
      path.resolve(value("--root-parent") || os.tmpdir()),
      "cc-acl-progress-",
    ),
  );
  const home = path.join(root, "home"),
    profile = path.join(home, ".chainlesschain");
  const env = {
    PATH: process.env.PATH || "",
    HOME: home,
    USERPROFILE: home,
    CHAINLESSCHAIN_HOME: profile,
    APPDATA: path.join(root, "appdata"),
    LOCALAPPDATA: path.join(root, "localappdata"),
    TEMP: root,
    TMP: root,
    TMPDIR: root,
    CI: "true",
    NO_COLOR: "1",
    LANG: "C.UTF-8",
    CC_FORMAL_QUALITY_EVAL_HERMETIC: "1",
    CC_FORMAL_QUALITY_EVAL_ISOLATION_ROOT: root,
    CC_SECURE_FS_WINDOWS_ACL_TIMEOUT_MS: "60000",
    PSModuleAnalysisCachePath: path.join(
      root,
      "powershell-cache",
      "ModuleAnalysisCache",
    ),
  };
  for (const key of ["SystemRoot", "ComSpec"])
    if (process.env[key]) env[key] = process.env[key];
  if (/^[a-f0-9]{40}$/u.test(process.env.CC_ACL_DIAGNOSTIC_SOURCE_SHA || ""))
    env.CC_ACL_DIAGNOSTIC_SOURCE_SHA = process.env.CC_ACL_DIAGNOSTIC_SOURCE_SHA;
  for (const directory of [
    profile,
    env.APPDATA,
    env.LOCALAPPDATA,
    path.join(home, "AppData", "Local"),
    path.join(home, "AppData", "Roaming"),
    path.dirname(env.PSModuleAnalysisCachePath),
  ])
    fs.mkdirSync(directory, { recursive: true });
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(import.meta.url), "--child"],
    {
      env,
      cwd: profile,
      windowsHide: true,
      encoding: "utf8",
      timeout: 195000,
      maxBuffer: 128 * 1024,
    },
  );
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    report = {
      schema: 1,
      diagnosticFailure: "probe-output-unavailable",
      status: result.status,
    };
  }
  fs.writeFileSync(
    path.resolve(output),
    `${JSON.stringify(report, null, 2)}\n`,
    { flag: "wx" },
  );
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exitCode = result.error || result.status !== 0 ? 1 : 0;
  // Preserve the private temporary profile for inspection; never recurse into
  // user state or remove directories as part of a diagnostic.
}
