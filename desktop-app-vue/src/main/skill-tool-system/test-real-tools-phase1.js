/**
 * Phase 1 真实功能测试
 * 测试二维码和文件压缩的真实实现
 */

// 设置环境变量启用真实实现
process.env.USE_REAL_TOOLS = 'true';

const FunctionCaller = require('../ai-engine/function-caller');
const fs = require('fs').promises;
const path = require('path');

async function testPhase1RealTools() {
  console.log('========================================');
  console.log('Phase 1 真实功能测试');
  console.log('========================================\n');

  const functionCaller = new FunctionCaller();
  const testDir = path.join(__dirname, '../../test-output');

  // 确保测试目录存在
  await fs.mkdir(testDir, { recursive: true });

  let passedTests = 0;
  let failedTests = 0;
  const results = [];

  // ==================== 测试1: 二维码生成 ====================
  console.log('📝 测试1: 生成二维码\n');
  try {
    const qrResult = await functionCaller.call('qrcode_generator_advanced', {
      content: 'https://chainlesschain.com',
      output_path: path.join(testDir, 'test-qrcode.png'),
      size: 512,
      error_correction: 'H',
      style: {
        foreground_color: '#000000',
        background_color: '#FFFFFF'
      }
    });

    if (qrResult.success) {
      // 验证文件是否真的创建了
      try {
        const stats = await fs.stat(qrResult.output_path);
        console.log('   ✅ 二维码生成成功!');
        console.log(`   → 文件路径: ${qrResult.output_path}`);
        console.log(`   → 文件大小: ${stats.size} 字节`);
        console.log(`   → 图片尺寸: ${qrResult.size}x${qrResult.size}`);
        console.log(`   → 容错级别: ${qrResult.error_correction}\n`);
        passedTests++;
        results.push({ test: '二维码生成', status: '通过', file: qrResult.output_path });
      } catch (fileError) {
        console.log(`   ❌ 文件未创建: ${fileError.message}\n`);
        failedTests++;
        results.push({ test: '二维码生成', status: '失败', error: '文件未创建' });
      }
    } else {
      console.log(`   ❌ 生成失败: ${qrResult.error}\n`);
      failedTests++;
      results.push({ test: '二维码生成', status: '失败', error: qrResult.error });
    }
  } catch (error) {
    console.log(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '二维码生成', status: '异常', error: error.message });
  }

  // ==================== 测试2: 二维码扫描 ====================
  console.log('📝 测试2: 扫描二维码\n');
  try {
    const qrPath = path.join(testDir, 'test-qrcode.png');

    // 检查二维码文件是否存在
    try {
      await fs.access(qrPath);
    } catch {
      console.log('   ⚠️  跳过: 测试二维码文件不存在\n');
      results.push({ test: '二维码扫描', status: '跳过', reason: '测试文件不存在' });
      failedTests++;
    }

    const scanResult = await functionCaller.call('qrcode_scanner', {
      image_path: qrPath,
      scan_type: 'auto',
      multiple: false
    });

    if (scanResult.success) {
      console.log('   ✅ 二维码扫描成功!');
      console.log(`   → 找到 ${scanResult.codes_found} 个二维码`);
      if (scanResult.codes && scanResult.codes.length > 0) {
        console.log(`   → 内容: ${scanResult.codes[0].data}`);
        console.log(`   → 位置: x=${scanResult.codes[0].position.x}, y=${scanResult.codes[0].position.y}\n`);
      }
      passedTests++;
      results.push({ test: '二维码扫描', status: '通过', data: scanResult.codes[0]?.data });
    } else {
      console.log(`   ❌ 扫描失败: ${scanResult.error}\n`);
      failedTests++;
      results.push({ test: '二维码扫描', status: '失败', error: scanResult.error });
    }
  } catch (error) {
    console.log(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '二维码扫描', status: '异常', error: error.message });
  }

  // ==================== 测试3: 文件压缩 ====================
  console.log('📝 测试3: 文件压缩\n');
  try {
    // 创建测试文件
    const testFile1 = path.join(testDir, 'test1.txt');
    const testFile2 = path.join(testDir, 'test2.txt');
    await fs.writeFile(testFile1, 'Hello World from Test File 1!\n'.repeat(100));
    await fs.writeFile(testFile2, 'Hello World from Test File 2!\n'.repeat(100));

    const zipResult = await functionCaller.call('file_compressor', {
      files: [testFile1, testFile2],
      output_path: path.join(testDir, 'test-archive.zip'),
      format: 'zip',
      compression_level: 'normal'
    });

    if (zipResult.success) {
      // 验证压缩包是否创建
      try {
        const stats = await fs.stat(zipResult.output_path);
        console.log('   ✅ 文件压缩成功!');
        console.log(`   → 压缩包路径: ${zipResult.output_path}`);
        console.log(`   → 原始大小: ${zipResult.original_size} 字节`);
        console.log(`   → 压缩后: ${zipResult.compressed_size} 字节`);
        console.log(`   → 压缩率: ${zipResult.compression_ratio}`);
        console.log(`   → 文件数: ${zipResult.files_count} 个\n`);
        passedTests++;
        results.push({
          test: '文件压缩',
          status: '通过',
          file: zipResult.output_path,
          ratio: zipResult.compression_ratio
        });
      } catch (fileError) {
        console.log(`   ❌ 压缩包未创建: ${fileError.message}\n`);
        failedTests++;
        results.push({ test: '文件压缩', status: '失败', error: '文件未创建' });
      }
    } else {
      console.log(`   ❌ 压缩失败: ${zipResult.error}\n`);
      failedTests++;
      results.push({ test: '文件压缩', status: '失败', error: zipResult.error });
    }
  } catch (error) {
    console.log(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '文件压缩', status: '异常', error: error.message });
  }

  // ==================== 测试4: 文件解压 ====================
  console.log('📝 测试4: 文件解压\n');
  try {
    const zipPath = path.join(testDir, 'test-archive.zip');
    const extractDir = path.join(testDir, 'extracted');

    // 检查压缩包是否存在
    try {
      await fs.access(zipPath);
    } catch {
      console.log('   ⚠️  跳过: 测试压缩包不存在\n');
      results.push({ test: '文件解压', status: '跳过', reason: '测试文件不存在' });
      failedTests++;
    }

    const unzipResult = await functionCaller.call('file_decompressor', {
      archive_path: zipPath,
      output_dir: extractDir,
      overwrite: true
    });

    if (unzipResult.success) {
      console.log('   ✅ 文件解压成功!');
      console.log(`   → 解压目录: ${unzipResult.output_dir}`);
      console.log(`   → 解压文件: ${unzipResult.extracted_files} 个`);
      console.log(`   → 总大小: ${unzipResult.total_size} 字节`);
      console.log(`   → 文件列表:`);
      unzipResult.files.forEach(file => {
        console.log(`      - ${file}`);
      });
      console.log('');
      passedTests++;
      results.push({
        test: '文件解压',
        status: '通过',
        files: unzipResult.extracted_files
      });
    } else {
      console.log(`   ❌ 解压失败: ${unzipResult.error}\n`);
      failedTests++;
      results.push({ test: '文件解压', status: '失败', error: unzipResult.error });
    }
  } catch (error) {
    console.log(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '文件解压', status: '异常', error: error.message });
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
    if (result.file) console.log(`   文件: ${result.file}`);
    if (result.error) console.log(`   错误: ${result.error}`);
    if (result.data) console.log(`   数据: ${result.data}`);
    if (result.ratio) console.log(`   压缩率: ${result.ratio}`);
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
  testPhase1RealTools()
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

module.exports = { testPhase1RealTools };
