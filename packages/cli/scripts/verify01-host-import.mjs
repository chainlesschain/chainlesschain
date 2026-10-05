#!/usr/bin/env node
/** Read-only adapter for already captured IDE and installation evidence. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { importVerify01HostCapture } from "../src/lib/eval/verify01-host-evidence.js";
import {
  readBytes,
  readJson,
  relativeFile,
  requireValue,
} from "../src/lib/eval/verify01-contracts.js";

export function artifactReader(directory) {
  const root = fs.realpathSync(directory);
  return (relative) => {
    relativeFile(relative);
    let file = root;
    for (const part of relative.split("/")) {
      file = path.join(file, part);
      requireValue(
        !fs.lstatSync(file).isSymbolicLink(),
        "captured artifact must not traverse a link",
      );
    }
    const resolved = fs.realpathSync(file);
    const suffix = path.relative(root, resolved);
    requireValue(
      suffix &&
        suffix !== ".." &&
        !suffix.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(suffix),
      "captured artifact escapes its root",
    );
    return readBytes(resolved);
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { values } = parseArgs({
      options: Object.fromEntries(
        [
          "plan-dir",
          "plan-digest",
          "review",
          "review-digest",
          "review-root",
          "project-sha",
          "source-sha",
          "manifest",
          "capture-digest",
          "capture-root",
        ]
          .map((name) => [name, { type: "string" }])
          .concat([["help", { type: "boolean" }]]),
      ),
    });
    if (values.help) {
      console.log(
        "Read-only import of existing raw IDE/first-install evidence; no model/task/IDE execution.\n" +
          "--plan-dir DIR --plan-digest sha256:... --review FILE --review-digest sha256:... --review-root DIR " +
          "--project-sha SHA --source-sha TESTED_CLI_SHA --manifest FILE --capture-digest sha256:... --capture-root DIR\n" +
          "JSON stdout contains existing Eval/outcome records. Exit 2: incomplete baseline; 1: invalid evidence. " +
          "Local captures do not attest installed products, accounts or billing.",
      );
    } else {
      for (const field of [
        "plan-dir",
        "plan-digest",
        "review",
        "review-digest",
        "review-root",
        "project-sha",
        "source-sha",
        "manifest",
        "capture-digest",
        "capture-root",
      ])
        requireValue(values[field], `--${field} is required`);
      const bundle = {
        plan: readJson(path.join(values["plan-dir"], "plan.json")),
        catalog: readJson(path.join(values["plan-dir"], "tasks.json")),
        bindings: readJson(
          path.join(values["plan-dir"], "comparison-bindings.json"),
        ),
        expectedPlanDigest: values["plan-digest"],
      };
      requireValue(
        readBytes(path.join(values["plan-dir"], "plan.sha256"))
          .toString("utf8")
          .trim() === bundle.expectedPlanDigest,
        "pinned plan.sha256 mismatch",
      );
      const preparation = {
        review: readJson(values.review),
        expectedReviewDigest: values["review-digest"],
        projectCommit: values["project-sha"],
        readReviewedFile: artifactReader(values["review-root"]),
      };
      const imported = importVerify01HostCapture(bundle, preparation, {
        manifest: readJson(values.manifest),
        expectedManifestDigest: values["capture-digest"],
        readArtifact: artifactReader(values["capture-root"]),
        sourceCommit: values["source-sha"],
      });
      console.log(JSON.stringify(imported, null, 2));
      if (imported.report.status === "INSUFFICIENT_EVIDENCE")
        process.exitCode = 2;
    }
  } catch (error) {
    console.error(`VERIFY-01 host import rejected: ${error.message}`);
    process.exitCode = 1;
  }
}
