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
const { parseTransactionSms } = require("./sms-transaction");
const {
  probeJsonSnapshotFile,
  readJsonSnapshot,
} = require("../../snapshot-file");
const {
  SourcePageError,
  extractRecognizedArray,
} = require("../../source-page");
const {
  ENTITY_TYPES,
  PERSON_SUBTYPES,
  ITEM_SUBTYPES,
  EVENT_SUBTYPES,
  CAPTURED_BY,
} = require("../../constants");

const NAME = "system-data-android";
// v0.4.2 (2026-07-25): stop treating emitted row counts as durable source
// cursors. Android's heterogeneous bridge streams do not expose compatible
// resumable cursors, so bounded runs now report themselves as incomplete,
// never advance a cursor, and fairly rotate the bounded sample. Legacy count
// values are preserved inertly: they no longer filter this adapter or grow.
// v0.4.1 (2026-07-25): use the shared bounded/TOCTOU-safe snapshot reader,
// fail closed on unrecognized bridge responses, and reject records that
// cannot provide a deterministic source identifier.
// v0.4.0 (2026-07-24): make the existing snapshot + host-ADB dual path a
// first-class adapter contract. `sync:snapshot` lets shells offer a file
// picker when no phone is connected, while constructor bridge injection
// removes the CLI/desktop post-construction `_deps` mutation.
// v0.3.4 (2026-07-23): preserve the job title already exposed by Android's
//   Contacts provider. The snapshot writer previously queried TITLE but
//   discarded it. It now lands on both person.extra and the synthetic event.
// v0.3.3 (2026-07-10): bank/payment transaction SMS are now parsed into
//   amount-bearing financial events (subtype payment/transfer/income/refund
//   + content.amount) instead of plain MESSAGE, so the one reliably-collected
//   money source feeds the spending analysis. Non-transaction SMS (OTP,
//   marketing, plain chat) keep the MESSAGE mapping — strictly additive.
// v0.3.2 (2026-05-25): denormalise contact identifiers (phones/emails/
//   organization/starred) and app version/install fields onto
//   event.extra so the Vault Browser tap-to-detail sheet can render
//   human-readable fields without joining back to the persons/items
//   tables. Same content lives on the entity rows; events are now a
//   convenience copy. Adds ~50-200 bytes per event but keeps the detail
//   UI single-table.
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
const VERSION = "0.4.2";
const SNAPSHOT_SCHEMA_VERSION = 1;
const MAX_BOUNDED_SAMPLERS = 32;

function globalEventLimit(opts) {
  const candidates = [opts && opts.limit, opts && opts.maxEvents].filter(
    (value) => Number.isSafeInteger(value) && value > 0,
  );
  return candidates.length > 0 ? Math.min(...candidates) : Infinity;
}

// Stable per-source originalId — registry.putRawEvent rejects null originalId
// with a NOT NULL constraint, surfacing as invalidCount += rawCount on the
// SyncReport (real-device repro 2026-05-21: 1305 of 1305 raws "invalid"
// despite all entities being written). Re-deriving the same key on each
// sync also lets the raw_events store dedup naturally.
function requireStableSourceKey(value, kind) {
  const key =
    typeof value === "string"
      ? value.trim()
      : typeof value === "number" && Number.isFinite(value)
        ? String(value)
        : typeof value === "bigint"
          ? String(value)
          : "";
  if (!key) {
    throw new Error(
      `system-data-android.sync: ${kind} record requires a stable source id`,
    );
  }
  return key;
}

function contactOriginalId(c) {
  const key =
    (c &&
      typeof c.lookupKey === "string" &&
      c.lookupKey.trim().length > 0 &&
      c.lookupKey.trim()) ||
    (c &&
      typeof c.displayName === "string" &&
      c.displayName.trim().length > 0 &&
      c.displayName.trim());
  return `android-contact:${requireStableSourceKey(key, "contact")}`;
}

