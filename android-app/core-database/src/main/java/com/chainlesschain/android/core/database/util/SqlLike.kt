package com.chainlesschain.android.core.database.util

/**
 * SQLite LIKE-pattern escaping (Android shared helper).
 *
 * Escape the LIKE metacharacters (% _ \) so a user-supplied value is matched
 * LITERALLY. Room binds `:query` params, so this is not an injection vector —
 * but an unescaped % or _ in the value still acts as a wildcard and broadens a
 * search to unrelated rows (and, for an id/prefix match, could hit the WRONG
 * one). Mirrors packages/cli/src/lib/sql-like.js and
 * packages/personal-data-hub/lib/sql-like.js.
 *
 * Room usage: the escaped value only takes effect when the `@Query` pairs the
 * LIKE with `ESCAPE '\'`. Keep the DAO's public search method wrapping the raw
 * `@Query` method so callers pass plain text and escaping is centralized, e.g.
 *
 *     @Query("... WHERE name LIKE '%' || :q || '%' ESCAPE '\\' ...")
 *     fun searchRaw(q: String): Flow<List<T>>
 *
 *     fun search(query: String): Flow<List<T>> = searchRaw(SqlLike.escapeLike(query))
 */
object SqlLike {
    private val META = Regex("""([\\%_])""")

    /** Escape % _ \ in [value] for a literal LIKE match (pair with ESCAPE '\'). */
    fun escapeLike(value: String?): String =
        (value ?: "").replace(META, """\\$1""")

    /** `<escaped>%` — a literal-prefix LIKE pattern (use with ESCAPE '\'). */
    fun likePrefix(value: String?): String = escapeLike(value) + "%"

    /** `%<escaped>%` — a literal-substring LIKE pattern (use with ESCAPE '\'). */
    fun likeContains(value: String?): String = "%" + escapeLike(value) + "%"
}
