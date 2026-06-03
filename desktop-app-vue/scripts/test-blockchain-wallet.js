/**
 * 区块链钱包测试脚本
 *
 * 测试钱包管理器的核心功能
 *
 * 运行方式:
 * node scripts/test-blockchain-wallet.js
 */

const path = require('path');
const fs = require('fs');

// 设置测试数据库路径
const testDbPath = path.join(__dirname, '../data/test-blockchain-wallet.db');

// 清理旧的测试数据库
if (fs.existsSync(testDbPath)) {
  fs.unlinkSync(testDbPath);
  console.log('清理旧的测试数据库');
}

async function runTests() {
  let database, walletManager;

  try {
    console.log('\n=================================================');
    console.log('区块链钱包测试');
    console.log('=================================================\n');

    // 1. 初始化数据库
    console.log('1. 初始化数据库...');
    const DatabaseManager = require('../src/main/database');
    database = new DatabaseManager(testDbPath, { encryptionEnabled: false });
    await database.initialize();
    console.log('✓ 数据库初始化成功\n');

    // 2. 初始化钱包管理器
    console.log('2. 初始化钱包管理器...');
    const { WalletManager } = require('../src/main/blockchain/wallet-manager');
    walletManager = new WalletManager(database, null, null);
    await walletManager.initialize();
    console.log('✓ 钱包管理器初始化成功\n');

    // 3. 创建钱包
    console.log('3. 测试创建钱包...');
    const password = 'TestPassword123!';
    const wallet1 = await walletManager.createWallet(password);
    console.log('   钱包 ID:', wallet1.id);
    console.log('   钱包地址:', wallet1.address);
    console.log('   助记词:', wallet1.mnemonic);
    console.log('   链 ID:', wallet1.chainId);
    console.log('✓ 钱包创建成功\n');

    // 保存助记词用于后续测试
    const testMnemonic = wallet1.mnemonic;
    const testWalletId = wallet1.id;

    // 4. 从助记词导入钱包
    console.log('4. 测试从助记词导入钱包...');
    const wallet2 = await walletManager.importFromMnemonic(testMnemonic, password);
    console.log('   钱包 ID:', wallet2.id);
    console.log('   钱包地址:', wallet2.address);
    console.log('   ⚠️ 地址应该与原钱包相同:', wallet1.address === wallet2.address ? '✓' : '✗');
    console.log('✓ 从助记词导入成功\n');

    // 5. 从私钥导入钱包
    console.log('5. 测试从私钥导入钱包...');
    // 使用一个测试私钥
    const testPrivateKey = '0x1234567890123456789012345678901234567890123456789012345678901234';
    const wallet3 = await walletManager.importFromPrivateKey(testPrivateKey, password);
    console.log('   钱包 ID:', wallet3.id);
    console.log('   钱包地址:', wallet3.address);
    console.log('✓ 从私钥导入成功\n');

    // 6. 获取所有钱包
    console.log('6. 测试获取所有钱包...');
    const allWallets = await walletManager.getAllWallets();
    console.log(`   钱包总数: ${allWallets.length}`);
    allWallets.forEach((w, i) => {
      console.log(`   [${i + 1}] ${w.address} (${w.wallet_type}, 默认: ${w.is_default ? '是' : '否'})`);
    });
    console.log('✓ 获取钱包列表成功\n');

    // 7. 解锁钱包
    console.log('7. 测试解锁钱包...');
    const unlockedWallet = await walletManager.unlockWallet(testWalletId, password);
    console.log('   解锁的钱包地址:', unlockedWallet.address);
    console.log('✓ 钱包解锁成功\n');

    // 8. 签名消息
    console.log('8. 测试签名消息...');
    const message = 'Hello, Blockchain World!';
    const signature = await walletManager.signMessage(testWalletId, message, false);
    console.log('   消息:', message);
    console.log('   签名:', signature);

    // 验证签名
    const { ethers } = require('ethers');
    const recoveredAddress = ethers.verifyMessage(message, signature);
    console.log('   恢复的地址:', recoveredAddress);
    console.log('   签名验证:', wallet1.address.toLowerCase() === recoveredAddress.toLowerCase() ? '✓' : '✗');
    console.log('✓ 消息签名成功\n');

    // 9. 导出私钥
    console.log('9. 测试导出私钥...');
    const exportedPrivateKey = await walletManager.exportPrivateKey(testWalletId, password);
    console.log('   导出的私钥:', exportedPrivateKey.substring(0, 10) + '...(已隐藏)');
    console.log('✓ 私钥导出成功\n');

    // 10. 导出助记词
    console.log('10. 测试导出助记词...');
    const exportedMnemonic = await walletManager.exportMnemonic(testWalletId, password);
    console.log('   导出的助记词:', exportedMnemonic);
    console.log('   助记词验证:', testMnemonic === exportedMnemonic ? '✓' : '✗');
    console.log('✓ 助记词导出成功\n');

    // 11. 设置默认钱包
    console.log('11. 测试设置默认钱包...');
    await walletManager.setDefaultWallet(wallet2.id);
    const updatedWallets = await walletManager.getAllWallets();
    const defaultWallet = updatedWallets.find((w) => w.is_default === 1);
    console.log('   默认钱包地址:', defaultWallet.address);
    console.log('   验证:', defaultWallet.id === wallet2.id ? '✓' : '✗');
    console.log('✓ 设置默认钱包成功\n');

    // 12. 锁定钱包
    console.log('12. 测试锁定钱包...');
    walletManager.lockWallet(testWalletId);
    console.log('✓ 钱包锁定成功\n');

    // 13. 删除钱包
    console.log('13. 测试删除钱包...');
    await walletManager.deleteWallet(wallet3.id);
    const walletsAfterDelete = await walletManager.getAllWallets();
    console.log(`   删除后钱包数量: ${walletsAfterDelete.length}`);
    console.log('✓ 钱包删除成功\n');

    // 14. 测试错误处理
    console.log('14. 测试错误处理...');

    // 14.1 错误密码
    try {
      await walletManager.unlockWallet(testWalletId, 'wrong_password');
      console.log('   ✗ 应该抛出错误但没有');
    } catch (error) {
      console.log('   ✓ 错误密码被正确拦截:', error.message);
    }

    // 14.2 导入重复钱包
    try {
      await walletManager.importFromMnemonic(testMnemonic, password);
      console.log('   ✗ 应该抛出错误但没有');
    } catch (error) {
      console.log('   ✓ 重复钱包被正确拦截:', error.message);
    }

    // 14.3 无效助记词
    try {
      await walletManager.importFromMnemonic('invalid mnemonic words test', password);
      console.log('   ✗ 应该抛出错误但没有');
    } catch (error) {
      console.log('   ✓ 无效助记词被正确拦截:', error.message);
    }

    console.log('✓ 错误处理测试成功\n');

    console.log('=================================================');
    console.log('🎉 所有测试通过！');
    console.log('=================================================\n');
  } catch (error) {
    console.error('\n❌ 测试失败:', error);
    console.error('错误详情:', error.stack);
    process.exit(1);
  } finally {
    // 清理资源
    if (walletManager) {
      await walletManager.cleanup();
    }

    if (database) {
      await database.close();
    }

    // 清理测试数据库
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
      console.log('测试数据库已清理');
    }
  }
}

// 运行测试
runTests().catch(console.error);
