"use strict";

/**
 * Unit tests for SystemDataAdapter (Phase 4.5.5).
 *
 * Uses a hand-rolled FakeSupervisor — we don't spawn Python here. The supervisor
 * boundary is verified separately by the integration tests in
 * `sidecar-supervisor.test.js` + `sidecar-contacts-cross-validate.test.js`.
 * Here we want fast, deterministic, full-coverage exercise of the adapter's
 * orchestration logic (include flags / dataPaths fallback / progress events /
 * authenticate gating / etc).
 */

import { describe, it, expect, beforeEach } from "vitest";

const {
  SystemDataAdapter,
  SYSTEM_DATA_ADAPTER_NAME,
  SYSTEM_DATA_ADAPTER_VERSION,
  DEFAULT_INCLUDE,
} = require("../../lib/adapters/system-data");
const { assertAdapter } = require("../../lib/adapter-spec");

/**
 * Minimal supervisor stub: pluggable per-method handlers + recorded calls.
 */
class FakeSupervisor {
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.calls = [];
  }

  async invoke(method, params = {}, opts = {}) {
    this.calls.push({ method, params, opts });
    const handler = this.handlers[method];
    if (!handler) throw Object.assign(new Error(`unhandled method: ${method}`), { code: "TEST_NO_HANDLER" });
    return await handler(params, opts);
  }
}

/** Make a chunk-emitting handler whose `onChunk` is fed by `chunks`. */
function chunkingHandler(chunks, result) {
  return async (_params, opts) => {
    for (const c of chunks) {
      if (opts && typeof opts.onChunk === "function") opts.onChunk(c);
    }
    return result;
  };
}

function personPayload(rawContactId, name, phones = []) {
  return {
    id: `person:system:android:${rawContactId}`,
    type: "person",
    subtype: "contact",
    names: [name],
    identifiers: phones.length ? { phone: phones } : undefined,
    ingestedAt: 1_700_000_000_000,
    confidence: 1.0,
    source: {
      adapter: "system-data",
      adapterVersion: "0.1.0",
      originalId: String(rawContactId),
      capturedAt: 1_700_000_000_000,
      capturedBy: "sqlite",
    },
    extra: { starred: false },
  };
}

function callEventPayload(callId, occurredAt = 1_700_000_000_000) {
  return {
    id: `event:system:call:${callId}`,
    type: "event",
    subtype: "call",
    occurredAt,
    actor: "person:self",
    participants: ["person:system:android:1"],
    content: {},
    ingestedAt: occurredAt,
    confidence: 1.0,
    source: {
      adapter: "system-data",
      adapterVersion: "0.1.0",
      originalId: String(callId),
      capturedAt: occurredAt,
      capturedBy: "sqlite",
    },
    extra: { callType: "outgoing", callTypeCode: 2, isRead: true, rawNumber: "13800001111" },
  };
}

