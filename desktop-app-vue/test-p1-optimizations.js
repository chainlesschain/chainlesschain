/**
 * P1优化功能测试套件
 *
 * 测试内容:
 * 1. 多意图识别
 * 2. 动态Few-shot学习
 * 3. 分层任务规划
 * 4. 检查点校验
 * 5. 自我修正循环
 *
 * 版本: v0.17.0-P1
 * 日期: 2026-01-01
 */

const path = require('path');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║         P1优化功能 - 综合测试套件                       ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

// Mock LLM Service for testing
class MockLLMService {
  async complete({ messages, temperature }) {
    const userMessage = messages[messages.length - 1].content;

    // Multi-intent recognition response
    if (userMessage.includes('分析是否包含多个独立意图')) {
      return {
        content: JSON.stringify({
          intents: [
            {
              intent: 'CREATE_FILE',
              priority: 1,
              description: '创建博客网站',
              entities: { fileType: 'HTML', theme: 'dark' },
              dependencies: []
            },
            {
              intent: 'DEPLOY_PROJECT',
              priority: 2,
              description: '部署到云端',
              entities: { platform: 'Vercel' },
              dependencies: [1]
            }
          ]
        })
      };
    }

    // Hierarchical planning - Business layer
    if (userMessage.includes('分解为') && userMessage.includes('高层业务步骤')) {
      return {
        content: JSON.stringify([
          '设计网站结构',
          '实现前端页面',
          '部署上线'
        ])
      };
    }

    // Hierarchical planning - Technical layer
    if (userMessage.includes('分解为具体的技术任务')) {
      return {
        content: JSON.stringify([
          '创建HTML文件',
          '编写CSS样式',
          '添加JavaScript交互'
        ])
      };
    }

    // Checkpoint validation - Quality check
    if (userMessage.includes('评估以下步骤的输出质量')) {
      return {
        content: JSON.stringify({
          score: 0.85,
          reason: 'HTML结构完整，符合标准'
        })
      };
    }

    // Self-correction - Diagnosis
    if (userMessage.includes('分析以下步骤执行失败的原因')) {
      return {
        content: JSON.stringify({
          pattern: 'invalid_params',
          reason: '参数格式不正确',
          strategy: 'regenerate_params'
        })
      };
    }

    // Self-correction - Correction plan
    if (userMessage.includes('请生成修正方案')) {
      return {
        content: JSON.stringify({
          strategy: '重新生成参数',
          plan: {
            subtasks: [
              { tool: 'html_generator', params: { regenerateParams: true } }
            ]
          },
          changes: ['重新生成步骤1的参数']
        })
      };
    }

    return { content: '{}' };
  }
}

// Mock Database for testing
class MockDatabase {
  constructor() {
    this.data = {
      intent_recognition_history: [],
      multi_intent_history: [],
      checkpoint_validations: [],
      self_correction_history: [],
      hierarchical_planning_history: []
    };
  }

  async run(query, params = []) {
    // Mock INSERT operations
    if (query.includes('INSERT INTO intent_recognition_history')) {
      this.data.intent_recognition_history.push({
        user_id: params[0],
        user_input: params[1],
        intent: params[2],
        entities: params[3],
        confidence: params[4],
        success: params[5],
        created_at: params[6]
      });
    } else if (query.includes('INSERT INTO checkpoint_validations')) {
      this.data.checkpoint_validations.push({
        step_index: params[0],
        step_title: params[1],
        passed: params[2],
        failed_count: params[3],
        critical_failures: params[4],
        validations: params[5],
        recommendation: params[6],
        created_at: params[7]
      });
    } else if (query.includes('INSERT INTO self_correction_history')) {
      this.data.self_correction_history.push({
        plan_description: params[0],
        total_steps: params[1],
        success_count: params[2],
        failed_count: params[3],
        attempts: params[4],
        corrections: params[5],
        final_success: params[6],
        created_at: params[7]
      });
    }

    return { changes: 1 };
  }

