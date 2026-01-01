/**
 * ChainlessChain P2优化 - 意图融合单元测试
 * 版本: v0.18.0
 * 创建: 2026-01-01
 *
 * 测试覆盖:
 * 1. 同文件操作融合 (same_file_operations)
 * 2. 顺序操作融合 (sequence_operations)
 * 3. 批量操作融合 (batch_operations)
 * 4. 依赖操作融合 (dependency_operations)
 * 5. LLM智能融合
 * 6. 边界情况和错误处理
 * 7. 数据库日志记录
 * 8. 统计API
 */

const IntentFusion = require('./src/main/ai-engine/intent-fusion');
const Database = require('./src/main/database');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// 测试配置
const TEST_DB_PATH = path.join(__dirname, 'data', 'test-intent-fusion.db');
const TEST_SCENARIOS_PATH = path.join(__dirname, 'test-data', 'p2-intent-fusion-scenarios.json');

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  gray: '\x1b[90m'
};

function log(color, symbol, message) {
  console.log(`${colors[color]}${symbol} ${message}${colors.reset}`);
}

function logSuccess(message) { log('green', '✓', message); }
function logError(message) { log('red', '✗', message); }
function logInfo(message) { log('blue', 'ℹ', message); }
function logWarning(message) { log('yellow', '⚠', message); }

// Mock LLM服务（用于测试LLM融合）
class MockLLM {
  constructor() {
    this.callCount = 0;
  }

  async generate(prompt, options = {}) {
    this.callCount++;

    // 模拟LLM响应 - 根据prompt内容返回不同结果
    if (prompt.includes('BACKUP_DATABASE') && prompt.includes('COMPRESS_FILE')) {
      return JSON.stringify({
        canFuse: true,
        fusedIntent: {
          type: 'BACKUP_AND_COMPRESS_DATABASE',
          params: {
            dbPath: '/data/chainlesschain.db',
            backupPath: '/backups/db-2024.zip'
          }
        },
        confidence: 0.92,
        consumedCount: 2,
        reason: '备份和压缩是常见的连续操作，可以合并'
      });
    }

    if (prompt.includes('DOWNLOAD_FILE') && prompt.includes('INSTALL_SOFTWARE') && prompt.includes('CONFIGURE_SOFTWARE')) {
      return JSON.stringify({
        canFuse: true,
        fusedIntent: {
          type: 'SETUP_DEPENDENCY',
          params: {
            packageName: 'nodejs',
            version: 'v18.0.0',
            configPath: '/etc/nodejs/config.json'
          }
        },
        confidence: 0.88,
        consumedCount: 3,
        reason: '下载、安装、配置是软件部署的标准流程'
      });
    }

    // 低置信度场景
    if (prompt.includes('CREATE_USER') && prompt.includes('SEND_EMAIL')) {
      return JSON.stringify({
        canFuse: false,
        confidence: 0.45,
        reason: '这两个操作虽然相关，但属于不同领域，不建议融合'
      });
    }

    // 默认：无法融合
    return JSON.stringify({
      canFuse: false,
      confidence: 0.3,
      reason: '意图之间关联性不足'
    });
  }
}

// 测试套件
class IntentFusionTestSuite {
  constructor() {
    this.passed = 0;
    this.failed = 0;
    this.tests = [];
    this.fusion = null;
    this.db = null;
  }

  async setup() {
    logInfo('设置测试环境...');

    // 删除旧的测试数据库
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
      logInfo('已删除旧测试数据库');
    }

    // 创建测试数据库
    this.db = new Database(TEST_DB_PATH);
    await this.db.initialize();
    logSuccess('测试数据库已创建');

    // 运行P2迁移 - 创建intent_fusion_history表
    logInfo('执行P2数据库迁移...');
    const migrationSQL = fs.readFileSync(
      path.join(__dirname, 'src/main/migrations/004_add_p2_optimization_tables.sql'),
      'utf-8'
    );

