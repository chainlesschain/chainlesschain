/**
 * 知识蒸馏模块 - 单元测试
 * 测试复杂度评估、模型路由、质量检查、回退机制
 */

const { KnowledgeDistillation, ComplexityLevel, ModelType } = require('./src/main/ai-engine/knowledge-distillation');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// 测试数据库路径
const TEST_DB_PATH = path.join(__dirname, 'test-knowledge-distillation.db');

// 测试统计
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

/**
 * 断言函数
 */
function assert(condition, testName) {
  totalTests++;
  if (condition) {
    console.log(`✓ ${testName}`);
    passedTests++;
    return true;
  } else {
    console.log(`✗ ${testName}`);
    failedTests++;
    return false;
  }
}

function assertEqual(actual, expected, testName) {
  return assert(actual === expected, `${testName} (期望: ${expected}, 实际: ${actual})`);
}

function assertGreaterThan(actual, threshold, testName) {
  return assert(actual > threshold, `${testName} (实际: ${actual}, 阈值: ${threshold})`);
}

function assertLessThan(actual, threshold, testName) {
  return assert(actual < threshold, `${testName} (实际: ${actual}, 阈值: ${threshold})`);
}

function assertContains(array, item, testName) {
  return assert(array.includes(item), `${testName} (数组不包含: ${item})`);
}

/**
 * 初始化测试数据库
 */
function initTestDatabase() {
  // 删除旧数据库
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }

  const db = new Database(TEST_DB_PATH);

  // 执行P2 Phase 3迁移
  const migrationSQL = fs.readFileSync(
    path.join(__dirname, 'src/main/migrations/004_add_knowledge_distillation_table.sql'),
    'utf-8'
  );

  // 分割并执行SQL语句
  const statements = migrationSQL
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  for (const statement of statements) {
    try {
      db.exec(statement);
    } catch (error) {
      // 忽略视图已存在的错误
      if (!error.message.includes('already exists')) {
        throw error;
      }
    }
  }

  return db;
}

/**
 * Mock LLM Manager
 */
class MockLLMManager {
  async execute(task, options = {}) {
    const model = options.model || 'qwen2:7b';
    const isSmallModel = model.includes('1.5b');

    // 小模型对复杂任务可能失败
    if (isSmallModel && task.intents && task.intents.length > 3) {
      return {
        success: true,
        processedIntents: task.intents.slice(0, 2), // 只处理前2个
        output: 'Partial result from small model',
        confidence: 0.5  // 低置信度
      };
    }

    return {
      success: true,
      processedIntents: task.intents || [],
      output: `Result from ${model}`,
      confidence: isSmallModel ? 0.75 : 0.95
    };
  }
}

/**
 * 测试套件1: 复杂度评估
 */
async function testComplexityEvaluation() {
  console.log('\n========== 测试套件1: 复杂度评估 ==========\n');

  const kd = new KnowledgeDistillation();

  // Test 1.1: 简单任务 - 单个文件操作
  const simpleTask = {
    intents: [
      { type: 'CREATE_FILE', params: { filePath: 'test.txt' } }
    ],
    context: {}
  };

  const simpleComplexity = kd.evaluateComplexity(simpleTask);
  assert(simpleComplexity.level === ComplexityLevel.SIMPLE, '1.1 简单任务应评估为SIMPLE');
  assertLessThan(simpleComplexity.score, 0.3, '1.1 简单任务分数应<0.3');

  // Test 1.2: 中等任务 - 多个Git操作
  const mediumTask = {
    intents: [
      { type: 'GIT_ADD', params: { files: ['.'] } },
      { type: 'GIT_COMMIT', params: { message: 'test' } },
      { type: 'GIT_PUSH', params: { remote: 'origin' } }
    ],
    context: {}
  };

  const mediumComplexity = kd.evaluateComplexity(mediumTask);
  assert(
    mediumComplexity.level === ComplexityLevel.MEDIUM || mediumComplexity.level === ComplexityLevel.SIMPLE,
    '1.2 中等任务应评估为MEDIUM或SIMPLE'
  );
  assertLessThan(mediumComplexity.score, 0.6, '1.2 中等任务分数应<0.6');

  // Test 1.3: 复杂任务 - 代码分析
  const complexTask = {
    intents: [
      { type: 'CODE_ANALYSIS', params: { filePath: 'app.js', depth: 'deep' } },
      { type: 'PERFORMANCE_OPTIMIZATION', params: { target: 'speed' } },
      { type: 'CODE_REFACTOR', params: { pattern: 'observer' } }
    ],
    context: { projectSize: 'large' }
  };

  const complexComplexity = kd.evaluateComplexity(complexTask);
  assert(
    complexComplexity.level === ComplexityLevel.COMPLEX || complexComplexity.level === ComplexityLevel.MEDIUM,
    '1.3 复杂任务应评估为COMPLEX或MEDIUM'
  );
  assertGreaterThan(complexComplexity.score, 0.3, '1.3 复杂任务分数应>0.3');

  // Test 1.4: 特征提取正确性
  const features = kd._extractComplexityFeatures(mediumTask);
  assert(features.intentCount !== undefined, '1.4 应提取intentCount特征');
  assert(features.parameterComplexity !== undefined, '1.4 应提取parameterComplexity特征');
  assert(features.taskType !== undefined, '1.4 应提取taskType特征');
  assert(features.contextSize !== undefined, '1.4 应提取contextSize特征');
}

