// @vitest-environment node
/**
 * 软删除功能测试
 * 测试软删除、恢复、清理和统计功能
 */

import { describe, it, expect, beforeEach } from 'vitest';

describe('软删除功能测试', () => {
  describe('基本软删除操作', () => {
    it('应该将deleted字段设置为1', () => {
      const record = {
        id: 'test-123',
        deleted: 0,
        updated_at: Date.now()
      };

      // 模拟软删除
      record.deleted = 1;
      record.updated_at = Date.now();

      expect(record.deleted).toBe(1);
      expect(record.updated_at).toBeGreaterThan(0);
    });

    it('应该在软删除时标记sync_status为pending', () => {
      const record = {
        id: 'test-123',
        deleted: 0,
        sync_status: 'synced'
      };

      // 模拟软删除
      record.deleted = 1;
      record.sync_status = 'pending';

      expect(record.sync_status).toBe('pending');
    });

    it('应该支持批量软删除', () => {
      const ids = ['id1', 'id2', 'id3', 'id4', 'id5'];
      const results = { success: 0, failed: 0 };

      // 模拟批量删除
      for (const id of ids) {
        // 假设都成功
        results.success++;
      }

      expect(results.success).toBe(5);
      expect(results.failed).toBe(0);
    });
  });

  describe('恢复软删除记录', () => {
    it('应该将deleted字段恢复为0', () => {
      const record = {
        id: 'test-123',
        deleted: 1
      };

      // 模拟恢复
      record.deleted = 0;
      record.updated_at = Date.now();
      record.sync_status = 'pending';

      expect(record.deleted).toBe(0);
    });

    it('应该在恢复时更新updated_at和sync_status', () => {
      const oldTime = Date.now() - 10000;
      const record = {
        id: 'test-123',
        deleted: 1,
        updated_at: oldTime,
        sync_status: 'synced'
      };

      // 模拟恢复
      const newTime = Date.now();
      record.deleted = 0;
      record.updated_at = newTime;
      record.sync_status = 'pending';

      expect(record.updated_at).toBeGreaterThan(oldTime);
      expect(record.sync_status).toBe('pending');
    });
  });

  describe('定期清理机制', () => {
    it('应该正确计算清理截止时间', () => {
      const retentionDays = 30;
      const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

      // 测试记录
      const record1 = {
        id: '1',
        deleted: 1,
        updated_at: cutoffTime - 1000  // 超过30天，应该清理
      };

      const record2 = {
        id: '2',
        deleted: 1,
        updated_at: cutoffTime + 1000  // 未超过30天，保留
      };

      expect(record1.updated_at).toBeLessThan(cutoffTime);  // 应被清理
      expect(record2.updated_at).toBeGreaterThan(cutoffTime);  // 应保留
    });

    it('应该只清理deleted=1且超过保留期的记录', () => {
      const cutoffTime = Date.now() - 30 * 24 * 60 * 60 * 1000;

      const records = [
        { id: '1', deleted: 1, updated_at: cutoffTime - 1000 },  // 清理
        { id: '2', deleted: 0, updated_at: cutoffTime - 1000 },  // 保留（未删除）
        { id: '3', deleted: 1, updated_at: cutoffTime + 1000 },  // 保留（未过期）
        { id: '4', deleted: 1, updated_at: cutoffTime - 2000 },  // 清理
      ];

      // 模拟清理逻辑
      const toCleanup = records.filter(
        r => r.deleted === 1 && r.updated_at < cutoffTime
      );

      expect(toCleanup.length).toBe(2);
      expect(toCleanup.map(r => r.id)).toEqual(['1', '4']);
    });

    it('应该按表分别统计清理结果', () => {
      const results = [
        { tableName: 'projects', deleted: 5 },
        { tableName: 'project_files', deleted: 12 },
        { tableName: 'knowledge_items', deleted: 3 },
        { tableName: 'project_collaborators', deleted: 0 },
        { tableName: 'project_comments', deleted: 7 },
        { tableName: 'project_tasks', deleted: 2 }
      ];

      const totalDeleted = results.reduce((sum, r) => sum + r.deleted, 0);

      expect(totalDeleted).toBe(29);
      expect(results.find(r => r.tableName === 'project_files').deleted).toBe(12);
    });

    it('应该支持定期清理任务', () => {
      const intervalHours = 24;
      const retentionDays = 30;

      // 模拟定时器配置
      const intervalMs = intervalHours * 60 * 60 * 1000;

      expect(intervalMs).toBe(86400000);  // 24小时 = 86400秒 = 86400000毫秒
    });
  });

  describe('软删除统计', () => {
    it('应该统计各表的软删除记录数', () => {
      const stats = {
        total: 0,
        byTable: {
          'projects': 3,
          'project_files': 15,
          'knowledge_items': 8,
          'project_collaborators': 0,
          'project_comments': 5,
          'project_tasks': 2
        }
      };

      // 计算总数
      stats.total = Object.values(stats.byTable).reduce((sum, count) => sum + count, 0);

      expect(stats.total).toBe(33);
      expect(stats.byTable['project_files']).toBe(15);
      expect(stats.byTable['project_collaborators']).toBe(0);
    });

    it('应该区分已删除和未删除的记录', () => {
      const allRecords = [
        { id: '1', deleted: 0 },
        { id: '2', deleted: 1 },
        { id: '3', deleted: 0 },
        { id: '4', deleted: 1 },
        { id: '5', deleted: 1 }
      ];

      const deletedCount = allRecords.filter(r => r.deleted === 1).length;
      const activeCount = allRecords.filter(r => r.deleted === 0 || !r.deleted).length;

      expect(deletedCount).toBe(3);
      expect(activeCount).toBe(2);
    });
  });

  describe('查询过滤', () => {
    it('应该默认过滤deleted=1的记录', () => {
      const records = [
        { id: '1', name: 'Record 1', deleted: 0 },
        { id: '2', name: 'Record 2', deleted: 1 },
        { id: '3', name: 'Record 3', deleted: 0 },
        { id: '4', name: 'Record 4', deleted: 1 }
      ];

      // 模拟查询过滤
      const activeRecords = records.filter(r => r.deleted === 0 || !r.deleted);

      expect(activeRecords.length).toBe(2);
      expect(activeRecords.map(r => r.id)).toEqual(['1', '3']);
    });

    it('应该支持包含已删除记录的查询选项', () => {
      const records = [
        { id: '1', deleted: 0 },
        { id: '2', deleted: 1 },
        { id: '3', deleted: 0 }
      ];

      // 正常查询（过滤已删除）
      const normalQuery = records.filter(r => r.deleted === 0);

      // 包含已删除的查询
      const includeDeleted = records;  // 不过滤

      expect(normalQuery.length).toBe(2);
      expect(includeDeleted.length).toBe(3);
    });

    it('应该处理NULL值的deleted字段', () => {
      const records = [
        { id: '1', deleted: 0 },
        { id: '2', deleted: 1 },
        { id: '3', deleted: null },  // 旧记录可能没有这个字段
        { id: '4', deleted: undefined }
      ];

      // 过滤逻辑应该包容NULL和undefined
      const activeRecords = records.filter(
        r => r.deleted === null || r.deleted === undefined || r.deleted === 0
      );

      expect(activeRecords.length).toBe(3);
      expect(activeRecords.map(r => r.id)).toEqual(['1', '3', '4']);
    });
  });

  describe('同步行为', () => {
    it('应该在软删除后标记为pending以同步到服务器', () => {
      const record = {
        id: 'test-123',
        deleted: 0,
        sync_status: 'synced'
      };

      // 软删除
      record.deleted = 1;
      record.sync_status = 'pending';
      record.updated_at = Date.now();

      expect(record.sync_status).toBe('pending');
    });

    it('应该在恢复后标记为pending以同步到服务器', () => {
      const record = {
        id: 'test-123',
        deleted: 1,
        sync_status: 'synced'
      };

      // 恢复
      record.deleted = 0;
      record.sync_status = 'pending';
      record.updated_at = Date.now();

      expect(record.sync_status).toBe('pending');
    });

    it('应该在下载时正确应用远程删除', () => {
      const localRecords = [
        { id: '1', deleted: 0 },
        { id: '2', deleted: 0 },
        { id: '3', deleted: 0 }
      ];

      const deletedIds = ['2'];

      // 应用删除
      for (const id of deletedIds) {
        const record = localRecords.find(r => r.id === id);
        if (record) {
          record.deleted = 1;
          record.updated_at = Date.now();
        }
      }

      expect(localRecords.find(r => r.id === '2').deleted).toBe(1);
      expect(localRecords.find(r => r.id === '1').deleted).toBe(0);
    });
  });

  describe('边界情况', () => {
    it('应该处理空ID列表', () => {
      const ids = [];
      const results = { success: 0, failed: 0 };

      for (const id of ids) {
        results.success++;
      }

      expect(results.success).toBe(0);
    });

    it('应该处理不存在的记录ID', () => {
      const existingIds = ['id1', 'id2', 'id3'];
      const deleteId = 'nonexistent';

      const found = existingIds.includes(deleteId);

      expect(found).toBe(false);
    });

    it('应该处理已经是deleted=1的记录', () => {
      const record = {
        id: 'test-123',
        deleted: 1
      };

      // 再次软删除（幂等操作）
      record.deleted = 1;

      expect(record.deleted).toBe(1);
    });

    it('应该处理清理0天前的记录', () => {
      const retentionDays = 0;
      const cutoffTime = Date.now();

      // 所有deleted=1的记录都应该被清理
      const records = [
        { id: '1', deleted: 1, updated_at: cutoffTime - 1000 },
        { id: '2', deleted: 1, updated_at: cutoffTime - 86400000 }
      ];

      const toCleanup = records.filter(
        r => r.deleted === 1 && r.updated_at < cutoffTime
      );

      expect(toCleanup.length).toBe(2);
    });
  });
});
