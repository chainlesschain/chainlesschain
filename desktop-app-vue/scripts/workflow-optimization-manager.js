/**
 * Workflow Optimization Manager - CLI Tool
 *
 * 统一管理和监控所有17个工作流程优化
 *
 * 功能:
 * 1. 查看优化状态
 * 2. 启用/禁用优化
 * 3. 查看实时统计
 * 4. 导出配置
 * 5. 运行健康检查
 * 6. 生成性能报告
 *
 * 使用方法:
 * node scripts/workflow-optimization-manager.js [command] [options]
 */

const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");

// ============================================================================
// Configuration Manager (配置管理器)
// ============================================================================

class OptimizationConfigManager {
  constructor() {
    this.configPath = path.join(
      process.cwd(),
      ".chainlesschain",
      "config.json",
    );
    this.config = this.loadConfig();
  }

  loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, "utf-8");
        return JSON.parse(data);
      }
    } catch (error) {
      console.warn("⚠️ Failed to load config, using defaults");
    }

    return this.getDefaultConfig();
  }

  getDefaultConfig() {
    return {
      workflow: {
        optimizations: {
          enabled: true,
          phase1: {
            ragParallel: true,
            messageAggregation: true,
            toolCache: true,
            lazyFileTree: true,
          },
          phase2: {
            llmFallback: true,
            dynamicConcurrency: true,
            smartRetry: true,
            qualityGate: true,
          },
          phase3: {
            planCache: {
              enabled: true,
              similarityThreshold: 0.75,
              maxSize: 100,
              useEmbedding: false,
            },
            llmDecision: {
              enabled: true,
              highConfidenceThreshold: 0.9,
              contextLengthThreshold: 10000,
              subtaskCountThreshold: 3,
            },
            agentPool: {
              enabled: true,
              minSize: 3,
              maxSize: 10,
              warmupOnInit: true,
            },
            criticalPath: {
              enabled: true,
              priorityBoost: 2.0,
            },
            realtimeQuality: {
              enabled: false,
              checkDelay: 500,
            },
            autoPhaseTransition: true,
            smartCheckpoint: true,
          },
        },
      },
    };
  }

  saveConfig() {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
      console.log("✅ Configuration saved to:", this.configPath);
      return true;
    } catch (error) {
      console.error("❌ Failed to save config:", error.message);
      return false;
    }
  }

  getOptimizationStatus() {
    const opt = this.config.workflow.optimizations;

    return {
      global: opt.enabled,
      phase1: {
        ragParallel: opt.phase1.ragParallel,
        messageAggregation: opt.phase1.messageAggregation,
        toolCache: opt.phase1.toolCache,
        lazyFileTree: opt.phase1.lazyFileTree,
      },
      phase2: {
        llmFallback: opt.phase2.llmFallback,
        dynamicConcurrency: opt.phase2.dynamicConcurrency,
        smartRetry: opt.phase2.smartRetry,
        qualityGate: opt.phase2.qualityGate,
      },
      phase3: {
        planCache: opt.phase3.planCache.enabled,
        llmDecision: opt.phase3.llmDecision.enabled,
        agentPool: opt.phase3.agentPool.enabled,
        criticalPath: opt.phase3.criticalPath.enabled,
        realtimeQuality: opt.phase3.realtimeQuality.enabled,
        autoPhaseTransition: opt.phase3.autoPhaseTransition,
        smartCheckpoint: opt.phase3.smartCheckpoint,
      },
    };
  }

  enableOptimization(name, value = true) {
    const paths = {
      "phase1.ragParallel": [
        "workflow",
        "optimizations",
        "phase1",
        "ragParallel",
      ],
      "phase1.messageAggregation": [
        "workflow",
        "optimizations",
        "phase1",
        "messageAggregation",
      ],
      "phase1.toolCache": ["workflow", "optimizations", "phase1", "toolCache"],
      "phase1.lazyFileTree": [
        "workflow",
        "optimizations",
        "phase1",
        "lazyFileTree",
      ],
      "phase2.llmFallback": [
        "workflow",
        "optimizations",
        "phase2",
        "llmFallback",
      ],
      "phase2.dynamicConcurrency": [
        "workflow",
        "optimizations",
        "phase2",
        "dynamicConcurrency",
      ],
      "phase2.smartRetry": [
        "workflow",
        "optimizations",
        "phase2",
        "smartRetry",
      ],
      "phase2.qualityGate": [
        "workflow",
        "optimizations",
        "phase2",
        "qualityGate",
      ],
      "phase3.planCache": [
        "workflow",
        "optimizations",
        "phase3",
        "planCache",
        "enabled",
      ],
      "phase3.llmDecision": [
        "workflow",
        "optimizations",
        "phase3",
        "llmDecision",
        "enabled",
      ],
      "phase3.agentPool": [
        "workflow",
        "optimizations",
        "phase3",
        "agentPool",
        "enabled",
      ],
      "phase3.criticalPath": [
        "workflow",
        "optimizations",
        "phase3",
        "criticalPath",
        "enabled",
      ],
      "phase3.realtimeQuality": [
        "workflow",
        "optimizations",
        "phase3",
        "realtimeQuality",
        "enabled",
      ],
      "phase3.autoPhaseTransition": [
        "workflow",
        "optimizations",
        "phase3",
        "autoPhaseTransition",
      ],
      "phase3.smartCheckpoint": [
        "workflow",
        "optimizations",
        "phase3",
        "smartCheckpoint",
      ],
    };

    const configPath = paths[name];
    if (!configPath) {
      console.error(`❌ Unknown optimization: ${name}`);
      return false;
    }

    let obj = this.config;
    for (let i = 0; i < configPath.length - 1; i++) {
      obj = obj[configPath[i]];
    }
    obj[configPath[configPath.length - 1]] = value;

    return this.saveConfig();
  }
}

