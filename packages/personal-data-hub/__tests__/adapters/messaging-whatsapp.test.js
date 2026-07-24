"use strict";

import { describe, it, expect } from "vitest";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const {
  WhatsAppAdapter,
  NAME,
  VERSION,
} = require("../../lib/adapters/messaging-whatsapp");

function writeTmpDb() {
  const p = path.join(
    os.tmpdir(),
    `cc-whatsapp-test-${crypto.randomUUID()}.db`,
  );
  fs.writeFileSync(p, "fake");
  return p;
}

async function collect(gen) {
  const out = [];
  for await (const x of gen) out.push(x);
  return out;
}

function makeFakeDriverFactory(tables, log = {}) {
  return () =>
    class FakeDb {
      constructor(dbPath, opts) {
        log.opened = { dbPath, opts };
      }
      prepare(sql) {
        for (const [needle, rows] of Object.entries(tables)) {
          if (sql.includes(needle)) return { all: () => rows };
        }
        throw new Error(`no such table in: ${sql}`);
      }
      close() {
        log.closed = true;
      }
    };
}

describe("constants", () => {
  it("exposes name/version + high sensitivity & legal gate", () => {
    expect(NAME).toBe("messaging-whatsapp");
    expect(VERSION).toBe("0.8.0");
    const a = new WhatsAppAdapter();
    expect(a.dataDisclosure.sensitivity).toBe("high");
    expect(a.dataDisclosure.legalGate).toBe(true);
    expect(a.capabilities).toContain("decrypt:whatsapp-crypt14");
    expect(a.capabilities).toContain("decrypt:whatsapp-crypt15");
    expect(a.capabilities).toContain("sync:adb-public-backup");
  });
});

describe("authenticate", () => {
  it("fails DB_NOT_PULLED without a real db file", async () => {
    const a = new WhatsAppAdapter();
    const r = await a.authenticate({});
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("DB_NOT_PULLED");
  });

  it("advertises ADB pull readiness when a bridge is wired", async () => {
    const a = new WhatsAppAdapter({ bridgeProvider: () => ({ invoke() {} }) });
    const r = await a.authenticate({});
    expect(r).toMatchObject({ ok: false, reason: "ADB_PULL_REQUIRED" });
  });

  it("ok when dbPath exists (inputPath alias too)", async () => {
    const p = writeTmpDb();
    try {
      const a = new WhatsAppAdapter({ account: { phone: "8613800138000" } });
      expect(await a.authenticate({ inputPath: p })).toEqual({
        ok: true,
        account: "8613800138000",
        mode: "snapshot-file",
      });
      expect(await a.healthCheck({ inputPath: p })).toMatchObject({
        ok: true,
      });
    } finally {
      fs.unlinkSync(p);
    }
  });
});

