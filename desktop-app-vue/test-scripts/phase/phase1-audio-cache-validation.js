/**
 * Phase 1 音频缓存优化验证脚本
 *
 * 验证内容：
 * 1. 流式哈希计算内存占用
 * 2. 增强缓存键生成
 * 3. 内存大小限制和LRU驱逐
 * 4. 异步写入队列
 * 5. 向后兼容性
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AudioCache = require('../src/main/speech/audio-cache');

// 测试配置
const TEST_CACHE_DIR = path.join(__dirname, '.temp-cache-test');
const TEST_RESULTS = {
  passed: 0,
  failed: 0,
  tests: []
};

// 辅助函数：创建测试音频文件
function createTestAudioFile(sizeMB, filePath) {
  const buffer = Buffer.alloc(sizeMB * 1024 * 1024);
  // 填充随机数据
  crypto.randomFillSync(buffer);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

// 辅助函数：获取当前内存使用
function getMemoryUsage() {
  const usage = process.memoryUsage();
  return {
    heapUsed: usage.heapUsed,
    heapUsedMB: (usage.heapUsed / 1024 / 1024).toFixed(2),
    external: usage.external,
    externalMB: (usage.external / 1024 / 1024).toFixed(2)
  };
}

// 测试1: 流式哈希计算内存占用
async function test1_StreamingHashMemory() {
  console.log('\n=== 测试1: 流式哈希计算内存占用 ===');

  const testFile = path.join(TEST_CACHE_DIR, 'large-audio-100mb.bin');

  try {
    // 创建100MB测试文件
    console.log('创建100MB测试文件...');
    createTestAudioFile(100, testFile);

    const cache = new AudioCache(TEST_CACHE_DIR);

    // 强制垃圾回收（如果可用）
    if (global.gc) {
      global.gc();
    }

    const memBefore = getMemoryUsage();
    console.log(`内存使用（处理前）: ${memBefore.heapUsedMB}MB`);

    // 计算哈希（流式处理）
    const startTime = Date.now();
    const hash = await cache.calculateHash(testFile);
    const duration = Date.now() - startTime;

    const memAfter = getMemoryUsage();
    console.log(`内存使用（处理后）: ${memAfter.heapUsedMB}MB`);

    const memIncrease = memAfter.heapUsed - memBefore.heapUsed;
    const memIncreaseMB = (memIncrease / 1024 / 1024).toFixed(2);

    console.log(`哈希值: ${hash}`);
    console.log(`耗时: ${duration}ms`);
    console.log(`内存增长: ${memIncreaseMB}MB`);

    // 验证：内存增长应小于10MB（远小于100MB文件大小）
    const passed = memIncrease < 10 * 1024 * 1024;

    TEST_RESULTS.tests.push({
      name: '流式哈希内存占用',
      passed,
      memIncreaseMB,
      expected: '< 10MB',
      duration
    });

    if (passed) {
      console.log('✅ 通过：内存增长 < 10MB');
      TEST_RESULTS.passed++;
    } else {
      console.log(`❌ 失败：内存增长 ${memIncreaseMB}MB 超过预期`);
      TEST_RESULTS.failed++;
    }

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    TEST_RESULTS.failed++;
    TEST_RESULTS.tests.push({
      name: '流式哈希内存占用',
      passed: false,
      error: error.message
    });
  } finally {
    // 清理测试文件
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
  }
}

// 测试2: 增强缓存键生成
async function test2_EnhancedCacheKey() {
  console.log('\n=== 测试2: 增强缓存键生成 ===');

  const testFile = path.join(TEST_CACHE_DIR, 'test-audio.bin');

  try {
    // 创建小测试文件
    createTestAudioFile(1, testFile);

    const cache = new AudioCache(TEST_CACHE_DIR);

    // 生成不同参数的缓存键
    const key1 = await cache.generateCacheKey(testFile, {
      engine: 'whisper',
      language: 'zh',
      model: 'base'
    });

    const key2 = await cache.generateCacheKey(testFile, {
      engine: 'azure',
      language: 'zh',
      model: 'base'
    });

    const key3 = await cache.generateCacheKey(testFile, {
      engine: 'whisper',
      language: 'en',
      model: 'base'
    });

    console.log(`缓存键1 (whisper/zh): ${key1}`);
    console.log(`缓存键2 (azure/zh):   ${key2}`);
    console.log(`缓存键3 (whisper/en): ${key3}`);

    // 验证：不同参数应生成不同缓存键
    const passed = (key1 !== key2) && (key1 !== key3) && (key2 !== key3);

    TEST_RESULTS.tests.push({
      name: '增强缓存键生成',
      passed,
      key1, key2, key3,
      expected: '不同参数生成不同缓存键'
    });

    if (passed) {
      console.log('✅ 通过：不同参数生成不同缓存键');
      TEST_RESULTS.passed++;
    } else {
      console.log('❌ 失败：缓存键冲突');
      TEST_RESULTS.failed++;
    }

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    TEST_RESULTS.failed++;
    TEST_RESULTS.tests.push({
      name: '增强缓存键生成',
      passed: false,
      error: error.message
    });
  } finally {
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
  }
}

// 测试3: 内存大小限制和LRU驱逐
async function test3_MemorySizeLimit() {
  console.log('\n=== 测试3: 内存大小限制和LRU驱逐 ===');

  try {
    // 创建一个内存限制为10MB的缓存
    const cache = new AudioCache(TEST_CACHE_DIR, {
      maxMemorySize: 10 * 1024 * 1024, // 10MB
      maxMemoryEntries: 100
    });

    await cache.initialize();

    console.log('添加多个大型缓存项...');

    // 添加15MB的数据（应触发驱逐）
    const largeText1 = 'x'.repeat(5 * 1024 * 1024); // 5MB
    const largeText2 = 'y'.repeat(6 * 1024 * 1024); // 6MB
    const largeText3 = 'z'.repeat(4 * 1024 * 1024); // 4MB

    await cache.set('hash1', { text: largeText1 }, { engine: 'whisper', language: 'zh' });
    console.log(`当前内存: ${(cache.currentMemorySize / 1024 / 1024).toFixed(2)}MB`);

    await cache.set('hash2', { text: largeText2 }, { engine: 'whisper', language: 'en' });
    console.log(`当前内存: ${(cache.currentMemorySize / 1024 / 1024).toFixed(2)}MB`);

    await cache.set('hash3', { text: largeText3 }, { engine: 'azure', language: 'zh' });
    console.log(`当前内存: ${(cache.currentMemorySize / 1024 / 1024).toFixed(2)}MB`);

    // 验证：内存应保持在限制以下
    const passed = cache.currentMemorySize <= cache.maxMemorySize;
    const currentMB = (cache.currentMemorySize / 1024 / 1024).toFixed(2);
    const maxMB = (cache.maxMemorySize / 1024 / 1024).toFixed(2);

    TEST_RESULTS.tests.push({
      name: '内存大小限制',
      passed,
      currentMemoryMB: currentMB,
      maxMemoryMB: maxMB,
      expected: `<= ${maxMB}MB`
    });

    if (passed) {
      console.log(`✅ 通过：内存使用 ${currentMB}MB <= ${maxMB}MB`);
      TEST_RESULTS.passed++;
    } else {
      console.log(`❌ 失败：内存使用 ${currentMB}MB 超过限制 ${maxMB}MB`);
      TEST_RESULTS.failed++;
    }

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    TEST_RESULTS.failed++;
    TEST_RESULTS.tests.push({
      name: '内存大小限制',
      passed: false,
      error: error.message
    });
  }
}

// 测试4: 异步写入队列
async function test4_AsyncWriteQueue() {
  console.log('\n=== 测试4: 异步写入队列 ===');

  try {
    const cache = new AudioCache(TEST_CACHE_DIR);
    await cache.initialize();

    console.log('快速连续写入10个缓存项...');

    const startTime = Date.now();

    // 快速连续写入（应立即返回，异步写入）
    const writePromises = [];
    for (let i = 0; i < 10; i++) {
      writePromises.push(
        cache.set(`test-hash-${i}`, {
          text: `测试文本 ${i}`,
          timestamp: Date.now()
        }, {
          engine: 'whisper',
          language: 'zh'
        })
      );
    }

    // 等待所有set操作完成（应该很快，因为是异步的）
    await Promise.all(writePromises);
    const syncDuration = Date.now() - startTime;

    console.log(`set()调用完成耗时: ${syncDuration}ms`);

    // 等待异步写入完成
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 验证文件是否已写入
    let filesWritten = 0;
    const files = fs.readdirSync(TEST_CACHE_DIR);
    for (const file of files) {
      if (file.endsWith('.json')) {
        filesWritten++;
      }
    }

    console.log(`已写入文件数: ${filesWritten}`);

    // 验证：set()应该很快（<100ms），且文件已写入
    const passed = syncDuration < 100 && filesWritten >= 10;

    TEST_RESULTS.tests.push({
      name: '异步写入队列',
      passed,
      syncDurationMs: syncDuration,
      filesWritten,
      expected: 'set()耗时<100ms且文件已写入'
    });

    if (passed) {
      console.log(`✅ 通过：异步写入快速完成 (${syncDuration}ms)`);
      TEST_RESULTS.passed++;
    } else {
      console.log(`❌ 失败：写入耗时 ${syncDuration}ms 或文件未写入完整`);
      TEST_RESULTS.failed++;
    }

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    TEST_RESULTS.failed++;
    TEST_RESULTS.tests.push({
      name: '异步写入队列',
      passed: false,
      error: error.message
    });
  }
}

// 测试5: 向后兼容性
async function test5_BackwardCompatibility() {
  console.log('\n=== 测试5: 向后兼容性 ===');

  const testFile = path.join(TEST_CACHE_DIR, 'test-compat.bin');

  try {
    createTestAudioFile(1, testFile);

    const cache = new AudioCache(TEST_CACHE_DIR);
    await cache.initialize();

    // 计算旧格式哈希（仅文件内容）
    const oldHash = await cache.calculateHash(testFile);
    console.log(`旧格式哈希: ${oldHash}`);

    // 模拟旧格式缓存文件
    const oldCachePath = cache.getCachePath(oldHash);
    const oldCacheEntry = {
      hash: oldHash,
      result: { text: '这是旧格式缓存', confidence: 0.95 },
      timestamp: Date.now()
    };

    fs.writeFileSync(oldCachePath, JSON.stringify(oldCacheEntry, null, 2));
    console.log('已创建旧格式缓存文件');

    // 尝试使用新API读取旧格式缓存
    const result = await cache.get(oldHash, {
      engine: 'whisper',
      language: 'zh'
    });

    console.log('读取结果:', result);

    // 验证：应能读取旧格式缓存
    const passed = result !== null && result.text === '这是旧格式缓存';

    TEST_RESULTS.tests.push({
      name: '向后兼容性',
      passed,
      result,
      expected: '能读取旧格式缓存'
    });

    if (passed) {
      console.log('✅ 通过：成功读取旧格式缓存');
      TEST_RESULTS.passed++;
    } else {
      console.log('❌ 失败：无法读取旧格式缓存');
      TEST_RESULTS.failed++;
    }

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    TEST_RESULTS.failed++;
    TEST_RESULTS.tests.push({
      name: '向后兼容性',
      passed: false,
      error: error.message
    });
  } finally {
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
  }
}

// 主测试函数
async function runAllTests() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  Phase 1 音频缓存优化验证                    ║');
  console.log('╚══════════════════════════════════════════════╝');

  // 创建临时测试目录
  if (!fs.existsSync(TEST_CACHE_DIR)) {
    fs.mkdirSync(TEST_CACHE_DIR, { recursive: true });
  }

  try {
    await test1_StreamingHashMemory();
    await test2_EnhancedCacheKey();
    await test3_MemorySizeLimit();
    await test4_AsyncWriteQueue();
    await test5_BackwardCompatibility();

    // 输出测试结果
    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║  测试结果汇总                                ║');
    console.log('╚══════════════════════════════════════════════╝');
    console.log(`\n总计: ${TEST_RESULTS.passed + TEST_RESULTS.failed} 个测试`);
    console.log(`✅ 通过: ${TEST_RESULTS.passed}`);
    console.log(`❌ 失败: ${TEST_RESULTS.failed}`);

    if (TEST_RESULTS.failed === 0) {
      console.log('\n🎉 所有测试通过！Phase 1 优化验证成功！');
      process.exit(0);
    } else {
      console.log('\n⚠️  部分测试失败，请检查以上详情');
      process.exit(1);
    }

  } catch (error) {
    console.error('\n❌ 测试执行失败:', error);
    process.exit(1);
  } finally {
    // 清理临时目录
    if (fs.existsSync(TEST_CACHE_DIR)) {
      const files = fs.readdirSync(TEST_CACHE_DIR);
      for (const file of files) {
        fs.unlinkSync(path.join(TEST_CACHE_DIR, file));
      }
      fs.rmdirSync(TEST_CACHE_DIR);
    }
  }
}

// 运行测试
runAllTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
