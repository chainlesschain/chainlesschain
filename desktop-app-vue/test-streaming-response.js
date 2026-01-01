/**
 * 流式响应模块 - 单元测试
 * 测试进度反馈、取消机制、流式结果返回
 */

const {
  StreamingResponse,
  StreamingTask,
  CancellationToken,
  TaskStatus,
  ProgressEventType,
  withStreaming
} = require('./src/main/ai-engine/streaming-response');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// 测试数据库路径
const TEST_DB_PATH = path.join(__dirname, 'test-streaming-response.db');

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

function assertContains(array, item, testName) {
  return assert(array.includes(item), `${testName} (数组不包含: ${item})`);
}

/**
 * 睡眠函数
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

  // 执行迁移
  const migrationSQL = fs.readFileSync(
    path.join(__dirname, 'src/main/migrations/005_add_streaming_response_table.sql'),
    'utf-8'
  );

  const statements = migrationSQL
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  for (const statement of statements) {
    try {
      db.exec(statement);
    } catch (error) {
      if (!error.message.includes('already exists')) {
        throw error;
      }
    }
  }

  return db;
}

/**
 * 测试套件1: 取消令牌
 */
async function testCancellationToken() {
  console.log('\n========== 测试套件1: 取消令牌 ==========\n');

  // Test 1.1: 创建取消令牌
  const token = new CancellationToken();
  assert(!token.isCancelled(), '1.1 初始状态应未取消');
  assertEqual(token.cancelReason, null, '1.1 初始取消原因应为null');

  // Test 1.2: 取消令牌
  token.cancel('Test cancellation');
  assert(token.isCancelled(), '1.2 取消后应为已取消状态');
  assertEqual(token.cancelReason, 'Test cancellation', '1.2 取消原因应正确');

  // Test 1.3: throwIfCancelled
  let errorThrown = false;
  try {
    token.throwIfCancelled();
  } catch (error) {
    errorThrown = true;
    assertEqual(error.code, 'CANCELLED', '1.3 应抛出CANCELLED错误');
  }
  assert(errorThrown, '1.3 应抛出错误');

  // Test 1.4: 取消回调
  const token2 = new CancellationToken();
  let callbackCalled = false;
  let callbackReason = null;

  token2.onCancelled((reason) => {
    callbackCalled = true;
    callbackReason = reason;
  });

  token2.cancel('Callback test');
  assert(callbackCalled, '1.4 取消回调应被调用');
  assertEqual(callbackReason, 'Callback test', '1.4 回调参数应正确');

  // Test 1.5: 已取消令牌立即执行回调
  const token3 = new CancellationToken();
  token3.cancel('Already cancelled');

  let immediateCallback = false;
  token3.onCancelled(() => {
    immediateCallback = true;
  });

  assert(immediateCallback, '1.5 已取消令牌应立即执行回调');
}

/**
 * 测试套件2: 流式任务
 */
async function testStreamingTask() {
  console.log('\n========== 测试套件2: 流式任务 ==========\n');

  // Test 2.1: 创建任务
  const task = new StreamingTask('task-2.1');
  assertEqual(task.status, TaskStatus.PENDING, '2.1 初始状态应为PENDING');
  assertEqual(task.progress, 0, '2.1 初始进度应为0');

  // Test 2.2: 开始任务
  const events = [];
  task.on('event', (event) => events.push(event));

  task.start(10);
  assertEqual(task.status, TaskStatus.RUNNING, '2.2 开始后状态应为RUNNING');
  assertEqual(task.totalSteps, 10, '2.2 总步骤应为10');
  assert(events.length > 0, '2.2 应发送started事件');
  assertEqual(events[0].type, ProgressEventType.STARTED, '2.2 第一个事件应为started');

  // Test 2.3: 更新进度
  task.updateProgress(5, 'Half way');
  assertEqual(task.currentStep, 5, '2.3 当前步骤应为5');
  assertEqual(task.progress, 50, '2.3 进度应为50%');

  // Test 2.4: 里程碑
  task.milestone('Checkpoint', { data: 'test' });
  const milestoneEvent = events.find(e => e.type === ProgressEventType.MILESTONE);
  assert(milestoneEvent !== undefined, '2.4 应发送milestone事件');
  assertEqual(milestoneEvent.data.name, 'Checkpoint', '2.4 里程碑名称应正确');

  // Test 2.5: 部分结果
  task.addResult({ value: 'result1' });
  task.addResult({ value: 'result2' });
  assertEqual(task.results.length, 2, '2.5 应有2个结果');

  // Test 2.6: 完成任务
  task.complete({ final: 'result' });
  assertEqual(task.status, TaskStatus.COMPLETED, '2.6 状态应为COMPLETED');
  assertEqual(task.progress, 100, '2.6 进度应为100');
  assertEqual(task.results.length, 3, '2.6 应包含最终结果');
}

