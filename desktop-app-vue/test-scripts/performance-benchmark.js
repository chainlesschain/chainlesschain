/**
 * 性能基准测试工具
 * 测试各个优化模块的性能提升
 *
 * 使用方式:
 * node test-scripts/performance-benchmark.js
 */

const path = require('path');
const fs = require('fs');

// 动态导入数据库模块
let DatabaseManager;
try {
  const dbModule = require('../src/main/database');
  DatabaseManager = dbModule.DatabaseManager || dbModule.default;
} catch (e) {
  console.error('无法加载数据库模块:', e.message);
  process.exit(1);
}

/**
 * 性能测试套件
 */
class PerformanceBenchmark {
  constructor() {
    this.results = [];
    this.db = null;
  }

  /**
   * 初始化测试环境
   */
  async setup() {
    console.log('🔧 初始化测试环境...\n');

    // 创建临时数据库
    const tmpDbPath = path.join(__dirname, '..', 'test-data', 'benchmark.db');

    // 删除旧的测试数据库
    if (fs.existsSync(tmpDbPath)) {
      fs.unlinkSync(tmpDbPath);
    }

    this.db = new DatabaseManager(tmpDbPath, {
      encryptionEnabled: false,
    });

    await this.db.initialize();

    console.log('✅ 测试环境就绪\n');
  }

  /**
   * 生成测试数据
   */
  async generateTestData() {
    console.log('📊 生成测试数据...\n');

    const { v4: uuidv4 } = require('uuid');

    // 生成知识库项
    const nodeCount = 1000;
    console.log(`  - 生成 ${nodeCount} 个知识库项...`);

    for (let i = 0; i < nodeCount; i++) {
      this.db.createKnowledgeItem({
        id: uuidv4(),
        title: `测试笔记 ${i}`,
        type: 'note',
        content: `这是测试笔记的内容 ${i}`,
        tags: [`tag${i % 10}`, `tag${i % 20}`],
      });

      if ((i + 1) % 100 === 0) {
        process.stdout.write(`  Progress: ${i + 1}/${nodeCount}\r`);
      }
    }
    console.log(`  ✅ 知识库项创建完成\n`);

    // 生成关系
    const relationCount = 2500;
    console.log(`  - 生成 ${relationCount} 个关系...`);

    const items = this.db.getAllKnowledgeItems();
    const relationTypes = ['link', 'tag', 'semantic', 'temporal'];

    for (let i = 0; i < relationCount; i++) {
      const source = items[Math.floor(Math.random() * items.length)];
      const target = items[Math.floor(Math.random() * items.length)];

      if (source.id !== target.id) {
        try {
          this.db.addKnowledgeRelation({
            id: uuidv4(),
            source_id: source.id,
            target_id: target.id,
            relation_type: relationTypes[Math.floor(Math.random() * relationTypes.length)],
            weight: Math.random(),
          });
        } catch (e) {
          // 忽略重复关系错误
        }
      }

      if ((i + 1) % 100 === 0) {
        process.stdout.write(`  Progress: ${i + 1}/${relationCount}\r`);
      }
    }
    console.log(`  ✅ 关系创建完成\n`);

    // 生成对话和消息
    const messageCount = 1000;
    console.log(`  - 生成 ${messageCount} 条消息...`);

    const conversationId = uuidv4();
    this.db.createConversation({
      id: conversationId,
      title: '测试对话',
    });

    for (let i = 0; i < messageCount; i++) {
      this.db.createMessage({
        id: uuidv4(),
        conversation_id: conversationId,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `测试消息 ${i}`,
        timestamp: Date.now() + i * 1000,
      });

      if ((i + 1) % 100 === 0) {
        process.stdout.write(`  Progress: ${i + 1}/${messageCount}\r`);
      }
    }
    console.log(`  ✅ 消息创建完成\n`);

    this.conversationId = conversationId;
  }