// ============================================================================
// Status Checker (状态检查器)
// ============================================================================

class OptimizationStatusChecker {
  constructor() {
    this.configManager = new OptimizationConfigManager();
  }

  async checkAll() {
    console.log("\n" + "=".repeat(70));
    console.log("Workflow Optimizations - Status Check");
    console.log("=".repeat(70) + "\n");

    const status = this.configManager.getOptimizationStatus();

    // Phase 1
    console.log("Phase 1: 基础性能优化 (P0)");
    console.log("─".repeat(70));
    this.printOptimizationStatus("RAG并行化", status.phase1.ragParallel);
    this.printOptimizationStatus(
      "消息聚合渲染",
      status.phase1.messageAggregation,
    );
    this.printOptimizationStatus("工具调用缓存", status.phase1.toolCache);
    this.printOptimizationStatus("文件树懒加载", status.phase1.lazyFileTree);

    // Phase 2
    console.log("\nPhase 2: 智能化优化 (P1)");
    console.log("─".repeat(70));
    this.printOptimizationStatus("LLM降级策略", status.phase2.llmFallback);
    this.printOptimizationStatus(
      "动态并发控制",
      status.phase2.dynamicConcurrency,
    );
    this.printOptimizationStatus("智能重试策略", status.phase2.smartRetry);
    this.printOptimizationStatus("质量门禁并行", status.phase2.qualityGate);

    // Phase 3
    console.log("\nPhase 3/4: 高级智能优化 (P2)");
    console.log("─".repeat(70));
    this.printOptimizationStatus("智能计划缓存", status.phase3.planCache);
    this.printOptimizationStatus("LLM辅助决策", status.phase3.llmDecision);
    this.printOptimizationStatus("代理池复用", status.phase3.agentPool);
    this.printOptimizationStatus("关键路径优化", status.phase3.criticalPath);
    this.printOptimizationStatus("实时质量检查", status.phase3.realtimeQuality);
    this.printOptimizationStatus(
      "自动阶段转换",
      status.phase3.autoPhaseTransition,
    );
    this.printOptimizationStatus("智能检查点", status.phase3.smartCheckpoint);

    console.log("\n" + "=".repeat(70));

    // 统计
    const enabled = this.countEnabled(status);
    const total = 17;
    const percentage = ((enabled / total) * 100).toFixed(1);

    console.log(`\n📊 总计: ${enabled}/${total} 个优化已启用 (${percentage}%)`);

    if (enabled === total) {
      console.log("✅ 所有优化已启用，性能最优！");
    } else if (enabled >= 10) {
      console.log("⚠️  部分优化未启用，可能影响性能");
    } else {
      console.log("🔴 大部分优化未启用，建议启用以提升性能");
    }

    console.log();
  }

