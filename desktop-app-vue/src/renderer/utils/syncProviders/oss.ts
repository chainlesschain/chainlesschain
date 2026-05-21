/**
 * S3 / OSS sync provider — Phase 3c.3 真实实现。
 *
 * 通过 `electronAPI.sync.oss.run()` 调主进程 oss-engine 跑一轮
 * (drain tombstones + push 增量)。失败 / 冲突由主进程已写到 cursor，
 * 这里只关心 success / error / detail 给 syncScheduler 看。
 *
 * 覆盖：AWS S3 / 阿里云 OSS / Cloudflare R2 / Backblaze B2 / MinIO 自建。
 */

import type { SyncProvider, SyncProviderResult } from "./types";

interface OSSRunResult {
  success: boolean;
  status?: "success" | "conflict" | "failed";
  pushed?: number;
  skipped?: number;
  deleted?: number;
  durationMs?: number;
  error?: string;
}

export const ossProvider: SyncProvider = {
  id: "oss",
  name: "对象存储 (S3 / OSS)",
  description:
    "AWS S3 / 阿里云 OSS / Cloudflare R2 / Backblaze B2 等 S3 兼容服务",
  configRoute: "/settings/sync-oss",

  available: () => {
    return typeof (window as any).electronAPI?.sync?.oss?.run === "function";
  },

  async runOnce(): Promise<SyncProviderResult> {
    const api = (window as any).electronAPI?.sync?.oss;
    if (!api?.run) {
      return { success: false, error: "OSS IPC 未就绪" };
    }
    try {
      const res = (await api.run()) as OSSRunResult;
      if (!res) {
        return { success: false, error: "OSS 同步无响应" };
      }
      const detail = `推送 ${res.pushed ?? 0} / 跳过 ${res.skipped ?? 0} / 删除 ${res.deleted ?? 0}`;
      if (!res.success) {
        return {
          success: false,
          error: res.error || "OSS 同步失败",
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
          error: "OSS 同步未配置，请先在 设置 → 同步 → 对象存储 填写凭证",
        };
      }
      return { success: false, error: msg };
    }
  },
};
