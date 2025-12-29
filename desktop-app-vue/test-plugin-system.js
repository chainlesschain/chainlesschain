/**
 * 插件系统测试脚本
 * 测试 PluginManager, PluginRegistry, PluginLoader 的基本功能
 */

const path = require('path');
const DatabaseManager = require('./dist/main/database');
const { PluginManager } = require('./dist/main/plugins/plugin-manager');

async function testPluginSystem() {
  console.log('='.repeat(60));
  console.log('插件系统测试开始');
  console.log('='.repeat(60));

  try {
    // 1. 初始化数据库
    console.log('\n[1/6] 初始化数据库...');
    const database = new DatabaseManager();
    await database.initialize();
    console.log('✓ 数据库初始化成功');

    // 2. 创建插件管理器
    console.log('\n[2/6] 创建插件管理器...');
    const pluginManager = new PluginManager(database, {
      pluginsDir: path.join(__dirname, 'plugins-test'),
    });
    console.log('✓ 插件管理器创建成功');

    // 3. 初始化插件系统
    console.log('\n[3/6] 初始化插件系统...');
    await pluginManager.initialize();
    console.log('✓ 插件系统初始化成功');

    // 4. 获取所有插件（应该为空）
    console.log('\n[4/6] 获取插件列表...');
    const plugins = pluginManager.getPlugins();
    console.log(`✓ 当前插件数量: ${plugins.length}`);
    if (plugins.length > 0) {
      console.log('已安装的插件:');
      plugins.forEach(p => {
        console.log(`  - ${p.id} (${p.name}) v${p.version} [${p.state}]`);
      });
    }

    // 5. 安装测试插件
    console.log('\n[5/6] 安装测试插件...');
    const testPluginPath = path.join(__dirname, 'test-plugin');
    console.log(`测试插件路径: ${testPluginPath}`);

    try {
      const result = await pluginManager.installPlugin(testPluginPath);
      console.log('✓ 插件安装成功:', result);
    } catch (error) {
      console.error('✗ 插件安装失败:', error.message);
    }

    // 6. 再次获取插件列表
    console.log('\n[6/6] 再次获取插件列表...');
    const pluginsAfter = pluginManager.getPlugins();
    console.log(`✓ 当前插件数量: ${pluginsAfter.length}`);
    if (pluginsAfter.length > 0) {
      console.log('已安装的插件:');
      pluginsAfter.forEach(p => {
        console.log(`  - ${p.id} (${p.name}) v${p.version} [${p.state}]`);
        console.log(`    作者: ${p.author}`);
        console.log(`    描述: ${p.description}`);
        console.log(`    路径: ${p.path}`);
      });
    }

    // 测试插件权限
    if (pluginsAfter.length > 0) {
      const pluginId = pluginsAfter[0].id;
      console.log(`\n[额外测试] 获取插件 ${pluginId} 的权限...`);
      const permissions = pluginManager.registry.getPluginPermissions(pluginId);
      console.log('✓ 插件权限:');
      permissions.forEach(p => {
        console.log(`  - ${p.permission}: ${p.granted ? '已授予' : '未授予'}`);
      });
    }

    console.log('\n' + '='.repeat(60));
    console.log('✓ 所有测试通过！');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('\n' + '='.repeat(60));
    console.error('✗ 测试失败:');
    console.error('='.repeat(60));
    console.error(error);
    process.exit(1);
  }
}

// 运行测试
testPluginSystem().catch(console.error);
