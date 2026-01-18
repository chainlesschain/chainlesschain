/**
 * 横向关注点验证脚本
 *
 * 测试 ResumableProcessor 和 ProgressEmitter 功能
 *
 * 运行: node test-scripts/cross-cutting-validation.js
 */

const ResumableProcessor = require('../src/main/utils/resumable-processor');
const ProgressEmitter = require('../src/main/utils/progress-emitter');
const path = require('path');
const fs = require('fs').promises;

// ANSI 颜色码
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function header(title) {
  log('\n' + '='.repeat(60), 'cyan');
  log(` ${title}`, 'cyan');
  log('='.repeat(60), 'cyan');
}

function testResult(testName, passed, details = '') {
  if (passed) {
    log(`✅ ${testName}`, 'green');
    if (details) log(`   ${details}`, 'blue');
  } else {
    log(`❌ ${testName}`, 'red');
    if (details) log(`   ${details}`, 'yellow');
  }
}

// 模拟任务处理器
async function mockTaskProcessor(progress, options) {
  const { onProgress, checkpointData } = options;
  const startFrom = checkpointData?.currentStep || 0;

  log(`   开始处理，起始进度: ${startFrom}%`, 'blue');

  for (let i = startFrom; i <= 100; i += 10) {
    await onProgress(i, { step: `处理步骤 ${i}%` });

    // 模拟处理时间
    await new Promise(resolve => setTimeout(resolve, 50));

    // 模拟错误（仅第一次运行）
    if (i === 30 && !checkpointData) {
      throw new Error('模拟错误: 处理在30%时失败');
    }
  }

  return { success: true, message: '处理完成' };
}

// 测试 1: ResumableProcessor 基础功能
async function test1_ResumableProcessorBasics() {
  header('测试 1: ResumableProcessor 基础功能');

  const processor = new ResumableProcessor({
    maxRetries: 3,
    retryDelay: 100,
    checkpointInterval: 10,
  });

  await processor.initialize();

  let progressUpdates = [];
  let checkpointSaves = [];

  processor.on('task-progress', (data) => {
    progressUpdates.push(data.progress);
  });

  processor.on('checkpoint-saved', (data) => {
    checkpointSaves.push(data.progress);
  });

  const taskId = 'test-task-1';

  try {
    const result = await processor.processWithRetry(
      taskId,
      async (progress, options) => {
        const { onProgress } = options;

        for (let i = 0; i <= 100; i += 10) {
          await onProgress(i, { step: i });
          await new Promise(resolve => setTimeout(resolve, 20));
        }

        return { success: true };
      },
      { resumeFromCheckpoint: false }
    );

    testResult(
      '基础处理成功',
      result.success === true,
      `结果: ${JSON.stringify(result)}`
    );

    testResult(
      '进度回调触发',
      progressUpdates.length >= 10,
      `触发次数: ${progressUpdates.length}`
    );

    testResult(
      '检查点保存',
      checkpointSaves.length >= 5,
      `保存次数: ${checkpointSaves.length}, 进度: [${checkpointSaves.join(', ')}]`
    );

  } catch (error) {
    testResult('基础处理成功', false, error.message);
  }

  await processor.terminate();
}

// 测试 2: ResumableProcessor 错误重试
async function test2_ResumableProcessorRetry() {
  header('测试 2: ResumableProcessor 错误重试');

  const processor = new ResumableProcessor({
    maxRetries: 3,
    retryDelay: 100,
    checkpointInterval: 10,
  });

  await processor.initialize();

  let retryCount = 0;

  processor.on('task-retry', (data) => {
    retryCount = data.retries;
    log(`   重试 ${data.retries}/${data.maxRetries}: ${data.error}`, 'yellow');
  });

  const taskId = 'test-task-retry';

  try {
    await processor.processWithRetry(
      taskId,
      mockTaskProcessor,
      { resumeFromCheckpoint: false }
    );

    testResult('错误重试', false, '预期失败，但任务成功了');

  } catch (error) {
    testResult(
      '错误重试机制触发',
      retryCount === 3,
      `重试次数: ${retryCount}/3`
    );

    testResult(
      '最终抛出错误',
      error.message.includes('已重试3次'),
      `错误消息: ${error.message.slice(0, 50)}...`
    );
  }

  await processor.terminate();
}

