import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const manifest = JSON.parse(
  fs.readFileSync(new URL("./manifest.json", import.meta.url), "utf8"),
);
function verify(item) {
  const bytes = fs.readFileSync(path.join(root, item.path));
  if (
    bytes.length !== item.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== item.sha256
  )
    throw new Error("Evidence identity mismatch: " + item.path);
}
for (const item of manifest.artifacts) verify(item);
if (process.argv.includes("--check-current-sources"))
  for (const item of manifest.sources) verify(item);
const before = JSON.parse(
  fs.readFileSync(
    new URL("./raw/product-final/source-before.json", import.meta.url),
    "utf8",
  ),
);
const after = JSON.parse(
  fs.readFileSync(
    new URL("./raw/product-final/source-after.json", import.meta.url),
    "utf8",
  ),
);
if (JSON.stringify(before) !== JSON.stringify(after))
  throw new Error("Measured source changed during final E2E");
for (const measured of before) {
  const current = manifest.sources.find((item) => item.path === measured.path);
  if (
    !current ||
    current.sha256 !== measured.sha256 ||
    current.bytes !== measured.bytes
  )
    throw new Error(
      "Current manifest differs from measured source: " + measured.path,
    );
}

const readJson = (relative) =>
  JSON.parse(fs.readFileSync(new URL(relative, import.meta.url), "utf8"));
function requireEvidence(condition, message) {
  if (!condition)
    throw new Error("REPL behavior evidence rejected: " + message);
}
const finalExit = readJson("./raw/product-final/exit.json");
requireEvidence(
  finalExit.code === 0 &&
    finalExit.signal === null &&
    finalExit.sourceIdentityMatch === true,
  "final E2E did not exit successfully with unchanged sources",
);
const report = fs.readFileSync(
  new URL("./raw/product-final/stdout.log", import.meta.url),
  "utf8",
);
requireEvidence(
  /Test Files\s+1 passed \(1\)/.test(report) &&
    /Tests\s+2 passed \(2\)/.test(report) &&
    !/\b(?:skipped|failed)\b/i.test(report),
  "final native test report is not two non-skipped passes",
);
const receipt = readJson(
  "./raw/product-final/artifacts/run-f9zGL5/receipt.json",
);
requireEvidence(
  receipt.completed === true && receipt.error == null,
  "journey did not complete",
);
requireEvidence(
  receipt.schema === "chainlesschain.repl-inflight-crash-journey/v1",
  "unexpected receipt schema",
);
requireEvidence(
  receipt.sessionId === "repl-inflight-recovery",
  "wrong session",
);
requireEvidence(
  receipt.killRequested === true &&
    receipt.originalExit?.signal === "SIGKILL" &&
    receipt.originalExit?.code === null,
  "owned original process was not hard-killed",
);
const original = receipt.processes?.find((item) => item.label === "original");
requireEvidence(
  Number.isSafeInteger(original?.pid) &&
    original.pid > 0 &&
    original.signal === "SIGKILL" &&
    original.code === null,
  "original process close evidence is missing",
);
requireEvidence(
  receipt.resumedExit?.code === 0 && receipt.resumedExit?.signal === null,
  "resumed process did not exit cleanly",
);
requireEvidence(
  receipt.oldProviderReplays === 0,
  "old provider request replayed",
);
requireEvidence(
  receipt.newProviderRequests === 1,
  "new provider request was not admitted exactly once",
);
const resumeRequests = receipt.requests.filter(
  (item) => item.phase === "resume",
);
requireEvidence(
  resumeRequests.length === 1 &&
    resumeRequests[0].lastIsNew === true &&
    resumeRequests[0].lastIsOld === false,
  "transport records contradict request counts",
);
requireEvidence(
  receipt.requests.some(
    (item) => item.phase === "held" && item.lastIsOld === true,
  ),
  "original request was not observed by the held transport",
);
requireEvidence(
  typeof receipt.originalCallId === "string" &&
    receipt.originalCallId.length > 0,
  "missing original callId",
);
const originalCallId = receipt.originalCallId;
const baseline = receipt.beforeHeld?.knownUsage?.total?.totalTokens;
requireEvidence(
  Number.isSafeInteger(baseline) && baseline > 0,
  "no known usage baseline",
);
let priorKnown = baseline;
for (const [name, snapshot] of [
  ["beforeKill", receipt.beforeKill],
  ["afterKill", receipt.afterKill],
  ["afterResume", receipt.afterResume],
]) {
  requireEvidence(
    snapshot?.verified === true && snapshot.sessionId === receipt.sessionId,
    name + " is not the same verified session",
  );
  const projection = snapshot.productUsageProjection;
  const usage = projection?.usage;
  requireEvidence(
    projection?.available === true &&
      projection.source === "readSessionHostResumeState/modelUsageRecovery",
    name + " lacks production local recovery projection",
  );
  requireEvidence(
    usage?.billingComplete === false &&
      usage.assurance === "recorded-model-call-ledger-only" &&
      usage.telemetryComplete === false,
    name + " falsely claims complete cost/usage",
  );
  requireEvidence(
    usage.unsettledCallIds.includes(originalCallId) &&
      usage.unknownEvidence.byCode.some(
        (row) => row.code === "model-usage-unsettled" && row.count === 1,
      ),
    name + " original cost is not unknown",
  );
  requireEvidence(
    snapshot.rawUnsettledCallIds.includes(originalCallId),
    name + " raw ledger contradicts unknown cost",
  );
  requireEvidence(
    snapshot.usage.filter(
      (row) =>
        row.type === "model_usage_started" && row.callId === originalCallId,
    ).length === 1,
    name + " original call start missing or replayed",
  );
  requireEvidence(
    !snapshot.usage.some(
      (row) => row.type === "token_usage" && row.callId === originalCallId,
    ),
    name + " original call was falsely settled",
  );
  const known = snapshot.knownUsage?.total?.totalTokens;
  requireEvidence(
    Number.isSafeInteger(known) && known >= priorKnown,
    name + " known usage regressed",
  );
  priorKnown = known;
  requireEvidence(
    snapshot.scopedObservabilityProjection?.available === false &&
      /no observabilityScope authority/.test(
        snapshot.scopedObservabilityProjection.error?.message || "",
      ),
    name + " unexpectedly grants scoped observability authority",
  );
}
requireEvidence(
  receipt.visibleRecoveryNotice === true &&
    receipt.recoveryDiagnostics.some(
      (line) =>
        line.includes(receipt.sessionId) &&
        line.includes(originalCallId) &&
        /usage and cost remain unknown/.test(line) &&
        /prompt may not have been saved/.test(line) &&
        /Inspect.*reconcile.*explicitly resubmitting/.test(line) &&
        /not retried automatically/.test(line) &&
        receipt.resumeOutput.includes(line),
    ),
  "actionable call-specific recovery notice missing",
);
const priorCalls = new Set(
  receipt.beforeKill.usage
    .filter((row) => row.type === "model_usage_started")
    .map((row) => row.callId),
);
const newCalls = receipt.afterResume.usage.filter(
  (row) => row.type === "model_usage_started" && !priorCalls.has(row.callId),
);
requireEvidence(
  newCalls.length === 1 && newCalls[0].callId !== originalCallId,
  "new input did not use a distinct single call",
);

console.log(
  JSON.stringify({
    verified: true,
    artifacts: manifest.artifacts.length,
    measuredSources: before.length,
    actualReplJourneyPassed: true,
    behaviorAssertionsPassed: true,
    preDispatchPromptDurabilityComplete: false,
    wholeGapClosed: false,
  }),
);
