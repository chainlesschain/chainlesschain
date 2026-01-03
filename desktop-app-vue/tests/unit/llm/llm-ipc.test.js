/**
 * LLM Service IPC 单元测试
 * 测试14个 LLM IPC handlers 的注册
 *
 * JSDoc 注释 - CommonJS Mock 限制：
 * =====================================
 * 本测试文件采用轻量级方式验证 IPC handlers 的存在和注册。
 *
 * CommonJS 模块系统的限制：
 * 1. CommonJS require() 会在模块加载时立即执行，不受 Vitest 的 vi.mock() 影响
 * 2. 模块缓存导致无法在运行时切换 mock 的依赖
 * 3. 因此无法直接测试 registerLLMIPC() 函数的执行逻辑
 *
 * 解决方案：
 * 1. 通过静态分析源代码来验证 IPC handlers 的注册
 * 2. 验证所有声明的 handler channel 名称和数量
 * 3. 确保命名规范一致（kebab-case）
 * 4. 验证处理器函数的文档注释完整性
 *
 * 动态执行逻辑的测试应该在对应的业务模块单元测试中进行。
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// 获取源文件路径
const LLM_IPC_PATH = path.resolve(
  path.dirname(import.meta.url.replace('file://', '')),
  '../../../src/main/llm/llm-ipc.js'
);

/**
 * 从源文件中提取 ipcMain.handle() 调用
 * 识别所有 handler 注册的 channel 名称
 */