// 测试 3: ResumableProcessor 断点续传
async function test3_ResumableProcessorCheckpoint() {
  header('测试 3: ResumableProcessor 断点续传');

  const processor = new ResumableProcessor({
    maxRetries: 3,
    retryDelay: 100,
    checkpointInterval: 20,
  });

  await processor.initialize();

  const taskId = 'test-task-resume';

  // 第一次运行：失败并保存检查点
  try {
    await processor.processWithRetry(
      taskId,
      async (progress, options) => {
        const { onProgress } = options;

        for (let i = 0; i <= 100; i += 20) {
          await onProgress(i, { currentStep: i });
          await new Promise(resolve => setTimeout(resolve, 20));

          if (i === 60) {
            throw new Error('模拟中断');
          }
        }

        return { success: true };
      },
      { resumeFromCheckpoint: false }
    );
  } catch (error) {
    log(`   第一次运行失败（预期）: ${error.message}`, 'yellow');
  }

  // 检查检查点是否保存
  const checkpoint = await processor.loadCheckpoint(taskId);
  testResult(
    '检查点保存成功',
    checkpoint !== null && checkpoint.progress >= 40,
    `进度: ${checkpoint?.progress}%`
  );

  // 第二次运行：从检查点恢复
  let resumeTriggered = false;

  processor.on('checkpoint-resume', (data) => {
    resumeTriggered = true;
    log(`   从检查点恢复: ${data.progress}%`, 'blue');
  });

  try {
    await processor.processWithRetry(
      taskId,
      async (progress, options) => {
        const { onProgress, checkpointData } = options;
        const startFrom = checkpointData?.currentStep || 0;

        log(`   恢复处理，起始: ${startFrom}%`, 'blue');

        for (let i = startFrom; i <= 100; i += 20) {
          await onProgress(i, { currentStep: i });
          await new Promise(resolve => setTimeout(resolve, 20));
        }

        return { success: true };
      },
      { resumeFromCheckpoint: true }
    );

    testResult(
      '断点续传触发',
      resumeTriggered,
      '成功从检查点恢复'
    );

    // 检查点应该被删除
    const finalCheckpoint = await processor.loadCheckpoint(taskId);
    testResult(
      '完成后清理检查点',
      finalCheckpoint === null,
      '检查点已删除'
    );

  } catch (error) {
    testResult('断点续传', false, error.message);
  }

  await processor.terminate();
}

// 测试 4: ProgressEmitter 基础功能
async function test4_ProgressEmitterBasics() {
  header('测试 4: ProgressEmitter 基础功能');

  const emitter = new ProgressEmitter({
    autoForwardToIPC: false,
    throttleInterval: 50,
  });

  const events = [];

  emitter.on('progress', (data) => {
    events.push({
      percent: data.percent,
      stage: data.stage,
      message: data.message,
    });
  });

  const tracker = emitter.createTracker('test-task-1', {
    title: '测试任务',
    description: '这是一个测试任务',
    totalSteps: 100,
  });

  testResult(
    '创建追踪器成功',
    tracker !== null && typeof tracker.step === 'function',
    '追踪器包含所需方法'
  );

  tracker.setStage(ProgressEmitter.Stage.PREPARING, '准备中...');
  tracker.setPercent(25, '处理中 25%');
  tracker.step('步骤1', 25);
  tracker.step('步骤2', 25);
  tracker.setPercent(100, '完成');
  tracker.complete({ result: 'success' });

  // 等待事件处理
  await new Promise(resolve => setTimeout(resolve, 100));

  testResult(
    '进度事件触发',
    events.length >= 5,
    `触发事件数: ${events.length}`
  );

  testResult(
    '进度阶段正确',
    events.some(e => e.stage === ProgressEmitter.Stage.PREPARING) &&
    events.some(e => e.stage === ProgressEmitter.Stage.COMPLETED),
    '包含准备和完成阶段'
  );

  const taskInfo = emitter.getTask('test-task-1');
  testResult(
    '任务信息获取',
    taskInfo !== null && taskInfo.percent === 100,
    `最终进度: ${taskInfo?.percent}%`
  );

  emitter.clearAll();
}

