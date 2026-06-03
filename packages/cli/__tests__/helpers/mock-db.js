/**
 * Simple in-memory mock database for unit tests.
 * Simulates the better-sqlite3 API using plain JavaScript.
 */

export class MockDatabase {
  constructor() {
    this.tables = new Map();
    this.data = new Map();
    this.closed = false;
  }

  exec(sql) {
    // Parse CREATE TABLE IF NOT EXISTS
    const createMatch = sql.match(
      /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)\s*\(([\s\S]+?)\)/i,
    );
    if (createMatch) {
      const tableName = createMatch[1];
      if (!this.tables.has(tableName)) {
        this.tables.set(tableName, { columns: createMatch[2] });
        this.data.set(tableName, []);
      }
    }
  }

  prepare(sql) {
    const db = this;
    return {
      run(...params) {
        return db._executeWrite(sql, params);
      },
      get(...params) {
        return db._executeRead(sql, params, "get");
      },
      all(...params) {
        return db._executeRead(sql, params, "all");
      },
    };
  }

  _executeWrite(sql, params) {
    const upperSql = sql.trim().toUpperCase();

    if (upperSql.startsWith("INSERT")) {
      return this._insert(sql, params);
    }
    if (upperSql.startsWith("UPDATE")) {
      return this._update(sql, params);
    }
    if (upperSql.startsWith("DELETE")) {
      return this._delete(sql, params);
    }

    return { changes: 0 };
  }

  _insert(sql, params) {
    const match = sql.match(
      /INSERT\s+(?:OR\s+(?:REPLACE|IGNORE)\s+)?INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i,
    );
    if (!match) return { changes: 0 };

    const tableName = match[1];
    const columns = match[2].split(",").map((c) => c.trim());
    const valueParts = match[3].split(",").map((v) => v.trim());

    if (!this.data.has(tableName)) {
      this.data.set(tableName, []);
    }

    const row = {};
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);

    let paramIdx = 0;
    columns.forEach((col, i) => {
      if (i < valueParts.length) {
        if (valueParts[i].trim() === "?") {
          row[col] = params[paramIdx++];
        } else {
          // Literal value — parse number or strip quotes
          const lit = valueParts[i].trim();
          if (/^\d+$/.test(lit)) {
            row[col] = parseInt(lit, 10);
          } else if (/^'.*'$/.test(lit)) {
            row[col] = lit.slice(1, -1);
          } else {
            row[col] = lit;
          }
        }
      }
    });

    // Add defaults
    if (!row.created_at) row.created_at = now;
    if (!row.updated_at) row.updated_at = now;

    const upperSql = sql.toUpperCase();

    // Handle OR REPLACE
    if (upperSql.includes("OR REPLACE")) {
      const pkCol = columns[0];
      const rows = this.data.get(tableName);
      const idx = rows.findIndex((r) => r[pkCol] === row[pkCol]);
      if (idx >= 0) {
        rows[idx] = row;
        return { changes: 1 };
      }
    }

    // Handle OR IGNORE — skip if primary key already exists
    if (upperSql.includes("OR IGNORE")) {
      const pkCol = columns[0];
      const rows = this.data.get(tableName);
      const exists = rows.some((r) => r[pkCol] === row[pkCol]);
      if (exists) {
        return { changes: 0 };
      }
    }

    this.data.get(tableName).push(row);
    return { changes: 1 };
  }

  _update(sql, params) {
    const match = sql.match(/UPDATE\s+(\w+)\s+SET\s+(.+?)\s+WHERE\s+(.+)/is);
    if (!match) return { changes: 0 };

    const tableName = match[1];
    const rows = this.data.get(tableName) || [];
    let changes = 0;

    // Count SET ? placeholders to split params correctly
    const setClauses = match[2].split(",").map((c) => c.trim());
    let setParamCount = 0;
    for (const clause of setClauses) {
      const setMatch = clause.match(/(\w+)\s*=\s*(.+)/);
      if (setMatch && setMatch[2].trim() === "?") setParamCount++;
    }

    const setParams = params.slice(0, setParamCount);
    const whereParams = params.slice(setParamCount);

    // Filter rows using WHERE params only
    const filteredRows = this._filterRows(rows, match[3], whereParams);

    for (const row of filteredRows) {
      let setIdx = 0;
      for (const clause of setClauses) {
        const setMatch = clause.match(/(\w+)\s*=\s*(.+)/);
        if (setMatch) {
          const col = setMatch[1];
          const val = setMatch[2].trim();
          if (val === "hit_count + 1") {
            row[col] = (row[col] || 0) + 1;
          } else if (val.includes("datetime('now')")) {
            row[col] = new Date().toISOString().replace("T", " ").slice(0, 19);
          } else if (val === "?") {
            row[col] = setParams[setIdx++];
          } else if (/^'[^']*'$/.test(val)) {
            row[col] = val.slice(1, -1);
          } else if (/^-?\d+(\.\d+)?$/.test(val)) {
            row[col] = Number(val);
          }
        }
      }
      changes++;
    }

    return { changes };
  }

  _delete(sql, params) {
    const match = sql.match(/DELETE\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+))?/is);
    if (!match) return { changes: 0 };

    const tableName = match[1];
    const rows = this.data.get(tableName) || [];

    if (!match[2]) {
      // DELETE all
      const changes = rows.length;
      this.data.set(tableName, []);
      return { changes };
    }

    const beforeCount = rows.length;
    const kept = rows.filter(
      (r) => !this._matchesWhere(r, match[2], [...params]),
    );
    this.data.set(tableName, kept);
    return { changes: beforeCount - kept.length };
  }

  _executeRead(sql, params, mode) {
    const upperSql = sql.trim().toUpperCase();

    // SELECT query
    const tableMatch = sql.match(/FROM\s+(\w+)/i);
    if (!tableMatch) return mode === "get" ? undefined : [];

    const tableName = tableMatch[1];
    let rows = [...(this.data.get(tableName) || [])];

    // Apply WHERE
    const whereMatch = sql.match(
      /WHERE\s+(.+?)(?:\s+GROUP\s|\s+ORDER\s|\s+LIMIT\s|$)/is,
    );
    if (whereMatch) {
      rows = this._filterRows(rows, whereMatch[1], [...params]);
    }

    // Apply GROUP BY (returns aggregated rows)
    if (upperSql.includes("GROUP BY")) {
      rows = this._groupBy(sql, rows);
      // Apply ORDER BY on grouped results
      const orderMatch = sql.match(/ORDER\s+BY\s+(\w+)\s*(ASC|DESC)?/i);
      if (orderMatch) {
        const col = orderMatch[1];
        const desc = (orderMatch[2] || "ASC").toUpperCase() === "DESC";
        rows.sort((a, b) => {
          const va = a[col] ?? "";
          const vb = b[col] ?? "";
          return desc ? (vb > va ? 1 : -1) : va > vb ? 1 : -1;
        });
      }
      return mode === "get" ? rows[0] || null : rows;
    }

    // Handle pure COUNT(*) query (no GROUP BY)
    if (
      upperSql.includes("COUNT(*)") &&
      !upperSql.includes("SUM(") &&
      !upperSql.includes("AVG(") &&
      !upperSql.includes("MAX(")
    ) {
      const aliasMatch = sql.match(/COUNT\(\*\)\s+as\s+(\w+)/i);
      const alias = aliasMatch ? aliasMatch[1] : "cnt";
      const result = {
        [alias]: rows.length,
        cnt: rows.length,
        "COUNT(*)": rows.length,
      };
      return mode === "get" ? result : [result];
    }

    // Handle aggregate queries (SUM, AVG, COALESCE, MAX, MIN) without GROUP BY
    if (
      upperSql.includes("SUM(") ||
      upperSql.includes("AVG(") ||
      upperSql.includes("COALESCE(") ||
      upperSql.includes("MAX(") ||
      upperSql.includes("MIN(")
    ) {
      return mode === "get"
        ? this._aggregate(sql, rows)
        : [this._aggregate(sql, rows)];
    }

    // Apply ORDER BY
    const orderMatch = sql.match(/ORDER\s+BY\s+(\w+)\s*(ASC|DESC)?/i);
    if (orderMatch) {
      const col = orderMatch[1];
      const desc = (orderMatch[2] || "ASC").toUpperCase() === "DESC";
      rows.sort((a, b) => {
        const va = a[col] || "";
        const vb = b[col] || "";
        return desc ? (vb > va ? 1 : -1) : va > vb ? 1 : -1;
      });
    }

    // Apply LIMIT and OFFSET
    const offsetMatch = sql.match(/OFFSET\s+(\?|\d+)/i);
    if (offsetMatch) {
      const offset =
        offsetMatch[1] === "?"
          ? params[params.length - 1]
          : parseInt(offsetMatch[1]);
      rows = rows.slice(offset);
    }

    const limitMatch = sql.match(/LIMIT\s+(\?|\d+)/i);
    if (limitMatch) {
      const limitParamIdx =
        (sql.match(/\?/g) || []).length -
        (offsetMatch && offsetMatch[1] === "?" ? 1 : 0) -
        1;
      const limit =
        limitMatch[1] === "?"
          ? params[limitParamIdx >= 0 ? limitParamIdx : params.length - 1]
          : parseInt(limitMatch[1]);
      rows = rows.slice(0, limit);
    }

    return mode === "get" ? rows[0] || null : rows;
  }

  _filterRows(rows, whereClause, params) {
    // Each row match needs its own copy of params since shift() mutates
    return rows.filter((row) =>
      this._matchesWhere(row, whereClause, [...params]),
    );
  }

  _matchesWhere(row, whereClause, params) {
    // Very simple WHERE parser for common patterns
    const conditions = whereClause.split(/\s+AND\s+/i);
    return conditions.every((cond) => {
      const trimmed = cond.trim();

      if (trimmed === "1=1") return true;

      // LIKE
      const likeMatch = trimmed.match(/(\w+)\s+LIKE\s+\?/i);
      if (likeMatch) {
        const col = likeMatch[1];
        const pattern = params.shift();
        if (!pattern) return true;
        const regex = new RegExp(pattern.replace(/%/g, ".*"), "i");
        return regex.test(row[col] || "");
      }

      // = ?
      const eqMatch = trimmed.match(/(\w+)\s*=\s*\?/i);
      if (eqMatch) {
        return row[eqMatch[1]] === params.shift();
      }

      // = 'literal' or = number
      const eqLiteralMatch = trimmed.match(/(\w+)\s*=\s*'([^']+)'/i);
      if (eqLiteralMatch) {
        return row[eqLiteralMatch[1]] === eqLiteralMatch[2];
      }
      const eqNumMatch = trimmed.match(/(\w+)\s*=\s*(\d+)$/i);
      if (eqNumMatch) {
        return row[eqNumMatch[1]] === parseInt(eqNumMatch[2]);
      }

      // >= ?
      const gteMatch = trimmed.match(/(\w+)\s*>=\s*\?/i);
      if (gteMatch) {
        return (row[gteMatch[1]] || "") >= params.shift();
      }

      // > ?
      const gtMatch = trimmed.match(/(\w+)\s*>\s*\?(?!=)/i);
      if (gtMatch && !trimmed.includes(">=")) {
        return (row[gtMatch[1]] || "") > params.shift();
      }

      // <= ?
      const lteMatch = trimmed.match(/(\w+)\s*<=\s*\?/i);
      if (lteMatch) {
        return (row[lteMatch[1]] || "") <= params.shift();
      }

      // < ?
      const ltMatch = trimmed.match(/(\w+)\s*<\s*\?(?!=)/i);
      if (ltMatch && !trimmed.includes("<=")) {
        return (row[ltMatch[1]] || "") < params.shift();
      }

      // IS NOT NULL
      const isNotNullMatch = trimmed.match(/(\w+)\s+IS\s+NOT\s+NULL/i);
      if (isNotNullMatch) {
        return row[isNotNullMatch[1]] != null;
      }

      // IS NULL
      if (trimmed.match(/(\w+)\s+IS\s+NULL/i)) {
        const col = trimmed.match(/(\w+)\s+IS\s+NULL/i)[1];
        return row[col] == null;
      }

      // expires_at > datetime('now') or expires_at <= datetime('now')
      if (trimmed.includes("datetime('now')")) {
        if (trimmed.includes("<=")) {
          const col = trimmed.match(/(\w+)\s*<=/)?.[1];
          if (col) return new Date(row[col]) <= new Date();
        } else if (trimmed.includes(">")) {
          const col = trimmed.match(/(\w+)\s*>/)?.[1];
          if (col) return new Date(row[col]) > new Date();
        }
      }

      // Subquery IN — just return true
      if (trimmed.includes("IN (")) return true;

      return true;
    });
  }

  _aggregate(sql, rows) {
    const result = {};

    // Parse all aggregate expressions
    const selectPart = sql.match(/SELECT\s+([\s\S]+?)\s+FROM/i)?.[1] || "";
    const exprs = selectPart.split(",").map((e) => e.trim());

    for (const expr of exprs) {
      const aliasMatch = expr.match(/\s+as\s+(\w+)/i);
      const alias = aliasMatch ? aliasMatch[1] : expr;

      if (expr.toUpperCase().includes("COUNT(*)")) {
        result[alias] = rows.length;
      } else if (expr.toUpperCase().includes("SUM(")) {
        const colMatch = expr.match(/SUM\((\w+)\)/i);
        if (colMatch) {
          const col = colMatch[1];
          const sum = rows.reduce((s, r) => s + (r[col] || 0), 0);
          result[alias] = sum;
        }
        const coalesceMatch = expr.match(/COALESCE\(SUM\((\w+)\),\s*(\d+)\)/i);
        if (coalesceMatch) {
          const col = coalesceMatch[1];
          const defaultVal = parseFloat(coalesceMatch[2]);
          const sum = rows.reduce((s, r) => s + (r[col] || 0), 0);
          result[alias] = rows.length > 0 ? sum : defaultVal;
        }
      } else if (expr.toUpperCase().includes("AVG(")) {
        const coalesceMatch = expr.match(/COALESCE\(AVG\((\w+)\),\s*(\d+)\)/i);
        if (coalesceMatch) {
          const col = coalesceMatch[1];
          const defaultVal = parseFloat(coalesceMatch[2]);
          if (rows.length === 0) {
            result[alias] = defaultVal;
          } else {
            result[alias] =
              rows.reduce((s, r) => s + (r[col] || 0), 0) / rows.length;
          }
        }
      } else if (expr.toUpperCase().includes("MAX(")) {
        const colMatch = expr.match(/MAX\((\w+)\)/i);
        if (colMatch) {
          const col = colMatch[1];
          if (rows.length === 0) {
            result[alias] = null;
          } else {
            result[alias] = Math.max(...rows.map((r) => r[col] || 0));
          }
        }
      } else if (expr.toUpperCase().includes("MIN(")) {
        const colMatch = expr.match(/MIN\((\w+)\)/i);
        if (colMatch) {
          const col = colMatch[1];
          if (rows.length === 0) {
            result[alias] = null;
          } else {
            result[alias] = Math.min(...rows.map((r) => r[col] || 0));
          }
        }
      }
    }

    return result;
  }

  _groupBy(sql, rows) {
    const gbMatch = sql.match(
      /GROUP\s+BY\s+([\w,\s]+?)(?:\s+ORDER\s|\s+LIMIT\s|\s+HAVING\s|$)/i,
    );
    if (!gbMatch) return rows;

    const groupCols = gbMatch[1].split(",").map((c) => c.trim());
    const groups = new Map();

    for (const row of rows) {
      const key = groupCols.map((c) => row[c]).join("|");
      if (!groups.has(key)) {
        groups.set(key, { ...row, _rows: [] });
      }
      groups.get(key)._rows.push(row);
    }

    // Apply aggregates
    const selectPart = sql.match(/SELECT\s+([\s\S]+?)\s+FROM/i)?.[1] || "";
    const results = [];

    for (const [, group] of groups) {
      const result = {};
      for (const col of groupCols) {
        result[col] = group[col];
      }

      // Parse aggregates
      const countMatch = selectPart.match(/COUNT\(\*\)\s+as\s+(\w+)/i);
      if (countMatch) result[countMatch[1]] = group._rows.length;

      const sumMatches = [
        ...selectPart.matchAll(/SUM\((\w+)\)\s+as\s+(\w+)/gi),
      ];
      for (const m of sumMatches) {
        result[m[2]] = group._rows.reduce((s, r) => s + (r[m[1]] || 0), 0);
      }

      results.push(result);
    }

    return results;
  }

  close() {
    this.closed = true;
  }
}
