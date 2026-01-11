#!/usr/bin/env node

/**
 * P2P通讯测试运行器
 *
 * 用法：
 *   node tests/e2e/run-p2p-tests.js
 */

const { spawn } = require('child_process');
const WebSocket = require('ws');

const SIGNALING_URL = 'ws://localhost:9001';
const SIGNALING_CHECK_TIMEOUT = 5000;

console.log('='.repeat(60));
console.log('ChainlessChain P2P通讯测试');
console.log('='.repeat(60));
console.log('');

/**
 * 检查信令服务器是否运行
 */
async function checkSignalingServer() {
  console.log('📡 检查信令服务器状态...');

  return new Promise((resolve) => {
    const ws = new WebSocket(SIGNALING_URL);

    const timeout = setTimeout(() => {
      ws.close();
      resolve(false);
    }, SIGNALING_CHECK_TIMEOUT);

    ws.on('open', () => {
      clearTimeout(timeout);
      console.log('✅ 信令服务器正在运行');
      ws.close();
      resolve(true);
    });

    ws.on('error', () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

/**
 * 启动信令服务器
 */
async function startSignalingServer() {
  console.log('🚀 启动信令服务器...');

  return new Promise((resolve, reject) => {
    const server = spawn('node', ['signaling-server/index.js'], {
      stdio: 'pipe',
      detached: false
    });

    server.stdout.on('data', (data) => {
      const output = data.toString();
      if (output.includes('WebSocket服务器启动在端口')) {
        console.log('✅ 信令服务器启动成功');
        resolve(server);
      }
    });

    server.stderr.on('data', (data) => {
      console.error('信令服务器错误:', data.toString());
    });

    server.on('error', (error) => {
      console.error('❌ 启动信令服务器失败:', error);
      reject(error);
    });

    // 超时检查
    setTimeout(() => {
      reject(new Error('信令服务器启动超时'));
    }, 10000);
  });
}

/**
 * 运行测试
 */
async function runTests() {
  console.log('🧪 运行测试用例...');
  console.log('');

  return new Promise((resolve, reject) => {
    const test = spawn('npx', ['playwright', 'test', 'tests/e2e/p2p-communication.test.js'], {
      stdio: 'inherit'
    });

    test.on('close', (code) => {
      if (code === 0) {
        console.log('');
        console.log('✅ 所有测试通过');
        resolve();
      } else {
        console.log('');
        console.log('❌ 测试失败，退出码:', code);
        reject(new Error(`测试失败: ${code}`));
      }
    });

    test.on('error', (error) => {
      console.error('❌ 运行测试失败:', error);
      reject(error);
    });
  });
}

/**
 * 主函数
 */
async function main() {
  let signalingServer = null;
  let needsCleanup = false;

  try {
    // 1. 检查信令服务器
    const isRunning = await checkSignalingServer();

    if (!isRunning) {
      console.log('⚠️  信令服务器未运行');
      signalingServer = await startSignalingServer();
      needsCleanup = true;

      // 等待服务器完全启动
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // 2. 运行测试
    await runTests();

    console.log('');
    console.log('='.repeat(60));
    console.log('测试完成');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('');
    console.error('='.repeat(60));
    console.error('测试失败:', error.message);
    console.error('='.repeat(60));
    process.exit(1);

  } finally {
    // 清理
    if (needsCleanup && signalingServer) {
      console.log('');
      console.log('🧹 清理资源...');
      signalingServer.kill();
      console.log('✅ 信令服务器已停止');
    }
  }
}

// 运行
main().catch((error) => {
  console.error('致命错误:', error);
  process.exit(1);
});
