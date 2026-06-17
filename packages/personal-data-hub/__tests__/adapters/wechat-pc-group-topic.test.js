"use strict";

import { describe, it, expect } from "vitest";

const { WeChatPcAdapter } = require("../../lib/adapters/wechat-pc");

// Build the raw envelope shape that WeChatPcAdapter.normalize() consumes for a
// group message (the sync() generator yields { kind:"message", payload, ... }).
function groupMessageRaw(payload) {
  return {
    adapter: "wechat-pc",
    kind: "message",
    originalId: "orig-1",
    capturedAt: 1780000000000,
    payload: { kind: "message", ...payload },
  };
}

describe("wechat-pc — group topic naming", () => {
  it("uses the resolved group display name for the topic when groupName is present", () => {
    const adapter = new WeChatPcAdapter();
    const out = adapter.normalize(groupMessageRaw({
      talker: "45498354778@chatroom",
      isGroup: true,
      senderWxid: "wxid_friend",
      groupName: "家庭群",
      text: "晚饭吃什么",
      createdTimeMs: 1780000000000,
    }));
    expect(out.topics).toHaveLength(1);
    // Stable id keyed on the chatroom wxid (identity unchanged)...
    expect(out.topics[0].id).toBe("topic-wechat-group-45498354778@chatroom");
    // ...but the human-readable display name is used, NOT the numeric id.
    expect(out.topics[0].name).toBe("家庭群");
  });

  it("falls back to the raw numeric id when no group name was resolved", () => {
    const adapter = new WeChatPcAdapter();
    const out = adapter.normalize(groupMessageRaw({
      talker: "45498354778@chatroom",
      isGroup: true,
      senderWxid: "wxid_friend",
      groupName: null,
      text: "hi",
      createdTimeMs: 1780000000000,
    }));
    expect(out.topics).toHaveLength(1);
    expect(out.topics[0].name).toBe("45498354778");
  });

  it("blank/whitespace group name falls back to the raw id (no empty topic name)", () => {
    const adapter = new WeChatPcAdapter();
    const out = adapter.normalize(groupMessageRaw({
      talker: "12345@chatroom",
      isGroup: true,
      senderWxid: "wxid_x",
      groupName: "   ",
      text: "hi",
      createdTimeMs: 1780000000000,
    }));
    expect(out.topics[0].name).toBe("12345");
  });
});
