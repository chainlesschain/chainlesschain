/**
 * 移动端数据同步测试脚本
 *
 * 测试知识库、项目文件、PC状态同步功能
 */

const WebSocket = require('ws');

const mobilePeerId = 'test-mobile-sync-' + Date.now();
const pcPeerId = '12D3KooWMhASR2ZSgRt3EJeDtqhidnNWYQerjoHTVb7YsiSYXCdQ';

console.log('📱 移动端数据同步测试');
console.log('==================\n');

const ws = new WebSocket('ws://localhost:9001');

let requestId = 1;
const pendingRequests = new Map();

// 创建请求ID
function createRequestId() {
  return `req_${Date.now()}_${requestId++}`;
}

// 发送业务消息
function sendBusinessMessage(type, params = {}) {
  const reqId = createRequestId();

  const message = {
    type: 'message',  // 信令服务器的业务消息类型
    from: mobilePeerId,
    to: pcPeerId,
    payload: {
      type: type,
      requestId: reqId,
      params: params,
      timestamp: Date.now()
    }
  };

  console.log(`\n📤 发送请求: ${type}`);
  console.log(`   RequestID: ${reqId}`);
  console.log(`   参数:`, JSON.stringify(params, null, 2));

  ws.send(JSON.stringify(message));

  pendingRequests.set(reqId, {
    type: type,
    sentAt: Date.now()
  });

  return reqId;
}

ws.on('open', () => {
  console.log('✅ 已连接到信令服务器\n');

  // 注册移动端
  ws.send(JSON.stringify({
    type: 'register',
    peerId: mobilePeerId,
    deviceType: 'mobile',
    deviceInfo: {
      name: 'Test Mobile Device',
      platform: 'ios',
      version: '0.16.0'
    }
  }));
});

ws.on('message', (data) => {
  const message = JSON.parse(data.toString());

  if (message.type === 'registered') {
    console.log('✅ 移动端注册成功');
    console.log(`   PeerID: ${message.peerId}\n`);
    console.log('开始测试数据同步功能...\n');
    console.log('='.repeat(50));

    // 等待1秒后开始测试
    setTimeout(() => runTests(), 1000);
  }

  if (message.type === 'message' && message.payload) {
    const payload = message.payload;
    const requestInfo = pendingRequests.get(payload.requestId);

    if (requestInfo) {
      const latency = Date.now() - requestInfo.sentAt;

      console.log(`\n📨 收到响应: ${requestInfo.type}`);
      console.log(`   RequestID: ${payload.requestId}`);
      console.log(`   延迟: ${latency}ms`);

      if (payload.error) {
        console.log(`   ❌ 错误:`, JSON.stringify(payload.error, null, 2));
      } else {
        console.log(`   ✅ 成功`);
        console.log(`   数据:`, JSON.stringify(payload.data, null, 2));
      }

      pendingRequests.delete(payload.requestId);
    }
  }

  if (message.type === 'peer-offline') {
    console.log(`\n⚠️  目标节点离线: ${message.peerId}`);
    console.log('💡 请确保PC端应用正在运行');
  }

  if (message.type === 'error') {
    console.log(`\n❌ 服务器错误: ${message.message}`);
  }
});

// 运行测试
async function runTests() {
  console.log('\n🧪 测试1: 获取笔记列表');
  console.log('-'.repeat(50));
  sendBusinessMessage('knowledge:list-notes', {
    limit: 5,
    offset: 0,
    sortBy: 'updated_at',
    sortOrder: 'DESC'
  });

  await sleep(2000);

  console.log('\n🧪 测试2: 搜索笔记');
  console.log('-'.repeat(50));
  sendBusinessMessage('knowledge:search', {
    query: 'test',
    limit: 5
  });

  await sleep(2000);

  console.log('\n🧪 测试3: 获取文件夹列表');
  console.log('-'.repeat(50));
  sendBusinessMessage('knowledge:get-folders');

  await sleep(2000);

  console.log('\n🧪 测试4: 获取标签列表');
  console.log('-'.repeat(50));
  sendBusinessMessage('knowledge:get-tags');

  await sleep(2000);

  console.log('\n🧪 测试5: 获取项目列表');
  console.log('-'.repeat(50));
  sendBusinessMessage('project:list-projects', {
    limit: 5
  });

  await sleep(2000);

  console.log('\n🧪 测试6: 获取PC系统信息');
  console.log('-'.repeat(50));
  sendBusinessMessage('pc-status:get-system-info');

  await sleep(2000);

  console.log('\n🧪 测试7: 获取PC服务状态');
  console.log('-'.repeat(50));
  sendBusinessMessage('pc-status:get-services-status');

  await sleep(2000);

  console.log('\n🧪 测试8: 获取PC实时状态');
  console.log('-'.repeat(50));
  sendBusinessMessage('pc-status:get-realtime');

  await sleep(3000);

  console.log('\n' + '='.repeat(50));
  console.log('✅ 所有测试已发送');
  console.log(`⏳ 等待中的请求: ${pendingRequests.size} 个`);

  // 等待所有响应
  setTimeout(() => {
    if (pendingRequests.size > 0) {
      console.log(`\n⚠️  仍有 ${pendingRequests.size} 个请求未收到响应:`);
      for (const [reqId, info] of pendingRequests) {
        console.log(`   - ${info.type} (${reqId})`);
      }
    } else {
      console.log('\n🎉 所有测试完成！');
    }

    console.log('\n💡 保持连接运行以接收后续响应...');
    console.log('   按 Ctrl+C 退出\n');
  }, 5000);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

ws.on('error', (error) => {
  console.error('\n❌ WebSocket错误:', error.message);
  process.exit(1);
});

ws.on('close', () => {
  console.log('\n👋 连接已关闭');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\n\n📴 中断测试...');
  ws.close();
});
