/**
 * Backend HTTP sync provider — wraps `electronAPI.sync.incremental()`.
 *
 * 失败若是"未初始化"，透明回退到 `sync.start()` 后重试一次。
 */

import type { SyncProvider, SyncProviderResult } from "./types";

const NOT_INIT = /未初始化|not initialized|uninitialized/i;

export const backendProvider: SyncProvider = {
  id: "backend",
  name: "Backend 同步",
  description: "通过中心化 backend 增量同步全量数据",
  available: () => {
    return typeof (window as any).electronAPI?.sync?.incremental === "function";
  },
  async runOnce(): Promise<SyncProviderResult> {
    const api = (window as any).electronAPI?.sync;
    if (!api?.incremental) {
      return { success: false, error: "sync IPC 未就绪" };
    }
    try {
      let res = await api.incremental();
      if (
        !res?.success &&
        typeof res?.error === "string" &&
        NOT_INIT.test(res.error) &&
        typeof api.start === "function"
      ) {
        const startRes = await api.start();
        if (!startRes?.success) {
          return {
            success: false,
            error: startRes?.error || "sync.start 失败",
          };
        }
        res = await api.incremental();
      }
      return {
        success: !!res?.success,
        error: res?.success ? undefined : res?.error || "同步失败",
      };
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) };
    }
  },
};
