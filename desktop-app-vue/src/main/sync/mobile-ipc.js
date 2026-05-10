/**
 * Mobile Sync IPC 处理器（Phase 3d M2 step 7 + M4.5 register-manual）
 *
 * 暴露 6 个 IPC channel：
 *   sync:mobile:run             —— 对单个 paired 设备跑一轮 sync (push + pull)
 *   sync:mobile:run-all         —— 遍历所有 paired 设备跑 sync，返回汇总
 *   sync:mobile:status          —— 列已配对设备 + 各自的 cursor 状态
 *   sync:mobile:list-paired     —— 仅列设备元信息（不读 cursor）
 *   sync:mobile:unpair          —— 解绑设备 + 清 cursor + 清相关 tombstone
 *   sync:mobile:register-manual —— M4.5 手动配对：注册一个 mobile 设备到 deviceManager
 *
 * 设计：
 *   - dependencies-injection：registerMobileSyncIPC({ database, mainWindow, app })
 *   - 走 ipcGuard 防重复注册
 *   - app.mobileBridgeSync / app.mobileBridge / app.deviceManager 在 IPC 调用时
 *     惰性查找（initializeMobileBridge 是 async，phase-8-9-extras 注册 IPC 时
 *     这些可能还没 ready）。未就绪时返回明确错误。
 */

const { logger } = require("../utils/logger.js");
const ipcGuard = require("../ipc/ipc-guard");
const store = require("./sync-external-store");

const PROVIDER_ID = "mobile";

/**
 * 找出所有已 paired 的 mobile 设备的 deviceId 列表。优先从
 * deviceManager（device-pairing-handler 注册的设备），fallback 到
 * mobileBridge.dataChannels（活跃 WebRTC 连接）。
 */
function _listPairedDeviceIds(app) {
  const ids = new Set();
  const deviceManager = app?.deviceManager;
  if (deviceManager?.getRegisteredDevices) {
    for (const d of deviceManager.getRegisteredDevices() || []) {
      if (d?.deviceId) {
        ids.add(d.deviceId);
      }
    }
  }
  const mobileBridge = app?.mobileBridge;
  if (mobileBridge?.dataChannels?.keys) {
    for (const peerId of mobileBridge.dataChannels.keys()) {
      ids.add(peerId);
    }
  }
  return Array.from(ids);
}

function _statusForDevice(database, deviceId) {
  const cursor = store.getCursor(database, PROVIDER_ID, deviceId) || {};
  return {
    deviceId,
    lastSyncAt: cursor.lastSyncAt ?? null,
    lastRunStatus: cursor.lastRunStatus ?? null,
    lastRunError: cursor.lastRunError ?? null,
    lastRunDurationMs: cursor.lastRunDurationMs ?? null,
    itemsPushed: cursor.itemsPushed ?? 0,
    itemsSkipped: cursor.itemsSkipped ?? 0,
    itemsDeleted: cursor.itemsDeleted ?? 0,
  };
}

/**
 * @param {Object} deps
 * @param {Object} deps.database     — DatabaseManager
 * @param {Object} deps.mainWindow   — BrowserWindow（事件推送预留）
 * @param {Object} deps.app          — main process app 实例（lazy 读 mobileBridgeSync 等）
 * @param {Object} [deps.ipcMain]    — 测试注入
 */
