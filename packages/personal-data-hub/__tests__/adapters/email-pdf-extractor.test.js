"use strict";

import { describe, it, expect } from "vitest";

const {
  extractPdfText,
  passwordsFromHints,
} = require("../../lib/adapters/email-imap/pdf-extractor");

const { extractTransactions } = require("../../lib/adapters/email-imap/transactions");

// ─── pdf-extractor (password trial loop) ─────────────────────────────────

function makeMockPdfParse(spec = {}) {
  // spec: { needsPassword?: string, text?: string, throwsOnPassword?: Function }
  const calls = [];
  const fn = async (buf, opts = {}) => {
    calls.push({ pwd: opts.password, bufLen: buf.length });
    if (spec.throwsAlways) {
      const err = new Error(spec.throwsAlways);
      throw err;
    }
    if (spec.needsPassword != null && opts.password !== spec.needsPassword) {
      const err = new Error("PasswordException: incorrect password");
      throw err;
    }
    return {
      text: spec.text || "extracted content",
      numpages: spec.numpages || 1,
      info: { IsEncrypted: spec.needsPassword != null },
    };
  };
  fn.calls = calls;
  return fn;
}

describe("extractPdfText — password trial loop", () => {
  it("returns text when no password is required (empty-password first)", async () => {
    const mockParse = makeMockPdfParse({ text: "hello world" });
    const r = await extractPdfText(Buffer.from("FAKE PDF"), {
      passwords: ["abc", "def"],
      pdfParseImpl: mockParse,
    });
    expect(r.decrypted).toBe(true);
    expect(r.text).toBe("hello world");
    expect(r.attempted).toBe(1); // empty-string trial succeeds first
    expect(r.password).toBeUndefined();
    expect(mockParse.calls[0].pwd).toBe("");
  });

  it("succeeds on the second password in the list", async () => {
    const mockParse = makeMockPdfParse({ needsPassword: "OPENME-mock", text: "decrypted!" });
    const r = await extractPdfText(Buffer.from("FAKE"), {
      passwords: ["wrong1", "OPENME-mock", "wrong2"],
      pdfParseImpl: mockParse,
    });
    expect(r.decrypted).toBe(true);
    expect(r.text).toBe("decrypted!");
    expect(r.password).toBe("OPENME-mock");
    // Attempts: "" → "wrong1" → "OPENME-mock" = 3
    expect(r.attempted).toBe(3);
    expect(r.wasEncrypted).toBe(true);
  });

  it("returns decrypted:false when no password works", async () => {
    const mockParse = makeMockPdfParse({ needsPassword: "nobody-knows" });
    const r = await extractPdfText(Buffer.from("FAKE"), {
      passwords: ["a", "b", "c"],
      pdfParseImpl: mockParse,
    });
    expect(r.decrypted).toBe(false);
    expect(r.text).toBe("");
    expect(r.attempted).toBe(4); // "" + 3 user passwords
    expect(r.wasEncrypted).toBe(true);
    expect(r.error).toMatch(/password/i);
  });

  it("deduplicates passwords + always tries empty-string first", async () => {
    const mockParse = makeMockPdfParse({ needsPassword: "match" });
    const r = await extractPdfText(Buffer.from("FAKE"), {
      passwords: ["", "match", "", "match"], // duplicates + empty
      pdfParseImpl: mockParse,
    });
    expect(r.decrypted).toBe(true);
    expect(r.attempted).toBe(2); // "" → "match"
  });

  it("non-password error short-circuits (no further trials)", async () => {
    const mockParse = makeMockPdfParse({ throwsAlways: "corrupt PDF stream" });
    const r = await extractPdfText(Buffer.from("FAKE"), {
      passwords: ["a", "b", "c"],
      pdfParseImpl: mockParse,
    });
    expect(r.decrypted).toBe(false);
    expect(r.attempted).toBe(1); // gave up on first non-password error
    expect(r.error).toContain("corrupt PDF stream");
  });

  it("rejects non-Buffer input gracefully", async () => {
    const r = await extractPdfText("not-a-buffer");
    expect(r.decrypted).toBe(false);
    expect(r.error).toMatch(/buffer/i);
  });

  it("truncates extracted text at maxTextChars", async () => {
    const longText = "x".repeat(300_000);
    const mockParse = makeMockPdfParse({ text: longText });
    const r = await extractPdfText(Buffer.from("F"), {
      passwords: [],
      maxTextChars: 1000,
      pdfParseImpl: mockParse,
    });
    expect(r.decrypted).toBe(true);
    expect(r.text.length).toBeLessThan(longText.length);
    expect(r.text).toMatch(/truncated/);
  });
});

