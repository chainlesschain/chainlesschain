/**
 * @chainlesschain/personal-data-hub
 *
 * UnifiedSchema, validators, SQLCipher LocalVault, AdapterRegistry, and
 * the natural-language AnalysisEngine for the Personal Data Hub middleware.
 *
 * Phase 0 (landed): constants / ids / schemas / batch
 * Phase 1 (landed): vault / migrations / key-providers
 * Phase 2 (landed): adapter-spec / kg-derive / rag-derive / registry / mock-adapter
 * Phase 3 (this):   query-parser / prompt-builder / llm-client / analysis
 *
 * See docs/design/Personal_Data_Hub_Architecture.md.
 */

"use strict";

const constants = require("./constants");
const ids = require("./ids");
const schemas = require("./schemas");
const batch = require("./batch");
const migrations = require("./migrations");
const keyProviders = require("./key-providers");
const { LocalVault } = require("./vault");
const adapterSpec = require("./adapter-spec");
const kgDerive = require("./kg-derive");
const ragDerive = require("./rag-derive");
const { AdapterRegistry, DEFAULT_BATCH_SIZE } = require("./registry");
const { MockAdapter } = require("./mock-adapter");
const queryParser = require("./query-parser");
const promptBuilder = require("./prompt-builder");
const { MockLLMClient, OllamaClient } = require("./llm-client");
const { AnalysisEngine, DEFAULT_MAX_FACTS, DEFAULT_MAX_QUERY_LIMIT } = require("./analysis");
const bridges = require("./bridges");
const emailImapAdapter = require("./adapters/email-imap");
const alipayBillAdapter = require("./adapters/alipay-bill");
const wechatAdapter = require("./adapters/wechat");
const travelBase = require("./adapters/travel-base");
const { Train12306Adapter } = require("./adapters/travel-12306");
const { CtripAdapter } = require("./adapters/travel-ctrip");
const { AmapAdapter } = require("./adapters/travel-amap");
const { BaiduMapAdapter } = require("./adapters/travel-baidu-map");
const shoppingBase = require("./adapters/shopping-base");
const { TaobaoAdapter } = require("./adapters/shopping-taobao");
const { JdAdapter } = require("./adapters/shopping-jd");
const { MeituanAdapter } = require("./adapters/shopping-meituan");
const { BilibiliAdapter } = require("./adapters/social-bilibili");
const { WeiboAdapter } = require("./adapters/social-weibo");
const entityResolver = require("./entity-resolver");
const analysisSkills = require("./analysis-skills");
const mobileExtractor = require("./mobile-extractor");

