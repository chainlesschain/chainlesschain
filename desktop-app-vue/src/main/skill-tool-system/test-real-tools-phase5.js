/**
 * Phase 5 真实功能测试
 * 测试日历管理和笔记搜索工具的真实实现
 */

// 设置环境变量启用真实实现
process.env.USE_REAL_TOOLS = 'true';

const FunctionCaller = require('../ai-engine/function-caller');
const fs = require('fs').promises;
const path = require('path');

async function testPhase5RealTools() {
  console.log('========================================');
  console.log('Phase 5 真实功能测试 - 日历和笔记搜索');
  console.log('========================================\n');

  const functionCaller = new FunctionCaller();
  const testDir = path.join(__dirname, '../../test-output');

  // 确保测试目录存在
  await fs.mkdir(testDir, { recursive: true });

  let passedTests = 0;
  let failedTests = 0;
  const results = [];

  // ==================== 日历管理器测试 ====================

  console.log('🗓️  日历管理器测试\n');
  console.log('═══════════════════════════════════════\n');

  let createdEventId = null;
  let createdEventPath = null;

  // ==================== 测试1: 创建日历事件 ====================
  console.log('📝 测试1: 创建日历事件\n');
  try {
    const result = await functionCaller.call('calendar_manager', {
      action: 'create',
      event: {
        title: 'Phase 5 项目评审',
        start_time: '2025-01-15T14:00:00',
        end_time: '2025-01-15T16:00:00',
        location: '会议室A',
        description: '讨论Phase 5的实施进展和测试结果',
        attendees: [
          { email: 'alice@example.com', name: 'Alice' },
          { email: 'bob@example.com', name: 'Bob' }
        ],
        recurrence: 'none',
        reminder_minutes: 15
      }
    });

    if (result.success) {
      createdEventId = result.event_id;
      createdEventPath = result.calendar_path;

      // 验证文件是否创建
      const stats = await fs.stat(createdEventPath);

      console.log('   ✅ 日历事件创建成功!');
      console.log(`   → 事件ID: ${result.event_id}`);
      console.log(`   → 标题: ${result.event.title}`);
      console.log(`   → 开始时间: ${result.event.start_time}`);
      console.log(`   → 结束时间: ${result.event.end_time}`);
      console.log(`   → 地点: ${result.event.location}`);
      console.log(`   → 参与者: ${result.event.attendees.length}人`);
      console.log(`   → 文件路径: ${result.calendar_path}`);
      console.log(`   → 文件大小: ${stats.size} 字节\n`);

      passedTests++;
      results.push({ test: '创建日历事件', status: '通过', event_id: result.event_id });
    } else {
      console.log(`   ❌ 创建失败: ${result.error}\n`);
      failedTests++;
      results.push({ test: '创建日历事件', status: '失败', error: result.error });
    }
  } catch (error) {
    console.log(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '创建日历事件', status: '异常', error: error.message });
  }

  // ==================== 测试2: 创建重复事件 ====================
  console.log('📝 测试2: 创建重复日历事件 (每周)\n');
  try {
    const result = await functionCaller.call('calendar_manager', {
      action: 'create',
      event: {
        title: '每周站会',
        start_time: '2025-01-20T09:00:00',
        end_time: '2025-01-20T09:30:00',
        location: '线上',
        description: '每周一早上的站会',
        recurrence: 'weekly',
        recurrence_count: 12,
        reminder_minutes: 10
      }
    });

    if (result.success) {
      console.log('   ✅ 重复事件创建成功!');
      console.log(`   → 事件ID: ${result.event_id}`);
      console.log(`   → 标题: ${result.event.title}`);
      console.log(`   → 重复规则: ${result.event.recurrence}`);
      console.log(`   → 文件路径: ${result.calendar_path}\n`);

      passedTests++;
      results.push({ test: '创建重复事件', status: '通过' });
    } else {
      console.log(`   ❌ 创建失败: ${result.error}\n`);
      failedTests++;
      results.push({ test: '创建重复事件', status: '失败', error: result.error });
    }
  } catch (error) {
    console.log(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '创建重复事件', status: '异常', error: error.message });
  }

  // ==================== 测试3: 查询日历事件 ====================
  console.log('📝 测试3: 查询日历事件\n');
  try {
    const result = await functionCaller.call('calendar_manager', {
      action: 'query',
      date_range: {
        start: '2025-01-01',
        end: '2025-12-31'
      }
    });

    if (result.success) {
      console.log('   ✅ 事件查询成功!');
      console.log(`   → 日期范围: ${result.date_range.start} 至 ${result.date_range.end}`);
      console.log(`   → 找到事件: ${result.count}个`);
      console.log(`   → 事件列表:`);
      result.events.forEach((evt, idx) => {
        console.log(`      ${idx + 1}. ${evt.title} (${evt.start_time})`);
      });
      console.log('');

      passedTests++;
      results.push({ test: '查询日历事件', status: '通过', count: result.count });
    } else {
      console.log(`   ❌ 查询失败: ${result.error}\n`);
      failedTests++;
      results.push({ test: '查询日历事件', status: '失败', error: result.error });
    }
  } catch (error) {
    console.log(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '查询日历事件', status: '异常', error: error.message });
  }

  // ==================== 测试4: 更新日历事件 ====================
  console.log('📝 测试4: 更新日历事件\n');
  if (createdEventId) {
    try {
      const result = await functionCaller.call('calendar_manager', {
        action: 'update',
        event: {
          id: createdEventId,
          title: 'Phase 5 项目评审 (已更新)',
          start_time: '2025-01-15T15:00:00',
          end_time: '2025-01-15T17:00:00',
          location: '会议室B'
        },
        calendar_path: createdEventPath
      });

      if (result.success) {
        console.log('   ✅ 事件更新成功!');
        console.log(`   → 事件ID: ${result.event_id}`);
        console.log(`   → 修改项: ${result.changes.join(', ')}`);
        console.log(`   → 文件路径: ${result.calendar_path}\n`);

        passedTests++;
        results.push({ test: '更新日历事件', status: '通过' });
      } else {
        console.log(`   ❌ 更新失败: ${result.error}\n`);
        failedTests++;
        results.push({ test: '更新日历事件', status: '失败', error: result.error });
      }
    } catch (error) {
      console.log(`   ❌ 异常: ${error.message}\n`);
      failedTests++;
      results.push({ test: '更新日历事件', status: '异常', error: error.message });
    }
  } else {
    console.log('   ⏭️  跳过: 无法获取创建的事件ID\n');
    results.push({ test: '更新日历事件', status: '跳过' });
  }

  // ==================== 测试5: 删除日历事件 ====================
  console.log('📝 测试5: 删除日历事件\n');
  if (createdEventId && createdEventPath) {
    try {
      const result = await functionCaller.call('calendar_manager', {
        action: 'delete',
        event: {
          id: createdEventId
        },
        calendar_path: createdEventPath
      });

      if (result.success) {
        // 验证文件是否被删除
        try {
          await fs.access(createdEventPath);
          console.log(`   ❌ 删除失败: 文件仍然存在\n`);
          failedTests++;
          results.push({ test: '删除日历事件', status: '失败', error: '文件未删除' });
        } catch {
          console.log('   ✅ 事件删除成功!');
          console.log(`   → 事件ID: ${result.event_id}`);
          console.log(`   → 消息: ${result.message}\n`);

          passedTests++;
          results.push({ test: '删除日历事件', status: '通过' });
        }
      } else {
        console.log(`   ❌ 删除失败: ${result.error}\n`);
        failedTests++;
        results.push({ test: '删除日历事件', status: '失败', error: result.error });
      }
    } catch (error) {
      console.log(`   ❌ 异常: ${error.message}\n`);
      failedTests++;
      results.push({ test: '删除日历事件', status: '异常', error: error.message });
    }
  } else {
    console.log('   ⏭️  跳过: 无法获取创建的事件信息\n');
    results.push({ test: '删除日历事件', status: '跳过' });
  }

  // ==================== 笔记搜索器测试 ====================

  console.log('🔍 笔记搜索器测试\n');
  console.log('═══════════════════════════════════════\n');

  // 先创建一些测试笔记（使用Phase 4的note_editor）
  console.log('📝 准备测试数据: 创建测试笔记\n');

  const testNotes = [
    {
      path: path.join(testDir, 'search-test-1.json'),
      title: 'AI技术学习笔记',
      content: '深度学习和神经网络的基础知识。包括卷积神经网络、循环神经网络等。',
      tags: ['AI', '技术', '学习']
    },
    {
      path: path.join(testDir, 'search-test-2.json'),
      title: 'Phase 5 项目规划',
      content: '2025年Phase 5项目计划和里程碑。包括日历管理和笔记搜索功能。',
      tags: ['项目', '规划', 'Phase5']
    },
    {
      path: path.join(testDir, 'search-test-3.json'),
      content: '工作日程安排和待办事项清单。',
      tags: ['工作', '待办']
    },
    {
      path: path.join(testDir, 'search-test-4.json'),
      title: '个人学习计划',
      content: '学习新技术栈，包括TypeScript、React和Node.js。',
      tags: ['学习', '个人']
    }
  ];

  for (const note of testNotes) {
    await functionCaller.call('note_editor', {
      operation: 'create',
      note_path: note.path,
      title: note.title || '无标题',
      content: note.content,
      tags: note.tags
    });
  }

  console.log(`   ✅ 创建了 ${testNotes.length} 个测试笔记\n`);

  // ==================== 测试6: 基本笔记搜索 ====================
  console.log('📝 测试6: 基本笔记搜索 (关键词: "学习")\n');
  try {
    const result = await functionCaller.call('note_searcher', {
      query: '学习',
      notes_directory: testDir
    });

    if (result.success) {
      console.log('   ✅ 笔记搜索成功!');
      console.log(`   → 搜索关键词: "${result.query}"`);
      console.log(`   → 找到笔记: ${result.total_count}个 (总共 ${result.total_found}个)`);
      console.log(`   → 搜索结果:`);
      result.results.forEach((note, idx) => {
        console.log(`      ${idx + 1}. ${note.title} (相关度: ${(note.relevance * 100).toFixed(0)}%)`);
        console.log(`         片段: ${note.snippet}`);
        console.log(`         标签: [${note.tags.join(', ')}]`);
      });
      console.log('');

      passedTests++;
      results.push({ test: '基本笔记搜索', status: '通过', count: result.total_count });
    } else {
      console.log(`   ❌ 搜索失败: ${result.error}\n`);
      failedTests++;
      results.push({ test: '基本笔记搜索', status: '失败', error: result.error });
    }
  } catch (error) {
    console.log(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '基本笔记搜索', status: '异常', error: error.message });
  }

  // ==================== 测试7: 标签过滤搜索 ====================
  console.log('📝 测试7: 标签过滤搜索 (标签: "项目")\n');
  try {
    const result = await functionCaller.call('note_searcher', {
      query: '',
      filters: {
        tags: ['项目']
      },
      notes_directory: testDir
    });

    if (result.success) {
      console.log('   ✅ 标签过滤成功!');
      console.log(`   → 过滤标签: ["项目"]`);
      console.log(`   → 找到笔记: ${result.total_count}个`);
      console.log(`   → 搜索结果:`);
      result.results.forEach((note, idx) => {
        console.log(`      ${idx + 1}. ${note.title}`);
        console.log(`         标签: [${note.tags.join(', ')}]`);
      });
      console.log('');

      passedTests++;
      results.push({ test: '标签过滤搜索', status: '通过', count: result.total_count });
    } else {
      console.log(`   ❌ 搜索失败: ${result.error}\n`);
      failedTests++;
      results.push({ test: '标签过滤搜索', status: '失败', error: result.error });
    }
  } catch (error) {
    console.log(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '标签过滤搜索', status: '异常', error: error.message });
  }

  // ==================== 测试8: 按相关度排序 ====================
  console.log('📝 测试8: 按相关度排序搜索 (关键词: "Phase")\n');
  try {
    const result = await functionCaller.call('note_searcher', {
      query: 'Phase',
      sort_by: 'relevance',
      notes_directory: testDir
    });

    if (result.success) {
      console.log('   ✅ 相关度排序成功!');
      console.log(`   → 搜索关键词: "${result.query}"`);
      console.log(`   → 排序方式: ${result.sort_by}`);
      console.log(`   → 找到笔记: ${result.total_count}个`);
      console.log(`   → 搜索结果 (按相关度降序):`);
      result.results.forEach((note, idx) => {
        console.log(`      ${idx + 1}. ${note.title} (相关度: ${(note.relevance * 100).toFixed(0)}%)`);
      });
      console.log('');

      // 验证排序是否正确
      let isSorted = true;
      for (let i = 0; i < result.results.length - 1; i++) {
        if (result.results[i].relevance < result.results[i + 1].relevance) {
          isSorted = false;
          break;
        }
      }

      if (isSorted) {
        passedTests++;
        results.push({ test: '按相关度排序', status: '通过' });
      } else {
        console.log('   ⚠️  排序验证失败\n');
        failedTests++;
        results.push({ test: '按相关度排序', status: '失败', error: '排序不正确' });
      }
    } else {
      console.log(`   ❌ 搜索失败: ${result.error}\n`);
      failedTests++;
      results.push({ test: '按相关度排序', status: '失败', error: result.error });
    }
  } catch (error) {
    console.log(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '按相关度排序', status: '异常', error: error.message });
  }

  // ==================== 测试9: 限制结果数量 ====================
  console.log('📝 测试9: 限制结果数量 (limit=2)\n');
  try {
    const result = await functionCaller.call('note_searcher', {
      query: '',
      limit: 2,
      notes_directory: testDir
    });

    if (result.success) {
      console.log('   ✅ 限制结果成功!');
      console.log(`   → 限制数量: 2`);
      console.log(`   → 返回结果: ${result.total_count}个`);
      console.log(`   → 总共找到: ${result.total_found}个`);

      if (result.total_count <= 2) {
        passedTests++;
        results.push({ test: '限制结果数量', status: '通过' });
      } else {
        console.log('   ⚠️  结果数量超出限制\n');
        failedTests++;
        results.push({ test: '限制结果数量', status: '失败', error: '结果数量超出限制' });
      }
      console.log('');
    } else {
      console.log(`   ❌ 搜索失败: ${result.error}\n`);
      failedTests++;
      results.push({ test: '限制结果数量', status: '失败', error: result.error });
    }
  } catch (error) {
    console.log(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '限制结果数量', status: '异常', error: error.message });
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
    if (result.event_id) console.log(`   事件ID: ${result.event_id}`);
    if (result.error) console.log(`   错误: ${result.error}`);
    if (result.count !== undefined) console.log(`   数量: ${result.count}`);
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
  testPhase5RealTools()
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

module.exports = { testPhase5RealTools };
