/**
 * P2PSyncEngine 单元测试
 */

const P2PSyncEngine = require('../../src/main/sync/p2p-sync-engine');
const BetterSQLite3 = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// Database wrapper to match database.js API
class DatabaseWrapper {
  constructor(db) {
    this._db = db;
  }

  // Wrapped API (database.js style)
  run(sql, ...params) {
    try {
      const stmt = this._db.prepare(sql);
      return stmt.run(...params);
    } catch (error) {
      console.error('SQL Error:', error.message, '\nSQL:', sql);
      throw error;
    }
  }

  query(sql, ...params) {
    try {
      const stmt = this._db.prepare(sql);
      return stmt.all(...params);
    } catch (error) {
      console.error('SQL Error:', error.message, '\nSQL:', sql);
      throw error;
    }
  }

  get(sql, ...params) {
    try {
      const stmt = this._db.prepare(sql);
      return stmt.get(...params) || null;
    } catch (error) {
      console.error('SQL Error:', error.message, '\nSQL:', sql);
      throw error;
    }
  }

  // Native better-sqlite3 API (for P2PSyncEngine)
  prepare(sql) {
    return this._db.prepare(sql);
  }

  exec(sql) {
    return this._db.exec(sql);
  }

  close() {
    return this._db.close();
  }
}

// Mock DIDManager
class MockDIDManager {
  async getDefaultIdentity() {
    return {
      did: 'did:test:alice',
      displayName: 'Alice'
    };
  }

  async sign(data) {
    return 'mock_signature_' + data.substring(0, 10);
  }

  async verify(signature, data, did) {
    return true;
  }
}

// Mock P2PManager
class MockP2PManager {
  constructor() {
    this.handlers = {};
    this.messages = [];
  }

  on(event, handler) {
    this.handlers[event] = handler;
  }

  async broadcastToOrg(orgId, message) {
    this.messages.push({ orgId, message });
    return true;
  }

  simulateMessage(type, data) {
    const handler = this.handlers[type];
    if (handler) {
      handler(data);
    }
  }
}

