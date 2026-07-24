/**
 * Personal Data Hub IPC handlers.
 *
 * Surface (all under `personal-data-hub:` channel namespace):
 *
 *   ask           { question, options? }    → AskResult | { error }
 *   stats         ()                         → vault stats + adapter list
 *   health        ()                         → { llm, vault, kg, rag, sinkStatus }
 *   list-adapters ()                         → array of { name, version, ... }
 *   sync-adapter  { name, options? }         → SyncReport | { error }
 *   sync-all      { options? }               → array of SyncReports
 *   register-mock { name?, count?, seed? }   → { name } — dev/smoke helper
 *   unregister    { name }                   → { ok }
 *   query-events  { subtype?, since?, until?, actor?, adapter?, limit? }
 *                                            → array of Event entities
 *   recent-audit  { since?, action?, limit? }→ array of audit rows
 *   destroy       { confirm: true, alsoWipeAccounts?, alsoWipeMasterKey? }
 *                                            → { ok, removed: string[] }
 *                                              wipes vault.db + WAL/SHM; opts also
 *                                              clear email-accounts.json /
 *                                              alipay-accounts.json / master key
 *
 * Every handler catches errors and returns { error: string } rather than
 * throwing across the IPC boundary — Electron's default error
 * serialization loses .cause/.context.
 *
 * Renderer-side: `window.electron.invoke('personal-data-hub:ask', {...})`.
 */

"use strict";

const { ipcMain } = require("electron");
const { logger } = require("../utils/logger.js");
const hubWiring = require("../personal-data-hub/wiring.js");
const {
  runDedicatedBatchCollectors,
} = require("../personal-data-hub/sync-result.js");
const {
  getAIChatWizard,
} = require("../personal-data-hub/aichat-wizard-factory.js");
const {
  ingestSystemDataAndroidSnapshot,
} = require("@chainlesschain/personal-data-hub");

const NS = "personal-data-hub";
let _registered = false;

function safe(fn) {
  return async (_evt, payload) => {
    try {
      return await fn(payload || {});
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      logger.warn(`[${NS}] handler failed:`, msg);
      return { error: msg };
    }
  };
}

