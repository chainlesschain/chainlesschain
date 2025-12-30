/**
 * Phase 7 真实功能测试
 * 测试截图工具和网速测试器的真实实现
 */

// 设置环境变量启用真实实现
process.env.USE_REAL_TOOLS = 'true';

const FunctionCaller = require('../ai-engine/function-caller');
const fs = require('fs').promises;
const path = require('path');

async function testPhase7RealTools() {
  console.log('========================================');
  console.log('Phase 7 真实功能测试 - 截图和网速测试');
  console.log('========================================\n');

  const functionCaller = new FunctionCaller();
  const testDir = path.join(__dirname, '../../test-output');

  // 确保测试目录存在
  await fs.mkdir(testDir, { recursive: true });

  let passedTests = 0;
  let failedTests = 0;
  const results = [];

  // ==================== 截图工具测试 ====================

  console.log('📸 截图工具测试\n');
  console.log('═══════════════════════════════════════\n');

  // ==================== 测试1: 截取主屏幕 ====================
  console.log('📝 测试1: 截取主屏幕\n');
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

      console.log('   ✅ 截图成功!');
      console.log(`   → 输出路径: ${result.output_path}`);
      console.log(`   → 屏幕索引: ${result.screen_index}`);
      console.log(`   → 屏幕ID: ${result.screen_id}`);
      console.log(`   → 屏幕名称: ${result.screen_name}`);
      console.log(`   → 文件大小: ${(result.file_size / 1024).toFixed(2)} KB`);
      console.log(`   → 格式: ${result.format}`);
      console.log(`   → 可用屏幕数: ${result.available_screens}个`);
      console.log(`   → 实际文件大小: ${(stats.size / 1024).toFixed(2)} KB\n`);

      // 验证文件存在且不为空
      if (stats.size > 0) {
        passedTests++;
        results.push({
          test: '截取主屏幕',
          status: '通过',
          file_size: stats.size
        });
      } else {
        console.log('   ⚠️  文件大小为0\n');
        failedTests++;
        results.push({ test: '截取主屏幕', status: '失败', error: '文件大小为0' });
      }
    } else {
      console.log(`   ❌ 截图失败: ${result.error}\n`);
      failedTests++;
      results.push({ test: '截取主屏幕', status: '失败', error: result.error });
    }
  } catch (error) {
    console.log(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '截取主屏幕', status: '异常', error: error.message });
  }

  // ==================== 测试2: 截图并检查文件格式 ====================
  console.log('📝 测试2: 验证PNG格式\n');
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
        console.log('   ✅ PNG格式验证成功!');
        console.log(`   → 文件签名: ${buffer.slice(0, 4).toString('hex').toUpperCase()}`);
        console.log(`   → 格式: PNG\n`);

        passedTests++;
        results.push({ test: 'PNG格式验证', status: '通过' });
      } else {
        console.log('   ❌ 不是有效的PNG文件\n');
        failedTests++;
        results.push({ test: 'PNG格式验证', status: '失败', error: '非PNG格式' });
      }
    } else {
      console.log(`   ❌ 截图失败: ${result.error}\n`);
      failedTests++;
      results.push({ test: 'PNG格式验证', status: '失败', error: result.error });
    }
  } catch (error) {
    console.log(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: 'PNG格式验证', status: '异常', error: error.message });
  }

  // ==================== 网速测试器测试 ====================

  console.log('🌐 网速测试器测试\n');
  console.log('═══════════════════════════════════════\n');

  // ==================== 测试3: 网速测试 (完整测试) ====================
  console.log('📝 测试3: 网速测试 (下载+上传+延迟)\n');
  console.log('   ⏳ 正在进行网速测试，请耐心等待 (可能需要30-60秒)...\n');

  try {
    const result = await functionCaller.call('network_speed_tester', {
      test_type: 'both'
    });

    if (result.success) {
      console.log('   ✅ 网速测试成功!');
      console.log(`   → 测试类型: ${result.test_type}`);
      console.log(`\n   📥 下载速度:`);
      console.log(`      → ${result.download.speed_mbps} Mbps`);
      console.log(`      → 带宽: ${result.download.bandwidth} bytes/s`);
      console.log(`      → 传输: ${(result.download.bytes / 1024 / 1024).toFixed(2)} MB`);
      console.log(`      → 耗时: ${result.download.elapsed} ms`);

      console.log(`\n   📤 上传速度:`);
      console.log(`      → ${result.upload.speed_mbps} Mbps`);
      console.log(`      → 带宽: ${result.upload.bandwidth} bytes/s`);
      console.log(`      → 传输: ${(result.upload.bytes / 1024 / 1024).toFixed(2)} MB`);
      console.log(`      → 耗时: ${result.upload.elapsed} ms`);

      console.log(`\n   📡 延迟:`);
      console.log(`      → 延迟: ${result.ping.latency.toFixed(2)} ms`);
      console.log(`      → 抖动: ${result.ping.jitter.toFixed(2)} ms`);

      console.log(`\n   🖥️  测试服务器:`);
      console.log(`      → ID: ${result.server.id}`);
      console.log(`      → 名称: ${result.server.name}`);
      console.log(`      → 位置: ${result.server.location}`);
      console.log(`      → 国家: ${result.server.country}`);
      console.log(`      → IP: ${result.server.ip}`);

      console.log(`\n   ℹ️  其他信息:`);
      console.log(`      → ISP: ${result.isp}`);
      if (result.result_url) {
        console.log(`      → 结果URL: ${result.result_url}`);
      }
      console.log(`      → 时间戳: ${result.timestamp}\n`);

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
        console.log('   ⚠️  速度测试结果异常\n');
        failedTests++;
        results.push({ test: '网速测试', status: '失败', error: '速度为0' });
      }
    } else {
      console.log(`   ❌ 测试失败: ${result.error}\n`);
      failedTests++;
      results.push({ test: '网速测试', status: '失败', error: result.error });
    }
  } catch (error) {
    console.log(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '网速测试', status: '异常', error: error.message });
  }

  // ==================== 测试总结 ====================
  console.log('========================================');
  console.log('测试总结');
  console.log('========================================\n');

  const totalTests = passedTests + failedTests;
  const successRate = totalTests > 0 ? ((passedTests / totalTests) * 100).toFixed(1) : 0;

  console.log(`总测试数: ${totalTests}`);
  console.log(`通过: ${passedTests} ✅`);
  console.log(`失败: ${failedTests} ❌`);
  console.log(`成功率: ${successRate}%\n`);

  console.log('详细结果:');
  results.forEach((result, index) => {
    const statusIcon = result.status === '通过' ? '✅' :
                      result.status === '跳过' ? '⏭️' : '❌';
    console.log(`${index + 1}. ${statusIcon} ${result.test} - ${result.status}`);
    if (result.file_size) console.log(`   文件大小: ${(result.file_size / 1024).toFixed(2)} KB`);
    if (result.error) console.log(`   错误: ${result.error}`);
    if (result.download) console.log(`   下载: ${result.download} Mbps`);
    if (result.upload) console.log(`   上传: ${result.upload} Mbps`);
    if (result.ping) console.log(`   延迟: ${result.ping.toFixed(2)} ms`);
  });

  console.log('\n========================================');
  console.log(`测试输出目录: ${testDir}`);
  console.log('========================================\n');

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
        console.log('🎉 所有测试通过!');
        process.exit(0);
      } else {
        console.log('⚠️ 有测试失败');
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error('❌ 测试执行失败:', error);
      console.error(error.stack);
      process.exit(1);
    });
}

module.exports = { testPhase7RealTools };