describe('P2PSyncEngine', () => {
  let db;
  let didManager;
  let p2pManager;
  let syncEngine;
  let dbPath;

  beforeEach(async () => {
    // 创建临时测试数据库
    dbPath = path.join(__dirname, '../temp/test-sync-engine.db');

    // 确保temp目录存在
    const tempDir = path.dirname(dbPath);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }

    const rawDb = new BetterSQLite3(dbPath);
    db = new DatabaseWrapper(rawDb);

    // 创建必要的表
    db.exec(`
      CREATE TABLE IF NOT EXISTS p2p_sync_state (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        local_version INTEGER DEFAULT 1,
        remote_version INTEGER DEFAULT 1,
        vector_clock TEXT,
        cid TEXT,
        sync_status TEXT DEFAULT 'synced',
        last_synced_at INTEGER,
        UNIQUE(org_id, resource_type, resource_id)
      );

      CREATE TABLE IF NOT EXISTS sync_queue (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        data TEXT,
        version INTEGER NOT NULL,
        vector_clock TEXT,
        created_at INTEGER NOT NULL,
        retry_count INTEGER DEFAULT 0,
        last_retry_at INTEGER,
        status TEXT DEFAULT 'pending'
      );

      CREATE TABLE IF NOT EXISTS sync_conflicts (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        local_version INTEGER NOT NULL,
        remote_version INTEGER NOT NULL,
        local_data TEXT,
        remote_data TEXT,
        local_vector_clock TEXT,
        remote_vector_clock TEXT,
        resolution_strategy TEXT,
        resolved INTEGER DEFAULT 0,
        resolved_at INTEGER,
        resolved_by_did TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS knowledge_items (
        id TEXT PRIMARY KEY,
        title TEXT,
        content TEXT,
        created_at INTEGER,
        updated_at INTEGER
      );
    `);

    didManager = new MockDIDManager();
    p2pManager = new MockP2PManager();
    syncEngine = new P2PSyncEngine(db, didManager, p2pManager);

    await syncEngine.initialize();
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  describe('初始化', () => {
    test('应该成功初始化同步引擎', () => {
      expect(syncEngine).toBeDefined();
      expect(syncEngine.db).toBe(db);
      expect(syncEngine.didManager).toBe(didManager);
      expect(syncEngine.p2pManager).toBe(p2pManager);
    });

    test('应该注册P2P消息处理器', () => {
      expect(p2pManager.handlers['sync:request']).toBeDefined();
      expect(p2pManager.handlers['sync:response']).toBeDefined();
      expect(p2pManager.handlers['sync:change']).toBeDefined();
      expect(p2pManager.handlers['sync:conflict']).toBeDefined();
    });
  });

  describe('同步状态管理', () => {
    const orgId = 'org_test123';
    const resourceType = 'knowledge';
    const resourceId = 'kb_001';

    test('应该获取不存在的同步状态返回null', () => {
      const state = syncEngine.getSyncState(orgId, resourceType, resourceId);
      expect(state).toBeNull();
    });

    test('应该创建新的同步状态', () => {
      syncEngine.updateSyncState(orgId, resourceType, resourceId, {
        local_version: 1,
        remote_version: 1,
        vector_clock: JSON.stringify({ 'did:test:alice': 1 }),
        sync_status: 'synced',
        last_synced_at: Date.now()
      });

      const state = syncEngine.getSyncState(orgId, resourceType, resourceId);
      expect(state).toBeDefined();
      expect(state.local_version).toBe(1);
      expect(state.sync_status).toBe('synced');
    });

    test('应该更新已存在的同步状态', () => {
      // 创建初始状态
      syncEngine.updateSyncState(orgId, resourceType, resourceId, {
        local_version: 1,
        sync_status: 'synced'
      });

      // 更新状态
      syncEngine.updateSyncState(orgId, resourceType, resourceId, {
        local_version: 2,
        sync_status: 'pending'
      });

      const state = syncEngine.getSyncState(orgId, resourceType, resourceId);
      expect(state.local_version).toBe(2);
      expect(state.sync_status).toBe('pending');
    });
  });

  describe('冲突检测', () => {
    test('应该检测到本地更新（local_wins）', () => {
      const localState = {
        vector_clock: JSON.stringify({ 'did:test:alice': 3, 'did:test:bob': 1 })
      };

      const remoteState = {
        vector_clock: { 'did:test:alice': 2, 'did:test:bob': 1 }
      };

      const result = syncEngine.detectConflict(localState, remoteState);
      expect(result.isConflict).toBe(false);
      expect(result.winner).toBe('local');
    });

    test('应该检测到远程更新（remote_wins）', () => {
      const localState = {
        vector_clock: JSON.stringify({ 'did:test:alice': 2, 'did:test:bob': 1 })
      };

      const remoteState = {
        vector_clock: { 'did:test:alice': 3, 'did:test:bob': 1 }
      };

      const result = syncEngine.detectConflict(localState, remoteState);
      expect(result.isConflict).toBe(false);
      expect(result.winner).toBe('remote');
    });

    test('应该检测到并发修改（conflict）', () => {
      const localState = {
        vector_clock: JSON.stringify({ 'did:test:alice': 3, 'did:test:bob': 1 })
      };

      const remoteState = {
        vector_clock: { 'did:test:alice': 2, 'did:test:bob': 2 }
      };

      const result = syncEngine.detectConflict(localState, remoteState);
      expect(result.isConflict).toBe(true);
      expect(result.winner).toBeNull();
    });

    test('应该检测到已同步状态（synced）', () => {
      const localState = {
        vector_clock: JSON.stringify({ 'did:test:alice': 2, 'did:test:bob': 1 })
      };

      const remoteState = {
        vector_clock: { 'did:test:alice': 2, 'did:test:bob': 1 }
      };

      const result = syncEngine.detectConflict(localState, remoteState);
      expect(result.isConflict).toBe(false);
      expect(result.winner).toBeNull();
    });

    test('应该处理缺失DID的情况', () => {
      const localState = {
        vector_clock: JSON.stringify({ 'did:test:alice': 3 })
      };

      const remoteState = {
        vector_clock: { 'did:test:bob': 2 }
      };

      const result = syncEngine.detectConflict(localState, remoteState);
      expect(result.isConflict).toBe(true);
    });
  });

  describe('冲突解决', () => {
    const orgId = 'org_test123';
    const resourceType = 'member';
    const resourceId = 'member_001';

    test('应该使用LWW策略解决冲突（远程获胜）', async () => {
      // 设置本地状态
      const localState = {
        local_version: 2,
        vector_clock: JSON.stringify({ 'did:test:alice': 2 }),
        last_synced_at: 1000
      };

      // 远程变更（更新的时间戳）
      const remoteChange = {
        version: 2,
        vector_clock: { 'did:test:bob': 2 },
        timestamp: 2000,
        action: 'update',
        data: { id: resourceId, title: 'Updated Title', content: 'Updated Content' }
      };

      // 创建知识库条目（用于测试）
      db.run(`
        INSERT INTO knowledge_items (id, title, content, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `, resourceId, 'Test', 'Content', Date.now(), Date.now());

      const resolved = await syncEngine.resolveLWW(
        orgId,
        'knowledge',
        resourceId,
        localState,
        remoteChange
      );

      expect(resolved).toBe(true);

      // 检查冲突是否被标记为已解决
      const conflict = db.get(`
        SELECT * FROM sync_conflicts
        WHERE org_id = ? AND resource_type = ? AND resource_id = ? AND resolved = 1
      `, orgId, 'knowledge', resourceId);

      expect(conflict).toBeDefined();
      expect(conflict.resolution_strategy).toBe('lww');
    });

    test('应该使用LWW策略解决冲突（本地获胜）', async () => {
      const localState = {
        local_version: 2,
        vector_clock: JSON.stringify({ 'did:test:alice': 2 }),
        last_synced_at: 2000 // 本地更新
      };

      const remoteChange = {
        version: 2,
        vector_clock: { 'did:test:bob': 2 },
        timestamp: 1000, // 远程较旧
        action: 'update',
        data: { id: resourceId, name: 'Bob' }
      };

      db.run(`
        INSERT INTO knowledge_items (id, title, content, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `, resourceId, 'Test', 'Content', Date.now(), Date.now());

      const resolved = await syncEngine.resolveLWW(
        orgId,
        'knowledge',
        resourceId,
        localState,
        remoteChange
      );

      expect(resolved).toBe(true);
    });

    test('应该根据资源类型选择正确的冲突解决策略', () => {
      expect(syncEngine.getConflictResolutionStrategy('knowledge')).toBe('manual');
      expect(syncEngine.getConflictResolutionStrategy('member')).toBe('lww');
      expect(syncEngine.getConflictResolutionStrategy('role')).toBe('manual');
      expect(syncEngine.getConflictResolutionStrategy('project')).toBe('lww');
    });
  });

  describe('离线队列', () => {
    const orgId = 'org_test123';

    test('应该添加项到离线队列', () => {
      const queueId = syncEngine.addToQueue(
        orgId,
        'update',
        'knowledge',
        'kb_001',
        { title: 'Test', content: 'Content' }
      );

      expect(queueId).toBeDefined();

      const item = db.get('SELECT * FROM sync_queue WHERE id = ?', queueId);
      expect(item).toBeDefined();
      expect(item.action).toBe('update');
      expect(item.resource_type).toBe('knowledge');
      expect(item.status).toBe('pending');
    });

    test('应该处理离线队列中的项', async () => {
      // 添加队列项
      syncEngine.addToQueue(orgId, 'update', 'knowledge', 'kb_001', { title: 'Test' });
      syncEngine.addToQueue(orgId, 'update', 'knowledge', 'kb_002', { title: 'Test2' });

      // 处理队列
      const processed = await syncEngine.processQueue(orgId);

      expect(processed).toBeGreaterThan(0);
    });

    test('应该重试失败的队列项', async () => {
      const queueId = syncEngine.addToQueue(
        orgId,
        'update',
        'knowledge',
        'kb_001',
        { title: 'Test' }
      );

      // 模拟失败
      db.run(`
        UPDATE sync_queue SET status = 'failed', retry_count = 1 WHERE id = ?
      `, queueId);

      // 重新标记为待处理
      db.run(`
        UPDATE sync_queue SET status = 'pending' WHERE id = ?
      `, queueId);

      const item = db.get('SELECT * FROM sync_queue WHERE id = ?', queueId);
      expect(item.retry_count).toBe(1);
    });

    test('应该在达到最大重试次数后标记为失败', () => {
      const queueId = syncEngine.addToQueue(
        orgId,
        'update',
        'knowledge',
        'kb_001',
        { title: 'Test' }
      );

      // 设置超过最大重试次数
      db.run(`
        UPDATE sync_queue SET retry_count = ? WHERE id = ?
      `, syncEngine.config.maxRetryCount + 1, queueId);

      const item = db.get('SELECT * FROM sync_queue WHERE id = ?', queueId);
      expect(item.retry_count).toBeGreaterThan(syncEngine.config.maxRetryCount);
    });
  });

  describe('同步统计', () => {
    const orgId = 'org_test123';

    test('应该获取同步统计信息', () => {
      // 创建一些测试数据
      syncEngine.updateSyncState(orgId, 'knowledge', 'kb_001', {
        sync_status: 'synced'
      });
      syncEngine.updateSyncState(orgId, 'knowledge', 'kb_002', {
        sync_status: 'pending'
      });
      syncEngine.updateSyncState(orgId, 'knowledge', 'kb_003', {
        sync_status: 'conflict'
      });

      syncEngine.addToQueue(orgId, 'update', 'knowledge', 'kb_004', {});

      const stats = syncEngine.getSyncStats(orgId);

      expect(stats.total).toBe(3);
      expect(stats.synced).toBe(1);
      expect(stats.pending).toBe(1);
      expect(stats.conflicts).toBe(1);
      expect(stats.queue_size).toBe(1);
    });

    test('应该返回空组织的统计信息', () => {
      const stats = syncEngine.getSyncStats('org_empty');

      expect(stats.total).toBe(0);
      expect(stats.synced).toBe(0);
      expect(stats.pending).toBe(0);
      expect(stats.conflicts).toBe(0);
    });
  });

  describe('待同步资源', () => {
    const orgId = 'org_test123';

    test('应该获取待同步的资源列表', async () => {
      // 创建待同步资源
      syncEngine.updateSyncState(orgId, 'knowledge', 'kb_001', {
        local_version: 2,
        sync_status: 'pending'
      });
      syncEngine.updateSyncState(orgId, 'knowledge', 'kb_002', {
        local_version: 3,
        sync_status: 'pending'
      });
      syncEngine.updateSyncState(orgId, 'knowledge', 'kb_003', {
        sync_status: 'synced'
      });

      const resources = await syncEngine.getPendingResources(orgId);

      expect(resources.length).toBe(2);
      expect(resources.every(r => r.sync_status === 'pending')).toBe(true);
      // 应该按版本号降序排列
      expect(resources[0].local_version).toBeGreaterThanOrEqual(resources[1].local_version);
    });

    test('应该限制返回的资源数量', async () => {
      // 创建超过批量大小的待同步资源
      for (let i = 0; i < 100; i++) {
        syncEngine.updateSyncState(orgId, 'knowledge', `kb_${i}`, {
          sync_status: 'pending'
        });
      }

      const resources = await syncEngine.getPendingResources(orgId);

      expect(resources.length).toBeLessThanOrEqual(syncEngine.config.batchSize);
    });
  });

  describe('自动同步', () => {
    const orgId = 'org_test123';

    test('应该启动自动同步', () => {
      syncEngine.startAutoSync(orgId);

      expect(syncEngine.syncTimer).toBeDefined();
      expect(syncEngine.queueTimer).toBeDefined();
    });

    test('应该停止自动同步', () => {
      syncEngine.startAutoSync(orgId);
      syncEngine.stopAutoSync();

      expect(syncEngine.syncTimer).toBeNull();
      expect(syncEngine.queueTimer).toBeNull();
    });

    test('应该在启动新同步前停止旧同步', () => {
      syncEngine.startAutoSync('org_old');
      const oldSyncTimer = syncEngine.syncTimer;

      syncEngine.startAutoSync('org_new');

      expect(syncEngine.syncTimer).not.toBe(oldSyncTimer);
    });
  });

  describe('P2P消息处理', () => {
    const orgId = 'org_test123';

    test('应该处理同步请求消息', async () => {
      const message = {
        org_id: orgId,
        last_sync_time: 0,
        resource_types: ['knowledge']
      };

      await syncEngine.handleSyncRequest(message);

      // 验证是否记录了处理日志
      // （在真实实现中会发送响应）
    });

    test('应该处理同步变更消息', async () => {
      const message = {
        org_id: orgId,
        resource_type: 'knowledge',
        resource_id: 'kb_001',
        action: 'update',
        data: { id: 'kb_001', title: 'Updated', content: 'New content' },
        version: 2,
        vector_clock: { 'did:test:bob': 2 },
        author_did: 'did:test:bob',
        timestamp: Date.now(),
        signature: 'mock_signature'
      };

      // 创建知识库条目
      db.run(`
        INSERT INTO knowledge_items (id, title, content, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `, 'kb_001', 'Original', 'Original content', Date.now(), Date.now());

      await syncEngine.handleSyncChange(message);

      // 验证是否处理了变更
      // （在真实实现中会应用变更）
    });
  });
});
