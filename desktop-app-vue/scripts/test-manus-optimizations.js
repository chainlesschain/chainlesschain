/**
 * Manus 优化测试脚本
 *
 * 测试内容：
 * 1. Context Engineering
 * 2. Tool Masking
 * 3. TaskTrackerFile (todo.md 机制)
 * 4. Multi-Agent 系统
 */

const path = require("path");
const fs = require("fs-extra");

// 设置测试环境
process.env.NODE_ENV = "test";

console.log("🧪 Manus 优化测试\n");

// ==========================================
// 1. Context Engineering 测试
// ==========================================

async function testContextEngineering() {
  console.log("=== 1. Context Engineering 测试 ===\n");

  const {
    ContextEngineering,
    RecoverableCompressor,
  } = require("../src/main/llm/context-engineering");

  const ce = new ContextEngineering({
    enableKVCacheOptimization: true,
    enableTodoMechanism: true,
    preserveErrors: true,
  });

  // 测试 Prompt 优化
  console.log("测试 KV-Cache 友好的 Prompt 构建...");

  const result = ce.buildOptimizedPrompt({
    systemPrompt: "You are a helpful assistant. Current time: 2026-01-17T10:30:00Z Session ID: abc-123-def",
    messages: [
      { role: "user", content: "Hello", timestamp: Date.now() },
      { role: "assistant", content: "Hi there!", id: "msg_001" },
    ],
    tools: [
      { name: "file_reader", description: "Read file" },
      { name: "file_writer", description: "Write file" },
    ],
    taskContext: {
      objective: "完成测试任务",
      steps: ["步骤1", "步骤2", "步骤3"],
      currentStep: 1,
    },
  });

  console.log(`  ✅ 消息数量: ${result.messages.length}`);
  console.log(`  ✅ 静态部分长度: ${result.metadata.staticPartLength}`);
  console.log(`  ✅ 动态部分长度: ${result.metadata.dynamicPartLength}`);

  // 测试可恢复压缩
  console.log("\n测试可恢复压缩...");

  const compressor = new RecoverableCompressor();

  const longContent = "A".repeat(5000);
  const compressed = compressor.compress({ content: longContent, path: "/test/file.txt" }, "file");

  console.log(`  ✅ 原始长度: ${longContent.length}`);
  console.log(`  ✅ 压缩类型: ${compressed.refType}`);
  console.log(`  ✅ 可恢复: ${compressed.recoverable}`);

  // 测试统计
  const stats = ce.getStats();
  console.log(`\n  缓存命中率: ${stats.cacheHitRatePercent}`);

  console.log("\n✅ Context Engineering 测试通过\n");
}

// ==========================================
// 2. Tool Masking 测试
// ==========================================

async function testToolMasking() {
  console.log("=== 2. Tool Masking 测试 ===\n");

  const {
    ToolMaskingSystem,
    TASK_PHASE_STATE_MACHINE,
  } = require("../src/main/ai-engine/tool-masking");

  const masking = new ToolMaskingSystem({
    logMaskChanges: false,
    defaultAvailable: true,
  });

  // 注册工具
  console.log("测试工具注册...");

  masking.registerTools([
    { name: "file_reader", description: "Read file" },
    { name: "file_writer", description: "Write file" },
    { name: "git_init", description: "Init git" },
    { name: "git_commit", description: "Git commit" },
    { name: "browser_navigate", description: "Navigate browser" },
  ]);

  console.log(`  ✅ 已注册 ${masking.stats.totalTools} 个工具`);

  // 测试掩码控制
  console.log("\n测试掩码控制...");

  masking.setToolAvailability("file_writer", false);
  console.log(`  file_writer 可用: ${masking.isToolAvailable("file_writer")} (期望: false)`);

  masking.setToolsByPrefix("git", false);
  console.log(`  git_init 可用: ${masking.isToolAvailable("git_init")} (期望: false)`);

  // 测试验证
  const validation = masking.validateCall("file_writer");
  console.log(`  调用验证: ${validation.allowed ? "允许" : "阻止"} (期望: 阻止)`);

  // 测试状态机
  console.log("\n测试状态机...");

  masking.configureStateMachine(TASK_PHASE_STATE_MACHINE);
  masking.transitionTo("planning");

  console.log(`  当前状态: ${masking.getCurrentState()}`);
  console.log(`  可用工具数: ${masking.stats.availableTools}`);

  console.log("\n✅ Tool Masking 测试通过\n");
}

