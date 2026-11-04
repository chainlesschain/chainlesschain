import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = fileURLToPath(new URL("../../../../../", import.meta.url));
const [archive, extracted] = process.argv.slice(2);
if (!archive || !extracted)
  throw new Error(
    "Usage: verify-package.mjs <tarball> <extracted-package-root>",
  );
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const files = [
  "src/lib/plugin-runtime/cli-goal-capabilities.js",
  "src/lib/plugin-runtime/goal-extensions.js",
  "src/lib/plugin-runtime/cli-goal-extension-host.js",
  "src/lib/plugin-runtime/cli-goal-drafts.js",
  "src/lib/plugin-runtime/cli-goal-draft-request.js",
  "src/lib/plugin-runtime/cli-goal-events.js",
  "src/lib/plugin-runtime/cli-project-goal-events.js",
  "src/lib/plugin-runtime/cli-goal-event-history.js",
  "src/lib/plugin-runtime/examples/project-delivery-assistant/plugin.json",
  "src/lib/plugin-runtime/examples/project-delivery-assistant/README.md",
];
const matches = files.map((file) => {
  const source = fs.readFileSync(path.join(repository, "packages/cli", file));
  const packed = fs.readFileSync(path.resolve(extracted, file));
  assert.ok(source.equals(packed), `Packed bytes differ: ${file}`);
  return { file, sha256: digest(source), equal: true };
});
const modulePath = path.resolve(extracted, files[0]);
assert.ok(!fs.existsSync(path.join(extracted, "node_modules")));
const { cliGoalExtensionHost, CLI_GOAL_CAPABILITIES } = await import(
  pathToFileURL(modulePath).href
);
const host = cliGoalExtensionHost(["event:risk.review.completed"]);
assert.deepEqual(host.activeCapabilities, ["event:risk.review.completed"]);
assert.equal(host.capabilities.length, 6);
assert.ok(Object.isFrozen(host) && Object.isFrozen(host.activeCapabilities));
assert.ok(Object.isFrozen(CLI_GOAL_CAPABILITIES));
assert.throws(() => cliGoalExtensionHost(["proposal:task.create"]));
const sample = JSON.parse(
  fs.readFileSync(path.resolve(extracted, files[8]), "utf8"),
);
assert.equal(sample.version, "0.2.0");
assert.deepEqual(sample.goalExtension.proposals, ["task.description.update"]);
const bytes = fs.readFileSync(archive);
const report = {
  localOnly: true,
  published: false,
  fullCliInstalledInIsolation: false,
  archive: {
    path: path.resolve(archive),
    sha256: digest(bytes),
    bytes: bytes.length,
  },
  matches,
  isolatedHostModuleLoaded: true,
  productVersion: JSON.parse(
    fs.readFileSync(path.resolve(extracted, "package.json"), "utf8"),
  ).version,
  scenarioVersion: sample.version,
};
fs.writeFileSync(
  new URL("./artifacts.json", import.meta.url),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    matchedFiles: matches.length,
    isolatedHostModuleLoaded: true,
    scenarioVersion: sample.version,
  }),
);
