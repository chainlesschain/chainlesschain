"use strict";

/**
 * 飞书 (Feishu / Lark) 电脑版 — honest best-effort local IM DB reader (qq-pc 模式).
 *
 * ⚠️ v0.1: 飞书桌面本地库为私有结构、可能加密、随版本变化。同 dingtalk-pc：
 * 可靠开库 + 发现消息表 + 防御探测列 + 保留原始行 + 响亮诊断；真机上扩展
 * colCandidates。建议先解密为明文再指向它。
 */

const { createLocalImPcAdapter } = require("../_local-im-pc-adapter");

const FeishuPcAdapter = createLocalImPcAdapter({
  name: "feishu-pc",
  platform: "feishu",
  version: "0.1.0",
  tablePattern: /msg|message|chat|conversation/i,
  colCandidates: {
    // 飞书常见列猜测（真机微调）
    time: ["createTime", "create_time", "updateTime", "msgTime"],
    sender: ["fromId", "senderId", "from_user_id", "sender"],
    peer: ["chatId", "chat_id", "channelId", "conversationId"],
    content: ["content", "text", "body", "richText"],
  },
  needHint:
    "feishu-pc: 需提供飞书桌面本地库路径（私有/可能加密，建议先解密为明文或提供 key）",
});

module.exports = { FeishuPcAdapter, NAME: "feishu-pc", VERSION: "0.1.0" };
