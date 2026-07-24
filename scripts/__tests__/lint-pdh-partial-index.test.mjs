/**
 * Tests for scripts/lint-pdh-partial-index.mjs (hidden-risk-traps #25).
 *
 * Confirms findViolations() catches drift (CREATE UNIQUE INDEX on
 * (source_adapter, source_original_id) missing WHERE source_original_id IS
 * NOT NULL) and ignores correctly-partial indices including the migration
 * v4 string-concat pattern.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { findViolations } from "../lint-pdh-partial-index.mjs";

test("flags CREATE UNIQUE INDEX missing WHERE clause", () => {
  const bad =
    "`CREATE UNIQUE INDEX IF NOT EXISTS uniq_events_source ON events(source_adapter, source_original_id)`,";
  assert.equal(findViolations(bad).length, 1);
});

test("accepts CREATE UNIQUE INDEX with WHERE on same line", () => {
  const good =
    "`CREATE UNIQUE INDEX IF NOT EXISTS uniq_events_source ON events(source_adapter, source_original_id) WHERE source_original_id IS NOT NULL`,";
  assert.equal(findViolations(good).length, 0);
});

test("accepts CREATE UNIQUE INDEX with WHERE on next line", () => {
  const good =
    "`CREATE UNIQUE INDEX IF NOT EXISTS uniq_events_source ON events(source_adapter, source_original_id)\n" +
    "  WHERE source_original_id IS NOT NULL`,";
  assert.equal(findViolations(good).length, 0);
});

test("flags scoped source index missing WHERE clause", () => {
  const bad =
    "`CREATE UNIQUE INDEX uniq_events_source ON events" +
    "(source_adapter, source_scope, source_original_id)`";
  assert.equal(findViolations(bad).length, 1);
});

test("accepts scoped source index with partial WHERE clause", () => {
  const good =
    "`CREATE UNIQUE INDEX uniq_events_source ON events" +
    "(source_adapter, source_scope, source_original_id) " +
    "WHERE source_original_id IS NOT NULL`";
  assert.equal(findViolations(good).length, 0);
});

test("accepts string-concat pattern (migration v4)", () => {
  const good =
    "`CREATE UNIQUE INDEX uniq_events_source ON events(source_adapter, source_original_id) ` + " +
    "`WHERE source_original_id IS NOT NULL`";
  assert.equal(findViolations(good).length, 0);
});

test("ignores non-source_adapter indices", () => {
  const irrelevant =
    "`CREATE UNIQUE INDEX idx_users_email ON users(email)`," +
    "`CREATE INDEX idx_foo ON bar(baz)`,";
  assert.equal(findViolations(irrelevant).length, 0);
});

test("catches multiple violations independently", () => {
  const bad =
    "`CREATE UNIQUE INDEX uniq_events_source ON events(source_adapter, source_original_id)`," +
    "`CREATE UNIQUE INDEX uniq_items_source ON items(source_adapter, source_original_id)`,";
  assert.equal(findViolations(bad).length, 2);
});

test("violation snippet truncates to ≤120 chars", () => {
  const longBad =
    "`CREATE UNIQUE INDEX " +
    "x".repeat(50) +
    "_source ON events(source_adapter, source_original_id)`,";
  const v = findViolations(longBad);
  assert.equal(v.length, 1);
  assert.ok(v[0].snippet.length <= 120);
});

test("reports correct line number for violation", () => {
  const src =
    "// line 1\n" +
    "// line 2\n" +
    "`CREATE UNIQUE INDEX uniq_events_source ON events(source_adapter, source_original_id)`,";
  const v = findViolations(src);
  assert.equal(v.length, 1);
  assert.equal(v[0].line, 3);
});
