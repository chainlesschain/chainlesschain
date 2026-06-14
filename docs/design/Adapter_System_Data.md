# Adapter: System Data — 通讯录 / 通话记录 / 短信 / WiFi

> **状态**：v0.1 设计稿（2026-05-20）。Phase 4.5 落地。配套 [`Personal_Data_Hub_Architecture.md`](./Personal_Data_Hub_Architecture.md) v0.3 + [`Personal_Data_Hub_Python_Sidecar.md`](./Personal_Data_Hub_Python_Sidecar.md) v0.1。
>
> **本 adapter 的特殊地位**：不是某个 app 的数据源，而是**系统层数据**（Android `com.android.providers.contacts` / `com.android.providers.telephony` / `/data/misc/wifi/`、iOS AddressBook + CallHistory + SMS backup）。**EntityResolver Phase 8 的种子集** — 通讯录里的电话号 / 邮箱 / 备注名是后续所有 adapter 的 Person 实体的权威主键。
>
> **依赖**：sidecar `system.parse_*` 4 个 method（见 sidecar 设计文档 §3.2）；sjqz `parsers/system.py` 964 行可直接复用。

---

## 1. 为什么 Phase 4.5 优先做系统数据

### 1.1 EntityResolver 种子价值

EntityResolver (Phase 8) 的关键挑战 = 跨源把"同一个人"识别出来。例如：

| 源 | 出现形式 | 后续 EntityResolver 是否能合并？ |
|---|---|---|
| 微信好友 "妈" | name=妈 | 无电话号 → 难 |
| 支付宝转账对方 "陈X华" | name=陈X华, phone=13800001111 | 有电话 → 可能 |
| 淘宝收货 "陈X华 13800001111 厦门 XX 路" | name=陈X华, phone=13800001111, address=厦门 XX 路 | 有电话+地址 → 强信号 |

**通讯录 = 权威桥梁**：
```
通讯录 ⇒ name="妈妈"+phone=13800001111+emails=[...] (用户亲手录入，准)
  ↓
+ 微信 talker_id 对应"妈" → 用 phone 桥接 → 合并
+ 支付宝转账 "陈X华" phone 同 → 合并
+ 淘宝收货地址 "陈X华" phone 同 → 合并
+ 短信"工商银行【还款提醒】" sender=95588 → 标记 merchant Person
+ 通话记录 13800001111 → 反向丰富 Person.interactions
```

**没有系统数据**：EntityResolver 只能在 app 间靠 LLM 猜（贵 + 错）；
**有系统数据**：90% 跨源合并退化为 "phone 匹配规则"（fast path），LLM 只仲裁 10% 难例。

### 1.2 其它价值

- **Place 种子**：WiFi 记录 → 常去地点种子（家/办公室/常去咖啡店）
- **Event 种子**：通话 + 短信 = 跨人际互动时间线，独立于 app 内聊天
- **隐私边界教学**：短信含他人信息是中台第一个"必须本地处理"的强约束场景，UI 教学价值高

### 1.3 工期评估

| 子项 | 工期 | 备注 |
|---|---|---|
| sidecar `system.parse_*` 4 method （已有 sjqz 实现，仅加 `to_normalized_batch`） | 1d | |
| JS adapter `system-data` 包（壳 + auth + watermark） | 0.5d | |
| LocalVault 表 + Vault.upsert 路径 | 0.5d | 复用既有 raw_events / unified_events |
| 隐私 UI（disclosure / toggle / 删除）| 1d | |
| 测试 + 真机 E2E | 1d | Redmi 24115RA8EC |
| **合计** | **4d** | |

---

## 2. 数据源

### 2.1 Android

| 系统组件 | 数据路径 | 提取方法 |
|---|---|---|
| 通讯录 | `/data/data/com.android.providers.contacts/databases/contacts2.db` | ADB backup `com.android.providers.contacts` / Root cp |
| 通话记录 | 同上（`calls` 表，部分 Android 11+ 在独立 `calllog.db`） | 同上 |
| 短信 / 彩信 | `/data/data/com.android.providers.telephony/databases/mmssms.db` | 同上 |
| WiFi 记录 | `/data/misc/wifi/WifiConfigStore.xml` (Android 9+) / `wpa_supplicant.conf` (旧) | **必须 Root**（普通 ADB backup 不含） |

