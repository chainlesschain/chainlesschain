import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { validateReleaseEvidence } = require("./release-evidence.cjs");

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const evidencePath = option("--evidence");
const expectedCommit = option("--expected-commit");
const expectedRepository = option("--expected-repository");
const outputPath = option("--output");
if (!evidencePath || !expectedCommit) {
  throw new Error("--evidence and --expected-commit are required");
}
const requirements = JSON.parse(
  readFileSync(new URL("../release/required-evidence.v1.json", import.meta.url), "utf8"),
);
const manifest = JSON.parse(readFileSync(evidencePath, "utf8"));
const receipt = validateReleaseEvidence(manifest, requirements, {
  expectedCommit,
  ...(expectedRepository ? { expectedRepository } : {}),
});
const output = `${JSON.stringify(receipt, null, 2)}\n`;
if (outputPath) writeFileSync(outputPath, output, "utf8");
else process.stdout.write(output);
