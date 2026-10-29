import fs from "node:fs";
import { spawnSync } from "node:child_process";
const root = ".work/structured-memory-20261029";
const calls = [
  ["release130-attempt2-terminal-run", "repos/chainlesschain/chainlesschain/actions/runs/40784878922"],
  ["release130-attempt2-terminal-jobs", "repos/chainlesschain/chainlesschain/actions/runs/40784878922/attempts/2/jobs?per_page=100"],
];
const receipts = [];
for (const [label, endpoint] of calls) {
  const run = spawnSync("gh", ["api", endpoint], { encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  fs.writeFileSync(`${root}/${label}.json`, run.stdout || "");
  fs.writeFileSync(`${root}/${label}-stderr.log`, run.stderr || "");
  receipts.push({ label, endpoint, observedAt: new Date().toISOString(), exitCode: run.status, signal: run.signal });
  if (run.status !== 0) { console.log(JSON.stringify({ label, error: run.stderr })); continue; }
  const value = JSON.parse(run.stdout);
  console.log(JSON.stringify(value.jobs ? { label, total: value.jobs.length, failed: value.jobs.filter(job => job.conclusion === "failure").map(({ id, name, steps }) => ({ id, name, failedSteps: steps.filter(step => step.conclusion === "failure").map(({ name }) => name) })), pending: value.jobs.filter(job => job.status !== "completed").map(({ id, name, status }) => ({ id, name, status })) } : { label, id: value.id, sha: value.head_sha, status: value.status, conclusion: value.conclusion, attempt: value.run_attempt }));
}
fs.writeFileSync(`${root}/release130-attempt2-read-receipts.json`, JSON.stringify(receipts, null, 2) + "\n");
process.exitCode = receipts.every(run => run.exitCode === 0) ? 0 : 1;
