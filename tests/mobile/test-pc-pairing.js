/**
 * PC端配对确认测试脚本
 *
 * 模拟PC端通过IPC调用来确认移动端的配对请求
 */

const WebSocket = require('ws');

// 从配对测试脚本复制的配对码和二维码数据
const pairingCode = '576385';
const pcPeerId = '12D3KooWKf8B4ayUbkMF7begyXv8zMiCBqRfNBnsrmC72BNYqpwi';
const mobilePeerId = 'test-mobile-1767767581333';

console.log('🖥️  PC端配对确认测试');
console.log('==================\n');

const ws = new WebSocket('ws://localhost:9001');

ws.on('open', () => {
  console.log('✅ 已连接到信令服务器\n');

  // 注册为PC端（使用PC的实际PeerID）
  ws.send(JSON.stringify({
    type: 'register',
    peerId: pcPeerId + '-test', // 加后缀避免冲突
    deviceType: 'desktop',
    deviceInfo: {
      name: 'Test PC Client',
      platform: 'darwin',
      version: '0.16.0'
    }
  }));
});

ws.on('message', (data) => {
  const message = JSON.parse(data.toString());
  console.log(`📨 收到消息类型: ${message.type}`);

  if (message.type === 'registered') {
    console.log('✅ PC端测试客户端注册成功');
    console.log(`   PeerID: ${message.peerId}\n`);

    // 模拟PC端发送配对确认消息
    console.log('📤 发送配对确认消息到移动端...');
    console.log(`   目标移动端: ${mobilePeerId}`);
    console.log(`   配对码: ${pairingCode}\n`);

    ws.send(JSON.stringify({
      type: 'pairing:confirmation',
      from: pcPeerId + '-test',
      to: mobilePeerId,
      pairingCode: pairingCode,
      pcPeerId: pcPeerId,
      deviceInfo: {
        name: 'MacBook Pro (Test)',
        platform: 'darwin',
        version: '0.16.0'
      },
      timestamp: Date.now()
    }));
  }

  if (message.type === 'peer-offline') {
    console.log(`\n⚠️  目标节点离线: ${message.peerId}`);
    console.log('💡 请确保移动端测试脚本还在运行');
  }

  if (message.type === 'offer') {
    console.log('\n📨 收到移动端的WebRTC Offer');
    console.log(`   来自: ${message.from}`);
    console.log('   SDP类型:', message.offer?.type || 'unknown');

    // 模拟发送Answer
    console.log('\n📤 发送WebRTC Answer（模拟）...');
    ws.send(JSON.stringify({
      type: 'answer',
      from: pcPeerId + '-test',
      to: message.from,
      answer: {
        type: 'answer',
        sdp: 'mock-answer-sdp-data'
      }
    }));

    console.log('\n✅ 配对流程测试完成！');
    console.log('💡 在实际应用中，此时会建立WebRTC DataChannel进行P2P通信。\n');

    setTimeout(() => {
      ws.close();
    }, 2000);
  }
});

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