/**
 * 测试套件3: 任务取消
 */
async function testTaskCancellation() {
  console.log('\n========== 测试套件3: 任务取消 ==========\n');

  // Test 3.1: 取消运行中的任务
  const task1 = new StreamingTask('task-3.1');
  const events1 = [];
  task1.on('event', (event) => events1.push(event));

  task1.start(10);
  task1.updateProgress(3);
  task1.cancel('User cancelled');

  assertEqual(task1.status, TaskStatus.CANCELLED, '3.1 状态应为CANCELLED');
  assert(task1.cancellationToken.isCancelled(), '3.1 取消令牌应为已取消');

  const cancelEvent = events1.find(e => e.type === ProgressEventType.CANCELLED);
  assert(cancelEvent !== undefined, '3.1 应发送cancelled事件');
  assertEqual(cancelEvent.data.reason, 'User cancelled', '3.1 取消原因应正确');

  // Test 3.2: 取消后无法继续操作
  let errorThrown = false;
  try {
    task1.updateProgress(5);
  } catch (error) {
    errorThrown = true;
  }
  assert(errorThrown, '3.2 取消后updateProgress应抛出错误');

  // Test 3.3: 取消待处理任务
  const task3 = new StreamingTask('task-3.3');
  task3.cancel('Cancel pending');
  assertEqual(task3.status, TaskStatus.CANCELLED, '3.3 待处理任务可以被取消');
}

/**
 * 测试套件4: 任务失败
 */
async function testTaskFailure() {
  console.log('\n========== 测试套件4: 任务失败 ==========\n');

  // Test 4.1: 任务失败
  const task = new StreamingTask('task-4.1');
  const events = [];
  task.on('event', (event) => events.push(event));

  task.start(10);
  task.updateProgress(3);

  const error = new Error('Something went wrong');
  task.fail(error);

  assertEqual(task.status, TaskStatus.FAILED, '4.1 状态应为FAILED');
  assertEqual(task.error, error, '4.1 应记录错误对象');

  const failEvent = events.find(e => e.type === ProgressEventType.FAILED);
  assert(failEvent !== undefined, '4.1 应发送failed事件');
  assertEqual(failEvent.data.error, 'Something went wrong', '4.1 错误消息应正确');
}

/**
 * 测试套件5: 流式响应管理器
 */
async function testStreamingResponseManager() {
  console.log('\n========== 测试套件5: 流式响应管理器 ==========\n');

  const manager = new StreamingResponse();

  // Test 5.1: 创建任务
  const task1 = manager.createTask('task-5.1');
  assert(task1 !== null, '5.1 应创建任务');
  assertEqual(manager.activeTasks.size, 1, '5.1 活跃任务数应为1');

  // Test 5.2: 获取任务
  const retrieved = manager.getTask('task-5.1');
  assertEqual(retrieved, task1, '5.2 应获取到相同任务');

  // Test 5.3: 不能创建重复taskId的任务
  let duplicateError = false;
  try {
    manager.createTask('task-5.1');
  } catch (error) {
    duplicateError = true;
  }
  assert(duplicateError, '5.3 重复taskId应抛出错误');

  // Test 5.4: 取消任务
  task1.start(5);
  manager.cancelTask('task-5.1', 'Manager cancel');
  assertEqual(task1.status, TaskStatus.CANCELLED, '5.4 任务应被取消');

  // Test 5.5: 清理任务
  manager.cleanupTask('task-5.1');
  assertEqual(manager.activeTasks.size, 0, '5.5 清理后活跃任务数应为0');

  // Test 5.6: 获取活跃任务列表
  const task2 = manager.createTask('task-5.6-a');
  const task3 = manager.createTask('task-5.6-b');
  task2.start(5);
  task3.start(10);

  const activeTasks = manager.getActiveTasks();
  assertEqual(activeTasks.length, 2, '5.6 应有2个活跃任务');

  // Test 5.7: 统计
  task2.complete();
  task3.fail(new Error('Test error'));

  const stats = manager.getStats();
  assertGreaterThan(stats.totalTasks, 0, '5.7 总任务数应>0');
  assertEqual(stats.completedTasks, 1, '5.7 完成任务数应为1');
  assertEqual(stats.failedTasks, 1, '5.7 失败任务数应为1');
}

