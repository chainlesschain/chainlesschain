import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const [coreRoot, cliRoot, coreTarball, cliTarball] = process.argv.slice(2);
assert.ok(coreRoot && cliRoot && coreTarball && cliTarball);
const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const hash = (file) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const groups = [
  [
    "packages/session-core",
    coreRoot,
    [
      "lib/goal-draft-request-contract.js",
      "lib/project-goal-draft-imports.js",
      "lib/goal-extension-proposal-contract.js",
      "lib/project-goal-extension-conversion.js",
      "lib/project-goal-extension-queue.js",
      "README.md",
    ],
  ],
  [
    "packages/cli",
    cliRoot,
    [
      "src/commands/goal.js",
      "src/command-help-index.json",
      "src/lib/plugin-runtime/cli-goal-capabilities.js",
      "src/lib/plugin-runtime/cli-goal-draft-request.js",
      "src/lib/plugin-runtime/examples/goal-task-creator/plugin.json",
      "src/lib/plugin-runtime/examples/goal-task-creator/README.md",
      "README.md",
    ],
  ],
];
const matchedFiles = [];
for (const [base, extracted, files] of groups)
  for (const file of files) {
    assert.equal(
      hash(path.join(root, base, file)),
      hash(path.join(extracted, file)),
      file,
    );
    matchedFiles.push(`${base}/${file}`);
  }
assert.equal(fs.existsSync(path.join(coreRoot, "node_modules")), false);
const require = createRequire(import.meta.url);
const file = path.join(coreRoot, "lib/goal-draft-request-contract.js");
const contract = require(file),
  esm = await import(pathToFileURL(file).href);
const input = {
  declaredPlugin: { name: "creator", version: "0.1.0", scope: "project" },
  declarationDigest: `sha256:${"a".repeat(64)}`,
  proposal: {
    type: "task.create",
    taskType: "analyze_data",
    goalRef: { id: "g", storeId: "s", revision: 1, controlGeneration: 0 },
    sourceRef: `goal-proposal-${"b".repeat(64)}`,
    requestId: "r",
    title: "Follow-up",
    description: "Inspect risk evidence",
  },
};
const request = contract.createGoalTaskCreateRequest(input);
assert.deepEqual(esm.validateGoalDraftImportRequest(request), request);
assert.throws(() => contract.validateGoalDraftRequest(request));
assert.throws(() =>
  contract.validateGoalTaskCreateRequest({
    ...request,
    proposal: { ...request.proposal, taskType: "query_info" },
  }),
);
assert.equal(
  typeof require(path.join(coreRoot, "lib/project-goal-draft-imports.js"))
    .ProjectGoalDraftImports,
  "function",
);
process.stdout.write(
  JSON.stringify(
    {
      state: "verified-local-packages",
      matchedFiles,
      tarballs: {
        sessionCoreSha256: hash(coreTarball),
        cliSha256: hash(cliTarball),
      },
      cjsAndEsmCreationContractLoaded: true,
      nativeImporterLoaded: true,
      extractedCoreHasNodeModules: false,
      fullIsolatedCliInstall: false,
      published: false,
    },
    null,
    2,
  ) + "\n",
);
