#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path, { resolve } from "node:path";
import { TextDecoder } from "node:util";
import {
  buildCommandLifecycleReport,
  renderCommandLifecycleReportMarkdown,
} from "../src/lib/command-lifecycle-report.js";

const MAX_EVIDENCE_BYTES = 1024 * 1024;
const MAX_EXPORT_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_EXPORT_BYTES = 256 * 1024 * 1024;
const MAX_NDJSON_LINE_BYTES = 8 * 1024 * 1024;
const MAX_DOCUMENTS = 100_000;
const MAX_INPUTS = 1_024;
const utf8 = new TextDecoder("utf-8", { fatal: true });

class DuplicateJsonKeyError extends Error {}
class JsonInputLimitError extends Error {}

function usage() {
  return [
    "Usage: node scripts/command-lifecycle-report.mjs --coverage <coverage.json> --export-manifest <manifest.json> --generator-sha <40-hex SHA> [--approval <approval.json>] [--input <partition-id>=<otlp.json|ndjson> ...] [--out <report.json>] [--markdown <report.md>] [--generated-at <ISO timestamp>] [--fail-on-incomplete]",
    "",
    "Every input is hashed as exact bytes. Input order, digest, non-overlapping half-open window and temporality must exactly match the signed export manifest.",
    "The packaged CLI has no user-selectable approval key. Until a release pins a repository trust root, signed approvals fail closed and every alias action remains retain.",
    "The report is content-free and never edits command aliases.",
  ].join("\n");
}

function parseArgs(argv) {
  const result = { inputs: [], failOnIncomplete: false };
  const seen = new Set();
  const readSingleton = (token, key, index) => {
    if (seen.has(token)) throw new Error(`Duplicate argument: ${token}`);
    seen.add(token);
    const value = argv[index + 1];
    if (typeof value !== "string" || value.startsWith("--")) {
      throw new Error(`${token} requires a value`);
    }
    result[key] = value;
    return index + 1;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--input") {
      const value = argv[index + 1];
      if (typeof value !== "string" || value.startsWith("--")) {
        throw new Error("--input requires <partition-id>=<file>");
      }
      result.inputs.push(value);
      index += 1;
    } else if (token === "--coverage") {
      index = readSingleton(token, "coverage", index);
    } else if (token === "--export-manifest") {
      index = readSingleton(token, "exportManifest", index);
    } else if (token === "--generator-sha") {
      index = readSingleton(token, "generatorSha", index);
    } else if (token === "--approval") {
      index = readSingleton(token, "approval", index);
    } else if (token === "--out") {
      index = readSingleton(token, "out", index);
    } else if (token === "--markdown") {
      index = readSingleton(token, "markdown", index);
    } else if (token === "--generated-at") {
      index = readSingleton(token, "generatedAt", index);
    } else if (token === "--fail-on-incomplete") {
      if (seen.has(token)) throw new Error(`Duplicate argument: ${token}`);
      seen.add(token);
      result.failOnIncomplete = true;
    } else if (token === "--help" || token === "-h") result.help = true;
    else throw new Error(`Unknown argument: ${token}`);
  }
  return result;
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function decodeUtf8(source, label) {
  try {
    return utf8.decode(source);
  } catch {
    throw new Error(`${label} is not valid UTF-8`);
  }
}

