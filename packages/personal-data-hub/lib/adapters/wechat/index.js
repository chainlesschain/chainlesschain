"use strict";

const { WechatAdapter, NAME, VERSION } = require("./wechat-adapter");
const { parseContent, parseXmlAttrs, extractTag, isGroupTalker, TYPE_NAMES, APPMSG_SUBTYPES } = require("./content-parser");
const { extractWeChatKey, deriveLegacyKey, extractUinFromPrefs, extractImeiFromCompatibleInfo } = require("./key-extractor");
const { WeChatDBReader, KNOWN_PRAGMA_PROFILES } = require("./db-reader");
const { normalizeMessage, normalizeContact, wxidToPersonId } = require("./normalize");
const { KeyProvider, MD5KeyProvider, FridaKeyProvider } = require("./key-providers");
const envProbe = require("./env-probe");
const { bootstrapWechatAdapter } = require("./bootstrap");

module.exports = {
  WechatAdapter,
  WECHAT_NAME: NAME,
  WECHAT_VERSION: VERSION,
  parseWeChatContent: parseContent,
  parseWeChatXmlAttrs: parseXmlAttrs,
  extractWeChatTag: extractTag,
  isWeChatGroupTalker: isGroupTalker,
  WECHAT_TYPE_NAMES: TYPE_NAMES,
  WECHAT_APPMSG_SUBTYPES: APPMSG_SUBTYPES,
  extractWeChatKey,
  deriveWeChatLegacyKey: deriveLegacyKey,
  extractWeChatUinFromPrefs: extractUinFromPrefs,
  extractWeChatImeiFromCompatibleInfo: extractImeiFromCompatibleInfo,
  WeChatDBReader,
  WECHAT_PRAGMA_PROFILES: KNOWN_PRAGMA_PROFILES,
  normalizeWeChatMessage: normalizeMessage,
  normalizeWeChatContact: normalizeContact,
  wxidToWeChatPersonId: wxidToPersonId,
  WeChatKeyProvider: KeyProvider,
  WeChatMD5KeyProvider: MD5KeyProvider,
  WeChatFridaKeyProvider: FridaKeyProvider,
  probeWeChatEnv: envProbe.probe,
  decideWeChatKeyProvider: envProbe.decide,
  bootstrapWechatAdapter,
};