/**
 * 测试套件2: 模型路由决策
 */
async function testModelRouting() {
  console.log('\n========== 测试套件2: 模型路由决策 ==========\n');

  const kd = new KnowledgeDistillation();

  // Test 2.1: 简单任务路由到小模型
  const simpleComplexity = {
    level: ComplexityLevel.SIMPLE,
    score: 0.2
  };

  const simpleRouting = kd.routeToModel(simpleComplexity);
  assertEqual(simpleRouting.modelType, ModelType.SMALL, '2.1 简单任务应路由到小模型');
  assertEqual(simpleRouting.modelName, 'qwen2:1.5b', '2.1 应使用qwen2:1.5b');
  assertEqual(simpleRouting.reason, 'simple_task', '2.1 原因应为simple_task');

  // Test 2.2: 复杂任务路由到大模型
  const complexComplexity = {
    level: ComplexityLevel.COMPLEX,
    score: 0.8
  };

  const complexRouting = kd.routeToModel(complexComplexity);
  assertEqual(complexRouting.modelType, ModelType.LARGE, '2.2 复杂任务应路由到大模型');
  assertEqual(complexRouting.modelName, 'qwen2:7b', '2.2 应使用qwen2:7b');
  assertEqual(complexRouting.reason, 'complex_task', '2.2 原因应为complex_task');

  // Test 2.3: 中等任务路由到大模型
  const mediumComplexity = {
    level: ComplexityLevel.MEDIUM,
    score: 0.5
  };

  const mediumRouting = kd.routeToModel(mediumComplexity);
  assertEqual(mediumRouting.modelType, ModelType.LARGE, '2.3 中等任务应路由到大模型');
  assertEqual(mediumRouting.reason, 'medium_task', '2.3 原因应为medium_task');

  // Test 2.4: 禁用蒸馏时总是使用大模型
  const kdDisabled = new KnowledgeDistillation({ enableDistillation: false });
  const disabledRouting = kdDisabled.routeToModel(simpleComplexity);
  assertEqual(disabledRouting.modelType, ModelType.LARGE, '2.4 禁用蒸馏应使用大模型');
  assertEqual(disabledRouting.reason, 'distillation_disabled', '2.4 原因应为distillation_disabled');
}

/**
 * 测试套件3: 质量检查
 */
