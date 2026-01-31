/**
 * 简单的工作流模块测试脚本
 *
 * 运行方式: node tests/unit/workflow/run-simple-test.js
 */

const assert = require('assert');

// Mock logger
const mockLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

// 注入mock logger
require.cache[require.resolve('../../../src/main/utils/logger.js')] = {
  exports: { logger: mockLogger },
};

console.log('='.repeat(60));
console.log('工作流模块单元测试');
console.log('='.repeat(60));

let passedTests = 0;
let failedTests = 0;

function test(description, fn) {
  try {
    fn();
    console.log(`✅ PASS: ${description}`);
    passedTests++;
  } catch (error) {
    console.log(`❌ FAIL: ${description}`);
    console.log(`   Error: ${error.message}`);
    failedTests++;
  }
}

// 测试 WorkflowStateMachine
console.log('\n📦 测试 WorkflowStateMachine');
console.log('-'.repeat(40));

const {
  WorkflowStateMachine,
  WorkflowState,
  STATE_TRANSITIONS,
} = require('../../../src/main/workflow/workflow-state-machine.js');

test('WorkflowState 应该定义所有状态', () => {
  assert.strictEqual(WorkflowState.IDLE, 'idle');
  assert.strictEqual(WorkflowState.RUNNING, 'running');
  assert.strictEqual(WorkflowState.PAUSED, 'paused');
  assert.strictEqual(WorkflowState.COMPLETED, 'completed');
  assert.strictEqual(WorkflowState.FAILED, 'failed');
  assert.strictEqual(WorkflowState.CANCELLED, 'cancelled');
});

test('构造函数应该初始化为idle状态', () => {
  const sm = new WorkflowStateMachine('test-1');
  assert.strictEqual(sm.getState(), WorkflowState.IDLE);
  assert.strictEqual(sm.workflowId, 'test-1');
});

test('start() 应该将状态从idle转换到running', () => {
  const sm = new WorkflowStateMachine('test-2');
  const result = sm.start();
  assert.strictEqual(result, true);
  assert.strictEqual(sm.getState(), WorkflowState.RUNNING);
});

test('pause() 应该将状态从running转换到paused', () => {
  const sm = new WorkflowStateMachine('test-3');
  sm.start();
  const result = sm.pause();
  assert.strictEqual(result, true);
  assert.strictEqual(sm.getState(), WorkflowState.PAUSED);
});

test('resume() 应该将状态从paused转换回running', () => {
  const sm = new WorkflowStateMachine('test-4');
  sm.start();
  sm.pause();
  const result = sm.resume();
  assert.strictEqual(result, true);
  assert.strictEqual(sm.getState(), WorkflowState.RUNNING);
});

test('complete() 应该将状态从running转换到completed', () => {
  const sm = new WorkflowStateMachine('test-5');
  sm.start();
  const result = sm.complete();
  assert.strictEqual(result, true);
  assert.strictEqual(sm.getState(), WorkflowState.COMPLETED);
});

test('fail() 应该将状态从running转换到failed', () => {
  const sm = new WorkflowStateMachine('test-6');
  sm.start();
  const result = sm.fail('test error');
  assert.strictEqual(result, true);
  assert.strictEqual(sm.getState(), WorkflowState.FAILED);
});

test('retry() 应该将状态从failed转换回running', () => {
  const sm = new WorkflowStateMachine('test-7');
  sm.start();
  sm.fail('error');
  const result = sm.retry();
  assert.strictEqual(result, true);
  assert.strictEqual(sm.getState(), WorkflowState.RUNNING);
});

test('cancel() 应该将状态转换到cancelled', () => {
  const sm = new WorkflowStateMachine('test-8');
  sm.start();
  const result = sm.cancel('user cancelled');
  assert.strictEqual(result, true);
  assert.strictEqual(sm.getState(), WorkflowState.CANCELLED);
});

test('isTerminal() 应该正确识别终态', () => {
  const sm1 = new WorkflowStateMachine('test-9');
  sm1.start();
  sm1.complete();
  assert.strictEqual(sm1.isTerminal(), true);

  const sm2 = new WorkflowStateMachine('test-10');
  sm2.start();
  assert.strictEqual(sm2.isTerminal(), false);
});

test('应该记录状态历史', () => {
  const sm = new WorkflowStateMachine('test-11');
  sm.start();
  sm.pause();
  sm.resume();

  const history = sm.getHistory();
  assert.strictEqual(history.length, 4); // init, start, pause, resume
});

