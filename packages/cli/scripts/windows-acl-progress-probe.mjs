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
import { diagnosticAclCommandArgs } from "./windows-acl-diagnostic-mode.mjs";

if (process.platform !== "win32") throw new Error("Windows host required");
const args = process.argv.slice(2);
if (args[0] === "--child") {
  const modulePathMode = process.env.CC_ACL_MODULE_PATH_MODE;
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
    modulePathMode,
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
  let controlCount = 0;
  const deps = {
    fs,
    platform: () => process.platform,
    spawnSync(exe, commandArgs, options) {
      const command = diagnosticAclCommandArgs(commandArgs, modulePathMode);
      let untrustedModuleControlObserved = null;
      if (process.env.CC_ACL_UNTRUSTED_MODULE_MARKER) {
        const commandIndex = commandArgs.indexOf("-Command") + 1;
        const controlArgs = [...commandArgs];
        const builtinLine =
          "$env:PSModulePath = [System.IO.Path]::Combine($PSHOME, 'Modules')";
        if (controlArgs[commandIndex].split(builtinLine).length !== 2)
          throw new Error("Expected one product module-path initialization");
        controlArgs[commandIndex] = controlArgs[commandIndex].replace(
          builtinLine,
          "",
        );
        const controlMarker = `${process.env.CC_ACL_UNTRUSTED_MODULE_MARKER}.control-${++controlCount}`;
        const control = spawnSync(exe, controlArgs, {
          ...options,
          env: {
            ...(options.env || process.env),
            CC_ACL_UNTRUSTED_MODULE_MARKER: controlMarker,
          },
        });
        untrustedModuleControlObserved =
          !control.error &&
          control.status !== 0 &&
          fs.existsSync(controlMarker);
        if (!untrustedModuleControlObserved)
          throw new Error(
            "Actual helper control did not invoke untrusted JSON cmdlet",
          );
      }
      const start = performance.now();
      const result = spawnSync(exe, command.args, options);
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
        untrustedModuleControlObserved,
        sourceUsesBuiltinModules: command.sourceUsesBuiltinModules,
        effectiveBuiltinModules: command.effectiveBuiltinModules,
        overlayApplied: command.overlayApplied,
        originalScriptSha256: command.originalScriptSha256,
        executedScriptSha256: command.executedScriptSha256,
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
  report.effectiveBuiltinModules = report.probes.every(
    (probe) =>
      probe.calls.length > 0 &&
      probe.calls.every((call) => call.effectiveBuiltinModules),
  );
  report.modulePathOverlayApplied = report.probes.some((probe) =>
    probe.calls.some((call) => call.overlayApplied),
  );
  process.stdout.write(JSON.stringify(report));
  process.exitCode = report.probes.every((p) => p.passed) ? 0 : 1;
} else {
  const value = (flag) => {
    const index = args.indexOf(flag);
    return index < 0 ? null : args[index + 1];
  };
  const output = value("--output");
  if (!output) throw new Error("--output is required");
  const modulePathMode = value("--module-path-mode") || "inherited";
  if (!["inherited", "builtin"].includes(modulePathMode))
    throw new Error("--module-path-mode must be inherited or builtin");
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
    CC_ACL_MODULE_PATH_MODE: modulePathMode,
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
  let untrustedModuleMarker = null;
  if (args.includes("--untrusted-module-fixture")) {
    // The child runs actual single/batch helper controls with only the new
    // module-path assignment removed. This module never changes permissions.
    const moduleRoot = path.join(root, "untrusted-modules");
    const moduleDirectory = path.join(
      moduleRoot,
      "Microsoft.PowerShell.Utility",
    );
    fs.mkdirSync(moduleDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(moduleDirectory, "Microsoft.PowerShell.Utility.psd1"),
      "@{ RootModule = 'Microsoft.PowerShell.Utility.psm1'; ModuleVersion = '1.0.0'; FunctionsToExport = @('ConvertFrom-Json', 'ConvertTo-Json') }\n",
    );
    fs.writeFileSync(
      path.join(moduleDirectory, "Microsoft.PowerShell.Utility.psm1"),
      "function ConvertFrom-Json { [System.IO.File]::WriteAllText($env:CC_ACL_UNTRUSTED_MODULE_MARKER, 'loaded'); throw 'Untrusted ACL module fixture' }; function ConvertTo-Json { [System.IO.File]::WriteAllText($env:CC_ACL_UNTRUSTED_MODULE_MARKER, 'loaded'); throw 'Untrusted ACL module fixture' }; Export-ModuleMember -Function ConvertFrom-Json,ConvertTo-Json\n",
    );
    untrustedModuleMarker = path.join(root, "helper-module-loaded");
    env.PSModulePath = moduleRoot;
    env.CC_ACL_UNTRUSTED_MODULE_MARKER = untrustedModuleMarker;
  }
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
  if (untrustedModuleMarker) {
    report.untrustedModuleControlObserved =
      report.probes?.length === 3 &&
      report.probes.every(
        (probe) =>
          probe.calls.length > 0 &&
          probe.calls.every(
            (call) => call.untrustedModuleControlObserved === true,
          ),
      );
    report.untrustedModuleExcluded = !fs.existsSync(untrustedModuleMarker);
  }
  fs.writeFileSync(
    path.resolve(output),
    `${JSON.stringify(report, null, 2)}\n`,
    { flag: "wx" },
  );
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exitCode =
    result.error ||
    result.status !== 0 ||
    report.untrustedModuleExcluded === false
      ? 1
      : 0;
  // Preserve the private temporary profile for inspection; never recurse into
  // user state or remove directories as part of a diagnostic.
}