function register() {
  if (_registered) {
    return;
  }

  ipcMain.handle(
    `${NS}:ask`,
    safe(async ({ question, options }) => {
      const hub = await hubWiring.getHub();
      if (!hub.engine) {
        return {
          error: "Analysis engine unavailable — LLM manager not initialized",
        };
      }
      return await hub.engine.ask(question, options || {});
    }),
  );

  // Path Y wiring — return prompt context only (no LLM call). Caller hosts
  // the LLM (e.g. Android-side Volcengine Doubao via API key). Decouples
  // vault retrieval from inference so a mobile front-end can do AI analysis
  // even when the desktop has no working LLM provider configured.
  ipcMain.handle(
    `${NS}:retrieve-context`,
    safe(async ({ question, options }) => {
      const hub = await hubWiring.getHub();
      if (!hub.engine) {
        return {
          error: "Analysis engine unavailable — vault not initialized",
        };
      }
      return await hub.engine.retrieveContext(question, options || {});
    }),
  );

  // Path C wiring — phone-side採集器把 ContentResolver + PackageManager 数据
  // 拼成 snapshot 推上来；这里写 staging 文件 + 调既有 syncAdapter。snapshot
  // schemaVersion 必须 === 1，否则下面 adapter 会拒。
  ipcMain.handle(
    `${NS}:ingest-system-data-android`,
    safe(async ({ snapshot }) => {
      const hub = await hubWiring.getHub();
      return await ingestSystemDataAndroidSnapshot(hub, snapshot);
    }),
  );

  ipcMain.handle(
    `${NS}:stats`,
    safe(async () => {
      const hub = await hubWiring.getHub();
      return {
        vault: hub.vault.stats(),
        adapters: hub.registry.list(),
        hubDir: hub.hubDir,
        llm: hub.llm ? { name: hub.llm.name, isLocal: hub.llm.isLocal } : null,
      };
    }),
  );

  ipcMain.handle(
    `${NS}:health`,
    safe(async () => {
      const hub = await hubWiring.getHub();
      return {
        vault: { ok: !!hub.vault.db, schemaVersion: hub.vault.schemaVersion() },
        llm: hub.llm
          ? { ok: true, isLocal: hub.llm.isLocal, name: hub.llm.name }
          : { ok: false, reason: "LLM manager unavailable" },
        kgSink: { ok: !!hub.kgSink },
        ragSink: { ok: !!hub.ragSink },
      };
    }),
  );

  ipcMain.handle(
    `${NS}:list-adapters`,
    safe(async () => {
      const hub = await hubWiring.getHub();
      return hub.registry.list();
    }),
  );

  // Readiness — per-adapter "can I collect right now, and if not why".
  // Unlike list-adapters (static metadata) this probes each adapter's
  // authenticate({ readinessOnly: true }) so the UI can show 未配置/需采集/
  // 不支持 reasons instead of a misleading "healthy". See
  // AdapterRegistry.readiness() + adapter-readiness.js.
  ipcMain.handle(
    `${NS}:adapter-readiness`,
    safe(async ({ timeoutMs } = {}) => {
      const hub = await hubWiring.getHub();
      return await hub.registry.readiness(
        Number.isInteger(timeoutMs) ? { timeoutMs } : {},
      );
    }),
  );

  ipcMain.handle(
    `${NS}:sync-adapter`,
    safe(async ({ name, options }) => {
      const hub = await hubWiring.getHub();
      return await hub.registry.syncAdapter(name, options || {});
    }),
  );

  ipcMain.handle(
    `${NS}:sync-all`,
    safe(async ({ options }) => {
      const hub = await hubWiring.getHub();
      const registryReports = await hub.registry.syncAll(options || {});
      return await runDedicatedBatchCollectors(hub, registryReports);
    }),
  );

  ipcMain.handle(
    `${NS}:register-mock`,
    safe(async ({ name, count, seed }) => {
      const hub = await hubWiring.getHub();
      const adapter = hub.registerMockAdapter({
        name: name || "mock",
        count: typeof count === "number" ? count : 20,
        seed: typeof seed === "number" ? seed : 1,
      });
      return { name: adapter.name, version: adapter.version };
    }),
  );

  ipcMain.handle(
    `${NS}:unregister`,
    safe(async ({ name }) => {
      const hub = await hubWiring.getHub();
      const removed = hub.registry.unregister(name);
      return { ok: removed };
    }),
  );

  ipcMain.handle(
    `${NS}:query-events`,
    safe(async ({ subtype, since, until, actor, adapter, limit }) => {
      const hub = await hubWiring.getHub();
      return hub.vault.queryEvents({
        subtype,
        since,
        until,
        actor,
        adapter,
        limit,
      });
    }),
  );

  ipcMain.handle(
    `${NS}:recent-audit`,
    safe(async ({ since, action, limit }) => {
      const hub = await hubWiring.getHub();
      return hub.vault.queryAudit({ since, action, limit });
    }),
  );

  // ─── Destructive: wipe vault (兑现"数据可走"承诺) ────────────────────
  // Requires `confirm: true` to guard against accidental no-arg invocation.
  // Optional flags broaden the wipe to account configs and the master key.
  ipcMain.handle(
    `${NS}:destroy`,
    safe(async ({ confirm, alsoWipeAccounts, alsoWipeMasterKey } = {}) => {
      if (confirm !== true) {
        return {
          error:
            "Destructive: pass { confirm: true } to wipe vault. UI should require explicit user confirmation first.",
        };
      }

      const fs = require("node:fs");
      const path = require("node:path");
      const removed = [];

      const hub = await hubWiring.getHub();
      const hubDir = hub.hubDir;

      try {
        hub.vault.destroy();
        removed.push(
          path.join(hubDir, "vault.db"),
          path.join(hubDir, "vault.db-wal"),
          path.join(hubDir, "vault.db-shm"),
        );
      } catch (err) {
        logger.warn(
          "[PersonalDataHub] vault.destroy failed:",
          err && err.message,
        );
      }

      if (alsoWipeAccounts) {
        for (const f of ["email-accounts.json", "alipay-accounts.json"]) {
          const p = path.join(hubDir, f);
          try {
            if (fs.existsSync(p)) {
              fs.unlinkSync(p);
              removed.push(p);
            }
          } catch (_e) {
            // best-effort
          }
        }
      }

      if (alsoWipeMasterKey) {
        const keyDir = path.join(hubDir, "keys");
        try {
          if (fs.existsSync(keyDir)) {
            for (const f of fs.readdirSync(keyDir)) {
              try {
                fs.unlinkSync(path.join(keyDir, f));
                removed.push(path.join(keyDir, f));
              } catch (_e) {}
            }
          }
        } catch (_e) {}
      }

      // Release the singleton so the next getHub() rebuilds from scratch.
      try {
        hubWiring.close();
      } catch (err) {
        logger.warn("[PersonalDataHub] close failed:", err && err.message);
      }

      return { ok: true, removed };
    }),
  );

  // ─── Phase 5.6 — email config + event detail ─────────────────────────

  ipcMain.handle(
    `${NS}:test-email-auth`,
    safe(async ({ account }) => {
      const hub = await hubWiring.getHub();
      return await hub.testEmailAuth({ account });
    }),
  );

  ipcMain.handle(
    `${NS}:register-email`,
    safe(async ({ account, opts }) => {
      const hub = await hubWiring.getHub();
      return await hub.registerEmailAdapter({ account, opts: opts || {} });
    }),
  );

  ipcMain.handle(
    `${NS}:activate-email`,
    safe(async ({ email }) => {
      const hub = await hubWiring.getHub();
      return await hub.activateEmailAdapter(email);
    }),
  );

  ipcMain.handle(
    `${NS}:unregister-email`,
    safe(async ({ email }) => {
      const hub = await hubWiring.getHub();
      return await hub.unregisterEmailAdapter(email);
    }),
  );

  ipcMain.handle(
    `${NS}:list-email-accounts`,
    safe(async () => {
      const hub = await hubWiring.getHub();
      return hub.listEmailAccounts();
    }),
  );

  ipcMain.handle(
    `${NS}:event-detail`,
    safe(async ({ eventId }) => {
      const hub = await hubWiring.getHub();
      return hub.eventDetail(eventId);
    }),
  );

  // ─── Phase 6 — Alipay bill import ─────────────────────────────────────

  ipcMain.handle(
    `${NS}:register-alipay`,
    safe(async ({ account, opts }) => {
      const hub = await hubWiring.getHub();
      return await hub.registerAlipayAdapter({ account, opts: opts || {} });
    }),
  );

  ipcMain.handle(
    `${NS}:activate-alipay`,
    safe(async ({ email }) => {
      const hub = await hubWiring.getHub();
      return await hub.activateAlipayAdapter(email);
    }),
  );

  ipcMain.handle(
    `${NS}:unregister-alipay`,
    safe(async ({ email }) => {
      const hub = await hubWiring.getHub();
      return await hub.unregisterAlipayAdapter(email);
    }),
  );

  ipcMain.handle(
    `${NS}:list-alipay-accounts`,
    safe(async () => {
      const hub = await hubWiring.getHub();
      return hub.listAlipayAccounts();
    }),
  );

  ipcMain.handle(
    `${NS}:import-alipay-bill`,
    safe(async ({ zipPath, csvPath, zipPassword }) => {
      const hub = await hubWiring.getHub();
      return await hub.importAlipayBill({ zipPath, csvPath, zipPassword });
    }),
  );

  // ─── Phase 12.6.8 — WeChat env-probe + register / unregister / list ──

  ipcMain.handle(
    `${NS}:wechat-env-probe`,
    safe(async () => {
      const hub = await hubWiring.getHub();
      return await hub.probeWechatEnv();
    }),
  );

  ipcMain.handle(
    `${NS}:register-wechat`,
    safe(
      async ({
        account,
        dbPath,
        wechatDataPath,
        fridaOpts,
        keyProviderOverride,
      }) => {
        const hub = await hubWiring.getHub();
        return await hub.registerWechatAdapter({
          account,
          dbPath,
          wechatDataPath,
          fridaOpts,
          keyProviderOverride,
        });
      },
    ),
  );

  ipcMain.handle(
    `${NS}:activate-wechat`,
    safe(async ({ uin, fridaOpts, keyProviderOverride }) => {
      const hub = await hubWiring.getHub();
      return await hub.activateWechatAdapter(uin, {
        fridaOpts,
        keyProviderOverride,
      });
    }),
  );

  ipcMain.handle(
    `${NS}:unregister-wechat`,
    safe(async ({ uin }) => {
      const hub = await hubWiring.getHub();
      return await hub.unregisterWechatAdapter(uin);
    }),
  );

  ipcMain.handle(
    `${NS}:list-wechat-accounts`,
    safe(async () => {
      const hub = await hubWiring.getHub();
      return hub.listWechatAccounts();
    }),
  );

  // ─── Phase 8 — EntityResolver review / merge / unmerge ───────────────

  ipcMain.handle(
    `${NS}:review-queue-list`,
    safe(async ({ limit }) => {
      const hub = await hubWiring.getHub();
      return hub.vault.listReviewQueue({ limit: limit || 50 });
    }),
  );

  ipcMain.handle(
    `${NS}:review-decision`,
    safe(async ({ reviewId, decision }) => {
      const hub = await hubWiring.getHub();
      if (!hub.entityResolver) {
        return { error: "EntityResolver not wired" };
      }
      return hub.entityResolver.applyUserDecision({ reviewId, decision });
    }),
  );

  ipcMain.handle(
    `${NS}:manual-merge`,
    safe(async ({ aId, bId }) => {
      const hub = await hubWiring.getHub();
      if (!hub.entityResolver) {
        return { error: "EntityResolver not wired" };
      }
      return hub.entityResolver.manualMerge({ aId, bId });
    }),
  );

  ipcMain.handle(
    `${NS}:manual-unmerge`,
    safe(async ({ personId }) => {
      const hub = await hubWiring.getHub();
      if (!hub.entityResolver) {
        return { error: "EntityResolver not wired" };
      }
      return hub.entityResolver.manualUnmerge(personId);
    }),
  );

  ipcMain.handle(
    `${NS}:resolver-drain`,
    safe(async ({ limit }) => {
      const hub = await hubWiring.getHub();
      if (!hub.entityResolver) {
        return { error: "EntityResolver not wired" };
      }
      return await hub.entityResolver.drain({ limit: limit || 50 });
    }),
  );

  ipcMain.handle(
    `${NS}:resolver-stats`,
    safe(async () => {
      const hub = await hubWiring.getHub();
      return {
        queue: hub.vault.resolveQueueStats(),
        mergeGroups: hub.vault.stats().mergeGroups,
        reviewQueue: hub.vault.listReviewQueue({ limit: 1000 }).length,
      };
    }),
  );

  // ─── Phase 11 — internal analysis skills ─────────────────────────────

  ipcMain.handle(
    `${NS}:skills-list`,
    safe(async () => {
      const hub = await hubWiring.getHub();
      return hub.analysisSkillNames || [];
    }),
  );

  ipcMain.handle(
    `${NS}:run-skill`,
    safe(async ({ name, options }) => {
      const hub = await hubWiring.getHub();
      return await hub.runSkill(name, options || {});
    }),
  );

  // ─── Phase 10.3 — AIChat WebView 鉴权向导 ──────────────────────────────

  ipcMain.handle(
    `${NS}:aichat-open-login`,
    safe(async ({ vendor, opts }) => {
      const hub = await hubWiring.getHub();
      const wiz = getAIChatWizard({ hubDir: hub.hubDir });
      return await wiz.openVendorLogin({ vendor, opts: opts || {} });
    }),
  );

  ipcMain.handle(
    `${NS}:aichat-probe-cookies`,
    safe(async ({ vendor, cookieHeader }) => {
      const hub = await hubWiring.getHub();
      const wiz = getAIChatWizard({ hubDir: hub.hubDir });
      return await wiz.probeCookies({ vendor, cookieHeader });
    }),
  );

  ipcMain.handle(
    `${NS}:aichat-register-vendor`,
    safe(async ({ vendor, cookies, opts }) => {
      const hub = await hubWiring.getHub();
      const wiz = getAIChatWizard({ hubDir: hub.hubDir });
      return await wiz.registerVendor({ vendor, cookies, opts: opts || {} });
    }),
  );

  ipcMain.handle(
    `${NS}:aichat-rotate-login`,
    safe(async ({ vendor }) => {
      const hub = await hubWiring.getHub();
      const wiz = getAIChatWizard({ hubDir: hub.hubDir });
      return await wiz.rotateLoginPartition({ vendor });
    }),
  );

  ipcMain.handle(
    `${NS}:list-aichat-accounts`,
    safe(async () => {
      const hub = await hubWiring.getHub();
      return await hub.listAIChatAccounts();
    }),
  );

  ipcMain.handle(
    `${NS}:unregister-aichat`,
    safe(async ({ vendor }) => {
      const hub = await hubWiring.getHub();
      return await hub.unregisterAIChatVendor(vendor);
    }),
  );

  ipcMain.handle(
    `${NS}:aichat-health-check-once`,
    safe(async () => {
      const hub = await hubWiring.getHub();
      return await hub.runAIChatHealthCheckOnce();
    }),
  );

  // Phase 5.7 — streaming sync via webContents.send. The caller passes
  // `progressChannel` (e.g. a uuid); we push events to that channel
  // throughout the sync, then return the final report from invoke().
  // Renderer side: ipcRenderer.on(progressChannel, (_, evt) => ...) +
  // await ipcRenderer.invoke('personal-data-hub:sync-adapter-stream', {...}).
  ipcMain.handle(
    `${NS}:sync-adapter-stream`,
    async (evt, { name, options, progressChannel }) => {
      try {
        const hub = await hubWiring.getHub();
        const original = hub.registry.onSyncEvent;
        const wc = evt.sender;
        hub.registry.onSyncEvent = (msg) => {
          if (progressChannel && wc && !wc.isDestroyed()) {
            try {
              wc.send(progressChannel, msg);
            } catch (_e) {}
          }
          if (typeof original === "function") {
            try {
              original(msg);
            } catch (_e) {}
          }
        };
        try {
          return await hub.registry.syncAdapter(name, options || {});
        } finally {
          hub.registry.onSyncEvent = original;
        }
      } catch (err) {
        return { error: err && err.message ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(
    `${NS}:sync-all-stream`,
    async (evt, { options, progressChannel }) => {
      try {
        const hub = await hubWiring.getHub();
        const original = hub.registry.onSyncEvent;
        const wc = evt.sender;
        hub.registry.onSyncEvent = (msg) => {
          if (progressChannel && wc && !wc.isDestroyed()) {
            try {
              wc.send(progressChannel, msg);
            } catch (_e) {}
          }
          if (typeof original === "function") {
            try {
              original(msg);
            } catch (_e) {}
          }
        };
        try {
          const registryReports = await hub.registry.syncAll(options || {});
          return await runDedicatedBatchCollectors(hub, registryReports);
        } finally {
          hub.registry.onSyncEvent = original;
        }
      } catch (err) {
        return { error: err && err.message ? err.message : String(err) };
      }
    },
  );

  // ─── V6 desktop UI bridge — open web-panel PDH in BrowserWindow ────
  //
  // V6 shell (default since hard-flip `caaddf530`) does not embed the
  // web-panel SPA, so the renderer cannot show PersonalDataHub.vue /
  // WechatWizard.vue / AIChatWizard.vue directly. This handler bridges
  // the gap by opening the existing web-panel page in a side window.
  // The discovery + open logic lives in openPdhWebWindow() below so
  // it's testable without electron mocking (vi.mock can't intercept
  // require('electron') in CJS — see memory vi_mock_cjs_interop_systemic).
  ipcMain.handle(
    `${NS}:open-web-window`,
    safe(async ({ route } = {}) => {
      return openPdhWebWindow({ route });
    }),
  );

  _registered = true;
  logger.info("[PersonalDataHub IPC] handlers registered");
}

function unregister() {
  if (!_registered) {
    return;
  }
  const channels = [
    "ask",
    "stats",
    "health",
    "list-adapters",
    "adapter-readiness",
    "sync-adapter",
    "sync-all",
    "register-mock",
    "unregister",
    "query-events",
    "recent-audit",
    "destroy",
    // Phase 5.6
    "test-email-auth",
    "register-email",
    "activate-email",
    "unregister-email",
    "list-email-accounts",
    "event-detail",
    // Phase 5.7
    "sync-adapter-stream",
    "sync-all-stream",
    // Phase 6 — Alipay bill import
    "register-alipay",
    "activate-alipay",
    "unregister-alipay",
    "list-alipay-accounts",
    "import-alipay-bill",
    // Phase 12.6.8 — WeChat account management
    "wechat-env-probe",
    "register-wechat",
    "activate-wechat",
    "unregister-wechat",
    "list-wechat-accounts",
    // Phase 10.3 — AIChat WebView wizard
    "aichat-open-login",
    "aichat-probe-cookies",
    "aichat-register-vendor",
    "aichat-rotate-login",
    "list-aichat-accounts",
    "unregister-aichat",
    "aichat-health-check-once",
    // V6 UI bridge
    "open-web-window",
  ];
  for (const c of channels) {
    try {
      ipcMain.removeHandler(`${NS}:${c}`);
    } catch (_e) {}
  }
  _registered = false;
}

/**
 * V6 PDH bridge — opens packages/web-panel/src/views/PersonalDataHub.vue
 * (incl WechatWizard / AIChatWizard) in a side BrowserWindow.
 *
 * @param {object} opts
 * @param {string} [opts.route='/personal-data-hub'] Must start with '/' or
 *   defaults; defends against open-redirect via crafted absolute URLs.
 * @param {object} [opts._deps] Injection seam for unit tests. Keys:
 *   - fs            (node:fs surface — existsSync, readFileSync)
 *   - homedir       () => string (defaults to os.homedir)
 *   - BrowserWindow class (defaults to require('electron').BrowserWindow)
 *   - openExternal  (url) => Promise (defaults to electron.shell.openExternal)
 *   - logWarn       (msg, ...) => void (defaults to logger.warn)
 *
 * @returns {Promise<{ok: true, url: string, fallback?: 'external'}
 *   | {error: 'web-shell-not-running'|'open-failed', message: string}>}
 */
async function openPdhWebWindow({ route, _deps } = {}) {
  const deps = _deps || {};
  const fsMod = deps.fs || require("node:fs");
  const pathMod = require("node:path");
  const homedir = deps.homedir || (() => require("node:os").homedir());
  const BrowserWindowCtor =
    deps.BrowserWindow || require("electron").BrowserWindow;
  const openExternal =
    deps.openExternal ||
    ((url) => require("../utils/safe-open.js").safeOpenExternal(url));
  const logWarn = deps.logWarn || ((msg, err) => logger.warn(msg, err));

  const cleanRoute =
    typeof route === "string" && route.startsWith("/")
      ? route
      : "/personal-data-hub";

  const portFilePath = pathMod.join(
    homedir(),
    ".chainlesschain",
    "desktop.port",
  );

  let httpUrl = null;
  try {
    if (fsMod.existsSync(portFilePath)) {
      const raw = fsMod.readFileSync(portFilePath, "utf-8");
      const info = JSON.parse(raw);
      // index.js writes `port: handle.port || null` (often null since the
      // web-shell binds OS-assigned and the handle exposes the bound port
      // only via httpUrl / wsUrl). Prefer the pre-formed httpUrl; fall
      // back to host+port for older port-file shapes.
      if (info && typeof info.httpUrl === "string" && info.httpUrl.length > 0) {
        // Strip trailing slash so `${httpUrl}${cleanRoute}` doesn't double //.
        httpUrl = info.httpUrl.replace(/\/+$/, "");
      } else if (info && info.host && info.port) {
        httpUrl = `http://${info.host}:${info.port}`;
      }
    }
  } catch (err) {
    logWarn(
      "[PersonalDataHub IPC] desktop.port unreadable:",
      err && err.message,
    );
  }

  if (!httpUrl) {
    return {
      error: "web-shell-not-running",
      message:
        "未发现运行中的 web-shell。请在终端运行 `cc ui` 启动 web-panel（含 WechatWizard / AIChatWizard 等），然后重试。",
    };
  }

  const targetUrl = `${httpUrl}${cleanRoute}`;

  try {
    const win = new BrowserWindowCtor({
      width: 1280,
      height: 860,
      title: "个人数据中台",
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    win.loadURL(targetUrl);
    return { ok: true, url: targetUrl };
  } catch (err) {
    try {
      await openExternal(targetUrl);
      return { ok: true, url: targetUrl, fallback: "external" };
    } catch (_e) {
      return {
        error: "open-failed",
        message: err && err.message ? err.message : String(err),
      };
    }
  }
}

module.exports = { register, unregister, openPdhWebWindow };
