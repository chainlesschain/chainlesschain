import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
const file = "packages/cli/scripts/budget-egress-reviewed-sources.json";
const proposal = ".work/budget-egress-20261029/main-proposed-catalogue-v2.json";
const before = JSON.parse(fs.readFileSync(file, "utf8"));
const after = JSON.parse(fs.readFileSync(proposal, "utf8"));
const validation = JSON.parse(fs.readFileSync(".work/budget-egress-20261029/main-proposal-validation-v2.json", "utf8"));
assert.equal(before.schema, after.schema);
assert.deepEqual(before.scope, after.scope);
assert.equal(before.basis, after.basis);
const expected = new Set([
  "packages/cli/src/assets/web-panel/assets/Artifacts-D4DeQQ89.js",
  "packages/cli/src/assets/web-panel/assets/index-CI07XFwr.js",
  "packages/cli/src/assets/web-panel/assets/MtcAudit-CwJzv9a9.js",
  "packages/cli/src/assets/web-panel/assets/RemoteSession-DyCisp2M.js",
  "packages/cli/src/commands/llm.js",
  "packages/cli/src/lib/llm-connection-probe.js",
  "packages/cli/src/runtime/agent-core.js",
]);
const previous = new Map(before.entries.map(entry => [entry.path, entry]));
const changes = after.entries.filter(entry => JSON.stringify(entry) !== JSON.stringify(previous.get(entry.path)));
assert.deepEqual(new Set(changes.map(entry => entry.path)), expected);
for (const entry of before.entries) assert.ok(after.entries.some(next => next.path === entry.path), "No prior review may be dropped");
for (const entry of changes) assert.equal(entry.digest, "sha256:" + createHash("sha256").update(fs.readFileSync(entry.path)).digest("hex"), entry.path);
fs.copyFileSync(proposal, file);
fs.writeFileSync(".work/budget-egress-20261029/applied-main-review.json", JSON.stringify({ observedAt: new Date().toISOString(), reviewedAt: after.reviewedAt, changes, validationFile: "main-proposal-validation-v2.json", noRuntimeChange: true, scopeUnchanged: true }, null, 2) + "\n");
console.log(JSON.stringify({ changed: changes.length, scopeUnchanged: true }));