**采集方式**：sidecar `android.extract` 拉文件到本机临时目录 → sidecar `system.parse_*` 解析 → 删临时文件。

### 2.2 iOS

| 系统组件 | 备份位置 | 提取方法 |
|---|---|---|
| 通讯录 | `Library/AddressBook/AddressBook.sqlitedb` | iTunes 加密备份 + sjqz `backup_decryptor` |
| 通话记录 | `Library/CallHistoryDB/CallHistory.storedata` | 同上 |
| 短信 / iMessage | `Library/SMS/sms.db` | 同上 |
| WiFi | iCloud Keychain (用户主动导出) / 描述文件 | **v0 defer**（Apple 限制大） |

### 2.3 桌面端（Win / Mac）

| 系统组件 | 路径 | 备注 |
|---|---|---|
| Windows 联系人 | People App / Outlook contacts | v2+ defer |
| macOS 通讯录 | `~/Library/Application Support/AddressBook/` | v2+ defer |
| WiFi 记录 | netsh wlan show profiles / `/Library/Preferences/SystemConfiguration/com.apple.airport.preferences.plist` | v0 defer |

> v0 仅 Android 端是核心（用户实际机 = Redmi 24115RA8EC）；iOS 在 Phase 4.5 同期跟进；桌面 / WiFi 部分 v2+。

---

## 3. UnifiedSchema 映射

### 3.1 Contact → Person

```json
{
  "id": "person:system:android:<contact_id>",
  "type": "person",
  "subtype": "contact",
  "names": ["妈妈"],
  "identifiers": {
    "phone": ["13800001111", "13900002222"],
    "email": ["mom@example.com"]
  },
  "relation": null,
  "notes": "<contact.notes>",
  "source": {
    "adapter": "system-data",
    "adapterVersion": "0.1.0",
    "originalId": "<contact_id>",
    "capturedBy": "sqlite",
    "capturedAt": 1737000000000
  },
  "extra": {
    "starred": true,
    "organization": "...",
    "photoUri": "...",
    "deviceSerial": "<android_serial>"
  },
  "ingestedAt": 1737000000000,
  "confidence": 1.0
}
```

**关键**：`identifiers.phone` 数组多号码 — 后续 adapter 用任一号匹配即合并。
**特别字段**：`extra.deviceSerial` 防多机种通讯录混淆（用户可能有两部手机，通讯录各自维护）。

### 3.2 CallLog → Event(subtype=call)

```json
{
  "id": "event:system:call:<call_id>",
  "type": "event",
  "subtype": "call",
  "occurredAt": 1737000000000,
  "durationMs": 184000,
  "actor": "person:self | person:system:android:<contact_id>",
  "participants": ["person:system:android:<contact_id>"],
  "content": {
    "text": null
  },
  "source": {
    "adapter": "system-data",
    "adapterVersion": "0.1.0",
    "originalId": "<call_id>",
    "capturedBy": "sqlite",
    "capturedAt": 1737000000000
  },
  "extra": {
    "callType": "incoming|outgoing|missed|rejected|blocked|voicemail",
    "isRead": true,
    "rawNumber": "13800001111"
  },
  "ingestedAt": 1737000000000,
  "confidence": 1.0
}
```

- `actor` = self 当 `callType=outgoing`；否则 = 对方
- 未存在 Contact 时新建 `Person(subtype=unknown)` 仅含 phone，待 EntityResolver 后续合并

### 3.3 Sms → Event(subtype=message)

```json
{
  "id": "event:system:sms:<sms_id>",
  "type": "event",
  "subtype": "message",
  "occurredAt": 1737000000000,
  "actor": "person:self | person:system:android:<sender_id>",
  "participants": ["person:system:android:<other_id>"],
  "content": {
    "text": "您的余额变动..."
  },
  "source": {
    "adapter": "system-data",
    "adapterVersion": "0.1.0",
    "originalId": "<sms_id>",
    "capturedBy": "sqlite",
    "capturedAt": 1737000000000
  },
  "extra": {
    "smsType": "received|sent|draft|outbox",
    "threadId": "<thread_id>",
    "isRead": true,
    "rawAddress": "95588",
    "channelType": "personal|service|verification"
  },
  "ingestedAt": 1737000000000,
  "confidence": 1.0
}
```

