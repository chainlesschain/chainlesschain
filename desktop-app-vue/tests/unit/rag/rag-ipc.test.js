/**
 * RAG IPC 单元测试
 * 测试7个 RAG 相关 IPC 处理器的正确注册
 *
 * @module rag-ipc.test
 * @description
 * 本测试文件验证 RAG IPC 处理器的注册。通过源代码分析和模块导出验证，
 * 确保所有 7 个 handler 都被正确定义和注册。
 *
 * 测试策略：
 * - 验证 registerRAGIPC 函数的导出
 * - 使用正则表达式验证源代码中所有 ipcMain.handle 调用
 * - 验证每个 handler 的异步特性和基本签名
 *
 * CommonJS Mock 限制说明：
 * - Vitest 与 CommonJS require() 的交互存在限制
 * - vi.mock('electron') 无法在动态导入后工作
 * - 本测试通过源代码分析而非运行时 mock 来验证
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFile } from 'fs/promises';
import path from 'path';

describe('RAG IPC 处理器注册', () => {
  let sourceCode;
  let registerRAGIPC;

  beforeEach(async () => {
    // 读取源文件内容用于验证
    const filePath = path.resolve(
      __dirname,
      '../../../src/main/rag/rag-ipc.js'
    );
    sourceCode = await readFile(filePath, 'utf-8');

    // 导入模块以检查函数是否导出
    const module = await import(
      '../../../src/main/rag/rag-ipc.js'
    );
    registerRAGIPC = module.registerRAGIPC;
  });

  // ============================================================
  // 模块导出验证
  // ============================================================

  describe('模块导出验证', () => {
    it('should export registerRAGIPC function', () => {
      expect(typeof registerRAGIPC).toBe('function');
    });

    it('registerRAGIPC should be a function', () => {
      expect(registerRAGIPC instanceof Function).toBe(true);
    });

    it('should not export null or undefined registerRAGIPC', () => {
      expect(registerRAGIPC).not.toBeNull();
      expect(registerRAGIPC).not.toBeUndefined();
    });
  });

  // ============================================================
  // 源代码结构验证
  // ============================================================

  describe('源代码 handler 注册验证', () => {
    it('should have ipcMain.handle calls for all 7 handlers', () => {
      // 检查源代码中是否包含所有 handler 注册
      const requiredHandlers = [
        'rag:retrieve',
        'rag:enhance-query',
        'rag:rebuild-index',
        'rag:get-stats',
        'rag:update-config',
        'rag:get-rerank-config',
        'rag:set-reranking-enabled',
      ];

      requiredHandlers.forEach((channel) => {
        const pattern = new RegExp(
          `ipcMain\\.handle\\s*\\(\\s*['\"]${channel}['\"]`,
          'g'
        );
        expect(sourceCode).toMatch(pattern);
      });
    });

    it('should have exactly 7 ipcMain.handle calls', () => {
      // 计算 ipcMain.handle 调用的数量
      const matches = sourceCode.match(
        /ipcMain\.handle\s*\(\s*['"]/g
      );
      expect(matches).not.toBeNull();
      expect(matches.length).toBe(7);
    });

    it('rag:retrieve handler should be registered', () => {
      expect(sourceCode).toMatch(
        /ipcMain\.handle\s*\(\s*['"]rag:retrieve['"]/
      );
    });

    it('rag:enhance-query handler should be registered', () => {
      expect(sourceCode).toMatch(
        /ipcMain\.handle\s*\(\s*['"]rag:enhance-query['"]/
      );
    });

    it('rag:rebuild-index handler should be registered', () => {
      expect(sourceCode).toMatch(
        /ipcMain\.handle\s*\(\s*['"]rag:rebuild-index['"]/
      );
    });

    it('rag:get-stats handler should be registered', () => {
      expect(sourceCode).toMatch(
        /ipcMain\.handle\s*\(\s*['"]rag:get-stats['"]/
      );
    });

    it('rag:update-config handler should be registered', () => {
      expect(sourceCode).toMatch(
        /ipcMain\.handle\s*\(\s*['"]rag:update-config['"]/
      );
    });

    it('rag:get-rerank-config handler should be registered', () => {
      expect(sourceCode).toMatch(
        /ipcMain\.handle\s*\(\s*['"]rag:get-rerank-config['"]/
      );
    });

    it('rag:set-reranking-enabled handler should be registered', () => {
      expect(sourceCode).toMatch(
        /ipcMain\.handle\s*\(\s*['"]rag:set-reranking-enabled['"]/
      );
    });
  });

  // ============================================================
  // Handler 异步特性验证
  // ============================================================

  describe('Handler 异步特性验证', () => {
    it('all handlers should be async functions', () => {
      const requiredHandlers = [
        'rag:retrieve',
        'rag:enhance-query',
        'rag:rebuild-index',
        'rag:get-stats',
        'rag:update-config',
        'rag:get-rerank-config',
        'rag:set-reranking-enabled',
      ];

      requiredHandlers.forEach((channel) => {
        // 检查每个 handler 是否使用 async 函数
        const pattern = new RegExp(
          `ipcMain\\.handle\\s*\\(\\s*['"]${channel}['"]\\s*,\\s*async\\s`,
          'g'
        );
        expect(sourceCode).toMatch(pattern);
      });
    });

    it('should have async handlers for retrieval operations', () => {
      const retrievalPattern =
        /ipcMain\.handle\s*\(\s*['"]rag:retrieve['"],\s*async/;
      const enhancePattern =
        /ipcMain\.handle\s*\(\s*['"]rag:enhance-query['"],\s*async/;

      expect(sourceCode).toMatch(retrievalPattern);
      expect(sourceCode).toMatch(enhancePattern);
    });

    it('should have async handlers for index management', () => {
      const rebuildPattern =
        /ipcMain\.handle\s*\(\s*['"]rag:rebuild-index['"],\s*async/;
      const statsPattern =
        /ipcMain\.handle\s*\(\s*['"]rag:get-stats['"],\s*async/;

      expect(sourceCode).toMatch(rebuildPattern);
      expect(sourceCode).toMatch(statsPattern);
    });

    it('should have async handler for configuration', () => {
      const configPattern =
        /ipcMain\.handle\s*\(\s*['"]rag:update-config['"],\s*async/;

      expect(sourceCode).toMatch(configPattern);
    });

    it('should have async handlers for reranking', () => {
      const getRankPattern =
        /ipcMain\.handle\s*\(\s*['"]rag:get-rerank-config['"],\s*async/;
      const setRankPattern =
        /ipcMain\.handle\s*\(\s*['"]rag:set-reranking-enabled['"],\s*async/;

      expect(sourceCode).toMatch(getRankPattern);
      expect(sourceCode).toMatch(setRankPattern);
    });
  });

  // ============================================================
  // Handler 参数验证
  // ============================================================

  describe('Handler 参数验证', () => {
    it('retrieve handler should accept _event and query parameters', () => {
      const pattern =
        /ipcMain\.handle\s*\(\s*['"]rag:retrieve['"],\s*async\s*\(\s*_event\s*,\s*query/;
      expect(sourceCode).toMatch(pattern);
    });

    it('enhance-query handler should accept _event and query parameters', () => {
      const pattern =
        /ipcMain\.handle\s*\(\s*['"]rag:enhance-query['"],\s*async\s*\(\s*_event\s*,\s*query/;
      expect(sourceCode).toMatch(pattern);
    });

    it('update-config handler should accept _event and config parameters', () => {
      const pattern =
        /ipcMain\.handle\s*\(\s*['"]rag:update-config['"],\s*async\s*\(\s*_event\s*,\s*config/;
      expect(sourceCode).toMatch(pattern);
    });

    it('set-reranking-enabled handler should accept _event and enabled parameters', () => {
      const pattern =
        /ipcMain\.handle\s*\(\s*['"]rag:set-reranking-enabled['"],\s*async\s*\(\s*_event\s*,\s*enabled/;
      expect(sourceCode).toMatch(pattern);
    });
  });

  // ============================================================
  // 功能分类验证
  // ============================================================

  describe('知识检索处理器', () => {
    it('should have 2 retrieval-related handlers', () => {
      const retrievalHandlers = [
        'rag:retrieve',
        'rag:enhance-query',
      ];

      let count = 0;
      retrievalHandlers.forEach((handler) => {
        if (sourceCode.includes(`'${handler}'`)) {
          count++;
        }
      });

      expect(count).toBeGreaterThanOrEqual(2);
    });

    it('retrieval handlers should include error handling', () => {
      const retrieverErrorPattern =
        /catch\s*\(\s*error\s*\)\s*\{[^}]*console\.error\([^)]*RAG检索/;
      expect(sourceCode).toMatch(retrieverErrorPattern);
    });
  });

  describe('索引管理处理器', () => {
    it('should have 2 index management handlers', () => {
      const indexHandlers = [
        'rag:rebuild-index',
        'rag:get-stats',
      ];

      let count = 0;
      indexHandlers.forEach((handler) => {
        if (sourceCode.includes(`'${handler}'`)) {
          count++;
        }
      });

      expect(count).toBeGreaterThanOrEqual(2);
    });

    it('index handlers should have error handling', () => {
      // 检查是否有error handling的日志输出
      expect(sourceCode).toMatch(/console\.error\([^)]*RAG/);
    });
  });

  describe('配置管理处理器', () => {
    it('should have 1 configuration handler', () => {
      expect(sourceCode).toContain("'rag:update-config'");
    });

    it('update-config handler should be async', () => {
      const pattern =
        /ipcMain\.handle\s*\(\s*['"]rag:update-config['"],\s*async/;
      expect(sourceCode).toMatch(pattern);
    });
  });

  describe('重排序功能处理器', () => {
    it('should have 2 reranking-related handlers', () => {
      const rerankHandlers = [
        'rag:get-rerank-config',
        'rag:set-reranking-enabled',
      ];

      const includes = rerankHandlers.filter((h) =>
        sourceCode.includes(`'${h}'`)
      ).length;

      expect(includes).toBe(2);
    });

    it('reranking handlers should be async', () => {
      const getRankPattern =
        /ipcMain\.handle\s*\(\s*['"]rag:get-rerank-config['"],\s*async/;
      const setRankPattern =
        /ipcMain\.handle\s*\(\s*['"]rag:set-reranking-enabled['"],\s*async/;

      expect(sourceCode).toMatch(getRankPattern);
      expect(sourceCode).toMatch(setRankPattern);
    });
  });

  // ============================================================
  // 完整性检查
  // ============================================================

  describe('完整性检查', () => {
    it('should have all 7 unique handler channels', () => {
      const expectedHandlers = [
        'rag:retrieve',
        'rag:enhance-query',
        'rag:rebuild-index',
        'rag:get-stats',
        'rag:update-config',
        'rag:get-rerank-config',
        'rag:set-reranking-enabled',
      ];

      expectedHandlers.forEach((channel) => {
        expect(sourceCode).toContain(`'${channel}'`);
      });
    });

    it('should have no duplicate handler registrations in source', () => {
      const requiredHandlers = [
        'rag:retrieve',
        'rag:enhance-query',
        'rag:rebuild-index',
        'rag:get-stats',
        'rag:update-config',
        'rag:get-rerank-config',
        'rag:set-reranking-enabled',
      ];

      requiredHandlers.forEach((channel) => {
        // 每个 handler 应该只在 ipcMain.handle 中被注册一次
        const countMatches = (sourceCode.match(
          new RegExp(
            `ipcMain\\.handle\\s*\\(\\s*['"]${channel}['"]`,
            'g'
          )
        ) || []).length;
        expect(countMatches).toBe(1);
      });
    });

    it('should have proper summary console log', () => {
      // 检查是否有完成日志
      const summaryPattern =
        /console\.log\s*\(\s*['"][^'"]*7\s*handlers[^'"]*['"]\s*\)/;
      expect(sourceCode).toMatch(summaryPattern);
    });

    it('summary: all 7 RAG IPC handlers should be properly defined in source', () => {
      const expectedHandlers = [
        'rag:retrieve',
        'rag:enhance-query',
        'rag:rebuild-index',
        'rag:get-stats',
        'rag:update-config',
        'rag:get-rerank-config',
        'rag:set-reranking-enabled',
      ];

      // 计算总数
      const handlerCount = (
        sourceCode.match(
          /ipcMain\.handle\s*\(\s*['"]/g
        ) || []
      ).length;

      expect(handlerCount).toBe(7);

      // 验证每个 handler 都存在
      expectedHandlers.forEach((channel) => {
        expect(sourceCode).toContain(`'${channel}'`);
      });

      // 验证导出
      expect(typeof registerRAGIPC).toBe('function');
    });
  });
});
