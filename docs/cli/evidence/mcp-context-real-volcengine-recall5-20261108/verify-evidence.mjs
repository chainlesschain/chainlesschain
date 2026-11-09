import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const archive = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(
  fileURLToPath(new URL("../../../..", import.meta.url)),
);
const receipt = JSON.parse(
  fs.readFileSync(path.join(archive, "receipt.json"), "utf8"),
);
assert.equal(
  receipt.schema,
  "chainlesschain.real-volcengine-mcp-recall5-smoke/v1",
);
assert.equal(receipt.provider, "volcengine");
assert.equal(receipt.scale, 200);
assert.equal(receipt.requests, 10);
assert.equal(receipt.queryCount, 5);
assert.equal(receipt.recallAt5, 1);
assert.equal(receipt.targetExecutionObserved, false);
assert.equal(receipt.billingVerified, false);
assert.equal(receipt.realMiscallRateMeasured, false);
assert.equal(receipt.abComparison, false);
for (const row of receipt.queries) {
  assert.equal(row.searchResultCount, 1);
  assert.equal(row.searchToolCallObserved, true);
  assert.equal(row.targetCallObserved, true);
  assert.equal(row.targetExecutionObserved, undefined);
}
assert.equal(receipt.queries.filter((row) => row.targetCallObserved).length, 5);
assert.equal(receipt.sourceBindings.length, 2);
for (const binding of receipt.sourceBindings) {
  const actual = createHash("sha256")
    .update(fs.readFileSync(path.join(root, binding.path)))
    .digest("hex");
  assert.equal(actual, binding.sha256);
}
if (process.argv.includes("--check-current-source")) {
  const exists = execFileSync(
    "git",
    ["cat-file", "-e", `${receipt.sourceCommit}^{commit}`],
    { cwd: root, encoding: "utf8" },
  ).trim();
  assert.equal(exists, "");
}
console.log(
  JSON.stringify({
    verified: true,
    sourceCommit: receipt.sourceCommit,
    provider: receipt.provider,
    scale: receipt.scale,
    queryCount: receipt.queryCount,
    recallAt5: receipt.recallAt5,
    requests: receipt.requests,
    billingVerified: receipt.billingVerified,
  }),
);