describe("passwordsFromHints — hint ordering", () => {
  it("returns priority order: idCard → phone → cardLast6 → cardLast4 → dob", () => {
    const out = passwordsFromHints({
      cardLast4: "1234",
      idCardLast6: "987654",
      dobYYYYMMDD: "19900101",
      phoneLast6: "555000",
      cardLast6: "555111",
    });
    expect(out).toEqual(["987654", "555000", "555111", "1234", "19900101"]);
  });

  it("dedups + skips empty / non-string", () => {
    const out = passwordsFromHints({
      idCardLast6: "111111",
      phoneLast6: "111111", // duplicate
      cardLast4: "",
      cardLast6: undefined,
    });
    expect(out).toEqual(["111111"]);
  });

  it("returns [] for empty input", () => {
    expect(passwordsFromHints({})).toEqual([]);
    expect(passwordsFromHints()).toEqual([]);
  });
});

// ─── transactions extractor ──────────────────────────────────────────────

describe("extractTransactions — Chinese bank statements", () => {
  it("CMB (招商银行): YYYY-MM-DD whitespace-column format", () => {
    const text = [
      "招商银行信用卡 11 月对账单",
      "账单周期: 2026-10-26 至 2026-11-25",
      "",
      "2026-10-30  星巴克 上海中山公园店             -39.00      1,234.56",
      "2026-11-05  京东商城                           -899.00       335.56",
      "2026-11-12  退款 淘宝                          +50.00       385.56",
      "",
      "第 1 页 共 2 页",
    ].join("\n");
    const out = extractTransactions(text);
    expect(out).toHaveLength(3);
    expect(out[0].amount.value).toBe(39);
    expect(out[0].amount.direction).toBe("out");
    expect(out[0].balance.value).toBe(1234.56);
    expect(out[0].description).toMatch(/星巴克/);
    expect(out[2].amount.direction).toBe("in"); // "+" prefix
  });

  it("ICBC (工商银行): YYYY/MM/DD with 借/贷 prefix", () => {
    const text = [
      "工商银行信用卡账单",
      "2026/04/15 借 39.00  星巴克 CNY 1234.56",
      "2026/04/16 贷 200.00 退款 ABC CNY 1434.56",
    ].join("\n");
    const out = extractTransactions(text);
    expect(out).toHaveLength(2);
    expect(out[0].amount.direction).toBe("out"); // 借 → out
    expect(out[1].amount.direction).toBe("in"); // 贷 → in
  });

  it("中文日期: YYYY年MM月DD日 + 支出/收入 keywords", () => {
    const text = [
      "2026年04月15日  星巴克 上海中山公园店  支出 39.00  余额 1234.56",
      "2026年04月16日  工资到账 公司财务  收入 8000.00  余额 9234.56",
    ].join("\n");
    const out = extractTransactions(text);
    expect(out).toHaveLength(2);
    expect(out[0].amount.value).toBe(39);
    expect(out[0].amount.direction).toBe("out");
    expect(out[1].amount.direction).toBe("in");
    expect(out[1].balance.value).toBeCloseTo(9234.56);
  });

  it("skips header / footer / legalese lines", () => {
    const text = [
      "中国银行 月度账单",
      "声明: 本邮件由系统自动发送",
      "温馨提示: 请按时还款",
      "第 1 页",
      "===============",
      "2026-05-01 测试商户 100.00 1000.00",
    ].join("\n");
    const out = extractTransactions(text);
    expect(out).toHaveLength(1);
    expect(out[0].description).toMatch(/测试商户/);
  });

  it("returns [] for non-statement text (no dates)", () => {
    expect(extractTransactions("This is a marketing email, no statement rows.")).toEqual([]);
    expect(extractTransactions("")).toEqual([]);
  });

  it("caps at maxRows", () => {
    const lines = Array.from(
      { length: 50 },
      (_, i) => `2026-05-${String((i % 28) + 1).padStart(2, "0")} merchant${i} 10.00 100.00`,
    );
    const out = extractTransactions(lines.join("\n"), { maxRows: 5 });
    expect(out).toHaveLength(5);
  });

  it("each transaction includes a unique occurredAtMs", () => {
    const text = [
      "2026-05-01 a 10.00 100.00",
      "2026-05-02 b 20.00 80.00",
      "2026-05-03 c 30.00 50.00",
    ].join("\n");
    const out = extractTransactions(text);
    expect(out).toHaveLength(3);
    expect(out[0].occurredAtMs).toBeLessThan(out[1].occurredAtMs);
    expect(out[1].occurredAtMs).toBeLessThan(out[2].occurredAtMs);
  });

  it("description excludes amount/balance/direction-keyword noise", () => {
    const text = "2026-05-15 星巴克 支出 39.00 余额 1234.56";
    const out = extractTransactions(text);
    expect(out[0].description).toBe("星巴克");
  });

  it("single-amount line treats it as the transaction amount (no balance)", () => {
    const text = "2026-05-15 ATM withdrawal -500.00";
    const out = extractTransactions(text);
    expect(out).toHaveLength(1);
    expect(out[0].amount.value).toBe(500);
    expect(out[0].balance).toBeUndefined();
  });
});