  /**
   * 测试数据库查询性能
   */
  async testDatabasePerformance() {
    console.log('🔍 测试数据库查询性能...\n');

    // 测试1: 图谱数据查询
    console.log('  测试1: 图谱数据查询');
    const graphStart = performance.now();
    const graphData = this.db.getGraphData({
      relationTypes: ['link', 'tag', 'semantic', 'temporal'],
      minWeight: 0.0,
      limit: 500,
    });
    const graphTime = performance.now() - graphStart;

    console.log(`    - 耗时: ${graphTime.toFixed(2)}ms`);
    console.log(`    - 节点数: ${graphData.nodes.length}`);
    console.log(`    - 边数: ${graphData.edges.length}`);

    this.results.push({
      test: '图谱数据查询(500节点)',
      time: graphTime,
      target: 200, // 目标时间
      pass: graphTime < 200,
    });

    // 测试2: 消息分页查询
    console.log('\n  测试2: 消息分页查询');
    const msgStart = performance.now();
    const messages = this.db.getMessagesByConversation(this.conversationId, {
      limit: 50,
      offset: 0,
    });
    const msgTime = performance.now() - msgStart;

    console.log(`    - 耗时: ${msgTime.toFixed(2)}ms`);
    console.log(`    - 消息数: ${messages.messages?.length || messages.length}`);
    console.log(`    - 总数: ${messages.total || 'N/A'}`);

    this.results.push({
      test: '消息分页查询(50条/页)',
      time: msgTime,
      target: 10,
      pass: msgTime < 10,
    });

    // 测试3: 大量消息分页查询
    console.log('\n  测试3: 大量消息分页查询');
    const bigMsgStart = performance.now();
    const bigMessages = this.db.getMessagesByConversation(this.conversationId, {
      limit: 50,
      offset: 500,
    });
    const bigMsgTime = performance.now() - bigMsgStart;

    console.log(`    - 耗时: ${bigMsgTime.toFixed(2)}ms`);
    console.log(`    - 消息数: ${bigMessages.messages?.length || bigMessages.length}`);

    this.results.push({
      test: '大量消息分页查询(offset=500)',
      time: bigMsgTime,
      target: 15,
      pass: bigMsgTime < 15,
    });

    // 测试4: 索引效率测试
    console.log('\n  测试4: 复合索引效率测试');
    const idxStart = performance.now();
    const stmt = this.db.db.prepare(`
      SELECT COUNT(*) as count
      FROM knowledge_relations
      WHERE relation_type = 'link' AND weight > 0.5
    `);
    const count = stmt.get();
    stmt.free();
    const idxTime = performance.now() - idxStart;

    console.log(`    - 耗时: ${idxTime.toFixed(2)}ms`);
    console.log(`    - 结果数: ${count.count}`);

    this.results.push({
      test: '复合索引查询',
      time: idxTime,
      target: 5,
      pass: idxTime < 5,
    });

    console.log('\n✅ 数据库测试完成\n');
  }

