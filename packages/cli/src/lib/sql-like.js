/**
 * SQLite LIKE-pattern escaping.
 *
 * Escape the LIKE metacharacters (% _ \) so a user-supplied value is matched
 * LITERALLY in a `... LIKE ? ESCAPE '\'` clause. Without escaping, a value
 * containing % or _ acts as a wildcard — and for an id PREFIX match that
 * resolves or DELETEs a record, that resolves/deletes the WRONG record (or, for
 * a no-LIMIT delete, EVERY record: `delete %` → `LIKE '%%'` → all rows).
 *
 * Pair `likePrefix(value)` with `ESCAPE '\'` in the SQL, and keep a non-empty
 * guard at the call site — an empty value yields the bare `%` prefix, which
 * would still match all rows.
 */

/** Escape % _ \ in `value` for a literal LIKE match. */
export function escapeLike(value) {
  return String(value ?? "").replace(/[\\%_]/g, "\\$&");
}

/** `<escaped value>%` — a literal-prefix LIKE pattern (use with ESCAPE '\'). */
export function likePrefix(value) {
  return escapeLike(value) + "%";
}
