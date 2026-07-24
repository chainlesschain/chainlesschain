import { describe, expect, it } from "vitest";
import catalog from "../../../../docs/internal/pdh-app-data-catalog.json";
import {
  ADB_ONE_CLICK_ADAPTERS,
  collectionActionDescription,
  collectionActionLabel,
  collectionButtonLabel,
  resolveCollectionMode,
} from "../../src/utils/pdhCollectionMode.js";

describe("pdhCollectionMode", () => {
  it("reuses an already configured source without prompting again", () => {
    expect(
      resolveCollectionMode({
        name: "weread",
        ready: true,
        capabilities: ["sync:cookie", "sync:snapshot"],
      }),
    ).toBe("sync");
  });

  it("routes every generic cookie adapter from catalog to the login action", () => {
    const cookieAdapters = catalog.adapters.filter((adapter) =>
      adapter.capabilities.includes("sync:cookie"),
    );
    expect(cookieAdapters.map((adapter) => adapter.name).sort()).toEqual([
      "edu-huawei-learning",
      "edu-zuoyebang",
      "finance-alipay",
      "game-genshin",
      "netease-music",
      "weread",
    ]);
    for (const adapter of cookieAdapters) {
      expect(resolveCollectionMode(adapter), adapter.name).toBe("cookie");
    }
  });

  it("routes snapshot, SQLite, and explicit file imports to a file picker", () => {
    expect(
      resolveCollectionMode({
        name: "bank-icbc",
        capabilities: ["sync:snapshot"],
      }),
    ).toBe("file");
    expect(
      resolveCollectionMode({
        name: "messaging-telegram",
        capabilities: ["sync:sqlite"],
      }),
    ).toBe("file");
    expect(
      resolveCollectionMode({
        name: "apple-health",
        capabilities: ["sync:file-import"],
      }),
    ).toBe("file");
    const alipayBill = catalog.adapters.find(
      (adapter) => adapter.name === "alipay-bill",
    );
    expect(resolveCollectionMode(alipayBill)).toBe("file");
  });

  it("uses direct ADB sync for connected Android system data and snapshot import otherwise", () => {
    const systemData = catalog.adapters.find(
      (adapter) => adapter.name === "system-data-android",
    );
    expect(systemData.extractMode).toBe("device-pull");
    expect(systemData.capabilities).toEqual(
      expect.arrayContaining(["sync:snapshot", "sync:adb"]),
    );
    expect(
      resolveCollectionMode({
        ...systemData,
        ready: true,
        mode: "adb-oneclick",
      }),
    ).toBe("sync");
    expect(
      resolveCollectionMode({
        ...systemData,
        ready: false,
        reason: "ADB_DEVICE_NEEDED",
      }),
    ).toBe("file");
  });

  it("routes all six social one-click sources through their dedicated ADB action", () => {
    expect([...ADB_ONE_CLICK_ADAPTERS].sort()).toEqual([
      "social-bilibili",
      "social-douyin",
      "social-kuaishou",
      "social-toutiao",
      "social-weibo",
      "social-xiaohongshu",
    ]);
    for (const name of ADB_ONE_CLICK_ADAPTERS) {
      expect(
        resolveCollectionMode({ name, ready: true, mode: "adb-oneclick" }),
      ).toBe("adb");
      expect(
        resolveCollectionMode({
          name,
          ready: false,
          reason: "ADB_DEVICE_NEEDED",
        }),
      ).toBe("adb");
    }
  });

  it("does not mistake a custom Cookie API seam for generic Cookie authentication", () => {
    expect(
      resolveCollectionMode({
        name: "custom-api",
        capabilities: ["sync:custom-cookie-api"],
        ready: false,
      }),
    ).toBe("setup");
  });

  it("opens setup guidance when a file alone cannot satisfy key-provider requirements", () => {
    expect(
      resolveCollectionMode({
        name: "wechat",
        capabilities: ["sync:sqlite"],
        ready: false,
        reason: "NO_KEY_PROVIDER",
      }),
    ).toBe("setup");
  });

  it("falls back safely for an older readiness payload", () => {
    expect(
      resolveCollectionMode({ name: "host-source", category: "local" }),
    ).toBe("sync");
    expect(
      resolveCollectionMode({
        name: "missing-host-source",
        category: "local",
        ready: false,
      }),
    ).toBe("setup");
    expect(
      resolveCollectionMode({ name: "unknown-source", category: "platform" }),
    ).toBe("setup");
    expect(resolveCollectionMode(null)).toBe("setup");
  });

  it("keeps every catalog snapshot source actionable as file, Cookie, or ADB", () => {
    const snapshotAdapters = catalog.adapters.filter((adapter) =>
      adapter.capabilities.includes("sync:snapshot"),
    );
    expect(snapshotAdapters.length).toBeGreaterThan(50);
    for (const adapter of snapshotAdapters) {
      expect(["file", "cookie", "adb"], adapter.name).toContain(
        resolveCollectionMode(adapter),
      );
    }
  });

  it("publishes an explicit extract mode for every catalog adapter", () => {
    for (const adapter of catalog.adapters) {
      expect(["file-import", "device-pull", "web-api"], adapter.name).toContain(
        adapter.extractMode,
      );
    }
  });

  it("provides consistent primary-action copy", () => {
    const fileSource = { capabilities: ["sync:snapshot"] };
    expect(collectionActionLabel(fileSource)).toBe("📂 选择文件采集");
    expect(collectionButtonLabel(fileSource)).toBe("📂 采集");
    expect(collectionActionDescription(fileSource)).toMatch(/文件/);
    expect(collectionActionLabel({ name: "unknown" })).toBe("查看采集步骤");
  });
});
