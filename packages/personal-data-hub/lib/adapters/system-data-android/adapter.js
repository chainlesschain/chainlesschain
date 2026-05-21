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
  CAPTURED_BY,
} = require("../../constants");

const NAME = "system-data-android";
const VERSION = "0.1.0";
const SNAPSHOT_SCHEMA_VERSION = 1;

class SystemDataAndroidAdapter {
  constructor(opts = {}) {
    this.name = NAME;
    this.version = VERSION;
    this.capabilities = [
      "sync:android-content-provider",
      "sync:android-package-manager",
    ];
    this.extractMode = "device-pull";
    this.rateLimits = { perDay: 24 };
    this.dataDisclosure = {
      fields: [
        "contacts:displayName,phones,emails,starred,organization,photoUri",
        "installed_apps:packageName,label,versionName,versionCode,firstInstallTime,lastUpdateTime,isSystem",
      ],
      sensitivity: "medium",
      legalGate: false,
      defaultInclude: { contacts: true, apps: true },
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
        yield { kind: "contact", capturedAt, payload: c };
        emitted += 1;
      }
    }

    if (includeApps) {
      const res = await bridge.invoke("app.list", { includeSystem: false });
      const arr = Array.isArray(res) ? res : Array.isArray(res?.apps) ? res.apps : [];
      for (const a of arr) {
        if (emitted >= limit) return;
        yield { kind: "app", capturedAt, payload: a };
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

      return {
        events: [],
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

      return {
        events: [],
        persons: [],
        places: [],
        items: [item],
        topics: [],
      };
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
