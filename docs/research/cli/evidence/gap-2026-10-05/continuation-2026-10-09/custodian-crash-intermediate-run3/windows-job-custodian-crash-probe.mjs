#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  SOURCE_NAMES,
  REPORT_SCHEMA,
  describeBytes,
  inspectCustodianCrash,
  inspectCustodianCrashArtifact,
} from "./lib/windows-job-custodian-crash-evidence.mjs";

export function runCustodianCrashProbe(output, { compileOnly = false } = {}) {
  if (process.platform !== "win32" || process.arch !== "x64")
    throw new Error("Windows x64 is required");
  if (!path.isAbsolute(output))
    throw new Error("Use a new absolute evidence directory");
  fs.mkdirSync(output); // Keep every attempt, including compile/parser failures.
  const report = {
    schema: REPORT_SCHEMA,
    status: "NOT_ADMITTED",
    trusted: false,
    scope: "three-fixed-controlled-root-processes",
    output,
    startedAt: new Date().toISOString(),
    preparedOnly: compileOnly,
    host: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      release: os.release(),
    },
    positiveNonce: randomUUID(),
    controlNonce: randomUUID(),
    sources: [],
    evidence: [],
  };
  const captured = [];
  const save = (name, bytes) => {
    fs.writeFileSync(path.join(output, name), bytes, { flag: "wx" });
    captured.push(name);
  };
  const json = (value) => JSON.stringify(value, null, 2) + "\n";
  const execute = (name, command, args, timeout) => {
    const start = new Date().toISOString(),
      clock = performance.now();
    const result = spawnSync(command, args, {
      windowsHide: true,
      timeout,
      maxBuffer: 1024 * 1024,
    });
    save(
      `${name}.stdout.${name === "build" ? "txt" : "json"}`,
      result.stdout || Buffer.alloc(0),
    );
    save(`${name}.stderr.txt`, result.stderr || Buffer.alloc(0));
    save(
      `${name}.json`,
      json({
        command,
        args,
        pid: result.pid,
        startedAt: start,
        elapsedMs: performance.now() - clock,
        status: result.status,
        signal: result.signal,
        error: result.error?.message || null,
      }),
    );
    return result;
  };
  try {
    const originals = [
      new URL(
        "./diagnostics/windows-job-custodian-crash-probe.cs",
        import.meta.url,
      ),
      import.meta.url,
      new URL(
        "./lib/windows-job-custodian-crash-evidence.mjs",
        import.meta.url,
      ),
      new URL(
        "../test-node/windows-job-custodian-crash-evidence.node-test.mjs",
        import.meta.url,
      ),
    ].map((url) => fileURLToPath(url));
    for (const [index, original] of originals.entries()) {
      const entry = {
        name: SOURCE_NAMES[index],
        original,
        before: describeBytes(original),
      };
      report.sources.push(entry);
      fs.copyFileSync(
        original,
        path.join(output, entry.name),
        fs.constants.COPYFILE_EXCL,
      );
      if (
        JSON.stringify(describeBytes(original)) !==
          JSON.stringify(entry.before) ||
        JSON.stringify(describeBytes(path.join(output, entry.name))) !==
          JSON.stringify(entry.before)
      )
        throw new Error("Source changed during capture");
    }
    const compiler = path.join(
      process.env.SystemRoot || "C:\\Windows",
      "Microsoft.NET",
      "Framework64",
      "v4.0.30319",
      "csc.exe",
    );
    const executable = path.join(
      output,
      "windows-job-custodian-crash-probe.exe",
    );
    report.compiler = {
      path: compiler,
      before: describeBytes(compiler),
      hermetic: false,
    };
    report.runtime = {
      path: process.execPath,
      before: describeBytes(process.execPath),
    };
    const build = execute(
      "build",
      compiler,
      [
        "/nologo",
        "/optimize+",
        "/target:exe",
        "/platform:x64",
        "/reference:System.Web.Extensions.dll",
        `/out:${executable}`,
        path.join(output, SOURCE_NAMES[0]),
      ],
      30000,
    );
    if (build.status !== 0 || build.error || build.signal)
      throw new Error("Native build failed; raw build evidence retained");
    report.executable = { path: executable, before: describeBytes(executable) };
    if (!compileOnly) {
      const positive = execute(
        "positive",
        executable,
        ["kill-on-close", report.positiveNonce],
        60000,
      );
      const positiveValue = JSON.parse(positive.stdout);
      const positiveCheck = inspectCustodianCrash(
        positiveValue,
        "kill-on-close",
        report.positiveNonce,
      );
      if (
        positive.status !== 0 ||
        positive.signal ||
        positive.error ||
        positive.stderr?.length ||
        !positiveCheck.diagnosticCompleted
      )
        throw new Error(
          `Positive probe failed; no further native tree launched: ${JSON.stringify(positiveCheck.errors)}`,
        );
      // A real missing-policy control. Its explicit fallback must never count as
      // automatic close-policy success. Require its own known live barrier.
      const control = execute(
        "control",
        executable,
        ["no-kill-control", report.controlNonce],
        60000,
      );
      const controlValue = JSON.parse(control.stdout);
      const controlCheck = inspectCustodianCrash(
        controlValue,
        "no-kill-control",
        report.controlNonce,
      );
      if (
        control.status !== 2 ||
        control.signal ||
        control.error ||
        control.stderr?.length ||
        !controlCheck.expectedControlRejected
      )
        throw new Error(
          `No-kill control incomplete: ${JSON.stringify(controlCheck.errors)}`,
        );
    }
  } catch (error) {
    report.failure = error.stack || String(error);
  } finally {
    for (const source of report.sources) {
      try {
        source.after = describeBytes(source.original);
      } catch (error) {
        source.recheckError = error.message;
      }
    }
    for (const key of ["compiler", "runtime", "executable"]) {
      if (report[key]) {
        try {
          report[key].after = describeBytes(report[key].path);
        } catch (error) {
          report[key].recheckError = error.message;
        }
      }
    }
    report.evidence = captured.map((name) => {
      try {
        return { name, ...describeBytes(path.join(output, name)) };
      } catch (error) {
        return { name, recheckError: error.message };
      }
    });
    report.finishedAt = new Date().toISOString();
    report.validation = inspectCustodianCrashArtifact(report, output);
    report.diagnosticCompleted = report.validation.diagnosticCompleted;
    save("report.json", json(report));
  }
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
        "compile-only": { type: "boolean" },
      },
    });
    if (
      !values.output ||
      (!values["confirm-native"] && !values["compile-only"])
    )
      throw new Error(
        "Use --output NEW_ABSOLUTE_DIRECTORY with --compile-only or --confirm-native",
      );
    const report = runCustodianCrashProbe(values.output, {
      compileOnly: values["compile-only"] === true,
    });
    console.log(
      JSON.stringify(
        {
          output: values.output,
          diagnosticCompleted: report.diagnosticCompleted,
          preparedOnly: report.preparedOnly,
          failure: report.failure,
          errors: report.validation.errors,
        },
        null,
        2,
      ),
    );
    process.exitCode =
      report.diagnosticCompleted ||
      (report.preparedOnly && !report.failure && report.executable)
        ? 0
        : 2;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
