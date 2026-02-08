/**
 * 多品牌U盾自动识别测试
 *
 * 测试华大、天地融等新增品牌的自动检测功能
 */

const { logger } = require("../utils/logger.js");
const { UKeyManager, DriverTypes } = require("./ukey-manager");

/**
 * 测试自动检测功能
 */
async function testAutoDetect() {
  logger.info("\n========== 测试U盾自动检测 ==========\n");

  const manager = new UKeyManager({
    simulationMode: false,
    debug: true,
  });

  try {
    // 初始化管理器
    await manager.initialize();
    logger.info("✓ U盾管理器初始化成功\n");

    // 执行自动检测
    logger.info("正在自动检测U盾设备...\n");
    const result = await manager.autoDetect();

    if (result.detected) {
      logger.info("✓ 检测成功！");
      logger.info(`  驱动类型: ${result.driverType}`);
      logger.info(`  制造商: ${result.status.manufacturer}`);
      logger.info(`  型号: ${result.status.model}`);
      logger.info(
        `  设备状态: ${result.status.unlocked ? "已解锁" : "已锁定"}`,
      );

      // 获取设备信息
      const deviceInfo = await manager.getDeviceInfo();
      logger.info("\n设备详细信息:");
      logger.info(JSON.stringify(deviceInfo, null, 2));
    } else {
      logger.info("✗ 未检测到U盾设备");
      logger.info("提示: 请确保U盾已插入并安装了对应的驱动程序");
    }
  } catch (error) {
    logger.error("✗ 测试失败:", error.message);
  } finally {
    await manager.close();
  }
}

/**
 * 测试手动切换驱动
 */
async function testManualSwitch() {
  logger.info("\n========== 测试手动切换驱动 ==========\n");

  const manager = new UKeyManager({
    driverType: DriverTypes.XINJINKE,
    simulationMode: false,
  });

  try {
    await manager.initialize();
    logger.info(`当前驱动: ${manager.getDriverType()}\n`);

    // 测试切换到各个驱动
    const driverTypes = [
      DriverTypes.FEITIAN,
      DriverTypes.WATCHDATA,
      DriverTypes.HUADA,
      DriverTypes.TDR,
    ];

    for (const type of driverTypes) {
      logger.info(`切换到 ${type} 驱动...`);
      try {
        await manager.switchDriver(type);
        logger.info(`✓ 成功切换到 ${type}`);
        logger.info(`  驱动名称: ${manager.getDriverName()}\n`);
      } catch (error) {
        logger.info(`✗ 切换失败: ${error.message}\n`);
      }
    }
  } catch (error) {
    logger.error("✗ 测试失败:", error.message);
  } finally {
    await manager.close();
  }
}

/**
 * 测试所有驱动的初始化
 */
async function testAllDrivers() {
  logger.info("\n========== 测试所有驱动初始化 ==========\n");

  const drivers = [
    { type: DriverTypes.XINJINKE, name: "鑫金科" },
    { type: DriverTypes.FEITIAN, name: "飞天诚信" },
    { type: DriverTypes.WATCHDATA, name: "握奇（卫士通）" },
    { type: DriverTypes.HUADA, name: "华大" },
    { type: DriverTypes.TDR, name: "天地融" },
    { type: DriverTypes.SIMULATED, name: "模拟驱动" },
  ];

  for (const driver of drivers) {
    logger.info(`测试 ${driver.name} (${driver.type}) 驱动...`);

    const manager = new UKeyManager({
      driverType: driver.type,
      simulationMode: false,
    });

    try {
      await manager.initialize();
      logger.info(`✓ ${driver.name} 驱动初始化成功`);
      logger.info(`  驱动版本: ${manager.getDriverVersion()}`);

      // 尝试检测设备
      const status = await manager.detect();
      logger.info(`  设备检测: ${status.detected ? "检测到" : "未检测到"}`);

      await manager.close();
    } catch (error) {
      logger.info(`✗ ${driver.name} 驱动初始化失败: ${error.message}`);
    }

    logger.info("");
  }
}

/**
 * 测试特定品牌功能
 */
async function testBrandSpecificFeatures() {
  logger.info("\n========== 测试品牌特定功能 ==========\n");

  // 测试华大国密算法支持
  logger.info("测试华大国密算法支持...");
  try {
    const HuadaDriver = require("./huada-driver");
    const huadaDriver = new HuadaDriver({ simulationMode: true });
    await huadaDriver.initialize();

    const smSupport = huadaDriver.supportsSM();
    logger.info("✓ 华大国密算法支持:");
    logger.info(`  SM2: ${smSupport.SM2 ? "✓" : "✗"}`);
    logger.info(`  SM3: ${smSupport.SM3 ? "✓" : "✗"}`);
    logger.info(`  SM4: ${smSupport.SM4 ? "✓" : "✗"}`);
    logger.info(`  SM9: ${smSupport.SM9 ? "✓" : "✗"}\n`);
  } catch (error) {
    logger.info(`✗ 测试失败: ${error.message}\n`);
  }

  // 测试天地融支付模式
  logger.info("测试天地融支付模式...");
  try {
    const TDRDriver = require("./tdr-driver");
    const tdrDriver = new TDRDriver({ simulationMode: true });
    await tdrDriver.initialize();

    const paymentMode = await tdrDriver.enablePaymentMode();
    logger.info("✓ 天地融支付模式:");
    logger.info(`  启用状态: ${paymentMode.enabled ? "已启用" : "未启用"}`);
    logger.info(`  模式类型: ${paymentMode.mode}\n`);

    const counter = await tdrDriver.getTransactionCounter();
    logger.info("✓ 交易计数器:");
    logger.info(`  当前计数: ${counter.counter}`);
    logger.info(`  最大计数: ${counter.maxCount}\n`);
  } catch (error) {
    logger.info(`✗ 测试失败: ${error.message}\n`);
  }
}

/**
 * 运行所有测试
 */
async function runAllTests() {
  logger.info("========================================");
  logger.info("    多品牌U盾自动识别测试套件");
  logger.info("========================================");

  try {
    await testAllDrivers();
    await testAutoDetect();
    await testManualSwitch();
    await testBrandSpecificFeatures();

    logger.info("\n========================================");
    logger.info("           测试完成");
    logger.info("========================================\n");
  } catch (error) {
    logger.error("\n测试过程中出现错误:", error);
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
