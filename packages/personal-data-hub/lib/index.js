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
const adapterReadiness = require("./adapter-readiness");
const adapterGuide = require("./adapter-guide");
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
const { TongchengAdapter } = require("./adapters/travel-tongcheng");
const { DidiAdapter } = require("./adapters/travel-didi");
const { AmapAdapter } = require("./adapters/travel-amap");
const { BaiduMapAdapter } = require("./adapters/travel-baidu-map");
const { TencentMapAdapter } = require("./adapters/travel-tencent-map");
const shoppingBase = require("./adapters/shopping-base");
const { TaobaoAdapter } = require("./adapters/shopping-taobao");
const { JdAdapter } = require("./adapters/shopping-jd");
const { MeituanAdapter } = require("./adapters/shopping-meituan");
const { PinduoduoAdapter } = require("./adapters/shopping-pinduoduo");
const { DianpingAdapter } = require("./adapters/shopping-dianping");
const { BilibiliAdapter } = require("./adapters/social-bilibili");
const { WeiboAdapter } = require("./adapters/social-weibo");
const { ZhihuAdapter } = require("./adapters/social-zhihu");
const { BossZhipinAdapter } = require("./adapters/recruit-boss");
const { CsdnAdapter } = require("./adapters/social-csdn");
const { DongchediAdapter } = require("./adapters/social-dongchedi");
const { TianyanchaAdapter } = require("./adapters/biz-tianyancha");
const { DouyinAdapter } = require("./adapters/social-douyin");
const { XiaohongshuAdapter } = require("./adapters/social-xiaohongshu");
const { ToutiaoAdapter } = require("./adapters/social-toutiao");
const { KuaishouAdapter } = require("./adapters/social-kuaishou");
// FAMILY-23 v0.2 — 家庭守护 telemetry collectors (snapshot + live fetcher 双路).
const { GenshinAdapter } = require("./adapters/game-genshin");
const { HonorOfKingsAdapter } = require("./adapters/game-honor-of-kings");
const { ZuoyebangAdapter } = require("./adapters/edu-zuoyebang");
const { AlipayAdapter } = require("./adapters/finance-alipay");
const { HuaweiLearningAdapter } = require("./adapters/edu-huawei-learning");
const { QQAdapter } = require("./adapters/messaging-qq");
const { WeChatPcAdapter } = require("./adapters/wechat-pc");
const { QQPcAdapter } = require("./adapters/qq-pc");
const { AppleHealthAdapter } = require("./adapters/apple-health");
const { NeteaseMusicAdapter } = require("./adapters/netease-music");
const { KugouMusicAdapter } = require("./adapters/music-kugou");
const { IqiyiVideoAdapter } = require("./adapters/video-iqiyi");
const { TencentVideoAdapter } = require("./adapters/video-tencent");
const { XiguaVideoAdapter } = require("./adapters/video-xigua");
const { WeReadAdapter } = require("./adapters/weread");
const { WpsDocAdapter } = require("./adapters/doc-wps");
const { TencentDocsAdapter } = require("./adapters/doc-tencent-docs");
const { BaiduNetdiskAdapter } = require("./adapters/doc-baidu-netdisk");
const { CamScannerDocAdapter } = require("./adapters/doc-camscanner");
const { IXiamenAdapter } = require("./adapters/gov-ixiamen");
const { MeiyouAdapter } = require("./adapters/health-meiyou");
const { DingTalkPcAdapter } = require("./adapters/dingtalk-pc");
const { FeishuPcAdapter } = require("./adapters/feishu-pc");
const { WeWorkPcAdapter } = require("./adapters/wework-pc");
const { TelegramAdapter } = require("./adapters/messaging-telegram");
const { WhatsAppAdapter } = require("./adapters/messaging-whatsapp");
const entityResolver = require("./entity-resolver");
const analysisSkills = require("./analysis-skills");
const mobileExtractor = require("./mobile-extractor");
const systemDataAndroid = require("./adapters/system-data-android");
const browserHistoryChrome = require("./adapters/browser-history-chrome");
const browserHistoryEdge = require("./adapters/browser-history-edge");
const vscodeAdapter = require("./adapters/vscode");
const winRecentAdapter = require("./adapters/win-recent");
const gitActivityAdapter = require("./adapters/git-activity");
const shellHistoryAdapter = require("./adapters/shell-history");
const localFilesAdapter = require("./adapters/local-files");
const categories = require("./categories");

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
  getFtsMode: migrations.getFtsMode,

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

  // Adapter readiness (why-can't-I-collect descriptors)
  describeReadiness: adapterReadiness.describeReadiness,
  categoryForMode: adapterReadiness.categoryForMode,
  READINESS_CATEGORY: adapterReadiness.READINESS_CATEGORY,
  READINESS_STATUS: adapterReadiness.READINESS_STATUS,
  READINESS_REASONS: adapterReadiness.READINESS_REASONS,

  // Adapter import guides (step-by-step "how to import this source")
  getAdapterGuide: adapterGuide.getAdapterGuide,
  ADAPTER_DISPLAY_NAMES: adapterGuide.DISPLAY_NAMES,
  ADAPTER_CATEGORY_GUIDES: adapterGuide.CATEGORY_GUIDES,

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

  // Phase 9 + §2.5b 地图三联 — Travel five-pack
  normalizeTravelRecord: travelBase.normalizeTravelRecord,
  parseChineseDateTime: travelBase.parseChineseDateTime,
  Train12306Adapter,
  CtripAdapter,
  TongchengAdapter,
  DidiAdapter,
  AmapAdapter,
  BaiduMapAdapter,
  TencentMapAdapter,

  // Phase 7 — Shopping three-pack
  normalizeOrderRecord: shoppingBase.normalizeOrderRecord,
  CookieAuth: shoppingBase.CookieAuth,
  TaobaoAdapter,
  JdAdapter,
  MeituanAdapter,
  PinduoduoAdapter,
  DianpingAdapter,

  // Phase 13+ — long-tail social + messaging (借 sjqz parsers)
  BilibiliAdapter,
  WeiboAdapter,
  ZhihuAdapter,
  BossZhipinAdapter,
  CsdnAdapter,
  DongchediAdapter,
  TianyanchaAdapter,
  DouyinAdapter,
  XiaohongshuAdapter,
  ToutiaoAdapter,
  KuaishouAdapter,
  GenshinAdapter,
  HonorOfKingsAdapter,
  ZuoyebangAdapter,
  AlipayAdapter,
  HuaweiLearningAdapter,
  QQAdapter,
  WeChatPcAdapter,
  QQPcAdapter,
  AppleHealthAdapter,
  NeteaseMusicAdapter,
  KugouMusicAdapter,
  IqiyiVideoAdapter,
  TencentVideoAdapter,
  XiguaVideoAdapter,
  WeReadAdapter,
  WpsDocAdapter,
  TencentDocsAdapter,
  BaiduNetdiskAdapter,
  CamScannerDocAdapter,
  IXiamenAdapter,
  MeiyouAdapter,
  DingTalkPcAdapter,
  FeishuPcAdapter,
  WeWorkPcAdapter,
  TelegramAdapter,
  WhatsAppAdapter,

  // Plan A v0.1 — Android on-device system-data adapter (no Python sidecar,
  // UI-pushed snapshot via ContentResolver + PackageManager).
  SystemDataAndroidAdapter: systemDataAndroid.SystemDataAndroidAdapter,
  SYSTEM_DATA_ANDROID_NAME: systemDataAndroid.SYSTEM_DATA_ANDROID_NAME,
  SYSTEM_DATA_ANDROID_VERSION: systemDataAndroid.SYSTEM_DATA_ANDROID_VERSION,
  SYSTEM_DATA_ANDROID_SNAPSHOT_SCHEMA_VERSION:
    systemDataAndroid.SNAPSHOT_SCHEMA_VERSION,
  // Path C — staging + ingest helper shared by IPC / WS / mobile-route layers
  ingestSystemDataAndroidSnapshot:
    systemDataAndroid.ingestSystemDataAndroidSnapshot,

  // Phase 17 (2026-05-24) — desktop Chrome local browser history + bookmarks.
  // SQLite snapshot copy + Bookmarks JSON parse; no network, no extension.
  BrowserHistoryChromeAdapter: browserHistoryChrome.BrowserHistoryChromeAdapter,
  BROWSER_HISTORY_CHROME_NAME: browserHistoryChrome.BROWSER_HISTORY_CHROME_NAME,
  BROWSER_HISTORY_CHROME_VERSION: browserHistoryChrome.BROWSER_HISTORY_CHROME_VERSION,
  defaultChromeProfileDir: browserHistoryChrome.defaultChromeProfileDir,

  // Edge — Chromium under the hood, same readers, different profile root.
  BrowserHistoryEdgeAdapter: browserHistoryEdge.BrowserHistoryEdgeAdapter,
  BROWSER_HISTORY_EDGE_NAME: browserHistoryEdge.BROWSER_HISTORY_EDGE_NAME,
  BROWSER_HISTORY_EDGE_VERSION: browserHistoryEdge.BROWSER_HISTORY_EDGE_VERSION,

  // VS Code — workspace history + global terminal command/dir history.
  VSCodeAdapter: vscodeAdapter.VSCodeAdapter,
  VSCODE_NAME: vscodeAdapter.VSCODE_NAME,
  VSCODE_VERSION: vscodeAdapter.VSCODE_VERSION,
  defaultVscodeRoot: vscodeAdapter.defaultVscodeRoot,

  // Windows Recent — .lnk shortcut list from %APPDATA%\Microsoft\Windows\Recent.
  // Cross-application "what did I open and when" timeline (Win-only adapter).
  WinRecentAdapter: winRecentAdapter.WinRecentAdapter,
  WIN_RECENT_NAME: winRecentAdapter.WIN_RECENT_NAME,
  WIN_RECENT_VERSION: winRecentAdapter.WIN_RECENT_VERSION,
  defaultWinRecentDir: winRecentAdapter.defaultRecentDir,

  // Phase 18 — git activity (commit timeline across local code repos).
  GitActivityAdapter: gitActivityAdapter.GitActivityAdapter,
  GIT_ACTIVITY_NAME: gitActivityAdapter.GIT_ACTIVITY_NAME,
  GIT_ACTIVITY_VERSION: gitActivityAdapter.GIT_ACTIVITY_VERSION,
  defaultCodeRoots: gitActivityAdapter.defaultCodeRoots,

  // Phase 18 — shell history (PowerShell / bash / zsh command timelines).
  ShellHistoryAdapter: shellHistoryAdapter.ShellHistoryAdapter,
  SHELL_HISTORY_NAME: shellHistoryAdapter.SHELL_HISTORY_NAME,
  SHELL_HISTORY_VERSION: shellHistoryAdapter.SHELL_HISTORY_VERSION,
  defaultShellHistorySources: shellHistoryAdapter.defaultHistorySources,

  // Phase 18 — local files (file walk under Documents / Desktop / Downloads /
  // Pictures / Videos / Music). Cross-application "what files do I have"
  // timeline rooted in mtime, with app-cache excludes baked in.
  LocalFilesAdapter: localFilesAdapter.LocalFilesAdapter,
  LOCAL_FILES_NAME: localFilesAdapter.LOCAL_FILES_NAME,
  LOCAL_FILES_VERSION: localFilesAdapter.LOCAL_FILES_VERSION,
  defaultLocalFileRoots: localFilesAdapter.defaultRoots,

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

  // Phase 16 — Vault Browser shared taxonomy (categories + adapter mapping)
  CATEGORIES: categories.CATEGORIES,
  CATEGORY_LABELS: categories.CATEGORY_LABELS,
  PDH_PREFIX_RULES: categories.PREFIX_RULES,
  getAdapterCategory: categories.getCategory,
  groupAdaptersByCategory: categories.groupByCategory,
};