  printOptimizationStatus(name, enabled) {
    const icon = enabled ? "✅" : "❌";
    const status = enabled ? "Enabled " : "Disabled";
    console.log(`  ${icon} ${name.padEnd(20)} [${status}]`);
  }

  countEnabled(status) {
    let count = 0;

    for (const opt of Object.values(status.phase1)) {
      if (opt) count++;
    }
    for (const opt of Object.values(status.phase2)) {
      if (opt) count++;
    }
    for (const opt of Object.values(status.phase3)) {
      if (opt) count++;
    }

    return count;
  }

  async checkHealth() {
    console.log("\n" + "=".repeat(70));
    console.log("Workflow Optimizations - Health Check");
    console.log("=".repeat(70) + "\n");

    const checks = [];

    // Check 1: 配置文件
    checks.push(await this.checkConfigFile());

    // Check 2: 优化模块文件
    checks.push(await this.checkOptimizationFiles());

    // Check 3: 依赖项
    checks.push(await this.checkDependencies());

    // Check 4: 测试文件
    checks.push(await this.checkTestFiles());

    console.log("\n" + "=".repeat(70));

    const passed = checks.filter((c) => c.status === "pass").length;
    const total = checks.length;

    console.log(`\n📊 健康检查: ${passed}/${total} 项通过\n`);

    if (passed === total) {
      console.log("✅ 所有检查通过，系统健康！");
    } else {
      console.log("⚠️  部分检查失败，请查看上述详情");
    }

    console.log();

    return passed === total;
  }

  async checkConfigFile() {
    const configPath = path.join(
      process.cwd(),
      ".chainlesschain",
      "config.json",
    );
    const exists = fs.existsSync(configPath);

    console.log("1. 配置文件检查");
    if (exists) {
      try {
        const data = fs.readFileSync(configPath, "utf-8");
        JSON.parse(data);
        console.log("   ✅ 配置文件存在且有效");
        return { name: "Config File", status: "pass" };
      } catch (error) {
        console.log("   ❌ 配置文件格式错误:", error.message);
        return { name: "Config File", status: "fail", error: error.message };
      }
    } else {
      console.log("   ⚠️  配置文件不存在，将使用默认配置");
      return { name: "Config File", status: "warn" };
    }
  }

  async checkOptimizationFiles() {
    console.log("\n2. 优化模块文件检查");

    const files = [
      "src/main/ai-engine/smart-plan-cache.js",
      "src/main/ai-engine/llm-decision-engine.js",
      "src/main/ai-engine/cowork/agent-pool.js",
      "src/main/ai-engine/critical-path-optimizer.js",
      "src/main/ai-engine/real-time-quality-gate.js",
    ];

    let allExist = true;

    for (const file of files) {
      const filePath = path.join(process.cwd(), file);
      const exists = fs.existsSync(filePath);

      if (exists) {
        console.log(`   ✅ ${path.basename(file)}`);
      } else {
        console.log(`   ❌ ${path.basename(file)} - 文件缺失`);
        allExist = false;
      }
    }

    return {
      name: "Optimization Files",
      status: allExist ? "pass" : "fail",
    };
  }

