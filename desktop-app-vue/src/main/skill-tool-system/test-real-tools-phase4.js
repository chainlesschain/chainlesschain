/**
 * Phase 4 真实功能测试
 * 测试日常工具的真实实现
 */

// 设置环境变量启用真实实现
process.env.USE_REAL_TOOLS = 'true';

const { logger, createLogger } = require('../utils/logger.js');
const FunctionCaller = require('../ai-engine/function-caller');
const fs = require('fs').promises;
const path = require('path');

async function testPhase4RealTools() {
  logger.info('========================================');
  logger.info('Phase 4 真实功能测试 - 日常工具');
  logger.info('========================================\n');

  const functionCaller = new FunctionCaller();
  const testDir = path.join(__dirname, '../../test-output');

  // 确保测试目录存在
  await fs.mkdir(testDir, { recursive: true });

  let passedTests = 0;
  let failedTests = 0;
  const results = [];

  // ==================== 测试1: 生成单个密码 (默认16位) ====================
  logger.info('📝 测试1: 生成单个密码 (默认设置)\n');
  try {
    const result = await functionCaller.call('password_generator_advanced', {
      length: 16,
      include_uppercase: true,
      include_lowercase: true,
      include_numbers: true,
      include_symbols: true,
      exclude_ambiguous: false
    });

    if (result.success) {
      const pwd = result.password_details[0];
      logger.info('   ✅ 密码生成成功!');
      logger.info(`   → 密码: ${pwd.password}`);
      logger.info(`   → 长度: ${pwd.length}`);
      logger.info(`   → 强度: ${pwd.strength} (得分: ${pwd.strength_score})`);
      logger.info(`   → 熵值: ${pwd.entropy} bits`);
      logger.info(`   → 大写字母: ${pwd.has_uppercase ? '✓' : '✗'}`);
      logger.info(`   → 小写字母: ${pwd.has_lowercase ? '✓' : '✗'}`);
      logger.info(`   → 数字: ${pwd.has_numbers ? '✓' : '✗'}`);
      logger.info(`   → 符号: ${pwd.has_symbols ? '✓' : '✗'}\n`);

      passedTests++;
      results.push({ test: '密码生成(单个)', status: '通过', password: pwd.password });
    } else {
      logger.info(`   ❌ 生成失败: ${result.error}\n`);
      failedTests++;
      results.push({ test: '密码生成(单个)', status: '失败', error: result.error });
    }
  } catch (error) {
    logger.info(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '密码生成(单个)', status: '异常', error: error.message });
  }

  // ==================== 测试2: 生成多个密码 ====================
  logger.info('📝 测试2: 生成多个密码 (count=3)\n');
  try {
    const result = await functionCaller.call('password_generator_advanced', {
      length: 12,
      include_uppercase: true,
      include_lowercase: true,
      include_numbers: true,
      include_symbols: false,
      count: 3
    });

    if (result.success) {
      logger.info('   ✅ 批量密码生成成功!');
      logger.info(`   → 生成数量: ${result.count}`);
      logger.info(`   → 字符集大小: ${result.charset_size}`);
      result.password_details.forEach((pwd, idx) => {
        logger.info(`   → 密码${idx + 1}: ${pwd.password} (${pwd.strength})`);
      });
      logger.info('');

      passedTests++;
      results.push({ test: '密码生成(批量)', status: '通过', count: result.count });
    } else {
      logger.info(`   ❌ 生成失败: ${result.error}\n`);
      failedTests++;
      results.push({ test: '密码生成(批量)', status: '失败', error: result.error });
    }
  } catch (error) {
    logger.info(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '密码生成(批量)', status: '异常', error: error.message });
  }

  // ==================== 测试3: 排除模糊字符 ====================
  logger.info('📝 测试3: 生成密码 (排除模糊字符)\n');
  try {
    const result = await functionCaller.call('password_generator_advanced', {
      length: 20,
      include_uppercase: true,
      include_lowercase: true,
      include_numbers: true,
      include_symbols: true,
      exclude_ambiguous: true
    });

    if (result.success) {
      const pwd = result.password_details[0];
      const hasAmbiguous = /[il1Lo0O]/.test(pwd.password);

      logger.info('   ✅ 密码生成成功!');
      logger.info(`   → 密码: ${pwd.password}`);
      logger.info(`   → 长度: ${pwd.length}`);
      logger.info(`   → 包含模糊字符: ${hasAmbiguous ? '✗ (不应该)' : '✓ (正确)'}\n`);

      if (!hasAmbiguous) {
        passedTests++;
        results.push({ test: '排除模糊字符', status: '通过' });
      } else {
        failedTests++;
        results.push({ test: '排除模糊字符', status: '失败', error: '包含模糊字符' });
      }
    } else {
      logger.info(`   ❌ 生成失败: ${result.error}\n`);
      failedTests++;
      results.push({ test: '排除模糊字符', status: '失败', error: result.error });
    }
  } catch (error) {
    logger.info(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '排除模糊字符', status: '异常', error: error.message });
  }

  // ==================== 测试4: 创建笔记 ====================
  logger.info('📝 测试4: 创建笔记\n');
  const notePath1 = path.join(testDir, 'test-note-1.json');
  try {
    const result = await functionCaller.call('note_editor', {
      operation: 'create',
      note_path: notePath1,
      title: '测试笔记1',
      content: '这是一个测试笔记的内容。\n\n包含多行文本。',
      tags: ['test', 'phase4', 'automation']
    });

    if (result.success) {
      const stats = await fs.stat(notePath1);

      logger.info('   ✅ 笔记创建成功!');
      logger.info(`   → 笔记路径: ${result.note_path}`);
      logger.info(`   → 标题: ${result.title}`);
      logger.info(`   → 内容长度: ${result.content_length} 字符`);
      logger.info(`   → 标签: ${result.tags.join(', ')}`);
      logger.info(`   → 文件大小: ${stats.size} 字节`);
      logger.info(`   → 创建时间: ${result.created_at}\n`);

      passedTests++;
      results.push({ test: '笔记创建', status: '通过', file: notePath1 });
    } else {
      logger.info(`   ❌ 创建失败: ${result.error}\n`);
      failedTests++;
      results.push({ test: '笔记创建', status: '失败', error: result.error });
    }
  } catch (error) {
    logger.info(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '笔记创建', status: '异常', error: error.message });
  }

  // ==================== 测试5: 读取笔记 ====================
  logger.info('📝 测试5: 读取笔记\n');
  try {
    const result = await functionCaller.call('note_editor', {
      operation: 'read',
      note_path: notePath1
    });

    if (result.success) {
      logger.info('   ✅ 笔记读取成功!');
      logger.info(`   → 标题: ${result.title}`);
      logger.info(`   → 内容: ${result.content.substring(0, 50)}...`);
      logger.info(`   → 标签数量: ${result.tags.length}`);
      logger.info(`   → 更新时间: ${result.updated_at}\n`);

      passedTests++;
      results.push({ test: '笔记读取', status: '通过' });
    } else {
      logger.info(`   ❌ 读取失败: ${result.error}\n`);
      failedTests++;
      results.push({ test: '笔记读取', status: '失败', error: result.error });
    }
  } catch (error) {
    logger.info(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '笔记读取', status: '异常', error: error.message });
  }

  // ==================== 测试6: 更新笔记 ====================
  logger.info('📝 测试6: 更新笔记\n');
  try {
    const result = await functionCaller.call('note_editor', {
      operation: 'update',
      note_path: notePath1,
      title: '测试笔记1 (已更新)',
      content: '这是更新后的内容。\n\n添加了更多信息。',
      tags: ['test', 'phase4', 'automation', 'updated']
    });

    if (result.success) {
      logger.info('   ✅ 笔记更新成功!');
      logger.info(`   → 笔记路径: ${result.note_path}`);
      logger.info(`   → 新标题: ${result.title}`);
      logger.info(`   → 更新时间: ${result.updated_at}\n`);

      passedTests++;
      results.push({ test: '笔记更新', status: '通过' });
    } else {
      logger.info(`   ❌ 更新失败: ${result.error}\n`);
      failedTests++;
      results.push({ test: '笔记更新', status: '失败', error: result.error });
    }
  } catch (error) {
    logger.info(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '笔记更新', status: '异常', error: error.message });
  }

  // ==================== 测试7: 列出笔记 ====================
  logger.info('📝 测试7: 列出笔记\n');

  // 先创建几个额外的笔记
  const notePath2 = path.join(testDir, 'test-note-2.json');
  const notePath3 = path.join(testDir, 'test-note-3.json');

  await functionCaller.call('note_editor', {
    operation: 'create',
    note_path: notePath2,
    title: '测试笔记2',
    content: '第二个测试笔记',
    tags: ['test']
  });

  await functionCaller.call('note_editor', {
    operation: 'create',
    note_path: notePath3,
    title: '测试笔记3',
    content: '第三个测试笔记',
    tags: ['test', 'example']
  });

  try {
    const result = await functionCaller.call('note_editor', {
      operation: 'list',
      note_path: testDir
    });

    if (result.success) {
      logger.info('   ✅ 笔记列表成功!');
      logger.info(`   → 目录: ${result.directory}`);
      logger.info(`   → 笔记总数: ${result.total_notes}`);
      logger.info(`   → 笔记列表:`);
      result.notes.forEach((note, idx) => {
        logger.info(`      ${idx + 1}. ${note.title} [${note.tags.join(', ')}]`);
      });
      logger.info('');

      passedTests++;
      results.push({ test: '笔记列表', status: '通过', count: result.total_notes });
    } else {
      logger.info(`   ❌ 列表失败: ${result.error}\n`);
      failedTests++;
      results.push({ test: '笔记列表', status: '失败', error: result.error });
    }
  } catch (error) {
    logger.info(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '笔记列表', status: '异常', error: error.message });
  }

  // ==================== 测试8: 删除笔记 ====================
  logger.info('📝 测试8: 删除笔记\n');
  try {
    const result = await functionCaller.call('note_editor', {
      operation: 'delete',
      note_path: notePath3
    });

    if (result.success) {
      // 验证文件是否真的被删除
      try {
        await fs.access(notePath3);
        logger.info(`   ❌ 删除失败: 文件仍然存在\n`);
        failedTests++;
        results.push({ test: '笔记删除', status: '失败', error: '文件未删除' });
      } catch {
        logger.info('   ✅ 笔记删除成功!');
        logger.info(`   → 删除路径: ${result.note_path}`);
        logger.info(`   → 消息: ${result.message}\n`);

        passedTests++;
        results.push({ test: '笔记删除', status: '通过' });
      }
    } else {
      logger.info(`   ❌ 删除失败: ${result.error}\n`);
      failedTests++;
      results.push({ test: '笔记删除', status: '失败', error: result.error });
    }
  } catch (error) {
    logger.info(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '笔记删除', status: '异常', error: error.message });
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
    if (result.password) {logger.info(`   密码示例: ${result.password.substring(0, 8)}...`);}
    if (result.count) {logger.info(`   数量: ${result.count}`);}
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
  testPhase4RealTools()
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

module.exports = { testPhase4RealTools };