test('toJSON/fromJSON 应该正确序列化和反序列化', () => {
  const sm = new WorkflowStateMachine('test-12');
  sm.start();
  sm.setMetadata('key', 'value');

  const json = sm.toJSON();
  const restored = WorkflowStateMachine.fromJSON(json);

  assert.strictEqual(restored.workflowId, 'test-12');
  assert.strictEqual(restored.getState(), WorkflowState.RUNNING);
  assert.strictEqual(restored.getMetadata('key'), 'value');
});

// 测试 QualityGateManager
console.log('\n📦 测试 QualityGateManager');
console.log('-'.repeat(40));

const {
  QualityGateManager,
  GateStatus,
  DEFAULT_QUALITY_GATES,
} = require('../../../src/main/workflow/quality-gate-manager.js');

test('GateStatus 应该定义所有状态', () => {
  assert.strictEqual(GateStatus.PENDING, 'pending');
  assert.strictEqual(GateStatus.CHECKING, 'checking');
  assert.strictEqual(GateStatus.PASSED, 'passed');
  assert.strictEqual(GateStatus.FAILED, 'failed');
  assert.strictEqual(GateStatus.SKIPPED, 'skipped');
});

test('DEFAULT_QUALITY_GATES 应该包含6个门禁', () => {
  assert.strictEqual(Object.keys(DEFAULT_QUALITY_GATES).length, 6);
});

test('构造函数应该初始化默认门禁', () => {
  const mgr = new QualityGateManager();
  assert.ok(mgr.getGate('gate_1_analysis'));
  assert.ok(mgr.getGate('gate_2_design'));
  assert.ok(mgr.getGate('gate_3_generation'));
});

test('getGateByStage 应该根据阶段ID查找门禁', () => {
  const mgr = new QualityGateManager();
  const gate = mgr.getGateByStage('stage_1');
  assert.strictEqual(gate.id, 'gate_1_analysis');
});

test('registerGate 应该能注册自定义门禁', () => {
  const mgr = new QualityGateManager();
  mgr.registerGate({
    id: 'custom_gate',
    name: 'Custom Gate',
    stageId: 'stage_custom',
    checks: [],
    threshold: 0.5,
    blocking: false,
  });
  assert.ok(mgr.getGate('custom_gate'));
});

test('override 应该能跳过门禁', () => {
  const mgr = new QualityGateManager();
  const result = mgr.override('gate_1_analysis', 'test skip');
  assert.strictEqual(result, true);

  const statuses = mgr.getAllStatuses();
  assert.strictEqual(statuses.gate_1_analysis.status, GateStatus.SKIPPED);
});

test('reset 应该重置所有门禁状态', () => {
  const mgr = new QualityGateManager();
  mgr.override('gate_1_analysis', 'skip');
  mgr.reset();

  const statuses = mgr.getAllStatuses();
  assert.strictEqual(statuses.gate_1_analysis.status, GateStatus.PENDING);
});

// 测试 check 方法 (异步)
async function testCheckMethod() {
  console.log('\n📦 测试 QualityGateManager.check() (异步)');
  console.log('-'.repeat(40));

  const mgr = new QualityGateManager();

  try {
    // 测试对不存在门禁的默认行为
    const result1 = await mgr.check('nonexistent', {});
    assert.strictEqual(result1.passed, true, '不存在的门禁应该默认通过');
    console.log('✅ PASS: 不存在的门禁应该默认通过');
    passedTests++;
  } catch (error) {
    console.log('❌ FAIL: 不存在的门禁应该默认通过');
    console.log(`   Error: ${error.message}`);
    failedTests++;
  }

  try {
    // 测试执行门禁检查
    const result2 = await mgr.check('gate_1_analysis', {
      intent: { confidence: 0.9 },
    }, {
      userRequest: 'test',
      projectContext: {},
    });
    assert.ok(typeof result2.score === 'number', '应该返回分数');
    assert.ok(typeof result2.passed === 'boolean', '应该返回通过状态');
    console.log('✅ PASS: check() 应该执行门禁检查并返回结果');
    passedTests++;
  } catch (error) {
    console.log('❌ FAIL: check() 应该执行门禁检查并返回结果');
    console.log(`   Error: ${error.message}`);
    failedTests++;
  }
}

// 运行异步测试
testCheckMethod().then(() => {
  // 打印结果
  console.log('\n' + '='.repeat(60));
  console.log(`测试结果: ${passedTests} 通过, ${failedTests} 失败`);
  console.log('='.repeat(60));

  // 如果有失败的测试，退出码为1
  if (failedTests > 0) {
    process.exit(1);
  }
}).catch(error => {
  console.error('测试执行错误:', error);
  process.exit(1);
});
