"use strict";

/**
 * Pure-JS unit tests for the search SQL fragment builders in vault.js.
 * Runs without the native bs3mc binding so it works on any Node ABI
 * (the integration-level tests in vault-search.test.js need a working
 * native binding and only run in CI).
 */

import { describe, it, expect } from "vitest";

const { _searchHelpers } = require("../lib/vault");
const { _categoryToWhere, _quoteFtsQuery, FTS5_MIN_QUERY_LEN } = _searchHelpers;

describe("_quoteFtsQuery", () => {
  it("wraps a plain string in FTS5 phrase quotes", () => {
    expect(_quoteFtsQuery("hello")).toBe('"hello"');
  });

  it("doubles embedded double quotes (FTS5 escape rule)", () => {
    expect(_quoteFtsQuery('he said "hi"')).toBe('"he said ""hi"""');
  });

  it("preserves CJK as-is", () => {
    expect(_quoteFtsQuery("支付宝订单")).toBe('"支付宝订单"');
  });

  it("does not interpret FTS5 operators (OR/AND/NEAR — they're inside quotes)", () => {
    // The whole input is wrapped in phrase quotes, so OR is literal text
    expect(_quoteFtsQuery("a OR b")).toBe('"a OR b"');
  });

  it("FTS5_MIN_QUERY_LEN matches trigram tokenizer requirement", () => {
    expect(FTS5_MIN_QUERY_LEN).toBe(3);
  });
});

describe("_categoryToWhere", () => {
  it("returns sql=null for empty/null category (caller skips filter)", () => {
    expect(_categoryToWhere(null)).toEqual({ sql: null, params: {} });
    expect(_categoryToWhere("")).toEqual({ sql: null, params: {} });
    expect(_categoryToWhere(undefined)).toEqual({ sql: null, params: {} });
  });

  it("returns '0=1' for unknown category (no rules match)", () => {
    const r = _categoryToWhere("not-a-real-category");
    expect(r.sql).toBe("0=1");
    expect(r.params).toEqual({});
  });

  it("translates 'chat' to wechat-exact + messaging-prefix OR", () => {
    const r = _categoryToWhere("chat");
    expect(r.sql).toMatch(/source_adapter = @cat\d/);
    expect(r.sql).toMatch(/source_adapter LIKE @cat\d/);
    expect(Object.values(r.params)).toEqual(
      expect.arrayContaining(["wechat", "messaging-%"])
    );
  });

  it("translates 'social' to a single LIKE 'social-%' condition", () => {
    const r = _categoryToWhere("social");
    expect(r.sql).toMatch(/source_adapter LIKE @cat0/);
    expect(r.params).toEqual({ cat0: "social-%" });
  });

  it("translates 'shopping' to shopping-% OR alipay-%", () => {
    const r = _categoryToWhere("shopping");
    const vals = Object.values(r.params).sort();
    expect(vals).toEqual(["alipay-%", "shopping-%"]);
    expect(r.sql).toMatch(/OR/);
  });

  it("translates 'system' to system-data prefix", () => {
    const r = _categoryToWhere("system");
    expect(r.params).toEqual({ cat0: "system-data%" });
  });

  it("translates 'other' to NOT-IN-any-prefix (negation form)", () => {
    const r = _categoryToWhere("other");
    expect(r.sql).toMatch(/NOT LIKE @cat\d/);
    expect(r.sql).toMatch(/AND/);
    // Should reference every prefix rule
    expect(Object.keys(r.params).length).toBeGreaterThan(5);
  });

  it("supports custom param prefix to avoid collisions in compound queries", () => {
    const r = _categoryToWhere("social", "xx");
    expect(Object.keys(r.params)[0]).toMatch(/^xx/);
  });
});
