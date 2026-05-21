"use strict";

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const {
  SystemDataAndroidAdapter,
  SYSTEM_DATA_ANDROID_NAME,
  SYSTEM_DATA_ANDROID_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
} = require("../../lib/adapters/system-data-android");
const { assertAdapter } = require("../../lib/adapter-spec");
const {
  ENTITY_TYPES,
  PERSON_SUBTYPES,
  ITEM_SUBTYPES,
  CAPTURED_BY,
} = require("../../lib/constants");
const { validatePerson, validateItem } = require("../../lib/schemas");

let tmpDir;
let snapshotPath;

function writeSnapshot(obj) {
  writeFileSync(snapshotPath, JSON.stringify(obj), "utf-8");
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sda-test-"));
  snapshotPath = join(tmpDir, "snapshot.json");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("SystemDataAndroidAdapter — contract", () => {
  it("conforms to PersonalDataAdapter contract", () => {
    const adapter = new SystemDataAndroidAdapter();
    const r = assertAdapter(adapter);
    expect(r).toEqual({ ok: true });
  });

  it("exposes stable name + version + capabilities", () => {
    const adapter = new SystemDataAndroidAdapter();
    expect(adapter.name).toBe(SYSTEM_DATA_ANDROID_NAME);
    expect(adapter.version).toBe(SYSTEM_DATA_ANDROID_VERSION);
    expect(adapter.extractMode).toBe("device-pull");
    expect(adapter.dataDisclosure.sensitivity).toBe("medium");
    expect(adapter.dataDisclosure.legalGate).toBe(false);
  });
});

describe("SystemDataAndroidAdapter.authenticate", () => {
  it("fails when inputPath missing", async () => {
    const adapter = new SystemDataAndroidAdapter();
    const r = await adapter.authenticate({});
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("INPUT_PATH_REQUIRED");
  });

  it("fails when inputPath does not exist", async () => {
    const adapter = new SystemDataAndroidAdapter();
    const r = await adapter.authenticate({ inputPath: join(tmpDir, "does-not-exist.json") });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("INPUT_PATH_UNREADABLE");
  });

  it("succeeds when inputPath is readable", async () => {
    writeSnapshot({ schemaVersion: SNAPSHOT_SCHEMA_VERSION, contacts: [], apps: [] });
    const adapter = new SystemDataAndroidAdapter();
    const r = await adapter.authenticate({ inputPath: snapshotPath });
    expect(r).toEqual({ ok: true, mode: "snapshot-file" });
  });
});

describe("SystemDataAndroidAdapter.sync + normalize", () => {
  it("rejects mismatched snapshot schemaVersion", async () => {
    writeSnapshot({ schemaVersion: 99, contacts: [], apps: [] });
    const adapter = new SystemDataAndroidAdapter();
    await expect(async () => {
      // eslint-disable-next-line no-unused-vars
      for await (const _ of adapter.sync({ inputPath: snapshotPath })) {
        // drain
      }
    }).rejects.toThrow(/schemaVersion mismatch/);
  });

  it("yields contact + app raws and normalizes each into a valid entity", async () => {
    writeSnapshot({
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      snapshottedAt: 1_700_000_000_000,
      contacts: [
        {
          lookupKey: "0r1-3A2B",
          displayName: "妈妈",
          phones: ["+8613800138000"],
          emails: [],
          starred: true,
          organization: "家庭",
        },
      ],
      apps: [
        {
          packageName: "com.tencent.mm",
          label: "微信",
          versionName: "8.0.45",
          versionCode: 2200,
          firstInstallTime: 1_650_000_000_000,
          lastUpdateTime: 1_700_000_000_000,
          isSystem: false,
        },
      ],
    });
    const adapter = new SystemDataAndroidAdapter();

    const persons = [];
    const items = [];
    for await (const raw of adapter.sync({ inputPath: snapshotPath })) {
      const batch = adapter.normalize(raw);
      persons.push(...batch.persons);
      items.push(...batch.items);
    }

    expect(persons).toHaveLength(1);
    const p = persons[0];
    expect(p.id).toBe("person-android-0r1-3A2B");
    expect(p.type).toBe(ENTITY_TYPES.PERSON);
    expect(p.subtype).toBe(PERSON_SUBTYPES.CONTACT);
    expect(p.names).toEqual(["妈妈"]);
    expect(p.identifiers).toEqual({ phone: ["+8613800138000"] });
    expect(p.extra).toEqual({ starred: true });
    expect(p.relation).toBe("家庭");
    expect(p.source.adapter).toBe(SYSTEM_DATA_ANDROID_NAME);
    expect(p.source.capturedBy).toBe(CAPTURED_BY.API);
    expect(p.source.capturedAt).toBe(1_700_000_000_000);
    const pv = validatePerson(p);
    expect(pv).toEqual({ valid: true, errors: [] });

    expect(items).toHaveLength(1);
    const i = items[0];
    expect(i.id).toBe("item-android-app-com.tencent.mm");
    expect(i.type).toBe(ENTITY_TYPES.ITEM);
    expect(i.subtype).toBe(ITEM_SUBTYPES.OTHER);
    expect(i.name).toBe("微信");
    expect(i.category).toBe("user-app");
    expect(i.extra.kind).toBe("installed_app");
    expect(i.extra.packageName).toBe("com.tencent.mm");
    expect(i.extra.versionCode).toBe(2200);
    expect(i.extra.firstInstallTime).toBe(1_650_000_000_000);
    expect(i.extra.isSystem).toBe(false);
    const iv = validateItem(i);
    expect(iv).toEqual({ valid: true, errors: [] });
  });

  it("dedupes by stable lookupKey — same key across syncs returns same id", async () => {
    writeSnapshot({
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      contacts: [{ lookupKey: "abc", displayName: "Alice", phones: [], emails: [] }],
      apps: [],
    });
    const adapter = new SystemDataAndroidAdapter();
    const ids = [];
    for (let pass = 0; pass < 2; pass++) {
      for await (const raw of adapter.sync({ inputPath: snapshotPath })) {
        const batch = adapter.normalize(raw);
        if (batch.persons[0]) ids.push(batch.persons[0].id);
      }
    }
    expect(ids).toEqual(["person-android-abc", "person-android-abc"]);
  });

  it("falls back to displayName when lookupKey missing", async () => {
    writeSnapshot({
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      contacts: [{ displayName: "Bob", phones: [], emails: [] }],
      apps: [],
    });
    const adapter = new SystemDataAndroidAdapter();
    let id;
    for await (const raw of adapter.sync({ inputPath: snapshotPath })) {
      id = adapter.normalize(raw).persons[0]?.id;
    }
    expect(id).toBe("person-android-Bob");
  });

  it("honors include filter — apps only", async () => {
    writeSnapshot({
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      contacts: [{ lookupKey: "k", displayName: "X", phones: [], emails: [] }],
      apps: [
        { packageName: "com.x", label: "X", versionName: "1", versionCode: 1, isSystem: false },
      ],
    });
    const adapter = new SystemDataAndroidAdapter();
    const kinds = [];
    for await (const raw of adapter.sync({
      inputPath: snapshotPath,
      include: { contacts: false, apps: true },
    })) {
      kinds.push(raw.kind);
    }
    expect(kinds).toEqual(["app"]);
  });

  it("honors limit option", async () => {
    writeSnapshot({
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      contacts: [
        { lookupKey: "a", displayName: "A", phones: [], emails: [] },
        { lookupKey: "b", displayName: "B", phones: [], emails: [] },
        { lookupKey: "c", displayName: "C", phones: [], emails: [] },
      ],
      apps: [],
    });
    const adapter = new SystemDataAndroidAdapter();
    let count = 0;
    for await (const _raw of adapter.sync({ inputPath: snapshotPath, limit: 2 })) {
      count += 1;
    }
    expect(count).toBe(2);
  });
});

describe("SystemDataAndroidAdapter — degenerate snapshots", () => {
  it("anonymous contact gets placeholder name", () => {
    const adapter = new SystemDataAndroidAdapter();
    const batch = adapter.normalize({
      kind: "contact",
      capturedAt: 1_700_000_000_000,
      payload: { lookupKey: "x" },
    });
    expect(batch.persons[0].names).toEqual(["(无名联系人)"]);
  });

  it("system app gets category 'system-app'", () => {
    const adapter = new SystemDataAndroidAdapter();
    const batch = adapter.normalize({
      kind: "app",
      capturedAt: 1_700_000_000_000,
      payload: { packageName: "com.android.settings", label: "Settings", isSystem: true },
    });
    expect(batch.items[0].category).toBe("system-app");
    expect(batch.items[0].extra.isSystem).toBe(true);
  });

  it("throws on unknown raw.kind", () => {
    const adapter = new SystemDataAndroidAdapter();
    expect(() =>
      adapter.normalize({ kind: "mystery", capturedAt: 1, payload: {} })
    ).toThrow(/unknown raw.kind/);
  });
});

// ─── Bridge-direct mode (A8 follow-up) ────────────────────────────────
//
// When `cc-android-bridge` is loaded inside in-APK cc, the adapter can pull
// directly from ContentResolver / PackageManager instead of waiting for the
// UI to write a snapshot file. These tests inject a mock bridge to exercise
// the new path without a real device.

describe("SystemDataAndroidAdapter — bridge-direct sync", () => {
  function makeBridge({ contacts = [], apps = [], throws = null } = {}) {
    return {
      caps: () => ({ available: true, reason: "test" }),
      invoke: async (method) => {
        if (throws) throw throws;
        if (method === "contacts.query") return { contacts };
        if (method === "app.list") return { apps };
        throw new Error("unexpected method " + method);
      },
    };
  }

  it("useBridge=true pulls contacts and apps via bridge.invoke", async () => {
    const adapter = new SystemDataAndroidAdapter();
    const bridge = makeBridge({
      contacts: [
        { lookupKey: "ck-1", displayName: "妈妈", phones: ["13800000001"] },
        { lookupKey: "ck-2", displayName: "同事" },
      ],
      apps: [
        { packageName: "com.tencent.mm", label: "微信", versionName: "8.0", isSystem: false },
      ],
    });
    adapter._deps.bridgeProvider = () => bridge;

    const out = [];
    for await (const r of adapter.sync({ useBridge: true })) out.push(r);
    expect(out).toHaveLength(3);
    expect(out[0].kind).toBe("contact");
    expect(out[0].payload.displayName).toBe("妈妈");
    expect(out[2].kind).toBe("app");
    expect(out[2].payload.packageName).toBe("com.tencent.mm");
  });

  it("auto-engages bridge when inputPath omitted AND bridge.available", async () => {
    const adapter = new SystemDataAndroidAdapter();
    adapter._deps.bridgeProvider = () => makeBridge({
      contacts: [{ lookupKey: "auto", displayName: "Auto" }],
    });
    const out = [];
    for await (const r of adapter.sync({})) out.push(r);
    expect(out).toHaveLength(1);
    expect(out[0].payload.displayName).toBe("Auto");
  });

  it("respects include.contacts=false in bridge mode", async () => {
    const adapter = new SystemDataAndroidAdapter();
    adapter._deps.bridgeProvider = () => makeBridge({
      contacts: [{ displayName: "should be skipped" }],
      apps: [{ packageName: "com.kept" }],
    });
    const out = [];
    for await (const r of adapter.sync({ useBridge: true, include: { contacts: false } })) {
      out.push(r);
    }
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("app");
  });

  it("limit caps bridge yields", async () => {
    const adapter = new SystemDataAndroidAdapter();
    const many = Array.from({ length: 10 }, (_, i) => ({ displayName: `c${i}` }));
    adapter._deps.bridgeProvider = () => makeBridge({ contacts: many });
    const out = [];
    for await (const r of adapter.sync({ useBridge: true, limit: 3 })) out.push(r);
    expect(out).toHaveLength(3);
  });

  it("throws when useBridge=true but bridge missing", async () => {
    const adapter = new SystemDataAndroidAdapter();
    adapter._deps.bridgeProvider = () => null;
    const it = adapter.sync({ useBridge: true });
    await expect(it.next()).rejects.toThrow(/cc-android-bridge is not loaded/);
  });

  it("propagates bridge.invoke errors", async () => {
    const adapter = new SystemDataAndroidAdapter();
    adapter._deps.bridgeProvider = () =>
      makeBridge({ throws: new Error("ANDROID_BRIDGE_NOT_AVAILABLE: not-on-android") });
    const it = adapter.sync({ useBridge: true });
    await expect(it.next()).rejects.toThrow(/ANDROID_BRIDGE_NOT_AVAILABLE/);
  });

  it("accepts bare array response from bridge (contacts as Array)", async () => {
    const adapter = new SystemDataAndroidAdapter();
    adapter._deps.bridgeProvider = () => ({
      caps: () => ({ available: true }),
      invoke: async (method) => {
        if (method === "contacts.query") return [{ displayName: "Bare" }];
        if (method === "app.list") return [];
        return [];
      },
    });
    const out = [];
    for await (const r of adapter.sync({ useBridge: true })) out.push(r);
    expect(out).toHaveLength(1);
    expect(out[0].payload.displayName).toBe("Bare");
  });

  it("inputPath snapshot mode still works when bridgeProvider returns null", async () => {
    writeSnapshot({
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      snapshottedAt: 1_700_000_000_000,
      contacts: [{ lookupKey: "snap", displayName: "From Snapshot" }],
      apps: [],
    });
    const adapter = new SystemDataAndroidAdapter();
    const out = [];
    for await (const r of adapter.sync({ inputPath: snapshotPath })) out.push(r);
    expect(out).toHaveLength(1);
    expect(out[0].payload.displayName).toBe("From Snapshot");
  });
});
