#!/usr/bin/env node
/**
 * Generate the canonical CLI reference from the authoritative sources
 * (command-manifest.json + the AGENT_TOOLS registry), or check a hand-written
 * doc against them for drift (P2 "文档").
 *
 * Usage:
 *   node scripts/gen-cli-reference.mjs                 # print reference markdown
 *   node scripts/gen-cli-reference.mjs --out ref.md    # write reference markdown
 *   node scripts/gen-cli-reference.mjs --check doc.md  # exit 1 if doc drifts
 *
 * Deliberately NOT wired into a committed doc artifact: it's a tool. Run
 * `--check` in CI against whatever doc you consider authoritative to fail on
 * command / tool / flag / exit-code / protocol-field drift.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import {
  buildCliReference,
  renderReferenceMarkdown,
  detectDocDrift,
} from "../src/lib/docs-drift.js";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function loadSources() {
  const manifest = JSON.parse(
    readFileSync(join(here, "..", "src", "command-manifest.json"), "utf-8"),
  );
  const { listCodingAgentToolNames } = require(
    "../src/runtime/coding-agent-contract-shared.cjs",
  );
  const tools = listCodingAgentToolNames();
  return { manifest, tools };
}

function main(argv) {
  const args = argv.slice(2);
  const { manifest, tools } = loadSources();

  const checkIdx = args.indexOf("--check");
  if (checkIdx !== -1) {
    const docPath = args[checkIdx + 1];
    if (!docPath) {
      process.stderr.write("--check requires a doc path\n");
      process.exit(2);
    }
    const doc = readFileSync(docPath, "utf-8");
    const drift = detectDocDrift({ manifest, tools, doc });
    if (drift.ok) {
      process.stdout.write(`No drift: ${docPath} matches the manifest.\n`);
      process.exit(0);
    }
    process.stderr.write(`Doc drift in ${docPath}:\n`);
    if (drift.undocumentedCommands.length) {
      process.stderr.write(
        `  undocumented commands: ${drift.undocumentedCommands.join(", ")}\n`,
      );
    }
    if (drift.undocumentedTools.length) {
      process.stderr.write(
        `  undocumented tools: ${drift.undocumentedTools.join(", ")}\n`,
      );
    }
    if (drift.staleCommandMentions.length) {
      process.stderr.write(
        `  stale command mentions: ${drift.staleCommandMentions.join(", ")}\n`,
      );
    }
    process.exit(1);
  }

  const md = renderReferenceMarkdown(buildCliReference({ manifest, tools }));
  const outIdx = args.indexOf("--out");
  if (outIdx !== -1 && args[outIdx + 1]) {
    writeFileSync(args[outIdx + 1], md, "utf-8");
    process.stdout.write(`Wrote ${args[outIdx + 1]}\n`);
  } else {
    process.stdout.write(md);
  }
}

main(process.argv);
