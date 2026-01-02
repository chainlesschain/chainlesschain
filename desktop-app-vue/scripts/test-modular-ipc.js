/**
 * 模块化 IPC 测试脚本
 * 验证 IPC 注册中心和各个模块是否正常工作
 */

const path = require('path');

console.log('='.repeat(70));
console.log('ChainlessChain 模块化 IPC 测试');
console.log('='.repeat(70));
console.log('');

// 测试结果统计
const results = {
  passed: 0,
  failed: 0,
  warnings: 0,
  tests: []
};

/**
 * 添加测试结果
 */
function addTest(name, passed, message = '') {
  const result = {
    name,
    passed,
    message
  };

  results.tests.push(result);

  if (passed) {
    results.passed++;
    console.log(`✓ ${name}`);
  } else {
    results.failed++;
    console.log(`✗ ${name}`);
  }

  if (message) {
    console.log(`  ${message}`);
  }
}

/**
 * 添加警告
 */
function addWarning(message) {
  results.warnings++;
  console.log(`⚠ ${message}`);
}

console.log('📋 第一步：文件存在性检查');
console.log('-'.repeat(70));

// 检查必需的文件
const requiredFiles = [
  'src/main/ipc-registry.js',
  'src/main/llm/llm-ipc.js',
  'src/main/rag/rag-ipc.js',
  'src/main/ukey/ukey-ipc.js',
  'src/main/database/database-ipc.js',
  'src/main/git/git-ipc.js',
  'src/main/did/did-ipc.js',
  'src/main/p2p/p2p-ipc.js',
  'src/main/social/social-ipc.js',
  'src/main/vc/vc-ipc.js',
  'src/main/identity-context/identity-context-ipc.js',
  'src/main/organization/organization-ipc.js',
  'src/main/project/project-core-ipc.js',
  'src/main/project/project-ai-ipc.js',
  'src/main/project/project-export-ipc.js',
  'src/main/project/project-rag-ipc.js',
  'src/main/project/project-git-ipc.js',
  'templates/ipc-template.js',
  'src/main/index.js'
];

const fs = require('fs');

requiredFiles.forEach(file => {
  const filePath = path.join(__dirname, '..', file);
  const exists = fs.existsSync(filePath);
  addTest(`文件存在: ${file}`, exists, exists ? '' : `路径: ${filePath}`);
});

console.log('');
console.log('📋 第二步：模块导入检查');
console.log('-'.repeat(70));

// 尝试导入各个模块
try {
  const ipcRegistry = require('../src/main/ipc-registry');
  addTest('导入 ipc-registry.js', true);

  // 检查导出的函数
  if (typeof ipcRegistry.registerAllIPC === 'function') {
    addTest('ipc-registry 导出 registerAllIPC', true);
  } else {
    addTest('ipc-registry 导出 registerAllIPC', false, '未找到 registerAllIPC 函数');
  }
} catch (error) {
  addTest('导入 ipc-registry.js', false, error.message);
}

try {
  const llmIPC = require('../src/main/llm/llm-ipc');
  addTest('导入 llm/llm-ipc.js', true);

  if (typeof llmIPC.registerLLMIPC === 'function') {
    addTest('llm-ipc 导出 registerLLMIPC', true);
  } else {
    addTest('llm-ipc 导出 registerLLMIPC', false);
  }
} catch (error) {
  addTest('导入 llm/llm-ipc.js', false, error.message);
}

try {
  const ragIPC = require('../src/main/rag/rag-ipc');
  addTest('导入 rag/rag-ipc.js', true);

  if (typeof ragIPC.registerRAGIPC === 'function') {
    addTest('rag-ipc 导出 registerRAGIPC', true);
  } else {
    addTest('rag-ipc 导出 registerRAGIPC', false);
  }
} catch (error) {
  addTest('导入 rag/rag-ipc.js', false, error.message);
}

try {
  const ukeyIPC = require('../src/main/ukey/ukey-ipc');
  addTest('导入 ukey/ukey-ipc.js', true);

  if (typeof ukeyIPC.registerUKeyIPC === 'function') {
    addTest('ukey-ipc 导出 registerUKeyIPC', true);
  } else {
    addTest('ukey-ipc 导出 registerUKeyIPC', false);
  }
} catch (error) {
  addTest('导入 ukey/ukey-ipc.js', false, error.message);
}

