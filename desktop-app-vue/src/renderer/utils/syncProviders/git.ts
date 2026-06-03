/**
 * Git sync provider — wraps `electronAPI.git.sync()`（导出 markdown + autoSync）。
 */

import type { SyncProvider, SyncProviderResult } from "./types";

export const gitProvider: SyncProvider = {
  id: "git",
  name: "Git 仓库",
  description: "导出知识库为 Markdown 并 push 到远程 Git 仓库",
  configRoute: "/settings/system?tab=project",
  available: () => {
    return typeof (window as any).electronAPI?.git?.sync === "function";
  },
  async runOnce(): Promise<SyncProviderResult> {
    const api = (window as any).electronAPI?.git;
    if (!api?.sync) {
      return { success: false, error: "git IPC 未就绪" };
    }
    try {
      const res = await api.sync();
      // git:sync 主进程实现：成功返回 result（truthy），失败 throw
      return { success: !!res, detail: res ? "已 push" : undefined };
    } catch (err: any) {
      // 区分"未启用"为可读 hint
      const msg = err?.message || String(err);
      if (/未启用|not enabled/i.test(msg)) {
        return {
          success: false,
          error: "Git 同步未启用，请先在 设置 → 项目 配置远程仓库",
        };
      }
      return { success: false, error: msg };
    }
  },
};