function appOriginalId(a) {
  const key = a && typeof a.packageName === "string" && a.packageName.trim();
  return `android-app:${requireStableSourceKey(key, "app")}`;
}

function smsOriginalId(s) {
  // Stable across re-syncs: use SMS _id from the system content provider.
  return `android-sms:${requireStableSourceKey(s && s.id, "sms")}`;
}

function callOriginalId(c) {
  // Stable across re-syncs: use call_log _id from the system content provider.
  return `android-call:${requireStableSourceKey(c && c.id, "call")}`;
}

function mediaOriginalId(m) {
  // Full filesystem path is stable as long as the file isn't moved/renamed.
  // Path is unique within the device.
  const key = m && typeof m.path === "string" && m.path.trim();
  return `android-media:${requireStableSourceKey(key, "media-file")}`;
}

function extractBridgeRows(response, field, operation) {
  if (Array.isArray(response)) return response;
  const fields = Array.isArray(field) ? field : [field];
  return extractRecognizedArray(
    response,
    fields.map((name) => [name]),
    {
      source: NAME,
      stream: operation,
    },
  );
}

function requireBridgeRecord(record, operation) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new SourcePageError(
      "SOURCE_RECORD_INVALID",
      `${NAME}: ${operation} source returned an invalid record`,
    );
  }
  return record;
}

function bridgeParams(opts, params = {}) {
  const serial =
    opts && typeof opts.serial === "string" ? opts.serial.trim() : "";
  return serial ? { ...params, serial } : params;
}

async function invokeBridgeWithAliases(bridge, primary, aliases, params) {
  let response;
  try {
    response = await bridge.invoke(primary, params);
  } catch (error) {
    if (
      !Array.isArray(aliases) ||
      aliases.length === 0 ||
      !/unknown method|not implemented/iu.test(
        error && error.message ? error.message : "",
      )
    ) {
      throw error;
    }
  }
  if (
    response &&
    typeof response === "object" &&
    !Array.isArray(response) &&
    response.error !== "UNKNOWN_METHOD"
  ) {
    return response;
  }
  if (Array.isArray(response)) return response;
  if (!Array.isArray(aliases) || aliases.length === 0) return response;
  return bridge.invoke(aliases[0], params);
}

class SystemDataAndroidAdapter {
  constructor(opts = {}) {
    this.name = NAME;
    this.version = VERSION;
    this.capabilities = [
      "sync:snapshot",
      "sync:adb",
      "sync:android-content-provider",
      "sync:android-package-manager",
      "sync:android-sms",
      "sync:android-call-log",
      "sync:android-media-files",
    ];
    this.extractMode = "device-pull";
    this.rateLimits = { perDay: 24 };
    // Contacts, installed apps, SMS, calls, and media do not share a durable
    // cursor. A row count is not a source position and can hide replayed
    // prefixes, so never invent or advance one. Registry still reports a
    // bounded `none` run as watermarkDeferred without pretending this
    // non-watermarked collector has a resumable complete-scan contract.
    this.watermarkStrategy = "none";
    this.dataDisclosure = {
      fields: [
        "contacts:displayName,phones,emails,starred,organization,jobTitle,photoUri",
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
        media: {
          photos: true,
          pictures: true,
          videos: true,
          downloads: true,
          documents: true,
        },
      },
    };

    // _deps for test/host injection — mirrors the pattern in cli-dev.md.
    // `bridgeProvider` is lazy because the bridge implementation belongs to
    // the host shell and is not always available when the PDH package loads.
    // Resolves to null when unreachable, in which case sync() falls back to
    // inputPath snapshot mode.
    this._deps = {
      fs: require("node:fs"),
      bridgeProvider:
        typeof opts.bridgeProvider === "function"
          ? opts.bridgeProvider
          : () => null,
    };

    // Process-local fairness only. Samplers are isolated by ingestion mode
    // and source identity, LRU-bounded, and never advertised as durable
    // checkpoints. A restart may replay rows, which is safe because
    // originalId is stable and the durable watermark remains unchanged.
    this._boundedSamplers = new Map();
  }