function assertNoDuplicateJsonKeys(text, label) {
  let index = 0;
  const skipWhitespace = () => {
    while (/\s/.test(text[index] || "")) index += 1;
  };
  const readString = () => {
    const start = index;
    index += 1;
    while (index < text.length) {
      if (text[index] === "\\") {
        index += 2;
      } else if (text[index] === '"') {
        index += 1;
        return JSON.parse(text.slice(start, index));
      } else {
        index += 1;
      }
    }
    return null;
  };
  const parseValue = () => {
    skipWhitespace();
    if (text[index] === "{") {
      parseObject();
    } else if (text[index] === "[") {
      parseArray();
    } else if (text[index] === '"') {
      readString();
    } else {
      while (
        index < text.length &&
        ![",", "]", "}"].includes(text[index]) &&
        !/\s/.test(text[index])
      ) {
        index += 1;
      }
    }
  };
  const parseObject = () => {
    index += 1;
    const keys = new Set();
    skipWhitespace();
    if (text[index] === "}") {
      index += 1;
      return;
    }
    while (index < text.length) {
      skipWhitespace();
      const key = readString();
      if (keys.has(key)) {
        throw new DuplicateJsonKeyError(
          `${label}: duplicate JSON key ${JSON.stringify(key)}`,
        );
      }
      keys.add(key);
      skipWhitespace();
      index += 1;
      parseValue();
      skipWhitespace();
      if (text[index] === "}") {
        index += 1;
        return;
      }
      index += 1;
    }
  };
  const parseArray = () => {
    index += 1;
    skipWhitespace();
    if (text[index] === "]") {
      index += 1;
      return;
    }
    while (index < text.length) {
      parseValue();
      skipWhitespace();
      if (text[index] === "]") {
        index += 1;
        return;
      }
      index += 1;
    }
  };
  parseValue();
}

function parseStrictJson(text, label) {
  const value = JSON.parse(text);
  assertNoDuplicateJsonKeys(text, label);
  return value;
}

function readBounded(filePath, label, maximumBytes) {
  const absolutePath = resolve(filePath);
  const metadata = statSync(absolutePath);
  if (!metadata.isFile()) throw new Error(`${label} is not a regular file`);
  if (metadata.size > maximumBytes) {
    throw new Error(`${label} exceeds the ${maximumBytes}-byte limit`);
  }
  const bytes = readFileSync(absolutePath);
  if (bytes.length > maximumBytes) {
    throw new Error(`${label} exceeds the ${maximumBytes}-byte limit`);
  }
  return { absolutePath, bytes };
}

function parseDocuments(source, label) {
  const text = decodeUtf8(source, label).trim();
  if (!text) return [];
  try {
    const document = parseStrictJson(text, label);
    if (Array.isArray(document) && document.length > MAX_DOCUMENTS) {
      throw new JsonInputLimitError(
        `${label} exceeds the ${MAX_DOCUMENTS}-document limit`,
      );
    }
    return [document];
  } catch (error) {
    if (
      error instanceof DuplicateJsonKeyError ||
      error instanceof JsonInputLimitError
    ) {
      throw error;
    }
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    if (lines.length > MAX_DOCUMENTS) {
      throw new Error(`${label} exceeds the ${MAX_DOCUMENTS}-document limit`);
    }
    return lines.map((line, index) => {
      if (Buffer.byteLength(line, "utf8") > MAX_NDJSON_LINE_BYTES) {
        throw new Error(
          `${label}:${index + 1} exceeds the ${MAX_NDJSON_LINE_BYTES}-byte line limit`,
        );
      }
      try {
        return parseStrictJson(line, `${label}:${index + 1}`);
      } catch (error) {
        throw new Error(
          `${label}:${index + 1}: invalid JSON: ${error.message}`,
        );
      }
    });
  }
}

function inputDescriptor(value) {
  const separator = value.indexOf("=");
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error("--input requires <export-id>=<file>");
  }
  return {
    id: value.slice(0, separator),
    filePath: resolve(value.slice(separator + 1)),
  };
}

function parseInput({ id, filePath }) {
  const { bytes } = readBounded(
    filePath,
    `telemetry export ${id}`,
    MAX_EXPORT_BYTES,
  );
  return {
    id,
    sha256: sha256(bytes),
    documents: parseDocuments(bytes, filePath),
  };
}

