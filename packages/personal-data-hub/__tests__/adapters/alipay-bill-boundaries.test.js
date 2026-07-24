"use strict";

import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const AdmZip = require("adm-zip");
const iconv = require("iconv-lite");
const {
  AlipayBillAdapter,
} = require("../../lib/adapters/alipay-bill/alipay-bill-adapter");
const {
  HARD_MAX_ARCHIVE_BYTES,
  HARD_MAX_CSV_BYTES,
  HARD_MAX_ZIP_ENTRIES,
  extractCsvFromZip,
  resolveAlipayImportLimits,
} = require("../../lib/adapters/alipay-bill/zip-decryptor");
const { HARD_MAX_SNAPSHOT_BYTES } = require("../../lib/snapshot-file");

const tempRoots = [];

function tempFile(filename, content) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-alipay-boundary-"));
  tempRoots.push(root);
  const file = path.join(root, filename);
  fs.writeFileSync(file, content);
  return file;
}

function archiveEntry(entryName, size, opts = {}) {
  return {
    entryName,
    isDirectory: opts.isDirectory === true,
    header: { size },
  };
}

function fakeAdmZip(entries, extracted = Buffer.from("csv")) {
  return class FakeAdmZip {
    constructor(input) {
      if (!Buffer.isBuffer(input)) {
        throw new Error("expected archive Buffer");
      }
    }

    getEntries() {
      return entries;
    }

    readFile() {
      return extracted;
    }
  };
}

function classicArchiveBuffer(entryCount = 1) {
  const archive = new AdmZip();
  for (let index = 0; index < entryCount; index += 1) {
    archive.addFile(`placeholder-${index}.txt`, Buffer.from("x"));
  }
  return archive.toBuffer();
}

function collectStrings(value, output = []) {
  if (typeof value === "string") {
    output.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, output);
  }
  return output;
}

async function collect(iterable) {
  const values = [];
  for await (const value of iterable) values.push(value);
  return values;
}

async function captureError(run) {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("expected operation to fail");
}

const LEGACY_ALIPAY_CSV = [
  "支付宝交易记录明细查询",
  "账号:[legacy@example.com]",
  "起始日期:[2024-04-01 00:00:00]    终止日期:[2024-05-01 00:00:00]",
  "----------------交易记录明细列表----------------",
  [
    "交易号",
    "商家订单号",
    "交易创建时间",
    "付款时间",
    "最近修改时间",
    "交易来源地",
    "类型",
    "交易对方",
    "商品名称",
    "金额（元）",
    "收/支",
    "交易状态",
    "服务费（元）",
    "成功退款（元）",
    "备注",
    "资金状态",
  ].join(","),
  [
    "GBK-TX-1",
    "",
    "2024-04-01 09:23:11",
    "2024-04-01 09:23:13",
    "2024-04-01 09:23:13",
    "支付宝网站",
    "即时到账交易",
    "美团",
    "美团外卖订单",
    "38.50",
    "支出",
    "交易成功",
    "0.00",
    "0.00",
    "旧版账单",
    "已支出",
  ].join(","),
  "----------------交易记录明细列表结束----------------",
].join("\r\n");

afterEach(() => {
  while (tempRoots.length > 0) {
    fs.rmSync(tempRoots.pop(), { recursive: true, force: true });
  }
});

