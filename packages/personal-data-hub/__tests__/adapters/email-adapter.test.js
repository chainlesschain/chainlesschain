"use strict";

import { describe, it, expect } from "vitest";

const {
  EmailAdapter,
  parseWatermark,
  formatWatermark,
} = require("../../lib/adapters/email-imap/email-adapter");
const { assertAdapter } = require("../../lib/adapter-spec");
const { validateBatch } = require("../../lib/batch");

function makeMockSession(spec = {}) {
  const recorder = {
    constructorArgs: null,
    connectCalls: 0,
    closedCalls: 0,
    openedMailboxes: [],
    fetchRanges: [],
  };
  const factory = (opts) => {
    recorder.constructorArgs = opts;
    let openMb = null;
    return {
      async connect() {
        recorder.connectCalls += 1;
        if (spec.connectThrows) throw spec.connectThrows;
      },
      async openMailbox(name) {
        recorder.openedMailboxes.push(name);
        const mb = spec.mailboxes && spec.mailboxes[name];
        if (!mb) {
          const err = new Error(`Mailbox doesn't exist: ${name}`);
          err.code = "MAILBOX_NOT_FOUND";
          throw err;
        }
        openMb = { name, ...mb };
        return {
          uidValidity: mb.uidValidity,
          uidNext: mb.uidNext || 9999,
          exists: (mb.envelopes || []).length,
        };
      },
      async *fetchEnvelopesSince(sinceUid = 0) {
        recorder.fetchRanges.push({ mailbox: openMb && openMb.name, sinceUid });
        if (!openMb) return;
        for (const env of openMb.envelopes || []) {
          if (env.uid > sinceUid) yield env;
        }
      },
      async close() {
        recorder.closedCalls += 1;
      },
    };
  };
  return { factory, recorder };
}

const env = (uid, overrides = {}) => ({
  uid,
  internalDate: new Date(`2026-04-${String(uid % 30).padStart(2, "0")}T10:00:00Z`),
  flags: ["\\Seen"],
  messageId: `<msg-${uid}@example.com>`,
  subject: `Subject ${uid}`,
  from: [{ name: "Alice", address: `alice${uid}@example.com` }],
  to: [{ name: "Me", address: "me@example.com" }],
  cc: [],
  date: new Date(`2026-04-${String(uid % 30).padStart(2, "0")}T10:00:00Z`),
  size: 1024,
  ...overrides,
});

describe("EmailAdapter contract", () => {
  it("conforms to PersonalDataAdapter spec", () => {
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "abc123" },
      sessionFactory: makeMockSession({}).factory,
    });
    const r = assertAdapter(a);
    expect(r.ok).toBe(true);
    if (!r.ok) console.log(r.errors);
  });

  it("exposes the canonical name + version + capabilities", () => {
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "x" },
      sessionFactory: makeMockSession({}).factory,
    });
    expect(a.name).toBe("email-imap");
    expect(a.version).toBe("0.1.0");
    expect(a.capabilities).toContain("sync:imap");
    expect(a.capabilities).toContain("auth:authcode");
    expect(a.dataDisclosure.sensitivity).toBe("high");
  });

  it("rejects missing or malformed account", () => {
    expect(() => new EmailAdapter()).toThrow();
    expect(() => new EmailAdapter({})).toThrow(/account/);
    expect(() => new EmailAdapter({ account: {} })).toThrow(/email/);
    expect(() => new EmailAdapter({ account: { email: "noatsign" } })).toThrow(/email/);
    expect(() => new EmailAdapter({ account: { email: "u@x.com" } })).toThrow(/authCode/);
  });
});

describe("EmailAdapter.authenticate", () => {
  it("returns ok:true when connect succeeds", async () => {
    const { factory, recorder } = makeMockSession({});
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "x" },
      sessionFactory: factory,
    });
    const r = await a.authenticate();
    expect(r.ok).toBe(true);
    expect(r.account).toBe("u@qq.com");
    expect(r.provider).toBe("qq");
    expect(recorder.connectCalls).toBe(1);
    expect(recorder.closedCalls).toBe(1);
  });

  it("returns ok:false reason=AUTH_FAILED on credential error", async () => {
    const { ImapAuthFailedError } = require("../../lib/adapters/email-imap/imap-session");
    const { factory } = makeMockSession({
      connectThrows: new ImapAuthFailedError("bad pass"),
    });
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "wrong" },
      sessionFactory: factory,
    });
    const r = await a.authenticate();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("AUTH_FAILED");
  });

  it("returns ok:false reason=CONNECTION_FAILED on network error", async () => {
    const { ImapConnectionFailedError } = require("../../lib/adapters/email-imap/imap-session");
    const { factory } = makeMockSession({
      connectThrows: new ImapConnectionFailedError("ECONNREFUSED"),
    });
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "x" },
      sessionFactory: factory,
    });
    const r = await a.authenticate();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("CONNECTION_FAILED");
  });
});