function readJsonEvidence(filePath, label) {
  if (!filePath) return { value: null, sha256: null };
  const { bytes } = readBounded(filePath, label, MAX_EVIDENCE_BYTES);
  try {
    return {
      value: parseStrictJson(decodeUtf8(bytes, label), label),
      sha256: sha256(bytes),
    };
  } catch (error) {
    if (error.message === `${label} is not valid UTF-8`) throw error;
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function pathIdentity(filePath) {
  const absolutePath = resolve(filePath);
  let identity;
  try {
    identity = realpathSync.native(absolutePath);
  } catch {
    const parent = realpathSync.native(path.dirname(absolutePath));
    identity = path.join(parent, path.basename(absolutePath));
  }
  return process.platform === "win32" ? identity.toLowerCase() : identity;
}

function assertOutputPaths(args, inputDescriptors) {
  const evidencePaths = [
    args.coverage,
    args.exportManifest,
    args.approval,
    ...inputDescriptors.map((item) => item.filePath),
  ].filter(Boolean);
  const evidenceIdentities = new Set(evidencePaths.map(pathIdentity));
  const outputPaths = [args.out, args.markdown].filter(Boolean);
  const outputIdentities = outputPaths.map(pathIdentity);
  if (new Set(outputIdentities).size !== outputIdentities.length) {
    throw new Error("--out and --markdown must resolve to different files");
  }
  if (outputIdentities.some((identity) => evidenceIdentities.has(identity))) {
    throw new Error("output paths must not overwrite input evidence");
  }
}

function writeOutput(filePath, contents) {
  writeFileSync(resolve(filePath), contents, "utf8");
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }
  if (!args.coverage) {
    throw new Error(`--coverage is required\n\n${usage()}`);
  }
  if (!args.exportManifest) {
    throw new Error(`--export-manifest is required\n\n${usage()}`);
  }
  if (!/^[0-9a-f]{40}$/.test(args.generatorSha || "")) {
    throw new Error(
      "--generator-sha requires an exact lowercase 40-hex commit SHA",
    );
  }
  const inputDescriptors = args.inputs.map(inputDescriptor);
  if (inputDescriptors.length > MAX_INPUTS) {
    throw new Error(`--input exceeds the ${MAX_INPUTS}-partition limit`);
  }
  const inputIds = inputDescriptors.map((item) => item.id);
  if (new Set(inputIds).size !== inputIds.length) {
    throw new Error("telemetry partition ids must be unique");
  }
  const totalExportBytes = inputDescriptors.reduce(
    (total, item) => total + statSync(item.filePath).size,
    0,
  );
  if (totalExportBytes > MAX_TOTAL_EXPORT_BYTES) {
    throw new Error(
      `telemetry exports exceed the ${MAX_TOTAL_EXPORT_BYTES}-byte total limit`,
    );
  }
  assertOutputPaths(args, inputDescriptors);
  const manifest = JSON.parse(
    readFileSync(
      new URL("../src/command-manifest.json", import.meta.url),
      "utf8",
    ),
  );
  const coverage = readJsonEvidence(args.coverage, "coverage");
  const exportManifest = readJsonEvidence(
    args.exportManifest,
    "export manifest",
  );
  const approval = readJsonEvidence(args.approval, "approval");
  const telemetryExports = inputDescriptors.map(parseInput);
  const report = buildCommandLifecycleReport({
    telemetryExports,
    manifest,
    coverage: coverage.value,
    coverageSha256: coverage.sha256,
    exportManifest: exportManifest.value,
    exportManifestSha256: exportManifest.sha256,
    generatorSha: args.generatorSha,
    approval: approval.value,
    approvalSha256: approval.sha256,
    ...(args.generatedAt ? { generatedAt: args.generatedAt } : {}),
  });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = renderCommandLifecycleReportMarkdown(report);
  if (args.out) writeOutput(args.out, json);
  if (args.markdown) writeOutput(args.markdown, markdown);
  if (!args.out && !args.markdown) process.stdout.write(json);
  if (
    args.failOnIncomplete &&
    (!report.coverage.ready ||
      !report.evidence.ready ||
      !report.ingestion.ready ||
      report.summary.decisions["insufficient-data"] > 0)
  ) {
    process.exitCode = 2;
  }
} catch (error) {
  const command = path.basename(process.argv[1] || "command-lifecycle-report");
  process.stderr.write(`${command} failed: ${error.message}\n`);
  process.exitCode = 1;
}
