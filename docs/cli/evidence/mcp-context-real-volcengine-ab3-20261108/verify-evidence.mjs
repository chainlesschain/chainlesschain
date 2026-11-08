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
assert.equal(receipt.schema, "chainlesschain.real-volcengine-mcp-ab3/v1");
assert.equal(receipt.provider, "volcengine");
assert.equal(receipt.scale, 200);
assert.equal(receipt.queryCount, 3);
assert.equal(receipt.billingVerified, false);
assert.equal(receipt.credentialExposed, false);
assert.equal(receipt.responseContentExposed, false);
for (const row of receipt.rows) {
  assert.equal(row.deferred.requests, 2);
  assert.equal(row.deferred.searchCallObserved, true);
  assert.equal(row.deferred.searchResultCount, 1);
  assert.equal(row.deferred.targetCallObserved, true);
  assert.deepEqual(row.deferred.wrongToolCalls, []);
  assert.equal(row.full.requests, 1);
  assert.equal(row.full.targetCallObserved, true);
  assert.deepEqual(row.full.wrongToolCalls, []);
}
assert.equal(receipt.rows.length, receipt.queryCount);
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
    deferredTargetCalls: receipt.rows.filter(
      (row) => row.deferred.targetCallObserved,
    ).length,
    fullTargetCalls: receipt.rows.filter((row) => row.full.targetCallObserved)
      .length,
    wrongToolCalls: receipt.rows.reduce(
      (sum, row) =>
        sum +
        row.deferred.wrongToolCalls.length +
        row.full.wrongToolCalls.length,
      0,
    ),
    billingVerified: receipt.billingVerified,
  }),
);
