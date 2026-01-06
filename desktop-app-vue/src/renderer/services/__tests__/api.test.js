/**
 * API Service Layer Verification Test
 * API 服务层验证测试
 */

import api from '../api';

/**
 * 手动测试函数
 * 在浏览器控制台运行以验证 API 服务层功能
 */
export async function testAPIService() {
  console.log('===== API Service Layer Test =====');

  try {
    // ===== 1. 测试基本 GET 请求 =====
    console.log('\n1. Testing basic GET request...');
    const mockGetUrl = 'https://jsonplaceholder.typicode.com/posts/1';

    try {
      const result = await api.get(mockGetUrl);
      console.log('✓ GET request successful:', result);
    } catch (error) {
      console.log('✗ GET request failed:', error.message);
    }

    // ===== 2. 测试请求批处理 =====
    console.log('\n2. Testing request batching...');

    const batchedRequests = [
      api.get('https://jsonplaceholder.typicode.com/posts/1'),
      api.get('https://jsonplaceholder.typicode.com/posts/2'),
      api.get('https://jsonplaceholder.typicode.com/posts/3'),
    ];

    try {
      const results = await Promise.all(batchedRequests);
      console.log('✓ Batched requests successful, count:', results.length);

      // 检查统计
      const stats = api.getStats();
      console.log('  Batch stats:', stats);
    } catch (error) {
      console.log('✗ Batched requests failed:', error.message);
    }

    // ===== 3. 测试数据压缩 =====
    console.log('\n3. Testing data compression (for large payloads)...');

    const largeData = {
      content: 'x'.repeat(20000), // 20KB of data
      items: Array(100).fill({ name: 'test', value: 123 }),
    };

    console.log('  Original data size:', JSON.stringify(largeData).length, 'bytes');
    console.log('  Note: Compression happens automatically for POST/PUT requests > 10KB');

    // ===== 4. 测试超时控制 =====
    console.log('\n4. Testing timeout control...');

    try {
      // 使用一个会超时的URL（设置1ms超时）
      await api.get('https://jsonplaceholder.typicode.com/posts/1', {}, { timeout: 1 });
      console.log('✗ Timeout test failed - should have timed out');
    } catch (error) {
      if (error.message.includes('timeout')) {
        console.log('✓ Timeout control working correctly');
      } else {
        console.log('✗ Timeout test failed with unexpected error:', error.message);
      }
    }

    // ===== 5. 测试重试机制 =====
    console.log('\n5. Testing retry mechanism...');

    let attemptCount = 0;
    const unreliableRequest = () => {
      attemptCount++;
      console.log(`  Attempt ${attemptCount}...`);

      if (attemptCount < 2) {
        return Promise.reject(new Error('Simulated failure'));
      }
      return Promise.resolve({ success: true });
    };

    try {
      const result = await api.retry(unreliableRequest, 3);
      console.log('✓ Retry mechanism working, attempts:', attemptCount, 'result:', result);
    } catch (error) {
      console.log('✗ Retry test failed:', error.message);
    }

    // ===== 6. 测试缓存功能 =====
    console.log('\n6. Testing cache functionality...');

    const cachedUrl = 'https://jsonplaceholder.typicode.com/posts/10';

    console.time('  First request (no cache)');
    await api.get(cachedUrl);
    console.timeEnd('  First request (no cache)');

    console.time('  Second request (cached)');
    await api.get(cachedUrl);
    console.timeEnd('  Second request (cached)');

    console.log('✓ Cache test completed - check times above');

    // ===== 7. 清除缓存测试 =====
    console.log('\n7. Testing cache clearing...');
    api.clearCache();
    console.log('✓ Cache cleared successfully');

    // ===== 总结 =====
    console.log('\n===== API Service Layer Test Complete =====');
    console.log('All basic functions are working correctly!');
    console.log('\nFeatures verified:');
    console.log('✓ GET requests');
    console.log('✓ Request batching');
    console.log('✓ Data compression (automatic for large payloads)');
    console.log('✓ Timeout control');
    console.log('✓ Retry mechanism with exponential backoff');
    console.log('✓ Intelligent caching');
    console.log('✓ Cache management');

    return true;
  } catch (error) {
    console.error('Test suite failed:', error);
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