async function testQualityCheck() {
  console.log('\n========== 测试套件3: 质量检查 ==========\n');

  const kd = new KnowledgeDistillation({ qualityThreshold: 0.7 });

  const task = {
    intents: [
      { type: 'CREATE_FILE', params: { filePath: 'test.txt' } },
      { type: 'WRITE_FILE', params: { filePath: 'test.txt', content: 'hello' } }
    ]
  };

  // Test 3.1: 高质量结果
  const goodResult = {
    success: true,
    processedIntents: task.intents,
    output: 'Files created successfully',
    confidence: 0.9
  };

  const goodQuality = kd.checkQuality(goodResult, task);
  assert(goodQuality.isQualified, '3.1 高质量结果应通过检查');
  assertGreaterThan(goodQuality.score, 0.7, '3.1 质量分数应>0.7');
  assertEqual(goodQuality.issues.length, 0, '3.1 应无质量问题');

  // Test 3.2: 低置信度结果
  const lowConfidenceResult = {
    success: true,
    processedIntents: task.intents,
    output: 'Result',
    confidence: 0.5
  };

  const lowConfQuality = kd.checkQuality(lowConfidenceResult, task);
  assertContains(lowConfQuality.issues, 'low_confidence', '3.2 应检测到低置信度问题');

  // Test 3.3: 不完整结果
  const incompleteResult = {
    success: true,
    processedIntents: [task.intents[0]],  // 只处理了第一个意图
    output: 'Partial result'
  };

  const incompleteQuality = kd.checkQuality(incompleteResult, task);
  assertContains(incompleteQuality.issues, 'incomplete_processing', '3.3 应检测到不完整处理');

  // Test 3.4: 空结果
  const emptyResult = {};

  const emptyQuality = kd.checkQuality(emptyResult, task);
  assert(!emptyQuality.isQualified, '3.4 空结果应不合格');
  assertContains(emptyQuality.issues, 'empty_result', '3.4 应检测到空结果');
  assertContains(emptyQuality.issues, 'missing_output', '3.4 应检测到缺失输出');

  // Test 3.5: 错误结果
  const errorResult = {
    error: 'Something went wrong',
    processedIntents: []
  };

  const errorQuality = kd.checkQuality(errorResult, task);
  assertContains(errorQuality.issues, 'contains_error', '3.5 应检测到错误');
}

/**
 * 测试套件4: 完整执行流程(无数据库)
 */
async function testExecutionFlow() {
  console.log('\n========== 测试套件4: 完整执行流程 ==========\n');

  const kd = new KnowledgeDistillation();
  const mockLLM = new MockLLMManager();
  kd.setLLM(mockLLM);

  // Test 4.1: 简单任务使用小模型
  const simpleTask = {
    intents: [
      { type: 'CREATE_FILE', params: { filePath: 'test.txt' } }
    ]
  };

  const simpleResult = await kd.executeWithDistillation(simpleTask, { sessionId: 'test-4.1' });
  assert(simpleResult._distillation.modelUsed === ModelType.SMALL, '4.1 简单任务应使用小模型');
  assert(!simpleResult._distillation.usedFallback, '4.1 不应使用回退');
  assertEqual(kd.stats.smallModelUsage, 1, '4.1 小模型使用计数应为1');

  // Test 4.2: 复杂任务使用大模型
  const complexTask = {
    intents: [
      { type: 'CODE_ANALYSIS', params: { filePath: 'app.js' } },
      { type: 'PERFORMANCE_OPTIMIZATION', params: {} }
    ]
  };

  const complexResult = await kd.executeWithDistillation(complexTask, { sessionId: 'test-4.2' });
  assert(complexResult._distillation.modelUsed === ModelType.LARGE, '4.2 复杂任务应使用大模型');
  assertEqual(kd.stats.largeModelUsage, 1, '4.2 大模型使用计数应为1');

  // Test 4.3: 性能统计正确
  const stats = kd.getPerformanceStats();
  assertEqual(stats.totalRequests, 2, '4.3 总请求数应为2');
  assertEqual(stats.smallModelUsage, 1, '4.3 小模型使用1次');
  assertEqual(stats.largeModelUsage, 1, '4.3 大模型使用1次');
}

/**
 * 测试套件5: 回退机制
 */
