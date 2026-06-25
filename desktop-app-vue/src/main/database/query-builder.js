/**
 * @module database/query-builder
 * Phase 80: Fluent query builder for SQLite (reduces raw SQL)
 */
const { logger } = require("../utils/logger.js");
const SqlSecurity = require("./sql-security.js");

// Values are always parameterized (`?`), but identifiers (table/column/join
// targets) and operators are interpolated straight into the SQL string. A
// sort field or filter column that flows in from the UI is a classic SQL
// injection vector, so every identifier passed to a setter is validated here.
//
// The allowlist permits the legitimate identifier surface this builder
// produces — plain and dotted names (`created_at`, `users.id`), `*`, and
// simple aggregate expressions like `COUNT(*) as count` — while rejecting any
// SQL metacharacter (`;`, quotes, `--`, `/* */`, backslash, etc.). A
// defense-in-depth keyword blocklist (shared with SqlSecurity) additionally
// catches `UNION SELECT`/stacked statements that happen to fit the charset.
const SAFE_IDENTIFIER = /^[A-Za-z0-9_.*\s(),]+$/;
// Parentheses are allowed so aggregates like `COUNT(*)` work, which would
// otherwise let a `(SELECT ...)` subquery through the charset. No legitimate
// column or alias contains these statement keywords as a whole word
// (snake_case names like `from_user` are safe thanks to the `\b` boundary).
const FORBIDDEN_IDENTIFIER_KEYWORD =
  /\b(SELECT|FROM|WHERE|UNION|JOIN|INTO|DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|EXEC|EXECUTE|PRAGMA|ATTACH|DETACH|HAVING)\b/i;
const SAFE_OPERATORS = new Set([
  "=",
  "!=",
  "<>",
  "<",
  ">",
  "<=",
  ">=",
  "LIKE",
  "NOT LIKE",
  "IS",
  "IS NOT",
  "IN",
  "NOT IN",
  "GLOB",
]);

