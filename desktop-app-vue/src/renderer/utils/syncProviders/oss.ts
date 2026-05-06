/**
 * S3 / OSS sync provider — placeholder.
 *
 * 覆盖 AWS S3 / 阿里云 OSS / Cloudflare R2 / Backblaze B2 等 S3 兼容存储。
 * Phase 3c 加 @aws-sdk/client-s3 (~150kb gz) + 凭证加密存储。
 */

import type { SyncProvider, SyncProviderResult } from "./types";

export const ossProvider: SyncProvider = {
  id: "oss",
  name: "对象存储 (S3 / OSS)",
  description: "（敬请期待）AWS S3 / 阿里云 OSS / Cloudflare R2 等 S3 兼容服务",
  placeholder: true,
  available: () => false,
  async runOnce(): Promise<SyncProviderResult> {
    return {
      success: false,
      error: "OSS 同步尚未启用（Phase 3c）",
    };
  },
};