  async checkDependencies() {
    console.log("\n3. 依赖项检查");

    const packageJsonPath = path.join(process.cwd(), "package.json");

    if (!fs.existsSync(packageJsonPath)) {
      console.log("   ❌ package.json 不存在");
      return { name: "Dependencies", status: "fail" };
    }

    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      const deps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };

      // 检查可选依赖
      const optionalDeps = {
        chokidar: "实时质量检查",
      };

      for (const [dep, purpose] of Object.entries(optionalDeps)) {
        if (deps[dep]) {
          console.log(`   ✅ ${dep} (${purpose})`);
        } else {
          console.log(`   ⚠️  ${dep} - 可选依赖，${purpose}功能将不可用`);
        }
      }

      return {
        name: "Dependencies",
        status: "pass",
      };
    } catch (error) {
      console.log("   ❌ 读取package.json失败:", error.message);
      return { name: "Dependencies", status: "fail", error: error.message };
    }
  }

  async checkTestFiles() {
    console.log("\n4. 测试文件检查");

    const testFiles = [
      "tests/ai-engine/smart-plan-cache.test.js",
      "tests/ai-engine/llm-decision-engine.test.js",
      "tests/ai-engine/agent-pool.test.js",
      "tests/ai-engine/critical-path-optimizer.test.js",
      "tests/ai-engine/real-time-quality-gate.test.js",
    ];

    let existCount = 0;

    for (const file of testFiles) {
      const filePath = path.join(process.cwd(), file);
      if (fs.existsSync(filePath)) {
        existCount++;
      }
    }

    console.log(`   ${existCount}/${testFiles.length} 测试文件存在`);

    if (existCount === testFiles.length) {
      console.log("   ✅ 所有测试文件完整");
      return { name: "Test Files", status: "pass" };
    } else {
      console.log("   ⚠️  部分测试文件缺失");
      return { name: "Test Files", status: "warn" };
    }
  }
}

// ============================================================================
// Performance Reporter (性能报告器)
// ============================================================================

class PerformanceReporter {
  constructor() {
    this.configManager = new OptimizationConfigManager();
  }

  async generateReport() {
    console.log("\n" + "=".repeat(70));
    console.log("Workflow Optimizations - Performance Report");
    console.log("=".repeat(70) + "\n");

    const report = {
      timestamp: new Date().toISOString(),
      configuration: this.configManager.getOptimizationStatus(),
      expectedGains: this.calculateExpectedGains(),
    };

    console.log("📊 预期性能提升（基于配置）:\n");

    for (const [metric, gain] of Object.entries(report.expectedGains)) {
      console.log(`  ${metric.padEnd(30)} ${gain}`);
    }

    console.log("\n" + "─".repeat(70));
    console.log("\n💡 提示: 运行基准测试以获取实际性能数据:");
    console.log("   npm run benchmark:workflow\n");

    // 保存报告
    const reportPath = path.join(
      process.cwd(),
      "reports",
      `performance-report-${Date.now()}.json`,
    );
    const reportDir = path.dirname(reportPath);

    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`✅ 报告已保存: ${reportPath}\n`);

