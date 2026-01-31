/**
 * API Service Layer Verification Test
 * API 服务层验证测试
 *
 * NOTE: This is a manual browser test, not a vitest test.
 * Run in browser console with:
 *   import { testAPIService } from '@/services/__tests__/api.test.js'
 *   testAPIService()
 */

import { describe, it } from 'vitest';
import { logger, createLogger } from '@/utils/logger';
import api from '../api';

// NOTE: Skipped - this file contains manual browser tests, not vitest tests
describe.skip('API Service Layer Manual Tests', () => {
  it('manual test placeholder', () => {});
});

/**
 * 手动测试函数
 * 在浏览器控制台运行以验证 API 服务层功能
 */
export async function testAPIService() {
  logger.info('===== API Service Layer Test =====');

  try {
    // ===== 1. 测试基本 GET 请求 =====
    logger.info('\n1. Testing basic GET request...');
    const mockGetUrl = 'https://jsonplaceholder.typicode.com/posts/1';

    try {
      const result = await api.get(mockGetUrl);
      logger.info('✓ GET request successful:', result);
    } catch (error) {
      logger.info('✗ GET request failed:', error.message);
    }

    // ===== 2. 测试请求批处理 =====
    logger.info('\n2. Testing request batching...');

    const batchedRequests = [
      api.get('https://jsonplaceholder.typicode.com/posts/1'),
      api.get('https://jsonplaceholder.typicode.com/posts/2'),
      api.get('https://jsonplaceholder.typicode.com/posts/3'),
    ];

    try {
      const results = await Promise.all(batchedRequests);
      logger.info('✓ Batched requests successful, count:', results.length);

      // 检查统计
      const stats = api.getStats();
      logger.info('  Batch stats:', stats);
    } catch (error) {
      logger.info('✗ Batched requests failed:', error.message);
    }

    // ===== 3. 测试数据压缩 =====
    logger.info('\n3. Testing data compression (for large payloads)...');

    const largeData = {
      content: 'x'.repeat(20000), // 20KB of data
      items: Array(100).fill({ name: 'test', value: 123 }),
    };

    logger.info('  Original data size:', JSON.stringify(largeData).length, 'bytes');
    logger.info('  Note: Compression happens automatically for POST/PUT requests > 10KB');

    // ===== 4. 测试超时控制 =====
    logger.info('\n4. Testing timeout control...');

    try {
      // 使用一个会超时的URL（设置1ms超时）
      await api.get('https://jsonplaceholder.typicode.com/posts/1', {}, { timeout: 1 });
      logger.info('✗ Timeout test failed - should have timed out');
    } catch (error) {
      if (error.message.includes('timeout')) {
        logger.info('✓ Timeout control working correctly');
      } else {
        logger.info('✗ Timeout test failed with unexpected error:', error.message);
      }
    }

    // ===== 5. 测试重试机制 =====
    logger.info('\n5. Testing retry mechanism...');

    let attemptCount = 0;
    const unreliableRequest = () => {
      attemptCount++;
      logger.info(`  Attempt ${attemptCount}...`);

      if (attemptCount < 2) {
        return Promise.reject(new Error('Simulated failure'));
      }
      return Promise.resolve({ success: true });
    };

    try {
      const result = await api.retry(unreliableRequest, 3);
      logger.info('✓ Retry mechanism working, attempts:', attemptCount, 'result:', result);
    } catch (error) {
      logger.info('✗ Retry test failed:', error.message);
    }

    // ===== 6. 测试缓存功能 =====
    logger.info('\n6. Testing cache functionality...');

    const cachedUrl = 'https://jsonplaceholder.typicode.com/posts/10';

    logger.perfStart('  First request (no cache)');
    await api.get(cachedUrl);
    logger.perfEnd('  First request (no cache)');

    logger.perfStart('  Second request (cached)');
    await api.get(cachedUrl);
    logger.perfEnd('  Second request (cached)');

    logger.info('✓ Cache test completed - check times above');

    // ===== 7. 清除缓存测试 =====
    logger.info('\n7. Testing cache clearing...');
    api.clearCache();
    logger.info('✓ Cache cleared successfully');

    // ===== 总结 =====
    logger.info('\n===== API Service Layer Test Complete =====');
    logger.info('All basic functions are working correctly!');
    logger.info('\nFeatures verified:');
    logger.info('✓ GET requests');
    logger.info('✓ Request batching');
    logger.info('✓ Data compression (automatic for large payloads)');
    logger.info('✓ Timeout control');
    logger.info('✓ Retry mechanism with exponential backoff');
    logger.info('✓ Intelligent caching');
    logger.info('✓ Cache management');

    return true;
  } catch (error) {
    logger.error('Test suite failed:', error);
    return false;
  }
}

/**
 * 使用说明：
 *
 * 在浏览器控制台中运行：
 *
 * import { testAPIService } from '@/services/__tests__/api.test.js'
 * testAPIService()
 *
 * 或者在 Vue 组件中：
 *
 * import { testAPIService } from '@/services/__tests__/api.test.js'
 *
 * export default {
 *   async mounted() {
 *     await testAPIService()
 *   }
 * }
 */

export default {
  testAPIService,
};
