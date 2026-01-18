/**
 * 意图融合性能测试
 * 测试缓存效果和性能优化
 */

const IntentFusion = require('./src/main/ai-engine/intent-fusion');

async function testPerformance() {
  console.log('\n======== 意图融合性能测试 ========\n');

  // 测试数据
  const testIntents = [
    { type: 'CREATE_FILE', params: { filePath: 'test1.txt' } },
    { type: 'WRITE_FILE', params: { filePath: 'test1.txt', content: 'hello' } }
  ];

  // 测试1: 无缓存性能
  console.log('📊 测试1: 无缓存性能');
  const fusionNoCache = new IntentFusion({ enableCache: false });

  const noCacheStart = Date.now();
  for (let i = 0; i < 100; i++) {
    await fusionNoCache.fuseIntents(testIntents, { sessionId: `nocache-${i}` });
  }
  const noCacheTime = Date.now() - noCacheStart;

  console.log(`  ✓ 100次融合耗时: ${noCacheTime}ms`);
  console.log(`  ✓ 平均每次: ${(noCacheTime / 100).toFixed(2)}ms`);

  const noCacheStats = fusionNoCache.getPerformanceStats();
  console.log(`  ✓ 总融合时间: ${noCacheStats.totalTime}ms`);
  console.log(`  ✓ 规则融合时间: ${noCacheStats.ruleFusionTime}ms\n`);

  // 测试2: 有缓存性能
  console.log('📊 测试2: 有缓存性能');
  const fusionWithCache = new IntentFusion({ enableCache: true, cacheMaxSize: 100 });

  const cacheStart = Date.now();
  for (let i = 0; i < 100; i++) {
    await fusionWithCache.fuseIntents(testIntents, { sessionId: `cache-${i}` });
  }
  const cacheTime = Date.now() - cacheStart;

  console.log(`  ✓ 100次融合耗时: ${cacheTime}ms`);
  console.log(`  ✓ 平均每次: ${(cacheTime / 100).toFixed(2)}ms`);

  const cacheStats = fusionWithCache.getPerformanceStats();
  console.log(`  ✓ 总融合时间: ${cacheStats.totalTime}ms`);
  console.log(`  ✓ 规则融合时间: ${cacheStats.ruleFusionTime}ms`);
  console.log(`  ✓ 缓存命中: ${cacheStats.cacheHits}`);
  console.log(`  ✓ 缓存未命中: ${cacheStats.cacheMisses}`);
  console.log(`  ✓ 缓存命中率: ${(cacheStats.cacheHitRate * 100).toFixed(2)}%`);
  console.log(`  ✓ 缓存大小: ${cacheStats.cacheSize}\n`);

  // 性能提升
  const improvement = ((noCacheTime - cacheTime) / noCacheTime * 100).toFixed(2);
  console.log(`🚀 性能提升: ${improvement}%`);
  console.log(`⚡ 加速比: ${(noCacheTime / cacheTime).toFixed(2)}x\n`);

  // 测试3: 不同模式的性能
  console.log('📊 测试3: 不同融合模式性能');

  const patterns = [
    {
      name: '同文件操作',
      intents: [
        { type: 'CREATE_FILE', params: { filePath: 'file.txt' } },
        { type: 'WRITE_FILE', params: { filePath: 'file.txt', content: 'test' } }
      ]
    },
    {
      name: 'Git操作',
      intents: [
        { type: 'GIT_ADD', params: { files: ['.'] } },
        { type: 'GIT_COMMIT', params: { message: 'test' } },
        { type: 'GIT_PUSH', params: { remote: 'origin' } }
      ]
    },
    {
      name: '批量文件创建',
      intents: [
        { type: 'CREATE_FILE', params: { filePath: 'f1.txt' } },
        { type: 'CREATE_FILE', params: { filePath: 'f2.txt' } },
        { type: 'CREATE_FILE', params: { filePath: 'f3.txt' } }
      ]
    },
    {
      name: '依赖操作',
      intents: [
        { type: 'IMPORT_CSV', params: { filePath: 'data.csv' } },
        { type: 'VALIDATE_DATA', params: { schema: {} } }
      ]
    }
  ];

  const fusion = new IntentFusion({ enableCache: true });

  for (const pattern of patterns) {
    const start = Date.now();

    // 首次执行（缓存未命中）
    await fusion.fuseIntents(pattern.intents, { sessionId: `test-${pattern.name}-1` });

    // 第二次执行（缓存命中）
    await fusion.fuseIntents(pattern.intents, { sessionId: `test-${pattern.name}-2` });

    const time = Date.now() - start;
    console.log(`  ✓ ${pattern.name}: ${time}ms`);
  }

  const finalStats = fusion.getPerformanceStats();
  console.log(`\n📈 综合统计:`);
  console.log(`  ✓ 平均融合时间: ${finalStats.averageTime.toFixed(2)}ms`);
  console.log(`  ✓ 缓存命中率: ${(finalStats.cacheHitRate * 100).toFixed(2)}%`);

  // 测试4: 缓存LRU淘汰
  console.log('\n📊 测试4: 缓存LRU淘汰测试');
  const lruFusion = new IntentFusion({ enableCache: true, cacheMaxSize: 5 });

  // 添加10个不同的融合模式（超过缓存大小）
  for (let i = 0; i < 10; i++) {
    await lruFusion.fuseIntents([
      { type: 'CREATE_FILE', params: { filePath: `file${i}.txt` } },
      { type: 'WRITE_FILE', params: { filePath: `file${i}.txt`, content: 'test' } }
    ], { sessionId: `lru-${i}` });
  }

  const lruStats = lruFusion.getPerformanceStats();
  console.log(`  ✓ 缓存大小: ${lruStats.cacheSize} (最大: 5)`);
  console.log(`  ✓ 缓存已淘汰: ${lruStats.cacheMisses - lruStats.cacheSize} 条目`);

  console.log('\n======== 测试完成 ========\n');
}

testPerformance().catch(console.error);
