#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildCommandLifecycleReport,
  renderCommandLifecycleReportMarkdown,
} from "../src/lib/command-lifecycle-report.js";

function usage() {
  return [
    "Usage: node scripts/command-lifecycle-report.mjs --input <otlp.json|ndjson> [--input <file> ...] --coverage <coverage.json> [--out <report.json>] [--markdown <report.md>] [--fail-on-incomplete]",
    "",
    "The report is content-free and never edits command aliases. Removal is recommended only when every release-window, coverage and usage gate passes.",
  ].join("\n");
}

function parseArgs(argv) {
  const result = { inputs: [], failOnIncomplete: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--input") result.inputs.push(argv[++index]);
    else if (token === "--coverage") result.coverage = argv[++index];
    else if (token === "--out") result.out = argv[++index];
    else if (token === "--markdown") result.markdown = argv[++index];
    else if (token === "--fail-on-incomplete") result.failOnIncomplete = true;
    else if (token === "--help" || token === "-h") result.help = true;
    else throw new Error(`Unknown argument: ${token}`);
  }
  if (result.inputs.some((item) => typeof item !== "string")) {
    throw new Error("--input requires a file path");
  }
  return result;
}

function parseDocuments(path) {
  const source = readFileSync(resolve(path), "utf8").trim();
  if (!source) return [];
  try {
    return [JSON.parse(source)];
  } catch {
    return source
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line, index) => {
        try {
          return JSON.parse(line);
        } catch (error) {
          throw new Error(
            `${path}:${index + 1}: invalid JSON: ${error.message}`,
          );
        }
      });
  }
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }
  if (args.inputs.length === 0 || !args.coverage) {
    throw new Error(`--input and --coverage are required\n\n${usage()}`);
  }
  const manifest = JSON.parse(
    readFileSync(
      new URL("../src/command-manifest.json", import.meta.url),
      "utf8",
    ),
  );
  const coverage = JSON.parse(readFileSync(resolve(args.coverage), "utf8"));
  const report = buildCommandLifecycleReport({
    documents: args.inputs.flatMap(parseDocuments),
    manifest,
    coverage,
  });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = renderCommandLifecycleReportMarkdown(report);
  if (args.out) writeFileSync(resolve(args.out), json, "utf8");
  if (args.markdown) writeFileSync(resolve(args.markdown), markdown, "utf8");
  if (!args.out && !args.markdown) process.stdout.write(json);
  if (
    args.failOnIncomplete &&
    (!report.coverage.ready ||
      !report.ingestion.ready ||
      report.summary["insufficient-data"] > 0)
  ) {
    process.exitCode = 2;
  }
} catch (error) {
  process.stderr.write(`command lifecycle report failed: ${error.message}\n`);
  process.exitCode = 1;
}