    return report;
  }

  calculateExpectedGains() {
    const status = this.configManager.getOptimizationStatus();
    const gains = {};

    // Phase 1
    if (status.phase1.ragParallel) {
      gains["RAG检索速度"] = "-60% (3s→1s)";
    }
    if (status.phase1.messageAggregation) {
      gains["前端渲染性能"] = "+50%";
    }
    if (status.phase1.toolCache) {
      gains["工具调用重复"] = "-15%";
    }
    if (status.phase1.lazyFileTree) {
      gains["大项目加载"] = "-80% (10s→2s)";
    }

    // Phase 2
    if (status.phase2.llmFallback) {
      gains["LLM成功率"] = "+50% (60%→90%)";
    }
    if (status.phase2.dynamicConcurrency) {
      gains["CPU利用率"] = "+40%";
    }
    if (status.phase2.smartRetry) {
      gains["重试成功率"] = "+183% (30%→85%)";
    }
    if (status.phase2.qualityGate) {
      gains["错误拦截"] = "提前发现";
    }

    // Phase 3
    if (status.phase3.planCache) {
      gains["LLM规划成本"] = "-70%";
      gains["缓存命中率"] = "60-85%";
    }
    if (status.phase3.llmDecision) {
      gains["多代理利用率"] = "+20% (70%→90%)";
      gains["决策准确率"] = "+17% (75%→92%)";
    }
    if (status.phase3.agentPool) {
      gains["代理获取速度"] = "10x faster";
      gains["代理创建开销"] = "-85%";
    }
    if (status.phase3.criticalPath) {
      gains["任务执行时间"] = "-15-36%";
    }
    if (status.phase3.realtimeQuality) {
      gains["问题发现速度"] = "1800x faster";
      gains["返工时间"] = "-50%";
    }
    if (status.phase3.autoPhaseTransition) {
      gains["人为错误"] = "-100%";
    }
    if (status.phase3.smartCheckpoint) {
      gains["IO开销"] = "-30%";
    }

    return gains;
  }
}

// ============================================================================
// CLI Commands (命令行接口)
// ============================================================================

class OptimizationCLI {
  constructor() {
    this.configManager = new OptimizationConfigManager();
    this.statusChecker = new OptimizationStatusChecker();
    this.reporter = new PerformanceReporter();
  }

  async run(args) {
    const command = args[0] || "status";

    switch (command) {
      case "status":
        await this.statusChecker.checkAll();
        break;

      case "health":
        await this.statusChecker.checkHealth();
        break;

      case "enable":
        this.enableOptimization(args.slice(1));
        break;

      case "disable":
        this.disableOptimization(args.slice(1));
        break;

      case "enable-all":
        this.enableAll();
        break;

      case "disable-all":
        this.disableAll();
        break;

      case "report":
        await this.reporter.generateReport();
        break;

      case "config":
        this.showConfig();
        break;

      case "export":
        this.exportConfig(args[1]);
        break;

      case "import":
        this.importConfig(args[1]);
        break;

      case "help":
        this.showHelp();
        break;

      default:
        console.error(`❌ Unknown command: ${command}`);
        console.log(
          'Run "node workflow-optimization-manager.js help" for usage\n',
        );
        process.exit(1);
    }
  }

  enableOptimization(names) {
    if (names.length === 0) {
      console.error("❌ Please specify optimization name(s)");
      console.log(
        "Example: node workflow-optimization-manager.js enable phase3.planCache\n",
      );
      return;
    }

    for (const name of names) {
      console.log(`Enabling ${name}...`);
      this.configManager.enableOptimization(name, true);
    }
  }

  disableOptimization(names) {
    if (names.length === 0) {
      console.error("❌ Please specify optimization name(s)");
      console.log(
        "Example: node workflow-optimization-manager.js disable phase3.realtimeQuality\n",
      );
      return;
    }

    for (const name of names) {
      console.log(`Disabling ${name}...`);
      this.configManager.enableOptimization(name, false);
    }
  }

  enableAll() {
    const optimizations = [
      "phase1.ragParallel",
      "phase1.messageAggregation",
      "phase1.toolCache",
      "phase1.lazyFileTree",
      "phase2.llmFallback",
      "phase2.dynamicConcurrency",
      "phase2.smartRetry",
      "phase2.qualityGate",
      "phase3.planCache",
      "phase3.llmDecision",
      "phase3.agentPool",
      "phase3.criticalPath",
      "phase3.realtimeQuality",
      "phase3.autoPhaseTransition",
      "phase3.smartCheckpoint",
    ];

    console.log("Enabling all optimizations...\n");

    for (const opt of optimizations) {
      this.configManager.enableOptimization(opt, true);
    }

    console.log("\n✅ All optimizations enabled!");
    console.log(
      'Run "node workflow-optimization-manager.js status" to verify\n',
    );
  }