**衍生 enrichment（v0 不在 adapter 内做，留给分析层）**：
- 验证码识别（"验证码 \d{4,6}"）→ 标 `extra.channelType=verification`
- 银行账单识别 → 标 `extra.channelType=service` + 抽 amount 触发 Item 派生
- 工作短信 / 物流短信识别 → 标 channelType

### 3.4 WiFi → Place(category=wifi)

```json
{
  "id": "place:wifi:<ssid_hash>",
  "type": "place",
  "name": "<SSID>",
  "category": "wifi",
  "coordinates": null,
  "address": null,
  "aliases": [],
  "source": {
    "adapter": "system-data",
    "adapterVersion": "0.1.0",
    "originalId": "<ssid_hash>",
    "capturedBy": "sqlite",
    "capturedAt": 1737000000000
  },
  "extra": {
    "securityType": "WPA2|WPA|WEP|OPEN",
    "hidden": false,
    "lastConnected": 1737000000000,
    "passwordStored": true
  },
  "ingestedAt": 1737000000000,
  "confidence": 0.95
}
```

**SSID 隐私**：`extra.passwordStored=true` 但 **password 字段不入库**（即使 sjqz parser 解出也丢弃）；用户需要的话只能从原始机重新取。这是隐私权衡：保留 SSID 名 = 弱信号位置；保留密码 = 安全风险无回报。

---

## 4. Adapter 实现

### 4.1 文件结构

```
packages/personal-data-hub/lib/adapters/system-data/
├── index.js                   # adapter entry
├── android-provider.js        # Android 提取 + sidecar 调用
├── ios-provider.js            # iOS 备份解密 + sidecar 调用
├── normalize.js               # NormalizedBatch 后处理（兜底 enrichment）
├── disclosure.js              # dataDisclosure 元数据
└── __tests__/
    ├── system-data.test.js
    └── fixtures/
        ├── contacts2-sample.db    # 脱敏样本
        └── mmssms-sample.db
```

### 4.2 接口实现要点

```javascript
// packages/personal-data-hub/lib/adapters/system-data/index.js
import { PythonSidecarAdapter } from "../_python-sidecar-base.js";

export class SystemDataAdapter extends PythonSidecarAdapter {
  name = "system-data";
  version = "0.1.0";
  capabilities = ["import:android-adb", "import:ios-backup"];
  rateLimits = { perDay: 3 };  // 系统数据日变化小，不需高频同步

  dataDisclosure = {
    fields: [
      "contacts:name,phone,email,organization,notes,starred",
      "calls:number,duration,timestamp,type",
      "sms:address,body,timestamp,type,threadId",
      "wifi:ssid,securityType,lastConnected"
    ],
    sensitivity: "high",   // SMS 含他人信息
    retentionDays: null,   // 默认无限期；用户可改
    notice: "短信和通话记录可能含他人信息，仅在本机分析，永不外传"
  };

  async authenticate(ctx) {
    if (ctx.platform === "android") {
      // 校验 adb 设备在线 + 用户已同意 ADB
      return this.supervisor.invoke("android.list_devices", {});
    } else if (ctx.platform === "ios") {
      // 校验 iOS 设备在线 + 备份密码已存
      return this.supervisor.invoke("ios.list_devices", {});
    }
  }

  async *sync(opts) {
    // 1. sidecar 拉文件
    const extractPath = await this.supervisor.invoke(
      opts.platform === "android" ? "android.extract" : "ios.extract",
      {
        serial: opts.serial,
        packages: opts.platform === "android"
          ? ["com.android.providers.contacts", "com.android.providers.telephony"]
          : undefined,
        output_dir: opts.scratchDir,
      },
      { timeoutMs: 300_000 }
    );

    // 2. sidecar 并行解析 4 个 method
    for (const method of [
      "system.parse_contacts",
      "system.parse_calllog",
      "system.parse_sms",
      "system.parse_wifi"
    ]) {
      const batch = await this.supervisor.invoke(method, {
        data_dir: extractPath.path,
        since_watermark: opts.sinceWatermark,
      });
      for (const event of batch.events ?? []) yield event;
      for (const person of batch.persons ?? []) yield person;
      for (const place of batch.places ?? []) yield place;
    }

    // 3. 删临时文件
    await this.supervisor.invoke("fs.cleanup", { path: extractPath.path });
  }

  async healthCheck() {
    return this.supervisor.invoke("sidecar.ping", {});
  }
}
```

