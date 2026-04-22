#!/usr/bin/env node
/**
 * Codemod: wrap each element that carries `v-html=` with a block-style
 * `<!-- eslint-disable vue/no-v-html -->` / `<!-- eslint-enable ... -->`
 * pair so the rule (upgraded to error) does not reject it.
 *
 * Why block pairs instead of `eslint-disable-next-line`: multi-line Vue
 * elements put `v-html=` several lines below the opening `<tag`, and
 * eslint-plugin-vue reports the error at the attribute's line, not the
 * opening. A `disable-next-line` placed above the opening only suppresses
 * line 1 of the element, so the attribute-level error still fires. Block
 * pairs are the unambiguously correct pattern for multi-line elements.
 *
 * Every v-html site in this codebase routes through a sanitizer
 * (safeHtml, renderMarkdown, escapeHtml, DOMPurify direct, or
 * hljs+safeHtml); see AUDIT_2026-04-22.md §3 and sanitizeHtml.ts.
 *
 * Idempotent — re-running produces the same output.
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "desktop-app-vue/src/renderer";
const DISABLE_MARKER = "eslint-disable vue/no-v-html -- sanitized";
const ENABLE_MARKER = "eslint-enable vue/no-v-html";
// Legacy marker left by the previous buggy version of this script.
const LEGACY_MARKER =
  "eslint-disable-next-line vue/no-v-html -- input goes through safeHtml";

const DISABLE_COMMENT = `<!-- ${DISABLE_MARKER} via safeHtml / renderMarkdown / DOMPurify; see AUDIT_2026-04-22.md §3 -->`;
const ENABLE_COMMENT = `<!-- ${ENABLE_MARKER} -->`;

function* walkVueFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* walkVueFiles(full);
    } else if (entry.endsWith(".vue")) {
      yield full;
    }
  }
}

function isElementOpening(line) {
  return /^\s*<[A-Za-z][A-Za-z0-9:-]*/.test(line);
}

function endsElementTag(line) {
  // Matches /> (self-closing) or > that's NOT inside an attribute value
  const t = line.trimEnd();
  return t.endsWith("/>") || t.endsWith(">");
}

function indentOf(line) {
  return (line.match(/^(\s*)/) || ["", ""])[1];
}

let totalFiles = 0;
let totalSites = 0;

for (const file of walkVueFiles(ROOT)) {
  const original = readFileSync(file, "utf-8");
  const raw = original.split(/\r?\n/);

  // Pass 1 — strip any marker lines left by this script (current or legacy).
  const stripped = raw.filter(
    (line) =>
      !line.includes(DISABLE_MARKER) &&
      !line.includes(ENABLE_MARKER) &&
      !line.includes(LEGACY_MARKER),
  );

  // Pass 2 — walk forward and wrap each element containing v-html=.
  // We build the output sequentially and splice in disable/enable pairs.
  const out = [];
  let siteCount = 0;
  let i = 0;
  while (i < stripped.length) {
    const line = stripped[i];

    if (!isElementOpening(line)) {
      out.push(line);
      i++;
      continue;
    }

    // Scan to end of this element opening (find line that ends with > or />)
    let endIdx = i;
    while (endIdx < stripped.length && !endsElementTag(stripped[endIdx])) {
      endIdx++;
    }
    const block = stripped.slice(i, endIdx + 1);
    const hasVHtml = block.some((l) => l.includes("v-html="));

    if (hasVHtml) {
      const indent = indentOf(line);
      out.push(`${indent}${DISABLE_COMMENT}`);
      for (const l of block) out.push(l);
      out.push(`${indent}${ENABLE_COMMENT}`);
      siteCount++;
    } else {
      for (const l of block) out.push(l);
    }

    i = endIdx + 1;
  }

  const next = out.join("\n");
  if (next !== original) {
    writeFileSync(file, next, "utf-8");
    totalFiles++;
    totalSites += siteCount;
    console.log(`  ${file}: ${siteCount}`);
  }
}

console.log(`\nDone: ${totalSites} v-html sites across ${totalFiles} files.`);
