import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../..");
const testName = "detects a damaged unselected frame despite a warm decoded cache";
const runs = [];
for (const mutated of [false, true]) {
  const label = mutated ? "negative-control" : "negative-control-baseline";
  const report = path.join(directory, `${label}.json`);
  const args = [path.join(root, "node_modules/vitest/vitest.mjs"), "run", "__tests__/integration/memory-query-bundle-port.test.js", "-t", testName, "--reporter=json", `--outputFile=${report}`];
  if (mutated) args.push("--config", path.join(directory, "negative-control.config.mjs"));
  const run = spawnSync(process.execPath, args, { cwd: path.join(root, "packages/cli"), encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  fs.writeFileSync(path.join(directory, `${label}.log`), (run.stdout || "") + "\n--- stderr ---\n" + (run.stderr || ""));
  const result = JSON.parse(fs.readFileSync(report, "utf8"));
  const cases = result.testResults.flatMap((suite) => suite.assertionResults).filter((test) => test.fullName.includes(testName));
  const receipt = { args, exitCode: run.status, signal: run.signal, error: run.error?.message || null, observedAt: new Date().toISOString(), cases };
  fs.writeFileSync(path.join(directory, `${label}-process.json`), JSON.stringify(receipt, null, 2) + "\n");
  runs.push({ mutated, exitCode: run.status, cases: cases.map(({ status, fullName, failureMessages }) => ({ status, fullName, failureMessages })) });
}
const [baseline, mutant] = runs;
const killed = baseline.exitCode === 0 && baseline.cases.length === 1 && baseline.cases[0].status === "passed" && mutant.exitCode === 1 && mutant.cases.length === 1 && mutant.cases[0].status === "failed" && mutant.cases[0].failureMessages.some((message) => message.includes("_readQueryIndexBytes"));
const summary = { killed, runs };
fs.writeFileSync(path.join(directory, "negative-control-summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary));
process.exitCode = killed ? 0 : 1;
