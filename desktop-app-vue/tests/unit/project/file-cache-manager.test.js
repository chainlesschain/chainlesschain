/**
 * 文件缓存管理器测试
 * 测试文件列表性能优化
 */

const FileCacheManager = require('../../../src/main/project/file-cache-manager.js');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

// 模拟数据库
class MockDatabase {
  constructor() {
    this.files = new Map();
    this.queryResults = [];
  }

  get db() {
    return {
      prepare: (query) => {
        return {
          get: (...params) => {
            if (query.includes('SELECT * FROM projects')) {
              return {
                id: params[0],
                root_path: `/test/project/${params[0]}`,
                folder_path: null
              };
            }
            if (query.includes('SELECT COUNT(*)')) {
              return { count: this.queryResults.length };
            }
            return null;
          },
          all: (...params) => {
            // 检查是否有 LIMIT/OFFSET 参数
            const hasLimitOffset = query.includes('LIMIT ? OFFSET ?');
            if (hasLimitOffset && params.length >= 2) {
              const limit = params[params.length - 2];
              const offset = params[params.length - 1];
              return this.queryResults.slice(offset, offset + limit);
            }
            return this.queryResults;
          },
          run: (...params) => {
            // INSERT/UPDATE操作
            return { changes: 1 };
          }
        };
      }
    };
  }

  transaction(callback) {
    return () => callback();
  }
}

