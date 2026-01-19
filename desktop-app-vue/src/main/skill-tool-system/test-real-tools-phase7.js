/**
 * Phase 7 真实功能测试
 * 测试截图工具和网速测试器的真实实现
 */

// 设置环境变量启用真实实现
process.env.USE_REAL_TOOLS = 'true';

const { logger, createLogger } = require('../utils/logger.js');
const FunctionCaller = require('../ai-engine/function-caller');
const fs = require('fs').promises;
const path = require('path');

async function testPhase7RealTools() {
  logger.info('========================================');
  logger.info('Phase 7 真实功能测试 - 截图和网速测试');
  logger.info('========================================\n');

  const functionCaller = new FunctionCaller();
  const testDir = path.join(__dirname, '../../test-output');

  // 确保测试目录存在
  await fs.mkdir(testDir, { recursive: true });

  let passedTests = 0;
  let failedTests = 0;
  const results = [];

  // ==================== 截图工具测试 ====================

  logger.info('📸 截图工具测试\n');
  logger.info('═══════════════════════════════════════\n');

  // ==================== 测试1: 截取主屏幕 ====================
  logger.info('📝 测试1: 截取主屏幕\n');
  try {
    const screenshotPath = path.join(testDir, 'screenshot-test-1.png');

    const result = await functionCaller.call('screenshot_tool', {
      output_path: screenshotPath,
      screen_index: 0,
      format: 'png',
      quality: 100
    });

    if (result.success) {
      // 验证文件是否创建
      const stats = await fs.stat(screenshotPath);

      logger.info('   ✅ 截图成功!');
      logger.info(`   → 输出路径: ${result.output_path}`);
      logger.info(`   → 屏幕索引: ${result.screen_index}`);
      logger.info(`   → 屏幕ID: ${result.screen_id}`);
      logger.info(`   → 屏幕名称: ${result.screen_name}`);
      logger.info(`   → 文件大小: ${(result.file_size / 1024).toFixed(2)} KB`);
      logger.info(`   → 格式: ${result.format}`);
      logger.info(`   → 可用屏幕数: ${result.available_screens}个`);
      logger.info(`   → 实际文件大小: ${(stats.size / 1024).toFixed(2)} KB\n`);

      // 验证文件存在且不为空
      if (stats.size > 0) {
        passedTests++;
        results.push({
          test: '截取主屏幕',
          status: '通过',
          file_size: stats.size
        });
      } else {
        logger.info('   ⚠️  文件大小为0\n');
        failedTests++;
        results.push({ test: '截取主屏幕', status: '失败', error: '文件大小为0' });
      }
    } else {
      logger.info(`   ❌ 截图失败: ${result.error}\n`);
      failedTests++;
      results.push({ test: '截取主屏幕', status: '失败', error: result.error });
    }
  } catch (error) {
    logger.info(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '截取主屏幕', status: '异常', error: error.message });
  }

  // ==================== 测试2: 截图并检查文件格式 ====================
  logger.info('📝 测试2: 验证PNG格式\n');
  try {
    const screenshotPath = path.join(testDir, 'screenshot-test-2.png');

    const result = await functionCaller.call('screenshot_tool', {
      output_path: screenshotPath,
      screen_index: 0
    });

    if (result.success) {
      // 读取文件头部，验证是PNG格式
      const fileHandle = await fs.open(screenshotPath, 'r');
      const buffer = Buffer.alloc(8);
      await fileHandle.read(buffer, 0, 8, 0);
      await fileHandle.close();

      // PNG文件签名: 89 50 4E 47 0D 0A 1A 0A
      const isPNG = buffer[0] === 0x89 &&
                    buffer[1] === 0x50 &&
                    buffer[2] === 0x4E &&
                    buffer[3] === 0x47;

      if (isPNG) {
        logger.info('   ✅ PNG格式验证成功!');
        logger.info(`   → 文件签名: ${buffer.slice(0, 4).toString('hex').toUpperCase()}`);
        logger.info(`   → 格式: PNG\n`);

        passedTests++;
        results.push({ test: 'PNG格式验证', status: '通过' });
      } else {
        logger.info('   ❌ 不是有效的PNG文件\n');
        failedTests++;
        results.push({ test: 'PNG格式验证', status: '失败', error: '非PNG格式' });
      }
    } else {
      logger.info(`   ❌ 截图失败: ${result.error}\n`);
      failedTests++;
      results.push({ test: 'PNG格式验证', status: '失败', error: result.error });
    }
  } catch (error) {
    logger.info(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: 'PNG格式验证', status: '异常', error: error.message });
  }

  // ==================== 网速测试器测试 ====================

  logger.info('🌐 网速测试器测试\n');
  logger.info('═══════════════════════════════════════\n');

  // ==================== 测试3: 网速测试 (完整测试) ====================
  logger.info('📝 测试3: 网速测试 (下载+上传+延迟)\n');
  logger.info('   ⏳ 正在进行网速测试，请耐心等待 (可能需要30-60秒)...\n');

  try {
    const result = await functionCaller.call('network_speed_tester', {
      test_type: 'both'
    });

    if (result.success) {
      logger.info('   ✅ 网速测试成功!');
      logger.info(`   → 测试类型: ${result.test_type}`);
      logger.info(`\n   📥 下载速度:`);
      logger.info(`      → ${result.download.speed_mbps} Mbps`);
      logger.info(`      → 带宽: ${result.download.bandwidth} bytes/s`);
      logger.info(`      → 传输: ${(result.download.bytes / 1024 / 1024).toFixed(2)} MB`);
      logger.info(`      → 耗时: ${result.download.elapsed} ms`);

      logger.info(`\n   📤 上传速度:`);
      logger.info(`      → ${result.upload.speed_mbps} Mbps`);
      logger.info(`      → 带宽: ${result.upload.bandwidth} bytes/s`);
      logger.info(`      → 传输: ${(result.upload.bytes / 1024 / 1024).toFixed(2)} MB`);
      logger.info(`      → 耗时: ${result.upload.elapsed} ms`);

      logger.info(`\n   📡 延迟:`);
      logger.info(`      → 延迟: ${result.ping.latency.toFixed(2)} ms`);
      logger.info(`      → 抖动: ${result.ping.jitter.toFixed(2)} ms`);

      logger.info(`\n   🖥️  测试服务器:`);
      logger.info(`      → ID: ${result.server.id}`);
      logger.info(`      → 名称: ${result.server.name}`);
      logger.info(`      → 位置: ${result.server.location}`);
      logger.info(`      → 国家: ${result.server.country}`);
      logger.info(`      → IP: ${result.server.ip}`);

      logger.info(`\n   ℹ️  其他信息:`);
      logger.info(`      → ISP: ${result.isp}`);
      if (result.result_url) {
        logger.info(`      → 结果URL: ${result.result_url}`);
      }
      logger.info(`      → 时间戳: ${result.timestamp}\n`);

      // 验证速度是否合理（大于0）
      if (result.download.speed_mbps > 0 && result.upload.speed_mbps > 0) {
        passedTests++;
        results.push({
          test: '网速测试',
          status: '通过',
          download: result.download.speed_mbps,
          upload: result.upload.speed_mbps,
          ping: result.ping.latency
        });
      } else {
        logger.info('   ⚠️  速度测试结果异常\n');
        failedTests++;
        results.push({ test: '网速测试', status: '失败', error: '速度为0' });
      }
    } else {
      logger.info(`   ❌ 测试失败: ${result.error}\n`);
      failedTests++;
      results.push({ test: '网速测试', status: '失败', error: result.error });
    }
  } catch (error) {
    logger.info(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '网速测试', status: '异常', error: error.message });
  }

  // ==================== 测试总结 ====================
  logger.info('========================================');
  logger.info('测试总结');
  logger.info('========================================\n');

  const totalTests = passedTests + failedTests;
  const successRate = totalTests > 0 ? ((passedTests / totalTests) * 100).toFixed(1) : 0;

  logger.info(`总测试数: ${totalTests}`);
  logger.info(`通过: ${passedTests} ✅`);
  logger.info(`失败: ${failedTests} ❌`);
  logger.info(`成功率: ${successRate}%\n`);

  logger.info('详细结果:');
  results.forEach((result, index) => {
    const statusIcon = result.status === '通过' ? '✅' :
                      result.status === '跳过' ? '⏭️' : '❌';
    logger.info(`${index + 1}. ${statusIcon} ${result.test} - ${result.status}`);
    if (result.file_size) {logger.info(`   文件大小: ${(result.file_size / 1024).toFixed(2)} KB`);}
    if (result.error) {logger.info(`   错误: ${result.error}`);}
    if (result.download) {logger.info(`   下载: ${result.download} Mbps`);}
    if (result.upload) {logger.info(`   上传: ${result.upload} Mbps`);}
    if (result.ping) {logger.info(`   延迟: ${result.ping.toFixed(2)} ms`);}
  });

  logger.info('\n========================================');
  logger.info(`测试输出目录: ${testDir}`);
  logger.info('========================================\n');

  return {
    total: totalTests,
    passed: passedTests,
    failed: failedTests,
    successRate: successRate,
    results: results
  };
}

// 运行测试
if (require.main === module) {
  testPhase7RealTools()
    .then((summary) => {
      if (summary.failed === 0) {
        logger.info('🎉 所有测试通过!');
        process.exit(0);
      } else {
        logger.info('⚠️ 有测试失败');
        process.exit(1);
      }
    })
    .catch((error) => {
      logger.error('❌ 测试执行失败:', error);
      logger.error(error.stack);
      process.exit(1);
    });
}

module.exports = { testPhase7RealTools };