function assertSafeIdentifier(value, kind = "identifier") {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid ${kind}: must be a non-empty string`);
  }
  if (value.length > 256) {
    throw new Error(`Invalid ${kind}: exceeds maximum length`);
  }
  if (
    !SAFE_IDENTIFIER.test(value) ||
    FORBIDDEN_IDENTIFIER_KEYWORD.test(value) ||
    SqlSecurity.containsSqlInjectionPattern(value)
  ) {
    throw new Error(`Invalid ${kind}: ${value}`);
  }
  return value;
}

function assertSafeOperator(operator) {
  const op = String(operator).trim();
  if (!SAFE_OPERATORS.has(op.toUpperCase())) {
    throw new Error(`Invalid SQL operator: ${operator}`);
  }
  return op;
}

function assertSafeDirection(direction) {
  const dir = String(direction).trim().toUpperCase();
  if (dir !== "ASC" && dir !== "DESC") {
    throw new Error(`Invalid sort direction: ${direction}`);
  }
  return dir;
}

class QueryBuilder {
  constructor(db) {
    this.db = db;
    this._table = null;
    this._operation = null;
    this._columns = ["*"];
    this._wheres = [];
    this._params = [];
    this._orderBy = [];
    this._limit = null;
    this._offset = null;
    this._joins = [];
    this._groupBy = [];
    this._having = null;
    this._values = null;
    this._updates = null;
  }

  static from(db) {
    return new QueryBuilder(db);
  }

  table(name) {
    this._table = assertSafeIdentifier(name, "table name");
    return this;
  }

  select(...columns) {
    this._operation = "SELECT";
    if (columns.length > 0) {
      this._columns = columns.map((c) => assertSafeIdentifier(c, "column"));
    }
    return this;
  }

  insert(data) {
    this._operation = "INSERT";
    for (const key of Object.keys(data || {})) {
      assertSafeIdentifier(key, "column");
    }
    this._values = data;
    return this;
  }

  update(data) {
    this._operation = "UPDATE";
    for (const key of Object.keys(data || {})) {
      assertSafeIdentifier(key, "column");
    }
    this._updates = data;
    return this;
  }

  deleteFrom() {
    this._operation = "DELETE";
    return this;
  }

  where(column, operator, value) {
    if (value === undefined) {
      value = operator;
      operator = "=";
    }
    assertSafeIdentifier(column, "column");
    operator = assertSafeOperator(operator);
    this._wheres.push({ column, operator, value, logic: "AND" });
    this._params.push(value);
    return this;
  }

  orWhere(column, operator, value) {
    if (value === undefined) {
      value = operator;
      operator = "=";
    }
    assertSafeIdentifier(column, "column");
    operator = assertSafeOperator(operator);
    this._wheres.push({ column, operator, value, logic: "OR" });
    this._params.push(value);
    return this;
  }

  whereIn(column, values) {
    assertSafeIdentifier(column, "column");
    // `col IN ()` is a SQL syntax error (SQLite rejects it). An empty set
    // matches nothing, so emit an always-false predicate instead of crashing.
    if (!Array.isArray(values) || values.length === 0) {
      this._wheres.push({ raw: "1 = 0", logic: "AND" });
      return this;
    }
    const placeholders = values.map(() => "?").join(", ");
    this._wheres.push({ raw: `${column} IN (${placeholders})`, logic: "AND" });
    this._params.push(...values);
    return this;
  }

  whereNull(column) {
    assertSafeIdentifier(column, "column");
    this._wheres.push({ raw: `${column} IS NULL`, logic: "AND" });
    return this;
  }

  whereNotNull(column) {
    assertSafeIdentifier(column, "column");
    this._wheres.push({ raw: `${column} IS NOT NULL`, logic: "AND" });
    return this;
  }

  join(table, leftCol, rightCol) {
    assertSafeIdentifier(table, "join table");
    assertSafeIdentifier(leftCol, "join column");
    assertSafeIdentifier(rightCol, "join column");
    this._joins.push({ type: "JOIN", table, leftCol, rightCol });
    return this;
  }

  leftJoin(table, leftCol, rightCol) {
    assertSafeIdentifier(table, "join table");
    assertSafeIdentifier(leftCol, "join column");
    assertSafeIdentifier(rightCol, "join column");
    this._joins.push({ type: "LEFT JOIN", table, leftCol, rightCol });
    return this;
  }

  orderBy(column, direction = "ASC") {
    assertSafeIdentifier(column, "column");
    this._orderBy.push({ column, direction: assertSafeDirection(direction) });
    return this;
  }

  groupBy(...columns) {
    this._groupBy = columns.map((c) => assertSafeIdentifier(c, "column"));
    return this;
  }

  limit(n) {
    this._limit = n;
    return this;
  }

  offset(n) {
    this._offset = n;
    return this;
  }

  count(column = "*") {
    this._operation = "SELECT";
    assertSafeIdentifier(column, "column");
    this._columns = [`COUNT(${column}) as count`];
    return this;
  }

  buildSQL() {
    if (!this._table) {
      throw new Error("Table not specified");
    }
    if (!this._operation) {
      throw new Error("Operation not specified");
    }

    let sql = "";
    let params = [];

    switch (this._operation) {
      case "SELECT": {
        sql = `SELECT ${this._columns.join(", ")} FROM ${this._table}`;
        for (const join of this._joins) {
          sql += ` ${join.type} ${join.table} ON ${join.leftCol} = ${join.rightCol}`;
        }
        break;
      }
      case "INSERT": {
        const keys = Object.keys(this._values);
        const placeholders = keys.map(() => "?").join(", ");
        sql = `INSERT INTO ${this._table} (${keys.join(", ")}) VALUES (${placeholders})`;
        params = Object.values(this._values);
        break;
      }
      case "UPDATE": {
        const sets = Object.keys(this._updates)
          .map((k) => `${k} = ?`)
          .join(", ");
        sql = `UPDATE ${this._table} SET ${sets}`;
        params = Object.values(this._updates);
        break;
      }
      case "DELETE": {
        sql = `DELETE FROM ${this._table}`;
        break;
      }
    }

    // WHERE clause
    if (this._wheres.length > 0) {
      const whereParts = this._wheres.map((w, i) => {
        const prefix = i === 0 ? "" : ` ${w.logic} `;
        if (w.raw) {
          return `${prefix}${w.raw}`;
        }
        return `${prefix}${w.column} ${w.operator} ?`;
      });
      sql += ` WHERE ${whereParts.join("")}`;
      params = [...params, ...this._params];
    }

    // GROUP BY
    if (this._groupBy.length > 0) {
      sql += ` GROUP BY ${this._groupBy.join(", ")}`;
    }

    // ORDER BY
    if (this._orderBy.length > 0) {
      sql += ` ORDER BY ${this._orderBy.map((o) => `${o.column} ${o.direction}`).join(", ")}`;
    }

    // LIMIT + OFFSET
    if (this._limit !== null) {
      sql += ` LIMIT ${this._limit}`;
    }
    if (this._offset !== null) {
      sql += ` OFFSET ${this._offset}`;
    }

    return { sql, params };
  }

  execute() {
    const { sql, params } = this.buildSQL();
    try {
      const stmt = this.db.prepare(sql);
      if (this._operation === "SELECT") {
        return params.length > 0 ? stmt.all(...params) : stmt.all();
      }
      return params.length > 0 ? stmt.run(...params) : stmt.run();
    } catch (error) {
      logger.error(`[QueryBuilder] Query failed: ${sql}`, error.message);
      throw error;
    }
  }

  first() {
    this._limit = 1;
    const { sql, params } = this.buildSQL();
    try {
      const stmt = this.db.prepare(sql);
      return params.length > 0 ? stmt.get(...params) : stmt.get();
    } catch (error) {
      logger.error(`[QueryBuilder] Query failed: ${sql}`, error.message);
      throw error;
    }
  }
}

module.exports = { QueryBuilder };
