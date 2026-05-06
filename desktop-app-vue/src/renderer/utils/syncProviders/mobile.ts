/**
 * Mobile sync provider — placeholder.
 *
 * `mobile-sync-manager.js` 在 main 已存在但 IPC 未挂；移动端 Android skill
 * 也独立做。Phase 3d 真正接入；现在先占位让用户在 Settings 看到入口。
 */

import type { SyncProvider, SyncProviderResult } from "./types";

export const mobileProvider: SyncProvider = {
  id: "mobile",
  name: "移动设备",
  description: "（敬请期待）与 Android / iOS 端同步知识库与对话记录",
  placeholder: true,
  available: () => false,
  async runOnce(): Promise<SyncProviderResult> {
    return {
      success: false,
      error: "移动设备同步尚未启用（Phase 3d）",
    };
  },
};
