# Personal Data Hub vs sjqz Mobile Forensics — 借鉴方案

> **状态**：研究稿（2026-05-20）。基于阅读 `C:\code\sjqz`（Python 手机取证工具）后输出的"如何用 sjqz 优化 ChainlessChain PDH 实施"建议。
>
> **关联**：父文档 [`Personal_Data_Hub_Architecture.md`](./Personal_Data_Hub_Architecture.md) §12 phase plan。

---

## 1. 两个项目的定位差异（一句话总结）

| 维度 | sjqz | ChainlessChain PDH |
|---|---|---|
| **目标用户** | 司法 / 取证 / 调查（看别人的手机） | 个人自我档案（看自己的数据） |
| **价值主张** | 提全 → 出报告 | 提全 → 跨源融合 → AI 问答 |
| **数据落地** | 解析后导出 HTML/Excel/JSON | 加密 vault + 持续增量 |
| **架构** | Python CLI + 命令行调用 | TypeScript/Node + cross-shell (desktop V6 / cc ui / web-shell) |
| **AI 层** | 无 | 核心（AnalysisEngine + 内置分析 skills） |

**结论**：sjqz **不是** PDH 的替代品，**但它的提取层 + 部分 parser 是 PDH 当前缺失的关键基础设施**。

---

## 2. sjqz 已实现 PDH 缺失的功能

### 2.1 Mobile Extraction Layer（最大 gap）

**sjqz 已有**：
- `android/extractor.py` (1492 LOC) — ADB 备份 / APK 降级 / Root 直读 / WiFi ADB
- `ios/extractor.py` (565 LOC) — iTunes 备份风格 / AFC 媒体提取 / iOS 10.2+ 加密备份解密
- 文件提取：图片、视频、文档、音频、下载文件、截图

**PDH 当前**：**零**。PDH 所有 adapter 都假定数据来自 Web API（IMAP / Alipay CSV / Shopping cookies）。对于纯本机应用（微信本地 DB / QQ / 短信 / 通讯录），PDH 没有任何拉取层。

**影响**：
- Phase 12 WeChat 必须自己从零写 ADB 集成
- Phase 13+ 长尾任何"需访问本机 app 私有目录"的源都受阻
- 完全错过通讯录 / 短信 / 通话记录 / WiFi 历史这些"系统级数据"

### 2.2 WeChat 解密（Phase 12 核心难点）

**sjqz 已有**：
- `parsers/wechat_decrypt.py` (437 LOC) — 老版本 MD5(IMEI+UIN)[:7] 路径 + SQLCipher v1.x 兼容模式
- 从 `auth_info_key_prefs.xml` 提取 UIN
- 从 `CompatibleInfo.cfg` 提取 IMEI（Java serialization parsing）
- 暴力破解 fallback
- 同时支持 Android 和 PC WeChat（`C:\Users\xx\Documents\WeChat Files\`）

**PDH 当前**：仅设计稿（`Adapter_WeChat_SQLCipher.md` 1060 行 + §17 addendum）。代码 0。

**Phase 12 加速路径**：
- 8.0 以下版本路径（sjqz 已实现）**直接 port 到 Node.js**，500-700 LOC
- 8.0+ 版本路径（需 Frida hook libwcdb.so）仍需自己写
- 但 sjqz 的 SQLCipher 解密 + EnMicroMsg.db parser 部分 100% 可用

### 2.3 已落地的 Parser（与 PDH phase plan 高度重合）

| App | sjqz LOC | PDH Phase | 当前 PDH 状态 |
|---|---|---|---|
| 微信 (WeChat) | 480 + 437 | Phase 12 | 仅设计稿 |
| QQ | 391 | 未规划 | — |
| 淘宝 / 支付宝 / 拼多多 | 886 (e-commerce 合一) | Phase 6 (Alipay) + Phase 7 (Taobao) | Phase 6 已落（CSV-based），Phase 7 设计稿+impl 待 |
| 美团 / 京东 / 小红书 | 1234 (lifestyle) | Phase 7 (Meituan+JD) | 仅 phase plan |
| 滴滴 / 携程 | 751 (travel) | Phase 9 | 仅 phase plan |
| 高德地图 / 百度地图 | 443 + 611 | Phase 9 | 仅 phase plan |
| 抖音 | 473 | 未规划 | — |
| 微博 / 哔哩哔哩 | 1751 (social) | 未规划 | — |
| WhatsApp / Telegram | 516 + 483 | 未规划 | — |
| 系统数据（contacts/sms/calllog/wifi）| 964 | 未规划 | — |

**结论**：sjqz **已有的代码覆盖了 PDH Phase 7 + 9 + 12 + 13+ 一半以上的工作量**。

---

## 3. PDH 已实现 sjqz 缺失的能力

| 能力 | PDH | sjqz |
|---|---|---|
| **UnifiedSchema** 跨 adapter 一致字段（Person/Event/Place/Item/Topic） | ✅ | ❌ 每 parser 独立类 |
| **EntityResolver** 跨源消歧（同一人不同源合一） | ✅ Phase 8 进行中 | ❌ |
| **本地 LLM 自然语言 Q&A**（"上个月外卖花了多少？"） | ✅ AnalysisEngine | ❌ 只导出原始数据 |
| **SQLCipher LocalVault + Keystore 主密钥 + 旋转** | ✅ | ❌ 明文 SQLite |
| **跨 shell UI**（desktop V6 + cc ui + web-shell 三入口同步） | ✅ | ❌ Python CLI + 简单 web frontend |
| **增量同步 + watermark** | ✅ | ❌ 每次全量 |
| **隐私 SOP**（adapter manifest + sensitivity 等级 + audit log） | ✅ | 部分 |
| **本地一切**（无云端 fallback）+ 显式 acceptNonLocal gate | ✅ | sjqz 无外传但也无 gate |
| **P2P 跨设备同步**（DID + libp2p） | 已规划 | ❌ |

**结论**：PDH 是"个人数据中台"，sjqz 是"取证工具"。两者底盘截然不同。

---

## 4. 建议的"借鉴"实施路径

### 4.1 立即可做：sjqz fixture 入 PDH 测试集

**动作**：sjqz 自带的 `wechat_key.txt` 和 `参考资料/` 大概率有真实 EnMicroMsg.db schema dump + 样本数据。在 PDH Phase 12 v0.5 frida-indep 切片落地时，用 sjqz 的样本作 fixture，**不需要自己造**合成 SQLite。

**成本**：≈ 0（验证现有数据可用即可）
**回报**：Phase 12 v0.5 测试可信度大幅提升

### 4.2 Phase 12 加速：port sjqz 的 wechat_decrypt.py 到 Node.js

```
sjqz/parsers/wechat_decrypt.py (437 LOC, Python)
   ↓ port
