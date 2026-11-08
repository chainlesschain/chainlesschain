import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  fileURLToPath(new URL("../../../..", import.meta.url)),
);
const receiptPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "receipt.json",
);
const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
assert.equal(
  receipt.schema,
  "chainlesschain.real-volcengine-mcp-search-smoke/v1",
);
assert.equal(receipt.provider, "volcengine");
assert.equal(receipt.requests, 2);
assert.equal(receipt.scale, 200);
assert.equal(receipt.searchResultCount, 1);
assert.equal(receipt.targetCallObserved, true);
assert.equal(receipt.targetExecutionObserved, false);
assert.equal(receipt.credentialExposed, false);
assert.equal(receipt.responseContentExposed, false);
assert.equal(receipt.billingVerified, false);
assert.equal(receipt.realRecallAt5, false);
assert.equal(receipt.realMiscallRateMeasured, false);
assert.equal(receipt.abComparison, false);
for (const binding of receipt.sourceBindings) {
  const bytes = fs.readFileSync(path.join(root, binding.path));
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    binding.sha256,
  );
}
if (process.argv.includes("--check-current-source")) {
  const commit = execFileSync(
    "git",
    ["cat-file", "-e", `${receipt.sourceCommit}^{commit}`],
    {
      cwd: root,
      encoding: "utf8",
    },
  ).trim();
  assert.equal(commit, "");
}
console.log(
  JSON.stringify({
    verified: true,
    sourceCommit: receipt.sourceCommit,
    provider: receipt.provider,
    scale: receipt.scale,
    requests: receipt.requests,
    searchResultCount: receipt.searchResultCount,
    targetCallObserved: receipt.targetCallObserved,
    targetExecutionObserved: receipt.targetExecutionObserved,
    billingVerified: receipt.billingVerified,
  }),
);
