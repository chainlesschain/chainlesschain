/**
 * 多品牌U盾自动识别测试
 *
 * 测试华大、天地融等新增品牌的自动检测功能
 */

const { UKeyManager, DriverTypes } = require('./ukey-manager');

/**
 * 测试自动检测功能
 */
async function testAutoDetect() {
  console.log('\n========== 测试U盾自动检测 ==========\n');

  const manager = new UKeyManager({
    simulationMode: false,
    debug: true,
  });

  try {
    // 初始化管理器
    await manager.initialize();
    console.log('✓ U盾管理器初始化成功\n');

    // 执行自动检测
    console.log('正在自动检测U盾设备...\n');
    const result = await manager.autoDetect();

    if (result.detected) {
      console.log('✓ 检测成功！');
      console.log(`  驱动类型: ${result.driverType}`);
      console.log(`  制造商: ${result.status.manufacturer}`);
      console.log(`  型号: ${result.status.model}`);
      console.log(`  设备状态: ${result.status.unlocked ? '已解锁' : '已锁定'}`);

      // 获取设备信息
      const deviceInfo = await manager.getDeviceInfo();
      console.log('\n设备详细信息:');
      console.log(JSON.stringify(deviceInfo, null, 2));
    } else {
      console.log('✗ 未检测到U盾设备');
      console.log('提示: 请确保U盾已插入并安装了对应的驱动程序');
    }
  } catch (error) {
    console.error('✗ 测试失败:', error.message);
  } finally {
    await manager.close();
  }
}

/**
 * 测试手动切换驱动
 */
async function testManualSwitch() {
  console.log('\n========== 测试手动切换驱动 ==========\n');

  const manager = new UKeyManager({
    driverType: DriverTypes.XINJINKE,
    simulationMode: false,
  });

  try {
    await manager.initialize();
    console.log(`当前驱动: ${manager.getDriverType()}\n`);

    // 测试切换到各个驱动
    const driverTypes = [
      DriverTypes.FEITIAN,
      DriverTypes.WATCHDATA,
      DriverTypes.HUADA,
      DriverTypes.TDR,
    ];

    for (const type of driverTypes) {
      console.log(`切换到 ${type} 驱动...`);
      try {
        await manager.switchDriver(type);
        console.log(`✓ 成功切换到 ${type}`);
        console.log(`  驱动名称: ${manager.getDriverName()}\n`);
      } catch (error) {
        console.log(`✗ 切换失败: ${error.message}\n`);
      }
    }
  } catch (error) {
    console.error('✗ 测试失败:', error.message);
  } finally {
    await manager.close();
  }
}

/**
 * 测试所有驱动的初始化
 */
async function testAllDrivers() {
  console.log('\n========== 测试所有驱动初始化 ==========\n');

  const drivers = [
    { type: DriverTypes.XINJINKE, name: '鑫金科' },
    { type: DriverTypes.FEITIAN, name: '飞天诚信' },
    { type: DriverTypes.WATCHDATA, name: '握奇（卫士通）' },
    { type: DriverTypes.HUADA, name: '华大' },
    { type: DriverTypes.TDR, name: '天地融' },
    { type: DriverTypes.SIMULATED, name: '模拟驱动' },
  ];

  for (const driver of drivers) {
    console.log(`测试 ${driver.name} (${driver.type}) 驱动...`);

    const manager = new UKeyManager({
      driverType: driver.type,
      simulationMode: false,
    });

    try {
      await manager.initialize();
      console.log(`✓ ${driver.name} 驱动初始化成功`);
      console.log(`  驱动版本: ${manager.getDriverVersion()}`);

      // 尝试检测设备
      const status = await manager.detect();
      console.log(`  设备检测: ${status.detected ? '检测到' : '未检测到'}`);

      await manager.close();
    } catch (error) {
      console.log(`✗ ${driver.name} 驱动初始化失败: ${error.message}`);
    }

    console.log('');
  }
}

/**
 * 测试特定品牌功能
 */
async function testBrandSpecificFeatures() {
  console.log('\n========== 测试品牌特定功能 ==========\n');

  // 测试华大国密算法支持
  console.log('测试华大国密算法支持...');
  try {
    const HuadaDriver = require('./huada-driver');
    const huadaDriver = new HuadaDriver({ simulationMode: true });
    await huadaDriver.initialize();

    const smSupport = huadaDriver.supportsSM();
    console.log('✓ 华大国密算法支持:');
    console.log(`  SM2: ${smSupport.SM2 ? '✓' : '✗'}`);
    console.log(`  SM3: ${smSupport.SM3 ? '✓' : '✗'}`);
    console.log(`  SM4: ${smSupport.SM4 ? '✓' : '✗'}`);
    console.log(`  SM9: ${smSupport.SM9 ? '✓' : '✗'}\n`);
  } catch (error) {
    console.log(`✗ 测试失败: ${error.message}\n`);
  }

  // 测试天地融支付模式
  console.log('测试天地融支付模式...');
  try {
    const TDRDriver = require('./tdr-driver');
    const tdrDriver = new TDRDriver({ simulationMode: true });
    await tdrDriver.initialize();

    const paymentMode = await tdrDriver.enablePaymentMode();
    console.log('✓ 天地融支付模式:');
    console.log(`  启用状态: ${paymentMode.enabled ? '已启用' : '未启用'}`);
    console.log(`  模式类型: ${paymentMode.mode}\n`);

    const counter = await tdrDriver.getTransactionCounter();
    console.log('✓ 交易计数器:');
    console.log(`  当前计数: ${counter.counter}`);
    console.log(`  最大计数: ${counter.maxCount}\n`);
  } catch (error) {
    console.log(`✗ 测试失败: ${error.message}\n`);
  }
}

/**
 * 运行所有测试
 */
async function runAllTests() {
  console.log('========================================');
  console.log('    多品牌U盾自动识别测试套件');
  console.log('========================================');

  try {
    await testAllDrivers();
    await testAutoDetect();
    await testManualSwitch();
    await testBrandSpecificFeatures();

    console.log('\n========================================');
    console.log('           测试完成');
    console.log('========================================\n');
  } catch (error) {
    console.error('\n测试过程中出现错误:', error);
  }
}

// 如果直接运行此文件，则执行测试
if (require.main === module) {
  runAllTests().catch(console.error);
}

// 导出测试函数
module.exports = {
  testAutoDetect,
  testManualSwitch,
  testAllDrivers,
  testBrandSpecificFeatures,
  runAllTests,
};
