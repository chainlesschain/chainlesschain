"use strict";

// SystemDataAndroidAdapter — Plan A v0.1 (4-day slice, 2026-05-21).
//
// Reads a UI-produced JSON snapshot of the Android user's own ContentResolver
// (contacts) and PackageManager (installed apps) and normalises it into PDH
// entities. The snapshot is produced inside the Android app process (which
// owns the JVM and can call ContentResolver / PackageManager directly); the
// cc CLI subprocess then ingests that snapshot through this adapter.
//
// Why not extend PythonSidecarAdapter like the desktop `system-data`? Termux
// does not ship a forensics-bridge sidecar and the data we read here is the
// user's OWN device — no SQLite parsing or ADB pull is needed; ContentResolver
// returns clean records. Keep it pure JS, zero sidecar.
//
// Out of scope for v0.1 (deferred):
//   - SMS / call_log (need READ_SMS / READ_CALL_LOG and stricter legal gates)
//   - Wifi (no ContentResolver, would need SystemConfiguration JNI)
//   - cc-driven pull (would need a BoundService + Unix socket; v0.1 is UI-pushed)

const { newId } = require("../../ids");
const {
  ENTITY_TYPES,
  PERSON_SUBTYPES,
  ITEM_SUBTYPES,
  EVENT_SUBTYPES,
  CAPTURED_BY,
} = require("../../constants");

const NAME = "system-data-android";
// v0.3.1 (2026-05-25): normalize() now emits a synthetic OTHER event per
//   contact + per app. Snapshot mode previously only wrote persons/items;
//   Vault Browser's `category=system` facet only counts events, so the
//   chip showed (0) forever even after a successful sync. Synthetic event
//   per entity (stable id, idempotent across re-syncs via UPSERT) lights
//   up the chip with `total = #contacts + #apps`. occurredAt = capturedAt
//   of the latest snapshot containing the entity. sms/call/media events
//   were already emitted in v0.2 — unchanged.
// v0.3.0 (2026-05-24): added kind="media-file" via bridge mode
//   (host-adb-bridge media.list across 5 /sdcard categories). Metadata
//   only — path/size/mtime/ext, no file content.
// v0.2.0 (2026-05-24): added kind="sms" + kind="call" via bridge mode.
//   Snapshot mode still v1 schema — sms/calls/media only land via
//   bridge path until Android snapshot writer is updated to include them.
const VERSION = "0.3.1";
const SNAPSHOT_SCHEMA_VERSION = 1;