describe("EmailAdapter.healthCheck", () => {
  it("matches the registry's expected shape on success", async () => {
    const { factory } = makeMockSession({});
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "x" },
      sessionFactory: factory,
    });
    const r = await a.healthCheck();
    expect(r.ok).toBe(true);
    expect(r.lastChecked).toBeGreaterThan(0);
  });

  it("matches the registry's expected shape on failure", async () => {
    const { factory } = makeMockSession({
      connectThrows: new Error("Authentication invalid"),
    });
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "x" },
      sessionFactory: factory,
    });
    const r = await a.healthCheck();
    expect(r.ok).toBe(false);
    expect(r.reason).toBeDefined();
  });
});

describe("EmailAdapter.sync", () => {
  it("yields one RawEvent per envelope across all default folders", async () => {
    const { factory, recorder } = makeMockSession({
      mailboxes: {
        INBOX: { uidValidity: 1, envelopes: [env(1), env(2), env(3)] },
        "Sent Messages": { uidValidity: 1, envelopes: [env(10), env(11)] },
      },
    });
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "x" },
      sessionFactory: factory,
    });
    const raws = [];
    for await (const r of a.sync()) raws.push(r);
    expect(raws).toHaveLength(5);
    expect(raws.every((r) => r.adapter === "email-imap")).toBe(true);
    expect(raws.every((r) => r.payload.uid > 0)).toBe(true);
    expect(recorder.openedMailboxes).toEqual(["INBOX", "Sent Messages"]);
  });

  it("originalId uses Message-ID when present", async () => {
    const { factory } = makeMockSession({
      mailboxes: { INBOX: { uidValidity: 1, envelopes: [env(1)] } },
    });
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "x", folders: ["INBOX"] },
      sessionFactory: factory,
    });
    const raws = [];
    for await (const r of a.sync()) raws.push(r);
    expect(raws[0].originalId).toBe("<msg-1@example.com>");
  });

  it("falls back to synthetic originalId when Message-ID missing", async () => {
    const { factory } = makeMockSession({
      mailboxes: {
        INBOX: { uidValidity: 1, envelopes: [env(7, { messageId: "" })] },
      },
    });
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "x", folders: ["INBOX"] },
      sessionFactory: factory,
    });
    const raws = [];
    for await (const r of a.sync()) raws.push(r);
    expect(raws[0].originalId).toContain("mid-fallback");
    expect(raws[0].originalId).toContain("INBOX");
    expect(raws[0].originalId).toContain(":7");
  });

  it("respects sinceWatermark (UID > lastUid)", async () => {
    const { factory } = makeMockSession({
      mailboxes: {
        INBOX: { uidValidity: 1, envelopes: [env(1), env(2), env(3), env(4)] },
      },
    });
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "x", folders: ["INBOX"] },
      sessionFactory: factory,
    });
    const raws = [];
    for await (const r of a.sync({ sinceWatermark: "1:2" })) raws.push(r);
    expect(raws.map((r) => r.payload.uid)).toEqual([3, 4]);
  });

  it("resets sinceUid to 0 when UIDVALIDITY changed (full re-scan)", async () => {
    const { factory } = makeMockSession({
      mailboxes: {
        INBOX: { uidValidity: 99, envelopes: [env(1), env(2)] },
      },
    });
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "x", folders: ["INBOX"] },
      sessionFactory: factory,
    });
    const raws = [];
    for await (const r of a.sync({ sinceWatermark: "42:100" })) raws.push(r);
    expect(raws).toHaveLength(2);
    expect(raws.map((r) => r.payload.uid).sort()).toEqual([1, 2]);
  });

  it("respects maxPerFolder cap", async () => {
    const big = Array.from({ length: 50 }, (_, i) => env(i + 1));
    const { factory } = makeMockSession({
      mailboxes: { INBOX: { uidValidity: 1, envelopes: big } },
    });
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "x", folders: ["INBOX"] },
      sessionFactory: factory,
    });
    const raws = [];
    for await (const r of a.sync({ maxPerFolder: 7 })) raws.push(r);
    expect(raws).toHaveLength(7);
  });

  it("closes session even when sync throws mid-stream", async () => {
    let closed = false;
    const exploding = {
      async connect() {},
      async openMailbox() {
        return { uidValidity: 1, uidNext: 100, exists: 0 };
      },
      async *fetchEnvelopesSince() {
        yield env(1);
        throw new Error("network drop");
      },
      async close() {
        closed = true;
      },
    };
    const factory = () => exploding;
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "x", folders: ["INBOX"] },
      sessionFactory: factory,
    });
    const raws = [];
    await expect(async () => {
      for await (const r of a.sync()) raws.push(r);
    }).rejects.toThrow(/network drop/);
    expect(closed).toBe(true);
    expect(raws).toHaveLength(1);
  });
});

