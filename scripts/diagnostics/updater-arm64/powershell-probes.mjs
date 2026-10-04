import { spawnSync } from "node:child_process";
import path from "node:path";
import { writeJson } from "./shared.mjs";

export function runPowerShellProbes(output) {
  const powershell = path.join(
    process.env.SystemRoot,
    "System32/WindowsPowerShell/v1.0/powershell.exe",
  );
  const withoutMsystem = { ...process.env };
  delete withoutMsystem.MSYSTEM;
  const systemModules = path.join(
    process.env.SystemRoot,
    "System32/WindowsPowerShell/v1.0/Modules",
  );
  const probes = [
    ["empty-inherited", "exit 0", process.env],
    [
      "json-inherited",
      "'{}' | ConvertFrom-Json | ConvertTo-Json -Compress",
      process.env,
    ],
    ["empty-without-msystem", "exit 0", withoutMsystem],
    [
      "empty-system-module-path",
      "exit 0",
      { ...process.env, PSModulePath: systemModules },
    ],
    [
      "json-system-module-path",
      "'{}' | ConvertFrom-Json | ConvertTo-Json -Compress",
      { ...process.env, PSModulePath: systemModules },
    ],
  ];
  const results = [];
  for (const [name, command, env] of probes) {
    const start = Date.now();
    const child = spawnSync(
      powershell,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
      {
        env,
        timeout: 30000,
        encoding: "utf8",
        windowsHide: true,
      },
    );
    results.push({
      name,
      elapsedMs: Date.now() - start,
      status: child.status,
      signal: child.signal,
      errorCode: child.error?.code ?? null,
    });
    writeJson(path.join(output, "powershell-probes.json"), {
      boundary:
        "After original test verdicts; probe-only environment variants never affect the tests or production calls",
      msystem: process.env.MSYSTEM ?? null,
      modulePath: process.env.PSModulePath ?? null,
      results,
    });
  }
}
