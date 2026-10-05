#!/usr/bin/env node
/** Read-only VERIFY-01 preparation/collection checks; never executes a task. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { readEvalHistory } from "../src/lib/eval/evidence.js";
import { buildOutcomeReport } from "../src/lib/eval/outcomes.js";
import {
  validateVerify01Bundle,
  validateVerify01Review,
  validateVerify01Collection,
  requireValue,
  relativeFile,
  readBytes,
  readJson,
} from "../src/lib/eval/verify01-contracts.js";
export {
  validateVerify01Bundle,
  validateVerify01Review,
  validateVerify01Collection,
};

function main() {
  const { values } = parseArgs({
    options: {
      "plan-dir": { type: "string" },
      "plan-digest": { type: "string" },
      review: { type: "string" },
      "review-digest": { type: "string" },
      "review-root": { type: "string" },
      "project-sha": { type: "string" },
      "source-sha": { type: "string" },
      history: { type: "string" },
      observations: { type: "string" },
      samples: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "Read-only VERIFY-01 checks; no task, shell or model execution.\n--plan-dir DIR --plan-digest sha256:...\nOptional preparation: --review FILE --review-digest sha256:... --review-root DIR --project-sha SHA\nOptional existing collection: --history JSONL --observations JSON --samples id,id --source-sha TESTED_CLI_SHA\nSource SHA is an external operator pin, not proof of installed product provenance.\nExit 0: local validation only; 2: missing preparation/insufficient outcome; 1: invalid input.",
    );
    return;
  }
  requireValue(values["plan-dir"], "--plan-dir is required");
  const directory = path.resolve(values["plan-dir"]);
  const bundle = {
    plan: readJson(path.join(directory, "plan.json")),
    catalog: readJson(path.join(directory, "tasks.json")),
    bindings: readJson(path.join(directory, "comparison-bindings.json")),
    expectedPlanDigest: values["plan-digest"],
  };
  requireValue(
    readBytes(path.join(directory, "plan.sha256")).toString("utf8").trim() ===
      bundle.expectedPlanDigest,
    "pinned plan digest differs from plan.sha256",
  );
  validateVerify01Bundle(bundle);
  let preparation;
  if (values.review) {
    requireValue(values["review-root"], "--review-root is required");
    const root = fs.realpathSync(values["review-root"]);
    preparation = {
      review: readJson(values.review),
      expectedReviewDigest: values["review-digest"],
      projectCommit: values["project-sha"],
      readReviewedFile(file) {
        const resolved = fs.realpathSync(path.join(root, relativeFile(file)));
        const relative = path.relative(root, resolved);
        requireValue(
          relative &&
            !relative.startsWith(`..${path.sep}`) &&
            relative !== ".." &&
            !path.isAbsolute(relative),
          "review file escapes review root",
        );
        return readBytes(resolved);
      },
    };
    validateVerify01Review(bundle, preparation);
  }
  if (values.history || values.observations || values.samples) {
    requireValue(
      preparation && values.history && values.observations && values.samples,
      "collection requires preparation, history, observations and selected samples",
    );
    const report = validateVerify01Collection(bundle, preparation, {
      sampleIds: values.samples.split(","),
      sourceCommit: values["source-sha"],
      history: readEvalHistory(values.history),
      observations: readJson(values.observations),
    });
    console.log(JSON.stringify(report, null, 2));
    if (report.status === "INSUFFICIENT_EVIDENCE") process.exitCode = 2;
  } else {
    console.log(
      JSON.stringify(
        {
          scope: "verify01-read-only-preparation",
          productionAttested: false,
          executionStatus: "NOT_RUN",
          planDigest: bundle.expectedPlanDigest,
          reviewValidated: Boolean(preparation),
          report: buildOutcomeReport(
            { plan: bundle.plan, history: { runs: [], issues: [] } },
            { expectedPlanDigest: bundle.expectedPlanDigest },
          ),
        },
        null,
        2,
      ),
    );
    process.exitCode = 2;
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    console.error(`VERIFY-01 collection rejected: ${error.message}`);
    process.exitCode = 1;
  }
}
