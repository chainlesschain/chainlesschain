/**
 * §A10 — BOSS 直聘 (com.hpbr.bosszhipin) recruitment adapter, dual-mode
 * (snapshot + cookie-api). Phase 13+ §12.1 "沟通职位 + 简历" (ROI ⭐⭐⭐).
 *
 * BOSS 直聘's personal data is the user's job-search activity: positions they
 * chatted with recruiters about, and jobs they applied to. Both map to
 * INTERACTION events (the user reaching out to / engaging a company), with the
 * recruiter as a contact Person. Mirrors social-zhihu's two-mode shape but uses
 * a recruitment-specific normalize.
 *
 *   1. snapshot mode (opts.inputPath): JSON schemaVersion 1, stateless.
 *   2. cookie-api mode (opts.account.cookies): fetch the logged-in user's chat
 *      list + delivery (application) list from zhipin.com via the injected
 *      `fetchFn` (Android in-APK cc → OkHttp; desktop hub → Electron WebView net
 *      request), paginate, normalize. A sign seam (opts.signProvider) covers
 *      BOSS's `__zp_stoken__` / anti-bot token; best-effort unsigned when absent.
 *      Endpoints overridable via opts.chatsUrl / opts.deliveriesUrl (best-effort,
 *      not field-verified — FAMILY-23 playbook).
 *
 * Snapshot schema (schemaVersion 1):
 *   {
 *     "schemaVersion": 1, "snapshottedAt": <ms>,
 *     "account": { "userId": "...", "name": "..." },
 *     "events": [
 *       { "kind": "chat",        "id": "chat-<id>", "jobId": "...", "jobTitle": "...",
 *         "company": "...", "hrName": "...", "hrId": "...", "salary": "...",
 *         "city": "...", "lastChatTime": <s|ms> },
 *       { "kind": "application", "id": "apply-<id>", "jobId": "...", "jobTitle": "...",
 *         "company": "...", "status": "...", "deliverTime": <s|ms> }
 *     ]
 *   }
 */

"use strict";

const fs = require("node:fs");
const { newId } = require("../../ids");
const {
  ENTITY_TYPES,
  PERSON_SUBTYPES,
  EVENT_SUBTYPES,
  CAPTURED_BY,
} = require("../../constants");
const { CookieAuth } = require("../shopping-base");

const NAME = "recruit-boss";
const VERSION = "0.1.0";
const SNAPSHOT_SCHEMA_VERSION = 1;

const KIND_CHAT = "chat";
const KIND_APPLICATION = "application";
const VALID_SNAPSHOT_KINDS = Object.freeze([KIND_CHAT, KIND_APPLICATION]);

const CHATS_URL = "https://www.zhipin.com/wapi/zpchat/geek/contactList";
const DELIVERIES_URL = "https://www.zhipin.com/wapi/zpgeek/mobile/geek/deliver/list.json";
const PAGE_SIZE = 20;

