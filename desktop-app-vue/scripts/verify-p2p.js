#!/usr/bin/env node

/**
 * P2P功能快速验证脚本
 * 快速检查P2P功能是否正常工作
 */

const http = require('http');
const WebSocket = require('ws');

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function success(message) {
  log(`✅ ${message}`, 'green');
}

function error(message) {
  log(`❌ ${message}`, 'red');
}

function info(message) {
  log(`ℹ️  ${message}`, 'blue');
}

function warning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

// 测试结果
const results = {
  total: 0,
  passed: 0,
  failed: 0,
  tests: [],
};

function recordTest(name, passed, message = '') {
  results.total++;
  if (passed) {
    results.passed++;
    success(`${name}: ${message || '通过'}`);
  } else {
    results.failed++;
    error(`${name}: ${message || '失败'}`);
  }
  results.tests.push({ name, passed, message });
}

// 检查HTTP服务器
async function checkHTTPServer() {
  info('\n检查HTTP服务器...');

  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: 'localhost',
        port: 23456,
        path: '/api/ping',
        method: 'POST',
        timeout: 5000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.success && json.data.message === 'pong') {
              recordTest('HTTP服务器', true, 'http://localhost:23456');
              resolve(true);
            } else {
              recordTest('HTTP服务器', false, '响应格式错误');
              resolve(false);
            }
          } catch (err) {
            recordTest('HTTP服务器', false, err.message);
            resolve(false);
          }
        });
      }
    );

    req.on('error', (err) => {
      recordTest('HTTP服务器', false, err.message);
      resolve(false);
    });

    req.on('timeout', () => {
      recordTest('HTTP服务器', false, '连接超时');
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

// 检查信令服务器
async function checkSignalingServer() {
  info('\n检查信令服务器...');

  return new Promise((resolve) => {
    const ws = new WebSocket('ws://localhost:9001');

    const timeout = setTimeout(() => {
      recordTest('信令服务器', false, '连接超时');
      ws.close();
      resolve(false);
    }, 5000);

    ws.on('open', () => {
      clearTimeout(timeout);
      recordTest('信令服务器', true, 'ws://localhost:9001');
      ws.close();
      resolve(true);
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      recordTest('信令服务器', false, err.message);
      resolve(false);
    });
  });
}

// 检查Electron应用
async function checkElectronApp() {
  info('\n检查Electron应用...');

  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: 'localhost',
        port: 5173,
        path: '/',
        method: 'GET',
        timeout: 5000,
      },
      (res) => {
        if (res.statusCode === 200) {
          recordTest('Electron应用', true, 'http://localhost:5173');
          resolve(true);
        } else {
          recordTest('Electron应用', false, `状态码: ${res.statusCode}`);
          resolve(false);
        }
      }
    );

    req.on('error', (err) => {
      recordTest('Electron应用', false, err.message);
      resolve(false);
    });

    req.on('timeout', () => {
      recordTest('Electron应用', false, '连接超时');
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

// 检查P2P IPC接口
async function checkP2PIPC() {
  info('\n检查P2P IPC接口...');

  // 这里只能检查文件是否存在
  const fs = require('fs');
  const path = require('path');

  const ipcFiles = [
    'src/main/p2p/p2p-enhanced-ipc.js',
    'src/main/p2p/voice-video-ipc.js',
    'src/main/p2p/screen-share-ipc.js',
    'src/main/p2p/call-history-ipc.js',
  ];

  let allExist = true;
  for (const file of ipcFiles) {
    const filePath = path.join(process.cwd(), file);
    if (fs.existsSync(filePath)) {
      success(`  ${file}`);
    } else {
      error(`  ${file} 不存在`);
      allExist = false;
    }
  }

  recordTest('P2P IPC接口', allExist, allExist ? '所有文件存在' : '部分文件缺失');
  return allExist;
}

// 检查P2P组件
async function checkP2PComponents() {
  info('\n检查P2P组件...');

  const fs = require('fs');
  const path = require('path');

  const components = [
    'src/renderer/components/call/CallWindow.vue',
    'src/renderer/components/call/ScreenSharePicker.vue',
    'src/renderer/pages/CallHistoryPage.vue',
    'src/renderer/composables/useP2PCall.js',
  ];

  let allExist = true;
  for (const file of components) {
    const filePath = path.join(process.cwd(), file);
    if (fs.existsSync(filePath)) {
      success(`  ${file}`);
    } else {
      error(`  ${file} 不存在`);
      allExist = false;
    }
  }

  recordTest('P2P组件', allExist, allExist ? '所有组件存在' : '部分组件缺失');
  return allExist;
}

// 检查测试文件
async function checkTestFiles() {
  info('\n检查测试文件...');

  const fs = require('fs');
  const path = require('path');

  const testFiles = [
    'tests/integration/p2p-call.test.js',
    'tests/unit/p2p/p2p-enhancement.test.js',
  ];

  let allExist = true;
  for (const file of testFiles) {
    const filePath = path.join(process.cwd(), file);
    if (fs.existsSync(filePath)) {
      success(`  ${file}`);
    } else {
      error(`  ${file} 不存在`);
      allExist = false;
    }
  }

  recordTest('测试文件', allExist, allExist ? '所有测试文件存在' : '部分测试文件缺失');
  return allExist;
}

// 检查文档
async function checkDocumentation() {
  info('\n检查文档...');

  const fs = require('fs');
  const path = require('path');

  const docs = [
    'docs/P2P_TEST_REPORT.md',
    'docs/P2P_MANUAL_TEST_CHECKLIST.md',
    'docs/P2P_TEST_COMPLETION_SUMMARY.md',
    'docs/P2P_ENHANCEMENT_SUMMARY.md',
    'docs/user-guide/P2P_CALL_USER_GUIDE.md',
  ];

  let allExist = true;
  for (const file of docs) {
    const filePath = path.join(process.cwd(), file);
    if (fs.existsSync(filePath)) {
      success(`  ${file}`);
    } else {
      error(`  ${file} 不存在`);
      allExist = false;
    }
  }

  recordTest('文档', allExist, allExist ? '所有文档存在' : '部分文档缺失');
  return allExist;
}

// 主函数
async function main() {
  log('\n╔════════════════════════════════════════╗', 'blue');
  log('║   P2P功能快速验证脚本                 ║', 'blue');
  log('║   ChainlessChain v0.21.0              ║', 'blue');
  log('╚════════════════════════════════════════╝\n', 'blue');

  // 运行所有检查
  await checkElectronApp();
  await checkHTTPServer();
  await checkSignalingServer();
  await checkP2PIPC();
  await checkP2PComponents();
  await checkTestFiles();
  await checkDocumentation();

  // 输出总结
  log('\n╔════════════════════════════════════════╗', 'blue');
  log('║   测试结果总结                         ║', 'blue');
  log('╚════════════════════════════════════════╝\n', 'blue');

  log(`总测试数: ${results.total}`);
  success(`通过: ${results.passed}`);
  if (results.failed > 0) {
    error(`失败: ${results.failed}`);
  }

  const passRate = ((results.passed / results.total) * 100).toFixed(2);
  log(`\n通过率: ${passRate}%\n`);

  if (results.failed === 0) {
    success('🎉 所有检查通过！P2P功能准备就绪！');
    process.exit(0);
  } else {
    error('❌ 部分检查失败，请查看上面的错误信息');
    process.exit(1);
  }
}

// 运行
main().catch((err) => {
  error(`验证脚本执行失败: ${err.message}`);
  process.exit(1);
});
