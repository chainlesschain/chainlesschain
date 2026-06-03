/**
 * 创建好友功能测试数据脚本
 *
 * 使用方法：
 * 1. 在 H5 开发环境中打开应用 (npm run dev:h5)
 * 2. 按 F12 打开浏览器控制台
 * 3. 复制粘贴此脚本到控制台并回车执行
 *
 * 注意：需要先创建 DID 身份才能使用此脚本
 */

(async function createFriendTestData() {
  console.log('🚀 开始创建好友功能测试数据...');

  try {
    // 动态导入模块
    const { default: didService } = await import('../services/did.js');
    const { default: database } = await import('../services/database.js');

    // 1. 检查当前用户身份
    console.log('📋 检查当前用户身份...');
    const identity = await didService.getCurrentIdentity();

    if (!identity) {
      console.error('❌ 错误: 未找到 DID 身份');
      console.log('💡 请先前往「身份管理」页面创建 DID 身份');
      return;
    }

    const myDid = identity.did;
    console.log('✅ 当前用户 DID:', myDid);

    // 2. 定义测试好友数据
    const testFriends = [
      {
        did: 'did:chainlesschain:alice2024test',
        nickname: 'Alice',
        message: '你好！我是 Alice，在一个技术分享会上认识的你，想添加你为好友 :)'
      },
      {
        did: 'did:chainlesschain:bob2024test',
        nickname: 'Bob',
        message: '嗨，我是 Bob，看到你在 GitHub 上的项目很棒，想和你交流一下'
      },
      {
        did: 'did:chainlesschain:charlie2024test',
        nickname: 'Charlie',
        message: '大家好，我是 Charlie，我们是同事吧？想加个好友方便联系'
      }
    ];

    // 3. 创建好友请求（收到的）
    console.log('\n📨 创建测试好友请求...');

    for (const friend of testFriends) {
      const request = {
        id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        fromDid: friend.did,
        toDid: myDid,
        message: friend.message,
        status: 'pending',
        direction: 'received',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        signature: `test_signature_${friend.nickname.toLowerCase()}_${Date.now()}`
      };

      await database.saveFriendRequest(request);
      console.log(`  ✅ 已创建来自 ${friend.nickname} (${friend.did}) 的好友请求`);

      // 避免 ID 冲突
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    // 4. 显示统计信息
    console.log('\n📊 测试数据统计:');
    console.log(`  - 待处理好友请求: ${testFriends.length} 条`);
    console.log(`  - 当前用户: ${myDid}`);

    // 5. 提示下一步
    console.log('\n✨ 测试数据创建完成！');
    console.log('\n📝 下一步操作:');
    console.log('  1. 刷新好友列表页面');
    console.log('  2. 切换到「待验证」标签查看请求');
    console.log('  3. 点击请求卡片可以接受或拒绝');
    console.log('\n🧪 测试场景建议:');
    console.log('  - 接受 Alice 的请求，测试接受功能');
    console.log('  - 拒绝 Bob 的请求，测试拒绝功能');
    console.log('  - 保留 Charlie 的请求，测试待处理列表');

  } catch (error) {
    console.error('❌ 创建测试数据失败:', error);
    console.error('错误详情:', error.message);
    console.error('堆栈信息:', error.stack);
  }
})();
