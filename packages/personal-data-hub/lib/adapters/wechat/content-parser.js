/**
 * Phase 12 v0.5 — WeChat message.content parser.
 *
 * Frida-INDEPENDENT — operates on decrypted message rows AFTER db-reader
 * has done its job. Pure string/XML parsing.
 *
 * Handles the 6 common message types per `Adapter_WeChat_SQLCipher.md` §4.4:
 *   type=1   text
 *   type=3   image (XML w/ cdnUrl/md5/imgPath)
 *   type=34  voice .amr (XML w/ voiceLength/fileName)
 *   type=43  video (XML w/ cdnUrl)
 *   type=47  GIF/emoji (XML w/ md5/filename)
 *   type=49  composite — nested <appmsg type="N">, sub-types:
 *            2 image, 3 music, 4 video, 5 link, 6 file, 8 GIF,
 *            17 location, 19 forwarded, 21 redpacket, 33/36 mini-program,
 *            51 channel video
 *   type=10000 system message
 *
 * Output is always `{ kind, text, structured }`:
 *   - kind: short string ("text" / "image" / "voice" / "link" / etc.)
 *   - text: human-readable summary (for vault content.text)
 *   - structured: parsed fields (for vault content.extra)
 *
 * Group-message prefix `<wxid_xxx>:\n` is stripped + returned in
 * `structured.senderWxid` so the message text stays clean.
 */

"use strict";

const TYPE_NAMES = {
  1: "text",
  3: "image",
  34: "voice",
  42: "card",
  43: "video",
  47: "emoji",
  48: "location",
  49: "appmsg",
  50: "voipcall",
  10000: "system",
};

const APPMSG_SUBTYPES = {
  1: "text-link",
  2: "image-share",
  3: "music",
  4: "video",
  5: "link",
  6: "file",
  8: "gif",
  17: "location-share",
  19: "forwarded",
  21: "redpacket",
  33: "miniprogram",
  36: "miniprogram",
  51: "channel-video",
  // sjqz docs reference these higher subtype codes on newer WeChat builds —
  // accept both for forward compatibility (post-Phase 12.6 audit).
  2000: "transfer",
  2001: "redpacket",
};

/**
 * Top-level: parse a WeChat message row's content + type.
 *
 * @param {object} row  { content, type, isSend, talker, ... }
 * @returns {{ kind, text, structured }}
 */
function parseContent(row) {
  if (!row || typeof row !== "object") {
    return { kind: "unknown", text: "", structured: {} };
  }
  const type = Number(row.type);
  const isGroup = isGroupTalker(row.talker);
  const rawContent = typeof row.content === "string" ? row.content : "";

  // Strip group sender prefix
  let groupSenderWxid = null;
  let body = rawContent;
  if (isGroup) {
    const m = /^([a-zA-Z0-9_-]+):\n/.exec(rawContent);
    if (m) {
      groupSenderWxid = m[1];
      body = rawContent.slice(m[0].length);
    }
  }

  let result;
  switch (type) {
    case 1:
      result = parseText(body);
      break;
    case 3:
      result = parseImage(body);
      break;
    case 34:
      result = parseVoice(body);
      break;
    case 42:
      result = parseCard(body);
      break;
    case 43:
      result = parseVideo(body);
      break;
    case 47:
      result = parseEmoji(body);
      break;
    case 48:
      result = parseLocation(body);
      break;
    case 49:
      result = parseAppMsg(body);
      break;
    case 50:
      result = parseVoipCall(body);
      break;
    case 10000:
      result = parseSystem(body);
      break;
    default:
      result = {
        kind: TYPE_NAMES[type] || `type-${type}`,
        text: body.slice(0, 200),
        structured: { type, body: body.slice(0, 1000) },
      };
  }

  if (groupSenderWxid) {
    result.structured = { ...result.structured, senderWxid: groupSenderWxid };
  }
  return result;
}

// ─── per-type parsers ────────────────────────────────────────────────────

function parseText(body) {
  return { kind: "text", text: body, structured: {} };
}

function parseImage(body) {
  const meta = parseXmlAttrs(body, "img");
  return {
    kind: "image",
    text: "[图片]",
    structured: {
      cdnUrl: meta.cdnbigimgurl || meta.cdnmidimgurl || null,
      md5: meta.md5 || null,
      length: meta.length ? parseInt(meta.length, 10) : null,
    },
  };
}

function parseVoice(body) {
  const meta = parseXmlAttrs(body, "voicemsg");
  return {
    kind: "voice",
    text: "[语音]",
    structured: {
      fileName: meta.clientmsgid || null,
      voiceLength: meta.voicelength ? parseInt(meta.voicelength, 10) : null,
      fileType: meta.fromusername || null,
    },
  };
}