/**
 * 测试套件6: 并发任务限制
 */
async function testConcurrentTaskLimit() {
  console.log('\n========== 测试套件6: 并发任务限制 ==========\n');

  const manager = new StreamingResponse({ maxConcurrentTasks: 3 });

  // Test 6.1: 创建最大数量任务
  manager.createTask('task-6.1-a');
  manager.createTask('task-6.1-b');
  manager.createTask('task-6.1-c');
  assertEqual(manager.activeTasks.size, 3, '6.1 应有3个活跃任务');

  // Test 6.2: 超过最大数量应失败
  let limitError = false;
  try {
    manager.createTask('task-6.1-d');
  } catch (error) {
    limitError = true;
  }
  assert(limitError, '6.2 超过最大并发数应抛出错误');

  // Test 6.3: 清理后可以创建新任务
  const taskA = manager.getTask('task-6.1-a');
  taskA.start(1);
  taskA.complete();
  manager.cleanupTask('task-6.1-a');
  assertEqual(manager.activeTasks.size, 2, '6.3 清理后应有2个活跃任务');

  const task4 = manager.createTask('task-6.3');
  assert(task4 !== null, '6.3 清理后应可创建新任务');
}

/**
 * 测试套件7: 数据库集成
 */
async function testDatabaseIntegration() {
  console.log('\n========== 测试套件7: 数据库集成 ==========\n');

  const db = initTestDatabase();
  const manager = new StreamingResponse();
  manager.setDatabase(db);

  // Test 7.1: 事件记录到数据库
  const task = manager.createTask('task-7.1');
  task.start(5);
  await sleep(50); // 等待异步写入

  const records = db.prepare('SELECT * FROM streaming_response_events WHERE task_id = ?').all('task-7.1');
  assertGreaterThan(records.length, 0, '7.1 应记录事件到数据库');

  const startedEvent = records.find(r => r.event_type === 'started');
  assert(startedEvent !== undefined, '7.1 应有started事件');

  // Test 7.2: 多个事件记录
  task.updateProgress(3, 'Progress update');
  task.milestone('Milestone 1');
  task.addResult({ data: 'test' });
  task.complete({ final: 'done' });
  await sleep(100);

  const allRecords = db.prepare('SELECT * FROM streaming_response_events WHERE task_id = ?').all('task-7.1');
  assertGreaterThan(allRecords.length, 3, '7.2 应记录多个事件');

  // Test 7.3: 获取任务历史
  const history = await manager.getTaskHistory({ taskId: 'task-7.1' });
  assertGreaterThan(history.length, 0, '7.3 应获取到任务历史');

  // Test 7.4: 统计视图
  const stats = db.prepare('SELECT * FROM v_streaming_response_stats').get();
  assertGreaterThan(stats.total_tasks, 0, '7.4 统计视图应有数据');

  db.close();
}

/**
 * 测试套件8: withStreaming辅助函数
 */
