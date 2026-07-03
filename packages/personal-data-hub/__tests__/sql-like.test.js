"use strict";

import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";

const { escapeLike, likePrefix, likeContains } = require("../lib/sql-like");

describe("sql-like", () => {
  describe("escapeLike", () => {
    it("escapes % _ and \\ so they match literally", () => {
      expect(escapeLike("a%b_c\\d")).toBe("a\\%b\\_c\\\\d");
    });

    it("leaves ordinary text untouched", () => {
      expect(escapeLike("did:chainless:AbC-123")).toBe("did:chainless:AbC-123");
    });

    it("coerces null/undefined to empty string", () => {
      expect(escapeLike(null)).toBe("");
      expect(escapeLike(undefined)).toBe("");
    });
  });

  it("likePrefix appends a trailing wildcard to the escaped value", () => {
    expect(likePrefix("a_b")).toBe("a\\_b%");
  });

  it("likeContains wraps the escaped value in wildcards", () => {
    expect(likeContains("a%b")).toBe("%a\\%b%");
  });

  // Behaviour against a real SQLite engine: escaped metachars must be literal
  // when paired with ESCAPE '\', and injection attempts must not match-all.
  describe("against SQLite LIKE ? ESCAPE '\\'", () => {
    const rows = ["report_2024", "reportX2024", "50% off", "plain"];

    function run(pattern) {
      const d = new Database(":memory:");
      d.exec("CREATE TABLE t (v TEXT)");
      for (const v of rows) d.prepare("INSERT INTO t VALUES (?)").run(v);
      const out = d
        .prepare("SELECT v FROM t WHERE v LIKE ? ESCAPE '\\'")
        .all(pattern)
        .map((r) => r.v);
      d.close();
      return out;
    }

    it("literal underscore does not wildcard", () => {
      expect(run(likeContains("report_2024"))).toEqual(["report_2024"]);
    });

    it("literal percent matches only the literal", () => {
      expect(run(likeContains("50%"))).toEqual(["50% off"]);
    });

    it("a bare % injection cannot match-all (only the literal-% row)", () => {
      // Old unescaped `%%%` matched every row; escaped, searching "%" finds
      // only rows that literally contain a percent sign.
      expect(run(likeContains("%"))).toEqual(["50% off"]);
    });

    it("prefix match still resolves legitimately", () => {
      expect(run(likePrefix("report")).sort()).toEqual(
        ["reportX2024", "report_2024"].sort(),
      );
    });
  });
});
