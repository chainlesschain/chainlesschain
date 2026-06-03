/**
 * P2P sync provider — 触发当前设备对所有已配对设备的增量同步。
 *
 * 复用 main 已有 `p2p:start-device-sync`（per-device）。MVP 简化：拿
 * `getUserDevices(currentDID)` 列表，对每个设备 startDeviceSync，串行。
 * 无配对设备时返回 success=true + detail="无配对设备"。
 */

import type { SyncProvider, SyncProviderResult } from "./types";

export const p2pProvider: SyncProvider = {
  id: "p2p",
  name: "P2P 设备",
  description: "通过 libp2p 与已配对的桌面 / 移动设备直连同步",
  available: () => {
    return (
      typeof (window as any).electronAPI?.p2p?.startDeviceSync === "function"
    );
  },
  async runOnce(): Promise<SyncProviderResult> {
    const api = (window as any).electronAPI?.p2p;
    if (!api?.startDeviceSync) {
      return { success: false, error: "p2p IPC 未就绪" };
    }
    try {
      const cur = api.getCurrentDevice ? await api.getCurrentDevice() : null;
      const userId = cur?.userId || cur?.did || cur?.id;
      const devices =
        api.getUserDevices && userId ? await api.getUserDevices(userId) : [];
      const peers = Array.isArray(devices)
        ? devices.filter((d: any) => d?.id && d.id !== cur?.id)
        : [];
      if (peers.length === 0) {
        return { success: true, detail: "无配对设备" };
      }
      const failures: string[] = [];
      for (const peer of peers) {
        try {
          const res = await api.startDeviceSync(peer.id);
          if (!res?.success) {
            failures.push(peer.id);
          }
        } catch (err: any) {
          failures.push(peer.id + "(" + (err?.message || "err") + ")");
        }
      }
      if (failures.length === 0) {
        return {
          success: true,
          detail: `已触发 ${peers.length} 台设备同步`,
        };
      }
      return {
        success: false,
        error: `部分失败：${failures.join(", ")}`,
        detail: `成功 ${peers.length - failures.length}/${peers.length}`,
      };
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) };
    }
  },
};