function registerMobileSyncIPC({
  database,
  mainWindow: _mainWindow,
  app,
  ipcMain: injectedIpcMain,
}) {
  if (ipcGuard.isModuleRegistered("mobile-ipc")) {
    logger.info("[Mobile Sync IPC] 已注册，跳过");
    return;
  }
  const ipcMain = injectedIpcMain || require("electron").ipcMain;

  // ── sync:mobile:run ───────────────────────────────────────────
  ipcMain.handle("sync:mobile:run", async (_event, deviceId) => {
    if (!deviceId || typeof deviceId !== "string") {
      return { success: false, error: "deviceId 必填" };
    }
    if (!app?.mobileBridgeSync) {
      return {
        success: false,
        error: "MobileBridgeSync 未就绪（移动桥未启动）",
      };
    }
    try {
      const res = await app.mobileBridgeSync.runOnce(deviceId);
      return {
        success: !res.error,
        deviceId,
        pushed: res.pushed || 0,
        pulled: res.pulled || 0,
        conflicts: res.conflicts || 0,
        durationMs: res.durationMs || 0,
        error: res.error || undefined,
      };
    } catch (err) {
      logger.error("[Mobile Sync IPC] run 异常:", err);
      return { success: false, error: err?.message || String(err) };
    }
  });

  // ── sync:mobile:run-all ───────────────────────────────────────
  ipcMain.handle("sync:mobile:run-all", async () => {
    if (!app?.mobileBridgeSync) {
      return { success: false, error: "MobileBridgeSync 未就绪", devices: [] };
    }
    const ids = _listPairedDeviceIds(app);
    if (ids.length === 0) {
      return {
        success: false,
        error: "无已配对的移动设备",
        devices: [],
      };
    }
    const devices = [];
    for (const deviceId of ids) {
      try {
        const res = await app.mobileBridgeSync.runOnce(deviceId);
        devices.push({
          deviceId,
          pushed: res.pushed || 0,
          pulled: res.pulled || 0,
          conflicts: res.conflicts || 0,
          durationMs: res.durationMs || 0,
          error: res.error || undefined,
        });
      } catch (err) {
        devices.push({
          deviceId,
          pushed: 0,
          pulled: 0,
          conflicts: 0,
          error: err?.message || String(err),
        });
      }
    }
    const failed = devices.filter((d) => d.error).length;
    return { success: failed === 0, devices };
  });

  // ── sync:mobile:status ────────────────────────────────────────
  ipcMain.handle("sync:mobile:status", async () => {
    try {
      const ids = _listPairedDeviceIds(app);
      const devices = ids.map((id) => _statusForDevice(database, id));
      // tombstone 按 (provider_id, account_key=deviceId) 分行写入；遍历 paired
      // 设备 OR 起来。空设备列表 → 无 pendingTombstones。
      const MOBILE_RESOURCE_TYPES = [
        "MESSAGE",
        "FRIEND",
        "POST",
        "POST_COMMENT",
        "NOTIFICATION",
      ];
      const pendingTombstones = ids.some(
        (id) =>
          store.listTombstones(
            database,
            PROVIDER_ID,
            id,
            1,
            MOBILE_RESOURCE_TYPES,
          ).length > 0,
      );
      return {
        success: true,
        devices,
        pendingTombstones,
        bridgeReady: !!app?.mobileBridgeSync,
      };
    } catch (err) {
      logger.error("[Mobile Sync IPC] status 异常:", err);
      return { success: false, error: err?.message || String(err) };
    }
  });

  // ── sync:mobile:list-paired ───────────────────────────────────
  ipcMain.handle("sync:mobile:list-paired", async () => {
    try {
      const deviceManager = app?.deviceManager;
      const registered = deviceManager?.getRegisteredDevices
        ? deviceManager.getRegisteredDevices()
        : [];
      const liveSet = new Set();
      const mobileBridge = app?.mobileBridge;
      if (mobileBridge?.dataChannels?.keys) {
        for (const peerId of mobileBridge.dataChannels.keys()) {
          liveSet.add(peerId);
        }
      }
      const devices = (registered || []).map((d) => ({
        deviceId: d.deviceId,
        deviceName: d.deviceName || d.deviceInfo?.name || "(unknown)",
        platform: d.platform || d.deviceInfo?.platform || null,
        did: d.did || null,
        pairedAt: d.pairedAt || null,
        online: liveSet.has(d.deviceId),
      }));
      return { success: true, devices };
    } catch (err) {
      logger.error("[Mobile Sync IPC] list-paired 异常:", err);
      return {
        success: false,
        error: err?.message || String(err),
        devices: [],
      };
    }
  });

  // ── sync:mobile:register-manual ───────────────────────────────
  // Phase 3d M4.5：手动添加配对设备（v0 跳过 QR + 6 位码 + DID 互信流程）。
  // 用户在 Android 端拿到 deviceId / DID / deviceName，在 desktop UI 输入。
  // v1.1 替换为完整 DevicePairingHandler QR 流程。
  ipcMain.handle("sync:mobile:register-manual", async (_event, payload) => {
    const { deviceId, did, deviceName, platform } = payload || {};
    if (!deviceId || typeof deviceId !== "string") {
      return { success: false, error: "deviceId 必填" };
    }
    if (!did || typeof did !== "string") {
      return { success: false, error: "DID 必填" };
    }
    const deviceManager = app?.deviceManager;
    if (!deviceManager?.registerDevice) {
      return { success: false, error: "DeviceManager 未就绪" };
    }
    try {
      // userId 用 DID — DeviceManager 主 API 是 (userId, device) 二元，DID 是
      // 用户身份的合理映射。
      await deviceManager.registerDevice(did, {
        deviceId,
        deviceName: deviceName || `(unnamed) ${deviceId.slice(0, 8)}`,
        platform: platform || "android",
        did,
        pairedAt: Date.now(),
        lastActiveAt: Date.now(),
      });
      return { success: true, deviceId };
    } catch (err) {
      logger.error("[Mobile Sync IPC] register-manual 异常:", err);
      return { success: false, error: err?.message || String(err) };
    }
  });

  // ── sync:mobile:unpair ────────────────────────────────────────
  ipcMain.handle("sync:mobile:unpair", async (_event, deviceId) => {
    if (!deviceId || typeof deviceId !== "string") {
      return { success: false, error: "deviceId 必填" };
    }
    try {
      // 1) deviceManager 移除注册（用 M4.5 新加的单参数 unregisterDeviceById）
      const deviceManager = app?.deviceManager;
      if (deviceManager?.unregisterDeviceById) {
        try {
          await deviceManager.unregisterDeviceById(deviceId);
        } catch (e) {
          logger.warn(
            "[Mobile Sync IPC] deviceManager.unregisterDeviceById 失败:",
            e?.message,
          );
        }
      }
      // 2) 清 cursor 行（Phase 3c sync_external_provider_cursor）
      try {
        store.resetCursor(database, PROVIDER_ID, deviceId);
      } catch (e) {
        logger.warn("[Mobile Sync IPC] resetCursor 失败:", e?.message);
      }
      // 3) 清该设备的 tombstone（trigger 仍会写新 tombstone，但只有这台设备的旧
      // tombstone 不再有目标，可以安全清理）
      try {
        database.run(
          `DELETE FROM sync_external_tombstones
           WHERE provider_id = ? AND account_key = ?`,
          [PROVIDER_ID, deviceId],
        );
      } catch (e) {
        logger.warn("[Mobile Sync IPC] 清 tombstone 失败:", e?.message);
      }
      return { success: true };
    } catch (err) {
      logger.error("[Mobile Sync IPC] unpair 异常:", err);
      return { success: false, error: err?.message || String(err) };
    }
  });

  ipcGuard.markModuleRegistered("mobile-ipc");
  logger.info(
    "[Mobile Sync IPC] ✓ 6 个 channel 已注册 (run / run-all / status / list-paired / unpair / register-manual)",
  );
}

module.exports = {
  registerMobileSyncIPC,
  PROVIDER_ID,
};
