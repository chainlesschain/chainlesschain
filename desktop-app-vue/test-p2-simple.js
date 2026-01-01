/**
 * P2 简化测试
 */

const Database = require('better-sqlite3');
const path = require('path');

console.log('=== P2 功能测试 ===\n');

async function runTests() {
  const dbPath = path.join(__dirname, 'data/chainlesschain.db');
  const db = new Database(dbPath);
  
  let totalTests = 0;
  let passedTests = 0;

  // Test 1: Intent Fusion
  console.log('[1/6] 测试意图融合...');
  try {
    const IntentFusion = require('./src/main/ai-engine/intent-fusion');
    const intentFusion = new IntentFusion();
    intentFusion.setDatabase(db);
    
    const intents = [
      { type: 'CREATE_FILE', params: { path: 'test.txt' } },
      { type: 'WRITE_FILE', params: { path: 'test.txt', content: 'Hello' } }
    ];
    
    const fused = await intentFusion.fuseIntents(intents);
    totalTests++;
    if (fused && fused.length <= intents.length) {
      console.log('  ✓ 意图融合测试通过');
      passedTests++;
    } else {
      console.log('  ✗ 意图融合测试失败');
    }
  } catch (error) {
    console.log('  ✗ 意图融合测试失败:', error.message);
    totalTests++;
  }

  // Test 2: Knowledge Distillation
  console.log('\n[2/6] 测试知识蒸馏...');
  try {
    const { KnowledgeDistillation } = require('./src/main/ai-engine/knowledge-distillation');
    const distillation = new KnowledgeDistillation();
    distillation.setDatabase(db);
    
    const task = { intents: [{ type: 'SIMPLE_QUERY', params: {} }], context: {} };
    const complexity = distillation.evaluateComplexity(task);
    const routing = distillation.routeToModel(complexity);
    
    totalTests++;
    if (routing.modelType && routing.modelName) {
      console.log('  ✓ 知识蒸馏测试通过 (模型: ' + routing.modelName + ')');
      passedTests++;
    } else {
      console.log('  ✗ 知识蒸馏测试失败');
    }
  } catch (error) {
    console.log('  ✗ 知识蒸馏测试失败:', error.message);
    totalTests++;
  }

  // Test 3: Streaming Response
  console.log('\n[3/6] 测试流式响应...');
  try {
    const { StreamingResponse } = require('./src/main/ai-engine/streaming-response');
    const streaming = new StreamingResponse();
    streaming.setDatabase(db);
    
    const task = streaming.createTask('test-task-1');
    task.start(3);
    task.complete({ result: 'success' });
    
    totalTests++;
    const stats = streaming.getStats();
    console.log('  ✓ 流式响应测试通过');
    passedTests++;
  } catch (error) {
    console.log('  ✗ 流式响应测试失败:', error.message);
    totalTests++;
  }

  // Test 4: Task Decomposition
  console.log('\n[4/6] 测试任务分解...');
  try {
    const { TaskDecompositionEnhancement } = require('./src/main/ai-engine/task-decomposition-enhancement');
    const taskDecomp = new TaskDecompositionEnhancement();
    taskDecomp.setDatabase(db);
    
    const task = { type: 'CODE_GENERATION', description: '生成函数', params: {} };
    const subtasks = await taskDecomp.decomposeTask(task, {});
    
    totalTests++;
    if (subtasks && subtasks.length > 0) {
      console.log('  ✓ 任务分解测试通过 (子任务数: ' + subtasks.length + ')');
      passedTests++;
    } else {
      console.log('  ✗ 任务分解测试失败');
    }
  } catch (error) {
    console.log('  ✗ 任务分解测试失败:', error.message);
    totalTests++;
  }

  // Test 5: Tool Composition
  console.log('\n[5/6] 测试工具组合...');
  try {
    const { ToolCompositionSystem } = require('./src/main/ai-engine/tool-composition-system');
    const toolComp = new ToolCompositionSystem();
    toolComp.setDatabase(db);
    
    toolComp.registerTool('tool1', {
      execute: async (inputs) => ({ output: 'result1' }),
      outputs: ['result'],
      cost: 1
    });
    
    const composition = await toolComp.composeTools('create result');
    totalTests++;
    console.log('  ✓ 工具组合测试通过');
    passedTests++;
  } catch (error) {
    console.log('  ✗ 工具组合测试失败:', error.message);
    totalTests++;
  }

  // Test 6: History Memory
  console.log('\n[6/6] 测试历史记忆...');
  try {
    const { HistoryMemoryOptimization } = require('./src/main/ai-engine/history-memory-optimization');
    const historyMemory = new HistoryMemoryOptimization();
    historyMemory.setDatabase(db);
    
    const task = { type: 'TEST_TASK', params: {} };
    const prediction = await historyMemory.predictSuccess(task);
    
    totalTests++;
    console.log('  ✓ 历史记忆测试通过 (预测: ' + (prediction.probability * 100).toFixed(1) + '%)');
    passedTests++;
  } catch (error) {
    console.log('  ✗ 历史记忆测试失败:', error.message);
    totalTests++;
  }

  db.close();

  console.log('\n=================================');
  console.log('测试结果: ' + passedTests + '/' + totalTests + ' 通过 (' + (passedTests/totalTests*100).toFixed(1) + '%)');
  console.log('=================================');

  return passedTests === totalTests ? 0 : 1;
}

runTests()
  .then(exitCode => process.exit(exitCode))
  .catch(error => {
    console.error('\n❌ 测试失败:', error);
    process.exit(1);
  });
