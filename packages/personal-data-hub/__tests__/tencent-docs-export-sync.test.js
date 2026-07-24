"use strict";

import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  TencentDocsAdapter,
  createExportDocumentId,
  SUPPORTED_EXPORT_EXTENSIONS,
} = require("../lib/adapters/doc-tencent-docs");
const { generateKeyHex } = require("../lib/key-providers");
const { AdapterRegistry } = require("../lib/registry");
const { LocalVault } = require("../lib/vault");

let tmpDir;
let vault;

afterEach(() => {
  if (vault) {
    try {
      vault.close();
    } catch {
      // Best-effort test cleanup.
    }
    vault = null;
  }
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  tmpDir = null;
});

async function collect(iterable) {
  const records = [];
  for await (const record of iterable) records.push(record);
  return records;
}

function createExportTree(prefix = "pdh-tencent-export-") {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const root = path.join(tmpDir, "private-export-root");
  const nested = path.join(root, "项目资料");
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(root, "预算.xlsx"), "sheet");
  fs.writeFileSync(path.join(nested, "周报.docx"), "document");
  fs.writeFileSync(path.join(nested, "草图.png"), "image");
  fs.writeFileSync(path.join(root, "ignore.bin"), "unsupported");
  return root;
}

describe("Tencent Docs local export collection", () => {
  it("recursively discovers supported exports with stable privacy-safe records", async () => {
    const root = createExportTree();
    const adapter = new TencentDocsAdapter();
    let completions = 0;

    const records = await collect(
      adapter.sync({
        exportDir: root,
        accountId: "Tencent-Account",
        markWatermarkComplete: () => {
          completions += 1;
        },
      }),
    );

    expect(records).toHaveLength(3);
    expect(records.map((record) => record.payload.record.title)).toEqual([
      "预算.xlsx",
      "周报.docx",
      "草图.png",
    ]);
    expect(records[0]).toMatchObject({
      adapter: "doc-tencent-docs",
      kind: "document",
      originalId: `tencent-docs:document:${createExportDocumentId("预算.xlsx")}`,
      payload: {
        record: {
          docType: "sheet",
          url: null,
          extra: {
            relativePath: "预算.xlsx",
            sourceFormat: "xlsx",
            sizeBytes: 5,
            exportedFile: true,
          },
        },
      },
    });
    expect(records[1].payload.record.extra.relativePath).toBe(
      "项目资料/周报.docx",
    );
    expect(records[2].payload.record.docType).toBe("image");
    expect(completions).toBe(1);

    const batch = adapter.normalize(records[0]);
    expect(batch.events[0].source.capturedBy).toBe("export");
    expect(batch.items[0].source.capturedBy).toBe("export");
    expect(batch.items[0].extra.relativePath).toBe("预算.xlsx");
    expect(JSON.stringify({ records, batch })).not.toContain(root);
  });

  it("supports shallow scans and recognizes documented export formats", async () => {
    const root = createExportTree();
    const adapter = new TencentDocsAdapter();
    const records = await collect(
      adapter.sync({
        exportDir: root,
        accountId: "local-account",
        recursive: false,
      }),
    );

    expect(records.map((record) => record.payload.record.title)).toEqual([
      "预算.xlsx",
    ]);
    expect(SUPPORTED_EXPORT_EXTENSIONS).toEqual(
      expect.arrayContaining([
        ".docx",
        ".xlsx",
        ".pptx",
        ".pdf",
        ".xmind",
        ".pos",
        ".png",
      ]),
    );
  });

  it("rejects directory and file targets that change after discovery", async () => {
    const root = path.resolve(os.tmpdir(), "pdh-tencent-mocked-export");
    const swappedDirectory = path.join(root, "swapped");
    const swappedFile = path.join(root, "swapped-file.pdf");
    const outsideDirectory = path.resolve(
      os.tmpdir(),
      "pdh-tencent-mocked-outside",
    );
    const outsideFile = path.join(outsideDirectory, "outside-secret.pdf");
    const realpathChecks = new Map();
    let swappedDirectoryReads = 0;
    let completions = 0;

    const createStat = (kind, ino, size = 0) => ({
      dev: 1,
      ino,
      size,
      birthtimeMs: 1_700_000_000_000,
      mtimeMs: 1_700_000_000_000,
      ctimeMs: 1_700_000_000_000,
      isSymbolicLink: () => false,
      isDirectory: () => kind === "directory",
      isFile: () => kind === "file",
    });
    const rootStat = createStat("directory", 1);
    const directoryStat = createStat("directory", 2);
    const fileStat = createStat("file", 3, 7);
    const createDirent = (name, kind) => ({
      name,
      isSymbolicLink: () => false,
      isDirectory: () => kind === "directory",
      isFile: () => kind === "file",
    });
    const normalize = (value) => path.resolve(value).toLowerCase();
    const rootKey = normalize(root);
    const directoryKey = normalize(swappedDirectory);
    const fileKey = normalize(swappedFile);

    const adapter = new TencentDocsAdapter();
    adapter._deps.fs = {
      constants: { R_OK: 4 },
      accessSync: () => {},
      lstatSync: (candidate) => {
        const key = normalize(candidate);
        if (key === rootKey) return rootStat;
        if (key === directoryKey) return directoryStat;
        if (key === fileKey) return fileStat;
        throw new Error("unexpected path");
      },
      realpathSync: (candidate) => {
        const key = normalize(candidate);
        if (key === rootKey) return root;
        if (key !== directoryKey && key !== fileKey) {
          throw new Error("unexpected path");
        }
        const count = (realpathChecks.get(key) || 0) + 1;
        realpathChecks.set(key, count);
        if (count <= 2) return candidate;
        return key === directoryKey ? outsideDirectory : outsideFile;
      },
      readdirSync: (candidate) => {
        const key = normalize(candidate);
        if (key === rootKey) {
          return [
            createDirent("swapped", "directory"),
            createDirent("swapped-file.pdf", "file"),
          ];
        }
        if (key === directoryKey) {
          swappedDirectoryReads += 1;
          return [createDirent("outside-secret.pdf", "file")];
        }
        throw new Error("unexpected directory");
      },
    };

    const records = await collect(
      adapter.sync({
        exportDir: root,
        accountId: "local-account",
        markWatermarkComplete: () => {
          completions += 1;
        },
      }),
    );

    expect(records).toEqual([]);
    expect(swappedDirectoryReads).toBe(0);
    expect(completions).toBe(0);
  });

  it("only commits a timestamp watermark after a complete bounded scan", async () => {
    const root = createExportTree();
    const adapter = new TencentDocsAdapter();

    let sinceComplete = 0;
    const sinceRecords = await collect(
      adapter.sync({
        exportDir: root,
        accountId: "local-account",
        sinceWatermark: Date.now() + 60_000,
        markWatermarkComplete: () => {
          sinceComplete += 1;
        },
      }),
    );
    expect(sinceRecords).toEqual([]);
    expect(sinceComplete).toBe(1);

    let maxFilesComplete = 0;
    const bounded = await collect(
      adapter.sync({
        exportDir: root,
        accountId: "local-account",
        maxFiles: 1,
        markWatermarkComplete: () => {
          maxFilesComplete += 1;
        },
      }),
    );
    expect(bounded).toEqual([]);
    expect(maxFilesComplete).toBe(0);

    let limitComplete = 0;
    const limited = await collect(
      adapter.sync({
        exportDir: root,
        accountId: "local-account",
        limit: 1,
        markWatermarkComplete: () => {
          limitComplete += 1;
        },
      }),
    );
    expect(limited).toHaveLength(1);
    expect(limitComplete).toBe(0);

    await expect(
      collect(
        adapter.sync({
          exportDir: root,
          accountId: "local-account",
          maxFiles: 0,
        }),
      ),
    ).rejects.toMatchObject({ code: "TENCENT_DOCS_INVALID_MAX_FILES" });
    await expect(
      collect(
        adapter.sync({
          exportDir: root,
          accountId: "local-account",
          maxFiles: "1file",
        }),
      ),
    ).rejects.toMatchObject({ code: "TENCENT_DOCS_INVALID_MAX_FILES" });
  });

  it("isolates export roots and accounts without persisting either identity", async () => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "pdh-tencent-private-runtime-"),
    );
    const firstRoot = path.join(tmpDir, "alpha-private-export");
    const secondRoot = path.join(tmpDir, "beta-private-export");
    fs.mkdirSync(firstRoot);
    fs.mkdirSync(secondRoot);
    fs.writeFileSync(path.join(firstRoot, "Alpha.docx"), "alpha");
    fs.writeFileSync(path.join(secondRoot, "Beta.pdf"), "beta");

    vault = new LocalVault({
      path: path.join(tmpDir, "vault.db"),
      key: generateKeyHex(),
    });
    vault.open();

    const adapter = new TencentDocsAdapter();
    const registry = new AdapterRegistry({ vault, sleep: async () => {} });
    registry.register(adapter);

    const first = await registry.syncAdapter("doc-tencent-docs", {
      exportDir: firstRoot,
      accountId: "Tencent-Account-Alpha",
    });
    fs.writeFileSync(path.join(firstRoot, "0-budget.bin"), "budget");
    fs.writeFileSync(path.join(firstRoot, "Later.pdf"), "later");
    const bounded = await registry.syncAdapter("doc-tencent-docs", {
      exportDir: firstRoot,
      accountId: "Tencent-Account-Alpha",
      maxFiles: 1,
    });
    const second = await registry.syncAdapter("doc-tencent-docs", {
      exportDir: secondRoot,
      accountId: "Tencent-Account-Beta",
    });

    for (const report of [first, second]) {
      expect(report).toMatchObject({
        status: "ok",
        rawCount: 1,
        checkpointCommitted: true,
        sourceRequestCount: 0,
      });
      expect(report.scope).toMatch(/^account:doc-tencent-docs:[a-f0-9]{32}$/u);
      expect(
        vault.queryRawEvents({
          adapter: "doc-tencent-docs",
          scope: report.scope,
        }),
      ).toHaveLength(1);
      expect(vault.getWatermark("doc-tencent-docs", report.scope)).toBeTruthy();
    }
    expect(first.scope).not.toBe(second.scope);
    expect(bounded).toMatchObject({
      status: "ok",
      rawCount: 0,
      watermark: first.watermark,
      watermarkDeferred: true,
      checkpointCommitted: true,
    });
    expect(vault.getWatermark("doc-tencent-docs", first.scope).watermark).toBe(
      first.watermark,
    );

    const recursiveScope = registry._resolveScope(adapter, {
      exportDir: firstRoot,
      accountId: "Tencent-Account-Alpha",
    });
    const shallowScope = registry._resolveScope(adapter, {
      exportDir: firstRoot,
      accountId: "Tencent-Account-Alpha",
      recursive: false,
    });
    expect(recursiveScope).not.toBe(shallowScope);

    const persisted = JSON.stringify({
      first,
      second,
      raw: vault.queryRawEvents({ adapter: "doc-tencent-docs" }),
      audit: vault.queryAudit({ limit: 100 }),
    }).toLowerCase();
    for (const privateValue of [
      "tencent-account-alpha",
      "tencent-account-beta",
      "alpha-private-export",
      "beta-private-export",
    ]) {
      expect(persisted).not.toContain(privateValue);
    }
  });
});
