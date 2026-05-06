/**
 * WebDAV sync provider — placeholder.
 *
 * 覆盖 Nextcloud / 坚果云 / 群晖等通用网盘协议。Phase 3c 加 webdav 库 +
 * 凭证加密存储 + markdown 包导出。
 */

import type { SyncProvider, SyncProviderResult } from "./types";

export const webdavProvider: SyncProvider = {
  id: "webdav",
  name: "WebDAV 网盘",
  description: "（敬请期待）Nextcloud / 坚果云 / 群晖等支持 WebDAV 协议的网盘",
  placeholder: true,
  available: () => false,
  async runOnce(): Promise<SyncProviderResult> {
    return {
      success: false,
      error: "WebDAV 同步尚未启用（Phase 3c）",
    };
  },
};
