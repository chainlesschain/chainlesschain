"use strict";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  EmailAdapter,
  SNAPSHOT_SCHEMA_VERSION,
} = require("../../lib/adapters/email-imap/email-adapter");
const { assertAdapter } = require("../../lib/adapter-spec");

function validSnapshot(overrides = {}) {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    vendor: "qq",
    user: "user@qq.com",
    fetchedAt: 1_700_000_000_000,
    records: [],
    ...overrides,
  };
}

async function collect(iterable) {
  const items = [];
  for await (const item of iterable) items.push(item);
  return items;
}

/**
 * Phase 5.8 — snapshot mode for Android EmailLocalCollector ingestion.
 *
 * EmailLocalCollector.kt (android-app) does the IMAP fetch on-device with
 * Jakarta Mail, then writes filesDir/staging/email-<vendor>-<ts>.json with
 * shape `{schemaVersion, vendor, user, fetchedAt, records:
 * [{messageNumber, subject, from, to, sentDateMs, bodyPreview,
 * hasAttachments}]}`. The desktop EmailAdapter
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
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup for Windows file locking.
    }
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
    fs.writeFileSync(inputPath, JSON.stringify(validSnapshot()), "utf-8");
    const a = new EmailAdapter({ snapshotMode: true });
    const auth = await a.authenticate({ inputPath });
    expect(auth.ok).toBe(true);
    expect(auth.mode).toBe("snapshot-file");
    expect(await a.healthCheck({ inputPath })).toMatchObject({ ok: true });
  });

  it("authenticate without inputPath in snapshotMode returns NO_INPUT", async () => {
    const a = new EmailAdapter({ snapshotMode: true });
    const auth = await a.authenticate({});
    expect(auth.ok).toBe(false);
    expect(auth.reason).toBe("NO_INPUT");
  });

  it("authenticate with unreadable inputPath returns INPUT_PATH_UNREADABLE", async () => {
    const a = new EmailAdapter({ snapshotMode: true });
    const auth = await a.authenticate({
      inputPath: path.join(tmpDir, "nope.json"),
    });
    expect(auth.ok).toBe(false);
    expect(auth.reason).toBe("INPUT_PATH_UNREADABLE");
  });

  it("authenticate rejects a directory instead of treating it as a snapshot", async () => {
    const a = new EmailAdapter({ snapshotMode: true });
    const auth = await a.authenticate({ inputPath: tmpDir });
    expect(auth).toMatchObject({
      ok: false,
      reason: "SNAPSHOT_NOT_REGULAR_FILE",
    });
  });

  it("authenticate and sync enforce schemaVersion", async () => {
    const inputPath = path.join(tmpDir, "wrong-schema.json");
    fs.writeFileSync(
      inputPath,
      JSON.stringify(validSnapshot({ schemaVersion: 2 })),
      "utf-8",
    );
    const a = new EmailAdapter({ snapshotMode: true });

    await expect(a.authenticate({ inputPath })).resolves.toMatchObject({
      ok: false,
      reason: "SNAPSHOT_SCHEMA_MISMATCH",
    });
    await expect(collect(a.sync({ inputPath }))).rejects.toMatchObject({
      code: "SNAPSHOT_SCHEMA_MISMATCH",
    });
  });

  it("authenticate and sync honor maxSnapshotBytes", async () => {
    const inputPath = path.join(tmpDir, "oversized.json");
    fs.writeFileSync(inputPath, JSON.stringify(validSnapshot()), "utf-8");
    const a = new EmailAdapter({ snapshotMode: true });

    await expect(
      a.authenticate({ inputPath, maxSnapshotBytes: 8 }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "SNAPSHOT_TOO_LARGE",
    });
    await expect(
      collect(a.sync({ inputPath, maxSnapshotBytes: 8 })),
    ).rejects.toMatchObject({ code: "SNAPSHOT_TOO_LARGE" });
  });

  it("sync(inputPath) yields one raw event per record", async () => {
    const inputPath = path.join(tmpDir, "snap.json");
    fs.writeFileSync(
      inputPath,
      JSON.stringify(
        validSnapshot({
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
        }),
      ),
      "utf-8",
    );

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
    fs.writeFileSync(
      inputPath,
      JSON.stringify(
        validSnapshot({
          vendor: "163",
          user: "u@163.com",
          fetchedAt: Date.now(),
        }),
      ),
      "utf-8",
    );

    const a = new EmailAdapter({ snapshotMode: true });
    const raws = [];
    for await (const r of a.sync({ inputPath })) raws.push(r);
    expect(raws).toHaveLength(0);
  });

  it("authenticate and sync reject malformed JSON", async () => {
    const inputPath = path.join(tmpDir, "bad.json");
    fs.writeFileSync(inputPath, "{not json", "utf-8");

    const a = new EmailAdapter({ snapshotMode: true });
    await expect(a.authenticate({ inputPath })).resolves.toMatchObject({
      ok: false,
      reason: "SNAPSHOT_JSON_INVALID",
    });
    await expect(collect(a.sync({ inputPath }))).rejects.toMatchObject({
      code: "SNAPSHOT_JSON_INVALID",
    });
  });

  it("sync(inputPath) without records[] throws shape error", async () => {
    const inputPath = path.join(tmpDir, "noshape.json");
    const snapshot = validSnapshot();
    delete snapshot.records;
    fs.writeFileSync(inputPath, JSON.stringify(snapshot), "utf-8");

    const a = new EmailAdapter({ snapshotMode: true });
    await expect(collect(a.sync({ inputPath }))).rejects.toMatchObject({
      code: "SNAPSHOT_SHAPE_INVALID",
    });
  });

  it.each([
    ["blank vendor", { vendor: "" }],
    ["non-string user", { user: null }],
    ["invalid fetchedAt", { fetchedAt: "1700000000000" }],
  ])("rejects invalid snapshot metadata: %s", async (_label, overrides) => {
    const inputPath = path.join(tmpDir, "bad-metadata.json");
    fs.writeFileSync(
      inputPath,
      JSON.stringify(validSnapshot(overrides)),
      "utf-8",
    );
    const a = new EmailAdapter({ snapshotMode: true });

    await expect(a.authenticate({ inputPath })).resolves.toMatchObject({
      ok: false,
      reason: "SNAPSHOT_SHAPE_INVALID",
    });
    await expect(collect(a.sync({ inputPath }))).rejects.toMatchObject({
      code: "SNAPSHOT_SHAPE_INVALID",
    });
  });

  it.each([
    ["non-object record", null],
    [
      "record without a stable messageNumber",
      {
        subject: null,
        from: null,
        to: null,
        sentDateMs: null,
        bodyPreview: null,
        hasAttachments: false,
      },
    ],
    [
      "record with the wrong field types",
      {
        messageNumber: 1,
        subject: [],
        from: null,
        to: null,
        sentDateMs: null,
        bodyPreview: null,
        hasAttachments: "false",
      },
    ],
  ])("rejects a malformed records[] entry: %s", async (_label, record) => {
    const inputPath = path.join(tmpDir, "bad-record.json");
    fs.writeFileSync(
      inputPath,
      JSON.stringify(validSnapshot({ records: [record] })),
      "utf-8",
    );
    const a = new EmailAdapter({ snapshotMode: true });

    await expect(a.authenticate({ inputPath })).resolves.toMatchObject({
      ok: false,
      reason: "SNAPSHOT_SHAPE_INVALID",
    });
    await expect(collect(a.sync({ inputPath }))).rejects.toMatchObject({
      code: "SNAPSHOT_SHAPE_INVALID",
    });
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
    fs.writeFileSync(
      inputPath,
      JSON.stringify(
        validSnapshot({
          user: "u@q.com",
          fetchedAt: Date.now(),
          records,
        }),
      ),
      "utf-8",
    );

    const a = new EmailAdapter({ snapshotMode: true });
    const raws = [];
    for await (const r of a.sync({ inputPath, limit: 3 })) raws.push(r);
    expect(raws).toHaveLength(3);
  });

  it("sync(inputPath) handles records with null sentDateMs (falls back to fetchedAt)", async () => {
    const inputPath = path.join(tmpDir, "nodate.json");
    fs.writeFileSync(
      inputPath,
      JSON.stringify(
        validSnapshot({
          user: "u@q.com",
          fetchedAt: 1_700_500_000_000,
          records: [
            {
              messageNumber: 1,
              subject: "no date",
              from: "x@x.com",
              to: "u@q.com",
              sentDateMs: null,
              bodyPreview: "",
              hasAttachments: false,
            },
          ],
        }),
      ),
      "utf-8",
    );

    const a = new EmailAdapter({ snapshotMode: true });
    const raws = [];
    for await (const r of a.sync({ inputPath })) raws.push(r);
    expect(raws).toHaveLength(1);
    expect(raws[0].capturedAt).toBe(1_700_500_000_000);
  });

  it("non-snapshot mode still requires opts.account (preserves Phase 5.1 invariant)", () => {
    expect(() => new EmailAdapter({})).toThrow(/account/);
    expect(() => new EmailAdapter({ account: { email: "u@x.com" } })).toThrow(
      /authCode/,
    );
    // But snapshot mode bypasses both:
    expect(() => new EmailAdapter({ snapshotMode: true })).not.toThrow();
  });
});
