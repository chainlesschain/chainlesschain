/**
 * 大文件处理性能测试
 * 测试优化后的文件处理性能
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { getFileHandler } = require('../../src/main/utils/file-handler');

// 生成测试CSV文件
async function generateLargeCSV(filePath, rowCount) {
  const startTime = Date.now();
  console.log(`[Test] 生成测试CSV文件: ${rowCount} 行...`);

  const fileHandler = getFileHandler();

  // 使用流式写入生成大文件
  const dataGenerator = async function* () {
    // 表头
    yield 'ID,Name,Email,Age,City,Phone,Address,Company,Position,Salary\n';

    // 数据行
    for (let i = 1; i <= rowCount; i++) {
      const row = `${i},User${i},user${i}@example.com,${20 + (i % 50)},City${i % 100},123456789${i % 10},Address ${i},Company${i % 50},Position${i % 20},${30000 + i * 100}\n`;
      yield row;

      // 每10000行检查一次内存
      if (i % 10000 === 0) {
        const memStatus = fileHandler.checkAvailableMemory();
        if (!memStatus.isAvailable) {
          console.log(`[Test] 内存使用率过高 (${(memStatus.usageRatio * 100).toFixed(2)}%)，等待...`);
          await fileHandler.waitForMemory();
        }
      }
    }
  };

  await fileHandler.writeFileStream(filePath, dataGenerator(), {
    encoding: 'utf8'
  });

  const duration = Date.now() - startTime;
  const fileSize = (await fs.stat(filePath)).size;

  console.log(
    `[Test] CSV文件生成完成: ` +
      `${rowCount} 行, ` +
      `大小: ${(fileSize / 1024 / 1024).toFixed(2)}MB, ` +
      `耗时: ${duration}ms`
  );

  return { filePath, fileSize, duration };
}

// 测试Excel引擎读取性能
async function testExcelEnginePerformance(filePath) {
  console.log('\n=== 测试Excel Engine性能 ===\n');

  // 动态导入ExcelEngine
  const excelEnginePath = path.join(
    __dirname,
    '../../src/main/engines/excel-engine.js'
  );

  // 清除缓存以确保获取最新代码
  delete require.cache[require.resolve(excelEnginePath)];
  const excelEngine = require(excelEnginePath);

  const fileHandler = getFileHandler();
  const initialMemStatus = fileHandler.checkAvailableMemory();

  console.log('[Test] 初始内存状态:', {
    free: `${(initialMemStatus.freeMem / 1024 / 1024).toFixed(2)}MB`,
    total: `${(initialMemStatus.totalMem / 1024 / 1024).toFixed(2)}MB`,
    usage: `${(initialMemStatus.usageRatio * 100).toFixed(2)}%`,
  });

  const startTime = Date.now();
  const startMemory = process.memoryUsage();

  try {
    // 读取CSV文件
    const result = await excelEngine.readCSV(filePath);

    const endTime = Date.now();
    const endMemory = process.memoryUsage();

    const duration = endTime - startTime;
    const memoryIncrease = {
      rss: ((endMemory.rss - startMemory.rss) / 1024 / 1024).toFixed(2),
      heapTotal: ((endMemory.heapTotal - startMemory.heapTotal) / 1024 / 1024).toFixed(2),
      heapUsed: ((endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024).toFixed(2),
      external: ((endMemory.external - startMemory.external) / 1024 / 1024).toFixed(2),
    };

    console.log('\n[Test] Excel Engine性能结果:');
    console.log(`  - 读取耗时: ${duration}ms`);
    console.log(`  - 数据行数: ${result.sheets[0].rows.length}`);
    console.log(`  - 内存增长 (RSS): ${memoryIncrease.rss}MB`);
    console.log(`  - 内存增长 (Heap Used): ${memoryIncrease.heapUsed}MB`);
    console.log(`  - 平均处理速度: ${(result.sheets[0].rows.length / (duration / 1000)).toFixed(0)} rows/s`);

    const finalMemStatus = fileHandler.checkAvailableMemory();
    console.log('\n[Test] 最终内存状态:', {
      free: `${(finalMemStatus.freeMem / 1024 / 1024).toFixed(2)}MB`,
      usage: `${(finalMemStatus.usageRatio * 100).toFixed(2)}%`,
    });

    return {
      success: true,
      duration,
      rowCount: result.sheets[0].rows.length,
      memoryIncrease,
    };
  } catch (error) {
    console.error('[Test] Excel Engine测试失败:', error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

// 测试文件流式处理性能
async function testFileHandlerPerformance(filePath) {
  console.log('\n=== 测试FileHandler性能 ===\n');

  const fileHandler = getFileHandler();
  const fileSize = (await fs.stat(filePath)).size;

  let lineCount = 0;
  const startTime = Date.now();

  await fileHandler.readFileStream(
    filePath,
    async (chunk, meta) => {
      // 计算这个chunk中的行数
      const lines = chunk.toString().split('\n').length;
      lineCount += lines;

      if (meta.chunkIndex % 10 === 0) {
        console.log(
          `[Test] 处理进度: ${meta.progress.toFixed(2)}%, ` +
            `已处理: ${(meta.processedSize / 1024 / 1024).toFixed(2)}MB`
        );
      }
    },
    {
      chunkSize: 1024 * 1024, // 1MB chunks
      encoding: 'utf8',
    }
  );

  const duration = Date.now() - startTime;

  console.log('\n[Test] FileHandler性能结果:');
  console.log(`  - 文件大小: ${(fileSize / 1024 / 1024).toFixed(2)}MB`);
  console.log(`  - 读取耗时: ${duration}ms`);
  console.log(`  - 读取速度: ${((fileSize / duration) * 1000 / 1024 / 1024).toFixed(2)}MB/s`);
  console.log(`  - 行数: ${lineCount}`);

  return {
    success: true,
    fileSize,
    duration,
    lineCount,
    throughput: (fileSize / duration) * 1000,
  };
}

// 运行所有测试
async function runTests() {
  console.log('\n==============================================');
  console.log('  大文件处理性能测试');
  console.log('==============================================\n');

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'perf-test-'));
  console.log('[Test] 临时目录:', tempDir);

  try {
    // 测试不同规模的文件
    const testSizes = [
      { name: '小文件', rows: 1000 },
      { name: '中等文件', rows: 10000 },
      { name: '大文件', rows: 100000 },
    ];

    const results = [];

    for (const testSize of testSizes) {
      console.log(`\n\n========== ${testSize.name} (${testSize.rows} 行) ==========`);

      const testFile = path.join(tempDir, `test_${testSize.rows}.csv`);

      // 生成测试文件
      await generateLargeCSV(testFile, testSize.rows);

      // 测试FileHandler
      const fileHandlerResult = await testFileHandlerPerformance(testFile);

      // 测试Excel Engine
      const excelEngineResult = await testExcelEnginePerformance(testFile);

      results.push({
        name: testSize.name,
        rows: testSize.rows,
        fileHandler: fileHandlerResult,
        excelEngine: excelEngineResult,
      });

      // 清理
      await fs.unlink(testFile);

      // 强制垃圾回收（如果可用）
      if (global.gc) {
        global.gc();
      }

      // 等待一段时间以释放内存
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // 输出测试总结
    console.log('\n\n==============================================');
    console.log('  测试总结');
    console.log('==============================================\n');

    for (const result of results) {
      console.log(`${result.name} (${result.rows} 行):`);
      console.log(`  FileHandler: ${result.fileHandler.duration}ms`);
      console.log(`  Excel Engine: ${result.excelEngine.duration}ms`);
      console.log('');
    }
  } finally {
    // 清理临时目录
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.error('[Test] 清理临时目录失败:', error);
    }
  }

  console.log('[Test] 所有测试完成\n');
}

// 如果直接运行此文件
if (require.main === module) {
  runTests().catch((error) => {
    console.error('[Test] 测试失败:', error);
    process.exit(1);
  });
}

module.exports = {
  generateLargeCSV,
  testExcelEnginePerformance,
  testFileHandlerPerformance,
  runTests,
};
