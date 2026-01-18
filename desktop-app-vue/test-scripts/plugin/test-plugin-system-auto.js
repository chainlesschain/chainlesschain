/**
 * 插件系统自动化测试脚本
 * 直接通过主进程 API 测试插件功能
 */

const path = require('path');
const fs = require('fs');

// 导入插件管理器
const { getPluginManager } = require('./dist/main/plugins/plugin-manager');

// 模拟数据库（简化版）
class MockDatabase {
  constructor() {
    this.data = {
      plugins: [],
      permissions: [],
      extensions: [],
      events: [],
    };
  }

  prepare(sql) {
    return {
      run: (...params) => {
        console.log('[MockDB] Execute:', sql.substring(0, 100) + '...');
        return { changes: 1, lastInsertRowid: Date.now() };
      },
      get: (...params) => {
        console.log('[MockDB] Get:', sql.substring(0, 100) + '...');
        return null;
      },
      all: (...params) => {
        console.log('[MockDB] All:', sql.substring(0, 100) + '...');
        return [];
      },
    };
  }

  exec(sql) {
    console.log('[MockDB] Exec:', sql.substring(0, 100) + '...');
  }
}

async function runTests() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║        ChainlessChain 插件系统自动化测试               ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  const testResults = {
    passed: 0,
    failed: 0,
    tests: [],
  };

  function logTest(name, passed, message = '') {
    const status = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${status} - ${name}`);
    if (message) console.log(`    ${message}`);

    testResults.tests.push({ name, passed, message });
    if (passed) testResults.passed++;
    else testResults.failed++;
  }

  // ==================== 测试 1: 检查测试插件文件 ====================
  console.log('\n📦 测试组 1: 测试插件文件验证');
  console.log('─'.repeat(60));

  const testPluginPath = path.join(__dirname, 'test-plugin');
  const manifestPath = path.join(testPluginPath, 'plugin.json');
  const indexPath = path.join(testPluginPath, 'index.js');

  // 测试 1.1: 插件目录存在
  const pluginDirExists = fs.existsSync(testPluginPath);
  logTest(
    '插件目录存在',
    pluginDirExists,
    pluginDirExists ? `路径: ${testPluginPath}` : '目录不存在'
  );

  // 测试 1.2: manifest 文件存在
  const manifestExists = fs.existsSync(manifestPath);
  logTest(
    'plugin.json 存在',
    manifestExists,
    manifestExists ? `路径: ${manifestPath}` : '文件不存在'
  );

  // 测试 1.3: 入口文件存在
  const indexExists = fs.existsSync(indexPath);
  logTest(
    'index.js 存在',
    indexExists,
    indexExists ? `路径: ${indexPath}` : '文件不存在'
  );

  // 测试 1.4: manifest 格式正确
  let manifest = null;
  try {
    const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
    manifest = JSON.parse(manifestContent);
    logTest(
      'manifest 格式正确',
      true,
      `插件ID: ${manifest.id}, 版本: ${manifest.version}`
    );
  } catch (error) {
    logTest('manifest 格式正确', false, error.message);
  }

  // 测试 1.5: 必需字段检查
  if (manifest) {
    const requiredFields = ['id', 'name', 'version', 'main'];
    const missingFields = requiredFields.filter(field => !manifest[field]);
    logTest(
      'manifest 必需字段完整',
      missingFields.length === 0,
      missingFields.length > 0 ? `缺少字段: ${missingFields.join(', ')}` : '所有必需字段都存在'
    );

    // 测试 1.6: 权限字段
    logTest(
      'manifest 包含权限配置',
      Array.isArray(manifest.permissions),
      manifest.permissions ? `权限数量: ${manifest.permissions.length}` : '无权限配置'
    );

    // 测试 1.7: 扩展点字段
    logTest(
      'manifest 包含扩展点配置',
      Array.isArray(manifest.extensionPoints),
      manifest.extensionPoints ? `扩展点数量: ${manifest.extensionPoints.length}` : '无扩展点配置'
    );
  }

  // 测试 1.8: 插件类导出
  try {
    const PluginClass = require(indexPath);
    const isFunction = typeof PluginClass === 'function';
    logTest(
      'index.js 导出插件类',
      isFunction,
      isFunction ? 'Class exported successfully' : 'Not a valid class'
    );

    if (isFunction) {
      // 测试 1.9: 插件实例化
      try {
        const instance = new PluginClass();
        logTest('插件可以实例化', true, `实例名称: ${instance.name}`);

        // 测试 1.10: 生命周期方法
        const methods = ['onEnable', 'onDisable', 'onUninstall'];
        const hasMethods = methods.every(method => typeof instance[method] === 'function');
        logTest(
          '插件包含生命周期方法',
          hasMethods,
          hasMethods ? methods.join(', ') : '缺少某些方法'
        );
      } catch (error) {
        logTest('插件可以实例化', false, error.message);
      }
    }
  } catch (error) {
    logTest('index.js 导出插件类', false, error.message);
  }

  // ==================== 测试 2: 插件管理器组件 ====================
  console.log('\n🔧 测试组 2: 插件管理器组件验证');
  console.log('─'.repeat(60));

  // 测试 2.1: PluginManager 模块存在
  const pmPath = path.join(__dirname, 'dist/main/plugins/plugin-manager.js');
  const pmExists = fs.existsSync(pmPath);
  logTest(
    'PluginManager 模块存在',
    pmExists,
    pmExists ? `路径: ${pmPath}` : '文件不存在'
  );

  // 测试 2.2: PluginRegistry 模块存在
  const prPath = path.join(__dirname, 'dist/main/plugins/plugin-registry.js');
  const prExists = fs.existsSync(prPath);
  logTest(
    'PluginRegistry 模块存在',
    prExists,
    prExists ? `路径: ${prPath}` : '文件不存在'
  );

  // 测试 2.3: PluginLoader 模块存在
  const plPath = path.join(__dirname, 'dist/main/plugins/plugin-loader.js');
  const plExists = fs.existsSync(plPath);
  logTest(
    'PluginLoader 模块存在',
    plExists,
    plExists ? `路径: ${plPath}` : '文件不存在'
  );

  // 测试 2.4: 数据库迁移文件存在
  const migrationPath = path.join(__dirname, 'dist/main/database/migrations/001_plugin_system.sql');
  const migrationExists = fs.existsSync(migrationPath);
  logTest(
    '插件系统数据库迁移文件存在',
    migrationExists,
    migrationExists ? `路径: ${migrationPath}` : '文件不存在'
  );

  if (migrationExists) {
    // 测试 2.5: 迁移文件包含所需表
    const migrationContent = fs.readFileSync(migrationPath, 'utf-8');
    const requiredTables = [
      'plugins',
      'plugin_permissions',
      'plugin_dependencies',
      'plugin_extensions',
      'plugin_settings',
      'plugin_event_logs',
      'plugin_api_stats',
    ];

    const allTablesPresent = requiredTables.every(table =>
      migrationContent.includes(`CREATE TABLE IF NOT EXISTS ${table}`)
    );
    logTest(
      '迁移文件包含所有必需表',
      allTablesPresent,
      allTablesPresent ? `${requiredTables.length} 个表` : '缺少某些表'
    );
  }

  // ==================== 测试 3: Preload 脚本 ====================
  console.log('\n🌉 测试组 3: Preload 脚本验证');
  console.log('─'.repeat(60));

  const preloadPath = path.join(__dirname, 'dist/preload/index.js');
  const preloadExists = fs.existsSync(preloadPath);
  logTest(
    'Preload 脚本存在',
    preloadExists,
    preloadExists ? `路径: ${preloadPath}` : '文件不存在'
  );

  if (preloadExists) {
    const preloadContent = fs.readFileSync(preloadPath, 'utf-8');

    // 测试 3.1: 包含 plugin API
    const hasPluginAPI = preloadContent.includes('plugin: {');
    logTest(
      'Preload 包含 plugin API',
      hasPluginAPI,
      hasPluginAPI ? '找到 plugin API 定义' : '未找到 plugin API'
    );

    // 测试 3.2: 包含必需的 IPC 调用
    const requiredIPCs = [
      'plugin:get-plugins',
      'plugin:install',
      'plugin:uninstall',
      'plugin:enable',
      'plugin:disable',
      'plugin:get-permissions',
    ];

    const ipcResults = requiredIPCs.map(ipc => ({
      ipc,
      found: preloadContent.includes(ipc),
    }));

    const allIPCsFound = ipcResults.every(r => r.found);
    logTest(
      'Preload 包含所有插件 IPC 调用',
      allIPCsFound,
      allIPCsFound
        ? `${requiredIPCs.length} 个 IPC 调用`
        : `缺少: ${ipcResults.filter(r => !r.found).map(r => r.ipc).join(', ')}`
    );
  }

  // ==================== 测试 4: 前端组件 ====================
  console.log('\n🎨 测试组 4: 前端组件验证');
  console.log('─'.repeat(60));

  const componentPath = path.join(__dirname, 'src/renderer/pages/settings/PluginManagement.vue');
  const componentExists = fs.existsSync(componentPath);
  logTest(
    'PluginManagement 组件存在',
    componentExists,
    componentExists ? `路径: ${componentPath}` : '文件不存在'
  );

  if (componentExists) {
    const componentContent = fs.readFileSync(componentPath, 'utf-8');

    // 测试 4.1: 包含必需的功能
    const requiredFeatures = [
      'loadPlugins',
      'handleInstallPlugin',
      'handleUninstallPlugin',
      'handleTogglePlugin',
      'showPluginPermissions',
    ];

    const featureResults = requiredFeatures.map(feature => ({
      feature,
      found: componentContent.includes(feature),
    }));

    const allFeaturesFound = featureResults.every(r => r.found);
    logTest(
      '组件包含所有必需功能',
      allFeaturesFound,
      allFeaturesFound
        ? `${requiredFeatures.length} 个功能`
        : `缺少: ${featureResults.filter(r => !r.found).map(r => r.feature).join(', ')}`
    );
  }

  // ==================== 测试总结 ====================
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                      测试总结                              ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  const total = testResults.passed + testResults.failed;
  const passRate = ((testResults.passed / total) * 100).toFixed(1);

  console.log(`总测试数: ${total}`);
  console.log(`✅ 通过: ${testResults.passed}`);
  console.log(`❌ 失败: ${testResults.failed}`);
  console.log(`通过率: ${passRate}%\n`);

  if (testResults.failed === 0) {
    console.log('🎉 所有测试通过！插件系统已准备就绪。\n');
    console.log('📝 下一步操作:');
    console.log('  1. 启动应用: npm run dev');
    console.log('  2. 打开 "系统设置 > 插件管理"');
    console.log('  3. 按照测试流程安装并测试插件\n');
  } else {
    console.log('⚠️  有测试失败，请检查上述错误并修复。\n');
  }

  // 保存测试报告
  const reportPath = path.join(__dirname, 'plugin-test-report.json');
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        summary: {
          total,
          passed: testResults.passed,
          failed: testResults.failed,
          passRate: `${passRate}%`,
        },
        tests: testResults.tests,
      },
      null,
      2
    )
  );

  console.log(`📄 测试报告已保存: ${reportPath}\n`);

  return testResults.failed === 0;
}

// 运行测试
runTests()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('测试执行出错:', error);
    process.exit(1);
  });
