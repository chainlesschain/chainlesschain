/**
 * ChainlessChain Web Clipper - 自动化测试运行器
 * 执行基础的连接性和API测试
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// 配置
const API_BASE_URL = 'http://localhost:23456';
const BUILD_DIR = path.join(__dirname, 'build', 'chrome');

// 测试结果
const results = {
  passed: 0,
  failed: 0,
  tests: []
};

// 颜色输出（Windows 兼容）
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logTest(name, passed, message = '') {
  const status = passed ? '✓' : '✗';
  const color = passed ? 'green' : 'red';
  log(`${status} ${name}${message ? ': ' + message : ''}`, color);

  results.tests.push({ name, passed, message });
  if (passed) {
    results.passed++;
  } else {
    results.failed++;
  }
}

// HTTP 请求工具
function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ statusCode: res.statusCode, data: json });
        } catch (e) {
          resolve({ statusCode: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}

// 测试套件

/**
 * Phase 1: 环境检查
 */
async function testEnvironment() {
  log('\n=== Phase 1: 环境检查 ===', 'cyan');

  // T1.1 - 检查构建产物
  const buildExists = fs.existsSync(BUILD_DIR);
  logTest('T1.1 - 构建目录存在', buildExists, BUILD_DIR);

  if (buildExists) {
    // T1.2 - 检查必要文件
    const requiredFiles = [
      'manifest.json',
      'popup/popup.html',
      'popup/popup.js',
      'background/background.js',
      'content/content-script.js',
      'annotation/annotation-editor.js',
      'batch/batch-clipper.js',
    ];

    for (const file of requiredFiles) {
      const filePath = path.join(BUILD_DIR, file);
      const exists = fs.existsSync(filePath);
      logTest(`T1.2 - ${file}`, exists);
    }
  }
}

/**
 * Phase 2: API 连接测试
 */
async function testAPIConnection() {
  log('\n=== Phase 2: API 连接测试 ===', 'cyan');

  // T2.1 - Ping 测试
  try {
    const response = await httpRequest(`${API_BASE_URL}/api/ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    const passed = response.statusCode === 200 && response.data.success === true;
    logTest('T2.1 - API Ping', passed, JSON.stringify(response.data));
  } catch (error) {
    logTest('T2.1 - API Ping', false, error.message);
  }

  // T2.2 - 测试剪藏 API（模拟请求）
  try {
    const testData = {
      title: '测试页面',
      content: '<h1>测试内容</h1><p>这是一个测试。</p>',
      url: 'https://example.com/test',
      type: 'web_clip',
      tags: ['测试'],
      autoIndex: false
    };

    const response = await httpRequest(`${API_BASE_URL}/api/clip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testData)
    });

    const passed = response.statusCode === 200 && response.data.success === true;
    logTest('T2.2 - 剪藏 API', passed,
      passed ? `ID: ${response.data.data?.id}` : JSON.stringify(response.data));
  } catch (error) {
    logTest('T2.2 - 剪藏 API', false, error.message);
  }
}

/**
 * Phase 3: AI 功能测试
 */
async function testAIFeatures() {
  log('\n=== Phase 3: AI 功能测试 ===', 'cyan');

  // T3.1 - AI 标签生成 API
  try {
    const testData = {
      title: 'React Hooks 完全指南',
      content: 'React Hooks 是 React 16.8 引入的新特性...',
      url: 'https://example.com/react-hooks'
    };

    const response = await httpRequest(`${API_BASE_URL}/api/generate-tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testData)
    });

    const passed = response.statusCode === 200 && response.data.success === true;
    logTest('T3.1 - AI 标签生成 API', passed,
      passed ? `标签: ${response.data.data?.tags?.join(', ')}` : 'Fallback 或错误');
  } catch (error) {
    logTest('T3.1 - AI 标签生成 API', false, error.message);
  }

  // T3.2 - AI 摘要生成 API
  try {
    const testData = {
      title: 'React Hooks 完全指南',
      content: 'React Hooks 是 React 16.8 引入的新特性，它让你在不编写 class 的情况下使用 state 以及其他的 React 特性。Hooks 的出现改变了 React 组件的编写方式...'
    };

    const response = await httpRequest(`${API_BASE_URL}/api/generate-summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testData)
    });

    const passed = response.statusCode === 200 && response.data.success === true;
    logTest('T3.2 - AI 摘要生成 API', passed,
      passed ? `长度: ${response.data.data?.summary?.length} 字符` : 'Fallback 或错误');
  } catch (error) {
    logTest('T3.2 - AI 摘要生成 API', false, error.message);
  }
}