// ─── EmailAdapter Phase 5.5 integration ──────────────────────────────────

const { EmailAdapter } = require("../../lib/adapters/email-imap/email-adapter");

function makeSession(envelopes) {
  return (_opts) => ({
    async connect() {},
    async openMailbox(_name) {
      return { uidValidity: 1, uidNext: 9999, exists: envelopes.length };
    },
    async *fetchFullSince(sinceUid = 0) {
      for (const env of envelopes) {
        if (env.uid > sinceUid) yield { ...env, source: env.source || Buffer.alloc(0) };
      }
    },
    async close() {},
  });
}

const billEnv = (uid = 1) => ({
  uid,
  internalDate: new Date("2026-05-01T10:00:00Z"),
  flags: ["\\Seen"],
  messageId: `<bill-${uid}@x>`,
  subject: "招商银行信用卡 11 月对账单",
  from: [{ name: "招商银行", address: "ebank@cmbchina.com" }],
  to: [{ address: "me@example.com" }],
  cc: [],
  date: new Date("2026-05-01T10:00:00Z"),
  size: 4096,
  source: Buffer.from("RAW", "utf8"),
});

const PDF_TEXT = [
  "招商银行信用卡 11 月对账单",
  "尾号 1234  最后还款日 2026-12-05  应还金额 ¥3,000.00",
  "",
  "2026-11-05  星巴克 上海中山公园店       -39.00     2961.00",
  "2026-11-15  京东自营                  -899.00     2062.00",
  "2026-11-20  退款 淘宝                  +50.00     2112.00",
].join("\n");