PDH/packages/personal-data-hub/lib/adapters/wechat/legacy-key-extractor.js
+ PDH/packages/personal-data-hub/lib/adapters/wechat/db-reader.js (better-sqlite3-multiple-ciphers)
```

**适用范围**：微信 8.0 之前版本（仍有用户在用）+ PC WeChat 8.0.x（已知 key derive 路径）
**Frida hook**（8.0+ Android）单独走

**成本**：1d port + 验证（已有参考实现 cuts time vs 从 0 写）
**回报**：Phase 12 §12.2 "密钥提取"从 2d 降到 1d；老版本兼容性免费拿

### 4.3 新增 Phase 7.5 — Mobile Extraction Layer

在 Phase 7 (Shopping cookies) 和 Phase 8 (EntityResolver) 之间插入：

**Phase 7.5 内容**：
- `lib/mobile-extractor/` 新模块
- `android/adb-puller.js` (~300 LOC) — adb backup / adb pull 私有目录 / shell exec
- `ios/itunes-backup-reader.js` (~400 LOC) — 解析未加密 iTunes backup（Manifest.db + Domain 映射）
- `ios/encrypted-backup.js` (~300 LOC) — iOS 10.2+ 加密备份解密（PBKDF2 → 密钥 → 文件级 AES）
- Adapter contract 扩展：每个 adapter 加 `extractMode: "web-api" | "device-pull"` 字段
- UI：设备选择器 + 提取进度 + 文件分类视图

**Phase 7.5 工期**：~5d（port + 集成 + 测试）
**收益**：
1. Phase 12 WeChat 拿到 ADB 桥免费用
2. Phase 13+ 长尾里"需读 app 私有 DB"的所有 adapter 复用（QQ / 微博 / B 站 / 抖音 / 高德 / 美团等都用本地 DB）
3. **PDH 从"web-only"升级为"web + device"双源**，覆盖率翻倍

**这是 sjqz 给 PDH 最大的增量价值**。

### 4.4 Phase 13+ 长尾 prioritization 调整

原 Phase 13+ 是"按用户需求触发"。借 sjqz 后建议调整为：

| 新优先级 | App | 实施路径 | 工期 |
|---|---|---|---|
| **P1** | 系统数据（contacts / sms / call log） | port sjqz/parsers/system.py | 1.5d |
| **P2** | QQ | port sjqz/parsers/qq.py | 1d |
| **P3** | 微博 + 哔哩哔哩 | port sjqz/parsers/social.py | 2d |
| **P4** | 抖音 | port sjqz/parsers/douyin.py | 1d |
| **P5** | WhatsApp / Telegram | port sjqz/parsers/* | 2d |

**结论**：原 Phase 13+ "每 adapter 2-3 天"估算 在有 sjqz 参考后**降至 1-1.5 天平均**。整个长尾 v1 落地工期从未定 ≈ 15-20d 压到 8-10d。

---

## 5. 如何提取 / 分析 / AI 个人数据（用户第二个问题答）

**PDH 三层架构**：

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. 提取层 (Extract)                                              │
│                                                                   │
│  Web API:    IMAP / Alipay CSV export / Shopping cookies         │
│  Device:     ADB pull (Phase 7.5) / iTunes backup (Phase 7.5)    │
│  Encrypted:  SQLCipher key extract (Phase 12 WeChat / QQ)        │
│                                                                   │
│   ─→ RawEvent 流（每 adapter 自有 schema）                        │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. 统一层 (Unify)                                                │
│                                                                   │
│  adapter.normalize(raw)  → UnifiedSchema (Event/Person/Place/...)│
│  Registry.ingest         → vault.putBatch + KG sink + RAG sink   │
│  EntityResolver          → 跨源 same-as 边 (Phase 8 ★ 进行中)    │
│                                                                   │
│   ─→ 加密 vault + KG triples + BM25 inverted index               │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. AI 分析层 (Analyze)                                            │
│                                                                   │
│  AnalysisEngine.ask(question, options)                          │
│    ├─ parse query → time window + entity filter + intent        │
│    ├─ retrieve (KG + RAG + time filter) → top-K facts           │
│    ├─ build prompt (含 facts inline + safe system header)        │
│    └─ LLM call (本地 Ollama 默认; acceptNonLocal:true 才允许云)  │
│                                                                   │
│  内置 5 个 skill (Phase 11 ★ 待实施):                            │
│    spending / relations / footprint / interests / timeline       │
│                                                                   │
│  报告 / 告警 / Q&A 三态                                          │
└─────────────────────────────────────────────────────────────────┘
```