try {
  const databaseIPC = require('../src/main/database/database-ipc');
  addTest('导入 database/database-ipc.js', true);

  if (typeof databaseIPC.registerDatabaseIPC === 'function') {
    addTest('database-ipc 导出 registerDatabaseIPC', true);
  } else {
    addTest('database-ipc 导出 registerDatabaseIPC', false);
  }
} catch (error) {
  addTest('导入 database/database-ipc.js', false, error.message);
}

try {
  const gitIPC = require('../src/main/git/git-ipc');
  addTest('导入 git/git-ipc.js', true);

  if (typeof gitIPC.registerGitIPC === 'function') {
    addTest('git-ipc 导出 registerGitIPC', true);
  } else {
    addTest('git-ipc 导出 registerGitIPC', false);
  }
} catch (error) {
  addTest('导入 git/git-ipc.js', false, error.message);
}

try {
  const didIPC = require('../src/main/did/did-ipc');
  addTest('导入 did/did-ipc.js', true);

  if (typeof didIPC.registerDIDIPC === 'function') {
    addTest('did-ipc 导出 registerDIDIPC', true);
  } else {
    addTest('did-ipc 导出 registerDIDIPC', false);
  }
} catch (error) {
  addTest('导入 did/did-ipc.js', false, error.message);
}

try {
  const p2pIPC = require('../src/main/p2p/p2p-ipc');
  addTest('导入 p2p/p2p-ipc.js', true);

  if (typeof p2pIPC.registerP2PIPC === 'function') {
    addTest('p2p-ipc 导出 registerP2PIPC', true);
  } else {
    addTest('p2p-ipc 导出 registerP2PIPC', false);
  }
} catch (error) {
  addTest('导入 p2p/p2p-ipc.js', false, error.message);
}

try {
  const socialIPC = require('../src/main/social/social-ipc');
  addTest('导入 social/social-ipc.js', true);

  if (typeof socialIPC.registerSocialIPC === 'function') {
    addTest('social-ipc 导出 registerSocialIPC', true);
  } else {
    addTest('social-ipc 导出 registerSocialIPC', false);
  }
} catch (error) {
  addTest('导入 social/social-ipc.js', false, error.message);
}

try {
  const vcIPC = require('../src/main/vc/vc-ipc');
  addTest('导入 vc/vc-ipc.js', true);

  if (typeof vcIPC.registerVCIPC === 'function') {
    addTest('vc-ipc 导出 registerVCIPC', true);
  } else {
    addTest('vc-ipc 导出 registerVCIPC', false);
  }
} catch (error) {
  addTest('导入 vc/vc-ipc.js', false, error.message);
}

try {
  const identityContextIPC = require('../src/main/identity-context/identity-context-ipc');
  addTest('导入 identity-context/identity-context-ipc.js', true);

  if (typeof identityContextIPC.registerIdentityContextIPC === 'function') {
    addTest('identity-context-ipc 导出 registerIdentityContextIPC', true);
  } else {
    addTest('identity-context-ipc 导出 registerIdentityContextIPC', false);
  }
} catch (error) {
  addTest('导入 identity-context/identity-context-ipc.js', false, error.message);
}

try {
  const organizationIPC = require('../src/main/organization/organization-ipc');
  addTest('导入 organization/organization-ipc.js', true);

  if (typeof organizationIPC.registerOrganizationIPC === 'function') {
    addTest('organization-ipc 导出 registerOrganizationIPC', true);
  } else {
    addTest('organization-ipc 导出 registerOrganizationIPC', false);
  }
} catch (error) {
  addTest('导入 organization/organization-ipc.js', false, error.message);
}

// Phase 5: 项目管理模块
try {
  const projectCoreIPC = require('../src/main/project/project-core-ipc');
  addTest('导入 project/project-core-ipc.js', true);
  if (typeof projectCoreIPC.registerProjectCoreIPC === 'function') {
    addTest('project-core-ipc 导出 registerProjectCoreIPC', true);
  } else {
    addTest('project-core-ipc 导出 registerProjectCoreIPC', false);
  }
} catch (error) {
  addTest('导入 project/project-core-ipc.js', false, error.message);
}