    try {
      // 使用sql.js方式执行迁移
      const initSqlJs = require('sql.js');
      const SQL = await initSqlJs();

      // 导出当前数据库
      const dbPath = TEST_DB_PATH;
      let buffer;
      try {
        buffer = require('fs').readFileSync(dbPath);
      } catch (e) {
        buffer = Buffer.alloc(0);
      }

      // 创建sql.js数据库实例
      const sqlDb = new SQL.Database(buffer);

      // 执行迁移
      sqlDb.run(migrationSQL);

      // 保存回文件
      const data = sqlDb.export();
      require('fs').writeFileSync(dbPath, data);
      sqlDb.close();

      // 重新加载数据库
      this.db = new Database(TEST_DB_PATH);
      await this.db.initialize();

      logSuccess('P2迁移执行成功');
    } catch (error) {
      logWarning(`P2迁移执行失败（部分功能可能不可用）: ${error.message}`);
    }

    // 创建IntentFusion实例
    this.fusion = new IntentFusion({
      enableRuleFusion: true,
      enableLLMFusion: true,
      llmFusionConfidenceThreshold: 0.8,
      maxFusionWindow: 5
    });

    // 设置数据库和LLM实例
    this.fusion.setDatabase(this.db);
    this.fusion.setLLM(new MockLLM());

