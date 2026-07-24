#!/usr/bin/env node
/**
 * Advisory runtime schema-diff for PDH vault partial indices (trap #25).
 *
 * Complements the static regex in scripts/lint-pdh-partial-index.mjs by
 * actually executing migrations.js against a real SQLite instance, then
 * dumping `sqlite_master.sql` for each `uniq_{events,persons,places,items}_source`
 * index and verifying both the account-scoped source tuple and the
 * `WHERE source_original_id IS NOT NULL` clause are present on each.
 *
 * Catches drift the regex misses (e.g. typos like `WHERE source_original_id
 * IS_NOT NULL`, conditional construction, dead code paths that build the
 * index without WHERE).
 *
 * Strategy:
 *   1. Open plain better-sqlite3 :memory: DB.
 *   2. Run applyMigrations() to take it through v1 → v4.
 *   3. Query sqlite_master for the 4 partial indices.
 *   4. Verify each has the WHERE clause in its stored DDL.
 *   5. Run the drift-fix scenario: open a fresh DB, manually create the OLD
 *      (non-partial) index, then run migrations and verify v4 DROP+CREATE
 *      replaced it with the partial version.
 *
 * Plain better-sqlite3 (not bs3mc) is intentional — partial-index semantics
 * are pure SQLite, no encryption layer is needed, and bs3mc has ABI 140
 * issues outside Electron (see memory bs3mc_electron_abi_sandbox_workaround).
 *
 * Advisory: runs in CI as continue-on-error. Failure does not block merge,
 * just posts a $GITHUB_STEP_SUMMARY note. Mandatory enforcement stays with
 * the static regex.
 *
 * See:
 *   docs/internal/hidden-risk-traps.md  (#25)
 *   memory pdh_partial_index_if_not_exists_drift.md
 *   packages/personal-data-hub/lib/migrations.js  (v4 at lines 370–392)
 */
import { createRequire } from "module";
import { resolve } from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(__filename, "..", "..");

const EXPECTED_TABLES = ["events", "persons", "places", "items"];
const WHERE_CLAUSE_RE = /WHERE\s+source_original_id\s+IS\s+NOT\s+NULL/i;
const SCOPED_SOURCE_TUPLE_RE =
  /\(\s*source_adapter\s*,\s*source_scope\s*,\s*source_original_id\s*\)/i;

function loadBetterSqlite3() {
  try {
    return require("better-sqlite3");
  } catch (err) {
    console.error(`✘ Cannot require('better-sqlite3'): ${err.message}`);
    console.error(`  Install with: npm install better-sqlite3 --no-save`);
    process.exit(2);
  }
}

function loadMigrations() {
  const p = resolve(REPO_ROOT, "packages/personal-data-hub/lib/migrations.js");
  try {
    return require(p);
  } catch (err) {
    console.error(`✘ Cannot require('${p}'): ${err.message}`);
    process.exit(2);
  }
}

/**
 * Inspect sqlite_master for the 4 partial unique indices.
 * Returns { name → ddl } map (ddl is the raw string SQLite stored).
 */
function fetchPartialIndexDdls(db) {
  const rows = db
    .prepare(
      "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name LIKE 'uniq_%_source'",
    )
    .all();
  const out = Object.create(null);
  for (const r of rows) out[r.name] = r.sql || "";
  return out;
}

function verifyAllPartial(ddls, label) {
  const failures = [];
  for (const t of EXPECTED_TABLES) {
    const name = `uniq_${t}_source`;
    const ddl = ddls[name];
    if (!ddl) {
      failures.push(`${label}: index ${name} missing entirely`);
      continue;
    }
    if (!WHERE_CLAUSE_RE.test(ddl)) {
      failures.push(
        `${label}: index ${name} DDL missing 'WHERE source_original_id IS NOT NULL':\n    ${ddl}`,
      );
    }
    if (!SCOPED_SOURCE_TUPLE_RE.test(ddl)) {
      failures.push(
        `${label}: index ${name} is not account-scoped by ` +
          "(source_adapter, source_scope, source_original_id):\n" +
          `    ${ddl}`,
      );
    }
  }
  return failures;
}

// ── Scenario A: fresh vault → all 4 indices partial ────────────────────────