module.exports = {
  // Constants / enums
  ...constants,

  // ID generation
  newId: ids.newId,
  newIdForSource: ids.newIdForSource,
  timestampFromId: ids.timestampFromId,

  // Per-entity validators
  validate: schemas.validate,
  validatePerson: schemas.validatePerson,
  validateEvent: schemas.validateEvent,
  validatePlace: schemas.validatePlace,
  validateItem: schemas.validateItem,
  validateTopic: schemas.validateTopic,

  // Batch helpers
  emptyBatch: batch.emptyBatch,
  mergeBatches: batch.mergeBatches,
  validateBatch: batch.validateBatch,
  partitionBatch: batch.partitionBatch,

  // Migrations
  MIGRATIONS: migrations.MIGRATIONS,
  TARGET_SCHEMA_VERSION: migrations.TARGET_VERSION,
  applyMigrations: migrations.applyMigrations,
  getSchemaVersion: migrations.getSchemaVersion,

  // Key providers
  KEY_HEX_LEN: keyProviders.KEY_HEX_LEN,
  isValidKeyHex: keyProviders.isValidKeyHex,
  generateKeyHex: keyProviders.generateKeyHex,
  InMemoryKeyProvider: keyProviders.InMemoryKeyProvider,
  FileKeyProvider: keyProviders.FileKeyProvider,

  // Vault
  LocalVault,

  // Adapter contract
  SENSITIVITY_LEVELS: adapterSpec.SENSITIVITY_LEVELS,
  assertAdapter: adapterSpec.assertAdapter,

  // KG + RAG derivation
  triple: kgDerive.triple,
  deriveEventTriples: kgDerive.deriveEventTriples,
  derivePersonTriples: kgDerive.derivePersonTriples,
  derivePlaceTriples: kgDerive.derivePlaceTriples,
  deriveItemTriples: kgDerive.deriveItemTriples,
  deriveTopicTriples: kgDerive.deriveTopicTriples,
  deriveBatchTriples: kgDerive.deriveBatchTriples,
  deriveEntityTriples: kgDerive.deriveEntityTriples,
  eventToRagDoc: ragDerive.eventToRagDoc,
  personToRagDoc: ragDerive.personToRagDoc,
  placeToRagDoc: ragDerive.placeToRagDoc,
  itemToRagDoc: ragDerive.itemToRagDoc,
  topicToRagDoc: ragDerive.topicToRagDoc,
  entityToRagDoc: ragDerive.entityToRagDoc,
  deriveBatchDocs: ragDerive.deriveBatchDocs,

  // Registry + reference adapter
  AdapterRegistry,
  DEFAULT_BATCH_SIZE,
  MockAdapter,

  // Query parser
  parseQuery: queryParser.parseQuery,
  parseTimeWindow: queryParser.parseTimeWindow,
  parseFilters: queryParser.parseFilters,
  parseIntent: queryParser.parseIntent,

  // Prompt builder
  DEFAULT_SYSTEM_PROMPT: promptBuilder.DEFAULT_SYSTEM_PROMPT,
  buildPrompt: promptBuilder.buildPrompt,
  summarizeFact: promptBuilder.summarizeFact,
  parseCitations: promptBuilder.parseCitations,
  validateCitations: promptBuilder.validateCitations,

  // LLM clients (pluggable; production wires CcLLMAdapter)
  MockLLMClient,
  OllamaClient,

  // Analysis engine
  AnalysisEngine,
  DEFAULT_MAX_FACTS,
  DEFAULT_MAX_QUERY_LIMIT,

  // Bridges to existing cc infrastructure (LLM / KG / RAG)
  CcLLMAdapter: bridges.CcLLMAdapter,
  CcKgSink: bridges.CcKgSink,
  CcRagSink: bridges.CcRagSink,
  HUB_TO_CC_TYPE: bridges.HUB_TO_CC_TYPE,
  LOCAL_PROVIDERS: bridges.LOCAL_PROVIDERS,

  // Phase 5.1 — first real production adapter (IMAP email)
  EmailAdapter: emailImapAdapter.EmailAdapter,
  EMAIL_PROVIDERS: emailImapAdapter.EMAIL_PROVIDERS,
  resolveEmailProvider: emailImapAdapter.resolveEmailProvider,
  parseEmailWatermark: emailImapAdapter.parseWatermark,
  formatEmailWatermark: emailImapAdapter.formatWatermark,
  ImapSession: emailImapAdapter.ImapSession,
  ImapAuthFailedError: emailImapAdapter.ImapAuthFailedError,
  ImapConnectionFailedError: emailImapAdapter.ImapConnectionFailedError,
  ImapMailboxNotFoundError: emailImapAdapter.ImapMailboxNotFoundError,
  parseRawEmail: emailImapAdapter.parseRawEmail,
  // Phase 5.3 — email classifier
  EMAIL_CATEGORIES: emailImapAdapter.EMAIL_CATEGORIES,
  EMAIL_LAYER1_RULES: emailImapAdapter.EMAIL_LAYER1_RULES,
  classifyEmail: emailImapAdapter.classifyEmail,
  classifyEmailLayer1: emailImapAdapter.classifyEmailLayer1,
  classifyEmailLayer2: emailImapAdapter.classifyEmailLayer2,
  // Phase 5.4 — 6 template extractors + dispatcher
  extractEmailFields: emailImapAdapter.extractEmailFields,
  EMAIL_CATEGORY_EXTRACTORS: emailImapAdapter.EMAIL_CATEGORY_EXTRACTORS,
  extractEmailBill: emailImapAdapter.extractBill,
  extractEmailOrder: emailImapAdapter.extractOrder,
  extractEmailTravel: emailImapAdapter.extractTravel,
  extractEmailGovernment: emailImapAdapter.extractGovernment,
  extractEmailRegister: emailImapAdapter.extractRegister,
  extractEmailOther: emailImapAdapter.extractOther,
  // Phase 5.5 — PDF decryption + transactions
  extractPdfText: emailImapAdapter.extractPdfText,
  pdfPasswordsFromHints: emailImapAdapter.pdfPasswordsFromHints,
  extractEmailTransactions: emailImapAdapter.extractTransactions,

  // Phase 8 — EntityResolver
  EntityResolver: entityResolver.EntityResolver,
  entityResolverRuleStage: entityResolver.entityResolverRuleStage,
  entityResolverSharedIdentifier: entityResolver.entityResolverSharedIdentifier,
  ENTITY_RESOLVER_STRONG_IDENTIFIER_KEYS: entityResolver.ENTITY_RESOLVER_STRONG_IDENTIFIER_KEYS,
  EntityResolverEmbeddingStage: entityResolver.EntityResolverEmbeddingStage,
  entityResolverCosineSimilarity: entityResolver.entityResolverCosineSimilarity,
  EntityResolverLLMStage: entityResolver.EntityResolverLLMStage,
  ENTITY_RESOLVER_LLM_SYSTEM_PROMPT: entityResolver.ENTITY_RESOLVER_LLM_SYSTEM_PROMPT,
  parseEntityResolverLLMResponse: entityResolver.parseEntityResolverLLMResponse,
  EntityResolverWorker: entityResolver.EntityResolverWorker,

  // Phase 11 — 5 内置 analysis skills
  AnalysisSkill: analysisSkills.AnalysisSkill,
  SpendingSkill: analysisSkills.SpendingSkill,
  RelationsSkill: analysisSkills.RelationsSkill,
  FootprintSkill: analysisSkills.FootprintSkill,
  InterestsSkill: analysisSkills.InterestsSkill,
  TimelineSkill: analysisSkills.TimelineSkill,
  ANALYSIS_SKILL_NAMES: analysisSkills.ANALYSIS_SKILL_NAMES,
  runAnalysisSkill: analysisSkills.runAnalysisSkill,

  // Phase 7.5 — Mobile extraction layer (借 sjqz architecture)
  AndroidExtractor: mobileExtractor.AndroidExtractor,
  iOSBackupReader: mobileExtractor.iOSBackupReader,

  // Phase 12 v0.5 — WeChat (frida-independent slice)
  WechatAdapter: wechatAdapter.WechatAdapter,
  WECHAT_NAME: wechatAdapter.WECHAT_NAME,
  WECHAT_VERSION: wechatAdapter.WECHAT_VERSION,
  parseWeChatContent: wechatAdapter.parseWeChatContent,
  extractWeChatKey: wechatAdapter.extractWeChatKey,
  deriveWeChatLegacyKey: wechatAdapter.deriveWeChatLegacyKey,
  WeChatDBReader: wechatAdapter.WeChatDBReader,
  normalizeWeChatMessage: wechatAdapter.normalizeWeChatMessage,
  normalizeWeChatContact: wechatAdapter.normalizeWeChatContact,
  wxidToWeChatPersonId: wechatAdapter.wxidToWeChatPersonId,
  WECHAT_PRAGMA_PROFILES: wechatAdapter.WECHAT_PRAGMA_PROFILES,

  // Phase 9 — Travel four-pack
  normalizeTravelRecord: travelBase.normalizeTravelRecord,
  parseChineseDateTime: travelBase.parseChineseDateTime,
  Train12306Adapter,
  CtripAdapter,
  AmapAdapter,
  BaiduMapAdapter,

  // Phase 7 — Shopping three-pack
  normalizeOrderRecord: shoppingBase.normalizeOrderRecord,
  CookieAuth: shoppingBase.CookieAuth,
  TaobaoAdapter,
  JdAdapter,
  MeituanAdapter,

  // Phase 13+ — long-tail social (借 sjqz parsers)
  BilibiliAdapter,
  WeiboAdapter,

  // Phase 6 — AlipayBillAdapter (CSV import)
  AlipayBillAdapter: alipayBillAdapter.AlipayBillAdapter,
  ALIPAY_BILL_NAME: alipayBillAdapter.ALIPAY_BILL_NAME,
  ALIPAY_BILL_VERSION: alipayBillAdapter.ALIPAY_BILL_VERSION,
  parseAlipayCsv: alipayBillAdapter.parseAlipayCsv,
  parseAlipayCsvBuffer: alipayBillAdapter.parseAlipayCsvBuffer,
  extractAlipayCsvFromZip: alipayBillAdapter.extractAlipayCsvFromZip,
  classifyAlipayCounterparty: alipayBillAdapter.classifyAlipayCounterparty,
  alipayCounterpartyToPersonId: alipayBillAdapter.alipayCounterpartyToPersonId,
  ALIPAY_KNOWN_MERCHANTS: alipayBillAdapter.ALIPAY_KNOWN_MERCHANTS,
  mapAlipayTypeToSubtype: alipayBillAdapter.mapAlipayTypeToSubtype,
};