**用户体验**：
- **提问**：在 PersonalDataHub UI 输入 "上月外卖花了多少？"
- **底层**：query-parser 拆 → vault 拉 events.subtype=payment, time=last-month, counterparty matches 美团/饿了么 → AnalysisEngine 把 30 条事实塞 prompt → 本地 Ollama 算 → 返回答案 + 引用的 event IDs
- **点引用**：UI 弹 event detail drawer 显示原 Alipay row / Email 链接

**当前状态**（Phase 0-7 已实施，Phase 8 进行中）：
- Phase 0-4：基础设施 ✅
- Phase 5：EmailAdapter ✅（5 sub-phase 全部完成）
- Phase 6：AlipayBillAdapter ✅
- Phase 7：Shopping (Taobao+JD+Meituan) — 仅 phase plan，**setup 设计稿待**
- Phase 8：EntityResolver — Phase 8.1+8.2 ✅（migration + ruleStage），8.3-8.8 进行中
- Phase 9-13+：仅 phase plan

---

## 6. 推荐 next action

按 ROI 排序：

| # | Action | 工期 | 收益 |
|---|---|---|---|
| 1 | **完成 Phase 8** EntityResolver（8.3-8.8） | 3.5d | 当前最高价值 — 解锁跨源查询 |
| 2 | **Phase 11 内置 5 个 analysis skill** | 5d | 用户立刻能用 PDH (Phase 5+6 已有 Email+Alipay 数据) |
| 3 | **Phase 7.5 Mobile Extraction Layer**（借 sjqz） | 5d | 解锁本机数据，**为 Phase 9/12 铺路** |
| 4 | **Phase 12 v0.5 frida-indep**（用 sjqz wechat_decrypt） | 3d | WeChat 0→60%，剩 40% 等设备 |
| 5 | **Phase 7 Shopping**（cookie-based） | 7d | 需用户 cookies，迟做 |
| 6 | **Phase 9 Travel 4-pack** | 5d (借 sjqz) | 行程档案完整 |

**最佳实施顺序建议**：
1. Phase 8 完成（当前手头工作不打断）
2. Phase 11 analysis skills（用户体验 immediate win）
3. Phase 7.5 mobile extractor + Phase 12 v0.5（借 sjqz 加速）
4. Phase 7 / 9 / 长尾按用户需求触发

---

## 7. 参考

- sjqz 项目根: `C:\code\sjqz`
- sjqz wechat 解密: `src/mobile_forensics/parsers/wechat_decrypt.py`
- sjqz extractor (Android): `src/mobile_forensics/android/extractor.py`
- sjqz extractor (iOS): `src/mobile_forensics/ios/extractor.py`
- PDH 父文档: `docs/design/Personal_Data_Hub_Architecture.md`
- PDH Phase 8: `docs/design/Personal_Data_Hub_EntityResolver.md`
- PDH Phase 12: `docs/design/Adapter_WeChat_SQLCipher.md` (含 §17 addendum)
