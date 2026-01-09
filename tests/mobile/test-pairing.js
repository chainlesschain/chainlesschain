/**
 * 设备配对测试脚本
 *
 * 模拟移动端发起配对流程
 */

const WebSocket = require('ws');

const mobilePeerId = 'test-mobile-' + Date.now();
const pairingCode = Math.floor(100000 + Math.random() * 900000).toString();

console.log('🔗 移动端配对测试');
console.log('==================\n');

const ws = new WebSocket('ws://localhost:9001');

let isRegistered = false;

ws.on('open', () => {
  console.log('✅ 已连接到信令服务器\n');

  // 注册移动端
  ws.send(JSON.stringify({
    type: 'register',
    peerId: mobilePeerId,
    deviceType: 'mobile',
    deviceInfo: {
      name: 'iPhone 13 Pro',
      platform: 'ios',
      version: '0.16.0'
    }
  }));
});

ws.on('message', (data) => {
  const message = JSON.parse(data.toString());

  if (message.type === 'registered' && !isRegistered) {
    isRegistered = true;
    console.log('✅ 移动端注册成功');
    console.log(`   PeerID: ${mobilePeerId}\n`);

    // 生成配对二维码数据
    const qrData = {
      type: 'device-pairing',
      code: pairingCode,
      did: 'did:example:' + mobilePeerId,
      deviceInfo: {
        deviceId: 'device-' + Date.now(),
        name: 'iPhone 13 Pro',
        platform: 'ios',
        version: '0.16.0'
      },
      timestamp: Date.now()
    };

    console.log('📱 配对信息');
    console.log('==================');
    console.log(`配对码: ${pairingCode}`);
    console.log(`移动端ID: ${mobilePeerId}`);
    console.log('\n📋 二维码数据（复制此JSON给PC端）:');
    console.log('------------------');
    console.log(JSON.stringify(qrData, null, 2));
    console.log('------------------\n');

    console.log('⏳ 等待PC端扫描并确认...');
    console.log('💡 在PC端控制台执行:');
    console.log(`   const qrData = ${JSON.stringify(JSON.stringify(qrData))};`);
    console.log(`   await window.electron.invoke('mobile:pair-with-code', '${pairingCode}');\n`);
  }

  if (message.type === 'pairing:confirmation') {
    console.log('\n🎉 收到PC端配对确认！');
    console.log('==================');
    console.log(`PC PeerID: ${message.pcPeerId}`);
    console.log(`PC设备名: ${message.deviceInfo?.name || 'Unknown'}`);
    console.log(`PC平台: ${message.deviceInfo?.platform || 'Unknown'}`);
    console.log(`PC版本: ${message.deviceInfo?.version || 'Unknown'}\n`);

    console.log('✅ 配对成功！现在可以开始建立WebRTC连接...');

    // 模拟发送Offer（实际应该由WebRTC API生成）
    console.log('\n📡 发送WebRTC Offer（模拟）...');
    ws.send(JSON.stringify({
      type: 'offer',
      from: mobilePeerId,
      to: message.pcPeerId,
      offer: {
        type: 'offer',
        sdp: 'mock-sdp-data'
      }
    }));
  }

  if (message.type === 'answer') {
    console.log('\n✅ 收到PC端WebRTC Answer');
    console.log('🔗 WebRTC连接正在建立...');
    console.log('\n💡 在实际应用中，此时应该:');
    console.log('   1. 处理Answer并设置远程描述');
    console.log('   2. 交换ICE候选');
    console.log('   3. 建立DataChannel');
    console.log('   4. 开始P2P数据传输\n');

    console.log('✅ 配对测试完成！');
    setTimeout(() => {
      ws.close();
    }, 2000);
  }

  if (message.type === 'peer-offline') {
    console.log(`\n⚠️  目标节点离线: ${message.peerId}`);
    console.log('💡 请确保PC端应用正在运行');
  }
});

ws.on('error', (error) => {
  console.error('\n❌ 错误:', error.message);
  process.exit(1);
});

ws.on('close', () => {
  console.log('\n👋 连接已关闭');
  if (!isRegistered) {
    console.log('⚠️  未能完成配对流程');
  }
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\n\n📴 中断测试...');
  ws.close();
});
