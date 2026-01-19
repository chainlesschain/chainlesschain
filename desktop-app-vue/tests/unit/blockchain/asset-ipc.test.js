/**
 * 资产管理 IPC 单元测试
 * 测试10个资产管理相关 IPC handlers
 *
 * 测试覆盖：
 * - 资产创建和铸造
 * - 资产转账和销毁
 * - 资产查询操作
 * - 余额和历史记录
 * - 错误处理和边界情况
 *
 * JSDoc 注释 - CommonJS Mock 限制：
 * =====================================
 * 本测试文件采用静态分析方式验证 IPC handlers 的注册。
 *
 * CommonJS 模块系统的限制：
 * 1. CommonJS require() 会在模块加载时立即执行
 * 2. 模块缓存导致无法在运行时切换 mock 的依赖
 * 3. 因此无法直接测试 registerAssetIPC() 函数的执行逻辑
 *
 * 解决方案：
 * 1. 通过静态分析源代码来验证 IPC handlers 的注册
 * 2. 验证所有声明的 handler channel 名称和数量
 * 3. 确保命名规范一致（kebab-case）
 * 4. 验证处理器函数的文档注释完整性
 */

import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// 获取源文件路径
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ASSET_IPC_PATH = path.resolve(
  __dirname,
  "../../../src/main/blockchain/asset-ipc.js",
);

/**
 * 从源文件中提取 ipcMain.handle() 调用
 * 识别所有 handler 注册的 channel 名称
 */
function extractIPCHandlers(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");

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
 * 从源文件中提取每个 handler 的注释
 */
function extractHandlerComments(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const comments = {};

  // 按行分割并查找注释
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const handleMatch = line.match(/ipcMain\.handle\(['"]([^'"]+)['"]/);
    if (handleMatch) {
      const channelName = handleMatch[1];
      // 查找上方的注释（通常在前1-3行）
      let comment = "";
      for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
        const commentLine = lines[j].trim();
        if (commentLine.startsWith("//")) {
          comment = commentLine.replace("//", "").trim();
          break;
        }
      }
      comments[channelName] = comment;
    }
  }

  return comments;
}

/**
 * 验证 handler 的异步特性
 */
