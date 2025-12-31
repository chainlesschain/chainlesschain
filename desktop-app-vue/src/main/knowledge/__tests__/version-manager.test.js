const { KnowledgeVersionManager } = require('../version-manager');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

describe('KnowledgeVersionManager', () => {
  let db;
  let versionManager;
  let testKnowledgeId;
  let testUserId;

  beforeAll(() => {
    // 创建内存数据库用于测试
    db = new Database(':memory:');
    versionManager = new KnowledgeVersionManager(db);
    testKnowledgeId = 'test-knowledge-001';
    testUserId = 'did:test:user001';

    // 创建必要的表
    createTables();
    createTestData();
  });

  afterAll(() => {
    db.close();
  });

  function createTables() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_items (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT,
        org_id TEXT,
        created_by TEXT,
        updated_by TEXT,
        share_scope TEXT DEFAULT 'private',
        version INTEGER DEFAULT 1,
        parent_version_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS knowledge_version_history (
        id TEXT PRIMARY KEY,
        knowledge_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        title TEXT NOT NULL,
        content TEXT,
        content_snapshot TEXT,
        created_by TEXT,
        updated_by TEXT,
        git_commit_hash TEXT,
        cid TEXT,
        parent_version_id TEXT,
        change_summary TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(knowledge_id, version)
      );

      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        color TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS knowledge_tags (
        knowledge_id TEXT NOT NULL,
        tag_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (knowledge_id, tag_id)
      );
    `);
  }

  function createTestData() {
    const now = Date.now();

    // 插入测试知识
    db.prepare(`
      INSERT INTO knowledge_items (
        id, title, type, content, created_by, updated_by,
        share_scope, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      testKnowledgeId,
      '测试知识',
      'note',
      '这是测试内容',
      testUserId,
      testUserId,
      'org',
      1,
      now,
      now
    );
  }

  describe('createVersionSnapshot', () => {
    test('应该成功创建版本快照', async () => {
      const result = await versionManager.createVersionSnapshot(
        testKnowledgeId,
        testUserId,
        { changeSummary: '测试创建版本' }
      );

      expect(result.success).toBe(true);
      expect(result.versionId).toBeDefined();
      expect(result.version).toBe(2); // 第一个版本是1，这是第二个版本
    });

    test('应该正确保存版本内容快照', async () => {
      const result = await versionManager.createVersionSnapshot(
        testKnowledgeId,
        testUserId
      );

      const version = versionManager.getVersion(result.versionId);
      expect(version).toBeDefined();
      expect(version.content_snapshot).toBeDefined();
      expect(version.content_snapshot.title).toBe('测试知识');
      expect(version.content_snapshot.content).toBe('这是测试内容');
    });

    test('对不存在的知识创建版本应该失败', async () => {
      const result = await versionManager.createVersionSnapshot(
        'non-existent-id',
        testUserId
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('知识不存在');
    });
  });

  describe('getVersionHistory', () => {
    test('应该返回所有版本历史', () => {
      const versions = versionManager.getVersionHistory(testKnowledgeId);

      expect(Array.isArray(versions)).toBe(true);
      expect(versions.length).toBeGreaterThan(0);
    });

    test('应该按版本号降序排列', () => {
      const versions = versionManager.getVersionHistory(testKnowledgeId);

      for (let i = 0; i < versions.length - 1; i++) {
        expect(versions[i].version).toBeGreaterThanOrEqual(versions[i + 1].version);
      }
    });

    test('应该支持限制返回数量', () => {
      const versions = versionManager.getVersionHistory(testKnowledgeId, 2);

      expect(versions.length).toBeLessThanOrEqual(2);
    });
  });

  describe('restoreVersion', () => {
    let versionToRestore;

    beforeAll(async () => {
      // 先创建几个版本
      await versionManager.createVersionSnapshot(testKnowledgeId, testUserId, {
        changeSummary: 'Version 1'
      });

      // 修改知识内容
      db.prepare(`
        UPDATE knowledge_items
        SET content = ?, updated_at = ?
        WHERE id = ?
      `).run('修改后的内容', Date.now(), testKnowledgeId);

      const result = await versionManager.createVersionSnapshot(testKnowledgeId, testUserId, {
        changeSummary: 'Version 2 with modified content'
      });

      // 再次修改
      db.prepare(`
        UPDATE knowledge_items
        SET content = ?, updated_at = ?
        WHERE id = ?
      `).run('再次修改的内容', Date.now(), testKnowledgeId);

      await versionManager.createVersionSnapshot(testKnowledgeId, testUserId, {
        changeSummary: 'Version 3'
      });

      // 获取第二个版本用于恢复
      const versions = versionManager.getVersionHistory(testKnowledgeId);
      versionToRestore = versions.find(v => v.change_summary === 'Version 2 with modified content');
    });

    test('应该成功恢复到指定版本', async () => {
      const result = await versionManager.restoreVersion(
        testKnowledgeId,
        versionToRestore.id,
        testUserId
      );

      expect(result.success).toBe(true);
      expect(result.restoredToVersion).toBe(versionToRestore.version);
      expect(result.newVersion).toBeDefined();
    });

    test('恢复后内容应该与目标版本一致', async () => {
      await versionManager.restoreVersion(
        testKnowledgeId,
        versionToRestore.id,
        testUserId
      );

      const knowledge = db.prepare('SELECT * FROM knowledge_items WHERE id = ?').get(testKnowledgeId);
      expect(knowledge.content).toBe(versionToRestore.content);
    });

    test('恢复前应该创建备份版本', async () => {
      const beforeVersions = versionManager.getVersionHistory(testKnowledgeId);
      const beforeCount = beforeVersions.length;

      await versionManager.restoreVersion(
        testKnowledgeId,
        versionToRestore.id,
        testUserId
      );

      const afterVersions = versionManager.getVersionHistory(testKnowledgeId);
      const afterCount = afterVersions.length;

      // 恢复操作会创建2个版本：备份版本 + 恢复版本
      expect(afterCount).toBe(beforeCount + 2);
    });

    test('恢复不存在的版本应该失败', async () => {
      const result = await versionManager.restoreVersion(
        testKnowledgeId,
        'non-existent-version',
        testUserId
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('版本不存在');
    });
  });

  describe('compareVersions', () => {
    let version1, version2;

    beforeAll(async () => {
      const result1 = await versionManager.createVersionSnapshot(testKnowledgeId, testUserId);
      version1 = result1.versionId;

      // 修改内容
      db.prepare(`
        UPDATE knowledge_items
        SET content = ?, updated_at = ?
        WHERE id = ?
      `).run('完全不同的内容\n第二行\n第三行', Date.now(), testKnowledgeId);

      const result2 = await versionManager.createVersionSnapshot(testKnowledgeId, testUserId);
      version2 = result2.versionId;
    });

    test('应该成功对比两个版本', () => {
      const result = versionManager.compareVersions(version1, version2);

      expect(result.success).toBe(true);
      expect(result.version1).toBeDefined();
      expect(result.version2).toBeDefined();
      expect(result.diff).toBeDefined();
    });

    test('应该正确检测内容变化', () => {
      const result = versionManager.compareVersions(version1, version2);

      expect(result.diff.contentChanged).toBe(true);
    });

    test('对比不存在的版本应该失败', () => {
      const result = versionManager.compareVersions('non-existent-1', version2);

      expect(result.success).toBe(false);
    });
  });

  describe('getVersionStats', () => {
    test('应该返回版本统计信息', () => {
      const stats = versionManager.getVersionStats(testKnowledgeId);

      expect(stats).toBeDefined();
      expect(stats.total_versions).toBeGreaterThan(0);
      expect(stats.first_version_at).toBeDefined();
      expect(stats.last_version_at).toBeDefined();
      expect(stats.contributors).toBeGreaterThan(0);
    });
  });

  describe('pruneOldVersions', () => {
    beforeAll(async () => {
      // 创建10个版本
      for (let i = 0; i < 10; i++) {
        await versionManager.createVersionSnapshot(testKnowledgeId, testUserId, {
          changeSummary: `Test version ${i}`
        });
      }
    });

    test('应该保留指定数量的最新版本', () => {
      const keepCount = 5;
      const result = versionManager.pruneOldVersions(testKnowledgeId, keepCount);

      expect(result.success).toBe(true);

      const versions = versionManager.getVersionHistory(testKnowledgeId);
      expect(versions.length).toBeLessThanOrEqual(keepCount);
    });

    test('版本数量少于限制时不应删除', () => {
      const keepCount = 100;
      const result = versionManager.pruneOldVersions(testKnowledgeId, keepCount);

      expect(result.success).toBe(true);
      expect(result.deleted).toBe(0);
    });
  });
});
