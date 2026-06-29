"use strict";

/**
 * Build a safe `ORDER BY <column> <direction>` from caller-supplied (e.g. IPC)
 * sort options. ORDER BY can't be a bound `?` parameter, so interpolating a raw
 * orderBy/order is a SQL injection vector. This validates the column to a bare
 * SQL identifier and the direction to ASC/DESC, falling back to safe defaults
 * for anything else (injection attempts, unknown values, non-strings).
 *
 * @param {*} orderBy - requested sort column
 * @param {*} order - requested sort direction
 * @param {{ fallbackColumn?: string }} [opts]
 * @returns {{ column: string, direction: "ASC"|"DESC" }}
 */
function safeOrderByClause(
  orderBy,
  order,
  { fallbackColumn = "created_at" } = {},
) {
  const column =
    typeof orderBy === "string" && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(orderBy)
      ? orderBy
      : fallbackColumn;
  const direction = /^asc$/i.test(String(order)) ? "ASC" : "DESC";
  return { column, direction };
}

module.exports = { safeOrderByClause };