describe("EmailAdapter — Phase 5.5 PDF extraction integration", () => {
  it("decrypts bill PDF + extracts transactions into fields.transactions", async () => {
    const factory = makeSession([billEnv()]);
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "x", folders: ["INBOX"] },
      sessionFactory: factory,
      // Force-create a "decrypted" PDF attachment via a custom parser
      parser: async () => ({
        textBody: "尾号 1234 应还金额 ¥3,000",
        attachments: [{
          filename: "statement.pdf",
          contentType: "application/pdf",
          contentDisposition: "attachment",
          size: 12345,
          sha256: "abc",
          isInline: false,
          isEncrypted: true,
          buffer: Buffer.from("FAKE PDF BYTES"),
        }],
      }),
      pdfExtractor: async (buf, _opts) => ({
        decrypted: true,
        text: PDF_TEXT,
        password: "987654",
        attempted: 2,
        wasEncrypted: true,
        pageCount: 2,
      }),
      pdfPasswords: ["987654"],
    });

    const raws = [];
    for await (const r of a.sync()) raws.push(r);
    expect(raws).toHaveLength(1);
    const ext = raws[0].payload.extraction;
    expect(ext.template).toBe("bill");
    expect(ext.fields.transactions).toBeDefined();
    expect(ext.fields.transactions.length).toBe(3);
    expect(ext.fields.transactions[0].amount.value).toBe(39);
    expect(ext.fields.transactions[0].amount.direction).toBe("out");
    expect(ext.fields.transactions[2].amount.direction).toBe("in");
    expect(ext.pdfExtraction).toBeDefined();
    expect(ext.pdfExtraction[0].decrypted).toBe(true);
    expect(ext.pdfExtraction[0].transactionsExtracted).toBe(3);
    // Real password value must NEVER be persisted (only masked)
    expect(ext.pdfExtraction[0].passwordUsed).toBe("***");
    expect(JSON.stringify(ext.pdfExtraction)).not.toMatch(/987654/);
  });

  it("normalize copies transactions into extra.fields.transactions", async () => {
    const factory = makeSession([billEnv()]);
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "x", folders: ["INBOX"] },
      sessionFactory: factory,
      parser: async () => ({
        textBody: "尾号 1234",
        attachments: [{
          filename: "stmt.pdf",
          contentType: "application/pdf",
          size: 100,
          sha256: "x",
          buffer: Buffer.from("FAKE"),
        }],
      }),
      pdfExtractor: async () => ({
        decrypted: true,
        text: "2026-05-01 星巴克 -39.00 1000.00",
        attempted: 1,
        wasEncrypted: true,
        pageCount: 1,
      }),
    });
    const raws = [];
    for await (const r of a.sync()) raws.push(r);
    const batch = a.normalize(raws[0]);
    expect(batch.events).toHaveLength(1);
    expect(batch.events[0].extra.fields.transactions).toBeDefined();
    expect(batch.events[0].extra.fields.transactions).toHaveLength(1);
    expect(batch.events[0].extra.pdfExtraction).toBeDefined();
  });

  it("decrypt failure: pdfExtraction.error populated; no transactions", async () => {
    const factory = makeSession([billEnv()]);
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "x", folders: ["INBOX"] },
      sessionFactory: factory,
      parser: async () => ({
        textBody: "stmt",
        attachments: [{
          filename: "x.pdf",
          contentType: "application/pdf",
          size: 100,
          sha256: "h",
          buffer: Buffer.from("F"),
        }],
      }),
      pdfExtractor: async () => ({
        decrypted: false,
        text: "",
        attempted: 5,
        wasEncrypted: true,
        pageCount: 0,
        error: "all passwords failed",
      }),
    });
    const raws = [];
    for await (const r of a.sync()) raws.push(r);
    const ext = raws[0].payload.extraction;
    expect(ext.fields.transactions).toBeUndefined();
    expect(ext.pdfExtraction[0].decrypted).toBe(false);
    expect(ext.pdfExtraction[0].error).toContain("all passwords failed");
  });

  it("disablePdfExtraction skips the decryption pass", async () => {
    const factory = makeSession([billEnv()]);
    let extractorCalled = false;
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "x", folders: ["INBOX"] },
      sessionFactory: factory,
      parser: async () => ({
        textBody: "stmt",
        attachments: [{
          filename: "x.pdf",
          contentType: "application/pdf",
          size: 100,
          sha256: "h",
          buffer: Buffer.from("F"),
        }],
      }),
      pdfExtractor: async () => {
        extractorCalled = true;
        return { decrypted: true, text: "txt", attempted: 1, wasEncrypted: false, pageCount: 1 };
      },
      disablePdfExtraction: true,
    });
    const raws = [];
    for await (const r of a.sync()) raws.push(r);
    expect(extractorCalled).toBe(false);
    expect(raws[0].payload.extraction.pdfExtraction).toBeUndefined();
  });

  it("non-bill email does NOT trigger PDF extraction even when PDF attached", async () => {
    const factory = makeSession([{
      ...billEnv(),
      subject: "Welcome",
      from: [{ address: "noreply@example.com" }],
    }]);
    let extractorCalled = false;
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "x", folders: ["INBOX"] },
      sessionFactory: factory,
      parser: async () => ({
        textBody: "Welcome to our service!",
        attachments: [{
          filename: "brochure.pdf",
          contentType: "application/pdf",
          size: 100,
          sha256: "b",
          buffer: Buffer.from("F"),
        }],
      }),
      pdfExtractor: async () => {
        extractorCalled = true;
        return { decrypted: true, text: "", attempted: 1, wasEncrypted: false, pageCount: 1 };
      },
    });
    const raws = [];
    for await (const r of a.sync()) raws.push(r);
    expect(extractorCalled).toBe(false);
  });

  it("attachment buffers are STRIPPED from the emitted RawEvent payload", async () => {
    const factory = makeSession([billEnv()]);
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "x", folders: ["INBOX"] },
      sessionFactory: factory,
      parser: async () => ({
        textBody: "stmt",
        attachments: [{
          filename: "x.pdf",
          contentType: "application/pdf",
          size: 100,
          sha256: "h",
          buffer: Buffer.from("SECRET PDF BYTES"),
        }],
      }),
      pdfExtractor: async () => ({ decrypted: true, text: "", attempted: 1, wasEncrypted: false, pageCount: 1 }),
    });
    const raws = [];
    for await (const r of a.sync()) raws.push(r);
    // The buffer must not survive into the serialized payload
    const serialized = JSON.stringify(raws[0]);
    expect(serialized).not.toMatch(/SECRET PDF BYTES/);
    // Attachment metadata still present
    expect(raws[0].payload.parsedBody.attachments[0].filename).toBe("x.pdf");
    expect(raws[0].payload.parsedBody.attachments[0].buffer).toBeUndefined();
  });

  it("capability flag: decrypt:pdf-bills present by default, absent when disabled", () => {
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "x" },
      sessionFactory: makeSession([]),
    });
    expect(a.capabilities).toContain("decrypt:pdf-bills");

    const b = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "x" },
      sessionFactory: makeSession([]),
      disablePdfExtraction: true,
    });
    expect(b.capabilities).not.toContain("decrypt:pdf-bills");
  });

  it("pdfPasswordHints + pdfPasswords are merged + deduped", () => {
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "x" },
      sessionFactory: makeSession([]),
      pdfPasswords: ["custom1", "custom2"],
      pdfPasswordHints: { idCardLast6: "111111", phoneLast6: "custom1" }, // dup
    });
    // Internal field — surface via the password list passed to pdfExtractor
    let receivedPasswords = null;
    a._pdfExtractor = async (_buf, opts) => {
      receivedPasswords = opts.passwords;
      return { decrypted: false, attempted: 0, text: "", wasEncrypted: false, pageCount: 0 };
    };
    // No need to run sync; verify the internal list directly:
    expect(a._pdfPasswords).toEqual(["custom1", "custom2", "111111"]);
  });

  it("version reflects 0.6.0", () => {
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "x" },
      sessionFactory: makeSession([]),
    });
    expect(a.version).toBe("0.7.0");
  });
});