function scenarioFreshVault(BetterSqlite3, applyMigrations) {
  console.log(
    "Scenario A: fresh vault, run migrations → expect partial indices",
  );
  const db = new BetterSqlite3(":memory:");
  try {
    applyMigrations(db);
    const ddls = fetchPartialIndexDdls(db);
    const failures = verifyAllPartial(ddls, "fresh-vault");
    for (const [name, ddl] of Object.entries(ddls)) {
      console.log(`  ${name}: ${ddl.replace(/\s+/g, " ")}`);
    }
    return failures;
  } finally {
    db.close();
  }
}

// ── Scenario B: drift fix — old non-partial index → migration v4 replaces ──

function scenarioDriftFix(BetterSqlite3, applyMigrations) {
  console.log("");
  console.log(
    "Scenario B: simulated pre-v4 vault drift → migrations.v4 replaces non-partial",
  );
  const db = new BetterSqlite3(":memory:");
  try {
    // Build the base tables (mirrors migration v1 just enough for index creation).
    for (const t of [...EXPECTED_TABLES, "topics"]) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS ${t} (
          id TEXT PRIMARY KEY,
          source_adapter TEXT NOT NULL,
          source_original_id TEXT,
          extra TEXT
        )
      `);
    }
    db.exec(`
      CREATE TABLE raw_events (
        adapter TEXT NOT NULL,
        original_id TEXT NOT NULL,
        captured_at INTEGER NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (adapter, original_id)
      )
    `);
    // Stamp _meta to "version 3" so migrations.applyMigrations runs only v4.
    db.exec(
      `CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)`,
    );
    db.prepare(
      `INSERT INTO _meta (key, value, updated_at) VALUES ('schema_version', '3', ?)`,
    ).run(Date.now());

    // Create the OLD (non-partial) index for each table — this is what a
    // pre-44c4188a8 vault has on disk.
    for (const t of EXPECTED_TABLES) {
      db.exec(
        `CREATE UNIQUE INDEX uniq_${t}_source ON ${t}(source_adapter, source_original_id)`,
      );
    }

    // Snapshot the drift state.
    const before = fetchPartialIndexDdls(db);
    console.log("  pre-migration DDLs (should NOT have WHERE):");
    for (const [name, ddl] of Object.entries(before)) {
      console.log(`    ${name}: ${ddl.replace(/\s+/g, " ")}`);
    }
    const stillNonPartial = Object.entries(before).filter(
      ([, ddl]) => !WHERE_CLAUSE_RE.test(ddl),
    );
    if (stillNonPartial.length !== EXPECTED_TABLES.length) {
      return [
        `drift-fix scenario setup error: expected ${EXPECTED_TABLES.length} non-partial indices, got ${stillNonPartial.length}`,
      ];
    }

    // Apply migrations — v4 should DROP + CREATE all 4 as partial.
    applyMigrations(db);

    const after = fetchPartialIndexDdls(db);
    console.log("  post-migration DDLs (MUST have WHERE):");
    for (const [name, ddl] of Object.entries(after)) {
      console.log(`    ${name}: ${ddl.replace(/\s+/g, " ")}`);
    }
    return verifyAllPartial(after, "drift-fix");
  } finally {
    db.close();
  }
}

// ── Entry ──────────────────────────────────────────────────────────────────

const BetterSqlite3 = loadBetterSqlite3();
const { applyMigrations } = loadMigrations();

const allFailures = [];
try {
  allFailures.push(...scenarioFreshVault(BetterSqlite3, applyMigrations));
  allFailures.push(...scenarioDriftFix(BetterSqlite3, applyMigrations));
} catch (err) {
  console.error("");
  console.error(`✘ schema runtime check threw: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
}

console.log("");
if (allFailures.length === 0) {
  console.log(
    "✓ PDH partial-index runtime schema check passed (both scenarios).",
  );
  process.exit(0);
}

console.error(
  `✘ PDH partial-index runtime schema check FAILED (${allFailures.length} issue${allFailures.length === 1 ? "" : "s"}):`,
);
for (const f of allFailures) console.error(`  - ${f}`);
console.error("");
console.error("Trap #25: see docs/internal/hidden-risk-traps.md and memory");
console.error("pdh_partial_index_if_not_exists_drift.md. Static regex in");
console.error("scripts/lint-pdh-partial-index.mjs gates the source text; this");
console.error("runtime check catches semantic drift the regex misses.");
process.exit(1);