/**
 * Phase 4: 文件完整性检查
 */
async function testFileIntegrity() {
  log('\n=== Phase 4: 文件完整性检查 ===', 'cyan');

  if (!fs.existsSync(BUILD_DIR)) {
    logTest('T4.1 - 跳过（构建目录不存在）', false);
    return;
  }

  // T4.1 - 检查 manifest.json
  const manifestPath = path.join(BUILD_DIR, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

      const hasName = !!manifest.name;
      const hasVersion = !!manifest.version;
      const hasPermissions = Array.isArray(manifest.permissions) || Array.isArray(manifest.host_permissions);
      const hasBackground = !!manifest.background;
      const hasAction = !!manifest.action;

      logTest('T4.1 - manifest.json 有效',
        hasName && hasVersion && hasPermissions && hasBackground && hasAction,
        `v${manifest.version}`);

      logTest('T4.2 - 版本号', hasVersion, manifest.version);
      logTest('T4.3 - 权限配置', hasPermissions);
      logTest('T4.4 - Background 配置', hasBackground);
    } catch (error) {
      logTest('T4.1 - manifest.json 解析', false, error.message);
    }
  }

  // T4.5 - 检查文件大小
  const fileSizes = [
    { file: 'popup/popup.js', maxSize: 100 * 1024 }, // 100KB
    { file: 'background/background.js', maxSize: 100 * 1024 },
    { file: 'batch/batch-clipper.js', maxSize: 100 * 1024 },
    { file: 'annotation/annotation-editor.js', maxSize: 100 * 1024 },
  ];

  for (const { file, maxSize } of fileSizes) {
    const filePath = path.join(BUILD_DIR, file);
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      const sizeKB = (stats.size / 1024).toFixed(2);
      const passed = stats.size <= maxSize;
      logTest(`T4.5 - ${file} 大小`, passed, `${sizeKB} KB`);
    }
  }
}

/**
 * 生成测试报告
 */
function generateReport() {
  log('\n=== 测试报告 ===', 'cyan');
  log(`总测试数: ${results.tests.length}`, 'blue');
  log(`通过: ${results.passed}`, 'green');
  log(`失败: ${results.failed}`, 'red');
  log(`通过率: ${((results.passed / results.tests.length) * 100).toFixed(2)}%`,
    results.failed === 0 ? 'green' : 'yellow');

  if (results.failed > 0) {
    log('\n失败的测试:', 'red');
    results.tests
      .filter(t => !t.passed)
      .forEach(t => log(`  - ${t.name}: ${t.message}`, 'red'));
  }

  // 保存报告到文件
  const reportPath = path.join(__dirname, 'test-report.json');
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      total: results.tests.length,
      passed: results.passed,
      failed: results.failed,
      passRate: ((results.passed / results.tests.length) * 100).toFixed(2) + '%'
    },
    tests: results.tests
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  log(`\n测试报告已保存到: ${reportPath}`, 'cyan');
}

/**
 * 主函数
 */
async function main() {
  log('ChainlessChain Web Clipper - 自动化测试', 'cyan');
  log('================================================', 'cyan');

  try {
    await testEnvironment();
    await testAPIConnection();
    await testAIFeatures();
    await testFileIntegrity();
  } catch (error) {
    log(`\n测试运行失败: ${error.message}`, 'red');
    console.error(error);
  }

  generateReport();

  // 退出码
  process.exit(results.failed > 0 ? 1 : 0);
}

// 运行测试
main();