describe("sync — fake sqlite driver", () => {
  const JID_ROW = {
    _id: 1,
    user: "8613800138000",
    raw_string: "8613800138000@s.whatsapp.net",
    display_name: "Alice",
  };
  const CHAT_ROW = { _id: 2, subject: "Family group" };
  const MSG_ROW = {
    _id: 3,
    key_remote_jid: "8613800138000@s.whatsapp.net",
    from_me: 1,
    text_data: "hello",
    timestamp: 1716383021, // seconds
  };
  const CALL_ROW = {
    _id: 4,
    jid_row_id: 1,
    from_me: 0,
    video_call: 1,
    duration: 65,
    timestamp: 1716383021000,
  };

  it("yields contact/chat/message/call rows with kind tags, closes db", async () => {
    const p = writeTmpDb();
    const log = {};
    try {
      const a = new WhatsAppAdapter({
        dbPath: p,
        dbDriverFactory: makeFakeDriverFactory(
          {
            "FROM jid": [JID_ROW],
            "FROM chat": [CHAT_ROW],
            "FROM message ": [MSG_ROW],
            "FROM call_log": [CALL_ROW],
          },
          log,
        ),
      });
      const items = await collect(a.sync({}));
      expect(items.map((i) => i.originalId)).toEqual([
        "jid-1",
        "chat-2",
        "msg-3",
        "call-4",
      ]);
      expect(items.map((i) => i.payload.kind)).toEqual([
        "contact",
        "chat",
        "message",
        "call",
      ]);
      // message timestamp seconds → ms
      expect(items[2].capturedAt).toBe(1716383021 * 1000);
      expect(log.opened.opts).toEqual({ readonly: true });
      expect(log.closed).toBe(true);
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("falls back to legacy `messages` table when `message` missing", async () => {
    const p = writeTmpDb();
    try {
      const a = new WhatsAppAdapter({
        dbPath: p,
        dbDriverFactory: makeFakeDriverFactory({
          "FROM jid": [],
          "FROM chat": [],
          "FROM messages ": [MSG_ROW],
          "FROM call_log": [],
        }),
      });
      const items = await collect(a.sync({}));
      expect(items).toHaveLength(1);
      expect(items[0].payload.kind).toBe("message");
      expect(items[0].payload.schema).toBe("legacy");
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("merges modern and legacy tables, resolves relations, and deduplicates key_id", async () => {
    const p = writeTmpDb();
    const modern = {
      _id: 7,
      key_id: "same-key",
      chat_row_id: 2,
      chat_jid: "1234@g.us",
      sender_jid: "86139@s.whatsapp.net",
      from_me: 0,
      text_data: "photo",
      timestamp: 1716383021000,
    };
    try {
      const a = new WhatsAppAdapter({
        dbPath: p,
        dbDriverFactory: makeFakeDriverFactory({
          "FROM jid": [],
          "FROM chat": [],
          "FROM message_media": [{ message_row_id: 7, mime_type: "image/jpeg", file_path: "/media/a.jpg" }],
          "FROM message_location": [{ message_row_id: 7, latitude: 31.2, longitude: 121.5, place_name: "Shanghai" }],
          "FROM message_vcard": [{ message_row_id: 7, vcard: "BEGIN:VCARD" }],
          "FROM message_quoted": [{ message_row_id: 7, text_data: "quoted" }],
          "FROM message\n": [modern],
          "FROM messages ": [
            { _id: 7, key_id: "same-key", key_from_me: 0, data: "duplicate", timestamp: 1 },
            { _id: 7, key_id: "legacy-only", key_from_me: 1, data: "old", timestamp: 2 },
          ],
          "FROM call_log": [],
        }),
      });
      const items = await collect(a.sync({}));
      const messages = items.filter((item) => item.payload.kind === "message");
      expect(messages.map((item) => item.originalId)).toEqual(["msg-7", "msg-legacy-7"]);
      expect(messages.map((item) => item.payload.schema)).toEqual(["modern", "legacy"]);
      expect(messages[0].payload.row).toMatchObject({
        chat_jid: "1234@g.us",
        sender_jid: "86139@s.whatsapp.net",
        _media: { mime_type: "image/jpeg" },
        _location: { place_name: "Shanghai" },
        _vcards: [{ vcard: "BEGIN:VCARD" }],
        _quoted: { text_data: "quoted" },
      });
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("returns silently when db file missing", async () => {
    const a = new WhatsAppAdapter({
      dbPath: path.join(os.tmpdir(), "nonexistent-wa.db"),
      dbDriverFactory: makeFakeDriverFactory({}),
    });
    expect(await collect(a.sync({}))).toEqual([]);
  });
});

describe("normalize", () => {
  const a = new WhatsAppAdapter();

  it("personal jid → contact person with digits-only phone identifier", () => {
    const batch = a.normalize({
      originalId: "jid-1",
      payload: {
        kind: "contact",
        row: {
          _id: 1,
          user: "+86 138-0013-8000",
          raw_string: "8613800138000@s.whatsapp.net",
          display_name: "Alice",
        },
      },
    });
    const person = batch.persons[0];
    expect(person.id).toBe("person-whatsapp-8613800138000@s.whatsapp.net");
    expect(person.subtype).toBe("contact");
    expect(person.names).toEqual(["Alice", "+86 138-0013-8000"]);
    expect(person.identifiers).toEqual({ phone: ["8613800138000"] });
    expect(batch.topics).toEqual([]);
  });

  it("group jid (@g.us) → topic, not person", () => {
    const batch = a.normalize({
      originalId: "jid-9",
      payload: {
        kind: "contact",
        row: {
          _id: 9,
          raw_string: "1234-5678@g.us",
          display_name: "Family group",
        },
      },
    });
    expect(batch.persons).toEqual([]);
    expect(batch.topics[0]).toMatchObject({
      id: "topic-whatsapp-1234-5678@g.us",
      name: "Family group",
    });
  });

  it("chat row → topic named by subject", () => {
    const batch = a.normalize({
      originalId: "chat-2",
      payload: { kind: "chat", row: { _id: 2, subject: "Work chat" } },
    });
    expect(batch.topics[0]).toMatchObject({
      id: "topic-whatsapp-chat-2",
      name: "Work chat",
    });
  });

  it("outgoing message → message event from person-self, title truncated to 80", () => {
    const longText = "x".repeat(200);
    const batch = a.normalize({
      originalId: "msg-3",
      payload: {
        kind: "message",
        row: {
          _id: 3,
          key_remote_jid: "8613800138000@s.whatsapp.net",
          from_me: 1,
          text_data: longText,
          timestamp: 1716383021000,
        },
      },
    });
    const ev = batch.events[0];
    expect(ev.subtype).toBe("message");
    expect(ev.actor).toBe("person-self");
    expect(ev.occurredAt).toBe(1716383021000);
    expect(ev.content.title).toHaveLength(80);
    expect(ev.content.text).toHaveLength(200);
    expect(ev.extra.isOutgoing).toBe(true);
  });

  it("incoming empty message → '(空)' title, actor from jid", () => {
    const batch = a.normalize({
      originalId: "msg-4",
      payload: {
        kind: "message",
        row: {
          _id: 4,
          key_remote_jid: "86139@s.whatsapp.net",
          from_me: 0,
          timestamp: 1716383021000,
        },
      },
    });
    const ev = batch.events[0];
    expect(ev.content.title).toBe("(空)");
    expect(ev.actor).toBe("person-whatsapp-86139@s.whatsapp.net");
    expect(ev.extra.isOutgoing).toBe(false);
  });

  it("modern message resolves group sender, media, location, vcard and quote", () => {
    const batch = a.normalize({
      originalId: "msg-8",
      payload: {
        kind: "message",
        schema: "modern",
        row: {
          _id: 8,
          chat_row_id: 2,
          chat_jid: "1234@g.us",
          sender_jid: "86139@s.whatsapp.net",
          from_me: 0,
          message_type: 1,
          text_data: "",
          timestamp: 1716383021000,
          _media: { mime_type: "image/jpeg", media_name: "photo.jpg", file_path: "/media/photo.jpg" },
          _location: { latitude: 31.2, longitude: 121.5, place_name: "Shanghai", place_address: "Pudong" },
          _vcards: [{ vcard: "BEGIN:VCARD" }],
          _quoted: { text_data: "quoted" },
        },
      },
    });
    const ev = batch.events[0];
    expect(ev.actor).toBe("person-whatsapp-86139@s.whatsapp.net");
    expect(ev.topics).toEqual(["topic-whatsapp-chat-2"]);
    expect(ev.place).toBe("place-whatsapp-8");
    expect(ev.content).toMatchObject({
      title: "photo.jpg",
      text: "photo.jpg",
      mediaRefs: ["/media/photo.jpg"],
    });
    expect(ev.extra).toMatchObject({
      jid: "1234@g.us",
      senderJid: "86139@s.whatsapp.net",
      mediaType: "image/jpeg",
      vcards: [{ vcard: "BEGIN:VCARD" }],
      quotedMessage: { text_data: "quoted" },
    });
    expect(batch.places[0]).toMatchObject({
      name: "Shanghai",
      coordinates: { lat: 31.2, lng: 121.5 },
      address: "Pudong",
    });
  });

  it("incoming video call → call event with duration/isVideo extras", () => {
    const batch = a.normalize({
      originalId: "call-5",
      payload: {
        kind: "call",
        row: {
          _id: 5,
          jid_row_id: 1,
          from_me: 0,
          video_call: 1,
          duration: 65,
          timestamp: 1716383021000,
        },
      },
    });
    const ev = batch.events[0];
    expect(ev.subtype).toBe("call");
    expect(ev.content.title).toBe("WhatsApp call (video)");
    expect(ev.actor).toBe("person-whatsapp-1");
    expect(ev.extra).toMatchObject({ duration: 65, isVideo: true, fromMe: false });
  });
});
