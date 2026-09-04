import { readFile } from "node:fs/promises";
import path from "node:path";

import { isWikiSkillBenchmarkCliHost } from "../lib/evolution/wikiskill-benchmark-cli-host.js";

const MAX_INPUT_BYTES = 4 * 1024 * 1024;

function host(value) {
  if (!isWikiSkillBenchmarkCliHost(value)) {
    throw new Error(
      "WikiSkill Benchmark is unavailable: a trusted deployment host is required",
    );
  }
  return value;
}

async function jsonFile(file, label) {
  const target = path.resolve(file);
  const bytes = await readFile(target);
  if (bytes.length < 1 || bytes.length > MAX_INPUT_BYTES)
    throw new Error(`${label} file size is invalid`);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must contain a JSON object`);
  return value;
}

function output(value) {
  console.log(JSON.stringify(value, null, 2));
}

export function registerWikiSkillBenchmarkCommands(
  evolution,
  { wikiSkillBenchmarkHost = null } = {},
) {
  const benchmark = evolution
    .command("benchmark")
    .description("Run and inspect governed WikiSkill benchmark reports");

  benchmark
    .command("run <plan-file> <execution-manifest-file>")
    .description("Execute, attest, and durably retain one benchmark plan")
    .option("--effective-at <timestamp>", "Canonical effective timestamp")
    .action(async (planFile, executionManifestFile, options) => {
      const trustedHost = host(wikiSkillBenchmarkHost);
      const [plan, executionManifest] = await Promise.all([
        jsonFile(planFile, "benchmark plan"),
        jsonFile(executionManifestFile, "benchmark execution manifest"),
      ]);
      output(
        await trustedHost.run({
          plan,
          executionManifest,
          effectiveAt: options.effectiveAt ?? null,
        }),
      );
    });

  benchmark
    .command("show <report-digest>")
    .description("Read and reverify one retained benchmark report")
    .action(async (reportDigest) => {
      const result = await host(wikiSkillBenchmarkHost).show(reportDigest);
      if (!result) throw new Error("WikiSkill Benchmark report was not found");
      output(result);
    });
}