async function testWithStreamingHelper() {
  console.log('\n========== 测试套件8: withStreaming辅助函数 ==========\n');

  const manager = new StreamingResponse();

  // Test 8.1: 成功执行
  const result1 = await withStreaming(
    'task-8.1',
    manager,
    async (task, cancellationToken) => {
      task.updateProgress(1, 'Step 1');
      await sleep(10);
      task.updateProgress(2, 'Step 2');
      return 'success';
    },
    2
  );

  assertEqual(result1, 'success', '8.1 应返回正确结果');

  const task1 = manager.getTask('task-8.1');
  assertEqual(task1.status, TaskStatus.COMPLETED, '8.1 任务应为完成状态');

  // Test 8.2: 任务失败
  let errorCaught = false;
  try {
    await withStreaming(
      'task-8.2',
      manager,
      async (task, cancellationToken) => {
        task.updateProgress(1);
        throw new Error('Test error');
      },
      2
    );
  } catch (error) {
    errorCaught = true;
  }

  assert(errorCaught, '8.2 应捕获错误');
  const task2 = manager.getTask('task-8.2');
  assertEqual(task2.status, TaskStatus.FAILED, '8.2 任务应为失败状态');

  // Test 8.3: 任务取消
  const promise3 = withStreaming(
    'task-8.3',
    manager,
    async (task, cancellationToken) => {
      task.updateProgress(1);
      await sleep(10);
      cancellationToken.throwIfCancelled();
      task.updateProgress(2);
      return 'done';
    },
    2
  );

  await sleep(5);
  manager.cancelTask('task-8.3');

  let cancelErrorCaught = false;
  try {
    await promise3;
  } catch (error) {
    cancelErrorCaught = true;
  }

  assert(cancelErrorCaught, '8.3 应捕获取消错误');
  const task3 = manager.getTask('task-8.3');
  assertEqual(task3.status, TaskStatus.CANCELLED, '8.3 任务应为取消状态');
}

/**
 * 测试套件9: 真实场景
 */
async function testRealScenarios() {
  console.log('\n========== 测试套件9: 真实场景测试 ==========\n');

  const manager = new StreamingResponse();

  // Scenario 1: 文件批量处理
  const scenario1 = await withStreaming(
    'stream_001',
    manager,
    async (task, cancellationToken) => {
      const files = ['file1.txt', 'file2.txt', 'file3.txt', 'file4.txt', 'file5.txt'];
      const results = [];

      for (let i = 0; i < files.length; i++) {
        cancellationToken.throwIfCancelled();

        task.updateProgress(i + 1, `Processing ${files[i]}`);
        await sleep(5);

        const result = { file: files[i], processed: true };
        task.addResult(result);
        results.push(result);

        if (i === 2) {
          task.milestone('Halfway', { processed: i + 1 });
        }
      }

      return { total: files.length, results };
    },
    5
  );

  assertEqual(scenario1.total, 5, 'stream_001 应处理5个文件');
  assertEqual(manager.getTask('stream_001').status, TaskStatus.COMPLETED, 'stream_001 应完成');

  // Scenario 2: 带取消的长时间任务
  const promise2 = withStreaming(
    'stream_002',
    manager,
    async (task, cancellationToken) => {
      for (let i = 1; i <= 100; i++) {
        cancellationToken.throwIfCancelled();
        task.updateProgress(i, `Step ${i}/100`);
        await sleep(2);
      }
      return 'completed';
    },
    100
  );

  await sleep(50);
  manager.cancelTask('stream_002', 'User stopped');

  let cancelled = false;
  try {
    await promise2;
  } catch (error) {
    cancelled = true;
  }

  assert(cancelled, 'stream_002 应被取消');
  assertEqual(manager.getTask('stream_002').status, TaskStatus.CANCELLED, 'stream_002 状态应为取消');

  // Scenario 3: 多阶段数据处理
  const scenario3 = await withStreaming(
    'stream_003',
    manager,
    async (task, cancellationToken) => {
      // 阶段1: 加载数据
      task.milestone('Loading data');
      task.updateProgress(1, 'Loading...');
      await sleep(10);

      // 阶段2: 处理数据
      task.milestone('Processing data');
      task.updateProgress(2, 'Processing...');
      await sleep(10);

      // 阶段3: 保存结果
      task.milestone('Saving results');
      task.updateProgress(3, 'Saving...');
      await sleep(10);

      return { status: 'success', stages: 3 };
    },
    3
  );

  assertEqual(scenario3.stages, 3, 'stream_003 应完成3个阶段');
  const task3 = manager.getTask('stream_003');
  assertGreaterThan(task3.results.length, 0, 'stream_003 应有里程碑记录');
}

/**
 * 主测试入口
 */
async function runAllTests() {
  console.log('\n');
  console.log('================================================');
  console.log('  流式响应模块 - 单元测试');
  console.log('  Streaming Response Module - Unit Tests');
  console.log('================================================');

  try {
    await testCancellationToken();
    await testStreamingTask();
    await testTaskCancellation();
    await testTaskFailure();
    await testStreamingResponseManager();
    await testConcurrentTaskLimit();
    await testDatabaseIntegration();
    await testWithStreamingHelper();
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
