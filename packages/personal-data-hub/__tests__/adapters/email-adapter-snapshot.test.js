"use strict";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  EmailAdapter,
} = require("../../lib/adapters/email-imap/email-adapter");
const { assertAdapter } = require("../../lib/adapter-spec");

/**
 * Phase 5.8 — snapshot mode for Android EmailLocalCollector ingestion.
 *
 * EmailLocalCollector.kt (android-app) does the IMAP fetch on-device with
 * Jakarta Mail, then writes filesDir/staging/email-<vendor>-<ts>.json with
 * shape `{vendor, user, fetchedAt, records: [{messageNumber, subject, from,
 * to, sentDateMs, bodyPreview, hasAttachments}]}`. The desktop EmailAdapter
 * must consume that JSON via syncAdapter("email-imap", path) — without it
 * the UI shows "v0.2 补齐 (邮件已成功抓 X 封到本机临时区)" misleading hint
 * because the local fetch worked but cc couldn't ingest it.
 *
 * snapshotMode opt:
 *  - Relaxes opts.account.email + authCode constructor validation
 *  - Switches authenticate(ctx.inputPath) to file-readability check
 *  - Switches sync(opts.inputPath) to read JSON + emit raw events
 *  - Classifier + extractor still fire (text-only, no PDF since attachment
 *    buffers never crossed Android → desktop boundary)
 */
