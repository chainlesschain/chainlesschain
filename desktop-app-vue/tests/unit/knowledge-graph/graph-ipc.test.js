/**
 * Knowledge Graph IPC 单元测试
 * 测试21个知识图谱 IPC 处理器的正确注册和功能
 *
 * @module graph-ipc.test
 * @description
 * 本测试文件验证知识图谱 IPC 处理器的注册和功能实现。通过源代码分析和模块导出验证，
 * 确保所有 21 个 handler 都被正确定义和注册。
 *
 * 测试策略：
 * - 验证 registerGraphIPC 函数的导出
 * - 使用正则表达式验证源代码中所有 ipcMain.handle 调用
 * - 验证每个 handler 的异步特性和基本签名
 * - 测试错误处理和未初始化场景
 *
 * CommonJS Mock 限制说明：
 * - Vitest 与 CommonJS require() 的交互存在限制
 * - vi.mock('electron') 无法在动态导入后工作
 * - 本测试通过源代码分析而非运行时 mock 来验证
 */

import { describe, it, expect, beforeEach } from "vitest";
import { readFile } from "fs/promises";
import path from "path";

describe("Knowledge Graph IPC 处理器注册", () => {
  let sourceCode;
  let registerGraphIPC;

  beforeEach(async () => {
    // 读取源文件内容用于验证
    const filePath = path.resolve(
      __dirname,
      "../../../src/main/knowledge-graph/graph-ipc.js",
    );
    sourceCode = await readFile(filePath, "utf-8");

    // 导入模块以检查函数是否导出
    const module =
      await import("../../../src/main/knowledge-graph/graph-ipc.js");
    registerGraphIPC = module.registerGraphIPC;
  });

  // ============================================================
  // 模块导出验证
  // ============================================================

  describe("模块导出验证", () => {
    it("should export registerGraphIPC function", () => {
      expect(typeof registerGraphIPC).toBe("function");
    });

    it("registerGraphIPC should be a function", () => {
      expect(registerGraphIPC instanceof Function).toBe(true);
    });

    it("should not export null or undefined registerGraphIPC", () => {
      expect(registerGraphIPC).not.toBeNull();
      expect(registerGraphIPC).not.toBeUndefined();
    });
  });

  // ============================================================
  // 源代码结构验证
  // ============================================================

  describe("源代码 handler 注册验证", () => {
    it("should have ipcMain.handle calls for all 21 handlers", () => {
      // 检查源代码中是否包含所有 handler 注册
      const requiredHandlers = [
        "graph:get-graph-data",
        "graph:process-note",
        "graph:process-all-notes",
        "graph:get-knowledge-relations",
        "graph:find-related-notes",
        "graph:find-potential-links",
        "graph:add-relation",
        "graph:delete-relations",
        "graph:build-tag-relations",
        "graph:build-temporal-relations",
        "graph:extract-semantic-relations",
      ];

      requiredHandlers.forEach((channel) => {
        const pattern = new RegExp(
          `ipcMain\\.handle\\s*\\(\\s*['"]${channel}['"]`,
          "g",
        );
        expect(sourceCode).toMatch(pattern);
      });
    });

    it("should have exactly 21 ipcMain.handle calls", () => {
      // 计算 ipcMain.handle 调用的数量
      const matches = sourceCode.match(/ipcMain\.handle\s*\(\s*['"]/g);
      expect(matches).not.toBeNull();
      expect(matches.length).toBe(21);
    });

    it("graph:get-graph-data handler should be registered", () => {
      expect(sourceCode).toMatch(
        /ipcMain\.handle\s*\(\s*['"]graph:get-graph-data['"]/,
      );
    });

    it("graph:process-note handler should be registered", () => {
      expect(sourceCode).toMatch(
        /ipcMain\.handle\s*\(\s*['"]graph:process-note['"]/,
      );
    });

    it("graph:process-all-notes handler should be registered", () => {
      expect(sourceCode).toMatch(
        /ipcMain\.handle\s*\(\s*['"]graph:process-all-notes['"]/,
      );
    });

    it("graph:get-knowledge-relations handler should be registered", () => {
      expect(sourceCode).toMatch(
        /ipcMain\.handle\s*\(\s*['"]graph:get-knowledge-relations['"]/,
      );
    });

    it("graph:find-related-notes handler should be registered", () => {
      expect(sourceCode).toMatch(
        /ipcMain\.handle\s*\(\s*['"]graph:find-related-notes['"]/,
      );
    });

    it("graph:find-potential-links handler should be registered", () => {
      expect(sourceCode).toMatch(
        /ipcMain\.handle\s*\(\s*['"]graph:find-potential-links['"]/,
      );
    });

    it("graph:add-relation handler should be registered", () => {
      expect(sourceCode).toMatch(
        /ipcMain\.handle\s*\(\s*['"]graph:add-relation['"]/,
      );
    });

    it("graph:delete-relations handler should be registered", () => {
      expect(sourceCode).toMatch(
        /ipcMain\.handle\s*\(\s*['"]graph:delete-relations['"]/,
      );
    });

    it("graph:build-tag-relations handler should be registered", () => {
      expect(sourceCode).toMatch(
        /ipcMain\.handle\s*\(\s*['"]graph:build-tag-relations['"]/,
      );
    });

    it("graph:build-temporal-relations handler should be registered", () => {
      expect(sourceCode).toMatch(
        /ipcMain\.handle\s*\(\s*['"]graph:build-temporal-relations['"]/,
      );
    });

    it("graph:extract-semantic-relations handler should be registered", () => {
      expect(sourceCode).toMatch(
        /ipcMain\.handle\s*\(\s*['"]graph:extract-semantic-relations['"]/,
      );
    });
  });

  // ============================================================
  // Handler 异步特性验证
  // ============================================================

  describe("Handler 异步特性验证", () => {
    it("all handlers should be async functions", () => {
      const requiredHandlers = [
        "graph:get-graph-data",
        "graph:process-note",
        "graph:process-all-notes",
        "graph:get-knowledge-relations",
        "graph:find-related-notes",
        "graph:find-potential-links",
        "graph:add-relation",
        "graph:delete-relations",
        "graph:build-tag-relations",
        "graph:build-temporal-relations",
        "graph:extract-semantic-relations",
      ];

      requiredHandlers.forEach((channel) => {
        // 检查每个 handler 是否使用 async 函数
        const pattern = new RegExp(
          `ipcMain\\.handle\\s*\\(\\s*['"]${channel}['"]\\s*,\\s*async\\s`,
          "g",
        );
        expect(sourceCode).toMatch(pattern);
      });
    });

    it("should have async handlers for graph data operations", () => {
      const getDataPattern =
        /ipcMain\.handle\s*\(\s*['"]graph:get-graph-data['"],\s*async/;
      const getRelationsPattern =
        /ipcMain\.handle\s*\(\s*['"]graph:get-knowledge-relations['"],\s*async/;

      expect(sourceCode).toMatch(getDataPattern);
      expect(sourceCode).toMatch(getRelationsPattern);
    });

    it("should have async handlers for note processing", () => {
      const processNotePattern =
        /ipcMain\.handle\s*\(\s*['"]graph:process-note['"],\s*async/;
      const processAllPattern =
        /ipcMain\.handle\s*\(\s*['"]graph:process-all-notes['"],\s*async/;

      expect(sourceCode).toMatch(processNotePattern);
      expect(sourceCode).toMatch(processAllPattern);
    });

    it("should have async handlers for relation management", () => {
      const addPattern =
        /ipcMain\.handle\s*\(\s*['"]graph:add-relation['"],\s*async/;
      const deletePattern =
        /ipcMain\.handle\s*\(\s*['"]graph:delete-relations['"],\s*async/;

      expect(sourceCode).toMatch(addPattern);
      expect(sourceCode).toMatch(deletePattern);
    });

    it("should have async handlers for graph analysis", () => {
      const findPattern =
        /ipcMain\.handle\s*\(\s*['"]graph:find-related-notes['"],\s*async/;
      const potentialPattern =
        /ipcMain\.handle\s*\(\s*['"]graph:find-potential-links['"],\s*async/;

      expect(sourceCode).toMatch(findPattern);
      expect(sourceCode).toMatch(potentialPattern);
    });

    it("should have async handlers for relation building", () => {
      const tagPattern =
        /ipcMain\.handle\s*\(\s*['"]graph:build-tag-relations['"],\s*async/;
      const temporalPattern =
        /ipcMain\.handle\s*\(\s*['"]graph:build-temporal-relations['"],\s*async/;

      expect(sourceCode).toMatch(tagPattern);
      expect(sourceCode).toMatch(temporalPattern);
    });

    it("should have async handler for semantic extraction", () => {
      const semanticPattern =
        /ipcMain\.handle\s*\(\s*['"]graph:extract-semantic-relations['"],\s*async/;

      expect(sourceCode).toMatch(semanticPattern);
    });
  });

  // ============================================================
  // Handler 参数验证
  // ============================================================

  describe("Handler 参数验证", () => {
    it("get-graph-data handler should accept _event and options parameters", () => {
      const pattern =
        /ipcMain\.handle\s*\(\s*['"]graph:get-graph-data['"],\s*async\s*\(\s*_event\s*,\s*options/;
      expect(sourceCode).toMatch(pattern);
    });

    it("process-note handler should accept _event, noteId, content, and tags parameters", () => {
      const pattern =
        /ipcMain\.handle\s*\(\s*['"]graph:process-note['"],\s*async\s*\(\s*_event\s*,\s*noteId\s*,\s*content\s*,\s*tags/;
      expect(sourceCode).toMatch(pattern);
    });

    it("process-all-notes handler should accept _event and noteIds parameters", () => {
      const pattern =
        /ipcMain\.handle\s*\(\s*['"]graph:process-all-notes['"],\s*async\s*\(\s*_event\s*,\s*noteIds/;
      expect(sourceCode).toMatch(pattern);
    });

    it("get-knowledge-relations handler should accept _event and knowledgeId parameters", () => {
      const pattern =
        /ipcMain\.handle\s*\(\s*['"]graph:get-knowledge-relations['"],\s*async\s*\(\s*_event\s*,\s*knowledgeId/;
      expect(sourceCode).toMatch(pattern);
    });

    it("find-related-notes handler should accept _event, sourceId, targetId, and maxDepth parameters", () => {
      const pattern =
        /ipcMain\.handle\s*\(\s*['"]graph:find-related-notes['"],\s*async\s*\(\s*_event\s*,\s*sourceId\s*,\s*targetId\s*,\s*maxDepth/;
      expect(sourceCode).toMatch(pattern);
    });

    it("find-potential-links handler should accept _event, noteId, and content parameters", () => {
      const pattern =
        /ipcMain\.handle\s*\(\s*['"]graph:find-potential-links['"],\s*async\s*\(\s*_event\s*,\s*noteId\s*,\s*content/;
      expect(sourceCode).toMatch(pattern);
    });

    it("add-relation handler should accept _event and multiple relation parameters", () => {
      const pattern =
        /ipcMain\.handle\s*\(\s*['"]graph:add-relation['"],\s*async\s*\(\s*_event\s*,\s*sourceId\s*,\s*targetId\s*,\s*type\s*,\s*weight\s*,\s*metadata/;
      expect(sourceCode).toMatch(pattern);
    });

    it("delete-relations handler should accept _event, noteId, and types parameters", () => {
      const pattern =
        /ipcMain\.handle\s*\(\s*['"]graph:delete-relations['"],\s*async\s*\(\s*_event\s*,\s*noteId\s*,\s*types/;
      expect(sourceCode).toMatch(pattern);
    });

    it("build-temporal-relations handler should accept _event and windowDays parameters", () => {
      const pattern =
        /ipcMain\.handle\s*\(\s*['"]graph:build-temporal-relations['"],\s*async\s*\(\s*_event\s*,\s*windowDays/;
      expect(sourceCode).toMatch(pattern);
    });

    it("extract-semantic-relations handler should accept _event, noteId, and content parameters", () => {
      const pattern =
        /ipcMain\.handle\s*\(\s*['"]graph:extract-semantic-relations['"],\s*async\s*\(\s*_event\s*,\s*noteId\s*,\s*content/;
      expect(sourceCode).toMatch(pattern);
    });
  });

  // ============================================================
  // 错误处理验证
  // ============================================================

  describe("错误处理验证", () => {
    it("all handlers should have try-catch blocks", () => {
      const requiredHandlers = [
        "graph:get-graph-data",
        "graph:process-note",
        "graph:process-all-notes",
        "graph:get-knowledge-relations",
        "graph:find-related-notes",
        "graph:find-potential-links",
        "graph:add-relation",
        "graph:delete-relations",
        "graph:build-tag-relations",
        "graph:build-temporal-relations",
        "graph:extract-semantic-relations",
      ];

      // 检查源代码中有足够的 try-catch 块
      const tryCatchCount = (sourceCode.match(/try\s*\{/g) || []).length;
      expect(tryCatchCount).toBeGreaterThanOrEqual(21);

      const catchCount = (sourceCode.match(/catch\s*\(\s*error\s*\)/g) || [])
        .length;
      expect(catchCount).toBeGreaterThanOrEqual(21);
    });

    it("should have error logging for graph operations", () => {
      // 检查是否有Graph IPC相关的错误日志
      expect(sourceCode).toMatch(
        /console\.error\(\s*['"][^'"]*Graph IPC[^'"]*['"]/,
      );
    });

    it("get-graph-data should return empty data on error", () => {
      // 检查错误处理返回空数据结构
      expect(sourceCode).toMatch(
        /return\s*\{\s*nodes:\s*\[\s*\]\s*,\s*edges:\s*\[\s*\]\s*\}/,
      );
    });

    it("process handlers should return zero on error", () => {
      // 检查处理器在错误时返回 0
      const processNoteReturn =
        /graph:process-note[\s\S]*?catch[\s\S]*?return\s+0/;
      expect(sourceCode).toMatch(processNoteReturn);
    });

    it("process-all-notes should return zero stats on error", () => {
      // 检查批量处理在错误时返回零统计
      expect(sourceCode).toMatch(
        /processed:\s*0,\s*linkRelations:\s*0,\s*tagRelations:\s*0,\s*temporalRelations:\s*0/,
      );
    });

    it("relation handlers should return empty arrays on error", () => {
      // 检查关系查询在错误时返回空数组
      const getRelationsReturn =
        /graph:get-knowledge-relations[\s\S]*?catch[\s\S]*?return\s+\[\s*\]/;
      const findLinksReturn =
        /graph:find-potential-links[\s\S]*?catch[\s\S]*?return\s+\[\s*\]/;
      const semanticReturn =
        /graph:extract-semantic-relations[\s\S]*?catch[\s\S]*?return\s+\[\s*\]/;

      expect(sourceCode).toMatch(getRelationsReturn);
      expect(sourceCode).toMatch(findLinksReturn);
      expect(sourceCode).toMatch(semanticReturn);
    });

    it("find-related-notes should return null on error", () => {
      // 检查路径查找在错误时返回 null
      const findRelatedReturn =
        /graph:find-related-notes[\s\S]*?catch[\s\S]*?return\s+null/;
      expect(sourceCode).toMatch(findRelatedReturn);
    });

    it("add-relation should throw error on failure", () => {
      // 检查添加关系在失败时抛出错误
      const addRelationThrow =
        /graph:add-relation[\s\S]*?catch[\s\S]*?throw\s+error/;
      expect(sourceCode).toMatch(addRelationThrow);
    });
  });

  // ============================================================
  // 未初始化处理验证
  // ============================================================

  describe("未初始化管理器处理验证", () => {
    it("should check database initialization in get-graph-data", () => {
      const pattern = /if\s*\(\s*!\s*database\s*\)/;
      expect(sourceCode).toMatch(pattern);
    });

    it("should check graphExtractor initialization in process-note", () => {
      const pattern = /if\s*\(\s*!\s*graphExtractor\s*\)/;
      expect(sourceCode).toMatch(pattern);
    });

    it("should check graphExtractor initialization in process-all-notes", () => {
      const processAllPattern =
        /graph:process-all-notes[\s\S]*?if\s*\(\s*!\s*graphExtractor\s*\)/;
      expect(sourceCode).toMatch(processAllPattern);
    });

    it("should check database initialization in relation queries", () => {
      const getRelationsPattern =
        /graph:get-knowledge-relations[\s\S]*?if\s*\(\s*!\s*database\s*\)/;
      const findRelatedPattern =
        /graph:find-related-notes[\s\S]*?if\s*\(\s*!\s*database\s*\)/;

      expect(sourceCode).toMatch(getRelationsPattern);
      expect(sourceCode).toMatch(findRelatedPattern);
    });

    it("should check graphExtractor initialization in find-potential-links", () => {
      const pattern =
        /graph:find-potential-links[\s\S]*?if\s*\(\s*!\s*graphExtractor\s*\)/;
      expect(sourceCode).toMatch(pattern);
    });

    it("should throw error when database not initialized in add-relation", () => {
      const pattern =
        /graph:add-relation[\s\S]*?if\s*\(\s*!\s*database\s*\)[\s\S]*?throw\s+new\s+Error/;
      expect(sourceCode).toMatch(pattern);
    });

    it("should check database initialization in delete-relations", () => {
      const pattern =
        /graph:delete-relations[\s\S]*?if\s*\(\s*!\s*database\s*\)/;
      expect(sourceCode).toMatch(pattern);
    });

    it("should check database initialization in build-tag-relations", () => {
      const pattern =
        /graph:build-tag-relations[\s\S]*?if\s*\(\s*!\s*database\s*\)/;
      expect(sourceCode).toMatch(pattern);
    });

    it("should check database initialization in build-temporal-relations", () => {
      const pattern =
        /graph:build-temporal-relations[\s\S]*?if\s*\(\s*!\s*database\s*\)/;
      expect(sourceCode).toMatch(pattern);
    });

    it("should check both graphExtractor and llmManager in extract-semantic-relations", () => {
      const pattern =
        /graph:extract-semantic-relations[\s\S]*?if\s*\(\s*!\s*graphExtractor\s*\|\|\s*!\s*llmManager\s*\)/;
      expect(sourceCode).toMatch(pattern);
    });

    it("should have warning logs for uninitialized managers", () => {
      expect(sourceCode).toMatch(
        /console\.warn\([^)]*GraphExtractor\s+未初始化/,
      );
    });
  });

  // ============================================================
  // 功能分类验证
  // ============================================================

  describe("图谱数据查询处理器 (2 handlers)", () => {
    it("should have 2 data query handlers", () => {
      const queryHandlers = [
        "graph:get-graph-data",
        "graph:get-knowledge-relations",
      ];

      let count = 0;
      queryHandlers.forEach((handler) => {
        if (sourceCode.includes(`'${handler}'`)) {
          count++;
        }
      });

      expect(count).toBe(2);
    });

    it("data query handlers should use database", () => {
      const getGraphPattern =
        /graph:get-graph-data[\s\S]*?database\.getGraphData/;
      const getRelationsPattern =
        /graph:get-knowledge-relations[\s\S]*?database\.getKnowledgeRelations/;

      expect(sourceCode).toMatch(getGraphPattern);
      expect(sourceCode).toMatch(getRelationsPattern);
    });
  });

  describe("笔记处理器 (2 handlers)", () => {
    it("should have 2 note processing handlers", () => {
      const processHandlers = ["graph:process-note", "graph:process-all-notes"];

      let count = 0;
      processHandlers.forEach((handler) => {
        if (sourceCode.includes(`'${handler}'`)) {
          count++;
        }
      });

      expect(count).toBe(2);
    });

    it("note processing handlers should use graphExtractor", () => {
      const processNotePattern =
        /graph:process-note[\s\S]*?graphExtractor\.processNote/;
      const processAllPattern =
        /graph:process-all-notes[\s\S]*?graphExtractor\.processAllNotes/;

      expect(sourceCode).toMatch(processNotePattern);
      expect(sourceCode).toMatch(processAllPattern);
    });
  });

  describe("关系管理处理器 (2 handlers)", () => {
    it("should have 2 relation management handlers", () => {
      const relationHandlers = ["graph:add-relation", "graph:delete-relations"];

      let count = 0;
      relationHandlers.forEach((handler) => {
        if (sourceCode.includes(`'${handler}'`)) {
          count++;
        }
      });

      expect(count).toBe(2);
    });

    it("relation management handlers should use database methods", () => {
      const addPattern = /graph:add-relation[\s\S]*?database\.addRelation/;
      const deletePattern =
        /graph:delete-relations[\s\S]*?database\.deleteRelations/;

      expect(sourceCode).toMatch(addPattern);
      expect(sourceCode).toMatch(deletePattern);
    });
  });

  describe("图谱分析处理器 (2 handlers)", () => {
    it("should have 2 graph analysis handlers", () => {
      const analysisHandlers = [
        "graph:find-related-notes",
        "graph:find-potential-links",
      ];

      let count = 0;
      analysisHandlers.forEach((handler) => {
        if (sourceCode.includes(`'${handler}'`)) {
          count++;
        }
      });

      expect(count).toBe(2);
    });

    it("graph analysis handlers should have proper logic", () => {
      const findRelatedPattern =
        /graph:find-related-notes[\s\S]*?database\.findRelatedNotes/;
      const potentialLinksPattern =
        /graph:find-potential-links[\s\S]*?graphExtractor\.findPotentialLinks/;

      expect(sourceCode).toMatch(findRelatedPattern);
      expect(sourceCode).toMatch(potentialLinksPattern);
    });
  });

  describe("关系构建处理器 (2 handlers)", () => {
    it("should have 2 relation building handlers", () => {
      const buildHandlers = [
        "graph:build-tag-relations",
        "graph:build-temporal-relations",
      ];

      let count = 0;
      buildHandlers.forEach((handler) => {
        if (sourceCode.includes(`'${handler}'`)) {
          count++;
        }
      });

      expect(count).toBe(2);
    });

    it("relation building handlers should use database methods", () => {
      const tagPattern =
        /graph:build-tag-relations[\s\S]*?database\.buildTagRelations/;
      const temporalPattern =
        /graph:build-temporal-relations[\s\S]*?database\.buildTemporalRelations/;

      expect(sourceCode).toMatch(tagPattern);
      expect(sourceCode).toMatch(temporalPattern);
    });
  });

  describe("语义关系提取处理器 (1 handler)", () => {
    it("should have semantic extraction handler", () => {
      expect(sourceCode).toContain("'graph:extract-semantic-relations'");
    });

    it("semantic extraction should use both graphExtractor and llmManager", () => {
      const pattern =
        /graph:extract-semantic-relations[\s\S]*?await\s+graphExtractor\.extractSemanticRelations\([^)]*llmManager/;
      expect(sourceCode).toMatch(pattern);
    });

    it("semantic extraction should be async with await", () => {
      const pattern =
        /graph:extract-semantic-relations['"],\s*async[\s\S]*?await/;
      expect(sourceCode).toMatch(pattern);
    });
  });

  // ============================================================
  // 完整性检查
  // ============================================================

  describe("完整性检查", () => {
    it("should have all 21 unique handler channels", () => {
      const expectedHandlers = [
        "graph:get-graph-data",
        "graph:process-note",
        "graph:process-all-notes",
        "graph:get-knowledge-relations",
        "graph:find-related-notes",
        "graph:find-potential-links",
        "graph:add-relation",
        "graph:delete-relations",
        "graph:build-tag-relations",
        "graph:build-temporal-relations",
        "graph:extract-semantic-relations",
        "graph:calculate-centrality",
        "graph:detect-communities",
        "graph:cluster-nodes",
        "graph:find-key-nodes",
        "graph:analyze-stats",
        "graph:export-graph",
        "graph:extract-entities",
        "graph:extract-keywords",
        "graph:process-notes-entities",
        "graph:build-entity-graph",
      ];

      expectedHandlers.forEach((channel) => {
        expect(sourceCode).toContain(`'${channel}'`);
      });
    });

    it("should have no duplicate handler registrations in source", () => {
      const requiredHandlers = [
        "graph:get-graph-data",
        "graph:process-note",
        "graph:process-all-notes",
        "graph:get-knowledge-relations",
        "graph:find-related-notes",
        "graph:find-potential-links",
        "graph:add-relation",
        "graph:delete-relations",
        "graph:build-tag-relations",
        "graph:build-temporal-relations",
        "graph:extract-semantic-relations",
      ];

      requiredHandlers.forEach((channel) => {
        // 每个 handler 应该只在 ipcMain.handle 中被注册一次
        const countMatches = (
          sourceCode.match(
            new RegExp(`ipcMain\\.handle\\s*\\(\\s*['"]${channel}['"]`, "g"),
          ) || []
        ).length;
        expect(countMatches).toBe(1);
      });
    });

    it("should have proper summary console log", () => {
      // 检查是否有完成日志
      const summaryPattern =
        /console\.log\s*\(\s*['"][^'"]*11[^'"]*知识图谱[^'"]*IPC[^'"]*处理器[^'"]*['"]\s*\)/;
      expect(sourceCode).toMatch(summaryPattern);
    });

    it("should accept context parameter with required properties", () => {
      // 检查函数签名和上下文解构
      expect(sourceCode).toMatch(
        /function\s+registerGraphIPC\s*\(\s*context\s*\)/,
      );
      expect(sourceCode).toMatch(
        /const\s*\{\s*database\s*,\s*graphExtractor\s*,\s*llmManager\s*\}\s*=\s*context/,
      );
    });

    it("should use Electron ipcMain module", () => {
      expect(sourceCode).toMatch(
        /const\s*\{\s*ipcMain\s*\}\s*=\s*require\s*\(\s*['"]electron['"]\s*\)/,
      );
    });

    it("summary: all 11 Knowledge Graph IPC handlers should be properly defined in source", () => {
      const expectedHandlers = [
        "graph:get-graph-data",
        "graph:process-note",
        "graph:process-all-notes",
        "graph:get-knowledge-relations",
        "graph:find-related-notes",
        "graph:find-potential-links",
        "graph:add-relation",
        "graph:delete-relations",
        "graph:build-tag-relations",
        "graph:build-temporal-relations",
        "graph:extract-semantic-relations",
      ];

      // 计算总数
      const handlerCount = (
        sourceCode.match(/ipcMain\.handle\s*\(\s*['"]/g) || []
      ).length;

      expect(handlerCount).toBe(21);

      // 验证每个 handler 都存在
      expectedHandlers.forEach((channel) => {
        expect(sourceCode).toContain(`'${channel}'`);
      });

      // 验证导出
      expect(typeof registerGraphIPC).toBe("function");
    });
  });

  // ============================================================
  // 文档和注释验证
  // ============================================================

  describe("文档和注释验证", () => {
    it("should have file header documentation", () => {
      expect(sourceCode).toMatch(/\/\*\*[\s\S]*?Knowledge Graph IPC Handlers/);
      expect(sourceCode).toMatch(/知识图谱系统 IPC 处理器/);
    });

    it("should document the number of handlers", () => {
      expect(sourceCode).toMatch(/11\s*个\s*IPC/);
    });

    it("should have JSDoc for registerGraphIPC function", () => {
      expect(sourceCode).toMatch(/@param\s*\{\s*Object\s*\}\s*context/);
      expect(sourceCode).toMatch(
        /@param\s*\{\s*Object\s*\}\s*context\.database/,
      );
      expect(sourceCode).toMatch(
        /@param\s*\{\s*Object\s*\}\s*context\.graphExtractor/,
      );
      expect(sourceCode).toMatch(
        /@param\s*\{\s*Object\s*\}\s*context\.llmManager/,
      );
    });

    it("should have numbered comments for each handler", () => {
      // 检查是否有 1-11 的编号注释
      for (let i = 1; i <= 11; i++) {
        const pattern = new RegExp(`//\\s*${i}\\.`);
        expect(sourceCode).toMatch(pattern);
      }
    });

    it("should have descriptive Chinese comments for handlers", () => {
      // 检查关键功能的中文注释
      expect(sourceCode).toMatch(/获取图谱数据/);
      expect(sourceCode).toMatch(/处理单个笔记/);
      expect(sourceCode).toMatch(/批量处理/);
      expect(sourceCode).toMatch(/关系/);
      expect(sourceCode).toMatch(/语义/);
    });
  });
});
