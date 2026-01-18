/**
 * 手动同步功能验证脚本
 * 用于快速验证所有修复功能是否正常工作
 */

const FieldMapper = require("../src/main/sync/field-mapper");
const RetryPolicy = require("../src/main/sync/retry-policy");
const SyncQueue = require("../src/main/sync/sync-queue");

console.log("\n🧪 开始同步功能验证...\n");

let passCount = 0;
let failCount = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`✅ ${testName}`);
    passCount++;
  } else {
    console.log(`❌ ${testName}`);
    failCount++;
  }
}

// ==================== 测试1: FieldMapper ====================
console.log("📋 测试1: FieldMapper字段映射");

const mapper = new FieldMapper();

// 测试时间戳转换
const timestamp = 1703596800000;
const iso = mapper.toISO8601(timestamp);
// ISO 8601转换是UTC时间，不受时区影响
const expectedISO = new Date(timestamp).toISOString();
assert(iso === expectedISO, `时间戳转换为ISO 8601 (${iso} === ${expectedISO})`);
assert(mapper.toMillis(iso) === timestamp, "ISO 8601转换为时间戳");

// 测试toLocal默认行为
const backendRecord = {
  id: "test-123",
  userId: "user-456",
  name: "Test Project",
  createdAt: "2023-12-26T08:00:00.000Z",
  updatedAt: "2023-12-26T08:05:00.000Z",
};

const localRecord = mapper.toLocal(backendRecord, "projects");
assert(
  localRecord.sync_status === "synced",
  "toLocal默认设置sync_status为synced",
);
assert(
  localRecord.user_id === "user-456",
  "字段名转换（camelCase -> snake_case）",
);

// 测试保留本地状态
const existingRecord = {
  id: "test-123",
  sync_status: "pending",
  synced_at: 1703596700000,
};

const preservedRecord = mapper.toLocal(backendRecord, "projects", {
  existingRecord,
  preserveLocalStatus: true,
});
assert(
  preservedRecord.sync_status === "pending",
  "preserveLocalStatus保留本地sync_status",
);
assert(
  preservedRecord.synced_at === 1703596700000,
  "preserveLocalStatus保留本地synced_at",
);

// 测试强制设置状态
const conflictRecord = mapper.toLocal(backendRecord, "projects", {
  existingRecord,
  preserveLocalStatus: true,
  forceSyncStatus: "conflict",
});
assert(conflictRecord.sync_status === "conflict", "forceSyncStatus优先级最高");

// 测试便捷方法
const newRecord = mapper.toLocalAsNew(backendRecord, "projects");
assert(newRecord.sync_status === "synced", "toLocalAsNew标记为synced");

const updateRecord = mapper.toLocalForUpdate(
  backendRecord,
  "projects",
  existingRecord,
);
assert(updateRecord.sync_status === "pending", "toLocalForUpdate保留本地状态");

console.log("");

// ==================== 测试2: RetryPolicy ====================
console.log("📋 测试2: RetryPolicy重试策略");

const retryPolicy = new RetryPolicy(3, 100, 5000, 0.3);

// 测试延迟计算
const delay0 = retryPolicy._calculateDelay(0);
assert(delay0 >= 70 && delay0 <= 130, "第1次重试延迟（100ms ± 30%）");

const delay1 = retryPolicy._calculateDelay(1);
assert(delay1 >= 140 && delay1 <= 260, "第2次重试延迟（200ms ± 30%）");

const delay2 = retryPolicy._calculateDelay(2);
assert(delay2 >= 280 && delay2 <= 520, "第3次重试延迟（400ms ± 30%）");

// 测试成功场景
(async () => {
  let callCount = 0;
  const task = async () => {
    callCount++;
    return "success";
  };

  const result = await retryPolicy.executeWithRetry(task, "测试任务");
  assert(result === "success" && callCount === 1, "成功任务不重试");
})();

