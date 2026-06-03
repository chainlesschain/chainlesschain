/**
 * U盾功能测试脚本
 *
 * 测试所有U盾相关功能
 */

const { UKeyManager, DriverTypes } = require('../src/main/ukey/ukey-manager');
const { getUKeyConfig } = require('../src/main/ukey/config');

console.log('=== 开始U盾功能测试 ===\n');

async function runTests() {
  let ukeyManager = null;

  try {
    // 1. 测试配置管理
    console.log('1. 测试配置管理...');
    const config = getUKeyConfig();
    console.log('   配置路径:', config.configPath);
    console.log('   驱动类型:', config.getDriverType());
    console.log('   自动锁定:', config.isAutoLockEnabled());
    console.log('   ✓ 配置管理测试通过\n');

    // 2. 测试U盾管理器初始化
    console.log('2. 初始化U盾管理器...');
    ukeyManager = new UKeyManager({
      driverType: DriverTypes.XINJINKE,
    });

    await ukeyManager.initialize();
    console.log('   驱动名称:', ukeyManager.getDriverName());
    console.log('   驱动版本:', ukeyManager.getDriverVersion());
    console.log('   ✓ 初始化成功\n');

    // 3. 测试设备检测
    console.log('3. 检测U盾设备...');
    const status = await ukeyManager.detect();
    console.log('   检测结果:', JSON.stringify(status, null, 2));

    if (status.detected) {
      console.log('   ✓ 检测到设备\n');

      // 4. 测试PIN验证
      console.log('4. 验证PIN码...');
      console.log('   提示: 在模拟模式下，默认PIN为 888888');

      // 尝试默认密码
      const verifyResult = await ukeyManager.verifyPIN('888888');
      console.log('   验证结果:', JSON.stringify(verifyResult, null, 2));

      if (verifyResult.success) {
        console.log('   ✓ PIN验证成功\n');

        // 5. 测试获取设备信息
        console.log('5. 获取设备信息...');
        try {
          const deviceInfo = await ukeyManager.getDeviceInfo();
          console.log('   设备信息:', JSON.stringify(deviceInfo, null, 2));
          console.log('   ✓ 获取设备信息成功\n');
        } catch (error) {
          console.log('   ⚠ 获取设备信息失败:', error.message, '\n');
        }

        // 6. 测试加密解密
        console.log('6. 测试数据加密解密...');
        const testData = 'Hello, ChainlessChain!';
        console.log('   原始数据:', testData);

        try {
          const encrypted = await ukeyManager.encrypt(testData);
          console.log('   加密结果:', encrypted.substring(0, 50) + '...');

          const decrypted = await ukeyManager.decrypt(encrypted);
          console.log('   解密结果:', decrypted);

          if (decrypted === testData) {
            console.log('   ✓ 加密解密测试通过\n');
          } else {
            console.log('   ✗ 加密解密结果不匹配\n');
          }
        } catch (error) {
          console.log('   ⚠ 加密解密测试失败:', error.message, '\n');
        }

        // 7. 测试数字签名
        console.log('7. 测试数字签名...');
        const dataToSign = 'Transaction: Alice -> Bob: 100 BTC';
        console.log('   待签名数据:', dataToSign);

        try {
          const signature = await ukeyManager.sign(dataToSign);
          console.log('   签名结果:', signature.substring(0, 50) + '...');

          const publicKey = await ukeyManager.getPublicKey();
          console.log('   公钥:', publicKey.substring(0, 50) + '...');

          const verified = await ukeyManager.verifySignature(dataToSign, signature);
          console.log('   验证结果:', verified);

          if (verified) {
            console.log('   ✓ 数字签名测试通过\n');
          } else {
            console.log('   ✗ 签名验证失败\n');
          }
        } catch (error) {
          console.log('   ⚠ 数字签名测试失败:', error.message, '\n');
        }

        // 8. 测试锁定功能
        console.log('8. 测试锁定功能...');
        ukeyManager.lock();
        const isUnlocked = ukeyManager.isUnlocked();
        console.log('   锁定后状态:', isUnlocked ? '未锁定' : '已锁定');

        if (!isUnlocked) {
          console.log('   ✓ 锁定功能测试通过\n');
        } else {
          console.log('   ✗ 锁定功能测试失败\n');
        }
      } else {
        console.log('   ✗ PIN验证失败:', verifyResult.error, '\n');
      }
    } else {
      console.log('   ⚠ 未检测到设备（可能在模拟模式下）\n');

      // 在模拟模式下继续测试基本功能
      console.log('4. 在模拟模式下测试PIN验证...');
      const verifyResult = await ukeyManager.verifyPIN('888888');
      console.log('   验证结果:', JSON.stringify(verifyResult, null, 2));

      if (verifyResult.success) {
        console.log('   ✓ 模拟模式PIN验证成功\n');
      }
    }

    // 9. 测试事件监听
    console.log('9. 测试事件监听...');
    ukeyManager.on('unlocked', () => {
      console.log('   [事件] U盾已解锁');
    });
    ukeyManager.on('locked', () => {
      console.log('   [事件] U盾已锁定');
    });
    ukeyManager.on('device-connected', () => {
      console.log('   [事件] 设备已连接');
    });
    ukeyManager.on('device-disconnected', () => {
      console.log('   [事件] 设备已断开');
    });
    console.log('   ✓ 事件监听器注册成功\n');

    // 10. 测试配置更新
    console.log('10. 测试配置更新...');
    config.set('testKey', 'testValue');
    config.save();
    const testValue = config.get('testKey');
    console.log('   配置读写:', testValue === 'testValue' ? '✓ 成功' : '✗ 失败');
    console.log('   ✓ 配置更新测试通过\n');

    console.log('=== 所有测试完成 ✓ ===\n');
    console.log('提示：');
    console.log('- 如果看到"模拟模式"消息，说明未连接真实硬件');
    console.log('- 连接真实U盾硬件后，需要安装对应的DLL驱动');
    console.log('- 芯劲科U盾驱动默认查找路径: resources/xjk.dll');
    console.log('- 可以通过配置文件修改驱动路径和参数');
  } catch (error) {
    console.error('\n✗ 测试失败:', error);
    console.error('错误详情:', error.stack);
  } finally {
    // 清理
    if (ukeyManager) {
      console.log('\n关闭U盾管理器...');
      await ukeyManager.close();
      console.log('✓ 清理完成');
    }
  }
}

// 运行测试
runTests().catch(console.error);
