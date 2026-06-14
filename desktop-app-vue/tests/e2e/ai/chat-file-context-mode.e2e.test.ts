/**
 * E2E — 生产版 AI 对话页 (/ai/chat, AIChatPage.vue) 的「包含当前文件」上下文
 *
 * 背景:active-file 上下文最初做进了 V6 预览壳 (shell/AIChatPanel.vue, 仅 /v2),
 * 生产 app 用的是 MainLayout + /ai/chat (AIChatPage.vue) —— e2e 发现该错位后端口到
 * 生产页:读 `projectStore.currentFile`(跨导航持久,适合独立的 /ai/chat 页),开了
 * 文件才显示「包含当前文件」开关,勾选则把文件内容注入 LLM message。
 *
 * 本测试真驱动 Electron 验证生产页的可达性 + 门控:
 *   1. 没打开文件时 /ai/chat 无「包含当前文件」开关
 *   2. 打开项目文件(currentFile 持久)后回到 /ai/chat → 开关出现
 */
import { test, expect, Page } from "@playwright/test";
import {
  launchElectronApp,
  closeElectronApp,
  login,
  forceCloseAllModals,
} from "../helpers/common";
import {
  createAndOpenProject,
  createTestFile,
  refreshFileList,
  selectFileInTree,
} from "../helpers/project-detail";

async function gotoAiChat(window: Page): Promise<void> {
  await forceCloseAllModals(window);
  await window.evaluate(() => {
    window.location.hash = "#/ai/chat";
  });
  await window.waitForTimeout(1500);
}

function fileToggle(window: Page) {
  return window.locator('[data-testid="file-context-toggle"]');
}

test.describe("生产 AI 对话页 - 当前文件上下文门控", () => {
  test("「包含当前文件」开关仅在打开项目文件后出现", async () => {
    const { app, window } = await launchElectronApp();
    try {
      await login(window);
      await window.waitForTimeout(1000);

      // 1) 还没打开任何文件 → /ai/chat 不显示开关
      await gotoAiChat(window);
      expect(await fileToggle(window).count()).toBe(0);

      // 2) 打开一个项目文件(projectStore.currentFile 跨导航持久)
      const project = await createAndOpenProject(window, {
        name: "E2E ActiveFile " + Date.now(),
        project_type: "markdown",
      });
      await createTestFile(window, project.id, {
        fileName: "active-note.md",
        content: "# Active file body for context",
        fileType: "markdown",
      });
      // The tree is loaded at project-open; refresh so the new file shows up.
      await refreshFileList(window);
      const opened = await selectFileInTree(window, "active-note.md");
      expect(opened).toBe(true);
      await window.waitForTimeout(800);

      // 3) 回到 /ai/chat → 「包含当前文件」开关出现
      await gotoAiChat(window);
      // Wait for AIChatPage to mount (its input) before asserting the toggle,
      // so the assertion doesn't race the route/render.
      await window.waitForSelector("textarea", { timeout: 15000 });
      await window.waitForSelector('[data-testid="file-context-toggle"]', {
        timeout: 10000,
      });
      expect(await fileToggle(window).count()).toBeGreaterThan(0);
      await expect(fileToggle(window)).toContainText("active-note.md");
    } finally {
      await closeElectronApp(app);
    }
  });
});
