/**
 * 模拟移动端客户端测试脚本
 *
 * 用途：验证移动端能否成功连接到信令服务器
 */

const WebSocket = require('ws');

console.log('🚀 启动移动端模拟测试...\n');

const ws = new WebSocket('ws://localhost:9001');

ws.on('open', () => {
  console.log('✅ 成功连接到信令服务器');
  console.log('📡 发送注册消息...\n');

  // 注册为移动设备
  ws.send(JSON.stringify({
    type: 'register',
    peerId: 'test-mobile-001',
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
  console.log(`📨 收到消息类型: ${message.type}`);

  if (message.type === 'registered') {
    console.log('✅ 注册成功!');
    console.log(`   - PeerID: ${message.peerId}`);
    console.log(`   - 服务器时间: ${new Date(message.serverTime).toLocaleString()}\n`);

    // 请求在线节点列表
    setTimeout(() => {
      console.log('🔍 请求在线节点列表...');
      ws.send(JSON.stringify({
        type: 'get-peers'
      }));
    }, 1000);
  }

  if (message.type === 'peers-list') {
    console.log(`📋 在线节点数量: ${message.count}`);
    if (message.peers && message.peers.length > 0) {
      console.log('   在线节点:');
      message.peers.forEach(peer => {
        console.log(`   - ${peer.peerId} (${peer.deviceType}): ${peer.deviceInfo?.name || 'Unknown'}`);
      });
    } else {
      console.log('   当前没有其他节点在线');
    }
    console.log('\n✅ 测试完成！连接正常。');
    console.log('💡 提示：保持此连接运行，然后启动PC端查看双向通讯。');
  }

  if (message.type === 'peer-status') {
    if (message.status === 'online') {
      console.log(`\n🟢 新节点上线: ${message.peerId} (${message.deviceType})`);
      console.log(`   设备: ${message.deviceInfo?.name || 'Unknown'}`);
    } else {
      console.log(`\n🔴 节点离线: ${message.peerId}`);
    }
  }
});

ws.on('error', (error) => {
  console.error('❌ WebSocket错误:', error.message);
  process.exit(1);
});

ws.on('close', () => {
  console.log('\n👋 连接已关闭');
  process.exit(0);
});

// 优雅退出
process.on('SIGINT', () => {
  console.log('\n\n📴 正在关闭连接...');
  ws.close();
});