try {
  const projectAIIPC = require('../src/main/project/project-ai-ipc');
  addTest('导入 project/project-ai-ipc.js', true);
  if (typeof projectAIIPC.registerProjectAIIPC === 'function') {
    addTest('project-ai-ipc 导出 registerProjectAIIPC', true);
  } else {
    addTest('project-ai-ipc 导出 registerProjectAIIPC', false);
  }
} catch (error) {
  addTest('导入 project/project-ai-ipc.js', false, error.message);
}

try {
  const projectExportIPC = require('../src/main/project/project-export-ipc');
  addTest('导入 project/project-export-ipc.js', true);
  if (typeof projectExportIPC.registerProjectExportIPC === 'function') {
    addTest('project-export-ipc 导出 registerProjectExportIPC', true);
  } else {
    addTest('project-export-ipc 导出 registerProjectExportIPC', false);
  }
} catch (error) {
  addTest('导入 project/project-export-ipc.js', false, error.message);
}

try {
  const projectRAGIPC = require('../src/main/project/project-rag-ipc');
  addTest('导入 project/project-rag-ipc.js', true);
  if (typeof projectRAGIPC.registerProjectRAGIPC === 'function') {
    addTest('project-rag-ipc 导出 registerProjectRAGIPC', true);
  } else {
    addTest('project-rag-ipc 导出 registerProjectRAGIPC', false);
  }
} catch (error) {
  addTest('导入 project/project-rag-ipc.js', false, error.message);
}

try {
  const projectGitIPC = require('../src/main/project/project-git-ipc');
  addTest('导入 project/project-git-ipc.js', true);
  if (typeof projectGitIPC.registerProjectGitIPC === 'function') {
    addTest('project-git-ipc 导出 registerProjectGitIPC', true);
  } else {
    addTest('project-git-ipc 导出 registerProjectGitIPC', false);
  }
} catch (error) {
  addTest('导入 project/project-git-ipc.js', false, error.message);
}

console.log('');
console.log('📋 第三步：代码质量检查');
console.log('-'.repeat(70));

// 检查主文件中是否正确注释了已迁移的代码
const indexPath = path.join(__dirname, '..', 'src/main/index.js');
const indexContent = fs.readFileSync(indexPath, 'utf-8');

// 检查是否包含 IPC 注册中心调用
if (indexContent.includes("require('./ipc-registry')")) {
  addTest('主文件包含 IPC 注册中心导入', true);
} else {
  addTest('主文件包含 IPC 注册中心导入', false);
}

if (indexContent.includes('registerAllIPC')) {
  addTest('主文件调用 registerAllIPC', true);
} else {
  addTest('主文件调用 registerAllIPC', false);
}

// 检查是否正确注释了已迁移的 handlers
const migratedMarkers = [
  'MIGRATED TO llm/llm-ipc.js',
  'MIGRATED TO rag/rag-ipc.js',
  'MIGRATED TO ukey/ukey-ipc.js',
  'MIGRATED TO database/database-ipc.js',
  'MIGRATED TO git/git-ipc.js',
  'MIGRATED TO did/did-ipc.js',
  'MIGRATED TO p2p/p2p-ipc.js',
  'MIGRATED TO social/social-ipc.js',
  'MIGRATED TO vc/vc-ipc.js',
  'MIGRATED TO identity-context/identity-context-ipc.js',
  'MIGRATED TO organization/organization-ipc.js',
  'MIGRATED TO project/project-core-ipc.js',
  'MIGRATED TO project/project-ai-ipc.js',
  'MIGRATED TO project/project-export-ipc.js',
  'MIGRATED TO project/project-rag-ipc.js',
  'MIGRATED TO project/project-git-ipc.js'
];

migratedMarkers.forEach(marker => {
  if (indexContent.includes(marker)) {
    addTest(`已迁移代码标记: ${marker}`, true);
  } else {
    addWarning(`未找到标记: ${marker}`);
  }
});

console.log('');
console.log('📋 第四步：代码行数统计');
console.log('-'.repeat(70));

// 统计各个文件的行数
function countLines(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.split('\n').length;
  } catch (error) {
    return 0;
  }
}

