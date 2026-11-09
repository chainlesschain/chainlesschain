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
  "chainlesschain.real-volcengine-mcp-host-roundtrip/v1",
);
assert.equal(receipt.provider, "volcengine");
assert.equal(receipt.scale, 200);
assert.equal(receipt.requests, 3);
for (const key of [
  "searchCallObserved",
  "targetCallObserved",
  "hostExecutionObserved",
  "hostArgumentsMatch",
  "hostMarkerObserved",
  "finalMarkerVerified",
])
  assert.equal(receipt[key], true);
assert.equal(receipt.searchResultCount, 1);
assert.equal(receipt.credentialExposed, false);
assert.equal(receipt.responseContentExposed, false);
assert.equal(receipt.billingVerified, false);
assert.equal(receipt.usages.length, 3);
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
    requests: receipt.requests,
    hostExecutionObserved: receipt.hostExecutionObserved,
    finalMarkerVerified: receipt.finalMarkerVerified,
    billingVerified: receipt.billingVerified,
  }),
);