// Stable per-source originalId — registry.putRawEvent rejects null originalId
// with a NOT NULL constraint, surfacing as invalidCount += rawCount on the
// SyncReport (real-device repro 2026-05-21: 1305 of 1305 raws "invalid"
// despite all entities being written). Re-deriving the same key on each
// sync also lets the raw_events store dedup naturally.
function contactOriginalId(c) {
  const k =
    (c && typeof c.lookupKey === "string" && c.lookupKey.length > 0 && c.lookupKey) ||
    (c && typeof c.displayName === "string" && c.displayName) ||
    `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `android-contact:${k}`;
}
function appOriginalId(a) {
  const k =
    (a && typeof a.packageName === "string" && a.packageName) ||
    `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `android-app:${k}`;
}
function smsOriginalId(s) {
  // Stable across re-syncs: use SMS _id from the system content provider.
  const k = (s && s.id != null && String(s.id)) ||
    `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `android-sms:${k}`;
}
function callOriginalId(c) {
  // Stable across re-syncs: use call_log _id from the system content provider.
  const k = (c && c.id != null && String(c.id)) ||
    `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `android-call:${k}`;
}
function mediaOriginalId(m) {
  // Full filesystem path is stable as long as the file isn't moved/renamed.
  // Path is unique within the device.
  const k = (m && typeof m.path === "string" && m.path) ||
    `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `android-media:${k}`;
}

class SystemDataAndroidAdapter {
  constructor(opts = {}) {
    this.name = NAME;
    this.version = VERSION;
    this.capabilities = [
      "sync:android-content-provider",
      "sync:android-package-manager",
      "sync:android-sms",
      "sync:android-call-log",
      "sync:android-media-files",
    ];
    this.extractMode = "device-pull";
    this.rateLimits = { perDay: 24 };
    this.dataDisclosure = {
      fields: [
        "contacts:displayName,phones,emails,starred,organization,photoUri",
        "installed_apps:packageName,label,versionName,versionCode,firstInstallTime,lastUpdateTime,isSystem",
        "sms:id,address,body,date,dateSent,type,threadId,read,subject",
        "callLog:id,number,name,duration,date,type,geocoded",
        // Media is metadata-only — file content never leaves the device.
        "media:path,size,mtimeMs,ext,category(photos|pictures|videos|downloads|documents)",
      ],
      sensitivity: "high",
      legalGate: false,
      defaultInclude: {
        contacts: true,
        apps: true,
        sms: true,
        calls: true,
        media: { photos: true, pictures: true, videos: true, downloads: true, documents: true },
      },
    };

    // _deps for test injection — mirrors the pattern in cli-dev.md so test
    // harness can swap fs without resorting to vi.mock("fs") which doesn't
    // intercept require() under inlined CJS. `bridgeProvider` is lazy because
    // the cc-android-bridge module sits in `packages/cli` and is not always
    // available in environments that load this adapter directly (e.g. desktop
    // CLI building a snapshot ingest pipeline). Resolves to null when bridge
    // is unreachable, in which case sync() falls back to inputPath mode.
    this._deps = {
      fs: require("node:fs"),
      bridgeProvider: () => null,
    };
  }

  // ─── PersonalDataAdapter contract ──────────────────────────────────────

  async authenticate(ctx = {}) {
    if (!ctx || typeof ctx.inputPath !== "string" || ctx.inputPath.length === 0) {
      return {
        ok: false,
        reason: "INPUT_PATH_REQUIRED",
        message:
          "system-data-android requires opts.inputPath pointing to a snapshot JSON written by the Android app",
      };
    }
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

  async healthCheck() {
    // The adapter itself is stateless — health is "always reachable" so long
    // as a snapshot can be re-produced by the UI. Real device-status (whether
    // the runtime permission was granted) lives in the Android-side UI.
    return { ok: true, lastChecked: Date.now() };
  }

  async *sync(opts = {}) {
    // Two ingestion modes (mutually exclusive — pick whichever fits the host):
    //   1. snapshot mode: opts.inputPath points to JSON the Android UI wrote
    //      (works on any host that can read the file — desktop or device).
    //   2. bridge mode: opts.useBridge === true, _deps.bridgeProvider() returns
    //      a live cc-android-bridge. Used inside in-APK cc when A6/A7 lands.
    // If neither inputPath nor useBridge is set, bridge auto-engages when
    // available (which only happens on Android with the JNI binding loaded,
    // OR under CC_ANDROID_BRIDGE_OVERRIDE=1 in tests).
    const wantBridge = opts.useBridge === true || (!opts.inputPath && this._bridgeAvailable());
    if (wantBridge) {
      yield* this._syncViaBridge(opts);
      return;
    }
    if (!opts || typeof opts.inputPath !== "string") {
      throw new Error(
        "system-data-android.sync: needs opts.inputPath (snapshot mode) OR opts.useBridge=true (in-APK Android cc with cc-android-bridge.node loaded)"
      );
    }
    yield* this._syncViaSnapshot(opts);
  }

  _bridgeAvailable() {
    try {
      const b = this._deps.bridgeProvider();
      if (!b || typeof b.caps !== "function") return false;
      const c = b.caps();
      return c && c.available === true;
    } catch (_e) {
      return false;
    }
  }

  async *_syncViaBridge(opts) {
    const bridge = this._deps.bridgeProvider();
    if (!bridge || typeof bridge.invoke !== "function") {
      throw new Error(
        "system-data-android.sync: useBridge=true but cc-android-bridge is not loaded (run inside in-APK cc, or set CC_ANDROID_BRIDGE_OVERRIDE=1 for tests)"
      );
    }
    const includeContacts = opts.include?.contacts !== false;
    const includeApps = opts.include?.apps !== false;
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    const capturedAt = Date.now();
    let emitted = 0;

    if (includeContacts) {
      const res = await bridge.invoke("contacts.query", {
        since: Number.isInteger(opts.since) ? opts.since : undefined,
      });
      const arr = Array.isArray(res) ? res : Array.isArray(res?.contacts) ? res.contacts : [];
      for (const c of arr) {
        if (emitted >= limit) return;
        // originalId required by registry.putRawEvent (NOT NULL column); use
        // the stable Android lookupKey when present, else displayName.
        yield {
          kind: "contact",
          originalId: contactOriginalId(c),
          capturedAt,
          payload: c,
        };
        emitted += 1;
      }
    }

    if (includeApps) {
      const res = await bridge.invoke("app.list", { includeSystem: false });
      const arr = Array.isArray(res) ? res : Array.isArray(res?.apps) ? res.apps : [];
      for (const a of arr) {
        if (emitted >= limit) return;
        yield {
          kind: "app",
          originalId: appOriginalId(a),
          capturedAt,
          payload: a,
        };
        emitted += 1;
      }
    }

    const includeSms = opts.include?.sms !== false;
    if (includeSms) {
      const res = await bridge.invoke("sms.query", {
        since: Number.isInteger(opts.since) ? opts.since : undefined,
      });
      const arr = Array.isArray(res) ? res : Array.isArray(res?.sms) ? res.sms : [];
      for (const s of arr) {
        if (emitted >= limit) return;
        yield {
          kind: "sms",
          originalId: smsOriginalId(s),
          capturedAt,
          payload: s,
        };
        emitted += 1;
      }
    }

    const includeCalls = opts.include?.calls !== false;
    if (includeCalls) {
      const res = await bridge.invoke("call.query", {
        since: Number.isInteger(opts.since) ? opts.since : undefined,
      });
      const arr = Array.isArray(res) ? res : Array.isArray(res?.calls) ? res.calls : [];
      for (const c of arr) {
        if (emitted >= limit) return;
        yield {
          kind: "call",
          originalId: callOriginalId(c),
          capturedAt,
          payload: c,
        };
        emitted += 1;
      }
    }

    // Media files — metadata only (path, size, mtime, ext). Never reads
    // file content off the device. UI uses per-category include keys so
    // a privacy-conscious user can keep photos but skip downloads, etc.
    const MEDIA_CATEGORIES = ["photos", "pictures", "videos", "downloads", "documents"];
    for (const cat of MEDIA_CATEGORIES) {
      // Per-category include key: include.media.photos, include.media.videos, ...
      // Top-level `include.media === false` disables ALL media in one switch.
      if (opts.include?.media === false) break;
      if (opts.include?.media?.[cat] === false) continue;
      const res = await bridge.invoke("media.list", {
        category: cat,
        since: Number.isInteger(opts.since) ? opts.since : undefined,
      });
      const arr = Array.isArray(res) ? res : Array.isArray(res?.files) ? res.files : [];
      for (const f of arr) {
        if (emitted >= limit) return;
        yield {
          kind: "media-file",
          originalId: mediaOriginalId(f),
          capturedAt,
          payload: f,
        };
        emitted += 1;
      }
    }
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
        `system-data-android.sync: snapshot schemaVersion mismatch (got ${snapshot && snapshot.schemaVersion}, expected ${SNAPSHOT_SCHEMA_VERSION})`
      );
    }
    const capturedAt =
      Number.isFinite(snapshot.snapshottedAt) && snapshot.snapshottedAt > 0
        ? Math.floor(snapshot.snapshottedAt)
        : Date.now();

    const includeContacts = opts.include?.contacts !== false;
    const includeApps = opts.include?.apps !== false;
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    let emitted = 0;

    if (includeContacts && Array.isArray(snapshot.contacts)) {
      for (const c of snapshot.contacts) {
        if (emitted >= limit) return;
        yield {
          kind: "contact",
          originalId: contactOriginalId(c),
          capturedAt,
          payload: c,
        };
        emitted += 1;
      }
    }

    if (includeApps && Array.isArray(snapshot.apps)) {
      for (const a of snapshot.apps) {
        if (emitted >= limit) return;
        yield {
          kind: "app",
          originalId: appOriginalId(a),
          capturedAt,
          payload: a,
        };
        emitted += 1;
      }
    }
  }

  normalize(raw) {
    const ingestedAt = Date.now();
    const source = (originalId) => ({
      adapter: NAME,
      adapterVersion: VERSION,
      capturedAt: raw.capturedAt,
      capturedBy: CAPTURED_BY.API,
      originalId,
    });

    if (raw.kind === "contact") {
      const p = raw.payload || {};
      // lookupKey is Android's "stable across rename + edits" identifier; fall
      // back to displayName only if missing, which lets future runs still dedup
      // by name for the dataset where lookupKey is absent.
      const stableKey =
        (typeof p.lookupKey === "string" && p.lookupKey.length > 0 && p.lookupKey) ||
        (typeof p.displayName === "string" && p.displayName) ||
        `unknown-${raw.capturedAt}`;
      const displayName =
        typeof p.displayName === "string" && p.displayName.trim().length > 0
          ? p.displayName.trim()
          : "(无名联系人)";
      const identifiers = {};
      if (Array.isArray(p.phones) && p.phones.length > 0) {
        identifiers.phone = p.phones.filter((x) => typeof x === "string" && x.length > 0);
      }
      if (Array.isArray(p.emails) && p.emails.length > 0) {
        identifiers.email = p.emails.filter((x) => typeof x === "string" && x.length > 0);
      }

      const person = {
        id: `person-android-${stableKey}`,
        type: ENTITY_TYPES.PERSON,
        subtype: PERSON_SUBTYPES.CONTACT,
        names: [displayName],
        ingestedAt,
        source: source(`android-contact:${stableKey}`),
      };
      if (Object.keys(identifiers).length > 0) person.identifiers = identifiers;
      if (typeof p.organization === "string" && p.organization.trim().length > 0) {
        person.relation = p.organization.trim();
      }
      const extra = {};
      if (typeof p.starred === "boolean") extra.starred = p.starred;
      if (typeof p.photoUri === "string" && p.photoUri.length > 0) extra.photoUri = p.photoUri;
      if (Object.keys(extra).length > 0) person.extra = extra;

      // v0.3.1 — synthesise an OTHER event so the snapshot contact shows up
      // in the Vault Browser's `category=system` facet (which counts events,
      // not persons). Stable id keyed on stableKey makes re-syncs idempotent
      // via UPSERT; occurredAt floats forward to the latest snapshot time
      // ("last time we saw this contact"), payload itself lives on the person.
      const event = {
        id: `event-android-contact-${stableKey}`,
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.OTHER,
        occurredAt: raw.capturedAt,
        ingestedAt,
        source: source(`android-contact:${stableKey}`),
        content: { title: `联系人：${displayName}` },
        extra: { kind: "contact-snapshot" },
      };

      return {
        events: [event],
        persons: [person],
        places: [],
        items: [],
        topics: [],
      };
    }

    if (raw.kind === "app") {
      const a = raw.payload || {};
      const pkgName =
        (typeof a.packageName === "string" && a.packageName) || `unknown.${newId()}`;
      const label =
        typeof a.label === "string" && a.label.trim().length > 0
          ? a.label.trim()
          : pkgName;

      const item = {
        id: `item-android-app-${pkgName}`,
        type: ENTITY_TYPES.ITEM,
        subtype: ITEM_SUBTYPES.OTHER,
        name: label,
        category: a.isSystem === true ? "system-app" : "user-app",
        ingestedAt,
        source: source(`android-app:${pkgName}`),
        extra: {
          kind: "installed_app",
          packageName: pkgName,
          versionName: typeof a.versionName === "string" ? a.versionName : null,
          versionCode: Number.isInteger(a.versionCode) ? a.versionCode : null,
          firstInstallTime: Number.isInteger(a.firstInstallTime) ? a.firstInstallTime : null,
          lastUpdateTime: Number.isInteger(a.lastUpdateTime) ? a.lastUpdateTime : null,
          isSystem: a.isSystem === true,
        },
      };

      // v0.3.1 — same rationale as the contact branch: emit a synthetic
      // OTHER event so installed apps show up in the system facet count.
      const event = {
        id: `event-android-app-${pkgName}`,
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.OTHER,
        occurredAt: raw.capturedAt,
        ingestedAt,
        source: source(`android-app:${pkgName}`),
        content: { title: `应用：${label}` },
        extra: { kind: "app-snapshot", packageName: pkgName },
      };

      return {
        events: [event],
        persons: [],
        places: [],
        items: [item],
        topics: [],
      };
    }

    if (raw.kind === "sms") {
      const p = raw.payload || {};
      // SMS type from Android SDK Telephony.Sms (Inbox.MESSAGE_TYPE_*):
      //   1 INBOX, 2 SENT, 3 DRAFT, 4 OUTBOX, 5 FAILED, 6 QUEUED
      const direction = p.type === 2 || p.type === 4 ? "out" : "in";
      const eventId = `event-android-sms-${p.id || raw.capturedAt}`;
      const occurredAt = Number.isInteger(p.date) ? p.date : raw.capturedAt;
      const bodyText = typeof p.body === "string" ? p.body : "";
      const event = {
        id: eventId,
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.MESSAGE,
        occurredAt,
        ingestedAt,
        source: source(`android-sms:${p.id || raw.capturedAt}`),
        actor: direction === "in" ? p.address : "self",
        // Participants on the OTHER side of the message.
        participants: p.address ? [p.address] : [],
        // Validator (lib/schemas.js validateEvent) requires `content` to be
        // a plain object — title/text/etc go INSIDE this object, not on the
        // event root.
        content: {
          title: bodyText.length > 0
            ? (bodyText.length > 80 ? bodyText.substring(0, 80) + "…" : bodyText)
            : "(空短信)",
          text: bodyText,
        },
      };
      const extra = { direction, threadId: p.threadId };
      if (typeof p.dateSent === "number") extra.dateSent = p.dateSent;
      if (typeof p.read === "boolean") extra.read = p.read;
      if (typeof p.subject === "string" && p.subject.length > 0) extra.subject = p.subject;
      if (Number.isInteger(p.type)) extra.smsType = p.type;
      event.extra = extra;

      return { events: [event], persons: [], places: [], items: [], topics: [] };
    }

    if (raw.kind === "call") {
      const p = raw.payload || {};
      // Call type from Android SDK CallLog.Calls.TYPE:
      //   1 INCOMING, 2 OUTGOING, 3 MISSED, 4 VOICEMAIL, 5 REJECTED, 6 BLOCKED
      const direction = p.type === 2 ? "out" : "in";
      const eventId = `event-android-call-${p.id || raw.capturedAt}`;
      const occurredAt = Number.isInteger(p.date) ? p.date : raw.capturedAt;
      const callTypeName =
        p.type === 1 ? "incoming" :
        p.type === 2 ? "outgoing" :
        p.type === 3 ? "missed" :
        p.type === 4 ? "voicemail" :
        p.type === 5 ? "rejected" :
        p.type === 6 ? "blocked" : "unknown";
      const titleName =
        (typeof p.name === "string" && p.name.trim().length > 0) ? p.name.trim() : (p.number || "未知号码");
      const title =
        `${callTypeName === "missed" ? "未接 " : ""}${callTypeName === "outgoing" ? "拨打 " : ""}${callTypeName === "incoming" ? "来电 " : ""}${titleName}`;
      const event = {
        id: eventId,
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.CALL,
        occurredAt,
        ingestedAt,
        source: source(`android-call:${p.id || raw.capturedAt}`),
        actor: direction === "in" ? p.number : "self",
        participants: p.number ? [p.number] : [],
        // Schema-required `content` object — title goes here, not on root.
        content: { title },
      };
      if (Number.isInteger(p.duration) && p.duration > 0) {
        event.durationMs = p.duration * 1000;
      }
      const extra = { direction, callType: callTypeName };
      if (Number.isInteger(p.type)) extra.androidCallType = p.type;
      if (typeof p.geocoded === "string" && p.geocoded.length > 0) extra.geocoded = p.geocoded;
      if (typeof p.name === "string" && p.name.length > 0) extra.name = p.name;
      event.extra = extra;

      return { events: [event], persons: [], places: [], items: [], topics: [] };
    }

    if (raw.kind === "media-file") {
      const p = raw.payload || {};
      const path = typeof p.path === "string" ? p.path : "";
      const fileName = path.includes("/") ? path.substring(path.lastIndexOf("/") + 1) : path;
      // Category → item subtype + category string
      let subtype = ITEM_SUBTYPES.OTHER;
      let category = "media";
      if (p.category === "photos" || p.category === "pictures" || p.category === "videos") {
        subtype = ITEM_SUBTYPES.MEDIA;
        category = p.category;
      } else if (p.category === "documents") {
        subtype = ITEM_SUBTYPES.DOCUMENT;
        category = "documents";
      } else if (p.category === "downloads") {
        subtype = ITEM_SUBTYPES.OTHER;
        category = "downloads";
      }
      const item = {
        id: `item-android-media-${path}`,
        type: ENTITY_TYPES.ITEM,
        subtype,
        name: fileName || "(无名)",
        category,
        ingestedAt,
        source: source(`android-media:${path}`),
        extra: {
          path,
          size: Number.isInteger(p.size) ? p.size : null,
          mtimeMs: Number.isInteger(p.mtimeMs) ? p.mtimeMs : null,
          ext: typeof p.ext === "string" ? p.ext : null,
          androidCategory: p.category,
        },
      };
      return { events: [], persons: [], places: [], items: [item], topics: [] };
    }

    throw new Error(`system-data-android.normalize: unknown raw.kind=${raw.kind}`);
  }
}

module.exports = {
  SystemDataAndroidAdapter,
  SYSTEM_DATA_ANDROID_NAME: NAME,
  SYSTEM_DATA_ANDROID_VERSION: VERSION,
  SNAPSHOT_SCHEMA_VERSION,
};