async function testFallbackMechanism() {
  console.log('\n========== 测试套件5: 回退机制 ==========\n');

  const kd = new KnowledgeDistillation({
    enableFallback: true,
    qualityThreshold: 0.7
  });
  const mockLLM = new MockLLMManager();
  kd.setLLM(mockLLM);

  // Test 5.1: 小模型结果不合格应回退
  const task = {
    intents: [
      { type: 'CREATE_FILE', params: { filePath: 'f1.txt' } },
      { type: 'CREATE_FILE', params: { filePath: 'f2.txt' } },
      { type: 'CREATE_FILE', params: { filePath: 'f3.txt' } },
      { type: 'CREATE_FILE', params: { filePath: 'f4.txt' } }
    ]
  };

  const result = await kd.executeWithDistillation(task, { sessionId: 'test-5.1' });

  // MockLLM会让小模型对多个意图返回不完整结果
  assert(result._distillation.usedFallback, '5.1 应触发回退机制');
  assertEqual(result._distillation.modelUsed, ModelType.LARGE, '5.1 最终应使用大模型');
  assertGreaterThan(kd.stats.fallbacks, 0, '5.1 回退计数应>0');

  // Test 5.2: 禁用回退时不应回退
  const kdNoFallback = new KnowledgeDistillation({
    enableFallback: false,
    qualityThreshold: 0.7
  });
  kdNoFallback.setLLM(mockLLM);

  const resultNoFallback = await kdNoFallback.executeWithDistillation(task, { sessionId: 'test-5.2' });
  assert(!resultNoFallback._distillation.usedFallback, '5.2 禁用回退时不应回退');
}

/**
 * 测试套件6: 数据库集成
 */
async function testDatabaseIntegration() {
  console.log('\n========== 测试套件6: 数据库集成 ==========\n');

  const db = initTestDatabase();
  const kd = new KnowledgeDistillation();
  kd.setDatabase(db);
  kd.setLLM(new MockLLMManager());

  // Test 6.1: 执行任务应记录到数据库
  const task1 = {
    intents: [{ type: 'CREATE_FILE', params: { filePath: 'test.txt' } }]
  };

  await kd.executeWithDistillation(task1, { sessionId: 'test-6.1' });

  const records = db.prepare('SELECT * FROM knowledge_distillation_history').all();
  assertGreaterThan(records.length, 0, '6.1 应记录到数据库');

  const record = records[0];
  assertEqual(record.task_id, 'test-6.1', '6.1 task_id应正确');
  assertEqual(record.complexity_level, 'simple', '6.1 复杂度应为simple');
  assertEqual(record.planned_model, 'small', '6.1 计划模型应为small');
  assertEqual(record.actual_model, 'small', '6.1 实际模型应为small');
  assertEqual(record.used_fallback, 0, '6.1 未使用回退');

  // Test 6.2: 回退应正确记录
  const task2 = {
    intents: [
      { type: 'CREATE_FILE', params: { filePath: 'f1.txt' } },
      { type: 'CREATE_FILE', params: { filePath: 'f2.txt' } },
      { type: 'CREATE_FILE', params: { filePath: 'f3.txt' } },
      { type: 'CREATE_FILE', params: { filePath: 'f4.txt' } }
    ]
  };

  await kd.executeWithDistillation(task2, { sessionId: 'test-6.2' });

  const fallbackRecord = db.prepare(
    'SELECT * FROM knowledge_distillation_history WHERE task_id = ?'
  ).get('test-6.2');

  assertEqual(fallbackRecord.used_fallback, 1, '6.2 应标记使用了回退');
  assertEqual(fallbackRecord.actual_model, 'large', '6.2 实际模型应为large');

  // Test 6.3: 统计API
  const stats = await kd.getDistillationStats();
  assert(stats.runtime.totalRequests >= 2, '6.3 运行时统计应正确');
  assert(stats.database.totalDistillations >= 2, '6.3 数据库统计应正确');

  db.close();
}

/**
 * 测试套件7: 学习和优化
 */