  /**
   * 测试P2P连接池性能
   */
  async testP2PPerformance() {
    console.log('🌐 测试P2P连接池性能...\n');

    const { ConnectionPool } = require('../src/main/p2p/connection-pool');

    const pool = new ConnectionPool({
      maxConnections: 50,
      minConnections: 5,
      maxIdleTime: 60000,
    });

    await pool.initialize();

    // 模拟连接创建函数
    const mockCreateConnection = async (peerId) => {
      await new Promise(resolve => setTimeout(resolve, 50)); // 模拟50ms延迟
      return { peerId, close: async () => {} };
    };

    // 测试1: 首次连接
    console.log('  测试1: 首次连接创建');
    const createStart = performance.now();
    await pool.acquireConnection('peer1', mockCreateConnection);
    const createTime = performance.now() - createStart;

    console.log(`    - 耗时: ${createTime.toFixed(2)}ms`);

    this.results.push({
      test: 'P2P首次连接',
      time: createTime,
      target: 100,
      pass: createTime < 100,
    });

    // 测试2: 连接复用
    console.log('\n  测试2: 连接复用');
    pool.releaseConnection('peer1');

    const reuseStart = performance.now();
    await pool.acquireConnection('peer1', mockCreateConnection);
    const reuseTime = performance.now() - reuseStart;

    console.log(`    - 耗时: ${reuseTime.toFixed(2)}ms`);

    this.results.push({
      test: 'P2P连接复用',
      time: reuseTime,
      target: 5,
      pass: reuseTime < 5,
    });

    // 测试3: 批量连接
    console.log('\n  测试3: 批量连接创建');
    const batchStart = performance.now();
    const promises = [];
    for (let i = 0; i < 20; i++) {
      promises.push(pool.acquireConnection(`peer${i}`, mockCreateConnection));
    }
    await Promise.all(promises);
    const batchTime = performance.now() - batchStart;

    console.log(`    - 耗时: ${batchTime.toFixed(2)}ms`);
    console.log(`    - 平均: ${(batchTime / 20).toFixed(2)}ms/连接`);

    const stats = pool.getStats();
    console.log(`    - 统计: ${JSON.stringify(stats, null, 2)}`);

    this.results.push({
      test: 'P2P批量连接(20个)',
      time: batchTime,
      target: 1000,
      pass: batchTime < 1000,
    });

    await pool.destroy();

    console.log('\n✅ P2P测试完成\n');
  }

  /**
   * 生成性能报告
   */
  generateReport() {
    console.log('📋 性能测试报告\n');
    console.log('='.repeat(70));

    let passCount = 0;
    let failCount = 0;

    console.log('\n测试结果:\n');

    this.results.forEach((result, index) => {
      const status = result.pass ? '✅ PASS' : '❌ FAIL';
      const improvement = ((result.target - result.time) / result.target * 100).toFixed(1);

      console.log(`${index + 1}. ${result.test}`);
      console.log(`   ${status}`);
      console.log(`   实际耗时: ${result.time.toFixed(2)}ms`);
      console.log(`   目标耗时: ${result.target}ms`);
      console.log(`   ${result.pass ? '性能提升' : '未达标'}: ${improvement}%`);
      console.log('');

      if (result.pass) {
        passCount++;
      } else {
        failCount++;
      }
    });

    console.log('='.repeat(70));
    console.log(`\n总计: ${this.results.length} 个测试`);
    console.log(`通过: ${passCount} (${(passCount / this.results.length * 100).toFixed(1)}%)`);
    console.log(`失败: ${failCount}`);
    console.log('');

    // 保存报告到文件
    const reportPath = path.join(__dirname, '..', 'test-results', 'performance-report.json');
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      results: this.results,
      summary: {
        total: this.results.length,
        passed: passCount,
        failed: failCount,
        passRate: (passCount / this.results.length * 100).toFixed(1) + '%',
      },
    }, null, 2));

    console.log(`📄 详细报告已保存到: ${reportPath}\n`);
  }

  /**
   * 清理测试环境
   */
  async cleanup() {
    console.log('🧹 清理测试环境...\n');

    if (this.db) {
      this.db.close();
    }

    console.log('✅ 清理完成\n');
  }

  /**
   * 运行所有测试
   */
  async runAll() {
    try {
      await this.setup();
      await this.generateTestData();
      await this.testDatabasePerformance();
      await this.testP2PPerformance();
      this.generateReport();
    } catch (error) {
      console.error('❌ 测试失败:', error);
      console.error(error.stack);
    } finally {
      await this.cleanup();
    }
  }
}

// 运行测试
if (require.main === module) {
  const benchmark = new PerformanceBenchmark();
  benchmark.runAll().then(() => {
    console.log('🎉 所有测试完成!');
    process.exit(0);
  }).catch(error => {
    console.error('💥 测试失败:', error);
    process.exit(1);
  });
}

module.exports = PerformanceBenchmark;
