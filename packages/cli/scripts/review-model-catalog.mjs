#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { reviewModelCatalog } from "../src/lib/model-catalog-review.js";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const digest = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const defaultReview = fileURLToPath(
  new URL(
    "../__tests__/fixtures/model-catalog-review-2026-10-05.json",
    import.meta.url,
  ),
);

function readInput(file) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY);
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.size > 16n * 1024n * 1024n)
      throw new Error("Release snapshot must be a regular file within 16 MiB");
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let size = 0;
    while (size < bytes.length) {
      const count = fs.readSync(fd, bytes, size, bytes.length - size, null);
      if (!count) break;
      size += count;
    }
    const after = fs.fstatSync(fd, { bigint: true });
    if (
      BigInt(size) !== before.size ||
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs
    )
      throw new Error("Release snapshot changed while reading");
    const captured = bytes.subarray(0, size);
    return {
      text: new TextDecoder("utf-8", { fatal: true }).decode(captured),
      binding: { bytes: size, digest: digest(captured) },
    };
  } finally {
    fs.closeSync(fd);
  }
}

function sourceIdentity(expectedSha) {
  const git = (args) =>
    execFileSync("git", ["-C", repository, ...args], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    }).trim();
  const commit = git(["rev-parse", "HEAD"]);
  if (
    !/^[a-f0-9]{40}$/u.test(commit) ||
    (expectedSha && expectedSha !== commit)
  )
    throw new Error("Model review source differs from --expected-sha");
  const inputs = [
    "packages/cli/scripts/review-model-catalog.mjs",
    "packages/cli/src/lib/model-catalog-review.js",
    "packages/cli/src/lib/model-context-catalog.js",
    "packages/cli/src/lib/model-capabilities.js",
    "packages/cli/src/lib/provider-options.js",
    "packages/cli/src/lib/llm-pricing.js",
    "packages/cli/__tests__/fixtures/model-catalog-review-2026-10-05.json",
  ];
  const dirty =
    git(["status", "--porcelain", "--untracked-files=all", "--", ...inputs])
      .length > 0;
  const files = inputs.map((file) => ({
    path: file,
    ...readInput(path.join(repository, file)).binding,
  }));
  return {
    commit,
    reviewedSourcesDirty: dirty,
    files,
    installedProductVerified: false,
  };
}

/** Save review evidence even when drift rejects the gate. No model enablement. */
export function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      review: { type: "string" },
      codex: { type: "string" },
      claude: { type: "string" },
      output: { type: "string" },
      "expected-sha": { type: "string" },
      "fail-on-drift": { type: "boolean", default: false },
    },
    strict: true,
  });
  const review = readInput(values.review || defaultReview);
  const captured = Object.fromEntries(
    ["codex", "claude"]
      .filter((key) => values[key])
      .map((key) => [key, readInput(values[key])]),
  );
  const evidence = values.output
    ? {
        schema: "chainlesschain.model-catalog-review-evidence/v1",
        capturedAt: new Date().toISOString(),
        source: sourceIdentity(values["expected-sha"]),
        inputs: {
          review: review.binding,
          ...Object.fromEntries(
            Object.entries(captured).map(([key, input]) => [
              key,
              input.binding,
            ]),
          ),
        },
        upstreamSnapshotsComplete: Boolean(captured.codex && captured.claude),
        providerAssessed: false,
        billingVerified: false,
        productionAttested: false,
      }
    : null;
  if (!values.output && values["expected-sha"])
    sourceIdentity(values["expected-sha"]);
  let result;
  try {
    result = reviewModelCatalog(
      JSON.parse(review.text),
      Object.fromEntries(
        Object.entries(captured).map(([key, input]) => [key, input.text]),
      ),
    );
  } catch (error) {
    if (evidence) {
      evidence.result = null;
      evidence.reviewCompleted = false;
      evidence.error = error.message;
      fs.writeFileSync(
        values.output,
        JSON.stringify(evidence, null, 2) + "\n",
        { flag: "wx", mode: 0o600 },
      );
    }
    throw error;
  }
  if (evidence) {
    evidence.result = result;
    evidence.reviewCompleted = true;
    fs.writeFileSync(values.output, JSON.stringify(evidence, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
  }
  console.log(JSON.stringify(result, null, 2));
  return !result.localContractPassed ||
    (values["fail-on-drift"] && result.reviewRequired)
    ? 2
    : 0;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
