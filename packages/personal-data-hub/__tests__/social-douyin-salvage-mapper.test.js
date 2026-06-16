"use strict";

import { describe, it, expect } from "vitest";

const {
  mapMsgRecords,
  mapParticipantRecords,
  mapConversationRecords,
  inferMsgColumns,
  mapSalvaged,
} = require("../lib/adapters/social-douyin-adb/salvage-mapper");
const { DouyinAdapter } = require("../lib/adapters/social-douyin");

// End-to-end glue: leaf-salvaged {rowid,cols} → parseImDb shape → adapter.normalize
// → PDH entities. Closes Method-B: dump → salvage → mapper → ingest.
describe("salvage-mapper — salvaged records → PDH entities", () => {
  // msg column order (device-verified subset, see pdh-app-db-schemas.md)
  const MSG_COLS = ["msg_uuid", "conversation_id", "sender", "content", "created_time"];
  const msgRecords = [
    { rowid: "1", cols: ["u1", "conv-1", 111, JSON.stringify({ text: "你好呀 hello" }), 1700000000000] },
    { rowid: "2", cols: ["u2", "conv-1", 222, JSON.stringify({ text: "在吗" }), 1700000001000] },
  ];

  it("maps msg records → message objects (im-db-parser shape)", () => {
    const msgs = mapMsgRecords(msgRecords, MSG_COLS);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].senderUid).toBe("111");
    expect(msgs[0].conversationId).toBe("conv-1");
    expect(msgs[0].createdTimeMs).toBe(1700000000000);
    expect(msgs[0].text).toBe("你好呀 hello"); // content JSON → text extracted
  });

  it("mapped messages normalize through DouyinAdapter → MESSAGE events", () => {
    const a = new DouyinAdapter();
    const msgs = mapMsgRecords(msgRecords, MSG_COLS);
    const raw = {
      adapter: "social-douyin",
      kind: "message",
      originalId: "douyin:message:x",
      capturedAt: msgs[0].createdTimeMs,
      payload: { kind: "message", ...msgs[0] },
    };
    const n = a.normalize(raw);
    expect(n.events).toHaveLength(1);
    expect(n.events[0].subtype).toBe("message");
    expect(n.events[0].content.text).toBe("你好呀 hello");
    expect(n.events[0].extra.senderUid).toBe("111");
  });

  it("maps participant records → deduped contacts (uid only)", () => {
    const recs = [
      { rowid: "1", cols: ["conv-1", "111", 0] },
      { rowid: "2", cols: ["conv-1", "222", 1] },
      { rowid: "3", cols: ["conv-2", "222", 0] },
    ];
    const contacts = mapParticipantRecords(recs, ["conversation_id", "user_id", "sort_order"]);
    expect(contacts.map((c) => c.uid).sort()).toEqual(["111", "222"]);
    expect(contacts.every((c) => c.fromParticipant)).toBe(true);
  });

  it("maps conversation records → conversations (→ TOPIC)", () => {
    const recs = [{ rowid: "1", cols: ["conv-9", 1, 1700000002000, 1] }];
    const convs = mapConversationRecords(recs, ["conversation_id", "type", "last_msg_create_time", "stranger"]);
    expect(convs[0].conversationId).toBe("conv-9");
    expect(convs[0].stranger).toBe(true);
    expect(convs[0].lastMsgTimeMs).toBe(1700000002000);
  });

  it("inferMsgColumns heuristically locates content + created_time", () => {
    const cols = inferMsgColumns(msgRecords);
    // content = the JSON string col (index 3), created_time = the epoch int (index 4)
    expect(cols[3]).toBe("content");
    expect(cols[4]).toBe("created_time");
    // round-trips through mapMsgRecords
    const msgs = mapMsgRecords(msgRecords, cols);
    expect(msgs[0].text).toBe("你好呀 hello");
    expect(msgs[0].createdTimeMs).toBe(1700000000000);
  });

  it("mapSalvaged one-shot returns parseImDb shape", () => {
    const out = mapSalvaged({
      msg: { records: msgRecords, columns: MSG_COLS },
      participant: { records: [{ rowid: "1", cols: ["conv-1", "999"] }], columns: ["conversation_id", "user_id"] },
      conversation: { records: [{ rowid: "1", cols: ["conv-1"] }], columns: ["conversation_id"] },
    });
    expect(out.messages).toHaveLength(2);
    expect(out.contacts).toHaveLength(1);
    expect(out.conversations).toHaveLength(1);
  });
});