### 4.3 normalize 后处理（兜底 enrichment）

sidecar 返回 raw NormalizedBatch，hub 一侧加 SMS 渠道分类：

```javascript
// packages/personal-data-hub/lib/adapters/system-data/normalize.js
const VERIFICATION_RE = /(?:验证码|verification code)\s*[:：]?\s*(\d{4,6})/i;
const SERVICE_SENDERS = /^(95\d{3,5}|10\d{3,4}|400-?\d{3,7})$/;

export function enrichSms(event) {
  const text = event.content?.text ?? "";
  const sender = event.extra?.rawAddress ?? "";
  if (VERIFICATION_RE.test(text)) event.extra.channelType = "verification";
  else if (SERVICE_SENDERS.test(sender)) event.extra.channelType = "service";
  else event.extra.channelType = "personal";
  return event;
}
```

---

## 5. 隐私 SOP

### 5.1 UI 流（首次接入）

```
┌─────────────────────────────────────────┐
│ 接入：系统数据                            │
├─────────────────────────────────────────┤
│ ⚠ 这是中台第一个高敏感 adapter           │
│                                          │
│ 将采集你手机上的：                        │
│   ✓ 通讯录（200 人左右）                  │
│   ✓ 通话记录（最近 1 年约 5000 条）       │
│   ✓ 短信和彩信（最近 3 年约 8000 条）     │
│   ✓ WiFi 网络名（约 30 个）               │
│                                          │
│ 重要提示：                                 │
│   - 短信和通话含他人电话号 / 内容          │
│   - 所有数据 100% 留在本机加密存储         │
│   - 永不上传任何服务器（含 AI 分析）       │
│   - 你可随时一键删除                       │
│                                          │
│ 选择采集范围：                             │
│   [✓] 通讯录    [✓] 通话    [ ] 短信      │
│   [✓] WiFi 名（不含密码）                  │
│                                          │
│ [ 我已知悉隐私边界，开始采集 ]              │
│ [ 取消 ]                                  │
└─────────────────────────────────────────┘
```

### 5.2 数据范围控制

- 用户可在 `dataDisclosure.fields` 选子集（如只通讯录 + WiFi，不要短信）
- 保留期：默认无限期；用户可改 N 天自动删（apply to system-data only）
- 每条 SMS 入库时检测纯数字短信（仅验证码）可设"7 天后自动清"

### 5.3 审计 + 擦除

- audit log 每条 sync 记录 method + 提取条数 + 用户授权 hash
- 一键擦除走既有 §7.4 Vault 销毁流程；额外清 LocalVault 中 `source.adapter='system-data'` 的所有行

### 5.4 法律边界声明（用户协议增补）

```
"系统数据 adapter" 涉及通讯录和短信，可能包含他人姓名 / 电话 / 内容。
您声明：
1. 您是这部手机的合法使用者，对其上数据拥有访问权
2. 您理解短信内容可能涉及他人隐私，承诺仅在本机使用，不向任何第三方分发
3. 本工具不会将系统数据上传至云端（含 LLM 分析全部本地完成）

不符合上述条件，请勿启用本 adapter。
```

---

## 6. EntityResolver 集成点（前瞻 Phase 8）

虽 EntityResolver 在 Phase 8 落地，本 adapter 已先把"种子集"打好：

### 6.1 Person 主键策略

- 系统通讯录 Person 的 `id` 格式：`person:system:android:<contact_id>`
- 后续 adapter 不要直接重用此 id；EntityResolver 走"规则匹配 phone → 合并 → 重写 id 为 canonical"

### 6.2 规则匹配 fast path（Phase 8 预定）

