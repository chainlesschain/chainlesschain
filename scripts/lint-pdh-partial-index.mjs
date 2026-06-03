#!/usr/bin/env node
/**
 * Lint: PDH partial unique-index drift (hidden-risk-traps #25).
 *
 * Failure mode: `CREATE UNIQUE INDEX IF NOT EXISTS ... ON <t>(source_adapter, source_original_id)`
 * without `WHERE source_original_id IS NOT NULL` makes UPSERTs in vault.js
 * silently fail to find conflicts on NULL source_original_id rows → putEvent
 * keeps inserting duplicates → events table appears empty / stale while
 * raw_events accumulates. The `IF NOT EXISTS` masks schema drift across
 * upgrades (old index lingers, new SQL is no-op, two installs end up with
 * different actual indexes).
 *
 * Rule: when source text contains the column tuple
 * `(source_adapter, source_original_id)` *immediately after* `CREATE UNIQUE
 * INDEX ... ON ...`, the WHERE clause `WHERE source_original_id IS NOT NULL`
 * must appear within 300 chars of the tuple. This tolerates the SQL split
 * across multiple template-literal concatenations (`...) ` + `WHERE ...`).
 *
 * See memory: pdh_partial_index_if_not_exists_drift.md
 *             docs/internal/hidden-risk-traps.md (#25)
 */
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const FILES = [
  "packages/personal-data-hub/lib/migrations.js",
  "packages/personal-data-hub/lib/vault.js",
];

const TUPLE_RE =
  /CREATE\s+UNIQUE\s+INDEX[\s\S]{1,200}?\(\s*source_adapter\s*,\s*source_original_id\s*\)/gi;
const WHERE_RE = /WHERE\s+source_original_id\s+IS\s+NOT\s+NULL/i;

/**
 * Find partial-index violations in source text.
 * Returns array of { line, snippet }.
 */
export function findViolations(src) {
  const violations = [];
  let m;
  TUPLE_RE.lastIndex = 0;
  while ((m = TUPLE_RE.exec(src)) !== null) {
    const tailStart = m.index + m[0].length;
    const tail = src.slice(tailStart, tailStart + 300);
    if (!WHERE_RE.test(tail)) {
      let line = 1;
      for (let i = 0; i < m.index; i++) if (src[i] === "\n") line++;
      const snippet = m[0].replace(/\s+/g, " ").slice(0, 120);
      violations.push({ line, snippet });
    }
  }
  return violations;
}

function scan(filePath) {
  if (!existsSync(filePath)) return [];
  return findViolations(readFileSync(filePath, "utf-8")).map((v) => ({
    file: filePath,
    ...v,
  }));
}

// CLI entry — skip when imported as a module (e.g. by tests).
const __filename = fileURLToPath(import.meta.url);
const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(__filename);

if (isMain) {
  let total = 0;
  for (const rel of FILES) {
    const abs = resolve(process.cwd(), rel);
    const v = scan(abs);
    if (v.length) {
      total += v.length;
      for (const { file, line, snippet } of v) {
        console.error(
          `\x1b[31m✘ ${file}:${line}\x1b[0m partial-index missing WHERE clause:`,
        );
        console.error(`  ${snippet}${snippet.length === 120 ? "..." : ""}`);
      }
    }
  }

  if (total > 0) {
    console.error("");
    console.error(
      "Trap #25: `CREATE UNIQUE INDEX IF NOT EXISTS ... (source_adapter,",
    );
    console.error(
      "source_original_id)` without `WHERE source_original_id IS NOT NULL`",
    );
    console.error(
      "causes vault UPSERT to silently fail. Fix: append the WHERE clause,",
    );
    console.error(
      "or if intentionally non-partial, refactor the UPSERT to drop ON",
    );
    console.error(
      "CONFLICT. See memory pdh_partial_index_if_not_exists_drift.md",
    );
    process.exit(1);
  }

  console.log(
    `PDH partial-index lint: ${FILES.length} file(s) scanned, no violations.`,
  );
}
// Suppress unused warning when not main.
void dirname;