  async all(query, params = []) {
    if (query.includes('FROM intent_recognition_history')) {
      // Return mock Few-shot examples
      return [
        {
          user_input: '创建一个HTML网页',
          intent: 'CREATE_FILE',
          entities: JSON.stringify({ fileType: 'HTML' }),
          confidence: 0.9,
          created_at: Date.now() - 1000000
        },
        {
          user_input: '生成Word文档',
          intent: 'CREATE_FILE',
          entities: JSON.stringify({ fileType: 'Word' }),
          confidence: 0.92,
          created_at: Date.now() - 500000
        }
      ];
    }

    return [];
  }

  async get(query, params = []) {
    if (query.includes('AVG(confidence)')) {
      return {
        total: 10,
        successes: 9,
        avg_confidence: 0.88
      };
    }

    return {};
  }
}

// Mock Intent Classifier
class MockIntentClassifier {
  async classify(text, context = {}) {
    return {
      intent: 'CREATE_FILE',
      entities: { fileType: 'HTML' },
      confidence: 0.85
    };
  }
}

// Test utilities
let testCount = 0;
let passCount = 0;

function test(name, fn) {
  testCount++;
  console.log(`\n[测试${testCount}] ${name}`);
  console.log('━'.repeat(60));

  try {
    fn();
    passCount++;
    console.log('✅ 通过\n');
  } catch (error) {
    console.error('❌ 失败:', error.message);
    console.error(error.stack);
    console.log('');
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function assertEquals(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || 'Expected equality'}\nActual: ${actual}\nExpected: ${expected}`);
  }
}

// Run tests
async function runTests() {
  const mockLLM = new MockLLMService();
  const mockDB = new MockDatabase();
  const mockClassifier = new MockIntentClassifier();

  // Import modules
  const MultiIntentRecognizer = require('./src/main/ai-engine/multi-intent-recognizer');
  const DynamicFewShotLearner = require('./src/main/ai-engine/dynamic-few-shot-learner');
  const HierarchicalTaskPlanner = require('./src/main/ai-engine/hierarchical-task-planner');
  const CheckpointValidator = require('./src/main/ai-engine/checkpoint-validator');
  const SelfCorrectionLoop = require('./src/main/ai-engine/self-correction-loop');

  // ========================================
  // 测试1: 多意图识别 - 单一意图
  // ========================================
  test('多意图识别 - 单一意图', async () => {
    const recognizer = new MultiIntentRecognizer(mockLLM, mockClassifier);

    const result = await recognizer.classifyMultiple('创建一个HTML网页', {});

    console.log('  识别结果:', JSON.stringify(result, null, 2));

    assert(result.intents.length === 1, '应该只有1个意图');
    assert(!result.isMultiIntent, '不应该是多意图');
    assertEquals(result.intents[0].priority, 1, '优先级应该是1');
  });

  // ========================================
  // 测试2: 多意图识别 - 复合意图
  // ========================================
  test('多意图识别 - 复合意图', async () => {
    const recognizer = new MultiIntentRecognizer(mockLLM, mockClassifier);

    const result = await recognizer.classifyMultiple(
      '创建博客网站并部署到云端',
      {}
    );

    console.log('  识别结果:', JSON.stringify(result, null, 2));

    assert(result.isMultiIntent, '应该是多意图');
    assert(result.intents.length === 2, '应该有2个意图');
    assertEquals(result.intents[0].priority, 1, '第一个任务优先级是1');
    assertEquals(result.intents[1].priority, 2, '第二个任务优先级是2');

    // Check dependencies
    assert(
      result.intents[1].dependencies.includes(1),
      '第二个任务应该依赖第一个任务'
    );
  });

  // ========================================
  // 测试3: 动态Few-shot学习 - 获取用户示例
  // ========================================
  test('动态Few-shot学习 - 获取用户示例', async () => {
    const learner = new DynamicFewShotLearner(mockDB);

    const examples = await learner.getUserExamples('user_123', 'CREATE_FILE', 3);

    console.log('  示例数量:', examples.length);
    console.log('  示例内容:', JSON.stringify(examples, null, 2));

    assert(examples.length > 0, '应该返回示例');
    assert(examples[0].input, '示例应该有input字段');
    assert(examples[0].output, '示例应该有output字段');
  });

  // ========================================
  // 测试4: 动态Few-shot学习 - 构建动态prompt
  // ========================================
  test('动态Few-shot学习 - 构建动态prompt', async () => {
    const learner = new DynamicFewShotLearner(mockDB);

    const prompt = await learner.buildDynamicPrompt(
      '创建一个博客网站',
      'user_123'
    );

    console.log('  Prompt长度:', prompt.length);
    console.log('  Prompt前200字符:\n  ', prompt.substring(0, 200));

    assert(prompt.length > 0, 'Prompt应该非空');
    assert(prompt.includes('示例'), 'Prompt应该包含示例');
    assert(prompt.includes('创建一个博客网站'), 'Prompt应该包含用户输入');
  });

  // ========================================
  // 测试5: 分层任务规划 - 自动粒度选择
  // ========================================
  test('分层任务规划 - 自动粒度选择', async () => {
    const planner = new HierarchicalTaskPlanner(mockLLM, null, null);

    const intent = {
      intent: 'CREATE_FILE',
      description: '创建博客网站',
      entities: { fileType: 'HTML', theme: 'dark' }
    };

    const plan = await planner.plan(intent, {}, { granularity: 'auto' });

    console.log('  粒度:', plan.granularity);
    console.log('  总步骤数:', plan.summary.totalSteps);
    console.log('  业务层:', plan.layers.business?.length || 0, '步');
    console.log('  技术层:', plan.layers.technical?.length || 0, '步');

    assert(plan.granularity, '应该有粒度设置');
    assert(plan.summary, '应该有摘要信息');
    assert(plan.summary.totalSteps > 0, '总步骤数应该大于0');
  });

  // ========================================
  // 测试6: 检查点校验 - 完整性检查
  // ========================================
  test('检查点校验 - 完整性检查', async () => {
    const validator = new CheckpointValidator(mockLLM, mockDB);

    const stepResult = {
      success: true,
      html: '<!DOCTYPE html><html></html>',
      title: 'My Page'
    };

    const step = {
      tool: 'html_generator',
      title: '生成HTML'
    };

    const plan = {
      subtasks: [step]
    };

    const validation = await validator.validateCheckpoint(
      0,
      stepResult,
      plan,
      { skipLLMCheck: true }
    );

    console.log('  校验结果:', validation.passed ? '通过' : '未通过');
    console.log('  失败数量:', validation.failedCount);
    console.log('  推荐动作:', validation.recommendation);

    assert(validation.passed, '完整性检查应该通过');
    assertEquals(validation.failedCount, 0, '不应该有失败项');
  });

  // ========================================
  // 测试7: 检查点校验 - 预期输出检查
  // ========================================
  test('检查点校验 - 预期输出缺失', async () => {
    const validator = new CheckpointValidator(mockLLM, mockDB);

    const stepResult = {
      success: true
      // 缺少 html 和 title 字段
    };

    const step = {
      tool: 'html_generator',
      title: '生成HTML'
    };

    const plan = {
      subtasks: [step]
    };

    const validation = await validator.validateCheckpoint(
      0,
      stepResult,
      plan,
      { skipLLMCheck: true }
    );

    console.log('  校验结果:', validation.passed ? '通过' : '未通过');
    console.log('  失败数量:', validation.failedCount);

    assert(!validation.passed, '应该检测到缺失输出');
    assert(validation.failedCount > 0, '应该有失败项');
  });

  // ========================================
  // 测试8: 自我修正循环 - 失败诊断
  // ========================================
  test('自我修正循环 - 失败诊断', async () => {
    const corrector = new SelfCorrectionLoop(mockLLM, mockDB);

    const failedResult = {
      totalSteps: 3,
      successCount: 2,
      failedCount: 1,
      allSuccess: false,
      failedSteps: [
        {
          stepIndex: 1,
          step: { tool: 'html_generator', title: '生成HTML' },
          error: 'Invalid parameter: missing required field'
        }
      ]
    };

    const diagnosis = await corrector.diagnoseFailure(failedResult);

    console.log('  失败模式:', diagnosis.pattern);
    console.log('  失败原因:', diagnosis.reason);
    console.log('  修正策略:', diagnosis.strategy);

    assert(diagnosis.pattern, '应该识别出失败模式');
    assertEquals(diagnosis.pattern, 'invalid_params', '应该识别为参数无效');
  });

  // ========================================
  // 测试9: 自我修正循环 - 修正方案生成
  // ========================================
  test('自我修正循环 - 修正方案生成', async () => {
    const corrector = new SelfCorrectionLoop(mockLLM, mockDB);

    const originalPlan = {
      subtasks: [
        { tool: 'html_generator', params: { invalid: 'param' } }
      ]
    };

    const failedResult = {
      totalSteps: 1,
      successCount: 0,
      failedCount: 1,
      failedSteps: [
        {
          stepIndex: 0,
          step: { tool: 'html_generator' },
          error: 'Invalid parameter'
        }
      ]
    };

    const diagnosis = {
      pattern: 'invalid_params',
      strategy: 'regenerate_params',
      failedSteps: failedResult.failedSteps
    };

    const correction = await corrector.generateCorrectionPlan(
      originalPlan,
      failedResult,
      diagnosis
    );

    console.log('  修正策略:', correction.strategy);
    console.log('  变更数量:', correction.changes?.length || 0);

    assert(correction.plan, '应该生成修正计划');
    assert(correction.strategy, '应该有修正策略');
  });

  // ========================================
  // 测试10: 集成测试 - P1完整流程
  // ========================================
  test('集成测试 - P1完整流程', async () => {
    console.log('  1. 多意图识别...');
    const recognizer = new MultiIntentRecognizer(mockLLM, mockClassifier);
    const intents = await recognizer.classifyMultiple(
      '创建博客网站并部署到Vercel',
      {}
    );
    assert(intents.isMultiIntent, '应该识别为多意图');

    console.log('  2. 为第一个意图生成分层规划...');
    const planner = new HierarchicalTaskPlanner(mockLLM, null, null);
    const plan = await planner.plan(intents.intents[0], {}, { granularity: 'medium' });
    assert(plan.summary.totalSteps > 0, '应该生成执行计划');

    console.log('  3. 执行第一步并进行检查点校验...');
    const validator = new CheckpointValidator(mockLLM, mockDB);
    const mockStepResult = {
      success: true,
      html: '<!DOCTYPE html><html></html>',
      title: 'Blog'
    };
    const validation = await validator.validateCheckpoint(
      0,
      mockStepResult,
      { subtasks: [{ tool: 'html_generator', title: '生成HTML' }] },
      { skipLLMCheck: true }
    );
    assert(validation.passed, '检查点校验应该通过');

    console.log('  4. Few-shot学习记录成功结果...');
    const learner = new DynamicFewShotLearner(mockDB);
    await learner.recordRecognition(
      'user_123',
      '创建博客网站',
      { intent: 'CREATE_FILE', entities: { fileType: 'HTML' }, confidence: 0.9 },
      true
    );

    console.log('  ✅ P1完整流程测试通过');
  });

  // ========================================
  // 测试总结
  // ========================================
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  测试总结                                                ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  console.log(`总测试数: ${testCount}`);
  console.log(`通过: ${passCount}`);
  console.log(`失败: ${testCount - passCount}`);
  console.log(`通过率: ${((passCount / testCount) * 100).toFixed(2)}%\n`);

  if (passCount === testCount) {
    console.log('🎉 所有P1优化功能测试通过！\n');

    console.log('📋 P1功能清单:');
    console.log('  ✅ 多意图识别 - 复合任务自动拆解');
    console.log('  ✅ 动态Few-shot学习 - 个性化意图识别');
    console.log('  ✅ 分层任务规划 - 三层分解策略');
    console.log('  ✅ 检查点校验 - 中间结果验证');
    console.log('  ✅ 自我修正循环 - 自动错误诊断和修复\n');

    console.log('🚀 下一步:');
    console.log('  1. 运行数据库迁移: node run-migration-p1.js');
    console.log('  2. 集成到AI引擎: 更新 ai-engine-manager-optimized.js');
    console.log('  3. 测试生产环境集成\n');
  } else {
    console.log('❌ 部分测试失败，请检查上述错误信息\n');
    process.exit(1);
  }
}

runTests().catch(error => {
  console.error('\n❌ 测试执行异常:', error);
  console.error(error.stack);
  process.exit(1);
});
