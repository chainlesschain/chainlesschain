/**
 * Phase 2 真实功能测试
 * 测试图片处理的真实实现
 */

// 设置环境变量启用真实实现
process.env.USE_REAL_TOOLS = 'true';

const { logger, createLogger } = require('../utils/logger.js');
const FunctionCaller = require('../ai-engine/function-caller');
const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');

async function testPhase2RealTools() {
  logger.info('========================================');
  logger.info('Phase 2 真实功能测试 - 图片处理');
  logger.info('========================================\n');

  const functionCaller = new FunctionCaller();
  const testDir = path.join(__dirname, '../../test-output');

  // 确保测试目录存在
  await fs.mkdir(testDir, { recursive: true });

  let passedTests = 0;
  let failedTests = 0;
  const results = [];

  // ==================== 准备测试图片 ====================
  logger.info('📝 准备测试图片\n');

  const testImagePath = path.join(testDir, 'test-source.png');

  try {
    // 创建一个简单的测试图片（800x600，蓝色背景）
    await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 4,
        background: { r: 52, g: 152, b: 219, alpha: 1 }
      }
    })
    .png()
    .toFile(testImagePath);

    const stats = await fs.stat(testImagePath);
    logger.info(`   ✅ 测试图片创建成功`);
    logger.info(`   → 路径: ${testImagePath}`);
    logger.info(`   → 尺寸: 800x600`);
    logger.info(`   → 大小: ${stats.size} 字节\n`);
  } catch (error) {
    logger.info(`   ❌ 创建测试图片失败: ${error.message}\n`);
    process.exit(1);
  }

  // ==================== 测试1: 图片缩放 ====================
  logger.info('📝 测试1: 图片缩放\n');
  try {
    const result = await functionCaller.call('image_editor', {
      input_path: testImagePath,
      output_path: path.join(testDir, 'test-resized.png'),
      operations: {
        resize: {
          width: 400,
          height: 300,
          fit: 'cover'
        }
      }
    });

    if (result.success) {
      try {
        const stats = await fs.stat(result.output_path);
        const metadata = await sharp(result.output_path).metadata();

        logger.info('   ✅ 图片缩放成功!');
        logger.info(`   → 输出路径: ${result.output_path}`);
        logger.info(`   → 原始尺寸: ${result.original_dimensions.width}x${result.original_dimensions.height}`);
        logger.info(`   → 输出尺寸: ${metadata.width}x${metadata.height}`);
        logger.info(`   → 文件大小: ${stats.size} 字节`);
        logger.info(`   → 应用操作: ${result.operations_applied.join(', ')}\n`);

        passedTests++;
        results.push({ test: '图片缩放', status: '通过', file: result.output_path });
      } catch (fileError) {
        logger.info(`   ❌ 文件验证失败: ${fileError.message}\n`);
        failedTests++;
        results.push({ test: '图片缩放', status: '失败', error: '文件验证失败' });
      }
    } else {
      logger.info(`   ❌ 缩放失败: ${result.error}\n`);
      failedTests++;
      results.push({ test: '图片缩放', status: '失败', error: result.error });
    }
  } catch (error) {
    logger.info(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '图片缩放', status: '异常', error: error.message });
  }

  // ==================== 测试2: 图片裁剪 ====================
  logger.info('📝 测试2: 图片裁剪\n');
  try {
    const result = await functionCaller.call('image_editor', {
      input_path: testImagePath,
      output_path: path.join(testDir, 'test-cropped.png'),
      operations: {
        crop: {
          x: 100,
          y: 100,
          width: 400,
          height: 300
        }
      }
    });

    if (result.success) {
      try {
        const stats = await fs.stat(result.output_path);
        const metadata = await sharp(result.output_path).metadata();

        logger.info('   ✅ 图片裁剪成功!');
        logger.info(`   → 输出路径: ${result.output_path}`);
        logger.info(`   → 裁剪区域: 100,100 → 400x300`);
        logger.info(`   → 输出尺寸: ${metadata.width}x${metadata.height}`);
        logger.info(`   → 文件大小: ${stats.size} 字节`);
        logger.info(`   → 应用操作: ${result.operations_applied.join(', ')}\n`);

        passedTests++;
        results.push({ test: '图片裁剪', status: '通过', file: result.output_path });
      } catch (fileError) {
        logger.info(`   ❌ 文件验证失败: ${fileError.message}\n`);
        failedTests++;
        results.push({ test: '图片裁剪', status: '失败', error: '文件验证失败' });
      }
    } else {
      logger.info(`   ❌ 裁剪失败: ${result.error}\n`);
      failedTests++;
      results.push({ test: '图片裁剪', status: '失败', error: result.error });
    }
  } catch (error) {
    logger.info(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '图片裁剪', status: '异常', error: error.message });
  }

  // ==================== 测试3: 图片旋转 ====================
  logger.info('📝 测试3: 图片旋转\n');
  try {
    const result = await functionCaller.call('image_editor', {
      input_path: testImagePath,
      output_path: path.join(testDir, 'test-rotated.png'),
      operations: {
        rotate: {
          angle: 90
        }
      }
    });

    if (result.success) {
      try {
        const stats = await fs.stat(result.output_path);
        const metadata = await sharp(result.output_path).metadata();

        logger.info('   ✅ 图片旋转成功!');
        logger.info(`   → 输出路径: ${result.output_path}`);
        logger.info(`   → 旋转角度: 90°`);
        logger.info(`   → 输出尺寸: ${metadata.width}x${metadata.height}`);
        logger.info(`   → 文件大小: ${stats.size} 字节`);
        logger.info(`   → 应用操作: ${result.operations_applied.join(', ')}\n`);

        passedTests++;
        results.push({ test: '图片旋转', status: '通过', file: result.output_path });
      } catch (fileError) {
        logger.info(`   ❌ 文件验证失败: ${fileError.message}\n`);
        failedTests++;
        results.push({ test: '图片旋转', status: '失败', error: '文件验证失败' });
      }
    } else {
      logger.info(`   ❌ 旋转失败: ${result.error}\n`);
      failedTests++;
      results.push({ test: '图片旋转', status: '失败', error: result.error });
    }
  } catch (error) {
    logger.info(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '图片旋转', status: '异常', error: error.message });
  }

  // ==================== 测试4: 图片翻转 ====================
  logger.info('📝 测试4: 图片翻转\n');
  try {
    const result = await functionCaller.call('image_editor', {
      input_path: testImagePath,
      output_path: path.join(testDir, 'test-flipped.png'),
      operations: {
        flip: {
          horizontal: true,
          vertical: false
        }
      }
    });

    if (result.success) {
      try {
        const stats = await fs.stat(result.output_path);

        logger.info('   ✅ 图片翻转成功!');
        logger.info(`   → 输出路径: ${result.output_path}`);
        logger.info(`   → 翻转方向: 水平`);
        logger.info(`   → 文件大小: ${stats.size} 字节`);
        logger.info(`   → 应用操作: ${result.operations_applied.join(', ')}\n`);

        passedTests++;
        results.push({ test: '图片翻转', status: '通过', file: result.output_path });
      } catch (fileError) {
        logger.info(`   ❌ 文件验证失败: ${fileError.message}\n`);
        failedTests++;
        results.push({ test: '图片翻转', status: '失败', error: '文件验证失败' });
      }
    } else {
      logger.info(`   ❌ 翻转失败: ${result.error}\n`);
      failedTests++;
      results.push({ test: '图片翻转', status: '失败', error: result.error });
    }
  } catch (error) {
    logger.info(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '图片翻转', status: '异常', error: error.message });
  }

  // ==================== 测试5: 质量调整 ====================
  logger.info('📝 测试5: 质量调整\n');
  try {
    const result = await functionCaller.call('image_editor', {
      input_path: testImagePath,
      output_path: path.join(testDir, 'test-quality.jpg'),
      operations: {
        quality: 60
      }
    });

    if (result.success) {
      try {
        const stats = await fs.stat(result.output_path);

        logger.info('   ✅ 质量调整成功!');
        logger.info(`   → 输出路径: ${result.output_path}`);
        logger.info(`   → 质量: 60%`);
        logger.info(`   → 原始大小: ${result.original_dimensions.size} 字节`);
        logger.info(`   → 输出大小: ${stats.size} 字节`);
        logger.info(`   → 应用操作: ${result.operations_applied.join(', ')}\n`);

        passedTests++;
        results.push({ test: '质量调整', status: '通过', file: result.output_path });
      } catch (fileError) {
        logger.info(`   ❌ 文件验证失败: ${fileError.message}\n`);
        failedTests++;
        results.push({ test: '质量调整', status: '失败', error: '文件验证失败' });
      }
    } else {
      logger.info(`   ❌ 质量调整失败: ${result.error}\n`);
      failedTests++;
      results.push({ test: '质量调整', status: '失败', error: result.error });
    }
  } catch (error) {
    logger.info(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '质量调整', status: '异常', error: error.message });
  }

  // ==================== 测试6: 灰度滤镜 ====================
  logger.info('📝 测试6: 灰度滤镜\n');
  try {
    const result = await functionCaller.call('image_filter', {
      input_path: testImagePath,
      output_path: path.join(testDir, 'test-grayscale.png'),
      filters: {
        grayscale: true
      }
    });

    if (result.success) {
      try {
        const stats = await fs.stat(result.output_path);

        logger.info('   ✅ 灰度滤镜成功!');
        logger.info(`   → 输出路径: ${result.output_path}`);
        logger.info(`   → 应用滤镜: ${result.filters_applied.join(', ')}`);
        logger.info(`   → 滤镜数量: ${result.filter_count}`);
        logger.info(`   → 文件大小: ${stats.size} 字节\n`);

        passedTests++;
        results.push({ test: '灰度滤镜', status: '通过', file: result.output_path });
      } catch (fileError) {
        logger.info(`   ❌ 文件验证失败: ${fileError.message}\n`);
        failedTests++;
        results.push({ test: '灰度滤镜', status: '失败', error: '文件验证失败' });
      }
    } else {
      logger.info(`   ❌ 灰度滤镜失败: ${result.error}\n`);
      failedTests++;
      results.push({ test: '灰度滤镜', status: '失败', error: result.error });
    }
  } catch (error) {
    logger.info(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '灰度滤镜', status: '异常', error: error.message });
  }

  // ==================== 测试7: 模糊滤镜 ====================
  logger.info('📝 测试7: 模糊滤镜\n');
  try {
    const result = await functionCaller.call('image_filter', {
      input_path: testImagePath,
      output_path: path.join(testDir, 'test-blur.png'),
      filters: {
        blur: {
          sigma: 5
        }
      }
    });

    if (result.success) {
      try {
        const stats = await fs.stat(result.output_path);

        logger.info('   ✅ 模糊滤镜成功!');
        logger.info(`   → 输出路径: ${result.output_path}`);
        logger.info(`   → 应用滤镜: ${result.filters_applied.join(', ')}`);
        logger.info(`   → 滤镜数量: ${result.filter_count}`);
        logger.info(`   → 文件大小: ${stats.size} 字节\n`);

        passedTests++;
        results.push({ test: '模糊滤镜', status: '通过', file: result.output_path });
      } catch (fileError) {
        logger.info(`   ❌ 文件验证失败: ${fileError.message}\n`);
        failedTests++;
        results.push({ test: '模糊滤镜', status: '失败', error: '文件验证失败' });
      }
    } else {
      logger.info(`   ❌ 模糊滤镜失败: ${result.error}\n`);
      failedTests++;
      results.push({ test: '模糊滤镜', status: '失败', error: result.error });
    }
  } catch (error) {
    logger.info(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '模糊滤镜', status: '异常', error: error.message });
  }

  // ==================== 测试8: 锐化滤镜 ====================
  logger.info('📝 测试8: 锐化滤镜\n');
  try {
    const result = await functionCaller.call('image_filter', {
      input_path: testImagePath,
      output_path: path.join(testDir, 'test-sharpen.png'),
      filters: {
        sharpen: {
          sigma: 2
        }
      }
    });

    if (result.success) {
      try {
        const stats = await fs.stat(result.output_path);

        logger.info('   ✅ 锐化滤镜成功!');
        logger.info(`   → 输出路径: ${result.output_path}`);
        logger.info(`   → 应用滤镜: ${result.filters_applied.join(', ')}`);
        logger.info(`   → 滤镜数量: ${result.filter_count}`);
        logger.info(`   → 文件大小: ${stats.size} 字节\n`);

        passedTests++;
        results.push({ test: '锐化滤镜', status: '通过', file: result.output_path });
      } catch (fileError) {
        logger.info(`   ❌ 文件验证失败: ${fileError.message}\n`);
        failedTests++;
        results.push({ test: '锐化滤镜', status: '失败', error: '文件验证失败' });
      }
    } else {
      logger.info(`   ❌ 锐化滤镜失败: ${result.error}\n`);
      failedTests++;
      results.push({ test: '锐化滤镜', status: '失败', error: result.error });
    }
  } catch (error) {
    logger.info(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '锐化滤镜', status: '异常', error: error.message });
  }

  // ==================== 测试9: 亮度调整 ====================
  logger.info('📝 测试9: 亮度调整\n');
  try {
    const result = await functionCaller.call('image_filter', {
      input_path: testImagePath,
      output_path: path.join(testDir, 'test-brightness.png'),
      filters: {
        brightness: {
          value: 1.5
        }
      }
    });

    if (result.success) {
      try {
        const stats = await fs.stat(result.output_path);

        logger.info('   ✅ 亮度调整成功!');
        logger.info(`   → 输出路径: ${result.output_path}`);
        logger.info(`   → 应用滤镜: ${result.filters_applied.join(', ')}`);
        logger.info(`   → 滤镜数量: ${result.filter_count}`);
        logger.info(`   → 文件大小: ${stats.size} 字节\n`);

        passedTests++;
        results.push({ test: '亮度调整', status: '通过', file: result.output_path });
      } catch (fileError) {
        logger.info(`   ❌ 文件验证失败: ${fileError.message}\n`);
        failedTests++;
        results.push({ test: '亮度调整', status: '失败', error: '文件验证失败' });
      }
    } else {
      logger.info(`   ❌ 亮度调整失败: ${result.error}\n`);
      failedTests++;
      results.push({ test: '亮度调整', status: '失败', error: result.error });
    }
  } catch (error) {
    logger.info(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '亮度调整', status: '异常', error: error.message });
  }

  // ==================== 测试10: 组合滤镜 ====================
  logger.info('📝 测试10: 组合滤镜（灰度+锐化+归一化）\n');
  try {
    const result = await functionCaller.call('image_filter', {
      input_path: testImagePath,
      output_path: path.join(testDir, 'test-combined.png'),
      filters: {
        grayscale: true,
        sharpen: { sigma: 1.5 },
        normalize: true
      }
    });

    if (result.success) {
      try {
        const stats = await fs.stat(result.output_path);

        logger.info('   ✅ 组合滤镜成功!');
        logger.info(`   → 输出路径: ${result.output_path}`);
        logger.info(`   → 应用滤镜: ${result.filters_applied.join(', ')}`);
        logger.info(`   → 滤镜数量: ${result.filter_count}`);
        logger.info(`   → 文件大小: ${stats.size} 字节\n`);

        passedTests++;
        results.push({ test: '组合滤镜', status: '通过', file: result.output_path });
      } catch (fileError) {
        logger.info(`   ❌ 文件验证失败: ${fileError.message}\n`);
        failedTests++;
        results.push({ test: '组合滤镜', status: '失败', error: '文件验证失败' });
      }
    } else {
      logger.info(`   ❌ 组合滤镜失败: ${result.error}\n`);
      failedTests++;
      results.push({ test: '组合滤镜', status: '失败', error: result.error });
    }
  } catch (error) {
    logger.info(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '组合滤镜', status: '异常', error: error.message });
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
    if (result.file) {logger.info(`   文件: ${result.file}`);}
    if (result.error) {logger.info(`   错误: ${result.error}`);}
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
  testPhase2RealTools()
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

module.exports = { testPhase2RealTools };
