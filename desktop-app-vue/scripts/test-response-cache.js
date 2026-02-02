#!/usr/bin/env node
/**
 * Response Cache Integration Test
 *
 * 验证 LLM 响应缓存系统在实际环境中的工作情况
 *
 * Usage: node scripts/test-response-cache.js
 */

const path = require('path');

// 设置模块路径
const srcPath = path.join(__dirname, '..', 'src', 'main');

console.log('═'.repeat(60));
console.log('  Response Cache Integration Test');
console.log('═'.repeat(60));
console.log();

// Mock database for testing
function createMockDatabase() {
  const cache = new Map();
  let idCounter = 0;

  return {
    prepare: (sql) => ({
      get: (...params) => {
        if (sql.includes('SELECT') && sql.includes('cache_key')) {
          const cacheKey = params[0];
          return cache.get(cacheKey) || null;
        }
        if (sql.includes('COUNT(*)')) {
          return { count: cache.size };
        }
        if (sql.includes('SUM') && sql.includes('hit_count')) {
          let totalHits = 0;
          let totalTokensSaved = 0;
          cache.forEach(v => {
            totalHits += v.hit_count || 0;
            totalTokensSaved += v.tokens_saved || 0;
          });
          return {
            total_entries: cache.size,
            total_hits: totalHits,
            total_tokens_saved: totalTokensSaved,
            avg_hits_per_entry: cache.size > 0 ? totalHits / cache.size : 0,
          };
        }
        return null;
      },
      all: (...params) => {
        if (sql.includes('GROUP BY provider')) {
          const byProvider = new Map();
          cache.forEach((v, k) => {
            const p = v.provider || 'unknown';
            if (!byProvider.has(p)) {
              byProvider.set(p, { provider: p, entries: 0, hits: 0, tokens_saved: 0 });
            }
            const stat = byProvider.get(p);
            stat.entries++;
            stat.hits += v.hit_count || 0;
            stat.tokens_saved += v.tokens_saved || 0;
          });
          return Array.from(byProvider.values());
        }
        return [];
      },
      run: (...params) => {
        if (sql.includes('INSERT') || sql.includes('REPLACE')) {
          const id = params[0];
          const cacheKey = params[1];
          cache.set(cacheKey, {
            id,
            cache_key: cacheKey,
            provider: params[2],
            model: params[3],
            request_messages: params[4],
            response_content: params[5],
            response_tokens: params[6],
            hit_count: params[7],
            tokens_saved: params[8],
            created_at: params[9],
            expires_at: params[10],
            last_accessed_at: params[11],
          });
          return { changes: 1 };
        }
        if (sql.includes('DELETE') && sql.includes('expires_at')) {
          const now = params[0];
          let deleted = 0;
          cache.forEach((v, k) => {
            if (v.expires_at < now) {
              cache.delete(k);
              deleted++;
            }
          });
          return { changes: deleted };
        }
        if (sql.includes('DELETE')) {
          const sizeBefore = cache.size;
          cache.clear();
          return { changes: sizeBefore };
        }
        if (sql.includes('UPDATE')) {
          return { changes: 1 };
        }
        return { changes: 0 };
      },
    }),
  };
}