const fileSizes = {
  'ipc-registry.js': countLines(path.join(__dirname, '..', 'src/main/ipc-registry.js')),
  'llm-ipc.js': countLines(path.join(__dirname, '..', 'src/main/llm/llm-ipc.js')),
  'rag-ipc.js': countLines(path.join(__dirname, '..', 'src/main/rag/rag-ipc.js')),
  'ukey-ipc.js': countLines(path.join(__dirname, '..', 'src/main/ukey/ukey-ipc.js')),
  'database-ipc.js': countLines(path.join(__dirname, '..', 'src/main/database/database-ipc.js')),
  'git-ipc.js': countLines(path.join(__dirname, '..', 'src/main/git/git-ipc.js')),
  'did-ipc.js': countLines(path.join(__dirname, '..', 'src/main/did/did-ipc.js')),
  'p2p-ipc.js': countLines(path.join(__dirname, '..', 'src/main/p2p/p2p-ipc.js')),
  'social-ipc.js': countLines(path.join(__dirname, '..', 'src/main/social/social-ipc.js')),
  'vc-ipc.js': countLines(path.join(__dirname, '..', 'src/main/vc/vc-ipc.js')),
  'identity-context-ipc.js': countLines(path.join(__dirname, '..', 'src/main/identity-context/identity-context-ipc.js')),
  'organization-ipc.js': countLines(path.join(__dirname, '..', 'src/main/organization/organization-ipc.js')),
  'project-core-ipc.js': countLines(path.join(__dirname, '..', 'src/main/project/project-core-ipc.js')),
  'project-ai-ipc.js': countLines(path.join(__dirname, '..', 'src/main/project/project-ai-ipc.js')),
  'project-export-ipc.js': countLines(path.join(__dirname, '..', 'src/main/project/project-export-ipc.js')),
  'project-rag-ipc.js': countLines(path.join(__dirname, '..', 'src/main/project/project-rag-ipc.js')),
  'project-git-ipc.js': countLines(path.join(__dirname, '..', 'src/main/project/project-git-ipc.js')),
  'ipc-template.js': countLines(path.join(__dirname, '..', 'templates/ipc-template.js')),
  'index.js': countLines(path.join(__dirname, '..', 'src/main/index.js'))
};

console.log('文件大小统计:');
Object.entries(fileSizes).forEach(([file, lines]) => {
  console.log(`  ${file.padEnd(30)} ${String(lines).padStart(5)} 行`);
});

const totalModularLines = fileSizes['ipc-registry.js'] +
                          fileSizes['llm-ipc.js'] +
                          fileSizes['rag-ipc.js'] +
                          fileSizes['ukey-ipc.js'] +
                          fileSizes['database-ipc.js'] +
                          fileSizes['git-ipc.js'] +
                          fileSizes['did-ipc.js'] +
                          fileSizes['p2p-ipc.js'] +
                          fileSizes['social-ipc.js'] +
                          fileSizes['vc-ipc.js'] +
                          fileSizes['identity-context-ipc.js'] +
                          fileSizes['organization-ipc.js'] +
                          fileSizes['project-core-ipc.js'] +
                          fileSizes['project-ai-ipc.js'] +
                          fileSizes['project-export-ipc.js'] +
                          fileSizes['project-rag-ipc.js'] +
                          fileSizes['project-git-ipc.js'];

console.log(`  ${'模块化代码总计'.padEnd(30)} ${String(totalModularLines).padStart(5)} 行`);

console.log('');
console.log('='.repeat(70));
console.log('测试总结');
console.log('='.repeat(70));

console.log(`✓ 通过: ${results.passed}`);
console.log(`✗ 失败: ${results.failed}`);
console.log(`⚠ 警告: ${results.warnings}`);

console.log('');

if (results.failed === 0) {
  console.log('🎉 所有测试通过！模块化 IPC 架构已成功实施');
  console.log('');
  console.log('下一步：');
  console.log('  1. 运行 npm run dev 启动应用');
  console.log('  2. 测试 LLM 聊天功能');
  console.log('  3. 测试 RAG 知识库检索');
  console.log('  4. 测试 U-Key 硬件功能');
  process.exit(0);
} else {
  console.log('❌ 发现问题，请检查上述失败的测试项');
  process.exit(1);
}
