"use strict";

/**
 * 企业微信 (WeChat Work / WeCom) 电脑版 — honest best-effort local IM DB reader
 * (qq-pc / dingtalk-pc / feishu-pc 模式).
 *
 * ⚠️ v0.1: 企业微信桌面本地库（C:\\Users\\<user>\\Documents\\WXWork\\...）为私有
 * 结构、通常加密（同微信 SQLCipher 系）、随版本变化。本 adapter 做到可靠开库 +
 * 发现消息表 + 防御探测列 + 保留原始行 + 响亮诊断；文本解析尽力而为，真机上按需
 * 扩展 colCandidates。建议先把库解密为明文（或采集时附带 --key）再指向它。
 */

const { createLocalImPcAdapter } = require("../_local-im-pc-adapter");

const WeWorkPcAdapter = createLocalImPcAdapter({
  name: "wework-pc",
  platform: "wework",
  version: "0.1.0",
  tablePattern: /msg|message|chat|conversation|im_|session/i,
  colCandidates: {
    // 企业微信常见列猜测（真机微调）
    time: ["createTime", "create_time", "msgCreateTime", "sendTime", "send_time", "timestamp"],
    sender: ["sender", "senderId", "fromUser", "from", "talker", "vid"],
    peer: ["conversationId", "roomId", "chatId", "talker", "toUser", "conversation"],
    content: ["content", "text", "msgContent", "message", "digest", "summary"],
  },
  needHint:
    "wework-pc: 需提供企业微信桌面本地库路径（WXWork 目录下，私有/通常加密，建议先解密为明文或提供 key）",
});

module.exports = { WeWorkPcAdapter, NAME: "wework-pc", VERSION: "0.1.0" };
