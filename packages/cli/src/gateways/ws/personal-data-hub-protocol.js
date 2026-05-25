/**
 * Personal Data Hub — WS protocol handlers.
 *
 * Mirrors the 10 IPC channels in
 * desktop-app-vue/src/main/ipc/personal-data-hub-ipc.js so cc ui / web-shell
 * users get the same surface. Per memory feedback_cross_shell_feature_pattern,
 * any hub-facing renderer code can target EITHER:
 *
 *   electron: window.electron.invoke("personal-data-hub:ask", {...})
 *   cc ui:    ws.executeJson({ type: "personal-data-hub.ask", ... })
 *
 * Topic names use dot-case here (cc WS convention) vs the colon-style IPC.
 * The renderer shell-helpers layer reconciles the two so SPA code can be
 * shell-agnostic.
 *
 * Each handler returns { result } or { error }. The dispatcher wraps that
 * with the standard envelope (id + type) before sending.
 */

import {
  getHub,
  close as closeHub,
} from "../../lib/personal-data-hub-wiring.js";
import { getAIChatWizard } from "../../lib/personal-data-hub-aichat-wizard.js";
import {
  existsSync,
  unlinkSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import pdhPkg from "@chainlesschain/personal-data-hub";

const { ingestSystemDataAndroidSnapshot } = pdhPkg;

/**
 * If the caller didn't pass `inputPath`, try to pull a snapshot for
 * this adapter off the attached Android phone via `adb shell run-as
 * <pkg.debug> cat files/.chainlesschain/staging/<name>.json`. On
 * success, write the JSON to `hub.hubDir/staging/` and return an
 * `options` object with `inputPath` set so the adapter's _syncViaSnapshot
 * picks it up.
 *
 * Why this is needed: every social adapter (bilibili, weibo, douyin,
 * xiaohongshu, toutiao, kuaishou, qq, wechat, baidu-map, tencent-map,
 * jd, meituan, pinduoduo) is snapshot-only and the Android in-app
 * collectors write their JSON into the app's filesDir/.chainlesschain/
 * staging/. Without an auto-pull, the desktop 同步 button can never
 * reach a working state for these adapters — it just throws "needs
 * opts.inputPath".
 *
 * Best-effort: if anything fails (no device, package not debuggable,
 * snapshot file missing for that adapter, bridge module unavailable),
 * return the original options unchanged so the adapter's normal error
 * path fires and the UI banner shows a meaningful message.
 */
async function _tryAdbAutoPullInputPath(hub, name, options) {
  if (
    options &&
    typeof options.inputPath === "string" &&
    options.inputPath.length > 0
  ) {
    return options; // caller already supplied a path
  }
  // Skip auto-pull for adapters that have a live bridge mode — pulling
  // a stale snapshot file would short-circuit the bridge path which
  // yields fresher / richer data (e.g. system-data-android's bridge
  // mode pulls contacts + apps + sms + call_log live via ADB, while
  // an Android-collected snapshot only contains contacts + apps).
  // Keep this list in sync with adapters whose _syncViaBridge is
  // strictly richer than their snapshot output.
  // browser-history-* and vscode read desktop-local files (browser History
  // SQLite + Bookmarks JSON, or VS Code workspaceStorage + state.vscdb);
  // ADB snapshot is meaningless for them.
  const BRIDGE_PREFERRED = new Set([
    "system-data-android",
    "browser-history-chrome",
    "browser-history-edge",
    "vscode",
    "win-recent",
    "git-activity",
    "shell-history",
    "local-files",
  ]);
  if (BRIDGE_PREFERRED.has(name)) {
    return options || {};
  }
  try {
    const { createHostAdbBridge } =
      await import("../../lib/host-adb-bridge.js");
    const bridge = createHostAdbBridge();
    const content = await bridge.invoke("snapshot.read", {
      fileName: `${name}.json`,
    });
    // Sanity: must be parseable JSON. If not, the adapter would fail
    // with a confusing parse error — surface a clearer one here.
    try {
      JSON.parse(content);
    } catch (_e) {
      return options; // leave to adapter — it'll report parse error
    }
    const stagingDir = join(hub.hubDir, "staging");
    mkdirSync(stagingDir, { recursive: true });
    const stagingPath = join(
      stagingDir,
      `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`,
    );
    writeFileSync(stagingPath, content, "utf-8");
    return {
      ...(options || {}),
      inputPath: stagingPath,
      _autoPulledViaAdb: true,
    };
  } catch (_e) {
    // Bridge unavailable / device not attached / file missing — let the
    // adapter throw its normal error so the banner explains.
    return options || {};
  }
}

async function withHub(fn) {
  try {
    const hub = await getHub();
    const result = await fn(hub);
    return { result };
  } catch (err) {
    return { error: err && err.message ? err.message : String(err) };
  }
}

export const PERSONAL_DATA_HUB_HANDLERS = {
  "personal-data-hub.ask": async (msg) =>
    withHub(async (hub) => {
      if (!hub.engine) throw new Error("Analysis engine unavailable");
      return await hub.engine.ask(msg.question, msg.options || {});
    }),

  // Path Y: prompt context only, no LLM call. Lets web-shell / mobile host
  // its own inference (Volcengine Doubao, OpenRouter, etc.) while keeping
  // vault retrieval centralized.
  "personal-data-hub.retrieve-context": async (msg) =>
    withHub(async (hub) => {
      if (!hub.engine) throw new Error("Analysis engine unavailable");
      return await hub.engine.retrieveContext(msg.question, msg.options || {});
    }),

  // Path C: phone-collected ContentResolver + PackageManager snapshot →
  // staging file → syncAdapter(system-data-android). Returns SyncReport.
  "personal-data-hub.ingest-system-data-android": async (msg) =>
    withHub(
      async (hub) => await ingestSystemDataAndroidSnapshot(hub, msg.snapshot),
    ),

  "personal-data-hub.stats": async () =>
    withHub((hub) => ({
      vault: hub.vault.stats(),
      adapters: hub.registry.list(),
      hubDir: hub.hubDir,
      llm: hub.llm ? { name: hub.llm.name, isLocal: hub.llm.isLocal } : null,
    })),

  "personal-data-hub.health": async () =>
    withHub((hub) => ({
      vault: { ok: !!hub.vault.db, schemaVersion: hub.vault.schemaVersion() },
      llm: hub.llm
        ? { ok: true, isLocal: hub.llm.isLocal, name: hub.llm.name }
        : { ok: false, reason: "LLM unavailable" },
      kgSink: { ok: !!hub.kgSink },
      ragSink: { ok: !!hub.ragSink },
    })),

  "personal-data-hub.list-adapters": async () =>
    withHub((hub) => hub.registry.list()),

  "personal-data-hub.sync-adapter": async (msg) =>
    withHub(async (hub) => {
      const options = await _tryAdbAutoPullInputPath(
        hub,
        msg.name,
        msg.options,
      );
      try {
        return await hub.registry.syncAdapter(msg.name, options);
      } finally {
        // Best-effort cleanup of staging file we just wrote (don't shadow
        // a real adapter error with cleanup noise).
        if (options && options._autoPulledViaAdb && options.inputPath) {
          try {
            if (existsSync(options.inputPath)) unlinkSync(options.inputPath);
          } catch (_e) {
            /* ignore */
          }
        }
      }
    }),

  "personal-data-hub.sync-all": async (msg) =>
    withHub(async (hub) => await hub.registry.syncAll(msg.options || {})),

  "personal-data-hub.register-mock": async (msg) =>
    withHub((hub) => {
      const a = hub.registerMockAdapter({
        name: msg.name || "mock",
        count: typeof msg.count === "number" ? msg.count : 20,
        seed: typeof msg.seed === "number" ? msg.seed : 1,
      });
      return { name: a.name, version: a.version };
    }),

  "personal-data-hub.unregister": async (msg) =>
    withHub((hub) => ({ ok: hub.registry.unregister(msg.name) })),

  "personal-data-hub.query-events": async (msg) =>
    withHub((hub) =>
      hub.vault.queryEvents({
        subtype: msg.subtype,
        since: msg.since,
        until: msg.until,
        actor: msg.actor,
        adapter: msg.adapter,
        limit: msg.limit,
      }),
    ),

  // Phase 16 Vault Browser — full-text + faceted search over events.
  // See packages/personal-data-hub/lib/vault.js#searchEvents for the
  // query/result shape. The desktop browser view + Android "我的数据" tab
  // both consume this topic.
  "personal-data-hub.search-events": async (msg) =>
    withHub((hub) =>
      hub.vault.searchEvents({
        q: msg.q,
        adapter: msg.adapter,
        category: msg.category,
        subtype: msg.subtype,
        since: msg.since,
        until: msg.until,
        cursor: msg.cursor,
        limit: msg.limit,
      }),
    ),

  // Phase 16 Vault Browser — counts grouped by category/adapter/subtype,
  // honoring the same q + since/until filters as search-events. Powers
  // the sidebar badges + adapter chip counts in the browser UI.
  "personal-data-hub.facet-counts": async (msg) =>
    withHub((hub) =>
      hub.vault.facetCounts({
        q: msg.q,
        since: msg.since,
        until: msg.until,
      }),
    ),

  "personal-data-hub.recent-audit": async (msg) =>
    withHub((hub) =>
      hub.vault.queryAudit({
        since: msg.since,
        action: msg.action,
        limit: msg.limit,
      }),
    ),

  // ─── Destructive: wipe vault. Requires confirm:true. ────────────────
  "personal-data-hub.destroy": async (msg) => {
    if (!msg || msg.confirm !== true) {
      return {
        error:
          "Destructive: pass { confirm: true } to wipe vault. UI should require explicit user confirmation first.",
      };
    }
    const alsoWipeAccounts = !!msg.alsoWipeAccounts;
    const alsoWipeMasterKey = !!msg.alsoWipeMasterKey;
    const removed = [];
    try {
      const hub = await getHub();
      const hubDir = hub.hubDir;
      try {
        hub.vault.destroy();
        removed.push(
          join(hubDir, "vault.db"),
          join(hubDir, "vault.db-wal"),
          join(hubDir, "vault.db-shm"),
        );
      } catch (_e) {
        // best-effort
      }
      if (alsoWipeAccounts) {
        for (const f of ["email-accounts.json", "alipay-accounts.json"]) {
          const p = join(hubDir, f);
          try {
            if (existsSync(p)) {
              unlinkSync(p);
              removed.push(p);
            }
          } catch (_e) {}
        }
      }
      if (alsoWipeMasterKey) {
        const keyDir = join(hubDir, "keys");
        try {
          if (existsSync(keyDir)) {
            for (const f of readdirSync(keyDir)) {
              try {
                unlinkSync(join(keyDir, f));
                removed.push(join(keyDir, f));
              } catch (_e) {}
            }
          }
        } catch (_e) {}
      }
      try {
        closeHub();
      } catch (_e) {}
      return { result: { ok: true, removed } };
    } catch (err) {
      return { error: err && err.message ? err.message : String(err) };
    }
  },

  // ─── Phase 5.6 — email config + event detail ─────────────────────────

  "personal-data-hub.test-email-auth": async (msg) =>
    withHub(async (hub) => await hub.testEmailAuth({ account: msg.account })),

  "personal-data-hub.register-email": async (msg) =>
    withHub(
      async (hub) =>
        await hub.registerEmailAdapter({
          account: msg.account,
          opts: msg.opts || {},
        }),
    ),

  "personal-data-hub.unregister-email": async (msg) =>
    withHub(async (hub) => await hub.unregisterEmailAdapter(msg.email)),

  "personal-data-hub.list-email-accounts": async () =>
    withHub((hub) => hub.listEmailAccounts()),

  "personal-data-hub.event-detail": async (msg) =>
    withHub((hub) => hub.eventDetail(msg.eventId)),

  // ─── Phase 6 — Alipay bill import ─────────────────────────────────────

  "personal-data-hub.register-alipay": async (msg) =>
    withHub(
      async (hub) =>
        await hub.registerAlipayAdapter({
          account: msg.account,
          opts: msg.opts || {},
        }),
    ),

  "personal-data-hub.unregister-alipay": async (msg) =>
    withHub(async (hub) => await hub.unregisterAlipayAdapter(msg.email)),

  "personal-data-hub.list-alipay-accounts": async () =>
    withHub((hub) => hub.listAlipayAccounts()),

  "personal-data-hub.import-alipay-bill": async (msg) =>
    withHub(
      async (hub) =>
        await hub.importAlipayBill({
          zipPath: msg.zipPath,
          csvPath: msg.csvPath,
          zipPassword: msg.zipPassword,
        }),
    ),

  // ─── Phase 12.6.8 — WeChat env-probe + register / unregister / list ──

  "personal-data-hub.wechat-env-probe": async () =>
    withHub(async (hub) => await hub.probeWechatEnv()),

  "personal-data-hub.register-wechat": async (msg) =>
    withHub(
      async (hub) =>
        await hub.registerWechatAdapter({
          account: msg.account,
          dbPath: msg.dbPath,
          wechatDataPath: msg.wechatDataPath,
          fridaOpts: msg.fridaOpts,
          keyProviderOverride: msg.keyProviderOverride,
        }),
    ),

  "personal-data-hub.unregister-wechat": async (msg) =>
    withHub(async (hub) => await hub.unregisterWechatAdapter(msg.uin)),

  "personal-data-hub.list-wechat-accounts": async () =>
    withHub((hub) => hub.listWechatAccounts()),

  // ─── Phase 1c — Bilibili C 路径 one-shot sync ─────────────────────────
  //
  // Pulls cookies from the user's Android Bilibili App via ADB, fetches 4
  // endpoints, ingests as a snapshot. Returns the standard
  // `{ok, report?, reason?, message?}` shape — see hub.bilibiliAdbSync for
  // the full reason taxonomy. UI maps reasons to banner strings.
  "personal-data-hub.bilibili-adb-sync": async (msg) =>
    withHub((hub) =>
      hub.bilibiliAdbSync({
        limits: msg && msg.limits,
        stagingDir: msg && msg.stagingDir,
        displayName: msg && msg.displayName,
      }),
    ),

  // Phase 1e — dry-run env probe (cookies path only, no API calls / vault writes)
  "personal-data-hub.bilibili-adb-doctor": async () =>
    withHub((hub) => hub.bilibiliAdbDoctor()),

  // Phase 2a — Douyin C 路径 one-shot sync (db extraction)
  "personal-data-hub.douyin-adb-sync": async (msg) =>
    withHub((hub) =>
      hub.douyinAdbSync({
        uid: msg && msg.uid,
        limits: msg && msg.limits,
        stagingDir: msg && msg.stagingDir,
        displayName: msg && msg.displayName,
      }),
    ),

  // Phase 3a — Weibo C 路径 one-shot sync (m.weibo.cn cookies + 4 endpoints)
  "personal-data-hub.weibo-adb-sync": async (msg) =>
    withHub((hub) =>
      hub.weiboAdbSync({
        limits: msg && msg.limits,
        stagingDir: msg && msg.stagingDir,
        displayName: msg && msg.displayName,
      }),
    ),

  // Phase 3c — Xhs C 路径 one-shot sync (xiaohongshu.com cookies + 4 endpoints X-S signed)
  "personal-data-hub.xhs-adb-sync": async (msg) =>
    withHub((hub) =>
      hub.xhsAdbSync({
        limits: msg && msg.limits,
        stagingDir: msg && msg.stagingDir,
        displayName: msg && msg.displayName,
      }),
    ),

  // Phase 6c — Toutiao C 路径 one-shot sync (www.toutiao.com cookies +
  // passport profile + 3 _signature endpoints). CLI/web context with no
  // desktop bridge: 3 signed endpoints short-circuit (no HTTP). Desktop
  // wiring uses ToutiaoSignBridge → ~100% hit.
  "personal-data-hub.toutiao-adb-sync": async (msg) =>
    withHub((hub) =>
      hub.toutiaoAdbSync({
        limits: msg && msg.limits,
        stagingDir: msg && msg.stagingDir,
        displayName: msg && msg.displayName,
      }),
    ),

  // Phase 6d — Kuaishou C 路径 one-shot sync (www.kuaishou.com cookies +
  // profile from api_ph payload + 3 GraphQL endpoints with __NS_sig3 +
  // kpf/kpn). CLI/web context: signed endpoints short-circuit (no HTTP).
  // Desktop wiring uses KuaishouSignBridge → ~100% hit.
  "personal-data-hub.kuaishou-adb-sync": async (msg) =>
    withHub((hub) =>
      hub.kuaishouAdbSync({
        limits: msg && msg.limits,
        stagingDir: msg && msg.stagingDir,
        displayName: msg && msg.displayName,
      }),
    ),

  // Phase 6e — Bridge dry-run doctor. Spins up Xhs / Toutiao / Kuaishou
  // sign bridges with empty cookie, probes for candidate signing globals,
  // times each phase. No phone needed. Detects SDK rotation BEFORE the
  // user starts a real sync. Desktop-only — CLI/web-shell-no-desktop
  // returns MODULE_LOAD_FAILED.
  "personal-data-hub.bridge-doctor": async () =>
    withHub((hub) => hub.bridgeDoctor()),

  // ─── Phase 8 — EntityResolver review / merge / unmerge ───────────────

  "personal-data-hub.review-queue-list": async (msg) =>
    withHub((hub) => hub.vault.listReviewQueue({ limit: msg.limit || 50 })),

  "personal-data-hub.review-decision": async (msg) =>
    withHub((hub) => {
      if (!hub.entityResolver) throw new Error("EntityResolver not wired");
      return hub.entityResolver.applyUserDecision({
        reviewId: msg.reviewId,
        decision: msg.decision,
      });
    }),

  "personal-data-hub.manual-merge": async (msg) =>
    withHub((hub) => {
      if (!hub.entityResolver) throw new Error("EntityResolver not wired");
      return hub.entityResolver.manualMerge({ aId: msg.aId, bId: msg.bId });
    }),

  "personal-data-hub.manual-unmerge": async (msg) =>
    withHub((hub) => {
      if (!hub.entityResolver) throw new Error("EntityResolver not wired");
      return hub.entityResolver.manualUnmerge(msg.personId);
    }),

  "personal-data-hub.resolver-drain": async (msg) =>
    withHub(async (hub) => {
      if (!hub.entityResolver) throw new Error("EntityResolver not wired");
      return await hub.entityResolver.drain({ limit: msg.limit || 50 });
    }),

  "personal-data-hub.resolver-stats": async () =>
    withHub((hub) => ({
      queue: hub.vault.resolveQueueStats(),
      mergeGroups: hub.vault.stats().mergeGroups,
      reviewQueue:
        hub.vault.listReviewQueue({ limit: 1 }).length > 0
          ? hub.vault.listReviewQueue({ limit: 1000 }).length
          : 0,
    })),

  "personal-data-hub.merge-group-members": async (msg) =>
    withHub((hub) => hub.vault.getMergeGroupMembers(msg.personId)),

  // ─── Phase 11 — internal analysis skills ─────────────────────────────

  "personal-data-hub.skills-list": async () =>
    withHub((hub) => hub.analysisSkillNames || []),

  "personal-data-hub.run-skill": async (msg) =>
    withHub(async (hub) => await hub.runSkill(msg.name, msg.options || {})),

  // ─── Phase 10.3 — AIChat WebView 鉴权向导 (paste-mode on cc ui) ────────

  "personal-data-hub.aichat-open-login": async (msg) =>
    withHub(async (hub) => {
      const wiz = getAIChatWizard({ hubDir: hub.hubDir });
      return await wiz.openVendorLogin({
        vendor: msg.vendor,
        opts: msg.opts || {},
      });
    }),

  "personal-data-hub.aichat-probe-cookies": async (msg) =>
    withHub(async (hub) => {
      const wiz = getAIChatWizard({ hubDir: hub.hubDir });
      return await wiz.probeCookies({
        vendor: msg.vendor,
        cookieHeader: msg.cookieHeader,
      });
    }),

  "personal-data-hub.aichat-register-vendor": async (msg) =>
    withHub(async (hub) => {
      const wiz = getAIChatWizard({ hubDir: hub.hubDir });
      return await wiz.registerVendor({
        vendor: msg.vendor,
        cookies: msg.cookies,
        opts: msg.opts || {},
      });
    }),

  "personal-data-hub.aichat-rotate-login": async (msg) =>
    withHub(async (hub) => {
      const wiz = getAIChatWizard({ hubDir: hub.hubDir });
      return await wiz.rotateLoginPartition({ vendor: msg.vendor });
    }),

  "personal-data-hub.list-aichat-accounts": async () =>
    withHub(async (hub) => await hub.listAIChatAccounts()),

  "personal-data-hub.unregister-aichat": async (msg) =>
    withHub(async (hub) => await hub.unregisterAIChatVendor(msg.vendor)),

  "personal-data-hub.aichat-health-check-once": async () =>
    withHub(async (hub) => await hub.runAIChatHealthCheckOnce()),
};

/**
 * Phase 5.7 — streaming handlers. Same call pattern as session-core
 * streaming: handler receives `sender(payload)` to push intermediate
 * `{ type: "personal-data-hub.<topic>.event", ... }` messages while
 * sync is in flight, then the dispatcher wraps the final return with
 * `.end`. Adapter progress phases (connecting / fetching / done / error)
 * surface here; UI subscribes via the composable.
 */
export const PERSONAL_DATA_HUB_STREAMING_HANDLERS = {
  "personal-data-hub.sync-adapter-stream": async (msg, sender) => {
    const hub = await getHub();
    const original = hub.registry.onSyncEvent;
    hub.registry.onSyncEvent = (evt) => {
      try {
        sender({
          type: "personal-data-hub.sync-adapter-stream.event",
          event: evt,
        });
      } catch (_e) {}
      if (typeof original === "function") {
        try {
          original(evt);
        } catch (_e) {}
      }
    };
    const options = await _tryAdbAutoPullInputPath(hub, msg.name, msg.options);
    try {
      const report = await hub.registry.syncAdapter(msg.name, options);
      return { result: report };
    } finally {
      hub.registry.onSyncEvent = original;
      if (options && options._autoPulledViaAdb && options.inputPath) {
        try {
          if (existsSync(options.inputPath)) unlinkSync(options.inputPath);
        } catch (_e) {
          /* ignore */
        }
      }
    }
  },

  "personal-data-hub.sync-all-stream": async (msg, sender) => {
    const hub = await getHub();
    const original = hub.registry.onSyncEvent;
    hub.registry.onSyncEvent = (evt) => {
      try {
        sender({ type: "personal-data-hub.sync-all-stream.event", event: evt });
      } catch (_e) {}
      if (typeof original === "function") {
        try {
          original(evt);
        } catch (_e) {}
      }
    };
    try {
      const reports = await hub.registry.syncAll(msg.options || {});
      return { result: reports };
    } finally {
      hub.registry.onSyncEvent = original;
    }
  },
};

/**
 * Topic names this protocol owns — exported so the dispatcher can list /
 * advertise them to clients via a capabilities probe.
 */
export const PERSONAL_DATA_HUB_TOPICS = Object.freeze([
  ...Object.keys(PERSONAL_DATA_HUB_HANDLERS),
  ...Object.keys(PERSONAL_DATA_HUB_STREAMING_HANDLERS),
]);
