/**
 * U盾驱动测试脚本
 *
 * 测试所有U盾驱动的功能：
 * - XinJinKe（芯劲科）
 * - FeiTian（飞天诚信）
 * - WatchData（握奇）
 * - Simulated（模拟驱动）
 */

const { UKeyManager, DriverTypes } = require('./src/main/ukey/ukey-manager');

// 延迟函数
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 测试单个驱动
 */
async function testDriver(driverType, testPin = '123456') {
  console.log('\n' + '='.repeat(60));
  console.log(`测试驱动: ${driverType}`);
  console.log('='.repeat(60));

  const manager = new UKeyManager({
    driverType: driverType,
  });

  try {
    // 1. 初始化
    console.log('\n[1] 初始化驱动...');
    await manager.initialize();
    console.log('✓ 驱动初始化成功');

    // 2. 检测设备
    console.log('\n[2] 检测设备...');
    const detectResult = await manager.detect();
    console.log('检测结果:', JSON.stringify(detectResult, null, 2));

    if (!detectResult.detected) {
      console.log('⚠ 未检测到设备，跳过后续测试');
      return;
    }

    // 3. 获取设备信息
    console.log('\n[3] 获取设备信息...');
    const deviceInfo = await manager.getDeviceInfo();
    console.log('设备信息:', JSON.stringify(deviceInfo, null, 2));

    // 4. 验证PIN码
    console.log('\n[4] 验证PIN码...');
    console.log(`使用PIN: ${testPin}`);
    const verifyResult = await manager.verifyPIN(testPin);
    console.log('验证结果:', JSON.stringify(verifyResult, null, 2));

    if (!verifyResult.success) {
      console.log('⚠ PIN验证失败，跳过后续测试');
      return;
    }

    console.log('✓ PIN验证成功');

    // 5. 获取公钥
    console.log('\n[5] 获取公钥...');
    const publicKey = await manager.getPublicKey();
    console.log('公钥:', publicKey.substring(0, 100) + '...');

    // 6. 测试签名
    console.log('\n[6] 测试数字签名...');
    const testData = 'Hello, ChainlessChain!';
    console.log('待签名数据:', testData);

    const signature = await manager.sign(testData);
    console.log('签名结果:', signature.substring(0, 64) + '...');

    const verifySignature = await manager.verifySignature(testData, signature);
    console.log('签名验证:', verifySignature ? '✓ 通过' : '✗ 失败');

    // 7. 测试加密解密
    console.log('\n[7] 测试加密解密...');
    const plaintext = 'This is a secret message!';
    console.log('明文:', plaintext);

    const encrypted = await manager.encrypt(plaintext);
    console.log('密文:', encrypted.substring(0, 64) + '...');

    const decrypted = await manager.decrypt(encrypted);
    console.log('解密结果:', decrypted);
    console.log('加密解密测试:', decrypted === plaintext ? '✓ 通过' : '✗ 失败');

    // 8. 锁定设备
    console.log('\n[8] 锁定设备...');
    manager.lock();
    console.log('设备已锁定');
    console.log('是否已解锁:', manager.isUnlocked() ? '是' : '否');

    // 9. 关闭管理器
    console.log('\n[9] 关闭管理器...');
    await manager.close();
    console.log('✓ 管理器已关闭');

    console.log('\n✓ 所有测试完成！');
  } catch (error) {
    console.error('\n✗ 测试失败:', error.message);
    console.error(error.stack);
  }
}

/**
 * 测试驱动切换
 */
