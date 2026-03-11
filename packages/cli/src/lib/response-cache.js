/**
 * Response cache for CLI
 *
 * Caches LLM responses to avoid redundant API calls.
 * Lightweight port of desktop-app-vue/src/main/llm/response-cache.js
 */

import { createHash } from "crypto";

const DEFAULT_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEFAULT_MAX_SIZE = 500;

function ensureCacheTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS llm_cache (
      cache_key TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      response_content TEXT NOT NULL,
      response_tokens INTEGER DEFAULT 0,
      hit_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      last_accessed_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    )
  `);
}

/**
 * Generate a cache key from request parameters
 */
function generateCacheKey(provider, model, messages) {
  const payload = JSON.stringify({ provider, model, messages });
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Look up a cached response
 * @returns {{ hit: boolean, response?: string, tokensSaved?: number, cacheAge?: number }}
 */
export function getCachedResponse(db, provider, model, messages) {
  ensureCacheTable(db);

  const key = generateCacheKey(provider, model, messages);

  const row = db
    .prepare(
      `SELECT * FROM llm_cache WHERE cache_key = ? AND expires_at > datetime('now')`,
    )
    .get(key);

  if (!row) {
    return { hit: false };
  }

  // Update access stats
  db.prepare(
    `UPDATE llm_cache SET hit_count = hit_count + 1, last_accessed_at = datetime('now') WHERE cache_key = ?`,
  ).run(key);

  return {
    hit: true,
    response: row.response_content,
    tokensSaved: row.response_tokens,
    cacheAge: Date.now() - new Date(row.created_at).getTime(),
  };
}

/**
 * Store a response in cache
 */
export function setCachedResponse(
  db,
  provider,
  model,
  messages,
  response,
  options = {},
) {
  ensureCacheTable(db);

  const key = generateCacheKey(provider, model, messages);
  const requestHash = createHash("md5")
    .update(JSON.stringify(messages))
    .digest("hex");
  const ttl = options.ttl || DEFAULT_TTL;
  const maxSize = options.maxSize || DEFAULT_MAX_SIZE;
  const expiresAt = new Date(Date.now() + ttl).toISOString();
  const responseTokens = options.responseTokens || 0;

  // LRU eviction if needed
  const countRow = db.prepare("SELECT COUNT(*) as cnt FROM llm_cache").get();
  const count = countRow?.cnt || 0;
  if (count >= maxSize) {
    db.prepare(
      `DELETE FROM llm_cache WHERE cache_key IN (
        SELECT cache_key FROM llm_cache ORDER BY last_accessed_at ASC, created_at ASC LIMIT ?
      )`,
    ).run(Math.max(1, Math.ceil(maxSize * 0.1)));
  }

  db.prepare(
    `INSERT OR REPLACE INTO llm_cache (cache_key, provider, model, request_hash, response_content, response_tokens, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(key, provider, model, requestHash, response, responseTokens, expiresAt);
}

/**
 * Clear all cached responses
 */
export function clearCache(db) {
  ensureCacheTable(db);
  db.prepare("DELETE FROM llm_cache").run();
}

/**
 * Remove expired entries
 */
export function clearExpired(db) {
  ensureCacheTable(db);
  const result = db
    .prepare("DELETE FROM llm_cache WHERE expires_at <= datetime('now')")
    .run();
  return result.changes;
}

/**
 * Get cache statistics
 */
export function getCacheStats(db) {
  ensureCacheTable(db);

  const stats = db
    .prepare(
      `SELECT
        COUNT(*) as total_entries,
        COALESCE(SUM(hit_count), 0) as total_hits,
        COALESCE(SUM(response_tokens), 0) as total_tokens_saved
      FROM llm_cache`,
    )
    .get();

  const expired = db
    .prepare(
      "SELECT COUNT(*) as cnt FROM llm_cache WHERE expires_at <= datetime('now')",
    )
    .get();

  return {
    total_entries: stats?.total_entries || 0,
    total_hits: stats?.total_hits || 0,
    total_tokens_saved: stats?.total_tokens_saved || 0,
    expired_entries: expired?.cnt || 0,
  };
}
