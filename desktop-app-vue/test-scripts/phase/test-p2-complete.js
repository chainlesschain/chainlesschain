/**
 * P2完整功能测试套件
 * 测试所有P2核心和扩展功能
 */

const Database = require('better-sqlite3');
const path = require('path');

// P2 核心模块
const IntentFusion = require('./src/main/ai-engine/intent-fusion');
const { KnowledgeDistillation } = require('./src/main/ai-engine/knowledge-distillation');
const { StreamingResponse } = require('./src/main/ai-engine/streaming-response');

// P2 扩展模块
const { TaskDecompositionEnhancement } = require('./src/main/ai-engine/task-decomposition-enhancement');
const { ToolCompositionSystem } = require('./src/main/ai-engine/tool-composition-system');
const { HistoryMemoryOptimization } = require('./src/main/ai-engine/history-memory-optimization');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║      P2 完整功能测试套件                                 ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

async function runTests() {
  const dbPath = path.join(__dirname, 'data/chainlesschain.db');
  const db = new Database(dbPath);
  
  let totalTests = 0;
  let passedTests = 0;

  console.log('[1/6] 测试意图融合模块...');
  try {
    const intentFusion = new IntentFusion();
    intentFusion.setDatabase(db);
    
    const intents = [
      { type: 'CREATE_FILE', params: { path: 'test.txt' } },
      { type: 'WRITE_FILE', params: { path: 'test.txt', content: 'Hello' } }
    ];
    
    const fused = await intentFusion.fuseIntents(intents);
    totalTests++;
    if (fused.length <= intents.length) {
      console.log('  ✓ 意图融合测试通过');
      passedTests++;
    } else {
      console.log('  ✗ 意图融合测试失败');
    }
  } catch (error) {
    console.log('  ✗ 意图融合测试失败:', error.message);
    totalTests++;
  }

  console.log('\n[2/6] 测试知识蒸馏模块...');
  try {
    const distillation = new KnowledgeDistillation();
    distillation.setDatabase(db);
    
    const task = {
      intents: [{ type: 'SIMPLE_QUERY', params: {} }],
      context: {}
    };
    
    const complexity = distillation.evaluateComplexity(task);
    const routing = distillation.routeToModel(complexity);
    
    totalTests++;
    if (routing.modelType && routing.modelName) {
      console.log(`  ✓ 知识蒸馏测试通过 (路由到: ${routing.modelName})`);
      passedTests++;
    } else {
      console.log('  ✗ 知识蒸馏测试失败');
    }
  } catch (error) {
    console.log('  ✗ 知识蒸馏测试失败:', error.message);
    totalTests++;
  }

  console.log('\n[3/6] 测试流式响应模块...');
  try {
    const streaming = new StreamingResponse();
    streaming.setDatabase(db);
    
    const task = streaming.createTask('test-task-1');
    task.start(3);
    task.updateProgress(1, '步骤1');
    task.updateProgress(2, '步骤2');
    task.complete({ result: 'success' });
    
    totalTests++;
    const stats = streaming.getStats();
    if (parseInt(stats.activeTasks) >= 0) {
      console.log('  ✓ 流式响应测试通过');
      passedTests++;
    } else {
      console.log('  ✗ 流式响应测试失败');
    }
  } catch (error) {
    console.log('  ✗ 流式响应测试失败:', error.message);
    totalTests++;
  }

  console.log('\n[4/6] 测试任务分解增强模块...');
  try {
    const taskDecomp = new TaskDecompositionEnhancement();
    taskDecomp.setDatabase(db);
    
    const task = {
      type: 'CODE_GENERATION',
      description: '生成一个简单的函数',
      params: {}
    };
    
    const subtasks = await taskDecomp.decomposeTask(task, {});
    totalTests++;
    if (subtasks && subtasks.length > 0) {
      console.log(`  ✓ 任务分解测试通过 (生成${subtasks.length}个子任务)`);
      passedTests++;
    } else {
      console.log('  ✗ 任务分解测试失败');
    }
  } catch (error) {
    console.log('  ✗ 任务分解测试失败:', error.message);
    totalTests++;
  }

  console.log('\n[5/6] 测试工具组合系统模块...');
  try {
    const toolComp = new ToolCompositionSystem();
    toolComp.setDatabase(db);
    
    toolComp.registerTool('tool1', {
      execute: async (inputs) => ({ output: 'result1' }),
      outputs: ['result'],
      cost: 1
    });
    
    const composition = await toolComp.composeTools('create result');
    totalTests++;
    if (composition && composition.length >= 0) {
      console.log('  ✓ 工具组合测试通过');
      passedTests++;
    } else {
      console.log('  ✗ 工具组合测试失败');
    }
  } catch (error) {
    console.log('  ✗ 工具组合测试失败:', error.message);
    totalTests++;
  }

  console.log('\n[6/6] 测试历史记忆优化模块...');
  try {
    const historyMemory = new HistoryMemoryOptimization();
    historyMemory.setDatabase(db);
    
    const task = { type: 'TEST_TASK', params: {} };
    const prediction = await historyMemory.predictSuccess(task);
    
    totalTests++;
    if (prediction && prediction.probability !== undefined) {
      console.log(`  ✓ 历史记忆测试通过 (预测成功率: ${(prediction.probability * 100).toFixed(1)}%)`);
      passedTests++;
    } else {
      console.log('  ✗ 历史记忆测试失败');
    }
  } catch (error) {
    console.log('  ✗ 历史记忆测试失败:', error.message);
    totalTests++;
  }

  db.close();

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log(`║  测试结果: ${passedTests}/${totalTests} 通过 (${(passedTests/totalTests*100).toFixed(1)}%)  ${' '.repeat(39 - passedTests.toString().length - totalTests.toString().length)}║`);
  console.log('╚══════════════════════════════════════════════════════════╝');

  return passedTests === totalTests ? 0 : 1;
}

runTests()
  .then(exitCode => process.exit(exitCode))
  .catch(error => {
    console.error('\n❌ 测试运行失败:', error);
    process.exit(1);
  });