```python
def merge_by_phone(new_person, existing_persons):
    for p in existing_persons:
        if any(phone_match(np, op)
               for np in new_person.identifiers.phone
               for op in p.identifiers.phone):
            return merge(p, new_person)
    return None

def phone_match(a, b):
    # 规范化：去 +86 / 去空格 / 仅留数字
    return normalize_phone(a)[-11:] == normalize_phone(b)[-11:]
```

### 6.3 Review 队列种子

- 通讯录里 "name 同但 phone 不同" 的两条 → 给用户 review（双号同人 vs 同名异人）
- WiFi SSID 与高德 Place 名相似（如 "ChinaNet-Office" vs 高德搜过 "我的办公室"）→ 给用户 review

---

## 7. 验收

### 7.1 单测（≥ 12）

| # | 用例 |
|---|---|
| T1 | sidecar `system.parse_contacts` mock contacts2.db → 5 Person，3 多号码 |
| T2 | sidecar `system.parse_calllog` mock → 10 Event(subtype=call) 含 5 type 全覆盖 |
| T3 | sidecar `system.parse_sms` mock → 区分 received/sent/draft/outbox |
| T4 | normalize.enrichSms 验证码识别 |
| T5 | normalize.enrichSms 95588 银行号识别 |
| T6 | WiFi password 不入库（fixture 含密码，验断言无） |
| T7 | dataDisclosure.notice 文案存在 |
| T8 | 用户选子集（只 contacts）→ sync 跳过 sms/wifi |
| T9 | watermark 增量 — 第二次 sync 仅返回新增 |
| T10 | 一键擦除清掉 source.adapter='system-data' 所有行 |
| T11 | iOS 备份密码错 → 返回 ENC_KEY_INVALID 不崩 |
| T12 | sidecar crash → SidecarSupervisor 自动重启 + 当前 sync 失败但不卡 hub |

### 7.2 真机 E2E

| # | 场景 | 设备 |
|---|---|---|
| E1 | ADB connect Redmi → 拉 contacts2.db → 200+ Person 入库 ≤ 10s | Redmi 24115RA8EC |
| E2 | 拉 mmssms.db → 8000+ SMS 入库 ≤ 60s + verification/service/personal 三类比例统计 | 同上 |
| E3 | 关 ADB 调试 → adapter 报 `EXTRACT_PERMISSION_DENIED` 用户友好提示 | 同上 |
| E4 | iPhone iTunes 备份 → 解密 → 通讯录入库 | （iPhone 用户介入） |
| E5 | 擦除按钮 → SQLite count(*) where source='system-data' = 0 | Redmi |

### 7.3 EntityResolver 准备度（Phase 8 之前先验）

- 标 50 条"通讯录 + 微信好友"映射，验通讯录 phone 100% 命中能匹配的 wechat talker → 反向证明 Phase 8 fast path 可走

---

## 8. Open Questions

### OQ-SD1：SMS 是否默认勾上

**A**：默认勾上（最大化数据价值）
**B**：默认不勾，让用户主动开

**推荐 B**。理由：SMS 是中台第一个"可能含他人信息"的 adapter，默认 opt-out 体现"隐私优先"姿态；用户主动开 = 充分知情。

### OQ-SD2：通话/短信去重粒度

**A**：仅 `(adapter, originalId)` 去重
**B**：A + 内容哈希（应对手机换 IMEI / db rebuild 后 originalId 变）

**推荐 A**。理由：(1) Android calllog `_id` 稳定；(2) 内容哈希在群发短信场景误合（同一条银行账单短信发给多人都同 hash 不同人）；(3) 真出现 db rebuild 用户重新接入也是分钟级操作。

### OQ-SD3：WiFi 密码是否本地存

**A**：完全丢弃（采纳，已在 §3.4 决策）
**B**：选项让用户存（开数据迁移场景）

**推荐 A**。理由：(1) 密码不在中台分析价值范围；(2) 多一处密码副本 = 多一处泄漏面；(3) WiFi 密码用户有独立 KeePass / 系统设置导出途径，不需中台代劳。

### OQ-SD4：是否抓 MMS 媒体附件

**A**：仅元数据（subject + parts JSON），不存附件文件
**B**：附件落到 LocalVault 媒体目录

**推荐 A**。理由：(1) MMS 在 2025+ 已是冷数据，用户量少；(2) 附件占空间且分析价值低；(3) v2+ 可加。