function extractIPCHandlers(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');

  // 匹配 ipcMain.handle('channel-name', ...) 的模式
  const handlerPattern = /ipcMain\.handle\(['"]([^'"]+)['"]/g;

  const handlers = [];
  let match;
  while ((match = handlerPattern.exec(content)) !== null) {
    handlers.push(match[1]);
  }

  return handlers;
}

/**
 * 从源文件中提取每个 handler 的文档注释
 */
function extractHandlerDocumentation(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const docs = {};

  // 匹配 /** ... */ 后面跟着 ipcMain.handle(...) 的模式
  const docPattern = /\/\*\*[\s\S]*?\*\/\s*ipcMain\.handle\(['"]([^'"]+)['"]/g;

  let match;
  while ((match = docPattern.exec(content)) !== null) {
    const channelName = match[1];
    const fullMatch = match[0];

    // 提取 Channel: 'channel-name' 的行
    const channelMatch = fullMatch.match(/Channel:\s*['"]([^'"]+)['"]/);
    if (channelMatch) {
      docs[channelName] = true;
    }
  }

  return docs;
}

/**
 * 验证 handler 的注册注释
 */
function extractHandlerComments(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const comments = {};

  // 按 handler 的 Channel 注释分段
  const sections = content.split(/Channel:\s*['"]/);

  for (let i = 1; i < sections.length; i++) {
    const section = sections[i];
    const channelMatch = section.match(/^([^'"]+)/);
    if (channelMatch) {
      const channelName = channelMatch[1];

      // 提取该 handler 上方的 JSDoc 注释
      const beforeMatch = sections[i - 1].match(/\/\*\*[\s\S]*?\*\//);
      if (beforeMatch) {
        comments[channelName] = beforeMatch[0];
      }
    }
  }

  return comments;
}

describe('LLM Service IPC', () => {
  let handlers;
  let handlerDocs;
  let handlerComments;

  const expectedChannels = [
    'llm:check-status',
    'llm:query',
    'llm:chat',
    'llm:chat-with-template',
    'llm:query-stream',
    'llm:get-config',
    'llm:set-config',
    'llm:list-models',
    'llm:clear-context',
    'llm:embeddings',
    'llm:get-selector-info',
    'llm:select-best',
    'llm:generate-report',
    'llm:switch-provider',
  ];

  beforeEach(() => {
    // 从源文件提取 handlers
    handlers = extractIPCHandlers(LLM_IPC_PATH);
    handlerDocs = extractHandlerDocumentation(LLM_IPC_PATH);
    handlerComments = extractHandlerComments(LLM_IPC_PATH);
  });

  // ============================================================
  // 基础验证 - Handler 数量和命名
  // ============================================================

  describe('Handler 注册验证', () => {
    it('should have exactly 14 handlers registered', () => {
      expect(handlers.length).toBe(14);
    });

    it('should match all expected handler channels', () => {
      const sortedHandlers = handlers.sort();
      const sortedExpected = expectedChannels.sort();
      expect(sortedHandlers).toEqual(sortedExpected);
    });

    it('should have no duplicate handler channels', () => {
      const uniqueHandlers = new Set(handlers);
      expect(uniqueHandlers.size).toBe(handlers.length);
    });

    it('should contain all documented handlers', () => {
      expectedChannels.forEach((channel) => {
        expect(handlers).toContain(channel);
      });
    });
  });

  // ============================================================
  // 基础服务 Handlers (4个)
  // ============================================================

  describe('基础服务 Handlers', () => {
    const basicHandlers = [
      'llm:check-status',
      'llm:query',
      'llm:chat',
      'llm:query-stream',
    ];

    it('should have 4 basic service handlers', () => {
      const count = basicHandlers.filter((h) => handlers.includes(h)).length;
      expect(count).toBe(4);
    });

    basicHandlers.forEach((channel) => {
      it(`should register ${channel} handler`, () => {
        expect(handlers).toContain(channel);
      });

      it(`${channel} should have JSDoc documentation`, () => {
        expect(handlerDocs[channel]).toBeDefined();
      });
    });
  });

  // ============================================================
  // 模板和流式 Handlers (1个)
  // ============================================================

  describe('模板和流式查询 Handlers', () => {
    const templateHandlers = [
      'llm:chat-with-template',
    ];

    it('should have 1 template handler', () => {
      const count = templateHandlers.filter((h) => handlers.includes(h)).length;
      expect(count).toBe(1);
    });

    templateHandlers.forEach((channel) => {
      it(`should register ${channel} handler`, () => {
        expect(handlers).toContain(channel);
      });

      it(`${channel} should have JSDoc documentation`, () => {
        expect(handlerDocs[channel]).toBeDefined();
      });
    });
  });

  // ============================================================
  // 配置管理 Handlers (3个)
  // ============================================================

  describe('配置管理 Handlers', () => {
    const configHandlers = [
      'llm:get-config',
      'llm:set-config',
      'llm:list-models',
    ];

    it('should have 3 configuration management handlers', () => {
      const count = configHandlers.filter((h) => handlers.includes(h)).length;
      expect(count).toBe(3);
    });

    configHandlers.forEach((channel) => {
      it(`should register ${channel} handler`, () => {
        expect(handlers).toContain(channel);
      });

      it(`${channel} should have JSDoc documentation`, () => {
        expect(handlerDocs[channel]).toBeDefined();
      });
    });
  });

  // ============================================================
  // 上下文和嵌入 Handlers (2个)
  // ============================================================

  describe('上下文和嵌入 Handlers', () => {
    const contextHandlers = [
      'llm:clear-context',
      'llm:embeddings',
    ];

    it('should have 2 context and embeddings handlers', () => {
      const count = contextHandlers.filter((h) => handlers.includes(h)).length;
      expect(count).toBe(2);
    });

    contextHandlers.forEach((channel) => {
      it(`should register ${channel} handler`, () => {
        expect(handlers).toContain(channel);
      });

      it(`${channel} should have JSDoc documentation`, () => {
        expect(handlerDocs[channel]).toBeDefined();
      });
    });
  });

  // ============================================================
  // LLM 智能选择 Handlers (4个)
  // ============================================================

  describe('LLM 智能选择 Handlers', () => {
    const selectorHandlers = [
      'llm:get-selector-info',
      'llm:select-best',
      'llm:generate-report',
      'llm:switch-provider',
    ];

    it('should have 4 intelligent selection handlers', () => {
      const count = selectorHandlers.filter((h) => handlers.includes(h)).length;
      expect(count).toBe(4);
    });

    selectorHandlers.forEach((channel) => {
      it(`should register ${channel} handler`, () => {
        expect(handlers).toContain(channel);
      });

      it(`${channel} should have JSDoc documentation`, () => {
        expect(handlerDocs[channel]).toBeDefined();
      });
    });
  });

  // ============================================================
  // 按功能域分组验证
  // ============================================================

  describe('按功能域分类验证', () => {
    it('should have 4 + 1 + 3 + 2 + 4 = 14 total handlers', () => {
      expect(handlers.length).toBe(14);
    });

    it('should group handlers correctly by functional domain', () => {
      const basicCount = handlers.filter((h) =>
        ['llm:check-status', 'llm:query', 'llm:chat', 'llm:query-stream'].includes(h)
      ).length;
      const templateCount = handlers.filter((h) =>
        ['llm:chat-with-template'].includes(h)
      ).length;
      const configCount = handlers.filter((h) =>
        ['llm:get-config', 'llm:set-config', 'llm:list-models'].includes(h)
      ).length;
      const contextCount = handlers.filter((h) =>
        ['llm:clear-context', 'llm:embeddings'].includes(h)
      ).length;
      const selectorCount = handlers.filter((h) =>
        ['llm:get-selector-info', 'llm:select-best', 'llm:generate-report', 'llm:switch-provider'].includes(h)
      ).length;

      expect(basicCount).toBe(4);
      expect(templateCount).toBe(1);
      expect(configCount).toBe(3);
      expect(contextCount).toBe(2);
      expect(selectorCount).toBe(4);
    });
  });

  // ============================================================
  // Handler 命名约定验证
  // ============================================================

  describe('Handler 命名约定', () => {
    it('all handlers should start with "llm:" prefix', () => {
      handlers.forEach((channel) => {
        expect(channel.startsWith('llm:')).toBe(true);
      });
    });

    it('all handlers should use kebab-case naming convention', () => {
      const validPattern = /^llm:[a-z]+(-[a-z]+)*$/;
      handlers.forEach((channel) => {
        expect(validPattern.test(channel)).toBe(true);
      });
    });

    it('no handler should use underscores in channel name', () => {
      handlers.forEach((channel) => {
        expect(channel).not.toContain('_');
      });
    });

    it('no handler should use uppercase letters in channel name', () => {
      handlers.forEach((channel) => {
        expect(channel).toMatch(/^[a-z0-9:_-]+$/);
      });
    });
  });

  // ============================================================
  // 文档完整性验证
  // ============================================================

  describe('文档完整性验证', () => {
    it('all handlers should have JSDoc comments', () => {
      handlers.forEach((channel) => {
        expect(handlerDocs[channel]).toBeDefined();
      });
    });
  });

  // ============================================================
  // 完整性验证
  // ============================================================

  describe('完整性验证', () => {
    it('should have no missing handlers from specification', () => {
      const missing = expectedChannels.filter((h) => !handlers.includes(h));
      expect(missing).toEqual([]);
    });

    it('should have no unexpected handlers beyond specification', () => {
      const unexpected = handlers.filter((h) => !expectedChannels.includes(h));
      expect(unexpected).toEqual([]);
    });

    it('should maintain 1:1 mapping between specified and registered handlers', () => {
      expect(handlers.length).toBe(expectedChannels.length);
    });
  });

  // ============================================================
  // 特殊功能验证
  // ============================================================

  describe('特殊功能验证', () => {
    it('should have handlers for all 4 basic LLM service operations', () => {
      expect(handlers).toContain('llm:check-status');
      expect(handlers).toContain('llm:query');
      expect(handlers).toContain('llm:chat');
      expect(handlers).toContain('llm:query-stream');
    });

    it('should have handlers for configuration and model management', () => {
      expect(handlers).toContain('llm:get-config');
      expect(handlers).toContain('llm:set-config');
      expect(handlers).toContain('llm:list-models');
    });

    it('should have handlers for context and embeddings operations', () => {
      expect(handlers).toContain('llm:clear-context');
      expect(handlers).toContain('llm:embeddings');
    });

    it('should have handlers for intelligent LLM selection', () => {
      expect(handlers).toContain('llm:get-selector-info');
      expect(handlers).toContain('llm:select-best');
      expect(handlers).toContain('llm:generate-report');
      expect(handlers).toContain('llm:switch-provider');
    });

    it('should have handler for template-based chat', () => {
      expect(handlers).toContain('llm:chat-with-template');
    });
  });

  // ============================================================
  // 功能分类验证
  // ============================================================

  describe('功能分类验证', () => {
    it('read operations should include: check-status, get-config, list-models, get-selector-info', () => {
      const readOps = [
        'llm:check-status',
        'llm:get-config',
        'llm:list-models',
        'llm:get-selector-info',
      ];
      readOps.forEach((op) => expect(handlers).toContain(op));
    });

    it('write operations should include: set-config, clear-context, switch-provider', () => {
      const writeOps = [
        'llm:set-config',
        'llm:clear-context',
        'llm:switch-provider',
      ];
      writeOps.forEach((op) => expect(handlers).toContain(op));
    });

    it('compute operations should include: query, chat, chat-with-template, query-stream, embeddings, select-best, generate-report', () => {
      const computeOps = [
        'llm:query',
        'llm:chat',
        'llm:chat-with-template',
        'llm:query-stream',
        'llm:embeddings',
        'llm:select-best',
        'llm:generate-report',
      ];
      computeOps.forEach((op) => expect(handlers).toContain(op));
    });
  });
});
