#!/usr/bin/env node
// Zero-provider Windows diagnostic. Each ACL process retains its 60s budget.
// Run on windows-latest: node packages/cli/scripts/windows-acl-progress-probe.mjs
//   --output <artifact.json> [--root-parent <temporary directory>]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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
  const report = {
    schema: 1,
    startedAt: new Date().toISOString(),
    platform: process.platform,
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
            /^CC_WINDOWS_ACL_ELAPSED_MS=(initialize|traversal|lookup|repair-lock|repair-inspect|repair-write|verify|verify-read|verify-rules|serialize|output-complete):(0|[1-9][0-9]{0,5})\r?$/gm,
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
    try {
      if (name === "repeat-batch") {
        const results = storage.repairPrivatePaths([profile, anchor], { deps });
        passed = results.length === 2 && results.every((result) => result.ok);
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