  disableAll() {
    const optimizations = [
      "phase1.ragParallel",
      "phase1.messageAggregation",
      "phase1.toolCache",
      "phase1.lazyFileTree",
      "phase2.llmFallback",
      "phase2.dynamicConcurrency",
      "phase2.smartRetry",
      "phase2.qualityGate",
      "phase3.planCache",
      "phase3.llmDecision",
      "phase3.agentPool",
      "phase3.criticalPath",
      "phase3.realtimeQuality",
      "phase3.autoPhaseTransition",
      "phase3.smartCheckpoint",
    ];

    console.log("⚠️  Disabling all optimizations...\n");

    for (const opt of optimizations) {
      this.configManager.enableOptimization(opt, false);
    }

    console.log("\n❌ All optimizations disabled!");
    console.log(
      'Run "node workflow-optimization-manager.js enable-all" to re-enable\n',
    );
  }

  showConfig() {
    console.log("\n" + "=".repeat(70));
    console.log("Current Configuration");
    console.log("=".repeat(70) + "\n");

    console.log(
      JSON.stringify(this.configManager.config.workflow.optimizations, null, 2),
    );

    console.log("\n" + "=".repeat(70));
    console.log(`Config file: ${this.configManager.configPath}\n`);
  }

  exportConfig(filename) {
    const exportPath = filename || `workflow-config-${Date.now()}.json`;

    fs.writeFileSync(
      exportPath,
      JSON.stringify(this.configManager.config, null, 2),
    );

    console.log(`✅ Configuration exported to: ${exportPath}\n`);
  }

  importConfig(filename) {
    if (!filename) {
      console.error("❌ Please specify config file to import");
      console.log(
        "Example: node workflow-optimization-manager.js import my-config.json\n",
      );
      return;
    }

    if (!fs.existsSync(filename)) {
      console.error(`❌ Config file not found: ${filename}\n`);
      return;
    }

    try {
      const data = fs.readFileSync(filename, "utf-8");
      const config = JSON.parse(data);

      this.configManager.config = config;
      this.configManager.saveConfig();

      console.log(`✅ Configuration imported from: ${filename}\n`);
    } catch (error) {
      console.error(`❌ Failed to import config: ${error.message}\n`);
    }
  }

  showHelp() {
    console.log(`
${"=".repeat(70)}
Workflow Optimization Manager - Help
${"=".repeat(70)}

Usage: node workflow-optimization-manager.js [command] [options]

Commands:

  status              查看所有优化的状态
  health              运行健康检查
  report              生成性能报告

  enable <name>       启用指定优化
  disable <name>      禁用指定优化
  enable-all          启用所有优化
  disable-all         禁用所有优化

  config              查看当前配置
  export [file]       导出配置到文件
  import <file>       从文件导入配置

  help                显示此帮助信息

Optimization Names:

  Phase 1:
    phase1.ragParallel
    phase1.messageAggregation
    phase1.toolCache
    phase1.lazyFileTree

  Phase 2:
    phase2.llmFallback
    phase2.dynamicConcurrency
    phase2.smartRetry
    phase2.qualityGate

  Phase 3:
    phase3.planCache
    phase3.llmDecision
    phase3.agentPool
    phase3.criticalPath
    phase3.realtimeQuality
    phase3.autoPhaseTransition
    phase3.smartCheckpoint

Examples:

  # 查看状态
  node workflow-optimization-manager.js status

  # 启用智能缓存
  node workflow-optimization-manager.js enable phase3.planCache

  # 禁用实时质量检查
  node workflow-optimization-manager.js disable phase3.realtimeQuality

  # 启用所有优化
  node workflow-optimization-manager.js enable-all

  # 生成报告
  node workflow-optimization-manager.js report

  # 运行健康检查
  node workflow-optimization-manager.js health

${"=".repeat(70)}
`);
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const cli = new OptimizationCLI();

  try {
    await cli.run(args);
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  OptimizationConfigManager,
  OptimizationStatusChecker,
  PerformanceReporter,
  OptimizationCLI,
};
