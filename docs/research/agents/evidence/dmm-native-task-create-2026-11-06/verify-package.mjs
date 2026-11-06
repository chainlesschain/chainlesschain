import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const [tarball, extractedPackage] = process.argv.slice(2);
assert.ok(
  tarball && extractedPackage,
  "provide tarball and extracted package paths",
);
const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const files = [
  "lib/goal-extension-proposal-contract.js",
  "lib/project-goal-extension-queue.js",
  "lib/project-goal-extension-conversion.js",
  "README.md",
];
for (const file of files) {
  assert.equal(
    hash(fs.readFileSync(path.join(root, "packages/session-core", file))),
    hash(fs.readFileSync(path.join(extractedPackage, file))),
    `packed file differs: ${file}`,
  );
}
assert.equal(fs.existsSync(path.join(extractedPackage, "node_modules")), false);
const contractPath = path.join(extractedPackage, files[0]);
const require = createRequire(import.meta.url);
const contract = require(contractPath);
const esm = await import(pathToFileURL(contractPath).href);
assert.deepEqual(
  esm.GOAL_EXTENSION_TASK_TYPES,
  contract.GOAL_EXTENSION_TASK_TYPES,
);
const proposal = {
  type: "task.create",
  goalRef: { id: "g1", storeId: "store1", revision: 1, controlGeneration: 0 },
  sourceRef: "source1",
  requestId: "request1",
  title: "Delivery follow-up",
  description: "Inspect the current evidence",
  taskType: "analyze_data",
};
assert.equal(
  contract.normalizeGoalExtensionProposal(proposal).taskType,
  "analyze_data",
);
assert.throws(() =>
  contract.normalizeGoalExtensionProposal({ ...proposal, taskType: undefined }),
);
assert.throws(() =>
  contract.normalizeGoalExtensionProposal({
    ...proposal,
    type: "task.description.update",
  }),
);
assert.equal(
  typeof require(path.join(extractedPackage, files[1]))
    .ProjectGoalExtensionQueue,
  "function",
);
assert.equal(
  typeof require(path.join(extractedPackage, files[2]))
    .readExtensionIntentBinding,
  "function",
);
process.stdout.write(
  JSON.stringify(
    {
      state: "verified-local-package",
      tarballSha256: hash(fs.readFileSync(tarball)),
      matchedFiles: files,
      cjsAndEsmContractLoaded: true,
      queueAndConversionLoaded: true,
      extractedPackageHasNodeModules: false,
      published: false,
    },
    null,
    2,
  ) + "\n",
);
