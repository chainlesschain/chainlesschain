/**
 * WebDAV sync provider — Phase 3c.2 真实实现。
 *
 * 通过 `electronAPI.sync.webdav.run()` 调主进程 webdav-engine 跑一轮
 * （drain tombstones + push 增量）。失败 / 冲突由主进程已写到 cursor，
 * 这里只关心 success / error / detail 给 syncScheduler 看。
 */

import type { SyncProvider, SyncProviderResult } from "./types";

interface WebDAVRunResult {
  success: boolean;
  status?: "success" | "conflict" | "failed";
  pushed?: number;
  skipped?: number;
  deleted?: number;
  durationMs?: number;
  error?: string;
}

export const webdavProvider: SyncProvider = {
  id: "webdav",
  name: "WebDAV 网盘",
  description: "Nextcloud / 坚果云 / 群晖等 WebDAV 协议网盘",
  configRoute: "/settings/sync-webdav",

  available: () => {
    return typeof (window as any).electronAPI?.sync?.webdav?.run === "function";
  },

  async runOnce(): Promise<SyncProviderResult> {
    const api = (window as any).electronAPI?.sync?.webdav;
    if (!api?.run) {
      return { success: false, error: "WebDAV IPC 未就绪" };
    }
    try {
      const res = (await api.run()) as WebDAVRunResult;
      if (!res) {
        return { success: false, error: "WebDAV 同步无响应" };
      }
      const detail = `推送 ${res.pushed ?? 0} / 跳过 ${res.skipped ?? 0} / 删除 ${res.deleted ?? 0}`;
      if (!res.success) {
        return {
          success: false,
          error: res.error || "WebDAV 同步失败",
          detail,
        };
      }
      // success 但 status='conflict' 时仍算 success，detail 提示用户
      return { success: true, detail };
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (/未配置/.test(msg)) {
        return {
          success: false,
          error: "WebDAV 同步未配置，请先在 设置 → 同步 → WebDAV 填写凭证",
        };
      }
      return { success: false, error: msg };
    }
  },
};