async function runTests() {
  const results = {
    passed: 0,
    failed: 0,
    tests: [],
  };

  function test(name, fn) {
    return async () => {
      try {
        await fn();
        results.passed++;
        results.tests.push({ name, status: 'passed' });
        console.log(`  ✓ ${name}`);
      } catch (error) {
        results.failed++;
        results.tests.push({ name, status: 'failed', error: error.message });
        console.log(`  ✗ ${name}`);
        console.log(`    Error: ${error.message}`);
      }
    };
  }

  // ==================== Test Cases ====================

  console.log('1. ResponseCache Core Tests');
  console.log('-'.repeat(40));

  await test('Should create ResponseCache instance', async () => {
    const { ResponseCache } = require(path.join(srcPath, 'llm/response-cache'));
    const mockDb = createMockDatabase();
    const cache = new ResponseCache(mockDb, { enableAutoCleanup: false });

    if (!cache) throw new Error('Failed to create instance');
    if (cache.ttl !== 7 * 24 * 60 * 60 * 1000) throw new Error('Wrong default TTL');
    if (cache.maxSize !== 1000) throw new Error('Wrong default maxSize');
  })();

  await test('Should calculate cache key correctly', async () => {
    const { calculateCacheKey } = require(path.join(srcPath, 'llm/response-cache'));

    const key1 = calculateCacheKey('openai', 'gpt-4', [{ role: 'user', content: 'Hello' }]);
    const key2 = calculateCacheKey('openai', 'gpt-4', [{ role: 'user', content: 'Hello' }]);
    const key3 = calculateCacheKey('openai', 'gpt-4', [{ role: 'user', content: 'Hi' }]);

    if (key1 !== key2) throw new Error('Same input should produce same key');
    if (key1 === key3) throw new Error('Different input should produce different key');
    if (key1.length !== 64) throw new Error('SHA-256 should produce 64 char hex string');
  })();

  await test('Should set and get cache entries', async () => {
    const { ResponseCache } = require(path.join(srcPath, 'llm/response-cache'));
    const mockDb = createMockDatabase();
    const cache = new ResponseCache(mockDb, { enableAutoCleanup: false });

    const messages = [{ role: 'user', content: 'What is AI?' }];
    const response = { text: 'AI is...', tokens: 100 };

    // Set cache
    const setResult = await cache.set('openai', 'gpt-4', messages, response);
    if (!setResult) throw new Error('Failed to set cache');

    // Get cache
    const getResult = await cache.get('openai', 'gpt-4', messages);
    if (!getResult.hit) throw new Error('Cache should hit');
    if (!getResult.response) throw new Error('Missing response');
  })();

  await test('Should return miss for non-existent cache', async () => {
    const { ResponseCache } = require(path.join(srcPath, 'llm/response-cache'));
    const mockDb = createMockDatabase();
    const cache = new ResponseCache(mockDb, { enableAutoCleanup: false });

    const result = await cache.get('openai', 'gpt-4', [{ role: 'user', content: 'Unknown' }]);

    if (result.hit) throw new Error('Should not hit for non-existent cache');
  })();

  await test('Should track hits and misses', async () => {
    const { ResponseCache } = require(path.join(srcPath, 'llm/response-cache'));
    const mockDb = createMockDatabase();
    const cache = new ResponseCache(mockDb, { enableAutoCleanup: false });

    // Miss
    await cache.get('openai', 'gpt-4', [{ role: 'user', content: 'Q1' }]);

    // Set and hit
    const messages = [{ role: 'user', content: 'Q2' }];
    await cache.set('openai', 'gpt-4', messages, { text: 'A2' });
    await cache.get('openai', 'gpt-4', messages);

    if (cache.stats.misses !== 1) throw new Error(`Expected 1 miss, got ${cache.stats.misses}`);
    if (cache.stats.hits !== 1) throw new Error(`Expected 1 hit, got ${cache.stats.hits}`);
    if (cache.stats.sets !== 1) throw new Error(`Expected 1 set, got ${cache.stats.sets}`);
  })();

  console.log();
  console.log('2. Cache Operations Tests');
  console.log('-'.repeat(40));

  await test('Should clear all cache entries', async () => {
    const { ResponseCache } = require(path.join(srcPath, 'llm/response-cache'));
    const mockDb = createMockDatabase();
    const cache = new ResponseCache(mockDb, { enableAutoCleanup: false });

    // Add some entries
    await cache.set('openai', 'gpt-4', [{ role: 'user', content: 'Q1' }], { text: 'A1' });
    await cache.set('openai', 'gpt-4', [{ role: 'user', content: 'Q2' }], { text: 'A2' });

    // Clear
    const deleted = await cache.clear();

    // Verify cleared
    const stats = await cache.getStats();
    if (stats.database.totalEntries !== 0) {
      throw new Error(`Expected 0 entries after clear, got ${stats.database.totalEntries}`);
    }
  })();

  await test('Should get statistics', async () => {
    const { ResponseCache } = require(path.join(srcPath, 'llm/response-cache'));
    const mockDb = createMockDatabase();
    const cache = new ResponseCache(mockDb, { enableAutoCleanup: false });

    const stats = await cache.getStats();

    if (!stats.runtime) throw new Error('Missing runtime stats');
    if (!stats.database) throw new Error('Missing database stats');
    if (!stats.config) throw new Error('Missing config');
    if (stats.runtime.hits === undefined) throw new Error('Missing hits');
    if (stats.runtime.misses === undefined) throw new Error('Missing misses');
  })();

  await test('Should get stats by provider', async () => {
    const { ResponseCache } = require(path.join(srcPath, 'llm/response-cache'));
    const mockDb = createMockDatabase();
    const cache = new ResponseCache(mockDb, { enableAutoCleanup: false });

    await cache.set('openai', 'gpt-4', [{ role: 'user', content: 'Q1' }], { text: 'A1' });
    await cache.set('anthropic', 'claude-3', [{ role: 'user', content: 'Q2' }], { text: 'A2' });

    const stats = await cache.getStatsByProvider();

    if (!Array.isArray(stats)) throw new Error('Should return array');
  })();

  console.log();
  console.log('3. Response Cache IPC Tests');
  console.log('-'.repeat(40));

  await test('Should set and get response cache instance', async () => {
    const { setResponseCacheInstance, getResponseCacheInstance } = require(path.join(srcPath, 'llm/response-cache-ipc'));
    const { ResponseCache } = require(path.join(srcPath, 'llm/response-cache'));
    const mockDb = createMockDatabase();
    const cache = new ResponseCache(mockDb, { enableAutoCleanup: false });

    setResponseCacheInstance(cache);
    const retrieved = getResponseCacheInstance();

    if (retrieved !== cache) throw new Error('Should retrieve the same instance');
  })();

  console.log();
  console.log('4. Cache Key Generation Tests');
  console.log('-'.repeat(40));

  await test('Should generate different keys for different providers', async () => {
    const { calculateCacheKey } = require(path.join(srcPath, 'llm/response-cache'));

    const messages = [{ role: 'user', content: 'Hello' }];
    const key1 = calculateCacheKey('openai', 'gpt-4', messages);
    const key2 = calculateCacheKey('anthropic', 'gpt-4', messages);

    if (key1 === key2) throw new Error('Different providers should have different keys');
  })();

  await test('Should generate different keys for different models', async () => {
    const { calculateCacheKey } = require(path.join(srcPath, 'llm/response-cache'));

    const messages = [{ role: 'user', content: 'Hello' }];
    const key1 = calculateCacheKey('openai', 'gpt-4', messages);
    const key2 = calculateCacheKey('openai', 'gpt-3.5-turbo', messages);

    if (key1 === key2) throw new Error('Different models should have different keys');
  })();

  await test('Should handle complex message arrays', async () => {
    const { calculateCacheKey } = require(path.join(srcPath, 'llm/response-cache'));

    const messages = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
      { role: 'user', content: 'How are you?' },
    ];

    const key = calculateCacheKey('openai', 'gpt-4', messages);

    if (!key || key.length !== 64) throw new Error('Should generate valid SHA-256 key');
  })();

  console.log();
  console.log('5. Token Estimation Tests');
  console.log('-'.repeat(40));

  await test('Should estimate tokens for response', async () => {
    const { ResponseCache } = require(path.join(srcPath, 'llm/response-cache'));
    const mockDb = createMockDatabase();
    const cache = new ResponseCache(mockDb, { enableAutoCleanup: false });

    // Use internal method
    const tokens = cache._estimateTokens('Hello world, this is a test.');

    if (tokens < 5 || tokens > 15) {
      throw new Error(`Unexpected token estimate: ${tokens}`);
    }
  })();

  await test('Should handle empty string', async () => {
    const { ResponseCache } = require(path.join(srcPath, 'llm/response-cache'));
    const mockDb = createMockDatabase();
    const cache = new ResponseCache(mockDb, { enableAutoCleanup: false });

    const tokens = cache._estimateTokens('');

    if (tokens !== 0) throw new Error(`Expected 0 tokens for empty string, got ${tokens}`);
  })();

  // ==================== Summary ====================

  console.log();
  console.log('═'.repeat(60));
  console.log(`  Results: ${results.passed} passed, ${results.failed} failed`);
  console.log('═'.repeat(60));

  if (results.failed > 0) {
    console.log();
    console.log('Failed tests:');
    results.tests
      .filter((t) => t.status === 'failed')
      .forEach((t) => {
        console.log(`  - ${t.name}: ${t.error}`);
      });
    process.exit(1);
  }

  console.log();
  console.log('✅ All integration tests passed!');
  console.log();
}

runTests().catch((error) => {
  console.error('Test runner error:', error);
  process.exit(1);
});
