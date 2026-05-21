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
import { existsSync, unlinkSync, readdirSync } from "node:fs";
import { join } from "node:path";

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
    withHub(
      async (hub) =>
        await hub.registry.syncAdapter(msg.name, msg.options || {}),
    ),

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
    try {
      const report = await hub.registry.syncAdapter(
        msg.name,
        msg.options || {},
      );
      return { result: report };
    } finally {
      hub.registry.onSyncEvent = original;
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
