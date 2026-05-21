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
  getAIChatWizard,
} = require("../personal-data-hub/aichat-wizard-factory.js");

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
      return await hub.registry.syncAll(options || {});
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
          return await hub.registry.syncAll(options || {});
        } finally {
          hub.registry.onSyncEvent = original;
        }
      } catch (err) {
        return { error: err && err.message ? err.message : String(err) };
      }
    },
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
    "unregister-email",
    "list-email-accounts",
    "event-detail",
    // Phase 5.7
    "sync-adapter-stream",
    "sync-all-stream",
    // Phase 6 — Alipay bill import
    "register-alipay",
    "unregister-alipay",
    "list-alipay-accounts",
    "import-alipay-bill",
    // Phase 10.3 — AIChat WebView wizard
    "aichat-open-login",
    "aichat-probe-cookies",
    "aichat-register-vendor",
    "aichat-rotate-login",
    "list-aichat-accounts",
    "unregister-aichat",
    "aichat-health-check-once",
  ];
  for (const c of channels) {
    try {
      ipcMain.removeHandler(`${NS}:${c}`);
    } catch (_e) {}
  }
  _registered = false;
}

module.exports = { register, unregister };
