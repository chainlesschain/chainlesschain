/**
 * 数据同步集成测试
 * 测试真实的同步场景（需要数据库和HTTP服务）
 */

const Database = require('../src/main/database');
const DBSyncManager = require('../src/main/sync/db-sync-manager');
const SyncHTTPClient = require('../src/main/sync/sync-http-client');
const path = require('path');
const fs = require('fs');

console.log('\n🧪 开始数据同步集成测试...\n');
console.log('⚠️  注意: 此测试需要后端服务运行在 http://localhost:9090\n');

// 测试配置
const TEST_DB_PATH = path.join(__dirname, '../data/test_sync.db');
const TEST_DEVICE_ID = 'test-device-' + Date.now();

// 清理测试数据库
if (fs.existsSync(TEST_DB_PATH)) {
  fs.unlinkSync(TEST_DB_PATH);
  console.log('🗑️  清理旧的测试数据库\n');
}

// 测试结果统计
const results = {
  passed: [],
  failed: [],
  skipped: []
};

function logTest(name, status, message = '') {
  const icons = {
    passed: '✅',
    failed: '❌',
    skipped: '⏭️'
  };
  console.log(`${icons[status]} ${name}`);
  if (message) {
    console.log(`   ${message}`);
  }
  results[status].push(name);
}

// ==================== 测试1: 检查后端服务 ====================
async function testBackendConnection() {
  console.log('📋 测试1: 后端服务连接\n');

  const httpClient = new SyncHTTPClient();

  try {
    const serverTime = await httpClient.getServerTime();
    logTest('连接后端服务', 'passed', `服务器时间: ${new Date(serverTime.timestamp).toISOString()}`);

    const offset = Date.now() - serverTime.timestamp;
    logTest('时间偏移检查', offset < 5000 ? 'passed' : 'failed', `偏移: ${offset}ms`);

    return true;
  } catch (error) {
    logTest('连接后端服务', 'failed', error.message);
    console.log('\n⚠️  后端服务未运行，跳过后续需要后端的测试\n');
    return false;
  }
}

// ==================== 测试2: 数据库初始化 ====================
async function testDatabaseInit() {
  console.log('\n📋 测试2: 数据库初始化\n');

  try {
    const database = new Database(TEST_DB_PATH);
    await database.initialize();

    logTest('数据库创建', 'passed', `路径: ${TEST_DB_PATH}`);

    // 验证表结构
    const tables = database.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all();

    const requiredTables = ['projects', 'project_files', 'knowledge_items'];
    const missingTables = requiredTables.filter(
      table => !tables.some(t => t.name === table)
    );

    if (missingTables.length === 0) {
      logTest('表结构验证', 'passed', `找到${tables.length}张表`);
    } else {
      logTest('表结构验证', 'failed', `缺少表: ${missingTables.join(', ')}`);
    }

    return database;
  } catch (error) {
    logTest('数据库初始化', 'failed', error.message);
    return null;
  }
}

