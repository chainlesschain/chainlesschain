#!/usr/bin/env node
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { reviewModelCatalog } from "../src/lib/model-catalog-review.js";

try {
  const { values } = parseArgs({
    options: {
      review: { type: "string" },
      codex: { type: "string" },
      claude: { type: "string" },
      "fail-on-drift": { type: "boolean", default: false },
    },
    strict: true,
  });
  const read = (file) => {
    if (statSync(file).size > 16 * 1024 * 1024)
      throw new Error("Release snapshot exceeds the 16 MiB limit");
    return readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  };
  const review = JSON.parse(
    read(
      values.review ||
        fileURLToPath(
          new URL(
            "../__tests__/fixtures/model-catalog-review-2026-10-05.json",
            import.meta.url,
          ),
        ),
    ),
  );
  const snapshots = Object.fromEntries(
    ["codex", "claude"]
      .filter((key) => values[key])
      .map((key) => [key, read(values[key])]),
  );
  const result = reviewModelCatalog(review, snapshots);
  console.log(JSON.stringify(result, null, 2));
  if (
    !result.localContractPassed ||
    (values["fail-on-drift"] && result.reviewRequired)
  )
    process.exitCode = 2;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
