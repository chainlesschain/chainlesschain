#!/usr/bin/env node
/** Prepare a real host task and finish its actual acceptance material. Does
 * not launch a provider/IDE, authorize charges, or update frozen samples.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { readJson, requireValue } from "../src/lib/eval/verify01-contracts.js";
import {
  captureArtifactReader,
  prepareVerify01HostTask,
  finishVerify01HostTask,
} from "../src/lib/eval/verify01-host-capture.js";

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: Object.fromEntries(
      [
        "stage",
        "plan-dir",
        "plan-digest",
        "review",
        "review-digest",
        "review-root",
        "source-sha",
        "sample",
        "workspace",
        "capture-root",
        "project-root",
        "os",
        "state",
        "state-digest",
        "retries",
        "manual-repairs",
        "failure-cause",
        "first-run",
      ]
        .map((key) => [key, { type: "string" }])
        .concat([["help", { type: "boolean" }]]),
    ),
  });
  if (values.help) {
    console.log(
      "Prepare/finish real IDE acceptance; no model/GUI invocation, no formal plan writes.\n" +
        "Both stages: --stage prepare|finish --plan-dir DIR --plan-digest sha256:... --review FILE --review-digest sha256:... --review-root DIR --source-sha TESTED_CLI_SHA\n" +
        "prepare: --sample ID --project-root FROZEN_GIT_CHECKOUT --workspace NEW_DIR --capture-root NEW_DIR --os FROZEN_OS\n" +
        "finish: --state FILE --state-digest sha256:... [--retries N --manual-repairs N --failure-cause CLASS --first-run FILE]\n" +
        "Preparation enforces actual frozen platform/arch/Node, materializes committed Git blobs and runs the pinned setup. Finish scans ALL files, runs the pinned check and imports actual protocol.json/ui.json. Keep state-digest outside the candidate checkout. First-run stage files remain operator-provided evidence.",
    );
    return;
  }
  for (const key of [
    "stage",
    "plan-dir",
    "plan-digest",
    "review",
    "review-digest",
    "review-root",
    "source-sha",
  ])
    requireValue(values[key], `--${key} is required`);
  const bundle = {
    plan: readJson(path.join(values["plan-dir"], "plan.json")),
    catalog: readJson(path.join(values["plan-dir"], "tasks.json")),
    bindings: readJson(
      path.join(values["plan-dir"], "comparison-bindings.json"),
    ),
    expectedPlanDigest: values["plan-digest"],
  };
  requireValue(
    fs
      .readFileSync(path.join(values["plan-dir"], "plan.sha256"), "utf8")
      .trim() === bundle.expectedPlanDigest,
    "external frozen plan byte binding differs",
  );
  const reader = captureArtifactReader(values["review-root"]);
  // Validate/capture evaluator bytes once. Later process startup consumes these
  // exact immutable buffers, not candidate-replaceable paths.
  const artifacts = new Map();
  const preparation = {
    review: readJson(values.review),
    expectedReviewDigest: values["review-digest"],
    projectCommit: bundle.catalog.projectCommit,
    readReviewedFile: (file) => {
      if (!artifacts.has(file)) artifacts.set(file, reader(file));
      return artifacts.get(file);
    },
  };
  let result;
  if (values.stage === "prepare") {
    for (const key of [
      "sample",
      "project-root",
      "workspace",
      "capture-root",
      "os",
    ])
      requireValue(values[key], `--${key} is required`);
    result = await prepareVerify01HostTask(bundle, preparation, {
      sampleId: values.sample,
      projectRoot: values["project-root"],
      workspace: values.workspace,
      captureRoot: values["capture-root"],
      os: values.os,
      sourceCommit: values["source-sha"],
      reviewRoot: values["review-root"],
    });
    // The potentially large before-body index stays on disk.
    console.log(
      JSON.stringify(
        {
          stateFile: result.stateFile,
          stateDigest: result.stateDigest,
          workspace: result.state.workspace,
          captureRoot: result.state.captureRoot,
          deadline: result.state.deadline,
          promptFile: path.join(result.state.captureRoot, "prompt.txt"),
          provider: result.state.provider,
          model: result.state.model,
          permissionMode: result.state.permissionMode,
          host: result.state.host,
          observationsCreated: false,
          productionAttested: false,
        },
        null,
        2,
      ),
    );
  } else {
    requireValue(
      values.stage === "finish",
      "--stage must be prepare or finish",
    );
    requireValue(
      values.state && values["state-digest"],
      "finish requires --state and --state-digest",
    );
    result = finishVerify01HostTask(bundle, preparation, {
      state: readJson(values.state),
      expectedStateDigest: values["state-digest"],
      sourceCommit: values["source-sha"],
      reviewRoot: values["review-root"],
      retries: values.retries === undefined ? 0 : Number(values.retries),
      manualRepairs:
        values["manual-repairs"] === undefined
          ? 0
          : Number(values["manual-repairs"]),
      failureCause: values["failure-cause"],
      firstRun: values["first-run"] ? readJson(values["first-run"]) : undefined,
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.imported.report.status === "INSUFFICIENT_EVIDENCE")
      process.exitCode = 2;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(`VERIFY-01 host capture rejected: ${error.message}`);
    process.exitCode = 1;
  });