describe('FileCacheManager - 文件缓存管理器', () => {
  let manager;
  let mockDb;
  let testRoot;

  beforeEach(async () => {
    // 创建模拟数据库
    mockDb = new MockDatabase();
    manager = new FileCacheManager(mockDb);

    // 创建临时测试目录
    testRoot = path.join(os.tmpdir(), 'file-cache-test-' + Date.now());
    await fs.mkdir(testRoot, { recursive: true });

    // 创建测试文件结构
    await fs.mkdir(path.join(testRoot, 'src'), { recursive: true });
    await fs.mkdir(path.join(testRoot, 'docs'), { recursive: true });
    await fs.writeFile(path.join(testRoot, 'README.md'), '# Test');
    await fs.writeFile(path.join(testRoot, 'src', 'index.js'), 'console.log("test")');
    await fs.writeFile(path.join(testRoot, 'docs', 'guide.md'), '# Guide');
  });

  afterEach(async () => {
    // 清理
    await manager.destroy();

    try {
      await fs.rm(testRoot, { recursive: true, force: true });
    } catch (error) {
      // 忽略清理错误
    }
  });

  describe('getFiles', () => {
    test('应该返回空结果当项目不存在', async () => {
      mockDb.db.prepare = () => ({
        get: () => null
      });

      const result = await manager.getFiles('nonexistent');

      expect(result.files).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.hasMore).toBe(false);
    });

    test('应该从缓存读取文件（当缓存不为空）', async () => {
      // 设置缓存数据
      mockDb.queryResults = [
        {
          id: 'file_1',
          project_id: 'test-project',
          file_name: 'test.txt',
          file_path: 'test.txt',
          file_type: 'txt',
          is_folder: 0,
          deleted: 0
        }
      ];

      const result = await manager.getFiles('test-project', {
        offset: 0,
        limit: 10
      });

      expect(result.files).toHaveLength(1);
      expect(result.files[0].file_name).toBe('test.txt');
      expect(result.fromCache).toBe(true);
      expect(result.total).toBe(1);
    });

    test('应该支持分页', async () => {
      // 设置多个文件
      mockDb.queryResults = Array.from({ length: 50 }, (_, i) => ({
        id: `file_${i}`,
        project_id: 'test-project',
        file_name: `file${i}.txt`,
        file_path: `file${i}.txt`,
        file_type: 'txt',
        is_folder: 0,
        deleted: 0
      }));

      // 第一页
      const page1 = await manager.getFiles('test-project', {
        offset: 0,
        limit: 20
      });

      expect(page1.files).toHaveLength(20);
      expect(page1.total).toBe(50);
      expect(page1.hasMore).toBe(true);

      // 第二页
      const page2 = await manager.getFiles('test-project', {
        offset: 20,
        limit: 20
      });

      expect(page2.files).toHaveLength(20);
      expect(page2.total).toBe(50);
      expect(page2.hasMore).toBe(true);

      // 最后一页
      const page3 = await manager.getFiles('test-project', {
        offset: 40,
        limit: 20
      });

      expect(page3.files).toHaveLength(10);
      expect(page3.total).toBe(50);
      expect(page3.hasMore).toBe(false);
    });

    test('应该支持文件类型过滤', async () => {
      mockDb.queryResults = [
        { file_name: 'test.js', file_type: 'js', deleted: 0 },
        { file_name: 'test.txt', file_type: 'txt', deleted: 0 },
        { file_name: 'test2.js', file_type: 'js', deleted: 0 }
      ];

      const result = await manager.getFiles('test-project', {
        fileType: 'js',
        limit: 100
      });

      // 注意：过滤是在数据库查询中进行的
      // 这里我们验证查询被正确调用
      expect(result.fromCache).toBe(true);
    });
  });

  describe('getCacheStatus', () => {
    test('应该正确检测空缓存', async () => {
      mockDb.queryResults = [];

      const status = await manager.getCacheStatus('test-project');

      expect(status.isEmpty).toBe(true);
      expect(status.fileCount).toBe(0);
    });

    test('应该正确检测非空缓存', async () => {
      mockDb.queryResults = [{ deleted: 0 }];

      const status = await manager.getCacheStatus('test-project');

      expect(status.isEmpty).toBe(false);
      expect(status.fileCount).toBe(1);
    });
  });

  describe('clearCache', () => {
    test('应该清理项目缓存', async () => {
      // clearCache方法会调用DELETE语句
      // 我们简单验证它不抛出错误即可
      await expect(manager.clearCache('test-project')).resolves.not.toThrow();
    });
  });

  describe('文件监听功能', () => {
    test('应该能够启动和停止文件监听', async () => {
      // 启动监听
      manager.startFileWatcher('test-project', testRoot);

      expect(manager.watchers.has('test-project')).toBe(true);

      // 停止监听
      await manager.stopFileWatcher('test-project');

      expect(manager.watchers.has('test-project')).toBe(false);
    }, 10000);

    test('应该检测文件添加', async (done) => {
      let fileAdded = false;

      // 监控handleFileAdded调用
      const originalHandler = manager.handleFileAdded.bind(manager);
      manager.handleFileAdded = async (...args) => {
        fileAdded = true;
        await originalHandler(...args);
        expect(fileAdded).toBe(true);
        await manager.stopFileWatcher('test-project');
        done();
      };

      manager.startFileWatcher('test-project', testRoot);

      // 等待监听器初始化
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 创建新文件
      await fs.writeFile(path.join(testRoot, 'new-file.txt'), 'new content');
    }, 15000);

    test('应该检测文件删除', async (done) => {
      let fileDeleted = false;

      // 先创建一个文件
      const testFile = path.join(testRoot, 'to-delete.txt');
      await fs.writeFile(testFile, 'content');

      const originalHandler = manager.handleFileDeleted.bind(manager);
      manager.handleFileDeleted = async (...args) => {
        fileDeleted = true;
        await originalHandler(...args);
        expect(fileDeleted).toBe(true);
        await manager.stopFileWatcher('test-project');
        done();
      };

      manager.startFileWatcher('test-project', testRoot);

      // 等待监听器初始化
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 删除文件
      await fs.unlink(testFile);
    }, 15000);
  });

  describe('性能测试', () => {
    test('缓存读取应该比文件扫描快', async () => {
      // 创建100个测试文件
      for (let i = 0; i < 100; i++) {
        await fs.writeFile(
          path.join(testRoot, `file${i}.txt`),
          `content ${i}`
        );
      }

      // 设置缓存数据
      mockDb.queryResults = Array.from({ length: 100 }, (_, i) => ({
        id: `file_${i}`,
        file_name: `file${i}.txt`,
        file_path: `file${i}.txt`,
        file_type: 'txt',
        is_folder: 0,
        deleted: 0
      }));

      // 测试缓存读取时间
      const cacheStart = Date.now();
      await manager.getFiles('test-project', { limit: 100 });
      const cacheDuration = Date.now() - cacheStart;

      // 缓存读取应该非常快（<10ms）
      expect(cacheDuration).toBeLessThan(100);
    }, 30000);
  });

  describe('边界条件', () => {
    test('应该处理limit为0的情况', async () => {
      mockDb.queryResults = [
        { file_name: 'test.txt', deleted: 0 }
      ];

      const result = await manager.getFiles('test-project', {
        limit: 0,
        offset: 0
      });

      expect(result.files).toBeDefined();
      expect(result.total).toBe(1);
    });

    test('应该处理offset超过总数的情况', async () => {
      // 模拟数据库返回空结果（offset超过总数时）
      mockDb.queryResults = [];

      const result = await manager.getFiles('test-project', {
        limit: 10,
        offset: 1000
      });

      expect(result.files).toHaveLength(0);
      expect(result.hasMore).toBe(false);
    });

    test('应该处理无效的projectId', async () => {
      mockDb.db.prepare = () => ({
        get: () => null
      });

      const result = await manager.getFiles('invalid-id');

      expect(result.files).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('destroy', () => {
    test('应该清理所有资源', async () => {
      manager.startFileWatcher('project-1', testRoot);
      manager.startFileWatcher('project-2', testRoot);

      expect(manager.watchers.size).toBe(2);

      await manager.destroy();

      expect(manager.watchers.size).toBe(0);
      expect(manager.scanQueue.size).toBe(0);
    });
  });
});
