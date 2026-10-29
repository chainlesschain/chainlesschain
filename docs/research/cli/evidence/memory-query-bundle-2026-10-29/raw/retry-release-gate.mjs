import fs from "node:fs";
import { spawnSync } from "node:child_process";
const target = "e7a6f2585d62949794596767869423b0eb670104";
const prefix = ".work/memory-query-bundle/";
const endpoint = "repos/chainlesschain/chainlesschain/actions/runs/40784878922";
function gh(args) {
  return spawnSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, windowsHide: true });
}
const readback = gh(["api", endpoint]);
fs.writeFileSync(prefix + "release130-ci-before-retry.json", readback.stdout || "", { flag: "wx" });
if (readback.status !== 0) throw new Error("Cannot read gate before retry: " + readback.stderr);
const run = JSON.parse(readback.stdout);
if (run.head_sha !== target || run.status !== "completed" || run.conclusion !== "failure" || run.run_attempt !== 1) throw new Error("Retry preconditions failed; no mutation sent");
const receiptPath = prefix + "release130-ci-retry-receipt.json";
const receipt = { target, runId: run.id, priorAttempt: run.run_attempt, startedAt: new Date().toISOString(), scope: "Same-source failed-job retry after original full matrix terminated; retain original lease-observation failure and all successes", state: "request-started" };
fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
const args = ["run", "rerun", String(run.id), "--repo", "chainlesschain/chainlesschain", "--failed"];
const retry = gh(args);
Object.assign(receipt, { args, endedAt: new Date().toISOString(), exitCode: retry.status, signal: retry.signal, stdout: retry.stdout, stderr: retry.stderr, state: retry.status === 0 ? "request-acknowledged" : "request-result-unresolved-do-not-replay" });
fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify(receipt));
process.exitCode = retry.status ?? 1;