async function testDriverSwitching() {
  console.log('\n' + '='.repeat(60));
  console.log('测试驱动切换功能');
  console.log('='.repeat(60));

  const manager = new UKeyManager({
    driverType: DriverTypes.SIMULATED,
  });

  try {
    // 初始化为模拟驱动
    console.log('\n[1] 初始化为模拟驱动...');
    await manager.initialize();
    console.log('当前驱动:', manager.getDriverType());

    // 切换到XinJinKe驱动
    console.log('\n[2] 切换到XinJinKe驱动...');
    await manager.switchDriver(DriverTypes.XINJINKE);
    console.log('当前驱动:', manager.getDriverType());

    // 切换到FeiTian驱动
    console.log('\n[3] 切换到FeiTian驱动...');
    await manager.switchDriver(DriverTypes.FEITIAN);
    console.log('当前驱动:', manager.getDriverType());

    // 切换到WatchData驱动
    console.log('\n[4] 切换到WatchData驱动...');
    await manager.switchDriver(DriverTypes.WATCHDATA);
    console.log('当前驱动:', manager.getDriverType());

    // 切换回模拟驱动
    console.log('\n[5] 切换回模拟驱动...');
    await manager.switchDriver(DriverTypes.SIMULATED);
    console.log('当前驱动:', manager.getDriverType());

    console.log('\n✓ 驱动切换测试完成！');

    await manager.close();
  } catch (error) {
    console.error('\n✗ 驱动切换测试失败:', error.message);
    console.error(error.stack);
  }
}

/**
 * 测试自动检测
 */
async function testAutoDetect() {
  console.log('\n' + '='.repeat(60));
  console.log('测试自动检测功能');
  console.log('='.repeat(60));

  const manager = new UKeyManager();

  try {
    console.log('\n正在自动检测U盾类型...');
    const result = await manager.autoDetect();

    console.log('\n检测结果:', JSON.stringify(result, null, 2));

    if (result.detected) {
      console.log(`✓ 检测到设备，驱动类型: ${result.driverType}`);
    } else {
      console.log('⚠ 未检测到任何设备');
    }

    await manager.close();
  } catch (error) {
    console.error('\n✗ 自动检测失败:', error.message);
    console.error(error.stack);
  }
}

/**
 * 主测试函数
 */
async function main() {
  console.log('\n╔═══════════════════════════════════════════════════════════════╗');
  console.log('║              ChainlessChain U盾驱动测试工具                  ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');

  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('\n用法:');
    console.log('  node test-ukey-drivers.js <driver-type> [pin]');
    console.log('  node test-ukey-drivers.js all');
    console.log('  node test-ukey-drivers.js switch');
    console.log('  node test-ukey-drivers.js auto');
    console.log('\n驱动类型:');
    console.log('  xinjinke   - 芯劲科U盾');
    console.log('  feitian    - 飞天诚信U盾');
    console.log('  watchdata  - 握奇U盾');
    console.log('  simulated  - 模拟U盾');
    console.log('  all        - 测试所有驱动');
    console.log('  switch     - 测试驱动切换');
    console.log('  auto       - 自动检测设备');
    console.log('\n示例:');
    console.log('  node test-ukey-drivers.js simulated 123456');
    console.log('  node test-ukey-drivers.js all');
    console.log('  node test-ukey-drivers.js auto');
    return;
  }

  const command = args[0];
  const pin = args[1] || '123456';

  try {
    switch (command) {
      case 'all':
        // 测试所有驱动
        await testDriver(DriverTypes.SIMULATED, pin);
        await sleep(1000);
        await testDriver(DriverTypes.XINJINKE, pin);
        await sleep(1000);
        await testDriver(DriverTypes.FEITIAN, pin);
        await sleep(1000);
        await testDriver(DriverTypes.WATCHDATA, pin);
        break;

      case 'switch':
        // 测试驱动切换
        await testDriverSwitching();
        break;

      case 'auto':
        // 测试自动检测
        await testAutoDetect();
        break;

      case 'xinjinke':
      case 'feitian':
      case 'watchdata':
      case 'simulated':
        // 测试单个驱动
        await testDriver(command, pin);
        break;

      default:
        console.error(`\n✗ 未知的命令: ${command}`);
        console.log('使用 "node test-ukey-drivers.js" 查看帮助信息');
    }
  } catch (error) {
    console.error('\n✗ 测试过程中发生错误:', error.message);
    console.error(error.stack);
    process.exit(1);
  }

  console.log('\n测试结束\n');
}

// 运行测试
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = {
  testDriver,
  testDriverSwitching,
  testAutoDetect,
};