function extractAsyncHandlers(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const asyncHandlers = [];

  // 匹配 ipcMain.handle('channel', async (...) => 的模式
  const asyncPattern = /ipcMain\.handle\(['"]([^'"]+)['"],\s*async\s*\(/g;

  let match;
  while ((match = asyncPattern.exec(content)) !== null) {
    asyncHandlers.push(match[1]);
  }

  return asyncHandlers;
}

describe("Asset IPC Handlers", () => {
  let handlers;
  let handlerComments;
  let asyncHandlers;

  const expectedChannels = [
    "asset:create",
    "asset:mint",
    "asset:transfer",
    "asset:burn",
    "asset:get",
    "asset:get-by-owner",
    "asset:get-all",
    "asset:get-history",
    "asset:get-balance",
    "asset:get-blockchain-info",
  ];

  beforeEach(() => {
    // 从源文件提取 handlers
    handlers = extractIPCHandlers(ASSET_IPC_PATH);
    handlerComments = extractHandlerComments(ASSET_IPC_PATH);
    asyncHandlers = extractAsyncHandlers(ASSET_IPC_PATH);
  });

  // ============================================================
  // 基础验证 - Handler 数量和命名
  // ============================================================

  describe("Handler 注册验证", () => {
    it("should have exactly 10 handlers registered", () => {
      expect(handlers.length).toBe(10);
    });

    it("should match all expected handler channels", () => {
      const sortedHandlers = handlers.sort();
      const sortedExpected = expectedChannels.sort();
      expect(sortedHandlers).toEqual(sortedExpected);
    });

    it("should have no duplicate handler channels", () => {
      const uniqueHandlers = new Set(handlers);
      expect(uniqueHandlers.size).toBe(handlers.length);
    });

    it("should contain all documented handlers", () => {
      expectedChannels.forEach((channel) => {
        expect(handlers).toContain(channel);
      });
    });

    it("all handlers should be async", () => {
      expect(asyncHandlers.length).toBe(handlers.length);
      handlers.forEach((channel) => {
        expect(asyncHandlers).toContain(channel);
      });
    });
  });

  // ============================================================
  // 资产创建和铸造 Handlers (2个)
  // ============================================================

  describe("资产创建和铸造 Handlers", () => {
    const createMintHandlers = ["asset:create", "asset:mint"];

    it("should have 2 create/mint handlers", () => {
      const count = createMintHandlers.filter((h) =>
        handlers.includes(h),
      ).length;
      expect(count).toBe(2);
    });

    createMintHandlers.forEach((channel) => {
      it(`should register ${channel} handler`, () => {
        expect(handlers).toContain(channel);
      });

      it(`${channel} should be async`, () => {
        expect(asyncHandlers).toContain(channel);
      });
    });

    it("asset:create should accept options parameter", () => {
      const content = fs.readFileSync(ASSET_IPC_PATH, "utf-8");
      expect(content).toMatch(/asset:create.*async.*\(_event,\s*options\)/);
    });

    it("asset:mint should accept assetId, toDid, and amount parameters", () => {
      const content = fs.readFileSync(ASSET_IPC_PATH, "utf-8");
      expect(content).toMatch(
        /asset:mint.*async.*\(_event,\s*assetId,\s*toDid,\s*amount\)/,
      );
    });
  });

  // ============================================================
  // 资产转账和销毁 Handlers (2个)
  // ============================================================

  describe("资产转账和销毁 Handlers", () => {
    const transferBurnHandlers = ["asset:transfer", "asset:burn"];

    it("should have 2 transfer/burn handlers", () => {
      const count = transferBurnHandlers.filter((h) =>
        handlers.includes(h),
      ).length;
      expect(count).toBe(2);
    });

    transferBurnHandlers.forEach((channel) => {
      it(`should register ${channel} handler`, () => {
        expect(handlers).toContain(channel);
      });

      it(`${channel} should be async`, () => {
        expect(asyncHandlers).toContain(channel);
      });
    });

    it("asset:transfer should accept assetId, toDid, amount, and memo parameters", () => {
      const content = fs.readFileSync(ASSET_IPC_PATH, "utf-8");
      expect(content).toMatch(
        /asset:transfer.*async.*\(_event,\s*assetId,\s*toDid,\s*amount,\s*memo\)/,
      );
    });

    it("asset:burn should accept assetId and amount parameters", () => {
      const content = fs.readFileSync(ASSET_IPC_PATH, "utf-8");
      expect(content).toMatch(
        /asset:burn.*async.*\(_event,\s*assetId,\s*amount\)/,
      );
    });
  });

  // ============================================================
  // 资产查询 Handlers (3个)
  // ============================================================

  describe("资产查询 Handlers", () => {
    const queryHandlers = ["asset:get", "asset:get-by-owner", "asset:get-all"];

    it("should have 3 query handlers", () => {
      const count = queryHandlers.filter((h) => handlers.includes(h)).length;
      expect(count).toBe(3);
    });

    queryHandlers.forEach((channel) => {
      it(`should register ${channel} handler`, () => {
        expect(handlers).toContain(channel);
      });

      it(`${channel} should be async`, () => {
        expect(asyncHandlers).toContain(channel);
      });
    });

    it("asset:get should accept assetId parameter", () => {
      const content = fs.readFileSync(ASSET_IPC_PATH, "utf-8");
      expect(content).toMatch(/asset:get.*async.*\(_event,\s*assetId\)/);
    });

    it("asset:get-by-owner should accept ownerDid parameter", () => {
      const content = fs.readFileSync(ASSET_IPC_PATH, "utf-8");
      expect(content).toMatch(
        /asset:get-by-owner.*async.*\(_event,\s*ownerDid\)/,
      );
    });

    it("asset:get-all should accept filters parameter", () => {
      const content = fs.readFileSync(ASSET_IPC_PATH, "utf-8");
      expect(content).toMatch(/asset:get-all.*async.*\(_event,\s*filters\)/);
    });
  });

  // ============================================================
  // 历史和余额查询 Handlers (3个)
  // ============================================================

  describe("历史和余额查询 Handlers", () => {
    const historyBalanceHandlers = [
      "asset:get-history",
      "asset:get-balance",
      "asset:get-blockchain-info",
    ];

    it("should have 3 history/balance handlers", () => {
      const count = historyBalanceHandlers.filter((h) =>
        handlers.includes(h),
      ).length;
      expect(count).toBe(3);
    });

    historyBalanceHandlers.forEach((channel) => {
      it(`should register ${channel} handler`, () => {
        expect(handlers).toContain(channel);
      });

      it(`${channel} should be async`, () => {
        expect(asyncHandlers).toContain(channel);
      });
    });

    it("asset:get-history should accept assetId and limit parameters", () => {
      const content = fs.readFileSync(ASSET_IPC_PATH, "utf-8");
      expect(content).toMatch(
        /asset:get-history.*async.*\(_event,\s*assetId,\s*limit\)/,
      );
    });

    it("asset:get-balance should accept ownerDid and assetId parameters", () => {
      const content = fs.readFileSync(ASSET_IPC_PATH, "utf-8");
      expect(content).toMatch(
        /asset:get-balance.*async.*\(_event,\s*ownerDid,\s*assetId\)/,
      );
    });

    it("asset:get-blockchain-info should accept assetId parameter", () => {
      const content = fs.readFileSync(ASSET_IPC_PATH, "utf-8");
      expect(content).toMatch(
        /asset:get-blockchain-info.*async.*\(_event,\s*assetId\)/,
      );
    });
  });

  // ============================================================
  // 错误处理验证
  // ============================================================

  describe("错误处理验证", () => {
    const writingOperations = [
      "asset:create",
      "asset:mint",
      "asset:transfer",
      "asset:burn",
    ];

    writingOperations.forEach((channel) => {
      it(`${channel} should check if assetManager is initialized`, () => {
        const content = fs.readFileSync(ASSET_IPC_PATH, "utf-8");
        const handlerBlock = extractHandlerBlock(content, channel);
        expect(handlerBlock).toMatch(/if\s*\(\s*!assetManager\s*\)/);
        expect(handlerBlock).toMatch(
          /throw new Error\(['"]资产管理器未初始化['"]\)/,
        );
      });

      it(`${channel} should have try-catch block`, () => {
        const content = fs.readFileSync(ASSET_IPC_PATH, "utf-8");
        const handlerBlock = extractHandlerBlock(content, channel);
        expect(handlerBlock).toMatch(/try\s*{/);
        expect(handlerBlock).toMatch(/catch\s*\(/);
      });

      it(`${channel} should log errors on failure`, () => {
        const content = fs.readFileSync(ASSET_IPC_PATH, "utf-8");
        const handlerBlock = extractHandlerBlock(content, channel);
        expect(handlerBlock).toMatch(/console\.error/);
      });

      it(`${channel} should re-throw errors`, () => {
        const content = fs.readFileSync(ASSET_IPC_PATH, "utf-8");
        const handlerBlock = extractHandlerBlock(content, channel);
        expect(handlerBlock).toMatch(/throw\s+error/);
      });
    });

    const readingOperations = [
      "asset:get",
      "asset:get-by-owner",
      "asset:get-all",
      "asset:get-history",
    ];

    readingOperations.forEach((channel) => {
      it(`${channel} should return safe default when assetManager is not initialized`, () => {
        const content = fs.readFileSync(ASSET_IPC_PATH, "utf-8");
        const handlerBlock = extractHandlerBlock(content, channel);
        expect(handlerBlock).toMatch(/if\s*\(\s*!assetManager\s*\)/);
        expect(handlerBlock).toMatch(/return\s+(null|\[\])/);
      });

      it(`${channel} should have try-catch block`, () => {
        const content = fs.readFileSync(ASSET_IPC_PATH, "utf-8");
        const handlerBlock = extractHandlerBlock(content, channel);
        expect(handlerBlock).toMatch(/try\s*{/);
        expect(handlerBlock).toMatch(/catch\s*\(/);
      });
    });

    it("asset:get-balance should return 0 on error", () => {
      const content = fs.readFileSync(ASSET_IPC_PATH, "utf-8");
      const handlerBlock = extractHandlerBlock(content, "asset:get-balance");
      expect(handlerBlock).toMatch(/return\s+0/);
    });

    it("asset:get-blockchain-info should return null on error", () => {
      const content = fs.readFileSync(ASSET_IPC_PATH, "utf-8");
      const handlerBlock = extractHandlerBlock(
        content,
        "asset:get-blockchain-info",
      );
      expect(handlerBlock).toMatch(/return\s+null/);
    });
  });

  // ============================================================
  // 按功能域分组验证
  // ============================================================

  describe("按功能域分类验证", () => {
    it("should have 2 + 2 + 3 + 3 = 10 total handlers", () => {
      expect(handlers.length).toBe(10);
    });

    it("should group handlers correctly by functional domain", () => {
      const createMintCount = handlers.filter((h) =>
        ["asset:create", "asset:mint"].includes(h),
      ).length;
      const transferBurnCount = handlers.filter((h) =>
        ["asset:transfer", "asset:burn"].includes(h),
      ).length;
      const queryCount = handlers.filter((h) =>
        ["asset:get", "asset:get-by-owner", "asset:get-all"].includes(h),
      ).length;
      const historyBalanceCount = handlers.filter((h) =>
        [
          "asset:get-history",
          "asset:get-balance",
          "asset:get-blockchain-info",
        ].includes(h),
      ).length;

      expect(createMintCount).toBe(2);
      expect(transferBurnCount).toBe(2);
      expect(queryCount).toBe(3);
      expect(historyBalanceCount).toBe(3);
    });

    it("writing operations should include: create, mint, transfer, burn", () => {
      const writeOps = [
        "asset:create",
        "asset:mint",
        "asset:transfer",
        "asset:burn",
      ];
      writeOps.forEach((op) => expect(handlers).toContain(op));
    });

    it("reading operations should include: get, get-by-owner, get-all, get-history, get-balance, get-blockchain-info", () => {
      const readOps = [
        "asset:get",
        "asset:get-by-owner",
        "asset:get-all",
        "asset:get-history",
        "asset:get-balance",
        "asset:get-blockchain-info",
      ];
      readOps.forEach((op) => expect(handlers).toContain(op));
    });
  });

  // ============================================================
  // Handler 命名约定验证
  // ============================================================

  describe("Handler 命名约定", () => {
    it('all handlers should start with "asset:" prefix', () => {
      handlers.forEach((channel) => {
        expect(channel.startsWith("asset:")).toBe(true);
      });
    });

    it("all handlers should use kebab-case naming convention", () => {
      const validPattern = /^asset:[a-z]+(-[a-z]+)*$/;
      handlers.forEach((channel) => {
        expect(validPattern.test(channel)).toBe(true);
      });
    });

    it("no handler should use underscores in channel name", () => {
      handlers.forEach((channel) => {
        expect(channel).not.toContain("_");
      });
    });

    it("no handler should use uppercase letters in channel name", () => {
      handlers.forEach((channel) => {
        expect(channel).toMatch(/^[a-z0-9:_-]+$/);
      });
    });
  });

  // ============================================================
  // AssetManager 方法调用验证
  // ============================================================

  describe("AssetManager 方法调用验证", () => {
    it("asset:create should call assetManager.createAsset", () => {
      const content = fs.readFileSync(ASSET_IPC_PATH, "utf-8");
      const handlerBlock = extractHandlerBlock(content, "asset:create");
      expect(handlerBlock).toMatch(/assetManager\.createAsset\(options\)/);
    });

    it("asset:mint should call assetManager.mintAsset", () => {
      const content = fs.readFileSync(ASSET_IPC_PATH, "utf-8");
      const handlerBlock = extractHandlerBlock(content, "asset:mint");
      expect(handlerBlock).toMatch(
        /assetManager\.mintAsset\(assetId,\s*toDid,\s*amount\)/,
      );
    });

    it("asset:transfer should call assetManager.transferAsset", () => {
      const content = fs.readFileSync(ASSET_IPC_PATH, "utf-8");
      const handlerBlock = extractHandlerBlock(content, "asset:transfer");
      expect(handlerBlock).toMatch(
        /assetManager\.transferAsset\(assetId,\s*toDid,\s*amount,\s*memo\)/,
      );
    });

    it("asset:burn should call assetManager.burnAsset", () => {
      const content = fs.readFileSync(ASSET_IPC_PATH, "utf-8");
      const handlerBlock = extractHandlerBlock(content, "asset:burn");
      expect(handlerBlock).toMatch(
        /assetManager\.burnAsset\(assetId,\s*amount\)/,
      );
    });

    it("asset:get should call assetManager.getAsset", () => {
      const content = fs.readFileSync(ASSET_IPC_PATH, "utf-8");
      const handlerBlock = extractHandlerBlock(content, "asset:get");
      expect(handlerBlock).toMatch(/assetManager\.getAsset\(assetId\)/);
    });

    it("asset:get-by-owner should call assetManager.getAssetsByOwner", () => {
      const content = fs.readFileSync(ASSET_IPC_PATH, "utf-8");
      const handlerBlock = extractHandlerBlock(content, "asset:get-by-owner");
      expect(handlerBlock).toMatch(
        /assetManager\.getAssetsByOwner\(ownerDid\)/,
      );
    });

    it("asset:get-all should call assetManager.getAllAssets", () => {
      const content = fs.readFileSync(ASSET_IPC_PATH, "utf-8");
      const handlerBlock = extractHandlerBlock(content, "asset:get-all");
      expect(handlerBlock).toMatch(/assetManager\.getAllAssets\(filters\)/);
    });

    it("asset:get-history should call assetManager.getAssetHistory", () => {
      const content = fs.readFileSync(ASSET_IPC_PATH, "utf-8");
      const handlerBlock = extractHandlerBlock(content, "asset:get-history");
      expect(handlerBlock).toMatch(
        /assetManager\.getAssetHistory\(assetId,\s*limit\)/,
      );
    });

    it("asset:get-balance should call assetManager.getBalance", () => {
      const content = fs.readFileSync(ASSET_IPC_PATH, "utf-8");
      const handlerBlock = extractHandlerBlock(content, "asset:get-balance");
      expect(handlerBlock).toMatch(
        /assetManager\.getBalance\(ownerDid,\s*assetId\)/,
      );
    });

    it("asset:get-blockchain-info should call assetManager._getBlockchainAsset", () => {
      const content = fs.readFileSync(ASSET_IPC_PATH, "utf-8");
      const handlerBlock = extractHandlerBlock(
        content,
        "asset:get-blockchain-info",
      );
      expect(handlerBlock).toMatch(
        /assetManager\._getBlockchainAsset\(assetId\)/,
      );
    });
  });

  // ============================================================
  // 完整性验证
  // ============================================================

  describe("完整性验证", () => {
    it("should have no missing handlers from specification", () => {
      const missing = expectedChannels.filter((h) => !handlers.includes(h));
      expect(missing).toEqual([]);
    });

    it("should have no unexpected handlers beyond specification", () => {
      const unexpected = handlers.filter((h) => !expectedChannels.includes(h));
      expect(unexpected).toEqual([]);
    });

    it("should maintain 1:1 mapping between specified and registered handlers", () => {
      expect(handlers.length).toBe(expectedChannels.length);
    });

    it("should log successful registration", () => {
      const content = fs.readFileSync(ASSET_IPC_PATH, "utf-8");
      expect(content).toMatch(/console\.log.*10 handlers registered/);
    });
  });

  // ============================================================
  // 特殊功能验证
  // ============================================================

  describe("特殊功能验证", () => {
    it("should have handlers for all 4 asset write operations", () => {
      expect(handlers).toContain("asset:create");
      expect(handlers).toContain("asset:mint");
      expect(handlers).toContain("asset:transfer");
      expect(handlers).toContain("asset:burn");
    });

    it("should have handlers for all 3 asset query operations", () => {
      expect(handlers).toContain("asset:get");
      expect(handlers).toContain("asset:get-by-owner");
      expect(handlers).toContain("asset:get-all");
    });

    it("should have handlers for history and balance queries", () => {
      expect(handlers).toContain("asset:get-history");
      expect(handlers).toContain("asset:get-balance");
      expect(handlers).toContain("asset:get-blockchain-info");
    });

    it("should support blockchain integration", () => {
      expect(handlers).toContain("asset:get-blockchain-info");
    });
  });

  // ============================================================
  // 功能覆盖度验证
  // ============================================================

  describe("功能覆盖度验证", () => {
    it("should cover complete asset lifecycle: create -> mint -> transfer -> burn", () => {
      const lifecycle = [
        "asset:create",
        "asset:mint",
        "asset:transfer",
        "asset:burn",
      ];
      lifecycle.forEach((op) => expect(handlers).toContain(op));
    });

    it("should cover complete query lifecycle: get -> get-by-owner -> get-all -> get-history", () => {
      const queryLifecycle = [
        "asset:get",
        "asset:get-by-owner",
        "asset:get-all",
        "asset:get-history",
      ];
      queryLifecycle.forEach((op) => expect(handlers).toContain(op));
    });

    it("should support balance tracking", () => {
      expect(handlers).toContain("asset:get-balance");
    });

    it("should support blockchain deployment information", () => {
      expect(handlers).toContain("asset:get-blockchain-info");
    });
  });
});

/**
 * 辅助函数：从源代码中提取特定 handler 的代码块
 */
function extractHandlerBlock(content, channelName) {
  const escapedChannel = channelName.replace(/:/g, "\\:");
  const pattern = new RegExp(
    `ipcMain\\.handle\\(['"]${escapedChannel}['"].*?\\n  \\}\\);`,
    "s",
  );
  const match = content.match(pattern);
  return match ? match[0] : "";
}
