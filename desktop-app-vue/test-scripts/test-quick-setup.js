#!/usr/bin/env node

/**
 * 测试一键配置功能
 *
 * 模拟桌面应用中的一键配置STUN/TURN服务器功能
 */

console.log('='.repeat(60));
console.log('ChainlessChain 一键配置功能测试');
console.log('='.repeat(60));
console.log('');

// 模拟配置对象
const config = {
  p2p: {
    stun: {
      servers: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302'
      ]
    },
    turn: {
      enabled: false,
      servers: []
    }
  }
};

console.log('初始配置:');
console.log('----------------------------------------');
console.log('STUN服务器:');
config.p2p.stun.servers.forEach((server, index) => {
  console.log(`  ${index + 1}. ${server}`);
});
console.log(`TURN启用: ${config.p2p.turn.enabled}`);
console.log(`TURN服务器数量: ${config.p2p.turn.servers.length}`);
console.log('');

// 模拟一键配置函数
function handleQuickSetupLocalCoturn() {
  console.log('[执行] 一键配置本地coturn服务器...');
  console.log('');

  // 添加本地STUN服务器（如果不存在）
  const localStunServer = 'stun:localhost:3478';
  console.log(`[检查] STUN服务器: ${localStunServer}`);

  if (!config.p2p.stun.servers.includes(localStunServer)) {
    config.p2p.stun.servers.unshift(localStunServer);
    console.log('  ✓ 已添加到列表首位');
  } else {
    console.log('  ⚠ 已存在，跳过');
  }
  console.log('');

  // 启用TURN
  console.log('[配置] 启用TURN服务');
  config.p2p.turn.enabled = true;
  console.log('  ✓ TURN已启用');
  console.log('');

  // 添加本地TURN服务器（如果不存在）
  const localTurnServer = {
    urls: 'turn:localhost:3478',
    username: 'chainlesschain',
    credential: 'chainlesschain2024'
  };

  console.log(`[检查] TURN服务器: ${localTurnServer.urls}`);

  const exists = config.p2p.turn.servers.some(
    server => server.urls === localTurnServer.urls
  );

  if (!exists) {
    config.p2p.turn.servers.unshift(localTurnServer);
    console.log('  ✓ 已添加到列表首位');
  } else {
    console.log('  ⚠ 已存在，跳过');
  }
  console.log('');

  console.log('[成功] 本地coturn服务器配置已完成！');
  console.log('');
}

// 执行一键配置
handleQuickSetupLocalCoturn();

// 显示配置后的结果
console.log('配置后结果:');
console.log('----------------------------------------');
console.log('STUN服务器:');
config.p2p.stun.servers.forEach((server, index) => {
  const isLocal = server.includes('localhost');
  const marker = isLocal ? '🆕' : '  ';
  console.log(`  ${marker} ${index + 1}. ${server}`);
});
console.log('');

console.log(`TURN启用: ${config.p2p.turn.enabled ? '✓ 是' : '✗ 否'}`);
console.log(`TURN服务器数量: ${config.p2p.turn.servers.length}`);
console.log('');

if (config.p2p.turn.servers.length > 0) {
  console.log('TURN服务器列表:');
  config.p2p.turn.servers.forEach((server, index) => {
    const isLocal = server.urls.includes('localhost');
    const marker = isLocal ? '🆕' : '  ';
    console.log(`  ${marker} ${index + 1}. ${server.urls}`);
    console.log(`      用户名: ${server.username}`);
    console.log(`      密码: ${'*'.repeat(server.credential.length)}`);
  });
}
console.log('');

// 验证配置
console.log('配置验证:');
console.log('----------------------------------------');

const checks = [
  {
    name: 'STUN服务器包含localhost',
    pass: config.p2p.stun.servers.some(s => s.includes('localhost'))
  },
  {
    name: 'TURN服务已启用',
    pass: config.p2p.turn.enabled === true
  },
  {
    name: 'TURN服务器包含localhost',
    pass: config.p2p.turn.servers.some(s => s.urls.includes('localhost'))
  },
  {
    name: 'TURN服务器有认证信息',
    pass: config.p2p.turn.servers.some(s => s.username && s.credential)
  }
];

let allPassed = true;
checks.forEach(check => {
  const status = check.pass ? '✓' : '✗';
  const color = check.pass ? '\x1b[32m' : '\x1b[31m';
  const reset = '\x1b[0m';
  console.log(`  ${color}${status}${reset} ${check.name}`);
  if (!check.pass) allPassed = false;
});
console.log('');

// 测试结果
console.log('='.repeat(60));
if (allPassed) {
  console.log('\x1b[32m✓ 所有检查通过！一键配置功能正常工作。\x1b[0m');
} else {
  console.log('\x1b[31m✗ 部分检查失败，请检查配置逻辑。\x1b[0m');
}
console.log('='.repeat(60));
console.log('');

// 显示下一步操作
console.log('下一步操作:');
console.log('1. 确保Docker容器正在运行:');
console.log('   docker ps | grep coturn');
console.log('');
console.log('2. 在桌面应用中测试:');
console.log('   - 启动应用: npm run dev');
console.log('   - 打开: 设置 -> P2P网络');
console.log('   - 点击: "一键配置" 按钮');
console.log('   - 保存设置');
console.log('');
console.log('3. 验证P2P连接:');
console.log('   - 查看NAT穿透状态');
console.log('   - 运行网络诊断');
console.log('   - 测试P2P消息传输');
console.log('');

// 退出
process.exit(allPassed ? 0 : 1);
