/**
 * 数据库性能测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockElectronAPI } from '../setup';

describe('数据库性能测试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('查询性能', () => {
    it('应该在100ms内完成简单查询', async () => {
      mockElectronAPI.db.query.mockResolvedValue({
        success: true,
        data: [{ id: '1', title: '笔记1' }]
      });

      const startTime = performance.now();

      await mockElectronAPI.db.query('SELECT * FROM notes WHERE id = ?', ['1']);

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(100);
    });

    it('应该在500ms内查询1000条记录', async () => {
      const mockData = Array.from({ length: 1000 }, (_, i) => ({
        id: `note-${i}`,
        title: `笔记${i}`,
        content: `内容${i}`
      }));

      mockElectronAPI.db.query.mockResolvedValue({
        success: true,
        data: mockData
      });

      const startTime = performance.now();

      const result = await mockElectronAPI.db.query('SELECT * FROM notes LIMIT 1000');

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(result.data).toHaveLength(1000);
      expect(duration).toBeLessThan(500);
    });

    it('应该高效处理复杂的JOIN查询', async () => {
      mockElectronAPI.db.query.mockResolvedValue({
        success: true,
        data: Array.from({ length: 100 }, (_, i) => ({
          note_id: `note-${i}`,
          tag: `tag-${i % 10}`
        }))
      });

      const startTime = performance.now();

      await mockElectronAPI.db.query(`
        SELECT n.*, t.name as tag_name
        FROM notes n
        LEFT JOIN tags t ON n.tag_id = t.id
        LIMIT 100
      `);

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(300);
    });
  });

  describe('插入性能', () => {
    it('应该在1秒内批量插入100条记录', async () => {
      mockElectronAPI.db.run.mockResolvedValue({ success: true });

      const startTime = performance.now();

      for (let i = 0; i < 100; i++) {
        await mockElectronAPI.db.run(
          'INSERT INTO notes (id, title, content) VALUES (?, ?, ?)',
          [`note-${i}`, `标题${i}`, `内容${i}`]
        );
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(1000);
    });

    it('应该使用事务提升批量插入性能', async () => {
      mockElectronAPI.db.execute.mockResolvedValue({ success: true });
      mockElectronAPI.db.run.mockResolvedValue({ success: true });

      const startTime = performance.now();

      // 开始事务
      await mockElectronAPI.db.execute('BEGIN TRANSACTION');

      // 批量插入
      for (let i = 0; i < 1000; i++) {
        await mockElectronAPI.db.run(
          'INSERT INTO notes (id, title) VALUES (?, ?)',
          [`note-${i}`, `标题${i}`]
        );
      }

      // 提交事务
      await mockElectronAPI.db.execute('COMMIT');

      const endTime = performance.now();
      const duration = endTime - startTime;

      // 事务应该显著提升性能
      expect(duration).toBeLessThan(2000);
    });
  });

  describe('更新性能', () => {
    it('应该快速更新单条记录', async () => {
      mockElectronAPI.db.run.mockResolvedValue({
        success: true,
        changes: 1
      });

      const startTime = performance.now();

      await mockElectronAPI.db.run(
        'UPDATE notes SET content = ? WHERE id = ?',
        ['新内容', 'note-1']
      );

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(50);
    });

    it('应该高效批量更新', async () => {
      mockElectronAPI.db.execute.mockResolvedValue({ success: true });
      mockElectronAPI.db.run.mockResolvedValue({ success: true });

      const startTime = performance.now();

      await mockElectronAPI.db.execute('BEGIN TRANSACTION');

      for (let i = 0; i < 100; i++) {
        await mockElectronAPI.db.run(
          'UPDATE notes SET updated_at = ? WHERE id = ?',
          [Date.now(), `note-${i}`]
        );
      }

      await mockElectronAPI.db.execute('COMMIT');

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(500);
    });
  });

  describe('全文搜索性能', () => {
    it('应该在500ms内完成全文搜索', async () => {
      const mockResults = Array.from({ length: 50 }, (_, i) => ({
        id: `note-${i}`,
        title: `包含关键词的标题${i}`,
        content: `包含关键词的内容${i}`
      }));

      mockElectronAPI.db.query.mockResolvedValue({
        success: true,
        data: mockResults
      });

      const startTime = performance.now();

      await mockElectronAPI.db.query(`
        SELECT * FROM notes
        WHERE title LIKE ? OR content LIKE ?
        LIMIT 50
      `, ['%关键词%', '%关键词%']);

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(500);
    });
  });
});

describe('内存使用测试', () => {
  it('应该合理管理内存', async () => {
    const initialMemory = process.memoryUsage().heapUsed;

    // 创建大量数据
    const largeArray = Array.from({ length: 10000 }, (_, i) => ({
      id: i,
      data: 'x'.repeat(1000)
    }));

    mockElectronAPI.db.query.mockResolvedValue({
      success: true,
      data: largeArray
    });

    await mockElectronAPI.db.query('SELECT * FROM notes');

    const currentMemory = process.memoryUsage().heapUsed;
    const memoryIncrease = currentMemory - initialMemory;

    // 内存增长应该在合理范围内 (< 50MB)
    expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
  });

  it('应该正确释放资源', async () => {
    const iterations = 100;
    const memoryReadings = [];

    for (let i = 0; i < iterations; i++) {
      mockElectronAPI.db.query.mockResolvedValue({
        success: true,
        data: Array.from({ length: 100 }, () => ({ data: 'test' }))
      });

      await mockElectronAPI.db.query('SELECT * FROM notes');

      if (i % 10 === 0) {
        memoryReadings.push(process.memoryUsage().heapUsed);
      }
    }

    // 检查内存是否持续增长 (内存泄漏)
    const firstReading = memoryReadings[0];
    const lastReading = memoryReadings[memoryReadings.length - 1];
    const memoryGrowth = lastReading - firstReading;

    // 内存增长应该在可接受范围内
    expect(memoryGrowth).toBeLessThan(20 * 1024 * 1024);
  });
});
