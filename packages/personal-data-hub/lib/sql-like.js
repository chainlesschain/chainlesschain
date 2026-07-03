/**
 * SQLite LIKE-pattern escaping (PDH shared helper).
 *
 * Escape the LIKE metacharacters (% _ \) so a user-supplied value is matched
 * LITERALLY in a `... LIKE ? ESCAPE '\'` clause. Without escaping, a value
 * containing % or _ acts as a wildcard — broadening a search to unrelated rows
 * (and, for an id/prefix match that resolves or mutates a record, hitting the
 * WRONG one). Mirrors packages/cli/src/lib/sql-like.js.
 *
 * Always pair the returned pattern with `ESCAPE '\'` in the SQL. For an
 * anchored (prefix) match, keep a non-empty guard at the call site — an empty
 * value yields a bare `%`, which still matches all rows.
 */

/** Escape % _ \ in `value` for a literal LIKE match. */
function escapeLike(value) {
  return String(value ?? "").replace(/[\\%_]/g, "\\$&");
}

/** `<escaped value>%` — a literal-prefix LIKE pattern (use with ESCAPE '\'). */
function likePrefix(value) {
  return escapeLike(value) + "%";
}

/** `%<escaped value>%` — a literal-substring LIKE pattern (use with ESCAPE '\'). */
function likeContains(value) {
  return "%" + escapeLike(value) + "%";
}

module.exports = { escapeLike, likePrefix, likeContains };
