"use strict";

import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  AlipayBillAdapter,
} = require("../../lib/adapters/alipay-bill/alipay-bill-adapter");
const {
  parseCursor,
  serializeCursor,
} = require("../../lib/adapters/alipay-bill/scan-cursor");
const { generateKeyHex } = require("../../lib/key-providers");
const { AdapterRegistry } = require("../../lib/registry");
const { LocalVault } = require("../../lib/vault");

function row(txId, amount) {
  return {
    txId,
    merchantOrderNumber: `merchant-${txId}`,
    createdAt: `2024-04-0${txId} 10:00:00`,
    paidAt: `2024-04-0${txId} 10:00:01`,
    lastModifiedAt: `2024-04-0${txId} 10:00:02`,
    sourceChannel: "客户端",
    alipayType: "消费",
    counterparty: `商户-${txId}`,
    itemName: `商品-${txId}`,
    amount: String(amount),
    direction: "支出",
    status: "交易成功",
    serviceFee: "0.00",
    refundedAmount: "0.00",
    note: "",
    fundStatus: "已支出",
  };
}

async function collect(iterable) {
  const raws = [];
  for await (const raw of iterable) raws.push(raw);
  return raws;
}

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

function tempCsv(content = "stable-import") {
  if (!tmpDir) {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-alipay-cursor-"));
  }
  const inputPath = path.join(tmpDir, "bill.csv");
  fs.writeFileSync(inputPath, content, "utf8");
  return inputPath;
}

function adapter(rows = [row("1", 10), row("2", 20), row("3", 30)]) {
  return new AlipayBillAdapter({
    account: { email: "private@example.com" },
    csvParser: () => ({
      encoding: "utf-8",
      header: { account: "private@example.com" },
      rows,
    }),
  });
}

describe("Alipay bill explicit cursor", () => {
  it("lets Registry limits resume one import in a private per-file scope", async () => {
    const inputPath = tempCsv();
    vault = new LocalVault({
      path: path.join(tmpDir, "vault.db"),
      key: generateKeyHex(),
      skipAudit: true,
    });
    vault.open();
    const sourceAdapter = adapter();
    const registry = new AdapterRegistry({ vault });
    registry.register(sourceAdapter);

    const reports = [];
    for (let index = 0; index < 3; index += 1) {
      reports.push(
        await registry.syncAdapter(sourceAdapter.name, {
          inputPath,
          limit: 1,
        }),
      );
    }

    expect(reports.map((report) => report.status)).toEqual(["ok", "ok", "ok"]);
    expect(reports.map((report) => report.rawCount)).toEqual([1, 1, 1]);
    expect(reports[0].scope).toMatch(/^account:alipay-bill:[0-9a-f]{32}$/u);
    expect(reports[0].scope).not.toContain("private");
    expect(new Set(reports.map((report) => report.scope)).size).toBe(1);
    expect(
      vault.queryEvents({ adapter: sourceAdapter.name, limit: 10 }),
    ).toHaveLength(3);
    expect(parseCursor(reports[2].watermark).cursor).toEqual({
      v: 1,
      source: null,
      after: null,
      upper: null,
    });
  });

  it("publishes the exact next row before each bounded yield", async () => {
    const inputPath = tempCsv();
    const sourceAdapter = adapter();
    let watermark;

    const first = await collect(
      sourceAdapter.sync({
        inputPath,
        limit: 2,
        updateWatermark(value) {
          watermark = value;
        },
      }),
    );
    expect(first.map((raw) => raw.originalId)).toEqual(["1", "2"]);
    expect(parseCursor(watermark).cursor).toMatchObject({
      after: 2,
      upper: 3,
    });

    const second = await collect(
      sourceAdapter.sync({
        inputPath,
        limit: 2,
        sinceWatermark: watermark,
        updateWatermark(value) {
          watermark = value;
        },
      }),
    );
    expect(second.map((raw) => raw.originalId)).toEqual(["3"]);
    expect(parseCursor(watermark).cursor.upper).toBeNull();
  });

  it("fails closed when file bytes or the parsed row boundary changes", async () => {
    const inputPath = tempCsv("version-one");
    const rows = [row("1", 10), row("2", 20), row("3", 30)];
    const sourceAdapter = adapter(rows);
    let watermark;
    await collect(
      sourceAdapter.sync({
        inputPath,
        limit: 1,
        updateWatermark(value) {
          watermark = value;
        },
      }),
    );

    fs.writeFileSync(inputPath, "version-two", "utf8");
    await expect(
      collect(
        sourceAdapter.sync({
          inputPath,
          sinceWatermark: watermark,
        }),
      ),
    ).rejects.toMatchObject({
      code: "ALIPAY_BILL_CURSOR_SOURCE_CHANGED",
      retryable: false,
    });

    fs.writeFileSync(inputPath, "version-one", "utf8");
    rows.push(row("4", 40));
    await expect(
      collect(
        sourceAdapter.sync({
          inputPath,
          sinceWatermark: watermark,
        }),
      ),
    ).rejects.toMatchObject({
      code: "ALIPAY_BILL_CURSOR_SOURCE_CHANGED",
      retryable: false,
    });
  });

  it("isolates different import revisions while retaining the account fallback", () => {
    const firstPath = tempCsv("first");
    const secondPath = path.join(tmpDir, "second.csv");
    fs.writeFileSync(secondPath, "second", "utf8");
    const sourceAdapter = adapter();

    const firstScope = sourceAdapter.resolveDefaultScope({
      inputPath: firstPath,
    });
    const secondScope = sourceAdapter.resolveDefaultScope({
      inputPath: secondPath,
    });
    expect(firstScope).not.toBe(secondScope);
    expect(sourceAdapter.resolveDefaultScope()).toBe(
      sourceAdapter.defaultScope,
    );
  });
});

describe("Alipay bill cursor validation", () => {
  it("migrates legacy counts and rejects unsupported or completed cursors", () => {
    expect(parseCursor("3")).toMatchObject({
      kind: "legacy-reset",
      cursor: { v: 1, source: null, after: null, upper: null },
    });
    expect(() => parseCursor("alipay-bill:v2:{}")).toThrowError(
      expect.objectContaining({ code: "ALIPAY_BILL_CURSOR_UNSUPPORTED" }),
    );
    expect(() =>
      serializeCursor({
        v: 1,
        source: "a".repeat(64),
        after: 3,
        upper: 3,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "ALIPAY_BILL_CURSOR_INVALID" }),
    );
  });
});
