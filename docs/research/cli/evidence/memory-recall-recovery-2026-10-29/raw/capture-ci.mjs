import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
const directory = ".work/structured-memory-20261029/memory-ci673";
fs.mkdirSync(directory, { recursive: true });
const queries = [
  ["windows-failed", ["run", "view", "40806303385", "--repo", "chainlesschain/chainlesschain", "--job", "123225957124", "--log-failed"]],
  ["run", ["run", "view", "40806303385", "--repo", "chainlesschain/chainlesschain", "--json", "status,conclusion,headSha,jobs"]],
  ["artifacts", ["api", "repos/chainlesschain/chainlesschain/actions/runs/40806303385/artifacts"]],
];
const receipts = [];
for (const [label, args] of queries) {
  const run = spawnSync("gh", args, { encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  const output = label === "windows-failed" ? label + ".log" : label + ".json";
  fs.writeFileSync(path.join(directory, output), run.stdout || "");
  fs.writeFileSync(path.join(directory, label + "-stderr.log"), run.stderr || "");
  receipts.push({ label, args, exitCode: run.status, signal: run.signal, error: run.error?.message || null, observedAt: new Date().toISOString(), output, sha256: createHash("sha256").update(run.stdout || "").digest("hex") });
}
fs.writeFileSync(path.join(directory, "receipts.json"), JSON.stringify(receipts, null, 2) + "\n");
console.log(JSON.stringify(receipts.map(({ label, exitCode, output }) => ({ label, exitCode, output }))));
process.exitCode = receipts.every(item => item.exitCode === 0) ? 0 : 1;
