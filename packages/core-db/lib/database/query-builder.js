/**
 * @module core-db/query-builder
 * Fluent query builder for SQLite (reduces raw SQL)
 *
 * Extracted from desktop-app-vue/src/main/database/query-builder.js
 */
const { getLogger } = require("../logger-adapter.js");

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
    this._table = name;
    return this;
  }

  select(...columns) {
    this._operation = "SELECT";
    if (columns.length > 0) {
      this._columns = columns;
    }
    return this;
  }

  insert(data) {
    this._operation = "INSERT";
    this._values = data;
    return this;
  }

  update(data) {
    this._operation = "UPDATE";
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
    this._wheres.push({ column, operator, value, logic: "AND" });
    this._params.push(value);
    return this;
  }

  orWhere(column, operator, value) {
    if (value === undefined) {
      value = operator;
      operator = "=";
    }
    this._wheres.push({ column, operator, value, logic: "OR" });
    this._params.push(value);
    return this;
  }

  whereIn(column, values) {
    const placeholders = values.map(() => "?").join(", ");
    this._wheres.push({ raw: `${column} IN (${placeholders})`, logic: "AND" });
    this._params.push(...values);
    return this;
  }

  whereNull(column) {
    this._wheres.push({ raw: `${column} IS NULL`, logic: "AND" });
    return this;
  }

  whereNotNull(column) {
    this._wheres.push({ raw: `${column} IS NOT NULL`, logic: "AND" });
    return this;
  }

  join(table, leftCol, rightCol) {
    this._joins.push({ type: "JOIN", table, leftCol, rightCol });
    return this;
  }

  leftJoin(table, leftCol, rightCol) {
    this._joins.push({ type: "LEFT JOIN", table, leftCol, rightCol });
    return this;
  }

  orderBy(column, direction = "ASC") {
    this._orderBy.push({ column, direction: direction.toUpperCase() });
    return this;
  }

  groupBy(...columns) {
    this._groupBy = columns;
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

    if (this._groupBy.length > 0) {
      sql += ` GROUP BY ${this._groupBy.join(", ")}`;
    }

    if (this._orderBy.length > 0) {
      sql += ` ORDER BY ${this._orderBy.map((o) => `${o.column} ${o.direction}`).join(", ")}`;
    }

    if (this._limit !== null) {
      sql += ` LIMIT ${this._limit}`;
    }
    if (this._offset !== null) {
      sql += ` OFFSET ${this._offset}`;
    }

    return { sql, params };
  }

  execute() {
    const logger = getLogger();
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
    const logger = getLogger();
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
