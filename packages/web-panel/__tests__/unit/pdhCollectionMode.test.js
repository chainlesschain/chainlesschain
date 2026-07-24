import { describe, expect, it } from "vitest";
import catalog from "../../../../docs/internal/pdh-app-data-catalog.json";
import {
  ADB_ONE_CLICK_ADAPTERS,
  collectionActionDescription,
  collectionActionLabel,
  collectionButtonLabel,
  directoryCollectionOptions,
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

  it("routes Tencent Docs exports to a directory picker before its snapshot fallback", () => {
    const tencentDocs = catalog.adapters.find(
      (adapter) => adapter.name === "doc-tencent-docs",
    );

    expect(tencentDocs.capabilities).toEqual(
      expect.arrayContaining(["sync:snapshot", "sync:export-directory"]),
    );
    expect(resolveCollectionMode(tencentDocs)).toBe("directory");
    expect(collectionActionLabel(tencentDocs)).toBe("📁 选择导出目录");
    expect(collectionButtonLabel(tencentDocs)).toBe("📁 采集");
    expect(collectionActionDescription(tencentDocs)).toMatch(/导出目录/u);
  });

  it("routes Firefox profiles to a local configuration-directory picker", () => {
    const firefox = catalog.adapters.find(
      (adapter) => adapter.name === "browser-history-firefox",
    );
    const tencentDocs = catalog.adapters.find(
      (adapter) => adapter.name === "doc-tencent-docs",
    );

    expect(firefox.capabilities).toEqual(
      expect.arrayContaining([
        "sync:firefox-places-sqlite",
        "sync:profile-directory",
      ]),
    );
    expect(resolveCollectionMode(firefox)).toBe("directory");
    expect(collectionActionLabel(firefox)).toBe("📁 选择配置目录");
    expect(collectionButtonLabel(firefox)).toBe("📁 采集");
    expect(collectionActionDescription(firefox)).toMatch(/配置目录/u);
    expect(directoryCollectionOptions(firefox, "C:\\Firefox\\Profile")).toEqual(
      {
        profilePath: "C:\\Firefox\\Profile",
      },
    );
    expect(
      directoryCollectionOptions(firefox, "C:\\Firefox\\Profile", null),
    ).toEqual({
      profilePath: "C:\\Firefox\\Profile",
    });
    expect(
      directoryCollectionOptions(
        tencentDocs,
        "C:\\Tencent Docs",
        " local-user ",
      ),
    ).toEqual({
      exportDir: "C:\\Tencent Docs",
      accountId: "local-user",
    });
    expect(
      directoryCollectionOptions(tencentDocs, "C:\\Tencent Docs", ""),
    ).toBeNull();
  });

  it("routes every desktop browser profile to the directory picker", () => {
    for (const adapterName of [
      "browser-history-chrome",
      "browser-history-edge",
      "browser-history-brave",
      "browser-history-opera",
      "browser-history-vivaldi",
      "browser-history-safari",
    ]) {
      const source = catalog.adapters.find(
        (adapter) => adapter.name === adapterName,
      );
      expect(source, adapterName).toBeDefined();
      expect(source.capabilities).toContain("sync:profile-directory");
      expect(resolveCollectionMode(source)).toBe("directory");
      expect(
        directoryCollectionOptions(source, "C:\\Browser\\Profile"),
      ).toEqual({
        profilePath: "C:\\Browser\\Profile",
      });
    }
  });

  it("routes Tencent Meeting history to the local data-directory picker", () => {
    const source = catalog.adapters.find(
      (adapter) => adapter.name === "meeting-tencent",
    );
    expect(source).toBeDefined();
    expect(source.capabilities).toContain("sync:profile-directory");
    expect(source.capabilities).toContain("sync:meeting-history");
    expect(resolveCollectionMode(source)).toBe("directory");
    expect(directoryCollectionOptions(source, "C:\\Tencent\\WeMeet")).toEqual({
      profilePath: "C:\\Tencent\\WeMeet",
    });
  });

  it("routes JetBrains recent projects to the configuration-directory picker", () => {
    const source = catalog.adapters.find(
      (adapter) => adapter.name === "jetbrains-ide",
    );
    expect(source).toBeDefined();
    expect(source.capabilities).toEqual(
      expect.arrayContaining([
        "sync:jetbrains-recent-projects-xml",
        "sync:profile-directory",
      ]),
    );
    expect(resolveCollectionMode(source)).toBe("directory");
    expect(collectionActionLabel(source)).toBe("📁 选择配置目录");
    expect(
      directoryCollectionOptions(source, "C:\\AppData\\JetBrains"),
    ).toEqual({
      profilePath: "C:\\AppData\\JetBrains",
    });
  });

  it("routes local coding-agent state to the configuration-directory picker", () => {
    for (const adapterName of [
      "vscode",
      "vscodium",
      "cursor",
      "claude-code",
      "hbuilderx",
    ]) {
      const source = catalog.adapters.find(
        (adapter) => adapter.name === adapterName,
      );
      expect(source, adapterName).toBeDefined();
      expect(source.capabilities).toContain("sync:profile-directory");
      expect(resolveCollectionMode(source)).toBe("directory");
      expect(
        directoryCollectionOptions(source, `C:\\Editors\\${adapterName}`),
      ).toEqual({
        profilePath: `C:\\Editors\\${adapterName}`,
      });
    }
  });

  it("routes local-files to a selected scan directory", () => {
    const source = catalog.adapters.find(
      (adapter) => adapter.name === "local-files",
    );
    expect(source).toBeDefined();
    expect(source.capabilities).toEqual(
      expect.arrayContaining([
        "sync:local-file-walk",
        "sync:scan-directory",
        "sync:profile-directory",
      ]),
    );
    expect(resolveCollectionMode(source)).toBe("directory");
    expect(collectionActionLabel(source)).toBe(
      "\ud83d\udcc1 \u9009\u62e9\u626b\u63cf\u76ee\u5f55",
    );
    expect(collectionActionDescription(source)).toMatch(/\u5143\u6570\u636e/u);
    expect(
      directoryCollectionOptions(source, "C:\\Personal\\Documents"),
    ).toEqual({
      roots: ["C:\\Personal\\Documents"],
    });

    expect(
      resolveCollectionMode({
        ...source,
        ready: true,
        rootCount: 6,
      }),
    ).toBe("directory");
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

  it("keeps every catalog snapshot source actionable through a supported collection mode", () => {
    const snapshotAdapters = catalog.adapters.filter((adapter) =>
      adapter.capabilities.includes("sync:snapshot"),
    );
    expect(snapshotAdapters.length).toBeGreaterThan(50);
    for (const adapter of snapshotAdapters) {
      expect(["file", "directory", "cookie", "adb"], adapter.name).toContain(
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