describe("Alipay bill bounded file boundary", () => {
  it("rejects an oversized direct CSV in authenticate and sync", async () => {
    const csvPath = tempFile("bill.csv", Buffer.alloc(32, 0x61));
    const adapter = new AlipayBillAdapter({
      account: { email: "u@example.com" },
    });

    const readiness = await adapter.authenticate({
      csvPath,
      maxCsvBytes: 16,
    });
    expect(readiness).toMatchObject({
      ok: false,
      reason: "SNAPSHOT_TOO_LARGE",
    });
    expect(readiness.message).not.toContain(csvPath);

    const error = await captureError(() =>
      collect(adapter.sync({ csvPath, maxCsvBytes: 16 })),
    );
    expect(error).toMatchObject({ code: "SNAPSHOT_TOO_LARGE" });
    expect(error.message).not.toContain(csvPath);
  });

  it("rejects a direct CSV symbolic link without disclosing its path", async () => {
    const selectedPath = "C:\\Users\\private\\alipay-bill.csv";
    const symlinkFs = Object.create(fs);
    symlinkFs.lstatSync = () => ({ isSymbolicLink: () => true });
    const adapter = new AlipayBillAdapter({
      account: { email: "u@example.com" },
      fsImpl: symlinkFs,
    });

    const readiness = await adapter.authenticate({ csvPath: selectedPath });
    expect(readiness).toMatchObject({
      ok: false,
      reason: "SNAPSHOT_SYMBOLIC_LINK",
    });
    expect(readiness.message).not.toContain(selectedPath);

    const error = await captureError(() =>
      collect(adapter.sync({ csvPath: selectedPath })),
    );
    expect(error).toMatchObject({ code: "SNAPSHOT_SYMBOLIC_LINK" });
    expect(error.message).not.toContain(selectedPath);
  });

  it("passes all configured limits through sync to the ZIP extractor", async () => {
    let observed;
    const adapter = new AlipayBillAdapter({
      account: { email: "u@example.com" },
      csvParser: () => ({ encoding: "utf-8", header: {}, rows: [] }),
      zipExtractor: async (_zipPath, opts) => {
        observed = opts;
        return { buffer: Buffer.from("x"), filename: "bill.csv" };
      },
    });

    await collect(
      adapter.sync({
        zipPath: "C:\\selected\\bill.zip",
        maxSnapshotBytes: 700,
        maxArchiveBytes: 600,
        maxCsvBytes: 500,
        maxZipEntries: 5,
      }),
    );

    expect(observed).toMatchObject({
      maxSnapshotBytes: 700,
      maxArchiveBytes: 600,
      maxCsvBytes: 500,
      maxZipEntries: 5,
    });
  });

  it("does not retain selected paths or ZIP entry names in raw/progress data", async () => {
    const csvPath = tempFile("private-direct.csv", Buffer.from("direct"));
    const zipPath = "C:\\Users\\private\\支付宝账单.zip";
    const privateEntryName = "account-13800001111.csv";
    const progress = [];
    const adapter = new AlipayBillAdapter({
      account: { email: "u@example.com" },
      csvParser: () => ({
        encoding: "gbk",
        header: {},
        rows: [{ txId: "privacy-1" }],
      }),
      zipExtractor: async () => ({
        buffer: Buffer.from("zip"),
        filename: privateEntryName,
      }),
    });

    const directRaws = await collect(
      adapter.sync({
        csvPath,
        onProgress: (event) => progress.push(event),
      }),
    );
    const zipRaws = await collect(
      adapter.sync({
        zipPath,
        onProgress: (event) => progress.push(event),
      }),
    );
    const strings = collectStrings({ directRaws, zipRaws, progress });
    expect(strings.some((value) => value.includes(csvPath))).toBe(false);
    expect(strings.some((value) => value.includes(zipPath))).toBe(false);
    expect(strings.some((value) => value.includes(privateEntryName))).toBe(
      false,
    );
    expect(directRaws[0].payload).toMatchObject({
      sourceMode: "csv-import",
      fileSha256: expect.any(String),
    });
    expect(zipRaws[0].payload).toMatchObject({
      sourceMode: "zip-import",
      fileSha256: expect.any(String),
    });
  });

  it("keeps each configurable limit inside a fixed hard cap", () => {
    expect(() =>
      resolveAlipayImportLimits({
        maxSnapshotBytes: HARD_MAX_SNAPSHOT_BYTES + 1,
      }),
    ).toThrow(/maxSnapshotBytes/u);
    expect(() =>
      resolveAlipayImportLimits({
        maxArchiveBytes: HARD_MAX_ARCHIVE_BYTES + 1,
      }),
    ).toThrow(/maxArchiveBytes/u);
    expect(() =>
      resolveAlipayImportLimits({ maxCsvBytes: HARD_MAX_CSV_BYTES + 1 }),
    ).toThrow(/maxCsvBytes/u);
    expect(() =>
      resolveAlipayImportLimits({ maxZipEntries: HARD_MAX_ZIP_ENTRIES + 1 }),
    ).toThrow(/maxZipEntries/u);
  });
});

