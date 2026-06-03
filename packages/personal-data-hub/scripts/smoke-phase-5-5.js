#!/usr/bin/env node
/**
 * Phase 5.5 smoke — drives EmailAdapter end-to-end with a mock encrypted
 * PDF attachment, exercising:
 *   - password-trial loop (3 wrong → 1 right)
 *   - text extraction
 *   - transactions regex (3 rows from a 招行-style statement)
 *   - merging transactions[] into bill template fields
 *   - per-attachment pdfExtraction summary
 *   - attachment buffer stripping before raw-event emission
 *
 * Uses an INJECTED pdfExtractor so the smoke runs without pulling the
 * heavy pdfjs dep. The shape of the injected output matches what
 * `extractPdfText` from pdf-extractor.js would return.
 */

"use strict";

const { EmailAdapter } = require("../lib/adapters/email-imap/email-adapter");
const { extractTransactions } = require("../lib/adapters/email-imap/transactions");

const PDF_TEXT = [
  "招商银行信用卡 11 月对账单",
  "持卡人: 张三  尾号 1234",
  "账单周期: 2026-10-26 至 2026-11-25",
  "最后还款日: 2026-12-05  应还金额: ¥3,000.00",
  "",
  "交易明细:",
  "2026-10-30  星巴克 上海中山公园店             -39.00      2,961.00",
  "2026-11-05  京东自营                           -899.00     2,062.00",
  "2026-11-12  退款 淘宝                          +50.00      2,112.00",
  "2026-11-18  美团外卖                           -85.00      2,027.00",
  "",
  "第 1 页 共 1 页",
].join("\n");

const PDF_PASSWORDS = ["wrong1", "wrong2", "wrong3", "987654"];

function makeSession() {
  const env = {
    uid: 1,
    internalDate: new Date("2026-11-26T10:00:00Z"),
    flags: ["\\Seen"],
    messageId: "<bill-cmb-11@x>",
    subject: "招商银行信用卡 11 月对账单",
    from: [{ name: "招商银行", address: "ebank@cmbchina.com" }],
    to: [{ address: "me@example.com" }],
    cc: [],
    date: new Date("2026-11-26T10:00:00Z"),
    size: 8192,
    source: Buffer.from("RAW", "utf8"),
  };
  return () => ({
    async connect() {},
    async openMailbox(_name) {
      return { uidValidity: 1, uidNext: 9999, exists: 1 };
    },
    async *fetchFullSince(sinceUid = 0) {
      if (env.uid > sinceUid) yield env;
    },
    async close() {},
  });
}

let trialCount = 0;
async function mockPdfExtractor(buffer, opts) {
  trialCount = 0;
  for (const pw of ["", ...(opts.passwords || [])]) {
    trialCount += 1;
    if (pw === "987654") {
      return {
        decrypted: true,
        text: PDF_TEXT,
        password: pw,
        attempted: trialCount,
        wasEncrypted: true,
        pageCount: 1,
      };
    }
  }
  return {
    decrypted: false,
    text: "",
    attempted: trialCount,
    wasEncrypted: true,
    pageCount: 0,
    error: "all passwords failed",
  };
}

async function main() {
  console.log("== Phase 5.5 smoke ==");

  // First validate the standalone transactions parser on the fixture text
  console.log("\n— Standalone transactions regex —");
  const standaloneTxns = extractTransactions(PDF_TEXT);
  console.log(`extracted ${standaloneTxns.length} transactions:`);
  for (const t of standaloneTxns) {
    const dir = t.amount.direction || "?";
    const date = new Date(t.occurredAtMs).toISOString().slice(0, 10);
    console.log(`  ${date}  ${dir.padEnd(3)}  ¥${t.amount.value.toFixed(2).padStart(8)}  ${t.description}`);
  }
  if (standaloneTxns.length !== 4) {
    console.log(`FAIL: expected 4 transactions, got ${standaloneTxns.length}`);
    process.exitCode = 1;
    return;
  }

  // Now full pipeline
  console.log("\n— Full adapter pipeline —");

  const a = new EmailAdapter({
    account: { provider: "qq", email: "me@qq.com", authCode: "x", folders: ["INBOX"] },
    sessionFactory: makeSession(),
    parser: async () => ({
      textBody: "您的招商银行信用卡 11 月对账单已生成，详情见附件 PDF。",
      attachments: [{
        filename: "招行账单_11月.pdf",
        contentType: "application/pdf",
        contentDisposition: "attachment",
        size: 78_456,
        sha256: "abc123sha256deadbeef",
        isInline: false,
        isEncrypted: true,
        buffer: Buffer.from("FAKE-PDF-BYTES-DO-NOT-LEAK"),
      }],
    }),
    pdfExtractor: mockPdfExtractor,
    pdfPasswordHints: { idCardLast6: "987654", phoneLast6: "555000" },
    pdfPasswords: ["wrong1", "wrong2", "wrong3"], // tried before hints
  });

  console.log("adapter.version =", a.version);
  console.log("adapter.capabilities =", a.capabilities.join(", "));
  console.log("pdfPasswords (merged) =", a._pdfPasswords);

  let count = 0;
  for await (const raw of a.sync()) {
    count += 1;
    const ext = raw.payload.extraction;
    console.log(`\nemail #${count} subject: ${raw.payload.subject}`);
    console.log("  classification.category:", raw.payload.classification.category);
    console.log("  extraction.template    :", ext.template);
    console.log("  extraction.confidence  :", ext.confidence);
    console.log("  extraction.fields keys :", Object.keys(ext.fields || {}).join(", "));
    if (ext.fields.transactions) {
      console.log(`  transactions[] count   : ${ext.fields.transactions.length}`);
      for (const t of ext.fields.transactions) {
        const date = new Date(t.occurredAtMs).toISOString().slice(0, 10);
        console.log(`    ${date} ¥${t.amount.value} ${t.amount.direction} ${t.description}`);
      }
    }
    console.log("  pdfExtraction[]        :");
    for (const p of ext.pdfExtraction || []) {
      console.log(`    ${p.filename}: decrypted=${p.decrypted} attempted=${p.attempted} txns=${p.transactionsExtracted ?? "-"}`);
    }

    // Buffer-leakage check
    const serialized = JSON.stringify(raw);
    if (serialized.includes("FAKE-PDF-BYTES-DO-NOT-LEAK")) {
      console.log("\nBUFFER LEAK ✗ — raw PDF bytes survived into payload!");
      process.exitCode = 1;
    } else {
      console.log("  buffer stripping       : ✓ no PDF bytes in payload");
    }
    // Password-leakage check
    if (serialized.match(/987654/)) {
      console.log("  PASSWORD LEAK ✗ — real password survived into payload");
      process.exitCode = 1;
    } else {
      console.log("  password redaction     : ✓ real password not in payload");
    }

    // Normalize and confirm transactions land in extra.fields
    const batch = a.normalize(raw);
    const ev = batch.events[0];
    if (ev.extra.fields && Array.isArray(ev.extra.fields.transactions)) {
      console.log(`  normalize → extra.fields.transactions: ${ev.extra.fields.transactions.length} rows ✓`);
    } else {
      console.log("  normalize MISSING transactions in extra.fields ✗");
      process.exitCode = 1;
    }
  }

  if (count === 1 && !process.exitCode) {
    console.log("\n== Phase 5.5 smoke PASSED ==");
  } else if (!process.exitCode) {
    console.log(`expected 1 email, got ${count}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("smoke failed:", err);
  process.exitCode = 1;
});