function parseCard(body) {
  const meta = parseXmlAttrs(body, "msg");
  return {
    kind: "card",
    text: `[名片] ${meta.nickname || meta.username || ""}`,
    structured: {
      nickname: meta.nickname || null,
      username: meta.username || null,
      province: meta.province || null,
      city: meta.city || null,
    },
  };
}

function parseVideo(body) {
  const meta = parseXmlAttrs(body, "videomsg");
  return {
    kind: "video",
    text: "[视频]",
    structured: {
      cdnUrl: meta.cdnvideourl || null,
      length: meta.length ? parseInt(meta.length, 10) : null,
      playLength: meta.playlength ? parseInt(meta.playlength, 10) : null,
    },
  };
}

function parseEmoji(body) {
  const meta = parseXmlAttrs(body, "emoji");
  return {
    kind: "emoji",
    text: "[表情]",
    structured: { md5: meta.md5 || null, type: meta.type || null },
  };
}

function parseLocation(body) {
  const meta = parseXmlAttrs(body, "location");
  return {
    kind: "location",
    text: `[位置] ${meta.label || meta.poiname || ""}`,
    structured: {
      x: meta.x ? parseFloat(meta.x) : null,
      y: meta.y ? parseFloat(meta.y) : null,
      label: meta.label || null,
      poiName: meta.poiname || null,
    },
  };
}

function parseAppMsg(body) {
  // Type 49: <msg><appmsg type="N"><...subtype-specific...></appmsg></msg>
  const appType = extractAppMsgType(body);
  const subtype = APPMSG_SUBTYPES[appType] || `appmsg-${appType}`;
  const title = extractTag(body, "title");
  const desc = extractTag(body, "des");
  const url = extractTag(body, "url");

  const structured = {
    appType,
    subtype,
    title: title || null,
    desc: desc || null,
    url: url || null,
  };

  // Redpacket-specific (accept both 21 and 2001 — see APPMSG_SUBTYPES)
  if (appType === 21 || appType === 2001) {
    structured.redPacketTitle = title;
  }
  // Transfer-specific
  if (appType === 2000) {
    structured.transferAmount =
      extractTag(body, "feedesc") || extractTag(body, "pay_memo");
  }
  // File-specific
  if (appType === 6) {
    structured.fileName = title;
    structured.fileSize = extractTag(body, "totallen");
  }
  // Mini program
  if (appType === 33 || appType === 36) {
    structured.miniProgramName = extractTag(body, "sourcedisplayname")
      || extractTag(body, "weappiconurl") || title;
  }

  const text = title ? `[${subtype}] ${title}` : `[${subtype}]`;
  return { kind: subtype, text, structured };
}

function parseVoipCall(body) {
  return {
    kind: "voipcall",
    text: "[通话]",
    structured: { raw: body.slice(0, 500) },
  };
}

function parseSystem(body) {
  return {
    kind: "system",
    text: body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300),
    structured: {},
  };
}

// ─── helpers ────────────────────────────────────────────────────────────

/**
 * Parse XML attributes of a named tag into a flat key-value map.
 * E.g. <img attr1="v1" attr2="v2" /> → { attr1: "v1", attr2: "v2" }.
 * Returns {} when the tag isn't found.
 */
function parseXmlAttrs(xml, tagName) {
  if (typeof xml !== "string" || xml.length === 0) return {};
  const re = new RegExp(`<${tagName}\\b([^>]*)`, "i");
  const m = re.exec(xml);
  if (!m) return {};
  const attrsText = m[1];
  const out = {};
  const attrRe = /(\w+)\s*=\s*"([^"]*)"/g;
  let am;
  while ((am = attrRe.exec(attrsText)) !== null) {
    out[am[1].toLowerCase()] = am[2];
  }
  return out;
}

/**
 * Pull the text content of a tag: <title>X</title> → "X".
 */
function extractTag(xml, tagName) {
  if (typeof xml !== "string") return null;
  const re = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const m = re.exec(xml);
  if (!m) return null;
  return decodeXmlEntities(m[1].trim());
}

function extractAppMsgType(xml) {
  if (typeof xml !== "string") return -1;
  const re = /<appmsg\s+[^>]*type\s*=\s*"(\d+)"|<type>(\d+)<\/type>/i;
  const m = re.exec(xml);
  if (!m) return -1;
  return parseInt(m[1] || m[2], 10);
}

function decodeXmlEntities(s) {
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

function isGroupTalker(talker) {
  // Group chat talker IDs end with @chatroom
  return typeof talker === "string" && talker.endsWith("@chatroom");
}

module.exports = {
  parseContent,
  parseXmlAttrs,
  extractTag,
  extractAppMsgType,
  isGroupTalker,
  TYPE_NAMES,
  APPMSG_SUBTYPES,
};
