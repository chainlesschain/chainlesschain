/**
 * Mobile (Android) sync provider — Phase 3d v1 真实实现。
 *
 * 通过 `electronAPI.sync.mobile.runAll()` 调主进程 mobile-bridge-sync
 * 对所有 paired 设备跑一轮（drain tombstones + push 增量 + sync.pull）。
 * 失败 / 冲突由 main 写到 cursor，这里只关心 success / error / detail
 * 给 syncScheduler 看。
 *
 * v1 同步范围：MESSAGE / FRIEND / POST / POST_COMMENT / NOTIFICATION
 * （CONTACT / KNOWLEDGE_ITEM / CONVERSATION 留 v2，详见
 * docs/design/Phase3d_Mobile_Sync_设计文档.md）。
 */

import type { SyncProvider, SyncProviderResult } from "./types";

interface DeviceRunResult {
  deviceId: string;
  pushed?: number;
  pulled?: number;
  conflicts?: number;
  durationMs?: number;
  error?: string;
}

interface RunAllResult {
  success: boolean;
  error?: string;
  devices: DeviceRunResult[];
}

export const mobileProvider: SyncProvider = {
  id: "mobile",
  name: "移动设备 (Android)",
  description: "Android 端 P2P 同步：好友 / 1:1 消息 / 朋友圈帖子+评论 / 通知",
  configRoute: "/settings/sync-mobile",

  available: () => {
    return (
      typeof (window as any).electronAPI?.sync?.mobile?.runAll === "function"
    );
  },

  async runOnce(): Promise<SyncProviderResult> {
    const api = (window as any).electronAPI?.sync?.mobile;
    if (!api?.runAll) {
      return { success: false, error: "Mobile sync IPC 未就绪" };
    }
    try {
      const res = (await api.runAll()) as RunAllResult;
      if (!res) {
        return { success: false, error: "Mobile sync 无响应" };
      }
      if (!res.devices || res.devices.length === 0) {
        return {
          success: false,
          error: res.error || "无配对的移动设备",
          detail: "请先在「设置 → 同步 → 移动设备」配对一台 Android",
        };
      }
      const totalPushed = res.devices.reduce((s, d) => s + (d.pushed || 0), 0);
      const totalPulled = res.devices.reduce((s, d) => s + (d.pulled || 0), 0);
      const totalConflicts = res.devices.reduce(
        (s, d) => s + (d.conflicts || 0),
        0,
      );
      const failed = res.devices.filter((d) => d.error);
      const detail =
        `推送 ${totalPushed} / 拉取 ${totalPulled} / 跳过 ${totalConflicts}` +
        (res.devices.length > 1 ? ` (${res.devices.length} 台设备)` : "");

      if (failed.length > 0) {
        return {
          success: false,
          error: `${failed.length}/${res.devices.length} 台设备同步失败：${failed[0].error || ""}`,
          detail,
        };
      }
      return { success: true, detail };
    } catch (err: any) {
      const msg = err?.message || String(err);
      return { success: false, error: msg };
    }
  },
};
