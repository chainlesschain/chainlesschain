#!/usr/bin/env node
/**
 * Generate (or byte-diff-check) the agent protocol capability manifest doc from
 * the ONE canonical source — `capability-manifest.js` `renderProtocolDoc()` —
 * closing the last open item of P1-9 in
 * docs/CLAUDE_CODE_IDE_INCREMENTAL_GAP_ANALYSIS_2026-07-13.md
 * ("renderProtocolDoc 接进 CI byte-diff 签入副本").
 *
 * The protocol capability surface (negotiable wire features + permission modes)
 * is projected from CAPABILITY_MANIFEST; a checked-in Markdown copy lets humans
 * browse it and lets CI byte-diff it against the code so a v2 wire field added
 * to the manifest but not regenerated here fails the check.
 *
 * Usage:
 *   node scripts/gen-protocol-doc.mjs                 # print doc markdown
 *   node scripts/gen-protocol-doc.mjs --out doc.md    # write doc markdown
 *   node scripts/gen-protocol-doc.mjs --check doc.md  # exit 1 if the doc drifts
 *
 * Mirrors gen-cli-reference.mjs. The doc lives under docs/cli/ (not
 * packages/cli/, which is prettier-managed and .md-ignored) so no formatter
 * reshapes it and the byte compare stays valid.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { renderProtocolDoc } from "../src/lib/capability-manifest.js";

function main(argv) {
  const args = argv.slice(2);
  const md = renderProtocolDoc();

  const checkIdx = args.indexOf("--check");
  if (checkIdx !== -1) {
    const docPath = args[checkIdx + 1];
    if (!docPath) {
      process.stderr.write("--check requires a doc path\n");
      process.exit(2);
    }
    let current;
    try {
      current = readFileSync(docPath, "utf-8");
    } catch (err) {
      process.stderr.write(
        `Cannot read ${docPath}: ${err.message}\n` +
          "Run `npm run docs:protocol` to generate it.\n",
      );
      process.exit(1);
    }
    if (current === md) {
      process.stdout.write(`No drift: ${docPath} matches the manifest.\n`);
      process.exit(0);
    }
    process.stderr.write(
      `Protocol doc drift in ${docPath}.\n` +
        "The generated capability manifest no longer matches the checked-in copy.\n" +
        "Run `npm run docs:protocol` to regenerate it.\n",
    );
    process.exit(1);
  }

  const outIdx = args.indexOf("--out");
  if (outIdx !== -1 && args[outIdx + 1]) {
    writeFileSync(args[outIdx + 1], md, "utf-8");
    process.stdout.write(`Wrote ${args[outIdx + 1]}\n`);
  } else {
    process.stdout.write(md);
  }
}

main(process.argv);
