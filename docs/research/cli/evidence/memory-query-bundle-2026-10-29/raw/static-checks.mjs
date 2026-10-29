import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const directory = ".work/memory-query-bundle";
const changed = spawnSync("git", ["diff", "--name-only"], { encoding: "utf8" });
const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], { encoding: "utf8" });
if (changed.status !== 0 || untracked.status !== 0) throw new Error("Cannot enumerate task files");
const files = [...new Set((changed.stdout + "\n" + untracked.stdout).trim().split(/\r?\n/))].filter(file => /\.(?:js|mjs|json|md|ya?ml)$/.test(file) && !file.startsWith("docs/research/cli/evidence/"));
const commands = [
  [process.execPath, ["node_modules/prettier/bin/prettier.cjs", "--check", ...files]],
  ["actionlint", [".github/workflows/memory-query-index.yml"]],
  [process.execPath, ["packages/context-memory-kernel/scripts/validate-inventory.mjs"]],
  ["git", ["diff", "--check"]],
];
const receipts = commands.map(([program, args], index) => {
  const run = spawnSync(program, args, { encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  const log = `static-check-${index}.log`;
  fs.writeFileSync(path.join(directory, log), (run.stdout || "") + "\n--- stderr ---\n" + (run.stderr || ""));
  return { program, args, exitCode: run.status, signal: run.signal, error: run.error?.message || null, log };
});
fs.writeFileSync(path.join(directory, "static-checks.json"), JSON.stringify({ observedAt: new Date().toISOString(), receipts }, null, 2) + "\n");
console.log(JSON.stringify(receipts.map(({ program, exitCode, log }) => ({ program, exitCode, log }))));
process.exitCode = receipts.every(run => run.exitCode === 0) ? 0 : 1;
