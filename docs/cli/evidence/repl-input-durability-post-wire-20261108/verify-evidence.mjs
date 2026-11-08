import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const evidenceDir = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(evidenceDir, "../../../..");
const manifest = JSON.parse(fs.readFileSync(path.join(evidenceDir, "manifest.json"), "utf8"));
function verify(item) {
  const file = path.join(repo, item.path);
  const bytes = fs.readFileSync(file);
  if (bytes.length !== item.bytes || createHash("sha256").update(bytes).digest("hex") !== item.sha256)
    throw new Error(`Evidence identity mismatch: ${item.path}`);
}
for (const item of manifest.sources) verify(item);
for (const item of manifest.artifacts) verify(item);
const receipt = JSON.parse(fs.readFileSync(path.join(repo, manifest.latestReceipt), "utf8"));
const originalCallId = receipt.originalCallId;
if (!receipt.completed || receipt.originalExit?.signal !== "SIGKILL") throw new Error("original process was not hard-killed");
if (receipt.oldProviderReplays !== 0 || receipt.newProviderRequests !== 1) throw new Error("provider request replay/admission count mismatch");
if (!receipt.visibleRecoveryNotice || receipt.oldPromptPreservedAfterResume !== false) throw new Error("recovery notice or prompt privacy assertion missing");
for (const snapshot of [receipt.beforeKill, receipt.afterKill, receipt.afterResume]) {
  if (!snapshot?.verified || !snapshot.rawUnsettledCallIds.includes(originalCallId)) throw new Error("unsettled call was not retained");
  if (snapshot.productUsageProjection?.usage?.billingComplete !== false) throw new Error("billing was falsely marked complete");
}
const resumed = receipt.requests.filter((item) => item.phase === "resume");
if (resumed.length !== 1 || !resumed[0].lastIsNew || resumed[0].lastIsOld) throw new Error("resume transport did not carry one new request only");
const messages = receipt.afterResume.messages || [];
if (!messages.some((item) => item.role === "user" && String(item.content).includes("REPL_CRASH_NEW_98264"))) throw new Error("new settled prompt missing");
if (messages.some((item) => String(item.content).includes("REPL_CRASH_HELD_23861"))) throw new Error("old prompt leaked into resumed history");
const report = fs.readFileSync(path.join(repo, manifest.testReport), "utf8");
if (!/Test Files\s+1 passed \(1\)/.test(report) || !/Tests\s+2 passed \(2\)/.test(report) || /\b(?:failed|skipped)\b/i.test(report))
  throw new Error("native E2E report is not one non-skipped file with two passing tests");
console.log(JSON.stringify({ verified: true, sourceCommit: manifest.sourceCommit, artifacts: manifest.artifacts.length, testFiles: 1, tests: 2, originalCallId, oldProviderReplays: receipt.oldProviderReplays, newProviderRequests: receipt.newProviderRequests, unresolvedUsageRetained: true, resumedHistoryExcludesOldPrompt: true }));
