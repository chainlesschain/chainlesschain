/**
 * Multi-Agent IPC 处理器单元测试
 *
 * 测试覆盖：模块可导入性、导出声明、IPC 通道声明。
 *
 * 注意: 源文件 multi-agent-ipc.js 在模块顶层用 CommonJS
 * require('electron') 加载 ipcMain，Vitest 的 vi.mock 不能可靠地拦截
 * CommonJS require。因此 handler 级的行为测试（dispatch/parallel/chain/
 * message/broadcast/stats/history/debug 等 13 个通道）无法在 Vitest
 * 单元测试中执行。这是 Vitest 测试 Electron 主进程的已知限制，不会通过
 * 继续添加空壳 describe.skip 解决。
 *
 * 若要补充这些 handler 级测试，需要其中之一：
 *   1. 源文件改造为 ESM 或注入 ipcMain 依赖
 *   2. 使用 Electron 测试框架（Spectron / Playwright-Electron）
 *   3. 增加真正运行的 IPC 集成测试套件
 *
 * 在上述条件满足前，本文件只保留通过源码文本分析得到的结构性验证。
 */

import { describe, it, expect } from "vitest";

describe("Multi-Agent IPC Handler", () => {
  describe("Module Structure", () => {
    it("should have a file that can be imported", async () => {
      const fs = await import("fs");
      const path = await import("path");

      const modulePath = path.resolve(
        process.cwd(),
        "src/main/ai-engine/multi-agent/multi-agent-ipc.js",
      );

      expect(fs.existsSync(modulePath)).toBe(true);
    });

    it("should export registerMultiAgentIPC function", async () => {
      const fs = await import("fs");
      const path = await import("path");

      const modulePath = path.resolve(
        process.cwd(),
        "src/main/ai-engine/multi-agent/multi-agent-ipc.js",
      );

      const content = fs.readFileSync(modulePath, "utf-8");

      expect(content).toContain("module.exports");
      expect(content).toContain("registerMultiAgentIPC");
    });

    it("should define all expected IPC channels in source code", async () => {
      const fs = await import("fs");
      const path = await import("path");

      const modulePath = path.resolve(
        process.cwd(),
        "src/main/ai-engine/multi-agent/multi-agent-ipc.js",
      );

      const content = fs.readFileSync(modulePath, "utf-8");

      const expectedChannels = [
        "agent:list",
        "agent:get",
        "agent:dispatch",
        "agent:execute-parallel",
        "agent:execute-chain",
        "agent:get-capable",
        "agent:send-message",
        "agent:broadcast",
        "agent:get-messages",
        "agent:get-stats",
        "agent:get-history",
        "agent:reset-stats",
        "agent:export-debug",
      ];

      for (const channel of expectedChannels) {
        expect(content).toContain(`"${channel}"`);
      }
    });
  });
});
