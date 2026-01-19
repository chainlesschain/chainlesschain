/**
 * Phase 6 真实功能测试
 * 测试提醒调度器和密码保险库的真实实现
 */

// 设置环境变量启用真实实现
process.env.USE_REAL_TOOLS = 'true';

const FunctionCaller = require('../ai-engine/function-caller');
const fs = require('fs').promises;
const path = require('path');

async function testPhase6RealTools() {
  console.log('========================================');
  console.log('Phase 6 真实功能测试 - 提醒和密码管理');
  console.log('========================================\n');

  const functionCaller = new FunctionCaller();
  const testDir = path.join(__dirname, '../../test-output');

  // 确保测试目录存在
  await fs.mkdir(testDir, { recursive: true });

  let passedTests = 0;
  let failedTests = 0;
  const results = [];

  // ==================== 提醒调度器测试 ====================

  console.log('⏰ 提醒调度器测试\n');
  console.log('═══════════════════════════════════════\n');

  let createdReminderId = null;

  // ==================== 测试1: 创建单次提醒 ====================
  console.log('📝 测试1: 创建单次提醒\n');
  try {
    const result = await functionCaller.call('reminder_scheduler', {
      action: 'create',
      reminder: {
        title: '项目会议',
        remind_time: '2025-01-20T14:00:00',
        repeat: 'none',
        priority: 'high',
        description: 'Phase 6完成后的项目评审会议'
      }
    });

    if (result.success) {
      createdReminderId = result.reminder_id;

      console.log('   ✅ 提醒创建成功!');
      console.log(`   → 提醒ID: ${result.reminder_id}`);
      console.log(`   → 标题: ${result.reminder.title}`);
      console.log(`   → 提醒时间: ${result.reminder.remind_time}`);
      console.log(`   → 重复: ${result.reminder.repeat}`);
      console.log(`   → 优先级: ${result.reminder.priority}`);
      console.log(`   → 下次触发: ${result.next_trigger}\n`);

      passedTests++;
      results.push({ test: '创建单次提醒', status: '通过', reminder_id: result.reminder_id });
    } else {
      console.log(`   ❌ 创建失败: ${result.error}\n`);
      failedTests++;
      results.push({ test: '创建单次提醒', status: '失败', error: result.error });
    }
  } catch (error) {
    console.log(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '创建单次提醒', status: '异常', error: error.message });
  }

  // ==================== 测试2: 创建每日重复提醒 ====================
  console.log('📝 测试2: 创建每日重复提醒\n');
  try {
    const result = await functionCaller.call('reminder_scheduler', {
      action: 'create',
      reminder: {
        title: '每日站会',
        remind_time: '09:00',
        repeat: 'daily',
        priority: 'medium',
        description: '每天早上9点的站会'
      }
    });

    if (result.success) {
      console.log('   ✅ 每日提醒创建成功!');
      console.log(`   → 提醒ID: ${result.reminder_id}`);
      console.log(`   → 标题: ${result.reminder.title}`);
      console.log(`   → 提醒时间: ${result.reminder.remind_time}`);
      console.log(`   → 重复: ${result.reminder.repeat}`);
      console.log(`   → 下次触发: ${result.next_trigger}\n`);

      passedTests++;
      results.push({ test: '创建每日提醒', status: '通过' });
    } else {
      console.log(`   ❌ 创建失败: ${result.error}\n`);
      failedTests++;
      results.push({ test: '创建每日提醒', status: '失败', error: result.error });
    }
  } catch (error) {
    console.log(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '创建每日提醒', status: '异常', error: error.message });
  }

  // ==================== 测试3: 列出所有提醒 ====================
  console.log('📝 测试3: 列出所有提醒\n');
  try {
    const result = await functionCaller.call('reminder_scheduler', {
      action: 'list'
    });

    if (result.success) {
      console.log('   ✅ 提醒列表获取成功!');
      console.log(`   → 提醒总数: ${result.count}个`);
      console.log(`   → 提醒列表:`);
      result.reminders.forEach((reminder, idx) => {
        console.log(`      ${idx + 1}. ${reminder.title} (${reminder.repeat})`);
        console.log(`         时间: ${reminder.remind_time}`);
        console.log(`         优先级: ${reminder.priority}`);
        console.log(`         下次触发: ${reminder.next_trigger}`);
      });
      console.log('');

      passedTests++;
      results.push({ test: '列出提醒', status: '通过', count: result.count });
    } else {
      console.log(`   ❌ 列表失败: ${result.error}\n`);
      failedTests++;
      results.push({ test: '列出提醒', status: '失败', error: result.error });
    }
  } catch (error) {
    console.log(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '列出提醒', status: '异常', error: error.message });
  }

  // ==================== 测试4: 更新提醒 ====================
  console.log('📝 测试4: 更新提醒\n');
  if (createdReminderId) {
    try {
      const result = await functionCaller.call('reminder_scheduler', {
        action: 'update',
        reminder: {
          id: createdReminderId,
          title: '项目会议 (已更新)',
          remind_time: '2025-01-20T15:00:00',
          priority: 'urgent'
        }
      });

      if (result.success) {
        console.log('   ✅ 提醒更新成功!');
        console.log(`   → 提醒ID: ${result.reminder_id}`);
        console.log(`   → 修改项: ${result.changes.join(', ')}\n`);

        passedTests++;
        results.push({ test: '更新提醒', status: '通过' });
      } else {
        console.log(`   ❌ 更新失败: ${result.error}\n`);
        failedTests++;
        results.push({ test: '更新提醒', status: '失败', error: result.error });
      }
    } catch (error) {
      console.log(`   ❌ 异常: ${error.message}\n`);
      failedTests++;
      results.push({ test: '更新提醒', status: '异常', error: error.message });
    }
  } else {
    console.log('   ⏭️  跳过: 无法获取创建的提醒ID\n');
    results.push({ test: '更新提醒', status: '跳过' });
  }

  // ==================== 测试5: 删除提醒 ====================
  console.log('📝 测试5: 删除提醒\n');
  if (createdReminderId) {
    try {
      const result = await functionCaller.call('reminder_scheduler', {
        action: 'delete',
        reminder: {
          id: createdReminderId
        }
      });

      if (result.success) {
        console.log('   ✅ 提醒删除成功!');
        console.log(`   → 提醒ID: ${result.reminder_id}\n`);

        passedTests++;
        results.push({ test: '删除提醒', status: '通过' });
      } else {
        console.log(`   ❌ 删除失败: ${result.error}\n`);
        failedTests++;
        results.push({ test: '删除提醒', status: '失败', error: result.error });
      }
    } catch (error) {
      console.log(`   ❌ 异常: ${error.message}\n`);
      failedTests++;
      results.push({ test: '删除提醒', status: '异常', error: error.message });
    }
  } else {
    console.log('   ⏭️  跳过: 无法获取创建的提醒ID\n');
    results.push({ test: '删除提醒', status: '跳过' });
  }

  // ==================== 密码保险库测试 ====================

  console.log('🔒 密码保险库测试\n');
  console.log('═══════════════════════════════════════\n');

  const masterPassword = 'MySecurePassword123!';
  let createdEntryId = null;

  // ==================== 测试6: 添加密码条目 ====================
  console.log('📝 测试6: 添加密码条目\n');
  try {
    const result = await functionCaller.call('password_vault', {
      action: 'add',
      master_password: masterPassword,
      entry: {
        title: 'GitHub账户',
        username: 'user@example.com',
        password: 'ghp_1234567890abcdefghijklmnopqrstuv',
        url: 'https://github.com',
        notes: '工作账户',
        tags: ['工作', '开发']
      }
    });

    if (result.success) {
      createdEntryId = result.entry_id;

      console.log('   ✅ 密码条目添加成功!');
      console.log(`   → 条目ID: ${result.entry_id}`);
      console.log(`   → 标题: ${result.title}`);
      console.log(`   → 用户名: ${result.username}`);
      console.log(`   → URL: ${result.url}`);
      console.log(`   → 标签: ${result.tags.join(', ')}`);
      console.log(`   → 加密: ${result.encrypted ? '是' : '否'}\n`);

      passedTests++;
      results.push({ test: '添加密码条目', status: '通过', entry_id: result.entry_id });
    } else {
      console.log(`   ❌ 添加失败: ${result.error}\n`);
      failedTests++;
      results.push({ test: '添加密码条目', status: '失败', error: result.error });
    }
  } catch (error) {
    console.log(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '添加密码条目', status: '异常', error: error.message });
  }

  // ==================== 测试7: 获取密码 (正确主密码) ====================
  console.log('📝 测试7: 获取密码 (正确主密码)\n');
  if (createdEntryId) {
    try {
      const result = await functionCaller.call('password_vault', {
        action: 'get',
        master_password: masterPassword,
        entry: {
          id: createdEntryId
        }
      });

      if (result.success) {
        console.log('   ✅ 密码获取成功!');
        console.log(`   → 条目ID: ${result.entry_id}`);
        console.log(`   → 标题: ${result.title}`);
        console.log(`   → 用户名: ${result.username}`);
        console.log(`   → 密码: ${result.password.substring(0, 10)}... (已解密)`);
        console.log(`   → URL: ${result.url}`);
        console.log(`   → 备注: ${result.notes}\n`);

        // 验证密码是否正确解密
        if (result.password === 'ghp_1234567890abcdefghijklmnopqrstuv') {
          console.log('   ✅ 密码解密验证: 正确\n');
          passedTests++;
          results.push({ test: '获取密码(正确主密码)', status: '通过' });
        } else {
          console.log('   ⚠️  密码解密验证: 不匹配\n');
          failedTests++;
          results.push({ test: '获取密码(正确主密码)', status: '失败', error: '密码不匹配' });
        }
      } else {
        console.log(`   ❌ 获取失败: ${result.error}\n`);
        failedTests++;
        results.push({ test: '获取密码(正确主密码)', status: '失败', error: result.error });
      }
    } catch (error) {
      console.log(`   ❌ 异常: ${error.message}\n`);
      failedTests++;
      results.push({ test: '获取密码(正确主密码)', status: '异常', error: error.message });
    }
  } else {
    console.log('   ⏭️  跳过: 无法获取创建的条目ID\n');
    results.push({ test: '获取密码(正确主密码)', status: '跳过' });
  }

  // ==================== 测试8: 添加更多密码条目 ====================
  console.log('📝 测试8: 添加更多密码条目\n');
  try {
    await functionCaller.call('password_vault', {
      action: 'add',
      master_password: masterPassword,
      entry: {
        title: 'Gmail账户',
        username: 'user@gmail.com',
        password: 'gmail_password_xyz',
        url: 'https://mail.google.com',
        tags: ['个人', '邮箱']
      }
    });

    await functionCaller.call('password_vault', {
      action: 'add',
      master_password: masterPassword,
      entry: {
        title: 'AWS Console',
        username: 'admin',
        password: 'aws_secret_key',
        url: 'https://console.aws.amazon.com',
        tags: ['工作', '云服务']
      }
    });

    console.log('   ✅ 批量添加成功! (2个条目)\n');
    passedTests++;
    results.push({ test: '批量添加密码', status: '通过' });
  } catch (error) {
    console.log(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '批量添加密码', status: '异常', error: error.message });
  }

  // ==================== 测试9: 列出所有密码 ====================
  console.log('📝 测试9: 列出所有密码\n');
  try {
    const result = await functionCaller.call('password_vault', {
      action: 'list',
      master_password: masterPassword
    });

    if (result.success) {
      console.log('   ✅ 密码列表获取成功!');
      console.log(`   → 密码总数: ${result.count}个`);
      console.log(`   → 密码列表 (安全模式，不显示密码):`);
      result.entries.forEach((entry, idx) => {
        console.log(`      ${idx + 1}. ${entry.title}`);
        console.log(`         用户名: ${entry.username}`);
        console.log(`         URL: ${entry.url}`);
        console.log(`         标签: [${entry.tags.join(', ')}]`);
      });
      console.log('');

      passedTests++;
      results.push({ test: '列出密码', status: '通过', count: result.count });
    } else {
      console.log(`   ❌ 列表失败: ${result.error}\n`);
      failedTests++;
      results.push({ test: '列出密码', status: '失败', error: result.error });
    }
  } catch (error) {
    console.log(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '列出密码', status: '异常', error: error.message });
  }

  // ==================== 测试10: 搜索密码 ====================
  console.log('📝 测试10: 搜索密码 (关键词: "gmail")\n');
  try {
    const result = await functionCaller.call('password_vault', {
      action: 'list',
      master_password: masterPassword,
      search_query: 'gmail'
    });

    if (result.success) {
      console.log('   ✅ 密码搜索成功!');
      console.log(`   → 搜索关键词: "gmail"`);
      console.log(`   → 找到: ${result.count}个`);
      result.entries.forEach((entry, idx) => {
        console.log(`      ${idx + 1}. ${entry.title} (${entry.username})`);
      });
      console.log('');

      passedTests++;
      results.push({ test: '搜索密码', status: '通过', count: result.count });
    } else {
      console.log(`   ❌ 搜索失败: ${result.error}\n`);
      failedTests++;
      results.push({ test: '搜索密码', status: '失败', error: result.error });
    }
  } catch (error) {
    console.log(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '搜索密码', status: '异常', error: error.message });
  }

  // ==================== 测试11: 更新密码 ====================
  console.log('📝 测试11: 更新密码\n');
  if (createdEntryId) {
    try {
      const result = await functionCaller.call('password_vault', {
        action: 'update',
        master_password: masterPassword,
        entry: {
          id: createdEntryId,
          title: 'GitHub账户 (已更新)',
          password: 'ghp_NEW_TOKEN_9876543210',
          notes: '工作账户 - 2025更新'
        }
      });

      if (result.success) {
        console.log('   ✅ 密码更新成功!');
        console.log(`   → 条目ID: ${result.entry_id}`);
        console.log(`   → 修改项: ${result.changes.join(', ')}\n`);

        passedTests++;
        results.push({ test: '更新密码', status: '通过' });
      } else {
        console.log(`   ❌ 更新失败: ${result.error}\n`);
        failedTests++;
        results.push({ test: '更新密码', status: '失败', error: result.error });
      }
    } catch (error) {
      console.log(`   ❌ 异常: ${error.message}\n`);
      failedTests++;
      results.push({ test: '更新密码', status: '异常', error: error.message });
    }
  } else {
    console.log('   ⏭️  跳过: 无法获取创建的条目ID\n');
    results.push({ test: '更新密码', status: '跳过' });
  }

  // ==================== 测试12: 删除密码 ====================
  console.log('📝 测试12: 删除密码\n');
  if (createdEntryId) {
    try {
      const result = await functionCaller.call('password_vault', {
        action: 'delete',
        master_password: masterPassword,
        entry: {
          id: createdEntryId
        }
      });

      if (result.success) {
        console.log('   ✅ 密码删除成功!');
        console.log(`   → 条目ID: ${result.entry_id}\n`);

        passedTests++;
        results.push({ test: '删除密码', status: '通过' });
      } else {
        console.log(`   ❌ 删除失败: ${result.error}\n`);
        failedTests++;
        results.push({ test: '删除密码', status: '失败', error: result.error });
      }
    } catch (error) {
      console.log(`   ❌ 异常: ${error.message}\n`);
      failedTests++;
      results.push({ test: '删除密码', status: '异常', error: error.message });
    }
  } else {
    console.log('   ⏭️  跳过: 无法获取创建的条目ID\n');
    results.push({ test: '删除密码', status: '跳过' });
  }

  // ==================== 测试13: 错误主密码 ====================
  console.log('📝 测试13: 错误主密码 (应该失败)\n');
  try {
    const result = await functionCaller.call('password_vault', {
      action: 'list',
      master_password: 'WrongPassword123'
    });

    if (!result.success) {
      console.log('   ✅ 正确拒绝错误主密码!');
      console.log(`   → 错误信息: ${result.error}\n`);

      passedTests++;
      results.push({ test: '错误主密码验证', status: '通过' });
    } else {
      console.log('   ❌ 安全问题: 错误主密码被接受!\n');
      failedTests++;
      results.push({ test: '错误主密码验证', status: '失败', error: '错误密码被接受' });
    }
  } catch (error) {
    console.log(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '错误主密码验证', status: '异常', error: error.message });
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
    if (result.reminder_id) {console.log(`   提醒ID: ${result.reminder_id}`);}
    if (result.entry_id) {console.log(`   条目ID: ${result.entry_id}`);}
    if (result.error) {console.log(`   错误: ${result.error}`);}
    if (result.count !== undefined) {console.log(`   数量: ${result.count}`);}
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
  testPhase6RealTools()
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

module.exports = { testPhase6RealTools };