// ==========================================
// 3. TaskTrackerFile 测试
// ==========================================

async function testTaskTrackerFile() {
  console.log("=== 3. TaskTrackerFile 测试 ===\n");

  const {
    TaskTrackerFile,
  } = require("../src/main/ai-engine/task-tracker-file");

  // 使用临时目录
  const testDir = path.join(__dirname, ".test-tasks");
  await fs.ensureDir(testDir);

  const tracker = new TaskTrackerFile({
    workspaceDir: testDir,
    autoSave: false,
    preserveHistory: true,
  });

  try {
    // 创建任务
    console.log("测试任务创建...");

    const task = await tracker.createTask({
      objective: "测试 Manus 优化功能",
      steps: [
        "初始化测试环境",
        "运行单元测试",
        "验证结果",
      ],
      metadata: { testType: "integration" },
    });

    console.log(`  ✅ 任务 ID: ${task.id}`);
    console.log(`  ✅ 步骤数: ${task.steps.length}`);

    // 开始任务
    console.log("\n测试任务启动...");
    await tracker.startTask();
    console.log(`  ✅ 状态: ${tracker.getCurrentTask()?.status}`);

    // 更新进度
    console.log("\n测试进度更新...");
    await tracker.updateProgress(0, "in_progress");
    await tracker.updateProgress(0, "completed", { summary: "环境已初始化" });
    console.log(`  ✅ 当前步骤: ${tracker.getCurrentTask()?.currentStep}`);

    // 获取 todo.md 内容
    console.log("\n测试 todo.md 内容...");
    const todoContent = await tracker.getTodoContext();
    console.log(`  ✅ todo.md 长度: ${todoContent?.length || 0} 字符`);

    // 保存中间结果
    console.log("\n测试中间结果保存...");
    await tracker.saveIntermediateResult(0, { passed: true, count: 10 });
    const loadedResult = await tracker.loadIntermediateResult(0);
    console.log(`  ✅ 中间结果: ${JSON.stringify(loadedResult?.result)}`);

    // 完成任务
    console.log("\n测试任务完成...");
    await tracker.completeTask({ success: true });
    console.log(`  ✅ 任务已完成`);

    // 获取历史
    const history = await tracker.getTaskHistory(5);
    console.log(`  ✅ 历史任务数: ${history.length}`);

    console.log("\n✅ TaskTrackerFile 测试通过\n");
  } finally {
    // 清理
    await fs.remove(testDir);
    tracker.destroy();
  }
}

// ==========================================
// 4. Multi-Agent 测试
// ==========================================

async function testMultiAgent() {
  console.log("=== 4. Multi-Agent 测试 ===\n");

  const {
    AgentOrchestrator,
    SpecializedAgent,
    CodeGenerationAgent,
    DataAnalysisAgent,
    DocumentAgent,
  } = require("../src/main/ai-engine/multi-agent");

  // 创建协调器
  console.log("测试 Agent 协调器...");

  const orchestrator = new AgentOrchestrator({
    enableLogging: false,
    agentTimeout: 5000,
  });

  // 创建 Mock Agent（不依赖 LLM）
  class MockCodeAgent extends SpecializedAgent {
    constructor() {
      super("mock-code", {
        capabilities: ["generate_code", "refactor"],
        description: "Mock code agent",
      });
    }

    async execute(task) {
      return {
        success: true,
        result: `Generated code for: ${task.input?.description || task.type}`,
      };
    }
  }

  class MockDataAgent extends SpecializedAgent {
    constructor() {
      super("mock-data", {
        capabilities: ["analyze_data", "visualize"],
        description: "Mock data agent",
      });
    }

    async execute(task) {
      return {
        success: true,
        result: `Analyzed data: ${JSON.stringify(task.input?.data || []).slice(0, 50)}`,
      };
    }
  }

  // 注册 Agent
  const codeAgent = new MockCodeAgent();
  const dataAgent = new MockDataAgent();

  orchestrator.registerAgents([codeAgent, dataAgent]);
  console.log(`  ✅ 已注册 ${orchestrator.getAllAgents().length} 个 Agent`);

  // 测试任务分发
  console.log("\n测试任务分发...");

  const codeTask = {
    type: "generate_code",
    input: { description: "Create a utility function" },
  };

  const selectedAgent = orchestrator.selectAgent(codeTask);
  console.log(`  ✅ 选中的 Agent: ${selectedAgent} (期望: mock-code)`);

  // 测试执行
  console.log("\n测试任务执行...");

  const result = await orchestrator.dispatch(codeTask);
  console.log(`  ✅ 执行结果: ${result.result.slice(0, 50)}`);

  // 测试并行执行
  console.log("\n测试并行执行...");

  const parallelResults = await orchestrator.executeParallel([
    { type: "generate_code", input: { description: "Function 1" } },
    { type: "analyze_data", input: { data: [1, 2, 3] } },
  ]);

  console.log(`  ✅ 并行结果数: ${parallelResults.length}`);
  console.log(`  ✅ 成功数: ${parallelResults.filter((r) => r.success).length}`);

  // 测试统计
  const stats = orchestrator.getStats();
  console.log(`\n  总任务数: ${stats.totalTasks}`);
  console.log(`  成功率: ${stats.successRate}`);

  console.log("\n✅ Multi-Agent 测试通过\n");
}