function parseTime(v) {
  if (Number.isFinite(v)) return v > 1e12 ? v : v >= 1e9 ? v * 1000 : v;
  if (typeof v === "string") {
    if (/^\d+$/.test(v)) {
      const n = parseInt(v, 10);
      return n > 1e12 ? n : n >= 1e9 ? n * 1000 : n;
    }
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

function stableOriginalId(kind, id) {
  const safe =
    (typeof id === "string" && id.length > 0 && id) ||
    (typeof id === "number" && Number.isFinite(id) && String(id)) ||
    `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `boss:${kind}:${safe}`;
}

class BossZhipinAdapter {
  constructor(opts = {}) {
    this.account = opts.account || null;
    this._cookieAuth =
      opts.account && opts.account.cookies
        ? new CookieAuth({ platform: "boss", cookies: opts.account.cookies })
        : null;
    this._fetchFn = typeof opts.fetchFn === "function" ? opts.fetchFn : defaultFetch;
    this._signProvider =
      typeof opts.signProvider === "function" ? opts.signProvider : null;
    this._urls = {
      chats: opts.chatsUrl || CHATS_URL,
      deliveries: opts.deliveriesUrl || DELIVERIES_URL,
    };

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = [
      "sync:snapshot",
      "sync:cookie-api",
      "parse:boss-chat",
      "parse:boss-application",
    ];
    this.extractMode = "web-api";
    this.rateLimits = { perMinute: 8, perDay: 200 };
    this.dataDisclosure = {
      fields: [
        "boss:chat (jobTitle / company / hrName / salary / city)",
        "boss:application (jobTitle / company / status / deliverTime)",
      ],
      sensitivity: "medium",
      legalGate: false,
      defaultInclude: { chat: true, application: true },
    };

    this._deps = { fs };
  }

  async authenticate(ctx = {}) {
    if (ctx && typeof ctx.inputPath === "string" && ctx.inputPath.length > 0) {
      try {
        this._deps.fs.accessSync(ctx.inputPath, this._deps.fs.constants.R_OK);
      } catch (err) {
        return {
          ok: false,
          reason: "INPUT_PATH_UNREADABLE",
          message: `snapshot not readable at ${ctx.inputPath}: ${err.message}`,
        };
      }
      return { ok: true, mode: "snapshot-file" };
    }
    if (this._cookieAuth) {
      const ok = await this._cookieAuth.validate();
      if (!ok) return { ok: false, reason: "INVALID_COOKIE", error: "cookies missing" };
      return {
        ok: true,
        account: (this.account && this.account.userId) || null,
        mode: "cookie",
      };
    }
    return {
      ok: false,
      reason: "NO_INPUT",
      message:
        "recruit-boss.authenticate: needs opts.inputPath (snapshot mode) OR opts.account.cookies (cookie-api mode)",
    };
  }

  async healthCheck() {
    if (this._cookieAuth) {
      const r = await this.authenticate();
      return r.ok
        ? { ok: true, lastChecked: Date.now() }
        : { ok: false, reason: r.reason, error: r.error };
    }
    return { ok: true, lastChecked: Date.now() };
  }

  async *sync(opts = {}) {
    if (typeof opts.inputPath === "string" && opts.inputPath.length > 0) {
      yield* this._syncViaSnapshot(opts);
      return;
    }
    if (this._cookieAuth) {
      yield* this._syncViaCookie(opts);
      return;
    }
    throw new Error(
      "recruit-boss.sync: needs opts.inputPath (snapshot mode) OR opts.account.cookies (cookie-api mode; some BOSS endpoints need __zp_stoken__ via opts.signProvider)",
    );
  }

  async *_syncViaSnapshot(opts) {
    const raw = this._deps.fs.readFileSync(opts.inputPath, "utf-8");
    const snapshot = JSON.parse(raw);
    if (
      !snapshot ||
      typeof snapshot !== "object" ||
      snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION
    ) {
      throw new Error(
        `recruit-boss.sync: snapshot schemaVersion mismatch (got ${snapshot && snapshot.schemaVersion}, expected ${SNAPSHOT_SCHEMA_VERSION})`,
      );
    }
    const fallbackCapturedAt =
      Number.isFinite(snapshot.snapshottedAt) && snapshot.snapshottedAt > 0
        ? Math.floor(snapshot.snapshottedAt)
        : Date.now();
    const account =
      snapshot.account && typeof snapshot.account === "object" ? snapshot.account : null;
    const include = opts.include || {};
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;

    const events = Array.isArray(snapshot.events) ? snapshot.events : [];
    let emitted = 0;
    for (const ev of events) {
      if (emitted >= limit) return;
      if (!ev || typeof ev !== "object") continue;
      if (!VALID_SNAPSHOT_KINDS.includes(ev.kind)) continue;
      if (include[ev.kind] === false) continue;

      const capturedAt =
        parseTime(ev.capturedAt) ||
        parseTime(ev.lastChatTime) ||
        parseTime(ev.deliverTime) ||
        fallbackCapturedAt;
      const id =
        (typeof ev.id === "string" && ev.id.length > 0 && ev.id) ||
        ev.jobId ||
        ev.hrId ||
        null;

      yield {
        adapter: NAME,
        kind: ev.kind,
        originalId: stableOriginalId(ev.kind, id),
        capturedAt,
        payload: { ...ev, account },
      };
      emitted += 1;
    }
  }

  async *_syncViaCookie(opts = {}) {
    if (!(await this._cookieAuth.validate())) return;
    const cookies = this._cookieAuth.toHeader();
    const include = opts.include || {};
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    const maxPages =
      Number.isInteger(opts.maxPages) && opts.maxPages > 0 ? opts.maxPages : 10;

    const plan = [
      { kind: KIND_CHAT, url: this._urls.chats, map: chatItemToRecord },
      { kind: KIND_APPLICATION, url: this._urls.deliveries, map: applicationItemToRecord },
    ];

    let emitted = 0;
    for (const step of plan) {
      if (include[step.kind] === false) continue;
      let page = 1;
      while (page <= maxPages) {
        const query = { page, pageSize: PAGE_SIZE };
        let sign = null;
        if (this._signProvider) {
          sign = await this._signProvider({ url: step.url, query, cookies });
        }
        const resp = await this._fetchFn({ url: step.url, cookies, query, sign });
        const items = extractData(resp);
        if (!items.length) break;
        for (const it of items) {
          const rec = step.map(it);
          if (!rec) continue;
          if (emitted >= limit) return;
          yield {
            adapter: NAME,
            kind: step.kind,
            originalId: stableOriginalId(step.kind, rec.id),
            capturedAt: rec.occurredAt || Date.now(),
            payload: { record: rec, kind: step.kind, cookie: true },
          };
          emitted += 1;
        }
        if (items.length < PAGE_SIZE) break;
        page += 1;
      }
    }
  }

  normalize(raw) {
    if (!raw || !raw.payload) {
      throw new Error("BossZhipinAdapter.normalize: payload missing");
    }
    const ingestedAt = Date.now();
    const kind = raw.kind || raw.payload.kind;
    if (kind === KIND_CHAT) return normalizeChat(raw, ingestedAt);
    if (kind === KIND_APPLICATION) return normalizeApplication(raw, ingestedAt);
    throw new Error(`BossZhipinAdapter.normalize: unknown kind ${kind}`);
  }
}

// ─── cookie response → intermediate record ───────────────────────────────────

function extractData(resp) {
  if (!resp || typeof resp !== "object") return [];
  if (Array.isArray(resp.data)) return resp.data;
  if (Array.isArray(resp.list)) return resp.list;
  const z = resp.zpData || resp.data;
  if (z && typeof z === "object") {
    if (Array.isArray(z.list)) return z.list;
    if (Array.isArray(z.result)) return z.result;
    if (Array.isArray(z.records)) return z.records;
  }
  return [];
}

function chatItemToRecord(it) {
  if (!it || typeof it !== "object") return null;
  const id = it.jobId || it.encryptJobId || it.bossId || it.id;
  if (!id) return null;
  return {
    id: String(id),
    jobTitle: it.jobName || it.jobTitle || it.title || "",
    company: it.brandName || it.companyName || it.company || "",
    hrName: it.bossName || it.hrName || it.name || null,
    hrId: it.bossId || it.encryptBossId || it.hrId || null,
    salary: it.salaryDesc || it.salary || null,
    city: it.cityName || it.city || null,
    occurredAt: parseTime(it.lastChatTime || it.updateTime || it.noneReadCountUpdateTime),
  };
}

function applicationItemToRecord(it) {
  if (!it || typeof it !== "object") return null;
  const id = it.jobId || it.encryptJobId || it.deliverId || it.id;
  if (!id) return null;
  return {
    id: String(id),
    jobTitle: it.jobName || it.jobTitle || it.title || "",
    company: it.brandName || it.companyName || it.company || "",
    status: it.statusDesc || it.deliverStatus || it.status || null,
    occurredAt: parseTime(it.deliverTime || it.addTime || it.createTime),
  };
}

// ─── per-kind normalizers (snapshot fields OR cookie payload.record) ──────────

function buildSource(raw, occurredAt) {
  return {
    adapter: NAME,
    adapterVersion: VERSION,
    originalId: raw.originalId,
    capturedAt: raw.capturedAt || occurredAt,
    capturedBy: CAPTURED_BY.API,
  };
}

function normalizeChat(raw, ingestedAt) {
  const p = raw.payload;
  const r = p.cookie ? p.record : p;
  const jobTitle = r.jobTitle || "";
  const company = r.company || "";
  const occurredAt = parseTime(r.occurredAt || r.lastChatTime || raw.capturedAt) || ingestedAt;
  const source = buildSource(raw, occurredAt);
  const persons = [];
  let hrPersonId = null;
  const hrName = r.hrName || null;
  if (hrName) {
    hrPersonId = `person-boss-hr-${r.hrId || hrName}`;
    persons.push({
      id: hrPersonId,
      type: ENTITY_TYPES.PERSON,
      subtype: PERSON_SUBTYPES.CONTACT,
      names: [hrName],
      ingestedAt,
      source,
      identifiers: r.hrId ? { "boss-hr-id": [String(r.hrId)] } : {},
      extra: { platform: "boss", role: "recruiter", company: company || null },
    });
  }
  return {
    events: [
      {
        id: newId(),
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.INTERACTION,
        occurredAt,
        actor: "person-self",
        participants: ["person-self", ...(hrPersonId ? [hrPersonId] : [])],
        content: {
          title: `沟通职位: ${jobTitle}${company ? " @ " + company : ""}`,
          text: [jobTitle, company, r.salary, r.city].filter(Boolean).join(" "),
        },
        ingestedAt,
        source,
        extra: {
          platform: "boss",
          jobId: r.id,
          jobTitle: jobTitle || null,
          company: company || null,
          salary: r.salary || null,
          city: r.city || null,
          ...(hrPersonId ? { hrPersonId } : {}),
        },
      },
    ],
    persons,
    places: [],
    items: [],
    topics: [],
  };
}

function normalizeApplication(raw, ingestedAt) {
  const p = raw.payload;
  const r = p.cookie ? p.record : p;
  const jobTitle = r.jobTitle || "";
  const company = r.company || "";
  const occurredAt = parseTime(r.occurredAt || r.deliverTime || raw.capturedAt) || ingestedAt;
  const source = buildSource(raw, occurredAt);
  return {
    events: [
      {
        id: newId(),
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.INTERACTION,
        occurredAt,
        actor: "person-self",
        content: {
          title: `投递简历: ${jobTitle}${company ? " @ " + company : ""}`,
          text: [jobTitle, company].filter(Boolean).join(" "),
        },
        ingestedAt,
        source,
        extra: {
          platform: "boss",
          kind: "application",
          jobId: r.id,
          jobTitle: jobTitle || null,
          company: company || null,
          status: r.status || null,
        },
      },
    ],
    persons: [],
    places: [],
    items: [],
    topics: [],
  };
}

async function defaultFetch(_opts) {
  throw new Error("recruit-boss: no fetchFn configured for cookie-api mode");
}

module.exports = {
  BossZhipinAdapter,
  extractData,
  chatItemToRecord,
  applicationItemToRecord,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
};