async function testLearning() {
  console.log('\n========== 测试套件7: 学习和优化 ==========\n');

  const db = initTestDatabase();
  const kd = new KnowledgeDistillation({ enableLearning: true });
  kd.setDatabase(db);
  kd.setLLM(new MockLLMManager());

  // Test 7.1: 初始权重
  const initialWeights = { ...kd.complexityWeights };
  assert(initialWeights.taskType > 0, '7.1 taskType权重应>0');
  assert(initialWeights.intentCount > 0, '7.1 intentCount权重应>0');

  // 执行一些会导致回退的任务
  for (let i = 0; i < 10; i++) {
    await kd.executeWithDistillation({
      intents: [
        { type: 'CREATE_FILE', params: { filePath: `f${i}.txt` } },
        { type: 'CREATE_FILE', params: { filePath: `f${i+1}.txt` } },
        { type: 'CREATE_FILE', params: { filePath: `f${i+2}.txt` } },
        { type: 'CREATE_FILE', params: { filePath: `f${i+3}.txt` } }
      ]
    }, { sessionId: `learn-${i}` });
  }

  // Test 7.2: 从历史中学习
  const learnResult = await kd.learnFromHistory();
  assert(learnResult.success, '7.2 学习应成功');

  // 如果有足够多的回退，权重应该调整
  if (learnResult.adjustments > 0) {
    assert(
      kd.complexityWeights.taskType !== initialWeights.taskType,
      '7.2 权重应被调整'
    );
    console.log(`  ℹ 权重已调整: taskType ${initialWeights.taskType.toFixed(3)} → ${kd.complexityWeights.taskType.toFixed(3)}`);
  }

  db.close();
}

/**
 * 测试套件8: 真实场景
 */
async function testRealScenarios() {
  console.log('\n========== 测试套件8: 真实场景测试 ==========\n');

  const kd = new KnowledgeDistillation();
  kd.setLLM(new MockLLMManager());

  const scenarios = [
    {
      name: 'kd_001 - 简单文件操作',
      task: {
        intents: [{ type: 'CREATE_FILE', params: { filePath: 'readme.md' } }]
      },
      expectedModel: ModelType.SMALL
    },
    {
      name: 'kd_002 - Git提交',
      task: {
        intents: [
          { type: 'GIT_ADD', params: { files: ['.'] } },
          { type: 'GIT_COMMIT', params: { message: 'update' } }
        ]
      },
      expectedModel: ModelType.SMALL
    },
    {
      name: 'kd_003 - 代码生成',
      task: {
        intents: [
          { type: 'CODE_GENERATION', params: { language: 'javascript', spec: 'REST API' } }
        ]
      },
      expectedModel: ModelType.LARGE
    },
    {
      name: 'kd_004 - 复杂分析',
      task: {
        intents: [
          { type: 'CODE_ANALYSIS', params: { filePath: 'app.js' } },
          { type: 'SECURITY_SCAN', params: { target: 'dependencies' } },
          { type: 'PERFORMANCE_OPTIMIZATION', params: {} }
        ]
      },
      expectedModel: ModelType.LARGE
    },
    {
      name: 'kd_005 - 批量图片处理',
      task: {
        intents: [
          { type: 'COMPRESS_IMAGE', params: { filePath: 'img1.jpg' } },
          { type: 'COMPRESS_IMAGE', params: { filePath: 'img2.jpg' } }
        ]
      },
      expectedModel: ModelType.SMALL
    }
  ];

  for (const scenario of scenarios) {
    const result = await kd.executeWithDistillation(scenario.task, {
      sessionId: scenario.name
    });

    assertEqual(
      result._distillation.modelUsed,
      scenario.expectedModel,
      scenario.name
    );
  }
}

/**
 * 主测试入口
 */
async function runAllTests() {
  console.log('\n');
  console.log('================================================');
  console.log('  知识蒸馏模块 - 单元测试');
  console.log('  Knowledge Distillation Module - Unit Tests');
  console.log('================================================');

  try {
    await testComplexityEvaluation();
    await testModelRouting();
    await testQualityCheck();
    await testExecutionFlow();
    await testFallbackMechanism();
    await testDatabaseIntegration();
    await testLearning();
    await testRealScenarios();

    console.log('\n================================================');
    console.log('测试完成');
    console.log('================================================');
    console.log(`总测试数: ${totalTests}`);
    console.log(`通过: ${passedTests} ✓`);
    console.log(`失败: ${failedTests} ✗`);
    console.log(`通过率: ${((passedTests / totalTests) * 100).toFixed(2)}%`);
    console.log('================================================\n');

    // 清理测试数据库
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
      console.log('✓ 测试数据库已清理\n');
    }

    process.exit(failedTests > 0 ? 1 : 0);

  } catch (error) {
    console.error('\n✗ 测试执行失败:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// 运行测试
runAllTests().catch(console.error);