describe("EmailAdapter.normalize", () => {
  it("produces a valid UnifiedSchema batch (1 Event + 1 Person per email)", () => {
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "x" },
      sessionFactory: makeMockSession({}).factory,
    });
    const raw = {
      adapter: "email-imap",
      originalId: "<msg-1@example.com>",
      capturedAt: 1700000000000,
      payload: { ...env(1), folder: "INBOX" },
    };
    const batch = a.normalize(raw);
    expect(batch.events).toHaveLength(1);
    expect(batch.persons).toHaveLength(1);
    expect(batch.places).toEqual([]);
    expect(batch.items).toEqual([]);

    const ev = batch.events[0];
    expect(ev.type).toBe("event");
    expect(ev.subtype).toBe("message");
    expect(ev.content.title).toBe("Subject 1");
    expect(ev.content.text).toContain("alice1@example.com");
    expect(ev.extra.emailFolder).toBe("INBOX");
    expect(ev.extra.uid).toBe(1);
    expect(ev.source.adapter).toBe("email-imap");

    const p = batch.persons[0];
    expect(p.id).toBe("person-email-alice1@example.com");
    expect(p.identifiers.email).toEqual(["alice1@example.com"]);
    expect(p.names).toEqual(["Alice"]);

    const valid = validateBatch(batch);
    expect(valid.valid).toBe(true);
    if (!valid.valid) console.log(valid.errors);
  });

  it("handles missing subject + missing from gracefully", () => {
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "x" },
      sessionFactory: makeMockSession({}).factory,
    });
    const raw = {
      adapter: "email-imap",
      originalId: "<m@x>",
      capturedAt: 0,
      payload: { ...env(2, { subject: "", from: [] }), folder: "INBOX" },
    };
    const batch = a.normalize(raw);
    expect(batch.events[0].content.title).toBe("(no subject)");
    expect(batch.persons).toHaveLength(0);
    expect(batch.events[0].actor).toBe("person-self");
    const v = validateBatch(batch);
    expect(v.valid).toBe(true);
  });

  it("dedups same sender across multiple emails (stable person id)", () => {
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "x" },
      sessionFactory: makeMockSession({}).factory,
    });
    const senderEnv = (uid) => env(uid, {
      from: [{ name: "Bob", address: "bob@example.com" }],
      messageId: `<m-${uid}@x>`,
    });
    const b1 = a.normalize({ adapter: "email-imap", originalId: "<m-1@x>", capturedAt: 0, payload: { ...senderEnv(1), folder: "INBOX" } });
    const b2 = a.normalize({ adapter: "email-imap", originalId: "<m-2@x>", capturedAt: 0, payload: { ...senderEnv(2), folder: "INBOX" } });
    expect(b1.persons[0].id).toBe(b2.persons[0].id);
    expect(b1.persons[0].id).toBe("person-email-bob@example.com");
  });

  it("rejects missing raw or payload", () => {
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "x" },
      sessionFactory: makeMockSession({}).factory,
    });
    expect(() => a.normalize()).toThrow();
    expect(() => a.normalize({})).toThrow(/payload/);
  });
});

describe("parseWatermark / formatWatermark", () => {
  it("parses well-formed strings", () => {
    expect(parseWatermark("42:100")).toEqual({ uidValidity: "42", lastUid: 100 });
    expect(parseWatermark("abc:0")).toEqual({ uidValidity: "abc", lastUid: 0 });
  });

  it("falls back to null/0 for malformed input", () => {
    expect(parseWatermark("")).toEqual({ uidValidity: null, lastUid: 0 });
    expect(parseWatermark("no-colon")).toEqual({ uidValidity: null, lastUid: 0 });
    expect(parseWatermark(null)).toEqual({ uidValidity: null, lastUid: 0 });
  });

  it("formats correctly", () => {
    expect(formatWatermark(42, 100)).toBe("42:100");
    expect(formatWatermark("abc", 0)).toBe("abc:0");
    expect(formatWatermark(null, 5)).toBe(":5");
  });
});