function placePayload(name) {
  return {
    id: `place:wifi:${name.toLowerCase()}`,
    type: "place",
    name,
    category: "wifi",
    aliases: [],
    ingestedAt: 1_700_000_000_000,
    confidence: 0.95,
    source: {
      adapter: "system-data",
      adapterVersion: "0.1.0",
      originalId: name,
      capturedAt: 1_700_000_000_000,
      capturedBy: "manual",
    },
    extra: { securityType: "WPA/WPA2", hidden: false, passwordStored: true },
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("SystemDataAdapter contract", () => {
  it("conforms to PersonalDataAdapter contract", () => {
    const adapter = new SystemDataAdapter({ supervisor: new FakeSupervisor() });
    const result = assertAdapter(adapter);
    expect(result).toEqual({ ok: true });
  });

  it("exposes constants and version", () => {
    expect(SYSTEM_DATA_ADAPTER_NAME).toBe("system-data");
    expect(SYSTEM_DATA_ADAPTER_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("declares correct default include flags (SMS opt-out)", () => {
    expect(DEFAULT_INCLUDE).toEqual({
      contacts: true,
      calllog: true,
      sms: false,
      wifi: true,
    });
  });

  it("dataDisclosure is high-sensitivity + legalGate ON", () => {
    const adapter = new SystemDataAdapter({ supervisor: new FakeSupervisor() });
    expect(adapter.dataDisclosure.sensitivity).toBe("high");
    expect(adapter.dataDisclosure.legalGate).toBe(true);
    expect(adapter.dataDisclosure.notice).toMatch(/不向任何服务器上传/);
    expect(adapter.dataDisclosure.fields.some((f) => f.startsWith("sms:"))).toBe(true);
  });
});

describe("SystemDataAdapter.authenticate", () => {
  it("returns offline mode when dataPaths are provided", async () => {
    const sup = new FakeSupervisor({
      "sidecar.ping": async () => ({ version: "0.1.0", pythonVersion: "3.12" }),
    });
    const adapter = new SystemDataAdapter({ supervisor: sup });

    const out = await adapter.authenticate({ dataPaths: { contacts: "/tmp/c.db" } });
    expect(out).toEqual({ ok: true, mode: "offline", sidecarVersion: "0.1.0" });
    expect(sup.calls.map((c) => c.method)).toEqual(["sidecar.ping"]);
  });

  it("fails when sidecar is down", async () => {
    const sup = new FakeSupervisor({
      "sidecar.ping": async () => {
        throw Object.assign(new Error("sidecar gone"), {
          code: "SIDECAR_NOT_RUNNING",
        });
      },
    });
    const adapter = new SystemDataAdapter({ supervisor: sup });
    await expect(adapter.authenticate({ dataPaths: { contacts: "/x" } })).rejects.toThrow();
  });

  it("device mode lists devices and accepts any authorized one", async () => {
    const sup = new FakeSupervisor({
      "sidecar.ping": async () => ({ version: "0.1.0", pythonVersion: "3.12" }),
      "android.list_devices": async () => ({
        devices: [
          { serial: "abc", state: "device", model: "Redmi" },
          { serial: "xyz", state: "unauthorized" },
        ],
      }),
    });
    const adapter = new SystemDataAdapter({ supervisor: sup });

    const out = await adapter.authenticate({});
    expect(out.ok).toBe(true);
    expect(out.mode).toBe("device");
    expect(out.devices).toHaveLength(1);
    expect(out.devices[0].serial).toBe("abc");
  });

  it("device mode fails when no authorized device matches", async () => {
    const sup = new FakeSupervisor({
      "sidecar.ping": async () => ({ version: "0.1.0", pythonVersion: "3.12" }),
      "android.list_devices": async () => ({
        devices: [{ serial: "xyz", state: "unauthorized" }],
      }),
    });
    const adapter = new SystemDataAdapter({ supervisor: sup });
    const out = await adapter.authenticate({});
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/no authorized/i);
  });

  it("device mode targets a specific serial when provided", async () => {
    const sup = new FakeSupervisor({
      "sidecar.ping": async () => ({ version: "0.1.0", pythonVersion: "3.12" }),
      "android.list_devices": async () => ({
        devices: [
          { serial: "abc", state: "device" },
          { serial: "xyz", state: "device" },
        ],
      }),
    });
    const adapter = new SystemDataAdapter({ supervisor: sup });
    const out = await adapter.authenticate({ serial: "xyz" });
    expect(out.ok).toBe(true);
    expect(out.devices).toEqual([{ serial: "xyz", state: "device" }]);
  });
});

describe("SystemDataAdapter.sync via dataPaths (no ADB)", () => {
  let sup;
  let adapter;

  beforeEach(() => {
    sup = new FakeSupervisor({
      "system.parse_contacts": chunkingHandler(
        [{ events: [], persons: [personPayload(1, "妈妈", ["138"])], places: [], items: [] }],
        { status: "ok", totalPersons: 1, watermark: null, stats: { with_phone: 1, with_email: 0, starred: 0 } },
      ),
      "system.parse_calllog": chunkingHandler(
        [{
          events: [callEventPayload(101)],
          persons: [personPayload("unknown:139", "139")],
          places: [],
          items: [],
        }],
        { status: "ok", totalEvents: 1, totalPersonsCreated: 1, watermark: null, stats: {} },
      ),
      "system.parse_wifi": chunkingHandler(
        [{ events: [], persons: [], places: [placePayload("HomeWiFi")], items: [] }],
        { status: "ok", totalPlaces: 1, watermark: null, stats: {} },
      ),
    });
    adapter = new SystemDataAdapter({ supervisor: sup });
  });

  it("yields raws in entityType-tagged envelope shape", async () => {
    const raws = [];
    for await (const raw of adapter.sync({
      dataPaths: {
        contacts: "/tmp/contacts2.db",
        calllog: "/tmp/calls.db",
        wifi: "/tmp/wifi-dir",
      },
    })) {
      raws.push(raw);
    }

    // 1 person (contacts) + 1 event + 1 unknown person (calllog) + 1 place
    expect(raws).toHaveLength(4);
    const types = raws.map((r) => r.entityType);
    expect(types.sort()).toEqual(["event", "person", "person", "place"]);

    // Envelope shape
    for (const r of raws) {
      expect(typeof r.originalId).toBe("string");
      expect(typeof r.capturedAt).toBe("number");
      expect(r.payload && r.payload.type).toBe(r.entityType);
    }
  });

  it("normalize() places one entity into its correct bucket", () => {
    const raw = {
      entityType: "person",
      originalId: "1",
      capturedAt: 1,
      payload: personPayload(1, "X"),
    };
    const batch = adapter.normalize(raw);
    expect(batch).toEqual({
      events: [],
      persons: [raw.payload],
      places: [],
      items: [],
      topics: [],
    });
  });

  it("normalize() returns empty buckets for unknown entityType", () => {
    const batch = adapter.normalize({ entityType: "???", payload: {} });
    expect(batch.events).toEqual([]);
    expect(batch.persons).toEqual([]);
  });

  it("respects include flag — disabling SMS skips parse_sms entirely", async () => {
    // sms enabled in this run; we have no parse_sms handler, so enabling
    // it would crash. Default has it off — sync should succeed.
    const raws = [];
    for await (const raw of adapter.sync({
      dataPaths: {
        contacts: "/tmp/c.db",
        calllog: "/tmp/cl.db",
        wifi: "/tmp/wifi",
      },
    })) {
      raws.push(raw);
    }
    expect(sup.calls.find((c) => c.method === "system.parse_sms")).toBeUndefined();
    expect(raws.length).toBeGreaterThan(0);
  });

  it("explicitly disabling every source yields zero raws and zero sidecar calls", async () => {
    const raws = [];
    for await (const raw of adapter.sync({
      include: { contacts: false, calllog: false, sms: false, wifi: false },
      dataPaths: {},
    })) {
      raws.push(raw);
    }
    expect(raws).toEqual([]);
    expect(sup.calls).toEqual([]);
  });

  it("forwards onProgress events from adapter scope", async () => {
    const events = [];
    const iter = adapter.sync({
      dataPaths: { contacts: "/c", calllog: "/cl", wifi: "/w" },
      onProgress: (msg) => events.push(msg),
    });
    for await (const _ of iter) { /* drain */ }

    const phases = events.map((e) => `${e.source}:${e.phase}`);
    expect(phases).toContain("contacts:parsing");
    expect(phases).toContain("calllog:parsing");
    expect(phases).toContain("wifi:parsing");
  });
});

describe("SystemDataAdapter.sync ADB pull flow", () => {
  it("invokes android.pull_file per enabled source when no dataPaths given", async () => {
    const pullCalls = [];
    const sup = new FakeSupervisor({
      "android.pull_file": async (params) => {
        pullCalls.push(params.remote_path);
        return { remote: params.remote_path, local: `/scratch/${pullCalls.length}.db`, bytes: 100 };
      },
      "system.parse_contacts": chunkingHandler([], { status: "ok", totalPersons: 0, watermark: null, stats: {} }),
      "system.parse_calllog": chunkingHandler([], { status: "ok", totalEvents: 0, totalPersonsCreated: 0, watermark: null, stats: {} }),
      "system.parse_wifi": chunkingHandler([], { status: "ok", totalPlaces: 0, watermark: null, stats: {} }),
    });
    const adapter = new SystemDataAdapter({ supervisor: sup });

    // No scratchDir → adapter defaults to fs.mkdtempSync(os.tmpdir()). Don't pass
    // an absolute "/scratch": it mkdir's at FS root, which is EACCES on Linux CI
    // (passed on Windows where /scratch maps to a creatable drive-relative path).
    const iter = adapter.sync({ serial: "redmi" });
    for await (const _ of iter) { /* drain */ }

    expect(pullCalls).toEqual([
      "/data/data/com.android.providers.contacts/databases/contacts2.db",
      "/data/data/com.android.providers.contacts/databases/calllog.db",
      "/data/misc/wifi/",
    ]);
  });

  it("sdcard mode uses /sdcard/Download/ paths", async () => {
    const pullCalls = [];
    const sup = new FakeSupervisor({
      "android.pull_file": async (params) => {
        pullCalls.push(params.remote_path);
        return { remote: params.remote_path, local: `/scratch/${pullCalls.length}`, bytes: 100 };
      },
      "system.parse_contacts": chunkingHandler([], { status: "ok", totalPersons: 0, watermark: null, stats: {} }),
      "system.parse_calllog": chunkingHandler([], { status: "ok", totalEvents: 0, totalPersonsCreated: 0, watermark: null, stats: {} }),
      "system.parse_wifi": chunkingHandler([], { status: "ok", totalPlaces: 0, watermark: null, stats: {} }),
    });
    const adapter = new SystemDataAdapter({ supervisor: sup });

    const iter = adapter.sync({ serial: "redmi", extractMode: "sdcard" });
    for await (const _ of iter) { /* drain */ }

    for (const p of pullCalls) expect(p).toMatch(/^\/sdcard\/Download\//);
  });

  it("throws when a source is enabled but neither serial nor dataPaths present", async () => {
    const sup = new FakeSupervisor();
    const adapter = new SystemDataAdapter({ supervisor: sup });
    const iter = adapter.sync({ include: { contacts: true, calllog: false, sms: false, wifi: false } });
    await expect((async () => {
      for await (const _ of iter) { /* */ }
    })()).rejects.toThrow(/no serial.*dataPaths/i);
  });

  it("skips wifi gracefully when pull_file fails with EXTRACT_PERMISSION_DENIED", async () => {
    const sup = new FakeSupervisor({
      "android.pull_file": async (params) => {
        if (params.remote_path.startsWith("/data/misc/wifi")) {
          throw Object.assign(new Error("denied"), {
            code: "EXTRACT_PERMISSION_DENIED",
          });
        }
        return { remote: params.remote_path, local: `/scratch/x`, bytes: 1 };
      },
      "system.parse_contacts": chunkingHandler([], { status: "ok", totalPersons: 0, watermark: null, stats: {} }),
      "system.parse_calllog": chunkingHandler([], { status: "ok", totalEvents: 0, totalPersonsCreated: 0, watermark: null, stats: {} }),
    });
    const adapter = new SystemDataAdapter({ supervisor: sup });
    const events = [];
    const iter = adapter.sync({
      serial: "redmi",
      include: { contacts: true, calllog: true, sms: false, wifi: true },
      onProgress: (msg) => events.push(msg),
    });
    for await (const _ of iter) { /* drain */ }

    const wifiSkipped = events.find((e) => e.source === "wifi" && e.phase === "skipped");
    expect(wifiSkipped).toBeDefined();
    expect(wifiSkipped.reason).toBe("EXTRACT_PERMISSION_DENIED");
  });
});

describe("SystemDataAdapter.healthCheck", () => {
  it("returns ok when sidecar pings", async () => {
    const sup = new FakeSupervisor({
      "sidecar.ping": async () => ({ version: "0.1.0" }),
    });
    const adapter = new SystemDataAdapter({ supervisor: sup });
    const r = await adapter.healthCheck();
    expect(r).toEqual({ ok: true, version: "0.1.0" });
  });

  it("returns not-ok with reason when ping fails", async () => {
    const sup = new FakeSupervisor({
      "sidecar.ping": async () => {
        throw Object.assign(new Error("dead"), { code: "TIMEOUT" });
      },
    });
    const adapter = new SystemDataAdapter({ supervisor: sup });
    const r = await adapter.healthCheck();
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/TIMEOUT/);
  });
});
