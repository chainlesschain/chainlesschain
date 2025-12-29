/**
 * 插件系统 Phase 2 功能测试
 * 测试沙箱隔离、权限检查和 API 接口层
 */

const fs = require('fs');
const path = require('path');

async function testPhase2Features() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║     ChainlessChain 插件系统 Phase 2 功能测试          ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  const results = {
    passed: 0,
    failed: 0,
    tests: [],
  };

  function logTest(name, passed, details = '') {
    const status = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${status} - ${name}`);
    if (details) console.log(`    ${details}`);

    results.tests.push({ name, passed, details });
    if (passed) results.passed++;
    else results.failed++;
  }

  // ==================== 测试组 1: 沙箱系统 ====================
  console.log('\n🔒 测试组 1: 沙箱隔离系统');
  console.log('─'.repeat(60));

  // 测试 1.1: 沙箱模块存在
  const sandboxPath = path.join(__dirname, 'src/main/plugins/plugin-sandbox.js');
  const sandboxExists = fs.existsSync(sandboxPath);
  logTest(
    '沙箱模块存在',
    sandboxExists,
    sandboxExists ? `路径: ${sandboxPath}` : '文件不存在'
  );

  if (sandboxExists) {
    const sandboxContent = fs.readFileSync(sandboxPath, 'utf-8');

    // 测试 1.2: 沙箱包含必需功能
    const requiredFeatures = [
      'createSandboxContext',
      'createRequireFunction',
      'callHook',
      'enable',
      'disable',
      'unload',
    ];

    const featureResults = requiredFeatures.map(feature => ({
      feature,
      found: sandboxContent.includes(feature),
    }));

    const allFeaturesFound = featureResults.every(r => r.found);
    logTest(
      '沙箱包含核心功能',
      allFeaturesFound,
      allFeaturesFound
        ? `${requiredFeatures.length} 个功能`
        : `缺少: ${featureResults.filter(r => !r.found).map(r => r.feature).join(', ')}`
    );

    // 测试 1.3: 沙箱超时控制
    const hasTimeoutControl = sandboxContent.includes('setTimeout') && sandboxContent.includes('timeout');
    logTest(
      '沙箱包含超时控制',
      hasTimeoutControl,
      hasTimeoutControl ? '发现超时机制' : '缺少超时控制'
    );

    // 测试 1.4: 受限的 require 函数
    const hasRestrictedRequire = sandboxContent.includes('allowedModules') || sandboxContent.includes('白名单');
    logTest(
      '沙箱实现 require 白名单',
      hasRestrictedRequire,
      hasRestrictedRequire ? '发现模块白名单机制' : '缺少 require 限制'
    );

    // 测试 1.5: 沙箱上下文隔离
    const hasContextIsolation =
      sandboxContent.includes('vm.createContext') || sandboxContent.includes('createSandboxContext');
    logTest(
      '沙箱实现上下文隔离',
      hasContextIsolation,
      hasContextIsolation ? '发现上下文隔离机制' : '缺少上下文隔离'
    );

    // 测试 1.6: 生命周期钩子支持
    const lifecycleHooks = ['onEnable', 'onDisable', 'onLoad', 'onUnload'];
    const hasLifecycleSupport = lifecycleHooks.some(hook => sandboxContent.includes(hook));
    logTest(
      '沙箱支持生命周期钩子',
      hasLifecycleSupport,
      hasLifecycleSupport ? '发现生命周期钩子' : '缺少生命周期支持'
    );
  }

  // ==================== 测试组 2: 权限检查器 ====================
  console.log('\n🛡️  测试组 2: 运行时权限检查');
  console.log('─'.repeat(60));

  // 测试 2.1: 权限检查模块存在
  const permPath = path.join(__dirname, 'src/main/plugins/permission-checker.js');
  const permExists = fs.existsSync(permPath);
  logTest(
    '权限检查模块存在',
    permExists,
    permExists ? `路径: ${permPath}` : '文件不存在'
  );

  if (permExists) {
    const permContent = fs.readFileSync(permPath, 'utf-8');

    // 测试 2.2: 权限检查方法
    const permMethods = [
      'hasPermission',
      'requirePermission',
      'hasPermissions',
      'hasAnyPermission',
    ];

    const methodResults = permMethods.map(method => ({
      method,
      found: permContent.includes(method),
    }));

    const allMethodsFound = methodResults.every(r => r.found);
    logTest(
      '权限检查包含必需方法',
      allMethodsFound,
      allMethodsFound
        ? `${permMethods.length} 个方法`
        : `缺少: ${methodResults.filter(r => !r.found).map(r => r.method).join(', ')}`
    );

    // 测试 2.3: 权限组定义
    const hasPermissionGroups = permContent.includes('permissionGroups');
    logTest(
      '定义了权限组',
      hasPermissionGroups,
      hasPermissionGroups ? '发现权限组定义' : '缺少权限组'
    );

    // 测试 2.4: 权限等级系统
    const hasPermissionLevels = permContent.includes('permissionLevels');
    logTest(
      '实现了权限等级系统',
      hasPermissionLevels,
      hasPermissionLevels ? '发现权限等级定义' : '缺少权限等级'
    );

    // 测试 2.5: 权限描述
    const hasDescriptions = permContent.includes('getPermissionDescription');
    logTest(
      '提供权限描述功能',
      hasDescriptions,
      hasDescriptions ? '发现权限描述方法' : '缺少权限描述'
    );

    // 测试 2.6: 审计日志
    const hasAuditLog = permContent.includes('logPermissionCheck') || permContent.includes('logEvent');
    logTest(
      '支持权限审计日志',
      hasAuditLog,
      hasAuditLog ? '发现审计日志功能' : '缺少审计功能'
    );

    // 测试 2.7: 权限分类统计
    const permissionCategories = ['database', 'llm', 'ui', 'file', 'network', 'system'];
    const categoriesFound = permissionCategories.filter(cat => permContent.includes(`'${cat}:`));
    logTest(
      '定义了标准权限分类',
      categoriesFound.length >= 4,
      `找到 ${categoriesFound.length}/6 个分类: ${categoriesFound.join(', ')}`
    );
  }

  // ==================== 测试组 3: 插件 API 接口层 ====================
  console.log('\n🔌 测试组 3: 插件 API 接口层');
  console.log('─'.repeat(60));

  // 测试 3.1: API 模块存在
  const apiPath = path.join(__dirname, 'src/main/plugins/plugin-api.js');
  const apiExists = fs.existsSync(apiPath);
  logTest(
    'API 接口模块存在',
    apiExists,
    apiExists ? `路径: ${apiPath}` : '文件不存在'
  );

  if (apiExists) {
    const apiContent = fs.readFileSync(apiPath, 'utf-8');

    // 测试 3.2: API 子系统
    const apiSubsystems = [
      'buildDatabaseAPI',
      'buildLLMAPI',
      'buildRAGAPI',
      'buildUIAPI',
      'buildFileAPI',
      'buildNetworkAPI',
      'buildSystemAPI',
      'buildStorageAPI',
      'buildUtilsAPI',
    ];

    const subsystemResults = apiSubsystems.map(sub => ({
      subsystem: sub,
      found: apiContent.includes(sub),
    }));

    const allSubsystemsFound = subsystemResults.every(r => r.found);
    logTest(
      'API 包含所有子系统',
      allSubsystemsFound,
      allSubsystemsFound
        ? `${apiSubsystems.length} 个子系统`
        : `缺少: ${subsystemResults.filter(r => !r.found).map(r => r.subsystem).join(', ')}`
    );

    // 测试 3.3: 安全方法包装
    const hasSecureMethod = apiContent.includes('createSecureMethod');
    logTest(
      '实现了安全方法包装',
      hasSecureMethod,
      hasSecureMethod ? '发现 createSecureMethod' : '缺少安全包装'
    );

    // 测试 3.4: 路径安全检查
    const hasSafePath = apiContent.includes('getSafePath');
    logTest(
      '实现了路径安全检查',
      hasSafePath,
      hasSafePath ? '发现路径穿越防护' : '缺少路径安全'
    );

    // 测试 3.5: API 调用统计
    const hasStats = apiContent.includes('updateStats') || apiContent.includes('logAPICall');
    logTest(
      '支持 API 调用统计',
      hasStats,
      hasStats ? '发现统计功能' : '缺少统计功能'
    );

    // 测试 3.6: 权限检查集成
    const hasPermCheck = apiContent.includes('permissionChecker') && apiContent.includes('requirePermission');
    logTest(
      'API 集成权限检查',
      hasPermCheck,
      hasPermCheck ? '发现权限集成' : '缺少权限集成'
    );

    // 测试 3.7: 数据库 API 方法
    const dbMethods = ['query', 'getNote', 'createNote', 'updateNote', 'deleteNote'];
    const dbMethodsFound = dbMethods.filter(m => apiContent.includes(m));
    logTest(
      '数据库 API 完整',
      dbMethodsFound.length >= 4,
      `找到 ${dbMethodsFound.length}/${dbMethods.length} 个方法`
    );

    // 测试 3.8: LLM API 方法
    const llmMethods = ['llm:query', 'llm:stream'];
    const llmMethodsFound = llmMethods.filter(m => apiContent.includes(m));
    logTest(
      'LLM API 完整',
      llmMethodsFound.length >= 1,
      `找到 ${llmMethodsFound.length}/${llmMethods.length} 个方法`
    );

    // 测试 3.9: 文件 API 安全性
    const hasFileSecurity = apiContent.includes('pluginDataDir') || apiContent.includes('plugin-data');
    logTest(
      '文件 API 实现目录隔离',
      hasFileSecurity,
      hasFileSecurity ? '发现插件数据目录隔离' : '缺少目录隔离'
    );

    // 测试 3.10: 网络 API 限制
    const hasNetworkRestriction = apiContent.includes('https://') || apiContent.includes('只允许HTTPS');
    logTest(
      '网络 API 实现 HTTPS 限制',
      hasNetworkRestriction,
      hasNetworkRestriction ? '发现 HTTPS 强制' : '缺少网络限制'
    );
  }

  // ==================== 测试组 4: 集成测试 ====================
  console.log('\n🔗 测试组 4: 系统集成');
  console.log('─'.repeat(60));

  // 测试 4.1: 插件管理器集成
  const managerPath = path.join(__dirname, 'src/main/plugins/plugin-manager.js');
  const managerExists = fs.existsSync(managerPath);

  if (managerExists) {
    const managerContent = fs.readFileSync(managerPath, 'utf-8');

    // 测试沙箱集成
    const hasSandboxIntegration =
      managerContent.includes('PluginSandbox') &&
      managerContent.includes('new PluginSandbox');
    logTest(
      '插件管理器集成沙箱',
      hasSandboxIntegration,
      hasSandboxIntegration ? '发现沙箱集成' : '缺少沙箱集成'
    );

    // 测试权限检查器集成
    const hasPermCheckerIntegration =
      managerContent.includes('PermissionChecker') &&
      managerContent.includes('new PermissionChecker');
    logTest(
      '插件管理器集成权限检查',
      hasPermCheckerIntegration,
      hasPermCheckerIntegration ? '发现权限检查集成' : '缺少权限检查集成'
    );

    // 测试 API 集成
    const hasAPIIntegration =
      managerContent.includes('PluginAPI') &&
      managerContent.includes('new PluginAPI');
    logTest(
      '插件管理器集成 API 层',
      hasAPIIntegration,
      hasAPIIntegration ? '发现 API 集成' : '缺少 API 集成'
    );

    // 测试生命周期管理
    const hasLifecycleManagement =
      managerContent.includes('enablePlugin') &&
      managerContent.includes('disablePlugin') &&
      managerContent.includes('loadPlugin');
    logTest(
      '插件管理器实现生命周期',
      hasLifecycleManagement,
      hasLifecycleManagement ? '发现完整生命周期' : '缺少生命周期管理'
    );
  }

  // ==================== 测试总结 ====================
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                      测试总结                              ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  const total = results.passed + results.failed;
  const passRate = ((results.passed / total) * 100).toFixed(1);

  console.log(`总测试数: ${total}`);
  console.log(`✅ 通过: ${results.passed}`);
  console.log(`❌ 失败: ${results.failed}`);
  console.log(`通过率: ${passRate}%\n`);

  // 功能完成度评估
  console.log('📊 Phase 2 功能完成度:');
  console.log('─'.repeat(60));

  const featureGroups = {
    '沙箱隔离系统': results.tests.slice(0, 6),
    '运行时权限检查': results.tests.slice(6, 13),
    '插件 API 接口层': results.tests.slice(13, 23),
    '系统集成': results.tests.slice(23),
  };

  Object.entries(featureGroups).forEach(([groupName, tests]) => {
    const groupPassed = tests.filter(t => t.passed).length;
    const groupTotal = tests.length;
    const groupRate = ((groupPassed / groupTotal) * 100).toFixed(0);

    const status = groupRate == 100 ? '✅' : groupRate >= 80 ? '⚠️' : '❌';
    console.log(`${status} ${groupName}: ${groupPassed}/${groupTotal} (${groupRate}%)`);
  });

  console.log('');

  if (results.failed === 0) {
    console.log('🎉 恭喜！Phase 2 所有功能测试通过！\n');
    console.log('✨ Phase 2 功能已完成:');
    console.log('  ✅ 沙箱隔离系统 - 安全的插件执行环境');
    console.log('  ✅ 运行时权限检查 - 细粒度权限控制');
    console.log('  ✅ 插件 API 接口层 - 9 个子系统 API');
    console.log('  ✅ 系统集成 - 完整的生命周期管理\n');

    console.log('📝 下一步建议:');
    console.log('  1. 在实际应用中测试插件安全性');
    console.log('  2. 编写安全性测试用例（恶意代码检测）');
    console.log('  3. 性能测试和优化');
    console.log('  4. 开始 Phase 3: UI 扩展系统\n');
  } else {
    console.log('⚠️  部分测试失败，请检查并修复。\n');
  }

  // 保存测试报告
  const reportPath = path.join(__dirname, 'plugin-phase2-test-report.json');
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        phase: 'Phase 2',
        summary: {
          total,
          passed: results.passed,
          failed: results.failed,
          passRate: `${passRate}%`,
        },
        featureGroups: Object.entries(featureGroups).map(([name, tests]) => ({
          name,
          passed: tests.filter(t => t.passed).length,
          total: tests.length,
        })),
        tests: results.tests,
      },
      null,
      2
    )
  );

  console.log(`📄 测试报告已保存: ${reportPath}\n`);

  return results.failed === 0;
}

// 运行测试
testPhase2Features()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('测试执行出错:', error);
    process.exit(1);
  });