    logSuccess('IntentFusion实例已创建');
  }

  async teardown() {
    logInfo('清理测试环境...');

    if (this.db) {
      this.db.close();
    }

    // 保留测试数据库以便调试
    logInfo(`测试数据库保存在: ${TEST_DB_PATH}`);
  }

  async run() {
    console.log('\n' + '='.repeat(70));
    console.log('ChainlessChain P2优化 - 意图融合单元测试');
    console.log('='.repeat(70) + '\n');

    await this.setup();

    // 运行所有测试
    await this.testSameFileOperations();
    await this.testSequenceOperations();
    await this.testBatchOperations();
    await this.testDependencyOperations();
    await this.testLLMFusion();
    await this.testEdgeCases();
    await this.testDatabaseLogging();
    await this.testStatisticsAPI();
    await this.testRealScenarios();

    await this.teardown();

    // 输出结果
    this.printResults();
  }

  async test(name, fn) {
    try {
      await fn();
      this.passed++;
      logSuccess(name);
    } catch (error) {
      this.failed++;
      logError(`${name}: ${error.message}`);
      console.error(colors.gray + error.stack + colors.reset);
    }
  }

  // ==================== 测试1: 同文件操作融合 ====================
  async testSameFileOperations() {
    logInfo('\n[测试套件1] 同文件操作融合');

    await this.test('1.1 CREATE_FILE + WRITE_FILE -> CREATE_AND_WRITE_FILE', async () => {
      const intents = [
        { type: 'CREATE_FILE', params: { filePath: 'README.md' } },
        { type: 'WRITE_FILE', params: { filePath: 'README.md', content: '# Project' } }
      ];

      const result = await this.fusion.fuseIntents(intents, { sessionId: 'test-1.1' });

      assert.strictEqual(result.length, 1, '应该融合成1个意图');
      assert.strictEqual(result[0].type, 'CREATE_AND_WRITE_FILE', '应该是CREATE_AND_WRITE_FILE');
      assert.strictEqual(result[0].params.filePath, 'README.md');
      assert.strictEqual(result[0].params.content, '# Project');
    });

    await this.test('1.2 READ_FILE + ANALYZE_CONTENT -> READ_AND_ANALYZE_FILE', async () => {
      const intents = [
        { type: 'READ_FILE', params: { filePath: 'data.csv' } },
        { type: 'ANALYZE_CONTENT', params: { filePath: 'data.csv', analysisType: 'statistics' } }
      ];

      const result = await this.fusion.fuseIntents(intents, { sessionId: 'test-1.2' });

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].type, 'READ_AND_ANALYZE_FILE');
      assert.strictEqual(result[0].params.analysisType, 'statistics');
    });

    await this.test('1.3 UPDATE_FILE + FORMAT_CODE -> UPDATE_AND_FORMAT_FILE', async () => {
      const intents = [
        { type: 'UPDATE_FILE', params: { filePath: 'app.js', updates: { line: 10, content: 'const x = 1;' } } },
        { type: 'FORMAT_CODE', params: { filePath: 'app.js', formatter: 'prettier' } }
      ];

      const result = await this.fusion.fuseIntents(intents, { sessionId: 'test-1.3' });

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].type, 'UPDATE_AND_FORMAT_FILE');
    });

    await this.test('1.4 不同文件不应融合', async () => {
      const intents = [
        { type: 'CREATE_FILE', params: { filePath: 'file1.txt' } },
        { type: 'WRITE_FILE', params: { filePath: 'file2.txt', content: 'content' } }
      ];

      const result = await this.fusion.fuseIntents(intents, { sessionId: 'test-1.4' });

      assert.strictEqual(result.length, 2, '不同文件不应融合');
      assert.strictEqual(result[0].type, 'CREATE_FILE');
      assert.strictEqual(result[1].type, 'WRITE_FILE');
    });
  }

  // ==================== 测试2: 顺序操作融合 ====================
  async testSequenceOperations() {
    logInfo('\n[测试套件2] 顺序操作融合');

    await this.test('2.1 GIT_ADD + GIT_COMMIT -> GIT_ADD_AND_COMMIT', async () => {
      const intents = [
        { type: 'GIT_ADD', params: { files: ['app.js', 'test.js'] } },
        { type: 'GIT_COMMIT', params: { message: 'feat: add feature' } }
      ];

      const result = await this.fusion.fuseIntents(intents, { sessionId: 'test-2.1' });

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].type, 'GIT_ADD_AND_COMMIT');
      assert.deepStrictEqual(result[0].params.files, ['app.js', 'test.js']);
      assert.strictEqual(result[0].params.message, 'feat: add feature');
    });

    await this.test('2.2 GIT_ADD + GIT_COMMIT + GIT_PUSH -> GIT_COMMIT_AND_PUSH', async () => {
      const intents = [
        { type: 'GIT_ADD', params: { files: ['.'] } },
        { type: 'GIT_COMMIT', params: { message: 'fix: bug fix' } },
        { type: 'GIT_PUSH', params: { remote: 'origin', branch: 'main' } }
      ];

      const result = await this.fusion.fuseIntents(intents, { sessionId: 'test-2.2' });

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].type, 'GIT_COMMIT_AND_PUSH');
      assert.strictEqual(result[0].params.message, 'fix: bug fix');
      assert.strictEqual(result[0].params.remote, 'origin');
    });

    await this.test('2.3 NPM_INSTALL + NPM_BUILD -> NPM_INSTALL_AND_BUILD', async () => {
      const intents = [
        { type: 'NPM_INSTALL', params: {} },
        { type: 'NPM_BUILD', params: {} }
      ];

      const result = await this.fusion.fuseIntents(intents, { sessionId: 'test-2.3' });

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].type, 'NPM_INSTALL_AND_BUILD');
    });

    await this.test('2.4 RUN_TESTS + BUILD_PROJECT -> TEST_AND_BUILD', async () => {
      const intents = [
        { type: 'RUN_TESTS', params: { testFiles: ['**/*.test.js'] } },
        { type: 'BUILD_PROJECT', params: { target: 'production' } }
      ];

      const result = await this.fusion.fuseIntents(intents, { sessionId: 'test-2.4' });

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].type, 'TEST_AND_BUILD');
    });
  }

  // ==================== 测试3: 批量操作融合 ====================
  async testBatchOperations() {
    logInfo('\n[测试套件3] 批量操作融合');

    await this.test('3.1 多个CREATE_FILE -> BATCH_CREATE_FILES', async () => {
      const intents = [
        { type: 'CREATE_FILE', params: { filePath: 'file1.txt' } },
        { type: 'CREATE_FILE', params: { filePath: 'file2.txt' } },
        { type: 'CREATE_FILE', params: { filePath: 'file3.txt' } }
      ];

      const result = await this.fusion.fuseIntents(intents, { sessionId: 'test-3.1' });

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].type, 'BATCH_CREATE_FILES');
      assert.deepStrictEqual(result[0].params.files, ['file1.txt', 'file2.txt', 'file3.txt']);
    });

    await this.test('3.2 多个DELETE_FILE -> BATCH_DELETE_FILES', async () => {
      const intents = [
        { type: 'DELETE_FILE', params: { filePath: 'temp1.log' } },
        { type: 'DELETE_FILE', params: { filePath: 'temp2.log' } }
      ];

      const result = await this.fusion.fuseIntents(intents, { sessionId: 'test-3.2' });

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].type, 'BATCH_DELETE_FILES');
      assert.deepStrictEqual(result[0].params.files, ['temp1.log', 'temp2.log']);
    });

    await this.test('3.3 多个COMPRESS_IMAGE -> BATCH_COMPRESS_IMAGES', async () => {
      const intents = [
        { type: 'COMPRESS_IMAGE', params: { imagePath: 'img1.jpg', quality: 80 } },
        { type: 'COMPRESS_IMAGE', params: { imagePath: 'img2.jpg', quality: 80 } },
        { type: 'COMPRESS_IMAGE', params: { imagePath: 'img3.jpg', quality: 80 } }
      ];

      const result = await this.fusion.fuseIntents(intents, { sessionId: 'test-3.3' });

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].type, 'BATCH_COMPRESS_IMAGES');
      assert.strictEqual(result[0].params.images.length, 3);
      assert.strictEqual(result[0].params.quality, 80);
    });

    await this.test('3.4 不同quality的COMPRESS_IMAGE不应融合', async () => {
      const intents = [
        { type: 'COMPRESS_IMAGE', params: { imagePath: 'img1.jpg', quality: 80 } },
        { type: 'COMPRESS_IMAGE', params: { imagePath: 'img2.jpg', quality: 60 } }
      ];

      const result = await this.fusion.fuseIntents(intents, { sessionId: 'test-3.4' });

      assert.strictEqual(result.length, 2, '不同质量设置不应融合');
    });
  }

  // ==================== 测试4: 依赖操作融合 ====================
  async testDependencyOperations() {
    logInfo('\n[测试套件4] 依赖操作融合');

    await this.test('4.1 IMPORT_CSV + VALIDATE_DATA -> IMPORT_AND_VALIDATE_CSV', async () => {
      const intents = [
        { type: 'IMPORT_CSV', params: { filePath: 'data.csv' } },
        { type: 'VALIDATE_DATA', params: { schema: { columns: ['id', 'name'] } } }
      ];

      const result = await this.fusion.fuseIntents(intents, { sessionId: 'test-4.1' });

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].type, 'IMPORT_AND_VALIDATE_CSV');
      assert.strictEqual(result[0].params.filePath, 'data.csv');
    });

    await this.test('4.2 LINT_CODE + FIX_LINT_ERRORS -> LINT_AND_FIX', async () => {
      const intents = [
        { type: 'LINT_CODE', params: { files: ['src/**/*.js'] } },
        { type: 'FIX_LINT_ERRORS', params: { autoFix: true } }
      ];

      const result = await this.fusion.fuseIntents(intents, { sessionId: 'test-4.2' });

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].type, 'LINT_AND_FIX');
    });

    await this.test('4.3 SECURITY_SCAN + GENERATE_REPORT -> SCAN_AND_REPORT', async () => {
      const intents = [
        { type: 'SECURITY_SCAN', params: { scanType: 'full' } },
        { type: 'GENERATE_REPORT', params: { format: 'pdf' } }
      ];

      const result = await this.fusion.fuseIntents(intents, { sessionId: 'test-4.3' });

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].type, 'SCAN_AND_REPORT');
    });

    await this.test('4.4 DB_MIGRATE + VERIFY_MIGRATION -> MIGRATE_AND_VERIFY', async () => {
      const intents = [
        { type: 'DB_MIGRATE', params: { version: '004' } },
        { type: 'VERIFY_MIGRATION', params: { checkIntegrity: true } }
      ];

      const result = await this.fusion.fuseIntents(intents, { sessionId: 'test-4.4' });

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].type, 'MIGRATE_AND_VERIFY');
    });
  }

  // ==================== 测试5: LLM智能融合 ====================
  async testLLMFusion() {
    logInfo('\n[测试套件5] LLM智能融合');

    await this.test('5.1 备份数据库 + 压缩备份（LLM融合）', async () => {
      const intents = [
        { type: 'BACKUP_DATABASE', params: { dbPath: '/data/chainlesschain.db' } },
        { type: 'COMPRESS_FILE', params: { filePath: '/backups/db-2024.sql', outputPath: '/backups/db-2024.zip' } }
      ];

      const result = await this.fusion.fuseIntents(intents, {
        sessionId: 'test-5.1',
        userInput: '备份数据库并压缩备份文件'
      });

      assert.strictEqual(result.length, 1, '应该通过LLM融合');
      assert.strictEqual(result[0].type, 'BACKUP_AND_COMPRESS_DATABASE');
    });

    await this.test('5.2 下载+安装+配置（3个意图LLM融合）', async () => {
      const intents = [
        { type: 'DOWNLOAD_FILE', params: { url: 'https://nodejs.org/v18.0.0', savePath: '/tmp/nodejs.tar.gz' } },
        { type: 'INSTALL_SOFTWARE', params: { packagePath: '/tmp/nodejs.tar.gz' } },
        { type: 'CONFIGURE_SOFTWARE', params: { configPath: '/etc/nodejs/config.json' } }
      ];

      const result = await this.fusion.fuseIntents(intents, {
        sessionId: 'test-5.2',
        userInput: '下载并安装配置nodejs v18.0.0'
      });

      assert.strictEqual(result.length, 1, '应该融合成1个复合意图');
      assert.strictEqual(result[0].type, 'SETUP_DEPENDENCY');
    });

    await this.test('5.3 低置信度场景不应融合', async () => {
      const intents = [
        { type: 'CREATE_USER', params: { username: 'alice' } },
        { type: 'SEND_EMAIL', params: { to: 'alice@example.com' } }
      ];

      const result = await this.fusion.fuseIntents(intents, {
        sessionId: 'test-5.3',
        userInput: '创建用户alice并发送邮件'
      });

      assert.strictEqual(result.length, 2, '低置信度不应融合');
    });
  }

  // ==================== 测试6: 边界情况 ====================
  async testEdgeCases() {
    logInfo('\n[测试套件6] 边界情况和错误处理');

    await this.test('6.1 空数组输入', async () => {
      const result = await this.fusion.fuseIntents([], { sessionId: 'test-6.1' });
      assert.strictEqual(result.length, 0, '空数组应返回空数组');
    });

    await this.test('6.2 单个意图', async () => {
      const intents = [{ type: 'CREATE_FILE', params: { filePath: 'test.txt' } }];
      const result = await this.fusion.fuseIntents(intents, { sessionId: 'test-6.2' });
      assert.strictEqual(result.length, 1, '单个意图应原样返回');
      assert.strictEqual(result[0].type, 'CREATE_FILE');
    });

    await this.test('6.3 超过maxFusionWindow的批量操作', async () => {
      const intents = Array.from({ length: 10 }, (_, i) => ({
        type: 'CREATE_FILE',
        params: { filePath: `file${i}.txt` }
      }));

      const result = await this.fusion.fuseIntents(intents, { sessionId: 'test-6.3' });

      // 应该分成两个批次（5+5）
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].type, 'BATCH_CREATE_FILES');
      assert.strictEqual(result[0].params.files.length, 5);
      assert.strictEqual(result[1].type, 'BATCH_CREATE_FILES');
      assert.strictEqual(result[1].params.files.length, 5);
    });

    await this.test('6.4 混合可融合和不可融合意图', async () => {
      const intents = [
        { type: 'CREATE_FILE', params: { filePath: 'file1.txt' } },
        { type: 'CREATE_FILE', params: { filePath: 'file2.txt' } },
        { type: 'SEND_EMAIL', params: { to: 'user@example.com' } }, // 不可融合
        { type: 'DELETE_FILE', params: { filePath: 'old.txt' } }
      ];

      const result = await this.fusion.fuseIntents(intents, { sessionId: 'test-6.4' });

      assert.strictEqual(result.length, 3);
      assert.strictEqual(result[0].type, 'BATCH_CREATE_FILES');
      assert.strictEqual(result[1].type, 'SEND_EMAIL');
      assert.strictEqual(result[2].type, 'DELETE_FILE');
    });

    await this.test('6.5 禁用规则融合', async () => {
      const fusionNoRule = new IntentFusion({
        enableRuleFusion: false,
        enableLLMFusion: false,
        db: this.db
      });

      const intents = [
        { type: 'CREATE_FILE', params: { filePath: 'README.md' } },
        { type: 'WRITE_FILE', params: { filePath: 'README.md', content: 'content' } }
      ];

      const result = await fusionNoRule.fuseIntents(intents, { sessionId: 'test-6.5' });

      assert.strictEqual(result.length, 2, '禁用融合应原样返回');
    });
  }

  // ==================== 测试7: 数据库日志记录 ====================
  async testDatabaseLogging() {
    logInfo('\n[测试套件7] 数据库日志记录');

    await this.test('7.1 融合操作应记录到数据库', async () => {
      const sessionId = 'test-db-logging-7.1';
      const intents = [
        { type: 'CREATE_FILE', params: { filePath: 'test.txt' } },
        { type: 'WRITE_FILE', params: { filePath: 'test.txt', content: 'hello' } }
      ];

      await this.fusion.fuseIntents(intents, { sessionId, userId: 'user123' });

      // 查询数据库
      const records = this.db.prepare(`
        SELECT * FROM intent_fusion_history
        WHERE session_id = ?
        ORDER BY created_at DESC
      `).all(sessionId);

      assert.strictEqual(records.length, 1, '应该有1条融合记录');

      const record = records[0];
      assert.strictEqual(record.session_id, sessionId);
      assert.strictEqual(record.user_id, 'user123');
      assert.strictEqual(record.original_count, 2);
      assert.strictEqual(record.fused_count, 1);
      assert.strictEqual(record.fusion_strategy, 'rule');
      assert.strictEqual(record.llm_calls_saved, 1);

      const originalIntents = JSON.parse(record.original_intents);
      const fusedIntents = JSON.parse(record.fused_intents);
      assert.strictEqual(originalIntents.length, 2);
      assert.strictEqual(fusedIntents.length, 1);
      assert.strictEqual(fusedIntents[0].type, 'CREATE_AND_WRITE_FILE');
    });

    await this.test('7.2 批量融合应计算正确的reduction_rate', async () => {
      const sessionId = 'test-db-logging-7.2';
      const intents = [
        { type: 'CREATE_FILE', params: { filePath: 'f1.txt' } },
        { type: 'CREATE_FILE', params: { filePath: 'f2.txt' } },
        { type: 'CREATE_FILE', params: { filePath: 'f3.txt' } },
        { type: 'CREATE_FILE', params: { filePath: 'f4.txt' } },
        { type: 'CREATE_FILE', params: { filePath: 'f5.txt' } }
      ];

      await this.fusion.fuseIntents(intents, { sessionId });

      const records = this.db.prepare(`
        SELECT * FROM intent_fusion_history WHERE session_id = ?
      `).all(sessionId);

      assert.strictEqual(records.length, 1);
      const record = records[0];

      const reductionRate = (5 - 1) / 5; // (原始5个 - 融合后1个) / 原始5个 = 0.8
      assert.strictEqual(record.reduction_rate, reductionRate);
      assert.strictEqual(record.llm_calls_saved, 4);
    });

    await this.test('7.3 LLM融合应标记正确的fusion_strategy', async () => {
      const sessionId = 'test-db-logging-7.3';
      const intents = [
        { type: 'BACKUP_DATABASE', params: { dbPath: '/data/db.sqlite' } },
        { type: 'COMPRESS_FILE', params: { filePath: '/backups/db.sql' } }
      ];

      await this.fusion.fuseIntents(intents, {
        sessionId,
        userInput: '备份数据库并压缩备份文件'
      });

      const records = this.db.prepare(`
        SELECT * FROM intent_fusion_history WHERE session_id = ?
      `).all(sessionId);

      assert.strictEqual(records.length, 1);
      assert.strictEqual(records[0].fusion_strategy, 'llm');
    });
  }

  // ==================== 测试8: 统计API ====================
  async testStatisticsAPI() {
    logInfo('\n[测试套件8] 统计API');

    await this.test('8.1 getFusionStats应返回正确的统计信息', async () => {
      // 执行几次融合操作
      const testSessionBase = 'stats-test';

      for (let i = 0; i < 3; i++) {
        await this.fusion.fuseIntents([
          { type: 'CREATE_FILE', params: { filePath: `file${i}.txt` } },
          { type: 'WRITE_FILE', params: { filePath: `file${i}.txt`, content: 'test' } }
        ], { sessionId: `${testSessionBase}-${i}`, userId: 'user-stats' });
      }

      const stats = await this.fusion.getFusionStats({
        userId: 'user-stats',
        startTime: Date.now() - 60000,
        endTime: Date.now()
      });

      assert.ok(stats.totalFusions >= 3, '总融合次数应>=3');
      assert.ok(stats.totalLLMCallsSaved >= 3, '节省的LLM调用应>=3');
      assert.ok(stats.averageReductionRate > 0, '平均减少率应>0');
    });

    await this.test('8.2 统计API应支持时间范围过滤', async () => {
      const now = Date.now();
      const oneDayAgo = now - 24 * 60 * 60 * 1000;

      const stats = await this.fusion.getFusionStats({
        startTime: oneDayAgo,
        endTime: now
      });

      assert.ok(stats.totalFusions >= 0);
      assert.ok('ruleBasedFusions' in stats);
      assert.ok('llmBasedFusions' in stats);
    });
  }

  // ==================== 测试9: 真实场景测试 ====================
  async testRealScenarios() {
    logInfo('\n[测试套件9] 真实场景测试');

    // 加载测试场景文件
    let scenarios = [];
    try {
      const scenariosData = fs.readFileSync(TEST_SCENARIOS_PATH, 'utf-8');
      scenarios = JSON.parse(scenariosData).scenarios || [];
      logInfo(`已加载 ${scenarios.length} 个测试场景`);
    } catch (error) {
      logWarning(`无法加载测试场景文件: ${error.message}`);
      return;
    }

    // 测试部分场景（前10个）
    const testScenarios = scenarios.slice(0, 10);

    for (const scenario of testScenarios) {
      await this.test(`9.${scenario.id} - ${scenario.name}`, async () => {
        const result = await this.fusion.fuseIntents(
          scenario.original_intents,
          {
            sessionId: `scenario-${scenario.id}`,
            userInput: scenario.user_input
          }
        );

        if (scenario.expected_fusion) {
          assert.ok(
            result.length < scenario.original_intents.length,
            `场景 ${scenario.id} 应该进行融合`
          );

          // 验证融合后的意图类型
          if (scenario.fused_intent) {
            const fusedTypes = result.map(r => r.type);
            assert.ok(
              fusedTypes.includes(scenario.fused_intent.type),
              `应该包含融合意图类型 ${scenario.fused_intent.type}`
            );
          }
        } else {
          assert.strictEqual(
            result.length,
            scenario.original_intents.length,
            `场景 ${scenario.id} 不应该融合`
          );
        }
      });
    }
  }

  // ==================== 结果输出 ====================
  printResults() {
    console.log('\n' + '='.repeat(70));
    console.log('测试结果汇总');
    console.log('='.repeat(70));

    const total = this.passed + this.failed;
    const passRate = total > 0 ? ((this.passed / total) * 100).toFixed(2) : '0.00';

    console.log(`\n总测试数: ${total}`);
    logSuccess(`通过: ${this.passed}`);
    if (this.failed > 0) {
      logError(`失败: ${this.failed}`);
    } else {
      logSuccess(`失败: ${this.failed}`);
    }
    console.log(`通过率: ${passRate}%`);

    if (this.failed === 0) {
      console.log('\n' + colors.green + '🎉 所有测试通过！' + colors.reset);
    } else {
      console.log('\n' + colors.red + '⚠️  部分测试失败，请检查' + colors.reset);
    }

    console.log('\n' + '='.repeat(70) + '\n');
  }
}

// 运行测试
async function main() {
  const suite = new IntentFusionTestSuite();
  await suite.run();

  // 根据测试结果设置退出码
  process.exit(suite.failed > 0 ? 1 : 0);
}

// 如果直接运行此文件，执行测试
if (require.main === module) {
  main().catch(error => {
    console.error('测试执行失败:', error);
    process.exit(1);
  });
}

module.exports = IntentFusionTestSuite;