describe("Alipay ZIP extraction boundary", () => {
  it("rejects an oversized archive before constructing AdmZip", async () => {
    const zipPath = tempFile("bill.zip", Buffer.alloc(32, 0x50));
    let constructed = false;
    class MustNotConstruct {
      constructor() {
        constructed = true;
      }
    }

    const error = await captureError(() =>
      extractCsvFromZip(zipPath, {
        maxArchiveBytes: 16,
        admZipImpl: MustNotConstruct,
      }),
    );
    expect(error).toMatchObject({ code: "SNAPSHOT_TOO_LARGE" });
    expect(error.message).not.toContain(zipPath);
    expect(constructed).toBe(false);
  });

  it("rejects a declared oversized CSV before inflating it", async () => {
    const zipPath = tempFile("bill.zip", classicArchiveBuffer(1));
    let inflated = false;
    const FakeZip = fakeAdmZip(
      [archiveEntry("bill.csv", 17)],
      Buffer.alloc(17),
    );
    FakeZip.prototype.readFile = () => {
      inflated = true;
      return Buffer.alloc(17);
    };

    await expect(
      extractCsvFromZip(zipPath, {
        maxCsvBytes: 16,
        admZipImpl: FakeZip,
      }),
    ).rejects.toMatchObject({ code: "ZIP_CSV_TOO_LARGE" });
    expect(inflated).toBe(false);
  });

  it("rejects a CSV whose actual inflated Buffer exceeds its limit", async () => {
    const zipPath = tempFile("bill.zip", classicArchiveBuffer(1));
    await expect(
      extractCsvFromZip(zipPath, {
        maxCsvBytes: 16,
        admZipImpl: fakeAdmZip([archiveEntry("bill.csv", 8)], Buffer.alloc(17)),
      }),
    ).rejects.toMatchObject({ code: "ZIP_CSV_TOO_LARGE" });
  });

  it("rejects entry-count bombs before inspecting or inflating entries", async () => {
    const zipPath = tempFile("bill.zip", classicArchiveBuffer(4));
    const entries = Array.from({ length: 4 }, (_, index) =>
      archiveEntry(`entry-${index}.txt`, 1),
    );
    let constructed = false;
    const FakeZip = fakeAdmZip(entries);
    class ObservedFakeZip extends FakeZip {
      constructor(input) {
        constructed = true;
        super(input);
      }
    }
    await expect(
      extractCsvFromZip(zipPath, {
        maxZipEntries: 3,
        admZipImpl: ObservedFakeZip,
      }),
    ).rejects.toMatchObject({ code: "ZIP_TOO_MANY_ENTRIES" });
    expect(constructed).toBe(false);
  });

  it("rejects unsafe names and ambiguous CSV candidates", async () => {
    const zipPath = tempFile("bill.zip", classicArchiveBuffer(1));
    await expect(
      extractCsvFromZip(zipPath, {
        admZipImpl: fakeAdmZip([archiveEntry("../bill.csv", 3)]),
      }),
    ).rejects.toMatchObject({ code: "ZIP_ENTRY_UNSAFE" });
    const ambiguousZipPath = tempFile("ambiguous.zip", classicArchiveBuffer(2));
    await expect(
      extractCsvFromZip(ambiguousZipPath, {
        admZipImpl: fakeAdmZip([
          archiveEntry("bill-a.csv", 3),
          archiveEntry("bill-b.csv", 3),
        ]),
      }),
    ).rejects.toMatchObject({ code: "ZIP_CSV_AMBIGUOUS" });
  });

  it("preserves legacy GBK bytes through bounded ZIP extraction", async () => {
    const archive = new AdmZip();
    archive.addFile("支付宝账单.csv", iconv.encode(LEGACY_ALIPAY_CSV, "gbk"));
    const zipPath = tempFile("legacy.zip", archive.toBuffer());
    const adapter = new AlipayBillAdapter({
      account: { email: "legacy@example.com" },
    });

    const raws = await collect(adapter.sync({ zipPath }));
    expect(raws).toHaveLength(1);
    expect(raws[0].originalId).toBe("GBK-TX-1");
    expect(raws[0].payload.row.counterparty).toBe("美团");
    expect(raws[0].payload.row.note).toBe("旧版账单");
  });
});