// 测试 5: ProgressEmitter 层级进度
async function test5_ProgressEmitterHierarchy() {
  header('测试 5: ProgressEmitter 层级进度');

  const emitter = new ProgressEmitter({
    autoForwardToIPC: false,
    throttleInterval: 50,
    enableHierarchy: true,
  });

  const parentEvents = [];
  emitter.on('progress:parent-task', (data) => {
    parentEvents.push(data.percent);
  });

  // 创建父任务
  const parentTracker = emitter.createTracker('parent-task', {
    title: '父任务',
    totalSteps: 100,
  });

  // 创建子任务
  const child1 = emitter.createTracker('child-1', {
    title: '子任务1',
    totalSteps: 100,
    parentTaskId: 'parent-task',
  });

  const child2 = emitter.createTracker('child-2', {
    title: '子任务2',
    totalSteps: 100,
    parentTaskId: 'parent-task',
  });

  const child3 = emitter.createTracker('child-3', {
    title: '子任务3',
    totalSteps: 100,
    parentTaskId: 'parent-task',
  });

  // 模拟子任务进度
  child1.setPercent(100);
  child1.complete();

  child2.setPercent(50);

  child3.setPercent(0);

  // 等待事件处理
  await new Promise(resolve => setTimeout(resolve, 100));

  const parentTask = emitter.getTask('parent-task');
  const expectedPercent = Math.round((100 + 50 + 0) / 3);

  testResult(
    '父任务进度聚合',
    parentTask.percent === expectedPercent,
    `父任务进度: ${parentTask.percent}%, 预期: ${expectedPercent}%`
  );

  testResult(
    '子任务关联',
    parentTask.childTasks.length === 3,
    `子任务数: ${parentTask.childTasks.length}`
  );

  // 完成所有子任务
  child2.setPercent(100);
  child2.complete();
  child3.setPercent(100);
  child3.complete();

  await new Promise(resolve => setTimeout(resolve, 100));

  const finalParentTask = emitter.getTask('parent-task');
  testResult(
    '所有子任务完成后父任务状态',
    finalParentTask.percent === 100 &&
    finalParentTask.stage === ProgressEmitter.Stage.COMPLETED,
    `父任务进度: ${finalParentTask.percent}%, 阶段: ${finalParentTask.stage}`
  );

  emitter.clearAll();
}

// 测试 6: ProgressEmitter 节流控制
async function test6_ProgressEmitterThrottle() {
  header('测试 6: ProgressEmitter 节流控制');

  const emitter = new ProgressEmitter({
    autoForwardToIPC: false,
    throttleInterval: 100,
  });

  const events = [];
  emitter.on('progress', (data) => {
    events.push(Date.now());
  });

  const tracker = emitter.createTracker('throttle-test', {
    title: '节流测试',
    totalSteps: 100,
  });

  // 快速更新进度（应该被节流）
  for (let i = 0; i <= 100; i += 1) {
    tracker.setPercent(i);
    await new Promise(resolve => setTimeout(resolve, 5));
  }

  // 等待处理
  await new Promise(resolve => setTimeout(resolve, 150));

  // 应该只有少量事件被触发（由于节流）
  testResult(
    '节流控制生效',
    events.length < 50,
    `事件数: ${events.length}/101 (节流后)`
  );

  // 检查事件间隔
  if (events.length >= 2) {
    const intervals = [];
    for (let i = 1; i < events.length; i++) {
      intervals.push(events[i] - events[i - 1]);
    }
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;

    testResult(
      '事件间隔符合节流设置',
      avgInterval >= 90,
      `平均间隔: ${avgInterval.toFixed(0)}ms (设置: 100ms)`
    );
  }

  emitter.clearAll();
}

// 主函数
async function main() {
  log('\n🚀 开始横向关注点功能验证', 'cyan');
  log('测试时间: ' + new Date().toISOString(), 'blue');

  const startTime = Date.now();

  try {
    await test1_ResumableProcessorBasics();
    await test2_ResumableProcessorRetry();
    await test3_ResumableProcessorCheckpoint();
    await test4_ProgressEmitterBasics();
    await test5_ProgressEmitterHierarchy();
    await test6_ProgressEmitterThrottle();

    const duration = Date.now() - startTime;

    header('验证完成');
    log(`总耗时: ${duration}ms`, 'green');
    log('\n✅ 所有测试完成！', 'green');

  } catch (error) {
    log('\n❌ 测试失败:', 'red');
    console.error(error);
    process.exit(1);
  }
}

// 运行测试
main().catch(error => {
  console.error('验证脚本错误:', error);
  process.exit(1);
});
