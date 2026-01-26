/**
 * ChainlessChain v0.26.2 自动化测试脚本
 * 在应用的开发者控制台中运行此脚本
 */

(async function autoTest() {
  console.clear();
  console.log('%c╔════════════════════════════════════════════════════════════════╗', 'color: #1890ff; font-weight: bold;');
  console.log('%c║     ChainlessChain v0.26.2 自动化测试开始                     ║', 'color: #1890ff; font-weight: bold;');
  console.log('%c╚════════════════════════════════════════════════════════════════╝', 'color: #1890ff; font-weight: bold;');
  console.log('');

  // 测试配置
  const tests = [
    { id: 1, name: 'LLM性能监控', path: '/llm/performance', group: '监控与诊断' },
    { id: 2, name: '数据库性能监控', path: '/database/performance', group: '监控与诊断' },
    { id: 3, name: '错误监控', path: '/error/monitor', group: '监控与诊断' },
    { id: 4, name: '会话管理', path: '/sessions', group: '监控与诊断' },
    { id: 5, name: '内存仪表板', path: '/memory', group: '监控与诊断' },
    { id: 6, name: '标签管理', path: '/tags', group: '监控与诊断' },
    { id: 7, name: 'MCP服务器', path: '/settings?tab=mcp', group: 'MCP和AI配置' },
    { id: 8, name: 'Token使用统计', path: '/settings?tab=token-usage', group: 'MCP和AI配置' },
    { id: 9, name: '设备配对', path: '/p2p/device-pairing', group: 'P2P高级功能' },
    { id: 10, name: '设备管理', path: '/p2p/device-management', group: 'P2P高级功能' },
    { id: 11, name: '文件传输', path: '/p2p/file-transfer', group: 'P2P高级功能' },
    { id: 12, name: '安全号码验证', path: '/p2p/safety-numbers', group: 'P2P高级功能' },
    { id: 13, name: '会话指纹', path: '/p2p/session-fingerprint', group: 'P2P高级功能' },
    { id: 14, name: '消息队列', path: '/p2p/message-queue', group: 'P2P高级功能' },
  ];

  const results = [];
  const interval = 3000; // 3秒间隔

  // 测试单个页面
  async function testPage(test) {
    console.log(`%c[${test.id}/14] 测试: ${test.name}`, 'color: #1890ff; font-size: 14px; font-weight: bold;');
    console.log(`  路径: ${test.path}`);
    console.log(`  分组: ${test.group}`);

    const result = {
      id: test.id,
      name: test.name,
      path: test.path,
      group: test.group,
      success: false,
      error: null,
      loadTime: 0,
      hasContent: false,
      consoleErrors: []
    };

    const startTime = Date.now();

    try {
      // 导航到页面
      window.location.hash = '#' + test.path;

      // 等待页面加载
      await new Promise(resolve => setTimeout(resolve, interval));

      // 检查URL是否正确
      const currentHash = window.location.hash;
      const expectedPath = test.path.split('?')[0];
      const urlMatches = currentHash.includes(expectedPath);

      if (!urlMatches) {
        throw new Error(`URL不匹配: 期望包含 ${expectedPath}, 实际 ${currentHash}`);
      }

      // 检查是否有应用根元素
      const appElement = document.getElementById('app');
      if (!appElement) {
        throw new Error('找不到应用根元素 #app');
      }

      // 检查是否有内容
      const hasContent = appElement.textContent.trim().length > 0;
      result.hasContent = hasContent;

      // 检查是否有明显的错误信息
      const errorTexts = ['404', 'Not Found', '页面不存在', '加载失败', 'Error'];
      const pageText = appElement.textContent;
      const hasErrorText = errorTexts.some(err => pageText.includes(err));

      if (hasErrorText) {
        console.warn('  ⚠️  页面包含错误文本');
        result.error = '页面包含错误文本';
      }

      // 检查控制台错误（简单版本）
      // 注意：无法完全捕获所有控制台错误，这只是示例

      result.loadTime = Date.now() - startTime;
      result.success = urlMatches && hasContent && !hasErrorText;

      if (result.success) {
        console.log(`  %c✓ 测试通过`, 'color: #52c41a; font-weight: bold;');
        console.log(`  加载时间: ${result.loadTime}ms`);
        console.log(`  有内容: ${hasContent ? '是' : '否'}`);
      } else {
        console.log(`  %c✗ 测试失败`, 'color: #f5222d; font-weight: bold;');
        if (result.error) {
          console.log(`  错误: ${result.error}`);
        }
      }

    } catch (error) {
      result.success = false;
      result.error = error.message;
      console.log(`  %c✗ 测试失败: ${error.message}`, 'color: #f5222d; font-weight: bold;');
    }

    console.log('');
    return result;
  }

  // 运行所有测试
  console.log(`%c开始测试 (每个页面间隔 ${interval/1000} 秒)...`, 'color: #722ed1; font-size: 14px;');
  console.log('');

  for (const test of tests) {
    const result = await testPage(test);
    results.push(result);
  }

  // 生成报告
  console.log('%c╔════════════════════════════════════════════════════════════════╗', 'color: #52c41a; font-weight: bold;');
  console.log('%c║                        测试完成                                ║', 'color: #52c41a; font-weight: bold;');
  console.log('%c╚════════════════════════════════════════════════════════════════╝', 'color: #52c41a; font-weight: bold;');
  console.log('');

  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;
  const successRate = ((successCount / results.length) * 100).toFixed(1);

  console.log(`%c测试统计:`, 'font-size: 16px; font-weight: bold;');
  console.log(`  总测试项: ${results.length}`);
  console.log(`  %c✓ 成功: ${successCount}`, 'color: #52c41a; font-weight: bold;');
  console.log(`  %c✗ 失败: ${failCount}`, 'color: #f5222d; font-weight: bold;');
  console.log(`  成功率: ${successRate}%`);
  console.log('');

  // 按分组显示结果
  const groups = [...new Set(results.map(r => r.group))];

  console.log(`%c测试结果详情:`, 'font-size: 16px; font-weight: bold;');
  console.log('');

  groups.forEach(group => {
    const groupResults = results.filter(r => r.group === group);
    const groupSuccess = groupResults.filter(r => r.success).length;

    console.log(`%c${group} (${groupSuccess}/${groupResults.length})`, 'font-size: 14px; font-weight: bold; color: #1890ff;');

    groupResults.forEach(result => {
      const icon = result.success ? '✓' : '✗';
      const color = result.success ? '#52c41a' : '#f5222d';
      console.log(`  %c${icon} ${result.name}`, `color: ${color}; font-weight: bold;`);
      console.log(`    路径: ${result.path}`);
      if (result.success) {
        console.log(`    加载时间: ${result.loadTime}ms`);
      } else if (result.error) {
        console.log(`    %c错误: ${result.error}`, 'color: #f5222d;');
      }
    });
    console.log('');
  });

  // 失败项目汇总
  if (failCount > 0) {
    console.log(`%c失败项目汇总:`, 'font-size: 16px; font-weight: bold; color: #f5222d;');
    results.filter(r => !r.success).forEach(result => {
      console.log(`  • ${result.name} - ${result.path}`);
      if (result.error) {
        console.log(`    原因: ${result.error}`);
      }
    });
    console.log('');
  }

  // 生成文本报告
  const report = `ChainlessChain v0.26.2 自动化测试报告
测试时间: ${new Date().toLocaleString()}
======================================

测试结果:
- 总测试项: ${results.length}
- 成功: ${successCount}
- 失败: ${failCount}
- 成功率: ${successRate}%

详细结果:
${results.map(r => `${r.success ? '✓' : '✗'} ${r.name} - ${r.path}${r.error ? ` (${r.error})` : ''}`).join('\n')}

${failCount > 0 ? `失败项目:\n${results.filter(r => !r.success).map(r => `- ${r.name}: ${r.path}\n  原因: ${r.error}`).join('\n')}` : ''}

分组统计:
${groups.map(group => {
  const groupResults = results.filter(r => r.group === group);
  const groupSuccess = groupResults.filter(r => r.success).length;
  return `${group}: ${groupSuccess}/${groupResults.length}`;
}).join('\n')}
`;

  // 保存报告到全局变量
  window.TEST_REPORT = report;
  window.TEST_RESULTS = results;

  console.log('%c报告已生成！', 'color: #52c41a; font-size: 16px; font-weight: bold;');
  console.log('');
  console.log('%c复制报告到剪贴板:', 'font-size: 14px; font-weight: bold;');
  console.log('  执行: copy(window.TEST_REPORT)');
  console.log('');
  console.log('%c查看详细结果:', 'font-size: 14px; font-weight: bold;');
  console.log('  执行: console.table(window.TEST_RESULTS)');
  console.log('');

  // 尝试自动复制（可能会被浏览器阻止）
  try {
    await navigator.clipboard.writeText(report);
    console.log('%c✓ 报告已自动复制到剪贴板！', 'color: #52c41a; font-weight: bold;');
  } catch (e) {
    console.log('%c⚠️  自动复制失败，请手动执行: copy(window.TEST_REPORT)', 'color: #faad14;');
  }

  console.log('');
  console.log('%c╔════════════════════════════════════════════════════════════════╗', 'color: #1890ff; font-weight: bold;');
  console.log('%c║                    测试完成 - 感谢使用                         ║', 'color: #1890ff; font-weight: bold;');
  console.log('%c╚════════════════════════════════════════════════════════════════╝', 'color: #1890ff; font-weight: bold;');

  return results;
})();
