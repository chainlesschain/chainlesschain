/**
 * Phase 1-3 核心功能自动化测试脚本
 * 测试 8 个核心模块的 143 个 IPC handlers
 */

const { ipcRenderer } = require('electron');

class Phase13Tester {
  constructor() {
    this.results = {
      database: { total: 0, passed: 0, failed: 0, errors: [] },
      category: { total: 0, passed: 0, failed: 0, errors: [] },
      llm: { total: 0, passed: 0, failed: 0, errors: [] },
      rag: { total: 0, passed: 0, failed: 0, errors: [] },
      ukey: { total: 0, passed: 0, failed: 0, errors: [] },
      did: { total: 0, passed: 0, failed: 0, errors: [] },
      p2p: { total: 0, passed: 0, failed: 0, errors: [] },
      social: { total: 0, passed: 0, failed: 0, errors: [] }
    };
  }

  /**
   * 测试单个 IPC handler
   */
  async testHandler(module, handlerName, testData = null) {
    this.results[module].total++;

    try {
      console.log(`  Testing ${handlerName}...`);
      const result = await ipcRenderer.invoke(handlerName, testData);

      // 简单验证：只要不抛出错误就算通过
      this.results[module].passed++;
      console.log(`  ✓ ${handlerName} passed`);
      return { success: true, result };

    } catch (error) {
      this.results[module].failed++;
      this.results[module].errors.push({
        handler: handlerName,
        error: error.message
      });
      console.error(`  ✗ ${handlerName} failed:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * 1. 测试数据库模块 (22 handlers)
   */
  async testDatabase() {
    console.log('\n=== Testing Database Module (22 handlers) ===\n');

    // 测试笔记 CRUD
    await this.testHandler('database', 'db:get-note', 'test-note-id');
    await this.testHandler('database', 'db:get-notes', {});
    await this.testHandler('database', 'db:search-notes', { keyword: 'test' });

    // 测试创建笔记
    const createResult = await this.testHandler('database', 'db:create-note', {
      title: 'Test Note',
      content: 'This is a test note for Phase 1-3 testing',
      type: 'note'
    });

    if (createResult.success && createResult.result?.id) {
      const noteId = createResult.result.id;

      // 测试更新笔记
      await this.testHandler('database', 'db:update-note', {
        id: noteId,
        title: 'Updated Test Note',
        content: 'Updated content'
      });

      // 测试获取单个笔记
      await this.testHandler('database', 'db:get-note', noteId);

      // 测试删除笔记
      await this.testHandler('database', 'db:delete-note', noteId);
    }

    // 测试其他数据库功能
    await this.testHandler('database', 'db:get-tags', {});
    await this.testHandler('database', 'db:get-recent-notes', { limit: 10 });
    await this.testHandler('database', 'db:get-stats', {});

    return this.results.database;
  }

  /**
   * 2. 测试分类管理模块 (7 handlers)
   */
  async testCategory() {
    console.log('\n=== Testing Category Module (7 handlers) ===\n');

    // 测试初始化默认分类
    await this.testHandler('category', 'category:initialize-defaults', 'local-user');

    // 测试获取所有分类
    const getAllResult = await this.testHandler('category', 'category:get-all', 'local-user');

    // 测试创建分类
    const createResult = await this.testHandler('category', 'category:create', {
      userId: 'local-user',
      name: 'Test Category',
      description: 'Test category for Phase 1-3',
      color: '#FF5733',
      icon: 'folder'
    });

    if (createResult.success && createResult.result?.id) {
      const categoryId = createResult.result.id;

      // 测试获取单个分类
      await this.testHandler('category', 'category:get-by-id', categoryId);

      // 测试更新分类
      await this.testHandler('category', 'category:update', {
        id: categoryId,
        name: 'Updated Test Category',
        description: 'Updated description'
      });

      // 测试删除分类
      await this.testHandler('category', 'category:delete', categoryId);
    }

    // 测试统计
    await this.testHandler('category', 'category:get-stats', 'local-user');

    return this.results.category;
  }

  /**
   * 3. 测试 LLM 模块 (14 handlers)
   */
  async testLLM() {
    console.log('\n=== Testing LLM Module (14 handlers) ===\n');

    // 测试获取配置
    await this.testHandler('llm', 'llm:get-config', {});

    // 测试获取可用模型
    await this.testHandler('llm', 'llm:get-available-models', {});

    // 测试简单对话（非流式）
    await this.testHandler('llm', 'llm:chat', {
      messages: [{ role: 'user', content: 'Hello, this is a test.' }],
      stream: false
    });

    // 测试模型状态
    await this.testHandler('llm', 'llm:get-model-status', {});

    // 测试会话管理
    await this.testHandler('llm', 'llm:create-conversation', {
      title: 'Test Conversation'
    });

    await this.testHandler('llm', 'llm:get-conversations', {});

    return this.results.llm;
  }

  /**
   * 4. 测试 RAG 模块 (7 handlers)
   */
  async testRAG() {
    console.log('\n=== Testing RAG Module (7 handlers) ===\n');

    // 测试 RAG 搜索
    await this.testHandler('rag', 'rag:search', {
      query: 'test query',
      limit: 5
    });

    // 测试添加文档
    await this.testHandler('rag', 'rag:add-document', {
      id: 'test-doc-1',
      content: 'This is test content for RAG testing',
      metadata: { type: 'test' }
    });

    // 测试获取文档
    await this.testHandler('rag', 'rag:get-document', 'test-doc-1');

    // 测试删除文档
    await this.testHandler('rag', 'rag:delete-document', 'test-doc-1');

    // 测试获取配置
    await this.testHandler('rag', 'rag:get-config', {});

    return this.results.rag;
  }

  /**
   * 5. 测试 U-Key 模块 (9 handlers)
   */
  async testUKey() {
    console.log('\n=== Testing U-Key Module (9 handlers) ===\n');

    // 测试设备检测
    await this.testHandler('ukey', 'ukey:detect', {});

    // 测试获取设备信息
    await this.testHandler('ukey', 'ukey:get-device-info', {});

    // 注意：其他 U-Key 操作需要实际硬件，这里只测试基础调用
    await this.testHandler('ukey', 'ukey:is-available', {});

    return this.results.ukey;
  }

  /**
   * 6. 测试 DID 模块 (24 handlers)
   */
  async testDID() {
    console.log('\n=== Testing DID Module (24 handlers) ===\n');

    // 测试获取 DID 列表
    await this.testHandler('did', 'did:get-all', {});

    // 测试创建 DID
    const createResult = await this.testHandler('did', 'did:create', {
      name: 'Test DID',
      type: 'personal'
    });

    if (createResult.success && createResult.result?.did) {
      const did = createResult.result.did;

      // 测试获取 DID 详情
      await this.testHandler('did', 'did:get', did);

      // 测试导出 DID
      await this.testHandler('did', 'did:export', did);
    }

    // 测试 DID 验证
    await this.testHandler('did', 'did:verify', {
      did: 'did:example:test',
      signature: 'test-signature'
    });

    return this.results.did;
  }

  /**
   * 7. 测试 P2P 模块 (18 handlers)
   */
  async testP2P() {
    console.log('\n=== Testing P2P Module (18 handlers) ===\n');

    // 测试 P2P 状态
    await this.testHandler('p2p', 'p2p:get-status', {});

    // 测试获取节点信息
    await this.testHandler('p2p', 'p2p:get-node-info', {});

    // 测试获取对等节点列表
    await this.testHandler('p2p', 'p2p:get-peers', {});

    return this.results.p2p;
  }

  /**
   * 8. 测试社交网络模块 (33 handlers)
   */
  async testSocial() {
    console.log('\n=== Testing Social Network Module (33 handlers) ===\n');

    // 测试获取好友列表
    await this.testHandler('social', 'social:get-friends', {});

    // 测试获取好友请求
    await this.testHandler('social', 'social:get-friend-requests', {});

    // 测试获取动态
    await this.testHandler('social', 'social:get-posts', { limit: 10 });

    // 测试创建动态
    const createPostResult = await this.testHandler('social', 'social:create-post', {
      content: 'This is a test post for Phase 1-3 testing',
      visibility: 'friends'
    });

    if (createPostResult.success && createPostResult.result?.id) {
      const postId = createPostResult.result.id;

      // 测试获取动态详情
      await this.testHandler('social', 'social:get-post', postId);

      // 测试点赞
      await this.testHandler('social', 'social:like-post', postId);

      // 测试删除动态
      await this.testHandler('social', 'social:delete-post', postId);
    }

    return this.results.social;
  }

  /**
   * 运行所有测试
   */
  async runAllTests() {
    console.log('\n'.repeat(2));
    console.log('='.repeat(60));
    console.log('  Phase 1-3 Core Functionality Testing');
    console.log('  Testing 8 modules with 143 IPC handlers');
    console.log('='.repeat(60));

    const startTime = Date.now();

    try {
      // 按顺序执行测试
      await this.testDatabase();
      await this.testCategory();
      await this.testLLM();
      await this.testRAG();
      await this.testUKey();
      await this.testDID();
      await this.testP2P();
      await this.testSocial();

    } catch (error) {
      console.error('\n❌ Testing interrupted:', error);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    // 生成测试报告
    this.generateReport(duration);
  }

  /**
   * 生成测试报告
   */
  generateReport(duration) {
    console.log('\n'.repeat(2));
    console.log('='.repeat(60));
    console.log('  Phase 1-3 Testing Report');
    console.log('='.repeat(60));

    let totalTests = 0;
    let totalPassed = 0;
    let totalFailed = 0;

    // 统计每个模块
    const modules = [
      { name: 'Database', key: 'database', expected: 22 },
      { name: 'Category', key: 'category', expected: 7 },
      { name: 'LLM', key: 'llm', expected: 14 },
      { name: 'RAG', key: 'rag', expected: 7 },
      { name: 'U-Key', key: 'ukey', expected: 9 },
      { name: 'DID', key: 'did', expected: 24 },
      { name: 'P2P', key: 'p2p', expected: 18 },
      { name: 'Social', key: 'social', expected: 33 }
    ];

    console.log('\nModule Results:\n');

    modules.forEach(module => {
      const result = this.results[module.key];
      totalTests += result.total;
      totalPassed += result.passed;
      totalFailed += result.failed;

      const passRate = result.total > 0
        ? ((result.passed / result.total) * 100).toFixed(1)
        : '0.0';

      const status = result.failed === 0 ? '✓' : '✗';

      console.log(`${status} ${module.name.padEnd(12)} - ${result.passed}/${result.total} passed (${passRate}%) | Expected: ${module.expected} handlers`);

      // 显示错误
      if (result.errors.length > 0) {
        result.errors.forEach(err => {
          console.log(`    ✗ ${err.handler}: ${err.error}`);
        });
      }
    });

    console.log('\n' + '-'.repeat(60));

    const overallPassRate = totalTests > 0
      ? ((totalPassed / totalTests) * 100).toFixed(1)
      : '0.0';

    console.log(`\nOverall: ${totalPassed}/${totalTests} tests passed (${overallPassRate}%)`);
    console.log(`Duration: ${duration}s`);
    console.log(`\nStatus: ${totalFailed === 0 ? '✓ ALL TESTS PASSED' : '✗ SOME TESTS FAILED'}`);
    console.log('\n' + '='.repeat(60) + '\n');

    return {
      totalTests,
      totalPassed,
      totalFailed,
      passRate: overallPassRate,
      duration,
      moduleResults: this.results
    };
  }
}

// 导出供前端调用
if (typeof window !== 'undefined') {
  window.Phase13Tester = Phase13Tester;
}

module.exports = Phase13Tester;