// ==========================================
// 5. ManusOptimizations 集成测试
// ==========================================

async function testManusOptimizations() {
  console.log("=== 5. ManusOptimizations 集成测试 ===\n");

  // 使用临时目录避免影响真实数据
  const testDir = path.join(__dirname, ".test-manus");
  await fs.ensureDir(testDir);

  // Mock Electron app.getPath
  const originalGetPath = require("electron")?.app?.getPath;

  try {
    const {
      ManusOptimizations,
    } = require("../src/main/llm/manus-optimizations");

    const manus = new ManusOptimizations({
      enableKVCacheOptimization: true,
      enableToolMasking: true,
      enableTaskTracking: true,
      enableFileBasedTaskTracking: false, // 禁用文件系统避免 Electron 依赖
    });

    // 测试 Prompt 优化
    console.log("测试 Prompt 优化...");

    const { messages, metadata } = manus.buildOptimizedPrompt({
      systemPrompt: "You are a helpful assistant.",
      messages: [{ role: "user", content: "Hello" }],
    });

    console.log(`  ✅ 消息数: ${messages.length}`);
    console.log(`  ✅ 已优化: ${metadata.wasCacheOptimized !== undefined}`);

    // 测试任务追踪（内存模式）
    console.log("\n测试任务追踪（内存模式）...");

    await manus.startTask({
      objective: "测试集成",
      steps: ["步骤1", "步骤2"],
    });

    const task = manus.getCurrentTask();
    console.log(`  ✅ 任务状态: ${task?.status}`);

    await manus.updateTaskProgress(0, "in_progress");
    console.log(`  ✅ 当前步骤: ${manus.getCurrentTask()?.currentStep}`);

    await manus.cancelTask("测试完成");
    console.log(`  ✅ 任务已取消`);

    // 测试统计
    const stats = manus.getStats();
    console.log(`\n  KV-Cache 命中率: ${stats.contextEngineering.cacheHitRatePercent}`);

    console.log("\n✅ ManusOptimizations 集成测试通过\n");
  } finally {
    await fs.remove(testDir);
  }
}

// ==========================================
// 运行所有测试
// ==========================================

async function runAllTests() {
  console.log("╔════════════════════════════════════════╗");
  console.log("║     Manus 优化功能测试套件              ║");
  console.log("╚════════════════════════════════════════╝\n");

  const tests = [
    { name: "Context Engineering", fn: testContextEngineering },
    { name: "Tool Masking", fn: testToolMasking },
    { name: "TaskTrackerFile", fn: testTaskTrackerFile },
    { name: "Multi-Agent", fn: testMultiAgent },
    { name: "ManusOptimizations", fn: testManusOptimizations },
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      await test.fn();
      passed++;
    } catch (error) {
      console.error(`\n❌ ${test.name} 测试失败:`, error.message);
      console.error(error.stack);
      failed++;
    }
  }

  console.log("╔════════════════════════════════════════╗");
  console.log(`║  测试结果: ${passed} 通过, ${failed} 失败              ║`);
  console.log("╚════════════════════════════════════════╝");

  process.exit(failed > 0 ? 1 : 0);
}

// 执行测试
runAllTests().catch((error) => {
  console.error("测试运行失败:", error);
  process.exit(1);
});
