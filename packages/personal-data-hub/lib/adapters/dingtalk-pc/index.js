"use strict";

/**
 * 钉钉 (DingTalk) 电脑版 — honest best-effort local IM DB reader (qq-pc 模式).
 *
 * ⚠️ v0.1: 钉钉桌面本地库为私有结构、可能加密、随版本变化。本 adapter 做到
 * 可靠开库 + 发现消息表 + 防御探测列 + 保留原始行 + 响亮诊断；文本解析尽力
 * 而为，真机上按需扩展 colCandidates。建议先把库解密为明文再指向它。
 */

const { createLocalImPcAdapter } = require("../_local-im-pc-adapter");

const DingTalkPcAdapter = createLocalImPcAdapter({
  name: "dingtalk-pc",
  platform: "dingtalk",
  version: "0.1.0",
  tablePattern: /msg|message|chat|conversation|im_/i,
  colCandidates: {
    // 钉钉常见列猜测（真机微调）
    time: ["createAt", "create_at", "sendTime", "send_time", "msgCreateTime"],
    sender: ["senderId", "sender", "fromUid", "creatorId"],
    peer: ["conversationId", "cid", "openConversationId"],
    content: ["content", "text", "msgContent", "summary"],
  },
  needHint:
    "dingtalk-pc: 需提供钉钉桌面本地库路径（私有/可能加密，建议先解密为明文或提供 key）",
});

module.exports = { DingTalkPcAdapter, NAME: "dingtalk-pc", VERSION: "0.1.0" };
