"use strict";

import { describe, it, expect } from "vitest";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { WhatsAppAdapter } = require("../lib");
const { assertAdapter } = require("../lib/adapter-spec");
const { validateBatch } = require("../lib/batch");

function makeMockDriver(scriptedRows) {
  return function () {
    return {
      prepare(sql) {
        return {
          all() {
            for (const [matchSubstr, rows] of scriptedRows) {
              if (sql.includes(matchSubstr)) return rows;
            }
            throw new Error("no such table");
          },
        };
      },
      close() {},
    };
  };
}

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wa-"));
  const dbPath = path.join(dir, "msgstore.db");
  fs.writeFileSync(dbPath, "fake");
  return { dir, dbPath };
}

describe("WhatsAppAdapter", () => {
  it("contract conformance", () => {
    const a = new WhatsAppAdapter({ account: { phone: "13800001111" } });
    expect(assertAdapter(a).ok).toBe(true);
    expect(a.extractMode).toBe("device-pull");
    expect(a.dataDisclosure.legalGate).toBe(true);
  });

  it("rejects missing account.phone", () => {
    expect(() => new WhatsAppAdapter({ account: {} })).toThrow(/phone/);
  });

  it("authenticate fails without DB", async () => {
    const a = new WhatsAppAdapter({ account: { phone: "1" } });
    const r = await a.authenticate();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("DB_NOT_PULLED");
  });

  it("sync yields contact + chat + message + call", async () => {
    const { dir, dbPath } = tmpDb();
    try {
      const mockDriver = makeMockDriver([
        ["FROM jid", [
          { _id: 1, user: "13800001111", display_name: "Alice", raw_string: "13800001111@s.whatsapp.net" },
          { _id: 2, user: "group", display_name: "Group A", raw_string: "123456@g.us" },
        ]],
        ["FROM chat", [{ _id: 1, subject: "Chat 1" }]],
        ["FROM message", [
          { _id: 1, key_remote_jid: "1", text_data: "Hi", timestamp: 1700000000, from_me: 0 },
        ]],
        ["FROM messages", []],
        ["FROM call_log", [
          { _id: 1, jid_row_id: 1, video_call: 0, duration: 60, from_me: 1, timestamp: 1700001000, call_result: "completed" },
        ]],
      ]);
      const a = new WhatsAppAdapter({
        account: { phone: "13800001111" },
        dbPath,
        dbDriverFactory: () => mockDriver,
      });
      const raws = [];
      for await (const r of a.sync()) raws.push(r);
      // 2 jid contacts + 1 chat + 1 message + 1 call = 5
      expect(raws.length).toBe(5);
      const contacts = raws.filter((r) => r.payload.kind === "contact");
      const calls = raws.filter((r) => r.payload.kind === "call");
      expect(contacts).toHaveLength(2);
      expect(calls).toHaveLength(1);

      // Normalize all + validate
      for (const r of raws) {
        const batch = a.normalize(r);
        expect(validateBatch(batch).valid).toBe(true);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("group jid → Topic not Person", async () => {
    const a = new WhatsAppAdapter({ account: { phone: "1" } });
    const batch = a.normalize({
      adapter: "messaging-whatsapp",
      originalId: "jid-2",
      capturedAt: Date.now(),
      payload: { kind: "contact", row: { _id: 2, raw_string: "123456@g.us", display_name: "Group A" } },
    });
    expect(batch.topics).toHaveLength(1);
    expect(batch.persons).toHaveLength(0);
  });

  it("individual jid → Person with phone identifier", async () => {
    const a = new WhatsAppAdapter({ account: { phone: "1" } });
    const batch = a.normalize({
      adapter: "messaging-whatsapp",
      originalId: "jid-1",
      capturedAt: Date.now(),
      payload: { kind: "contact", row: { _id: 1, user: "13800001111", display_name: "Alice", raw_string: "13800001111@s.whatsapp.net" } },
    });
    expect(batch.persons).toHaveLength(1);
    expect(batch.persons[0].identifiers.phone).toEqual(["13800001111"]);
  });

  it("call event captures duration + video flag", async () => {
    const a = new WhatsAppAdapter({ account: { phone: "1" } });
    const batch = a.normalize({
      adapter: "messaging-whatsapp",
      originalId: "call-1",
      capturedAt: Date.now(),
      payload: { kind: "call", row: { _id: 1, jid_row_id: 1, video_call: 1, duration: 300, from_me: 1, timestamp: 1700001000 } },
    });
    expect(batch.events[0].subtype).toBe("call");
    expect(batch.events[0].extra.duration).toBe(300);
    expect(batch.events[0].extra.isVideo).toBe(true);
    expect(batch.events[0].extra.fromMe).toBe(true);
  });
});
