import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";

const runtimeUrl = new URL(
  "../../scripts/verify01-review-runtime.mjs",
  import.meta.url,
).href;

// Exercise the real stage controller with deterministic Docker responses. This
// tests admission ordering, not Docker availability or frozen task execution.
// Platform identity is overridden only inside this disposable child so Windows
// CI can exercise the Linux-only controller without weakening its host gate.
const fixture = `
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runReviewStage } from ${JSON.stringify(runtimeUrl)};
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "verify01-doc-review-"));
const baselinePass = process.argv[1] === "pass";
const baselinePath = "baseline.test.js";
const calls = [];
const fingerprint = "sha256:" + "b".repeat(64);
const result = (status, stdout) => ({status, stdout, stderr:"", signal:null});
Object.defineProperty(process, "platform", {value:"linux"});
if (!process.getuid) process.getuid = () => 1001;
if (!process.getgid) process.getgid = () => 1001;
try {
  fs.writeFileSync(path.join(workspace, baselinePath), "// frozen regression fixture\\n");
  fs.writeFileSync(path.join(workspace, "runbook.md"),
    "Use task-outcome-report.mjs --fingerprint. Missing observations produce " +
    "INSUFFICIENT_EVIDENCE and exit code 2. Unknown cost remains null. " +
    "Never claim PASS. " + "Read the original report output before interpreting evidence. ".repeat(6));
  const execute = (command, args) => {
    if (command !== "docker" || args[0] !== "run") throw new Error("unexpected command");
    if (args.at(-1) === "--version") return result(0, "v22.12.0\\n");
    if (args.includes("/workspace/node_modules/vitest/vitest.mjs")) {
      const mount = args.find(value => value.startsWith("type=bind,source=") && value.includes("target=/review,"));
      const control = mount.slice("type=bind,source=".length, mount.indexOf(",target="));
      const config = fs.readFileSync(path.join(control, "vitest.config.mjs"), "utf8");
      const parsed = JSON.parse(config.slice("export default ".length).trim().replace(/;$/, ""));
      if (JSON.stringify(parsed.test.include) !== JSON.stringify([baselinePath])) throw new Error("wrong baseline selection");
      calls.push("baseline");
      return result(baselinePass ? 0 : 1, JSON.stringify({
        success:baselinePass, numTotalTests:1, numPassedTests:baselinePass ? 1 : 0,
        numFailedTests:baselinePass ? 0 : 1, numPendingTests:0, numTodoTests:0,
        testResults:[{assertionResults:[{status:baselinePass ? "passed" : "failed",
          failureMessages:baselinePass ? [] : ["AssertionError: observed report lost a planned sample"]}]}]
      }));
    }
    if (args.includes("--fingerprint")) {
      calls.push("fingerprint");
      return result(0, fingerprint + "\\n");
    }
    if (args.includes("--plan-digest")) {
      calls.push("empty-report");
      return result(2, JSON.stringify({status:"INSUFFICIENT_EVIDENCE",
        task:{observed:0,missing:36,totalCost:null},firstRun:{missing:9}}));
    }
    throw new Error("unexpected Docker invocation");
  };
  const receipt = runReviewStage(workspace, {
    taskId:"verify-34", doc:true, expectedFiles:["runbook.md"],
    baselineTests:[baselinePath], testSupport:[], frozenPlan:{samples:[]},
    imageId:"sha256:" + "a".repeat(64)
  }, "check", {execute});
  console.log(JSON.stringify({receipt,calls}));
} finally {
  fs.rmSync(workspace, {recursive:true,force:true});
}
`;

describe("document acceptance preserves original regressions", () => {
  it.each([false, true])(
    "requires the original regression after valid document smoke checks (baseline pass: %s)",
    (baselinePass) => {
      const child = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          fixture,
          baselinePass ? "pass" : "fail",
        ],
        { encoding: "utf8", timeout: 15000, windowsHide: true },
      );
      expect(child.error).toBeUndefined();
      expect(child.status, child.stderr).toBe(0);
      const { receipt, calls } = JSON.parse(child.stdout);
      expect(calls).toContain("baseline");
      expect(receipt.pass).toBe(baselinePass);
      if (baselinePass) {
        expect(calls).toEqual(["fingerprint", "empty-report", "baseline"]);
        expect(receipt.tests).toEqual([
          { kind: "baseline", total: 1, passed: 1, failed: 0 },
        ]);
      } else {
        expect(calls).toEqual(["fingerprint", "empty-report", "baseline"]);
        expect(receipt.document).toMatchObject({
          missingTaskSamples: 36,
          missingFirstRunSamples: 9,
        });
        expect(receipt.detail).toMatch(/baseline regression failed/);
      }
    },
  );
});