// 测试重试场景
(async () => {
  let callCount = 0;
  const task = async () => {
    callCount++;
    if (callCount < 3) {
      throw new Error("Temporary failure");
    }
    return "success after retry";
  };

  const result = await retryPolicy.executeWithRetry(task, "测试重试");
  assert(
    result === "success after retry" && callCount === 3,
    "失败任务自动重试",
  );
})();

console.log("");

// ==================== 测试3: SyncQueue ====================
console.log("📋 测试3: SyncQueue并发队列");

const syncQueue = new SyncQueue(3);

// 测试基本功能
(async () => {
  const task = async () => "result";
  const result = await syncQueue.enqueue(task);
  assert(result === "result", "SyncQueue能够执行任务");
})();

// 测试并发控制
(async () => {
  let activeCount = 0;
  let maxActiveCount = 0;

  const createTask = () => async () => {
    activeCount++;
    maxActiveCount = Math.max(maxActiveCount, activeCount);
    await new Promise((resolve) => setTimeout(resolve, 50));
    activeCount--;
    return "done";
  };

  const tasks = Array.from({ length: 10 }, () =>
    syncQueue.enqueue(createTask()),
  );
  await Promise.all(tasks);

  assert(maxActiveCount <= 3, `并发数限制（最大${maxActiveCount}，应≤3）`);
  assert(activeCount === 0, "所有任务完成后活跃数归零");
})();

// 测试优先级
(async () => {
  // 创建新的队列用于优先级测试
  const priorityQueue = new SyncQueue(2); // 并发数2，便于测试
  const executionOrder = [];

  const createTask =
    (id, delay = 50) =>
    async () => {
      executionOrder.push(id);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return id;
    };

  // 先添加2个低优先级任务（立即开始，填满并发槽）
  priorityQueue.enqueue(createTask("low1", 150), 1);
  priorityQueue.enqueue(createTask("low2", 150), 1);

  // 等待任务开始执行
  await new Promise((resolve) => setTimeout(resolve, 20));

  // 再添加一些任务到队列中（这些会排队）
  const low3 = priorityQueue.enqueue(createTask("low3", 50), 1);
  const high1 = priorityQueue.enqueue(createTask("high1", 50), 10);
  const high2 = priorityQueue.enqueue(createTask("high2", 50), 10);
  const mid1 = priorityQueue.enqueue(createTask("mid1", 50), 5);

  // 等待所有任务完成
  await Promise.all([low3, high1, high2, mid1]);

  // 前2个是先开始的低优先级任务
  assert(
    executionOrder[0] === "low1" && executionOrder[1] === "low2",
    "先启动的任务先执行",
  );

  // 后续任务应该按优先级排序：high1, high2, mid1, low3
  const queuedTasks = executionOrder.slice(2);
  assert(
    queuedTasks.indexOf("high1") < queuedTasks.indexOf("mid1"),
    "高优先级任务在中优先级之前",
  );
  assert(
    queuedTasks.indexOf("high2") < queuedTasks.indexOf("mid1"),
    "高优先级任务在中优先级之前",
  );
  assert(
    queuedTasks.indexOf("mid1") < queuedTasks.indexOf("low3"),
    "中优先级任务在低优先级之前",
  );
})();

console.log("");

// ==================== 延迟等待所有异步测试完成 ====================
setTimeout(() => {
  console.log("\n" + "=".repeat(50));
  console.log(`\n📊 测试结果汇总:`);
  console.log(`   ✅ 通过: ${passCount}个`);
  console.log(`   ❌ 失败: ${failCount}个`);
  console.log(
    `   📈 通过率: ${((passCount / (passCount + failCount)) * 100).toFixed(1)}%`,
  );

  if (failCount === 0) {
    console.log("\n🎉 所有验证测试通过！核心功能正常工作。\n");
    process.exit(0);
  } else {
    console.log("\n⚠️  部分测试失败，请检查具体问题。\n");
    process.exit(1);
  }
}, 2000); // 等待2秒让所有异步测试完成
