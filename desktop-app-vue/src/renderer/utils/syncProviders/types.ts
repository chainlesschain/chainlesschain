/**
 * SyncProvider 抽象 — Phase 3b
 *
 * 每个 provider 是一个独立同步目标（Backend HTTP / Git / P2P / Mobile /
 * WebDAV / OSS …）。renderer-side syncScheduler 在 tick 或用户点"立即同步"
 * 时遍历所有 enabled providers 串行跑各自的 runOnce()。
 *
 * 设计取舍：
 *   - 抽象做在 renderer 端而不是 main：每个 provider 已经有自己的 main IPC
 *     模块（sync-ipc / git-ipc / p2p-ipc 等），抽象层只做 router。
 *   - "可配置"目前指 enable/disable + 间隔；具体 provider 凭证（git remote,
 *     OSS key 等）走各自 Settings 子页，不在这一层。
 *   - WebDAV / OSS 暂为 placeholder（available()=false），避免阻塞主线落地；
 *     真实 client 留 Phase 3c。
 */

export interface SyncProviderResult {
  success: boolean;
  error?: string;
  /** Optional human-readable detail for last-status display. */
  detail?: string;
}

export interface SyncProvider {
  /** Stable id, used as localStorage key suffix. Must be url-safe. */
  id: string;
  /** Human display name (zh). */
  name: string;
  /** Short description for the Settings card. */
  description: string;
  /** True if the underlying IPC / capability is available right now. */
  available: () => Promise<boolean> | boolean;
  /** Trigger one synchronous round-trip. */
  runOnce: () => Promise<SyncProviderResult>;
  /** Optional route to a per-provider config page. */
  configRoute?: string;
  /**
   * If true, provider exists but isn't ready to use (UI shows
   * "敬请期待" badge). Distinct from available()=false (which means
   * the IPC/feature itself is unavailable in this environment).
   */
  placeholder?: boolean;
}
