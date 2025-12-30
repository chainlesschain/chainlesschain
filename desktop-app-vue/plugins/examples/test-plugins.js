#!/usr/bin/env node

/**
 * 插件测试脚本
 * 用于测试示例插件的基本功能
 *
 * 使用方法:
 *   node test-plugins.js [plugin-name]
 */

const path = require('path');
const fs = require('fs');

// 模拟插件上下文
class MockContext {
  constructor(pluginId) {
    this.pluginId = pluginId;
    this.tools = new Map();
    this.config = {};
  }

  registerTool(name, handler) {
    console.log(`   ✓ 注册工具: ${name}`);
    this.tools.set(name, handler);
  }

  getConfig() {
    return this.config;
  }

  emit(event, data) {
    console.log(`   📡 发送事件: ${event}`);
  }

  on(event, handler) {
    console.log(`   👂 监听事件: ${event}`);
  }
}

/**
 * 测试单个插件
 */
async function testPlugin(pluginDir) {
  console.log(`\n🔬 测试插件: ${pluginDir}`);

  const pluginPath = path.join(__dirname, pluginDir);

  try {
    // 1. 检查插件目录
    if (!fs.existsSync(pluginPath)) {
      console.error(`   ❌ 插件目录不存在: ${pluginPath}`);
      return false;
    }

    // 2. 读取 plugin.json
    const manifestPath = path.join(pluginPath, 'plugin.json');
    if (!fs.existsSync(manifestPath)) {
      console.error('   ❌ 未找到 plugin.json');
      return false;
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    console.log(`   📄 插件ID: ${manifest.id}`);
    console.log(`   📦 版本: ${manifest.version}`);
    console.log(`   👤 作者: ${manifest.author}`);

    // 3. 加载插件代码
    const indexPath = path.join(pluginPath, manifest.main || 'index.js');
    if (!fs.existsSync(indexPath)) {
      console.error(`   ❌ 未找到入口文件: ${manifest.main}`);
      return false;
    }

    const plugin = require(indexPath);

    if (typeof plugin.activate !== 'function') {
      console.error('   ❌ 插件缺少 activate 函数');
      return false;
    }

    console.log('   ✓ 插件代码加载成功');

    // 4. 测试激活
    const context = new MockContext(manifest.id);
    console.log('   🚀 激活插件...');
    await plugin.activate(context);

    // 5. 验证工具注册
    const expectedTools = manifest.chainlesschain?.tools?.map(t => t.name) || [];
    console.log(`   📊 预期工具数: ${expectedTools.length}`);
    console.log(`   📊 实际工具数: ${context.tools.size}`);

    if (context.tools.size !== expectedTools.length) {
      console.warn(`   ⚠️  工具注册数量不匹配`);
    }

    // 6. 测试工具调用
    console.log('\n   🧪 测试工具调用:');
    for (const [toolName, handler] of context.tools) {
      try {
        // 根据工具类型准备测试参数
        let testParams = {};

        if (toolName === 'weather_current') {
          testParams = { city: '北京', units: 'metric' };
        } else if (toolName === 'text_translate') {
          testParams = { text: 'Hello', from: 'en', to: 'zh-CN' };
        } else if (toolName === 'markdown_beautify') {
          testParams = { markdown: '# Test\nHello World' };
        } else if (toolName === 'language_detect') {
          testParams = { text: 'Hello World' };
        } else if (toolName === 'markdown_toc') {
          testParams = { markdown: '# Title\n## Section 1\n### Subsection' };
        }

        const result = await handler(testParams);

        if (result.success) {
          console.log(`      ✅ ${toolName} - 调用成功`);
        } else {
          console.log(`      ⚠️  ${toolName} - 返回失败: ${result.error || result.note || '未知错误'}`);
        }
      } catch (error) {
        console.error(`      ❌ ${toolName} - 调用异常: ${error.message}`);
      }
    }

    // 7. 测试停用
    if (typeof plugin.deactivate === 'function') {
      console.log('\n   🛑 停用插件...');
      await plugin.deactivate(context);
    }

    console.log(`\n   ✅ 插件 ${pluginDir} 测试通过!`);
    return true;
  } catch (error) {
    console.error(`   ❌ 测试失败: ${error.message}`);
    console.error(error.stack);
    return false;
  }
}

/**
 * 主函数
 */
async function main() {
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║   ChainlessChain 示例插件测试工具                ║');
  console.log('╚═══════════════════════════════════════════════════╝');

  const plugins = [
    'weather-query',
    'translator',
    'markdown-exporter'
  ];

  // 解析命令行参数
  const args = process.argv.slice(2);
  const targetPlugin = args[0];

  let pluginsToTest = plugins;

  if (targetPlugin) {
    if (!plugins.includes(targetPlugin)) {
      console.error(`\n❌ 未找到插件: ${targetPlugin}`);
      console.log('\n可用的示例插件:');
      plugins.forEach(p => console.log(`  - ${p}`));
      process.exit(1);
    }
    pluginsToTest = [targetPlugin];
  }

  console.log(`\n将测试 ${pluginsToTest.length} 个插件...\n`);

  let successCount = 0;
  let failureCount = 0;

  for (const plugin of pluginsToTest) {
    const success = await testPlugin(plugin);
    if (success) {
      successCount++;
    } else {
      failureCount++;
    }
  }

  // 显示总结
  console.log('\n' + '═'.repeat(55));
  console.log('📊 测试总结:');
  console.log(`   ✅ 通过: ${successCount} 个`);
  console.log(`   ❌ 失败: ${failureCount} 个`);
  console.log('═'.repeat(55));

  process.exit(failureCount > 0 ? 1 : 0);
}

// 运行主函数
if (require.main === module) {
  main();
}

module.exports = { testPlugin };
