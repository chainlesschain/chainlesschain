/**
 * Phase 8 真实功能测试
 * 测试网络诊断工具和屏幕录制器配置
 */

// 设置环境变量启用真实实现
process.env.USE_REAL_TOOLS = "true";

const { logger } = require("../utils/logger.js");
const FunctionCaller = require("../ai-engine/function-caller");
const fs = require("fs").promises;
const path = require("path");

async function testPhase8RealTools() {
  logger.info("========================================");
  logger.info("Phase 8 真实功能测试 - 网络诊断和录屏配置");
  logger.info("========================================\n");

  const functionCaller = new FunctionCaller();
  const testDir = path.join(__dirname, "../../test-output");

  // 确保测试目录存在
  await fs.mkdir(testDir, { recursive: true });

  let passedTests = 0;
  let failedTests = 0;
  const results = [];

  // ==================== 网络诊断工具测试 ====================

  logger.info("🌐 网络诊断工具测试\n");
  logger.info("═══════════════════════════════════════\n");

  // ==================== 测试1: Ping测试 ====================
  logger.info("📝 测试1: Ping测试 (ping baidu.com)\n");
  try {
    const result = await functionCaller.call("network_diagnostic_tool", {
      operation: "ping",
      target: "baidu.com",
      options: { count: 4 },
    });

    if (result.success) {
      logger.info("   ✅ Ping测试成功!");
      logger.info(`   → 目标: ${result.target}`);
      logger.info(`   → 发送: ${result.statistics.packets_sent}包`);
      logger.info(`   → 接收: ${result.statistics.packets_received}包`);
      logger.info(`   → 丢包率: ${result.statistics.packet_loss}%`);
      logger.info(`   → 平均延迟: ${result.statistics.avg_time}ms`);
      logger.info(`   → 最小延迟: ${result.statistics.min_time}ms`);
      logger.info(`   → 最大延迟: ${result.statistics.max_time}ms\n`);

      // 验证数据有效性
      if (
        result.statistics.avg_time > 0 &&
        result.statistics.packet_loss < 100
      ) {
        passedTests++;
        results.push({
          test: "Ping测试",
          status: "通过",
          avg_time: result.statistics.avg_time,
          packet_loss: result.statistics.packet_loss,
        });
      } else {
        logger.info("   ⚠️  Ping结果异常\n");
        failedTests++;
        results.push({
          test: "Ping测试",
          status: "失败",
          error: "Ping结果异常",
        });
      }
    } else {
      logger.info(`   ❌ Ping失败: ${result.error}\n`);
      failedTests++;
      results.push({ test: "Ping测试", status: "失败", error: result.error });
    }
  } catch (error) {
    logger.info(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: "Ping测试", status: "异常", error: error.message });
  }

  // ==================== 测试2: DNS解析测试 ====================
  logger.info("📝 测试2: DNS解析测试 (baidu.com)\n");
  try {
    const result = await functionCaller.call("network_diagnostic_tool", {
      operation: "dns",
      target: "baidu.com",
    });

    if (result.success) {
      logger.info("   ✅ DNS解析成功!");
      logger.info(`   → 域名: ${result.target}`);
      logger.info(`   → 主IP: ${result.primary}`);
      logger.info(`   → 所有IP地址:`);
      result.addresses.forEach((addr, i) => {
        logger.info(`      ${i + 1}. ${addr}`);
      });
      logger.info();

      // 验证至少解析到一个IP
      if (result.addresses && result.addresses.length > 0) {
        passedTests++;
        results.push({
          test: "DNS解析",
          status: "通过",
          ip_count: result.addresses.length,
        });
      } else {
        logger.info("   ⚠️  未解析到IP地址\n");
        failedTests++;
        results.push({ test: "DNS解析", status: "失败", error: "未解析到IP" });
      }
    } else {
      logger.info(`   ❌ DNS解析失败: ${result.error}\n`);
      failedTests++;
      results.push({ test: "DNS解析", status: "失败", error: result.error });
    }
  } catch (error) {
    logger.info(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: "DNS解析", status: "异常", error: error.message });
  }

  // ==================== 测试3: 端口检查测试 ====================
  logger.info("📝 测试3: 端口检查 (baidu.com:80)\n");
  try {
    const result = await functionCaller.call("network_diagnostic_tool", {
      operation: "port_check",
      target: "baidu.com",
      options: { port: 80, timeout: 5000 },
    });

    if (result.success) {
      logger.info("   ✅ 端口检查完成!");
      logger.info(`   → 主机: ${result.host}`);
      logger.info(`   → 端口: ${result.port}`);
      logger.info(`   → 状态: ${result.status}`);
      if (result.response_time) {
        logger.info(`   → 响应时间: ${result.response_time}ms`);
      }
      logger.info();

      // 验证端口状态
      if (
        result.status === "open" ||
        result.status === "closed" ||
        result.status === "timeout"
      ) {
        passedTests++;
        results.push({
          test: "端口检查",
          status: "通过",
          port_status: result.status,
        });
      } else {
        logger.info("   ⚠️  端口状态异常\n");
        failedTests++;
        results.push({ test: "端口检查", status: "失败", error: "状态异常" });
      }
    } else {
      logger.info(`   ❌ 端口检查失败: ${result.error}\n`);
      failedTests++;
      results.push({ test: "端口检查", status: "失败", error: result.error });
    }
  } catch (error) {
    logger.info(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: "端口检查", status: "异常", error: error.message });
  }

  // ==================== 测试4: Traceroute测试 (可选) ====================
  logger.info("📝 测试4: Traceroute测试 (跳过 - 耗时较长)\n");
  logger.info("   ⏭️  已跳过，避免测试超时\n");
  results.push({ test: "Traceroute", status: "跳过" });

  // ==================== 屏幕录制器配置测试 ====================

  logger.info("🎥 屏幕录制器配置测试\n");
  logger.info("═══════════════════════════════════════\n");

  // ==================== 测试5: 高质量录制配置 ====================
  logger.info("📝 测试5: 创建高质量录制配置\n");
  try {
    const outputPath = path.join(testDir, "recording-high.mp4");

    const result = await functionCaller.call("screen_recorder", {
      output_path: outputPath,
      output_format: "mp4",
      fps: 60,
      quality: "high",
      screen_index: 0,
    });

    if (result.success) {
      logger.info("   ✅ 配置创建成功!");
      logger.info(`   → 配置文件: ${result.config_path}`);
      logger.info(`   → 状态: ${result.status}`);
      logger.info(`   → 输出格式: ${result.output_format}`);
      logger.info(`   → FPS: ${result.fps}`);
      logger.info(`   → 质量: ${result.quality}`);
      logger.info(`   → 分辨率: ${result.resolution}`);
      logger.info(`   → 比特率: ${result.bitrate}`);
      logger.info(`   → 消息: ${result.message}\n`);

      // 验证配置文件是否创建
      const configExists = await fs
        .access(result.config_path)
        .then(() => true)
        .catch(() => false);

      if (configExists) {
        // 读取并验证配置内容
        const configContent = await fs.readFile(result.config_path, "utf-8");
        const config = JSON.parse(configContent);

        logger.info("   📄 配置文件内容:");
        logger.info(`      → 输出路径: ${config.output_path}`);
        logger.info(`      → 格式: ${config.output_format}`);
        logger.info(`      → FPS: ${config.fps}`);
        logger.info(`      → 质量: ${config.quality}`);
        logger.info(`      → 比特率: ${config.bitrate}\n`);

        passedTests++;
        results.push({
          test: "高质量录制配置",
          status: "通过",
          config_path: result.config_path,
        });
      } else {
        logger.info("   ⚠️  配置文件未创建\n");
        failedTests++;
        results.push({
          test: "高质量录制配置",
          status: "失败",
          error: "配置文件未创建",
        });
      }
    } else {
      logger.info(`   ❌ 配置创建失败: ${result.error}\n`);
      failedTests++;
      results.push({
        test: "高质量录制配置",
        status: "失败",
        error: result.error,
      });
    }
  } catch (error) {
    logger.info(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({
      test: "高质量录制配置",
      status: "异常",
      error: error.message,
    });
  }

  // ==================== 测试6: 中质量GIF配置 ====================
  logger.info("📝 测试6: 创建中质量GIF配置\n");
  try {
    const outputPath = path.join(testDir, "recording-medium.gif");

    const result = await functionCaller.call("screen_recorder", {
      output_path: outputPath,
      output_format: "gif",
      fps: 15,
      quality: "medium",
    });

    if (result.success) {
      logger.info("   ✅ GIF配置创建成功!");
      logger.info(`   → 配置文件: ${result.config_path}`);
      logger.info(`   → 格式: ${result.output_format}`);
      logger.info(`   → FPS: ${result.fps}`);
      logger.info(`   → 质量: ${result.quality}`);
      logger.info(`   → 分辨率: ${result.resolution}\n`);

      // 验证配置文件
      const configExists = await fs
        .access(result.config_path)
        .then(() => true)
        .catch(() => false);

      if (configExists) {
        passedTests++;
        results.push({
          test: "GIF录制配置",
          status: "通过",
        });
      } else {
        logger.info("   ⚠️  配置文件未创建\n");
        failedTests++;
        results.push({
          test: "GIF录制配置",
          status: "失败",
          error: "配置文件未创建",
        });
      }
    } else {
      logger.info(`   ❌ 配置创建失败: ${result.error}\n`);
      failedTests++;
      results.push({
        test: "GIF录制配置",
        status: "失败",
        error: result.error,
      });
    }
  } catch (error) {
    logger.info(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: "GIF录制配置", status: "异常", error: error.message });
  }

  // ==================== 测试总结 ====================
  logger.info("========================================");
  logger.info("测试总结");
  logger.info("========================================\n");

  const totalTests = passedTests + failedTests;
  const successRate =
    totalTests > 0 ? ((passedTests / totalTests) * 100).toFixed(1) : 0;

  logger.info(`总测试数: ${totalTests}`);
  logger.info(`通过: ${passedTests} ✅`);
  logger.info(`失败: ${failedTests} ❌`);
  logger.info(`成功率: ${successRate}%\n`);

  logger.info("详细结果:");
  results.forEach((result, index) => {
    const statusIcon =
      result.status === "通过" ? "✅" : result.status === "跳过" ? "⏭️" : "❌";
    logger.info(
      `${index + 1}. ${statusIcon} ${result.test} - ${result.status}`,
    );
    if (result.avg_time) {
      logger.info(`   平均延迟: ${result.avg_time}ms`);
    }
    if (result.packet_loss !== undefined) {
      logger.info(`   丢包率: ${result.packet_loss}%`);
    }
    if (result.ip_count) {
      logger.info(`   解析IP数: ${result.ip_count}`);
    }
    if (result.port_status) {
      logger.info(`   端口状态: ${result.port_status}`);
    }
    if (result.config_path) {
      logger.info(`   配置文件: ${result.config_path}`);
    }
    if (result.error) {
      logger.info(`   错误: ${result.error}`);
    }
  });

  logger.info("\n========================================");
  logger.info(`测试输出目录: ${testDir}`);
  logger.info("========================================\n");

  return {
    total: totalTests,
    passed: passedTests,
    failed: failedTests,
    successRate: successRate,
    results: results,
  };
}

// 运行测试
if (require.main === module) {
  testPhase8RealTools()
    .then((summary) => {
      if (summary.failed === 0) {
        logger.info("🎉 所有测试通过!");
        process.exit(0);
      } else {
        logger.info("⚠️ 有测试失败");
        process.exit(1);
      }
    })
    .catch((error) => {
      logger.error("❌ 测试执行失败:", error);
      logger.error(error.stack);
      process.exit(1);
    });
}

module.exports = { testPhase8RealTools };