describe("EmailAdapter snapshot mode", () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "email-snap-"));
  });
  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_e) {}
  });

  it("snapshotMode constructor accepts no opts.account", () => {
    const a = new EmailAdapter({ snapshotMode: true });
    expect(a.name).toBe("email-imap");
    expect(a.capabilities).toContain("sync:snapshot");
    expect(a.capabilities).not.toContain("sync:imap");
    expect(a.capabilities).not.toContain("auth:authcode");
    // Classifier + extractor capabilities preserved (snapshot still classifies)
    expect(a.capabilities).toContain("classify:layer1-rules");
    expect(a.capabilities).toContain("extract:6-templates");
  });

  it("snapshotMode adapter passes contract assertion", () => {
    const a = new EmailAdapter({ snapshotMode: true });
    const r = assertAdapter(a);
    if (!r.ok) console.log("assertAdapter errors:", r.errors);
    expect(r.ok).toBe(true);
  });

  it("authenticate(ctx.inputPath) returns ok when file readable", async () => {
    const inputPath = path.join(tmpDir, "snap.json");
    fs.writeFileSync(inputPath, "{}", "utf-8");
    const a = new EmailAdapter({ snapshotMode: true });
    const auth = await a.authenticate({ inputPath });
    expect(auth.ok).toBe(true);
    expect(auth.mode).toBe("snapshot-file");
  });

  it("authenticate without inputPath in snapshotMode returns NO_INPUT", async () => {
    const a = new EmailAdapter({ snapshotMode: true });
    const auth = await a.authenticate({});
    expect(auth.ok).toBe(false);
    expect(auth.reason).toBe("NO_INPUT");
  });

  it("authenticate with unreadable inputPath returns INPUT_PATH_UNREADABLE", async () => {
    const a = new EmailAdapter({ snapshotMode: true });
    const auth = await a.authenticate({ inputPath: path.join(tmpDir, "nope.json") });
    expect(auth.ok).toBe(false);
    expect(auth.reason).toBe("INPUT_PATH_UNREADABLE");
  });

  it("sync(inputPath) yields one raw event per record", async () => {
    const inputPath = path.join(tmpDir, "snap.json");
    fs.writeFileSync(inputPath, JSON.stringify({
      vendor: "qq",
      user: "user@qq.com",
      fetchedAt: 1_700_000_000_000,
      records: [
        {
          messageNumber: 1,
          subject: "Test subject 1",
          from: "Alice <alice@x.com>",
          to: "user@qq.com",
          sentDateMs: 1_700_000_100_000,
          bodyPreview: "hello world",
          hasAttachments: false,
        },
        {
          messageNumber: 2,
          subject: "Order confirmation",
          from: "noreply@shop.com",
          to: "user@qq.com",
          sentDateMs: 1_700_000_200_000,
          bodyPreview: "your order ABC123 has shipped",
          hasAttachments: true,
        },
      ],
    }), "utf-8");

    const a = new EmailAdapter({ snapshotMode: true });
    const raws = [];
    for await (const r of a.sync({ inputPath })) raws.push(r);
    expect(raws).toHaveLength(2);

    expect(raws[0].adapter).toBe("email-imap");
    expect(raws[0].originalId).toBe("android-snapshot:qq:user@qq.com:1");
    expect(raws[0].capturedAt).toBe(1_700_000_100_000);
    expect(raws[0].payload.subject).toBe("Test subject 1");
    expect(raws[0].payload.from[0].address).toBe("alice@x.com");
    expect(raws[0].payload.from[0].name).toBe("Alice");
    expect(raws[0].payload.to[0].address).toBe("user@qq.com");
    expect(raws[0].payload.folder).toBe("INBOX");
    // Classification fires even on envelope-only data
    expect(raws[0].payload.classification).toBeDefined();
    expect(raws[0].payload.classification.category).toBeDefined();

    expect(raws[1].originalId).toBe("android-snapshot:qq:user@qq.com:2");
    expect(raws[1].payload.from[0].address).toBe("noreply@shop.com");
    // hasAttachments=true → parsedBody.attachments has placeholder entry
    expect(raws[1].payload.parsedBody.attachments).toHaveLength(1);
  });

  it("sync(inputPath) on empty records emits nothing", async () => {
    const inputPath = path.join(tmpDir, "empty.json");
    fs.writeFileSync(inputPath, JSON.stringify({
      vendor: "163",
      user: "u@163.com",
      fetchedAt: Date.now(),
      records: [],
    }), "utf-8");

    const a = new EmailAdapter({ snapshotMode: true });
    const raws = [];
    for await (const r of a.sync({ inputPath })) raws.push(r);
    expect(raws).toHaveLength(0);
  });

  it("sync(inputPath) on malformed JSON throws clear error", async () => {
    const inputPath = path.join(tmpDir, "bad.json");
    fs.writeFileSync(inputPath, "{not json", "utf-8");

    const a = new EmailAdapter({ snapshotMode: true });
    let threw = null;
    try {
      for await (const _r of a.sync({ inputPath })) { /* drain */ }
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeTruthy();
    expect(threw.message).toMatch(/bad JSON/);
  });

  it("sync(inputPath) without records[] throws shape error", async () => {
    const inputPath = path.join(tmpDir, "noshape.json");
    fs.writeFileSync(inputPath, JSON.stringify({ vendor: "qq" }), "utf-8");

    const a = new EmailAdapter({ snapshotMode: true });
    let threw = null;
    try {
      for await (const _r of a.sync({ inputPath })) { /* drain */ }
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeTruthy();
    expect(threw.message).toMatch(/records/);
  });

  it("sync(opts.limit) respected on snapshot record iteration", async () => {
    const inputPath = path.join(tmpDir, "many.json");
    const records = [];
    for (let i = 1; i <= 10; i += 1) {
      records.push({
        messageNumber: i,
        subject: `msg ${i}`,
        from: `s${i}@x.com`,
        to: "u@q.com",
        sentDateMs: 1_700_000_000_000 + i * 1000,
        bodyPreview: `body ${i}`,
        hasAttachments: false,
      });
    }
    fs.writeFileSync(inputPath, JSON.stringify({
      vendor: "qq",
      user: "u@q.com",
      fetchedAt: Date.now(),
      records,
    }), "utf-8");

    const a = new EmailAdapter({ snapshotMode: true });
    const raws = [];
    for await (const r of a.sync({ inputPath, limit: 3 })) raws.push(r);
    expect(raws).toHaveLength(3);
  });

  it("sync(inputPath) handles records with no sentDateMs (falls back to fetchedAt)", async () => {
    const inputPath = path.join(tmpDir, "nodate.json");
    fs.writeFileSync(inputPath, JSON.stringify({
      vendor: "qq",
      user: "u@q.com",
      fetchedAt: 1_700_500_000_000,
      records: [
        {
          messageNumber: 1,
          subject: "no date",
          from: "x@x.com",
          to: "u@q.com",
          // sentDateMs intentionally omitted
          bodyPreview: "",
          hasAttachments: false,
        },
      ],
    }), "utf-8");

    const a = new EmailAdapter({ snapshotMode: true });
    const raws = [];
    for await (const r of a.sync({ inputPath })) raws.push(r);
    expect(raws).toHaveLength(1);
    expect(raws[0].capturedAt).toBe(1_700_500_000_000);
  });

  it("non-snapshot mode still requires opts.account (preserves Phase 5.1 invariant)", () => {
    expect(() => new EmailAdapter({})).toThrow(/account/);
    expect(() => new EmailAdapter({ account: { email: "u@x.com" } })).toThrow(/authCode/);
    // But snapshot mode bypasses both:
    expect(() => new EmailAdapter({ snapshotMode: true })).not.toThrow();
  });
});