---

## 9. 后续演进

- v0.2：iOS 数据全覆盖（CallHistory + sms.db）
- v0.3：日历 (`com.android.providers.calendar`) 接入（Place / Event 强信号源）
- v0.4：Chrome / Safari 浏览历史接入（兴趣画像）
- v0.5：桌面端通讯录（Win People / Mac Contacts）
- v1.x：通话录音（如 MIUI 自带）OCR + 转写（与 Whisper 集成）

---

## 10. 参考

- 上游 [sjqz `parsers/system.py`](file://C:/code/sjqz/src/mobile_forensics/parsers/system.py) — 964 行实现，含 ContactsParser / CallLogParser / SmsParser / WifiParser
- [`Personal_Data_Hub_Architecture.md`](./Personal_Data_Hub_Architecture.md) §12 Phase 4.5
- [`Personal_Data_Hub_Python_Sidecar.md`](./Personal_Data_Hub_Python_Sidecar.md) §3.2 sidecar method 列表
- [`Personal_Data_Hub_EntityResolver.md`](./Personal_Data_Hub_EntityResolver.md) — Phase 8 设计，本 adapter 是种子数据源
- Android contacts schema 参考：[Android 官方文档 ContactsContract](https://developer.android.com/reference/android/provider/ContactsContract)
- iOS AddressBook schema：[apple AddressBook framework](https://developer.apple.com/documentation/addressbook)

## 附录：规范章节补全（v5.0.3.108）

> 本文为设计文档（Adapter 规格）。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述

见正文头部说明。Phase 4.5 System Data adapter 采集系统层数据（通讯录 / 通话记录 / 短信 / WiFi），是 EntityResolver Phase 8 的种子集——通讯录里的电话 / 邮箱 / 备注名是后续所有 adapter 的 Person 实体权威主键。

### 2. 核心特性

系统层数据（非单 app）：Android contacts/telephony providers + WiFi、iOS AddressBook + CallHistory + SMS；EntityResolver 种子源。

### 3. 系统架构

见父文档 `Personal_Data_Hub_Architecture.md` v0.3 §12 Phase 4.5 + `Personal_Data_Hub_Python_Sidecar.md` §3.2；经 sidecar `system.parse_*` 4 method。

### 4. 系统定位

Personal Data Hub 的**系统层数据采集 adapter**（Phase 4.5），EntityResolver 种子数据源。

### 5. 核心功能

contacts / call log / sms / wifi 解析 → normalize → LocalVault → Person 主键。详见正文各节。

### 6. 技术架构

Python sidecar（复用 sjqz `parsers/system.py` 964 行：ContactsParser / CallLogParser / SmsParser / WifiParser）；sidecar method 见 sidecar 文档 §3.2。

### 7. 系统特点

非 app 数据而是系统层；为 EntityResolver 提供权威 Person 主键种子。

### 8. 应用场景

为后续所有 adapter 的人物实体消歧提供权威主键（电话 / 邮箱 / 备注名）。

### 9. 竞品对比

系统层权威主键源，单 app adapter 无法提供（见正文「特殊地位」）。

### 10. 配置参考

sidecar `system.parse_*` 调用参数见 `Personal_Data_Hub_Python_Sidecar.md` §3.2。

### 11. 性能指标

解析随通讯录 / 通话 / 短信条数线性；本地处理。

### 12. 测试覆盖

复用 sjqz `parsers/system.py` 既有解析与样本（见正文参考）。

### 13. 安全考虑

通讯录 / 通话 / 短信极高敏感；落盘经 LocalVault 加密，仅本机；需系统级读取权限。

### 14. 故障排除

provider 读取权限 / root 缺失 → 检查权限与 sidecar 环境（见正文）。

### 15. 关键文件

sjqz `parsers/system.py`；sidecar `system.parse_*`；KG 实体见 `Personal_Data_Hub_EntityResolver.md`。

### 16. 使用示例

见正文 sidecar method 调用示例。

### 17. 相关文档

见正文「10. 参考」：`Personal_Data_Hub_Architecture.md` §12、`Personal_Data_Hub_Python_Sidecar.md` §3.2、`Personal_Data_Hub_EntityResolver.md`。