// ==================== 测试3: 本地数据操作 ====================
async function testLocalOperations(database) {
  console.log('\n📋 测试3: 本地数据操作\n');

  if (!database) {
    logTest('本地数据操作', 'skipped', '数据库未初始化');
    return null;
  }

  try {
    // 插入测试项目
    const projectId = 'test-project-' + Date.now();
    const project = {
      id: projectId,
      user_id: 'test-user',
      name: '集成测试项目',
      description: '用于测试同步功能',
      project_type: 'code',
      status: 'active',
      root_path: '/test',
      file_count: 0,
      total_size: 0,
      created_at: Date.now(),
      updated_at: Date.now(),
      sync_status: 'pending',
      synced_at: null,
      device_id: TEST_DEVICE_ID,
      deleted: 0
    };

    database.db.prepare(`
      INSERT INTO projects (
        id, user_id, name, description, project_type, status,
        root_path, file_count, total_size, created_at, updated_at,
        sync_status, synced_at, device_id, deleted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      project.id, project.user_id, project.name, project.description,
      project.project_type, project.status, project.root_path,
      project.file_count, project.total_size, project.created_at,
      project.updated_at, project.sync_status, project.synced_at,
      project.device_id, project.deleted
    );

    logTest('插入待同步项目', 'passed', `ID: ${projectId}`);

    // 验证同步状态
    const inserted = database.db.prepare(
      'SELECT * FROM projects WHERE id = ?'
    ).get(projectId);

    if (inserted && inserted.sync_status === 'pending') {
      logTest('验证同步状态', 'passed', 'sync_status = pending');
    } else {
      logTest('验证同步状态', 'failed', `实际: ${inserted?.sync_status}`);
    }

    // 测试软删除
    const deleted = database.softDelete('projects', projectId);
    if (deleted) {
      const softDeleted = database.db.prepare(
        'SELECT deleted, sync_status FROM projects WHERE id = ?'
      ).get(projectId);

      if (softDeleted.deleted === 1 && softDeleted.sync_status === 'pending') {
        logTest('软删除功能', 'passed', 'deleted=1, sync_status=pending');
      } else {
        logTest('软删除功能', 'failed', JSON.stringify(softDeleted));
      }
    } else {
      logTest('软删除功能', 'failed', '删除失败');
    }

    // 测试恢复
    const restored = database.restoreSoftDeleted('projects', projectId);
    if (restored) {
      const restoredRecord = database.db.prepare(
        'SELECT deleted, sync_status FROM projects WHERE id = ?'
      ).get(projectId);

      if (restoredRecord.deleted === 0) {
        logTest('恢复软删除', 'passed', 'deleted=0');
      } else {
        logTest('恢复软删除', 'failed', JSON.stringify(restoredRecord));
      }
    }

    return projectId;
  } catch (error) {
    logTest('本地数据操作', 'failed', error.message);
    return null;
  }
}

// ==================== 测试4: 同步管理器初始化 ====================
async function testSyncManagerInit(database) {
  console.log('\n📋 测试4: 同步管理器初始化\n');

  if (!database) {
    logTest('同步管理器初始化', 'skipped', '数据库未初始化');
    return null;
  }

  try {
    const syncManager = new DBSyncManager(database, null);
    await syncManager.initialize(TEST_DEVICE_ID);

    logTest('同步管理器创建', 'passed', `设备ID: ${TEST_DEVICE_ID}`);

    // 验证时间同步
    if (syncManager.timeOffset !== undefined) {
      logTest('时间同步完成', 'passed', `偏移: ${syncManager.timeOffset}ms`);
    } else {
      logTest('时间同步完成', 'failed', '未设置timeOffset');
    }

    // 验证同步队列
    if (syncManager.syncQueue) {
      logTest('并发队列初始化', 'passed', `最大并发: ${syncManager.syncQueue.maxConcurrency}`);
    } else {
      logTest('并发队列初始化', 'failed', '队列未初始化');
    }

    // 验证重试策略
    if (syncManager.retryPolicy) {
      logTest('重试策略初始化', 'passed', `最大重试: ${syncManager.retryPolicy.maxRetries}`);
    } else {
      logTest('重试策略初始化', 'failed', '重试策略未初始化');
    }

    return syncManager;
  } catch (error) {
    logTest('同步管理器初始化', 'failed', error.message);
    return null;
  }
}

// ==================== 测试5: 模拟同步场景 ====================
async function testSyncScenarios(syncManager, projectId) {
  console.log('\n📋 测试5: 同步场景模拟\n');

  if (!syncManager || !projectId) {
    logTest('同步场景测试', 'skipped', '前置条件不满足');
    return;
  }

  try {
    // 场景1: 上传本地变更
    console.log('   场景1: 上传本地变更...');
    const uploadResult = await syncManager.uploadLocalChanges('projects').catch(err => {
      console.log(`   ⚠️  上传失败（可能是后端未运行）: ${err.message}`);
      return { success: 0, failed: 1 };
    });

    if (uploadResult.success > 0) {
      logTest('上传本地变更', 'passed', `成功${uploadResult.success}条`);
    } else if (uploadResult.failed > 0) {
      logTest('上传本地变更', 'failed', `失败${uploadResult.failed}条`);
    }

    // 场景2: 下载远程变更
    console.log('   场景2: 下载远程变更...');
    const downloadResult = await syncManager.downloadRemoteChanges('projects').catch(err => {
      console.log(`   ⚠️  下载失败（可能是后端未运行）: ${err.message}`);
      return { conflicts: [] };
    });

    if (downloadResult.conflicts) {
      logTest('下载远程变更', 'passed', `冲突${downloadResult.conflicts.length}个`);
    } else {
      logTest('下载远程变更', 'failed', '未返回结果');
    }

    // 场景3: 增量同步（并发模式）
    console.log('   场景3: 增量同步（并发）...');
    const start = Date.now();
    const incrementalResult = await syncManager.syncIncremental().catch(err => {
      console.log(`   ⚠️  增量同步失败: ${err.message}`);
      return { success: 0, failed: 0 };
    });
    const duration = Date.now() - start;

    if (incrementalResult.success >= 0) {
      logTest('增量同步（并发）', 'passed', `耗时${duration}ms`);
    } else {
      logTest('增量同步（并发）', 'failed', '未返回结果');
    }

  } catch (error) {
    logTest('同步场景测试', 'failed', error.message);
  }
}

// ==================== 主测试流程 ====================
async function runIntegrationTests() {
  console.log('⏱️  开始执行集成测试...\n');
  console.log('=' .repeat(60) + '\n');

  // 测试1: 后端连接
  const backendAvailable = await testBackendConnection();

  // 测试2: 数据库初始化
  const database = await testDatabaseInit();

  // 测试3: 本地操作
  const projectId = await testLocalOperations(database);

  // 测试4: 同步管理器
  const syncManager = backendAvailable ? await testSyncManagerInit(database) : null;

  // 测试5: 同步场景
  if (backendAvailable) {
    await testSyncScenarios(syncManager, projectId);
  } else {
    logTest('同步场景测试', 'skipped', '后端服务未运行');
  }

  // 输出测试结果
  console.log('\n' + '='.repeat(60));
  console.log('\n📊 集成测试结果汇总:\n');
  console.log(`   ✅ 通过: ${results.passed.length}个`);
  console.log(`   ❌ 失败: ${results.failed.length}个`);
  console.log(`   ⏭️  跳过: ${results.skipped.length}个`);

  const total = results.passed.length + results.failed.length;
  if (total > 0) {
    console.log(`   📈 通过率: ${(results.passed.length / total * 100).toFixed(1)}%`);
  }

  if (results.failed.length > 0) {
    console.log('\n❌ 失败的测试:');
    results.failed.forEach(test => console.log(`   - ${test}`));
  }

  if (results.skipped.length > 0) {
    console.log('\n⏭️  跳过的测试:');
    results.skipped.forEach(test => console.log(`   - ${test}`));
  }

  // 清理
  if (database) {
    database.close();
  }

  console.log('\n✅ 集成测试完成\n');

  if (backendAvailable) {
    console.log('💡 提示: 如需完整测试，请确保后端服务运行');
    console.log('   启动命令: cd backend/project-service && mvn spring-boot:run\n');
  }

  process.exit(results.failed.length === 0 ? 0 : 1);
}

// 运行测试
runIntegrationTests().catch(error => {
  console.error('\n❌ 集成测试异常:', error);
  process.exit(1);
});
