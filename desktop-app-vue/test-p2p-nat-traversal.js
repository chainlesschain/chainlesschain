/**
 * P2P NAT穿透功能测试脚本
 *
 * 测试内容：
 * 1. NAT检测功能
 * 2. 多传输层初始化
 * 3. STUN服务器连通性
 * 4. libp2p节点启动
 *
 * 运行方式：
 * cd desktop-app-vue
 * node test-p2p-nat-traversal.js
 */

const path = require('path');

// 测试配置
const TEST_CONFIG = {
  port: 9100, // 使用不同的端口避免冲突
  enableMDNS: true,
  enableDHT: true,
  dataPath: path.join(__dirname, 'test-data', 'p2p-test'),
};

async function runTests() {
  console.log('\n==============================================');
  console.log('  P2P NAT穿透功能测试');
  console.log('==============================================\n');

  try {
    // 测试1: NAT检测器
    console.log('[测试 1] NAT检测器...');
    const NATDetector = require('./src/main/p2p/nat-detector');
    const natDetector = new NATDetector();

    const stunServers = [
      'stun:stun.l.google.com:19302',
      'stun:stun1.l.google.com:19302'
    ];

    console.log('  - 正在检测NAT类型...');
    const natInfo = await natDetector.detectNATType(stunServers);
    console.log(`  ✓ NAT类型: ${natInfo.type}`);
    console.log(`  ✓ 公网IP: ${natInfo.publicIP || '未知'}`);
    console.log(`  ✓ 本地IP: ${natInfo.localIP}`);
    console.log(`  ✓ 描述: ${natInfo.description}\n`);

    // 测试2: P2P Manager初始化
    console.log('[测试 2] P2P Manager初始化（多传输层）...');
    const P2PManager = require('./src/main/p2p/p2p-manager');
    const p2pManager = new P2PManager(TEST_CONFIG);

    console.log('  - 正在初始化P2P节点...');
    const initialized = await p2pManager.initialize();

    if (!initialized) {
      throw new Error('P2P初始化失败');
    }

    console.log('  ✓ P2P节点初始化成功');

    // 检查NAT信息
    if (p2pManager.natInfo) {
      console.log(`  ✓ NAT信息已加载: ${p2pManager.natInfo.type}`);
    }

    // 检查传输诊断
    if (p2pManager.transportDiagnostics) {
      console.log('  ✓ 传输诊断工具已初始化');
    }

    // 测试3: 获取节点信息
    console.log('\n[测试 3] 节点信息...');
    const nodeInfo = p2pManager.getNodeInfo();
    console.log(`  ✓ Peer ID: ${nodeInfo.peerId}`);
    if (nodeInfo.multiaddrs && nodeInfo.multiaddrs.length > 0) {
      console.log(`  ✓ 监听地址数量: ${nodeInfo.multiaddrs.length}`);
      nodeInfo.multiaddrs.forEach((addr, i) => {
        console.log(`    ${i + 1}. ${addr}`);
      });
    } else {
      console.log('  ⚠ 未获取到监听地址');
    }

    // 测试4: 传输层诊断
    console.log('\n[测试 4] 传输层诊断...');
    if (p2pManager.transportDiagnostics) {
      console.log('  - 运行完整诊断...');
      const diagnostics = await p2pManager.transportDiagnostics.runFullDiagnostics();

      console.log(`  ✓ 总传输层: ${diagnostics.summary.totalTransports}`);
      console.log(`  ✓ 可用传输层: ${diagnostics.summary.availableTransports}`);
      console.log(`  ✓ 活跃连接: ${diagnostics.summary.activeConnections}`);

      console.log('\n  传输层状态:');
      for (const [transport, info] of Object.entries(diagnostics.transports)) {
        const status = info.available ? '✓ 可用' : '✗ 不可用';
        console.log(`    ${transport.toUpperCase()}: ${status}`);
        if (info.listenAddresses) {
          info.listenAddresses.forEach(addr => {
            console.log(`      监听: ${addr}`);
          });
        }
        if (info.error) {
          console.log(`      错误: ${info.error}`);
        }
      }
    }

    // 测试5: libp2p模块验证
    console.log('\n[测试 5] libp2p模块验证...');
    const node = p2pManager.node;
    if (node) {
      console.log('  ✓ libp2p节点已创建');
      console.log(`  ✓ PeerId: ${node.peerId.toString().substring(0, 20)}...`);
      console.log(`  ✓ Multiaddrs: ${node.getMultiaddrs().length} 个`);

      // 检查services
      if (node.services) {
        console.log('  ✓ Services:');
        if (node.services.identify) console.log('    - identify (协议协商)');
        if (node.services.dcutr) console.log('    - dcutr (NAT打洞)');
        if (node.services.dht) console.log('    - dht (分布式哈希表)');
      }
    }

    // 清理
    console.log('\n[清理] 关闭P2P节点...');
    await p2pManager.close();
    console.log('  ✓ P2P节点已关闭');

    // 测试总结
    console.log('\n==============================================');
    console.log('  测试完成！');
    console.log('==============================================');
    console.log('\n✓ 所有测试通过\n');

    console.log('下一步:');
    console.log('  1. 启动应用: npm run dev');
    console.log('  2. 打开设置 -> P2P网络（待实现UI）');
    console.log('  3. 查看NAT类型和传输层状态');
    console.log('  4. 运行网络诊断工具\n');

  } catch (error) {
    console.error('\n✗ 测试失败:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// 运行测试
runTests().catch(error => {
  console.error('测试脚本异常:', error);
  process.exit(1);
});
