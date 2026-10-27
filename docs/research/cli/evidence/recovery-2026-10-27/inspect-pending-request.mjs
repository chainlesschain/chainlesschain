// Inspect the original downloaded artifact without replaying its model request.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseDiagnosticJson } from "../../../../../packages/cli/scripts/verify01-volcengine-diagnostic-broker.mjs";

const repository = fileURLToPath(new URL("../../../../../", import.meta.url));
const evidence = path.dirname(fileURLToPath(import.meta.url));
const artifactId = 12141416860;
const runId = 39139263000;
const sourceCommit = "eab51516a1ac00cc521b5279ee6eee6e8874fee7";
const broker = path.join(
  repository,
  ".work/verify01-remaining-20261027/verify09-delivery/verify-09/broker",
);
const metadataFile = path.join(evidence, "verify09-artifact.json");
const metadataBytes = fs.existsSync(metadataFile)
  ? fs.readFileSync(metadataFile)
  : execFileSync(
      "gh",
      [
        "api",
        `repos/chainlesschain/chainlesschain/actions/artifacts/${artifactId}`,
      ],
      { cwd: repository, timeout: 60000 },
    );
const metadata = JSON.parse(metadataBytes);
assert.equal(metadata.id, artifactId);
assert.equal(metadata.workflow_run.id, runId);
assert.equal(metadata.workflow_run.head_sha, sourceCommit);
assert.equal(
  metadata.name,
  `verify01-native-subset-delivery-darwin-jetbrains-${sourceCommit}`,
);
const digest = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
function save(name, bytes) {
  const file = path.join(evidence, name);
  if (fs.existsSync(file)) assert.deepEqual(fs.readFileSync(file), bytes);
  else fs.writeFileSync(file, bytes, { flag: "wx" });
}
const receiptBytes = fs.readFileSync(
  path.join(broker, "request-3.receipt.json"),
);
const receipt = parseDiagnosticJson(receiptBytes.toString("utf8"));
const response = fs.readFileSync(path.join(broker, "response-3.sse"));
assert.equal(receipt.id, 3);
assert.equal(receipt.taskId, "verify-09");
assert.equal(receipt.transport.dispatchStarted, true);
assert.equal(receipt.errorCode, "DIAGNOSTIC_TIMEOUT_USAGE_UNKNOWN");
assert.equal(receipt.response.storedSha256, digest(response).slice(7));
assert.equal(receipt.response.originalSha256, receipt.response.storedSha256);
assert.equal(receipt.response.storedBytes, response.length);
assert.equal(receipt.response.originalBytes, response.length);
assert.equal(receipt.response.status, 200);
const responseIds = new Set();
const finishReasons = new Set();
let eventCount = 0,
  usageEvents = 0,
  doneEvents = 0;
for (const block of response
  .toString("utf8")
  .replaceAll("\r\n", "\n")
  .split("\n\n")) {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) continue;
  if (data === "[DONE]") {
    doneEvents++;
    continue;
  }
  const event = parseDiagnosticJson(data);
  eventCount++;
  if (event.id) responseIds.add(event.id);
  if (event.usage) usageEvents++;
  for (const choice of event.choices ?? [])
    if (choice.finish_reason) finishReasons.add(choice.finish_reason);
}
assert.equal(responseIds.size, 1);
assert.equal(eventCount, 3992);
assert.equal(usageEvents, 0);
assert.equal(doneEvents, 0);
assert.equal(finishReasons.size, 0);
assert.equal(receipt.usage, null);
assert.equal(receipt.actualBilledCostCny, null);
save("verify09-artifact.json", metadataBytes);
save("verify09-request-3.receipt.json", receiptBytes);
const result = {
  schema: "chainlesschain.pending-native-request-inspection/v1",
  status: "RECONCILIATION_REQUIRED_BEFORE_RETRY",
  sampleId: "verify-09",
  runId,
  artifactId,
  sourceCommit,
  artifactMetadata: {
    path: "verify09-artifact.json",
    digest: digest(metadataBytes),
  },
  recoveredReceipt: {
    path: "verify09-request-3.receipt.json",
    digest: digest(receiptBytes),
  },
  response: {
    digest: digest(response),
    bytes: response.length,
    eventCount,
    providerResponseId: [...responseIds][0],
    finishReasons: [],
    usageEvents,
    doneEvents,
  },
  physicalDispatchConfirmed: true,
  actualBilledCostCny: null,
  requestStartedAt: receipt.startedAt,
  requestStoppedAt: receipt.finishedAt,
  newModelCalls: 0,
  originalVerdictUnchanged: true,
  nextStep:
    "Reconcile this provider response ID and the shared historical $99 budget with account records before retrying. A fresh broker allowance does not resolve the original request.",
};
save(
  "verify09-request-reconciliation.json",
  Buffer.from(JSON.stringify(result, null, 2) + "\n"),
);
console.log(JSON.stringify(result));
