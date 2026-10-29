import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const startedAt = new Date().toISOString();
const run = spawnSync(process.execPath, [fileURLToPath(new URL("./vitest.mjs", import.meta.resolve("vitest/package.json"))), "run", "__tests__/integration/memory-query-bundle-legacy.test.js"], {
  cwd: "packages/cli", encoding: "utf8", windowsHide: true, timeout: 120000,
});
fs.writeFileSync(".work/memory-query-bundle/legacy-unit.log", (run.stdout || "") + (run.stderr || ""));
fs.writeFileSync(".work/memory-query-bundle/legacy-unit-process.json", JSON.stringify({
  startedAt, endedAt: new Date().toISOString(), exitCode: run.status, signal: run.signal, error: run.error?.message || null,
}, null, 2));
process.stdout.write((run.stdout || "") + (run.stderr || ""));
process.exitCode = run.status ?? 1;
