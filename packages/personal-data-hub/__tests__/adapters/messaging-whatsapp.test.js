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
    expect(VERSION).toBe("0.6.0");
    const a = new WhatsAppAdapter();
    expect(a.dataDisclosure.sensitivity).toBe("high");
    expect(a.dataDisclosure.legalGate).toBe(true);
  });
});

describe("authenticate", () => {
  it("fails DB_NOT_PULLED without a real db file", async () => {
    const a = new WhatsAppAdapter();
    const r = await a.authenticate({});
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("DB_NOT_PULLED");
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