  // ─── PersonalDataAdapter contract ──────────────────────────────────────

  async authenticate(ctx = {}) {
    return probeJsonSnapshotFile(this._deps.fs, ctx && ctx.inputPath, {
      maxBytes: ctx && ctx.maxSnapshotBytes,
      expectedSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
      requiredArrayFields: ["contacts", "apps"],
    });
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
    const wantBridge =
      opts.useBridge === true || (!opts.inputPath && this._bridgeAvailable());
    if (wantBridge) {
      yield* this._syncViaBridge(opts);
      return;
    }
    if (!opts || typeof opts.inputPath !== "string") {
      throw new Error(
        "system-data-android.sync: needs opts.inputPath (snapshot mode) OR opts.useBridge=true (in-APK Android cc with cc-android-bridge.node loaded)",
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

  _samplerKey(mode, identity) {
    return JSON.stringify([mode, identity]);
  }

  _stableSamplerIdentity(mode, opts) {
    const candidates =
      mode === "bridge"
        ? [
            ["serial", opts.serial],
            ["sourceIdentity", opts.sourceIdentity],
            ["scope", opts.scope],
          ]
        : [
            ["sourceIdentity", opts.sourceIdentity],
            ["scope", opts.scope],
          ];
    const components = candidates.flatMap(([kind, value]) =>
      typeof value === "string" && value.trim().length > 0
        ? [[kind, value.trim()]]
        : [],
    );
    return components.length > 0 ? JSON.stringify(components) : null;
  }

  _leaseBoundedSampler(mode, identity) {
    if (!identity) {
      return {
        key: null,
        token: null,
        nextKey: null,
        offsets: new Map(),
      };
    }
    const key = this._samplerKey(mode, identity);
    let sampler = this._boundedSamplers.get(key);
    if (sampler) {
      this._boundedSamplers.delete(key);
      this._boundedSamplers.set(key, sampler);
    } else {
      while (this._boundedSamplers.size >= MAX_BOUNDED_SAMPLERS) {
        const oldestKey = this._boundedSamplers.keys().next().value;
        this._boundedSamplers.delete(oldestKey);
      }
      sampler = { nextKey: null, offsets: new Map(), token: null };
      this._boundedSamplers.set(key, sampler);
    }
    const token = Symbol("system-data-android-sampler-generation");
    sampler.token = token;
    return {
      key,
      token,
      nextKey: sampler.nextKey,
      offsets: new Map(sampler.offsets),
    };
  }

  _commitBoundedSampler(lease, candidate) {
    if (!lease.key) return false;
    const current = this._boundedSamplers.get(lease.key);
    if (!current || current.token !== lease.token) return false;
    current.nextKey = candidate.nextKey;
    current.offsets = new Map(candidate.offsets);
    this._boundedSamplers.delete(lease.key);
    this._boundedSamplers.set(lease.key, current);
    return true;
  }

  _clearBoundedSampler(lease) {
    if (!lease.key) return false;
    const current = this._boundedSamplers.get(lease.key);
    if (!current || current.token !== lease.token) return false;
    this._boundedSamplers.delete(lease.key);
    return true;
  }

  _deferSamplerMutation(opts, lease, mutation) {
    if (!lease.key || typeof opts.deferSyncCommit !== "function") return false;
    opts.deferSyncCommit(() => mutation());
    return true;
  }

  *_yieldSnapshotStreams(streams, opts) {
    const activeStreams = streams.filter(
      (stream) => Array.isArray(stream.rows) && stream.rows.length > 0,
    );
    const available = activeStreams.reduce(
      (total, stream) => total + stream.rows.length,
      0,
    );
    const limit = globalEventLimit(opts);
    const samplerIdentity = this._stableSamplerIdentity("snapshot", opts);
    const lease = this._leaseBoundedSampler("snapshot", samplerIdentity);

    if (limit === Infinity || available < limit) {
      for (const stream of activeStreams) {
        for (const raw of stream.rows) yield raw;
      }
      if (typeof opts.markWatermarkComplete === "function") {
        opts.markWatermarkComplete();
      }
      const deferred = this._deferSamplerMutation(opts, lease, () =>
        this._clearBoundedSampler(lease),
      );
      if (!deferred) this._clearBoundedSampler(lease);
      return;
    }

    const workingOffsets = new Map(lease.offsets);
    const remaining = new Map(
      activeStreams.map((stream) => [stream.key, stream.rows.length]),
    );
    let streamIndex = Math.max(
      0,
      activeStreams.findIndex((stream) => stream.key === lease.nextKey),
    );
    const selected = [];
    while (selected.length < limit) {
      const stream = activeStreams[streamIndex];
      const streamRemaining = remaining.get(stream.key) || 0;
      if (streamRemaining > 0) {
        const offset =
          (workingOffsets.get(stream.key) || 0) % stream.rows.length;
        selected.push(stream.rows[offset]);
        workingOffsets.set(stream.key, (offset + 1) % stream.rows.length);
        remaining.set(stream.key, streamRemaining - 1);
      }
      streamIndex = (streamIndex + 1) % activeStreams.length;
    }
    const nextBoundedStreamKey = activeStreams[streamIndex].key;
    const candidate = {
      nextKey: nextBoundedStreamKey,
      offsets: workingOffsets,
    };

    for (const [index, raw] of selected.entries()) {
      let deferred = false;
      if (index === selected.length - 1) {
        if (typeof opts.onProgress === "function") {
          opts.onProgress({
            phase: "scan-incomplete",
            status: "partial",
            complete: false,
            reason: "global-limit",
            emitted: selected.length,
            available,
            limit,
            resumable: false,
          });
        }
        deferred = this._deferSamplerMutation(opts, lease, () =>
          this._commitBoundedSampler(lease, candidate),
        );
      }
      yield raw;
      if (index === selected.length - 1 && !deferred) {
        this._commitBoundedSampler(lease, candidate);
      }
    }
  }

  async *_yieldBridgeDescriptors(descriptors, opts) {
    const limit = globalEventLimit(opts);
    const samplerIdentity = this._stableSamplerIdentity("bridge", opts);
    const lease = this._leaseBoundedSampler("bridge", samplerIdentity);

    if (limit === Infinity) {
      for (const descriptor of descriptors) {
        const rows = await descriptor.load();
        for (const raw of rows) yield raw;
      }
      if (typeof opts.markWatermarkComplete === "function") {
        opts.markWatermarkComplete();
      }
      const deferred = this._deferSamplerMutation(opts, lease, () =>
        this._clearBoundedSampler(lease),
      );
      if (!deferred) this._clearBoundedSampler(lease);
      return;
    }

    if (descriptors.length === 0) {
      if (typeof opts.markWatermarkComplete === "function") {
        opts.markWatermarkComplete();
      }
      const deferred = this._deferSamplerMutation(opts, lease, () =>
        this._clearBoundedSampler(lease),
      );
      if (!deferred) this._clearBoundedSampler(lease);
      return;
    }

    const workingSampler = {
      nextKey: lease.nextKey,
      offsets: new Map(lease.offsets),
    };
    let descriptorIndex = Math.max(
      0,
      descriptors.findIndex(
        (descriptor) => descriptor.key === workingSampler.nextKey,
      ),
    );
    let queriedStreams = 0;
    let selected = 0;

    while (queriedStreams < descriptors.length) {
      const descriptor = descriptors[descriptorIndex];
      const rows = await descriptor.load();
      queriedStreams += 1;
      let rowIndex =
        rows.length > 0
          ? (workingSampler.offsets.get(descriptor.key) || 0) % rows.length
          : 0;

      while (rowIndex < rows.length) {
        const raw = rows[rowIndex];
        rowIndex += 1;
        selected += 1;
        if (rowIndex < rows.length) {
          workingSampler.offsets.set(descriptor.key, rowIndex);
          workingSampler.nextKey = descriptor.key;
        } else {
          workingSampler.offsets.set(descriptor.key, 0);
          workingSampler.nextKey =
            descriptors[(descriptorIndex + 1) % descriptors.length].key;
        }

        let deferred = false;
        let candidate = null;
        if (selected === limit) {
          if (typeof opts.onProgress === "function") {
            opts.onProgress({
              phase: "scan-incomplete",
              status: "partial",
              complete: false,
              reason: "global-limit",
              emitted: selected,
              limit,
              queriedStreams,
              enabledStreams: descriptors.length,
              resumable: false,
            });
          }
          candidate = {
            nextKey: workingSampler.nextKey,
            offsets: new Map(workingSampler.offsets),
          };
          deferred = this._deferSamplerMutation(opts, lease, () =>
            this._commitBoundedSampler(lease, candidate),
          );
        }

        yield raw;
        if (selected === limit) {
          if (!deferred) this._commitBoundedSampler(lease, candidate);
          return;
        }
      }

      workingSampler.offsets.set(descriptor.key, 0);
      descriptorIndex = (descriptorIndex + 1) % descriptors.length;
      workingSampler.nextKey = descriptors[descriptorIndex].key;
    }

    // All enabled streams were queried and fewer than `limit` records were
    // selected. Equality remains conservatively incomplete because the
    // registry may stop requesting values at the exact event boundary.
    if (typeof opts.markWatermarkComplete === "function") {
      opts.markWatermarkComplete();
    }
    const deferred = this._deferSamplerMutation(opts, lease, () =>
      this._clearBoundedSampler(lease),
    );
    if (!deferred) this._clearBoundedSampler(lease);
  }

  async *_syncViaBridge(opts) {
    const bridge = this._deps.bridgeProvider();
    if (!bridge || typeof bridge.invoke !== "function") {
      throw new Error(
        "system-data-android.sync: useBridge=true but cc-android-bridge is not loaded (run inside in-APK cc, or set CC_ANDROID_BRIDGE_OVERRIDE=1 for tests)",
      );
    }
    const capturedAt = Date.now();
    const descriptors = [];

    if (opts.include?.contacts !== false) {
      descriptors.push({
        key: "contacts",
        load: async () => {
          const res = await bridge.invoke("contacts.query", {
            ...bridgeParams(opts),
            since: Number.isInteger(opts.since) ? opts.since : undefined,
          });
          const arr = extractBridgeRows(res, "contacts", "contacts.query");
          return arr.map((contact) => {
            requireBridgeRecord(contact, "contacts.query");
            return {
              kind: "contact",
              originalId: contactOriginalId(contact),
              capturedAt,
              payload: contact,
            };
          });
        },
      });
    }

    if (opts.include?.apps !== false) {
      descriptors.push({
        key: "apps",
        load: async () => {
          const res = await bridge.invoke(
            "app.list",
            bridgeParams(opts, { includeSystem: false }),
          );
          const arr = extractBridgeRows(res, "apps", "app.list");
          return arr.map((app) => {
            requireBridgeRecord(app, "app.list");
            return {
              kind: "app",
              originalId: appOriginalId(app),
              capturedAt,
              payload: app,
            };
          });
        },
      });
    }

    if (opts.include?.sms !== false) {
      descriptors.push({
        key: "sms",
        load: async () => {
          const res = await bridge.invoke("sms.query", {
            ...bridgeParams(opts),
            since: Number.isInteger(opts.since) ? opts.since : undefined,
          });
          const arr = extractBridgeRows(res, ["sms", "messages"], "sms.query");
          return arr.map((sms) => {
            requireBridgeRecord(sms, "sms.query");
            return {
              kind: "sms",
              originalId: smsOriginalId(sms),
              capturedAt,
              payload: sms,
            };
          });
        },
      });
    }

    if (opts.include?.calls !== false) {
      descriptors.push({
        key: "calls",
        load: async () => {
          const res = await invokeBridgeWithAliases(
            bridge,
            "call.query",
            ["calls.query"],
            {
              ...bridgeParams(opts),
              since: Number.isInteger(opts.since) ? opts.since : undefined,
            },
          );
          const arr = extractBridgeRows(res, "calls", "call.query");
          return arr.map((record) => {
            requireBridgeRecord(record, "call.query");
            const call =
              record.duration == null && record.durationSec != null
                ? { ...record, duration: record.durationSec }
                : record;
            return {
              kind: "call",
              originalId: callOriginalId(call),
              capturedAt,
              payload: call,
            };
          });
        },
      });
    }

    // Media files are metadata only. Each category stays lazy so a bounded
    // contacts/apps/SMS run never invokes later media bridge methods.
    const mediaCategories = [
      "photos",
      "pictures",
      "videos",
      "downloads",
      "documents",
    ];
    if (opts.include?.media !== false) {
      for (const category of mediaCategories) {
        if (opts.include?.media?.[category] === false) continue;
        descriptors.push({
          key: `media:${category}`,
          load: async () => {
            const operation = `media.list:${category}`;
            const res = await bridge.invoke("media.list", {
              ...bridgeParams(opts),
              category,
              since: Number.isInteger(opts.since) ? opts.since : undefined,
            });
            const arr = extractBridgeRows(res, "files", operation);
            return arr.map((file) => {
              requireBridgeRecord(file, operation);
              return {
                kind: "media-file",
                originalId: mediaOriginalId(file),
                capturedAt,
                payload: file,
              };
            });
          },
        });
      }
    }

    yield* this._yieldBridgeDescriptors(descriptors, opts);
  }

  async *_syncViaSnapshot(opts) {
    const snapshot = readJsonSnapshot(this._deps.fs, opts.inputPath, {
      maxBytes: opts.maxSnapshotBytes,
      expectedSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
      requiredArrayFields: ["contacts", "apps"],
    });
    const capturedAt =
      Number.isFinite(snapshot.snapshottedAt) && snapshot.snapshottedAt > 0
        ? Math.floor(snapshot.snapshottedAt)
        : Date.now();

    const includeContacts = opts.include?.contacts !== false;
    const includeApps = opts.include?.apps !== false;
    const streams = [];

    if (includeContacts && Array.isArray(snapshot.contacts)) {
      streams.push({
        key: "contacts",
        rows: snapshot.contacts.map((c) => ({
          kind: "contact",
          originalId: contactOriginalId(c),
          capturedAt,
          payload: c,
        })),
      });
    }

    if (includeApps && Array.isArray(snapshot.apps)) {
      streams.push({
        key: "apps",
        rows: snapshot.apps.map((a) => ({
          kind: "app",
          originalId: appOriginalId(a),
          capturedAt,
          payload: a,
        })),
      });
    }

    yield* this._yieldSnapshotStreams(streams, opts);
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
        (typeof p.lookupKey === "string" &&
          p.lookupKey.length > 0 &&
          p.lookupKey) ||
        (typeof p.displayName === "string" && p.displayName) ||
        `unknown-${raw.capturedAt}`;
      const displayName =
        typeof p.displayName === "string" && p.displayName.trim().length > 0
          ? p.displayName.trim()
          : "(无名联系人)";
      const identifiers = {};
      if (Array.isArray(p.phones) && p.phones.length > 0) {
        identifiers.phone = p.phones.filter(
          (x) => typeof x === "string" && x.length > 0,
        );
      }
      if (Array.isArray(p.emails) && p.emails.length > 0) {
        identifiers.email = p.emails.filter(
          (x) => typeof x === "string" && x.length > 0,
        );
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
      if (
        typeof p.organization === "string" &&
        p.organization.trim().length > 0
      ) {
        person.relation = p.organization.trim();
      }
      const extra = {};
      if (typeof p.starred === "boolean") extra.starred = p.starred;
      if (typeof p.jobTitle === "string" && p.jobTitle.trim().length > 0) {
        extra.jobTitle = p.jobTitle.trim();
      }
      if (typeof p.photoUri === "string" && p.photoUri.length > 0)
        extra.photoUri = p.photoUri;
      if (Object.keys(extra).length > 0) person.extra = extra;

      // v0.3.1 — synthesise an OTHER event so the snapshot contact shows up
      // in the Vault Browser's `category=system` facet (which counts events,
      // not persons). Stable id keyed on stableKey makes re-syncs idempotent
      // via UPSERT; occurredAt floats forward to the latest snapshot time
      // ("last time we saw this contact").
      //
      // v0.3.2 — duplicate the contact's identifying fields onto event.extra
      // so the Vault Browser's tap-to-detail sheet can render them inline
      // without joining back to the persons table. Phones/emails/relation/
      // starred — same data shape as person.identifiers + person.relation
      // + person.extra, just denormalised so a single events-table read
      // suffices for the detail UI.
      const eventExtra = { kind: "contact-snapshot" };
      if (identifiers.phone && identifiers.phone.length > 0) {
        eventExtra.phones = identifiers.phone;
      }
      if (identifiers.email && identifiers.email.length > 0) {
        eventExtra.emails = identifiers.email;
      }
      if (
        typeof p.organization === "string" &&
        p.organization.trim().length > 0
      ) {
        eventExtra.organization = p.organization.trim();
      }
      if (typeof p.jobTitle === "string" && p.jobTitle.trim().length > 0) {
        eventExtra.jobTitle = p.jobTitle.trim();
      }
      if (typeof p.starred === "boolean") eventExtra.starred = p.starred;
      const event = {
        id: `event-android-contact-${stableKey}`,
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.OTHER,
        occurredAt: raw.capturedAt,
        ingestedAt,
        source: source(`android-contact:${stableKey}`),
        content: { title: `联系人：${displayName}` },
        extra: eventExtra,
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
        (typeof a.packageName === "string" && a.packageName) ||
        `unknown.${newId()}`;
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
          firstInstallTime: Number.isInteger(a.firstInstallTime)
            ? a.firstInstallTime
            : null,
          lastUpdateTime: Number.isInteger(a.lastUpdateTime)
            ? a.lastUpdateTime
            : null,
          isSystem: a.isSystem === true,
        },
      };

      // v0.3.1 — same rationale as the contact branch: emit a synthetic
      // OTHER event so installed apps show up in the system facet count.
      // v0.3.2 — copy versioning/install fields onto event.extra so the
      // detail sheet can render them inline.
      const eventExtra = { kind: "app-snapshot", packageName: pkgName };
      if (typeof a.versionName === "string" && a.versionName.length > 0) {
        eventExtra.versionName = a.versionName;
      }
      if (Number.isInteger(a.versionCode))
        eventExtra.versionCode = a.versionCode;
      if (Number.isInteger(a.firstInstallTime)) {
        eventExtra.firstInstallTime = a.firstInstallTime;
      }
      if (Number.isInteger(a.lastUpdateTime))
        eventExtra.lastUpdateTime = a.lastUpdateTime;
      if (typeof a.isSystem === "boolean") eventExtra.isSystem = a.isSystem;
      const event = {
        id: `event-android-app-${pkgName}`,
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.OTHER,
        occurredAt: raw.capturedAt,
        ingestedAt,
        source: source(`android-app:${pkgName}`),
        content: { title: `应用：${label}` },
        extra: eventExtra,
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
          title:
            bodyText.length > 0
              ? bodyText.length > 80
                ? bodyText.substring(0, 80) + "…"
                : bodyText
              : "(空短信)",
          text: bodyText,
        },
      };
      const extra = { direction, threadId: p.threadId };
      if (typeof p.dateSent === "number") extra.dateSent = p.dateSent;
      if (typeof p.read === "boolean") extra.read = p.read;
      if (typeof p.subject === "string" && p.subject.length > 0)
        extra.subject = p.subject;
      if (Number.isInteger(p.type)) extra.smsType = p.type;

      // Bank / payment notification SMS carry a real transaction amount. When
      // confidently recognized, upgrade this from a plain MESSAGE to an
      // amount-bearing financial event so it feeds the spending analysis.
      // `direction` on extra keeps its MESSAGE meaning (inbox/sent); the money
      // direction lives on content.amount, which vault.sumEventAmount reads
      // first. Strictly additive — a null parse leaves the MESSAGE mapping.
      const tx = parseTransactionSms(bodyText);
      if (tx) {
        event.subtype = tx.subtype;
        event.content.amount = {
          value: tx.amountYuan,
          currency: tx.currency,
          direction: tx.direction,
        };
        extra.txDirection = tx.direction;
        if (typeof tx.balanceYuan === "number")
          extra.balanceYuan = tx.balanceYuan;
      }
      event.extra = extra;

      return {
        events: [event],
        persons: [],
        places: [],
        items: [],
        topics: [],
      };
    }

    if (raw.kind === "call") {
      const p = raw.payload || {};
      // Call type from Android SDK CallLog.Calls.TYPE:
      //   1 INCOMING, 2 OUTGOING, 3 MISSED, 4 VOICEMAIL, 5 REJECTED, 6 BLOCKED
      const direction = p.type === 2 ? "out" : "in";
      const eventId = `event-android-call-${p.id || raw.capturedAt}`;
      const occurredAt = Number.isInteger(p.date) ? p.date : raw.capturedAt;
      const callTypeName =
        p.type === 1
          ? "incoming"
          : p.type === 2
            ? "outgoing"
            : p.type === 3
              ? "missed"
              : p.type === 4
                ? "voicemail"
                : p.type === 5
                  ? "rejected"
                  : p.type === 6
                    ? "blocked"
                    : "unknown";
      const titleName =
        typeof p.name === "string" && p.name.trim().length > 0
          ? p.name.trim()
          : p.number || "未知号码";
      const title = `${callTypeName === "missed" ? "未接 " : ""}${callTypeName === "outgoing" ? "拨打 " : ""}${callTypeName === "incoming" ? "来电 " : ""}${titleName}`;
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
      if (typeof p.geocoded === "string" && p.geocoded.length > 0)
        extra.geocoded = p.geocoded;
      if (typeof p.name === "string" && p.name.length > 0) extra.name = p.name;
      event.extra = extra;

      return {
        events: [event],
        persons: [],
        places: [],
        items: [],
        topics: [],
      };
    }

    if (raw.kind === "media-file") {
      const p = raw.payload || {};
      const path = typeof p.path === "string" ? p.path : "";
      const fileName = path.includes("/")
        ? path.substring(path.lastIndexOf("/") + 1)
        : path;
      // Category → item subtype + category string
      let subtype = ITEM_SUBTYPES.OTHER;
      let category = "media";
      if (
        p.category === "photos" ||
        p.category === "pictures" ||
        p.category === "videos"
      ) {
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

    throw new Error(
      `system-data-android.normalize: unknown raw.kind=${raw.kind}`,
    );
  }
}

module.exports = {
  SystemDataAndroidAdapter,
  SYSTEM_DATA_ANDROID_NAME: NAME,
  SYSTEM_DATA_ANDROID_VERSION: VERSION,
  SNAPSHOT_SCHEMA_VERSION,
};
