# Adapter: WeChat — 微信聊天 + 朋友圈 + 公众号 全量解密同步

> **状态**：v0.1 设计稿（2026-05-19）。Phase 12 待启（v1 压轴 + 难度顶 + 工期最长）。Personal Data Hub 的**终极价值兑现**——把用户最长最完整的数字社交语料库（5+ 年）从微信封闭生态里取回到本地 vault。
>
> **关联**：父文档 [`Personal_Data_Hub_Architecture.md`](./Personal_Data_Hub_Architecture.md) §12 Phase 12；前置 [`Adapter_Email_IMAP.md`](./Adapter_Email_IMAP.md)、[`Adapter_Alipay_Bill.md`](./Adapter_Alipay_Bill.md)、[`Adapter_AIChat_History.md`](./Adapter_AIChat_History.md)
>
> **目标 app**（Redmi 24115RA8EC 真机已装 ✅）：`com.tencent.mm` 微信
>
> **难度等级**：⭐⭐⭐⭐⭐ — 是其它 11 个 adapter 难度的总和
>
> **价值等级**：⭐⭐⭐⭐⭐ — 任何单 adapter 无法替代。无微信中台 = ChainlessChain"数据回归个人"承诺残废 60%。
>
> **重要前提**：本 adapter 仅服务于**用户分析自己手机里的自己微信账户**。不为任何他人代提取、不商业化、不写入云端。法律定性 = 《个保法》"个人或家庭事务"豁免。

---

## 1. 背景

### 1.1 微信在中国用户数据图谱的特殊地位

| 维度 | 微信占比 |
|---|---|
| 个人通讯总量 | ≥ 80%（短信、电话已边缘化） |
| 工作沟通 | 50-90%（除非企业强制飞书/钉钉） |
| 朋友圈 = 个人时间线 | 90%（小红书/微博次之） |
| 转账 / 红包 | 50% （另 50% 支付宝） |
| 公众号 = 长文阅读源 | 70%（与抖音短视频互补） |
| 小程序 / 公众号 H5 服务 | 80% 用户每天用 |
| 群聊 = 兴趣社群 | 主流 |

**典型用户 5 年微信数据规模**：
- 聊天消息：50k - 500k 条
- 朋友圈：500 - 5k 条（含图片）
- 联系人：300 - 3000 人
- 群聊：50 - 500 个
- 媒体附件：5 - 50 GB（图片 / 语音 / 视频 / 文件）
- 公众号收藏：100 - 5k 条
- 转账记录：1k - 20k 笔

**没有官方导出能力**。微信至今未提供任何完整数据导出，仅"聊天迁移到新手机"（端到端 P2P，加密落地，外部不可读）和"聊天记录备份到 PC 客户端"（PC 端落 SQLCipher 加密）两条路径。

### 1.2 为什么这是 ChainlessChain "数据回归个人"承诺的试金石

如果 ChainlessChain 中台连最重要的微信都不能打通：

- "邮箱 + 淘宝 + 美团 + 高德 + AI 对话史"虽多，但**用户的核心社交语料、生活时间线、记忆库**全缺
- 形成不了"我的全息档案"——只是个零散数据收集器
- 与厂商对线的"承诺感"就立不住

打通后：
- 5 年聊天 → 关系图谱、情感轨迹、重要事件抽取
- 朋友圈 → 生活时间线 + 与其它 adapter 时间轴联动（去过哪、吃过啥、跟谁见面）
- 公众号收藏 → 长期阅读兴趣库 → 个性化推荐
- 转账记录 → 与支付宝/银行账单互补，**真正的人际金钱往来视图**

### 1.3 技术挑战概览

| 挑战 | 难度 |
|---|---|
| Root + SELinux 切上下文访问 `/data/data/com.tencent.mm/` | ★★★ |
| WeChat 8.0+ SQLCipher 密钥从 IMEI+uin 派生改为运行时生成 | ★★★★★ |
| WCDB（Tencent fork SQLCipher）多版本差异 | ★★★ |
| EnMicroMsg.db schema（300+ 表 + ProtoBuf BLOB 字段） | ★★★★ |
| 媒体附件分散 + 各自加密策略（amr/jpg/mp4 自带 XOR header） | ★★★ |
| 8.0+ 启用 KeyStore 硬件密钥包装 | ★★★★ |
| 频繁版本更新（每月小更，每季大更）打破现有方案 | ★★★★★ |
| 微信反调试 / 反 Frida 检测可能影响 hook | ★★★★ |

---

## 2. 目标 & 非目标

### 2.1 目标 (v1 in scope)

| # | 项 | 验收 |
|---|---|---|
| G1 | Root + SELinux 环境检测 + Magisk DenyList 配置文档 | UI 引导 + 一键自检 |
| G2 | WeChat 数据库密钥提取（Frida hook on WeChat ≥ 8.0） | 提取成功率 ≥ 95%（针对 Redmi 24115RA8EC + 当前微信版本） |
| G3 | EnMicroMsg.db 消息表全量解析（含群聊 / 引用 / 撤回 / 转发） | 消息保真 ≥ 99% |
| G4 | SnsMicroMsg.db 朋友圈解析（含图片 / 视频 / 评论 / 点赞） | 朋友圈保真 ≥ 99% |
| G5 | 联系人 / 群成员 / 备注名映射 | EntityResolver 跨源对齐 |
| G6 | 媒体附件解密（amr/jpg/mp4/file） | 每类 ≥ 95% 成功 |
| G7 | 公众号收藏（Favitems）解析 | 文本 / 链接 / 图片 提取 |
| G8 | UnifiedSchema 映射（5 年 100k+ 消息 ingest < 30min） | 性能测 |
| G9 | AI 分析 use cases | "我妈最近 3 周没主动找我"等 5 个旗舰问题答准 |
| G10 | 增量同步（每天 / 每周 cron） | 重跑 0 重复 + 仅拉新消息 |
| G11 | 法律 / 合规 UI gate（首次使用强提示 + 用户签字） | 不绕过 |
| G12 | 完整失败回滚（解密失败 / 解析失败 不污染 vault） | 单测 |

### 2.2 非目标 (defer)

- **代提取他人手机微信** — 永远 NO（伦理 + 法律红线）
- **微信支付详细记录**（含商户 / 商品） — v1 仅记录金额 / 对方 / 时间；商品细节交给支付宝 adapter
- **小程序内数据** — 各小程序独立沙箱不可达
- **公众号文章原文全量缓存** — v1 仅存 URL + 标题 + 摘要；v2 选择性全文抓
- **视频号** — 未来另一个 adapter
- **企业微信** — 独立 adapter（包名 `com.tencent.wework`，DB schema 不同）
- **WeChat for PC / Mac 客户端数据** — v2 兼容（PC 端 SQLCipher 密钥提取方法不同）
- **iOS 微信数据** — iOS 不开 root 无法访问；v3 用 iTunes 备份解析路径
- **撤回消息追溯** — 微信本地表保留删除标记，v1 显示"已撤回"占位；v2 尝试恢复内容
- **群聊全员真实姓名** — 群成员 ID 是 wxid 字符串，对方未加好友无法获真名；v1 用群昵称
- **朋友圈点赞 / 评论 的他人姓名** — 同上
- **历史 8.0 以下密钥派生**（IMEI+uin） — v1 假设用户用最新微信
- **微信键盘 / 表情包 / 状态** — 不抓
- **写回 / 修改 / 删除微信本身数据** — adapter 严格只读
- **多账号切换** — v1 仅当前登录账号；v2 加多账号
- **Magisk 之外的 root 方案**（KernelSU 等） — v1 仅 Magisk + Zygisk；v2 扩展

---

## 3. Open Questions

### OQ-1：密钥提取方式

**A**：纯 Frida hook libwcdb.so 的 sqlite3_key 调用
**B**：Frida hook + Magisk Zygisk module 自启动注入
**C**：内存扫描密钥模式（不依赖 hook）
**D**：从 Android Keystore 直接读（v8.0+ 微信用 Keystore 包了密钥）

**推荐 A + 备用 C**。理由：
- (A) Frida hook 最直接 — `Sqlite3.open` 调用时 hook 第二参数（key），运行时拿到明文密钥
- (B) Zygisk 自启动好处是用户启动微信即 hook，无需手动 attach；但 Zygisk 模块开发 + 维护成本高，v1 不引
- (C) 内存扫描（grep `^[0-9a-f]{32}$` pattern 在微信进程地址空间）是 fallback；准确率低
- (D) 微信用 Keystore 但是是**包装层**——密钥经 KeyStore wrap，sqlite3 拿的是 unwrap 后的版本；直接读 Keystore 拿到的是 wrapped blob，没用
- v2 升级到 B（Zygisk 自启动 = 用户体验"一次配置永久工作"）

### OQ-2：解密时机

**A**：在线模式 — 每次同步实时 Frida hook + 读 DB
**B**：离线模式 — Frida hook 一次拿密钥落 Keystore，之后 native SQLCipher 库直读 DB
**C**：A + B 混合（首次 A，密钥 cache 后 B，密钥失效 fallback A）

**推荐 C**。理由：(1) 微信运行时密钥每次启动可能变（需验）；(2) Cache 提速大；(3) 失效兜底自动重试 Frida。Cache 寿命：最长 24h，或微信进程重启后失效。

### OQ-3：媒体附件处理范围

**A**：全量解密所有附件落 vault 副本
**B**：只解密 + 仅存 URL 引用 + 按需打开时再解
**C**：分级 — 图片 / 语音 / 文件 不同策略

**推荐 C**。理由：(1) 全量（A）爆磁盘（用户媒体 5-50GB）；(2) 全 URL（B）原文件路径在微信清缓存后会失效，重要附件可能丢；(3) C 分级：
- **图片**：缩略图本地化（50KB × 量），原图 URL 引用 + 按需解
- **语音 (.amr)**：原文件小（< 100KB），全量本地化 + 解密
- **视频**：仅缩略图，原视频按需
- **文件**：仅元数据（filename / size / hash），原文件按需

### OQ-4：群消息粒度

**A**：每条群消息是一个 Event（含群 talker_id 作为 source）
**B**：群作为 Topic，消息归到 Topic
**C**：A + B 双层（每消息 1 Event + 群 1 Topic + Event → Topic edge）

**推荐 C**。理由：(1) RAG 需要每条消息独立可召；(2) 群是高频概念，作为 Topic 让"在 X 群的所有消息"查询自然；(3) 与 AI Chat adapter Conversation/Message 双层架构对齐。

### OQ-5：朋友圈他人内容

**A**：完全不抓（仅抓本人发的）
**B**：抓本人能看到的全部（含好友的）
**C**：默认 B，UI 警示 + 用户选

**推荐 C，默认 B**。理由：(1) 朋友圈本质是用户看到的"timeline"，缺好友内容则失去时间线意义；(2) 本人能看到的内容 = 本人电脑硬盘已存（手机 cache），中台落地不增加访问范围；(3) 但**严禁外传**（vault 加密 + 不上云）；(4) UI 首次启用强提示用户知晓 + 同意；(5) 用户可选 A 模式严格只抓本人。

### OQ-6：增量同步策略

**A**：基于 msgSvrId 单调递增（仅个人聊天 / 部分群表）
**B**：基于 createTime 时间窗
**C**：基于 EnMicroMsg.db 内某个"watermark" meta 表
**D**：每个 talker 一个 last_msgSvrId watermark

**推荐 D**。理由：(1) 微信 message 表有 `talker` 字段（聊天对象 wxid）和 `msgSvrId`（消息 ID 单调）；(2) per-talker watermark 精度最高 + 性能好；(3) 单条 SQL `WHERE talker=? AND msgSvrId > ?` 拉新消息。

### OQ-7：法律 / 合规 gate

**A**：默认开启所有 adapter，弹窗 1 次说明
**B**：默认关闭 WeChat adapter，用户主动开启 + 阅读条款 + 勾选
**C**：极其严格 — 每次同步前都需用户重新确认

**推荐 B**。理由：(1) 微信是所有 adapter 里**含他人 PII 最多**的；(2) A 太松，用户不读条款；(3) C 太烦；(4) B 用户首次启用时强阅读 + 勾选，之后正常运行。条款写明：
- "仅用户分析自己的微信账号，不可用于他人"
- "数据本地加密存储，不上云"
- "用户对自己访问到的他人朋友圈 / 群聊内容承担二次使用责任"
- "ChainlessChain 不对微信 ToS 违反承担连带责任"

---

## 4. 数据源分析

### 4.1 文件系统位置（Root 后）

```
/data/data/com.tencent.mm/
├── MicroMsg/
│   ├── <md5(uin)>/                       ← 当前账号目录，md5 hash 不重要可枚举
│   │   ├── EnMicroMsg.db                 ← 主消息数据库（SQLCipher）
│   │   ├── EnMicroMsg.db-shm             ← WAL shared memory
│   │   ├── EnMicroMsg.db-wal             ← WAL 日志（含最近未 checkpoint 数据）
│   │   ├── SnsMicroMsg.db                ← 朋友圈数据库
│   │   ├── Favorite/                     ← 收藏夹
│   │   │   └── Favorite.db
│   │   ├── image2/                       ← 图片缓存（加密 .dat 文件）
│   │   ├── voice2/                       ← 语音消息（XOR 加密的 .amr）
│   │   ├── video/                        ← 视频缓存
│   │   ├── file/                         ← 文件附件
│   │   └── sns/                          ← 朋友圈媒体
│   ├── CompatibleInfo.cfg                ← 含 uin（用户唯一 ID）
│   └── plugins/                          ← 公众号文章缓存
├── shared_prefs/
│   ├── auth_info_key_prefs.xml
│   └── system_config_prefs.xml
└── files/
    └── ... (账号配置 / cache)

/sdcard/Android/data/com.tencent.mm/        ← Android 8+ scoped storage 后这部分受限
└── MicroMsg/
    └── (媒体备份分区)
```

### 4.2 主要数据库 schema 概览（EnMicroMsg.db）

> 300+ 表，以下是 v1 接入的核心表。完整 schema 在写代码前**抓真机当前版本** dump 验证。

| 表 | 关键字段 | 说明 |
|---|---|---|
| `message` | `msgId, msgSvrId, talker, content, type, createTime, isSend, status` | 消息主表（含个人 + 群） |
| `rcontact` | `username (wxid), alias, nickname, conRemark, type` | 联系人 |
| `chatroom` | `chatroomname, memberlist, displayname, roomowner` | 群信息 |
| `EmojiInfo` | (表情包) | v1 不抓 |
| `userinfo` | 当前用户信息 | 抓 |
| `bottleMessage` | (漂流瓶) | 不抓 |
| `voipinfo` | (语音/视频通话记录) | 抓元数据 |
| `WechatTransfer` | (转账记录) | 抓 |
| `appattach` | (文件附件元数据) | 抓 |
| `imginfo2` | (图片元数据) | 抓 |
| `videoinfo2` | (视频元数据) | 抓 |

### 4.3 SnsMicroMsg.db 表（朋友圈）

| 表 | 关键字段 | 说明 |
|---|---|---|
| `snsinfo` | `userName, content, snsId, createTime, like_flag, type` | 朋友圈主表 |
| `SnsComment` | (评论) | 抓 |
| `SnsExtinfo3` | (扩展元数据，含 media 链接) | 抓 |

### 4.4 消息 type 字段含义（`message.type`）

| type | 含义 | v1 处理 |
|---|---|---|
| 1 | 文本 | content 直接是文本 |
| 3 | 图片 | content 是 XML，含 cdnUrl / md5 / 本地 imgPath |
| 34 | 语音 (.amr) | content 是 XML，含 voiceLength / fileName |
| 42 | 名片 | 抓 |
| 43 | 视频 | content XML 含 cdnUrl |
| 47 | 表情包 / GIF | 抓元数据 |
| 48 | 位置 | 抓 lat/lng + 名称 |
| 49 | 链接 / 公众号文章 / 转账 / 红包 / 文件 / 小程序 | sub-type 多种，content XML 解析 |
| 50 | 语音通话 / 视频通话 | 抓时长 |
| 10000 | 系统消息（撤回 / 拉人入群 等） | 抓元信息 |

类型 49 子类（含 `<msg><appmsg type="X">` 子标签）：
- 2: 图文
- 3: 音乐
- 4: 视频
- 5: 网页链接
- 6: 文件
- 8: GIF
- 17: 位置共享
- 19: 合并转发
- 21: 红包
- 33/36: 小程序
- 51: 视频号

### 4.5 content 字段格式

- 个人聊天 type=1：`content = "你好"` 纯文本
- 群聊 type=1：`content = "<wxid_xxx>:\n你好"` — 发送者 wxid + 冒号 + 换行 + 实际文本
- 类型 ≥ 3：XML 字符串（需 XML parser）
- 部分 type=49 子类：嵌套 ProtoBuf in XML，需 双层解析

---

## 5. 密钥提取（核心难点）

### 5.1 WeChat 8.0+ 密钥派生流程（已知）

```
微信启动
  ↓
读 CompatibleInfo.cfg → uin (用户唯一 ID)
  ↓
读 Android Keystore 中 'WCDB_KEY' (StrongBox 包装的 wrapped key)
  ↓
KeyStore.unwrap() → 32-byte raw key
  ↓
调用 libwcdb.so::sqlite3_key(db, raw_key, 32)
  ↓
WCDB 用 raw_key 启 SQLCipher PBKDF2
```

**关键 hook 点**：`sqlite3_key` 调用的瞬间，raw_key 在内存中明文存在。Frida 在此 hook，拷出 32 字节即得密钥。

### 5.2 Frida hook 脚本骨架（v1 reference）

```javascript
// hook-wechat-key.js
Java.perform(function() {
  // 1. 找 libwcdb.so 加载基址
  var libwcdb = Process.findModuleByName("libwcdb.so");
  if (!libwcdb) {
    console.log("[!] libwcdb.so not loaded yet, retrying...");
    setTimeout(arguments.callee, 1000);
    return;
  }

  // 2. 找 sqlite3_key 符号 (或 sqlite3_key_v2)
  var sqlite3_key = libwcdb.findExportByName("sqlite3_key");
  if (!sqlite3_key) {
    // 备用：地址扫描 / 已知偏移
    sqlite3_key = libwcdb.base.add(KNOWN_OFFSET_BY_VERSION);
  }

  // 3. attach
  Interceptor.attach(sqlite3_key, {
    onEnter: function(args) {
      // args[0]: sqlite3* db (实例)
      // args[1]: const void* pKey
      // args[2]: int nKey (= 32)
      var keyPtr = args[1];
      var keyLen = args[2].toInt32();
      if (keyLen >= 32) {
        var keyHex = hexlify(Memory.readByteArray(keyPtr, 32));
        console.log("[+] WeChat DB key captured: " + keyHex);
        // 发送给 ChainlessChain adapter
        send({ event: "wcdb_key", key: keyHex });
      }
    }
  });
});
```

ChainlessChain Frida runner 接收 send 消息 → 落 vault Keystore namespace `wechat-db-key`。

### 5.3 hook 失败时的 fallback

**fallback 1：内存扫描**

```
微信进程地址空间扫描 → 找连续 32 字节看似 SQLCipher key 的 region
启发式：
  - 在 heap 区
  - 字节熵高（非全 0 / 非 ASCII）
  - 附近有 sqlite3 结构体（"SQLite format 3" 标识附近）
准确率：60-80%，慢
```

**fallback 2：用户手动提供**

UI 提示："Frida hook 失败。用户可以从 hook 桌面端微信（PC 客户端走 PC 工具拿密钥）或求助社区脚本"

**fallback 3：等待官方导出**

不太可能微信主动开放，留作 placeholder

### 5.4 hook 反检测

微信 8.0+ 部分版本内置反 Frida 检测：

- 检查 `/proc/<pid>/maps` 含 `frida-agent.so` 字符串
- 检查 `frida-server` 进程
- ptrace 自检

**v1 应对**：
- 使用 Magisk Zygisk 注入（无 frida-server 进程，直接进程内 .so 注入）
- 文件名混淆（rename frida-agent.so）
- LinkerHook 隐藏注入痕迹

**底线**：如果 hook 持续失败，UI 明示用户："当前微信版本反 Frida 检测较强，建议 (1) 等待社区脚本更新 (2) 降级到旧版本微信 (3) 跳过此 adapter"

### 5.5 跨手机 / 跨账户

- 同手机同账号：密钥 cache 24h；微信进程重启可能变（需重 hook）
- 同手机切账号：每账号独立密钥，cache key 按 uin
- 换手机：完全重新提取
- 一台手机不支持多账号同时跑（微信 app 设计如此）

---

## 6. Adapter 实现

### 6.1 类结构

```typescript
class WeChatAdapter implements PersonalDataAdapter {
  name = "wechat";
  version = "0.1.0";
  capabilities = [
    "sync:sqlite", "parse:messages", "parse:moments",
    "parse:contacts", "parse:transfers",
    "extract:media-image", "extract:media-voice"
  ];

  constructor(private account: WeChatAccount) {}

  async authenticate(ctx: AuthContext): Promise<AuthResult>;
  async *sync(opts: SyncOptions): AsyncIterable<RawMessage | RawMoment | ...>;
  normalize(raw: any): NormalizedBatch;
  async healthCheck(): Promise<HealthStatus>;

  rateLimits = {};  // 本地 DB 读，无限流
  dataDisclosure = {
    fields: [
      "wechat:messages:text,sender,timestamp,group",
      "wechat:moments:content,images,location,comments",
      "wechat:contacts:wxid,nickname,remark,phone(if available)",
      "wechat:transfers:amount,counterparty,note",
    ],
    sensitivity: "high",
    legalGate: true,  // 触发 §3 OQ-7 的强 UI gate
  };
}

interface WeChatAccount {
  androidPackage: "com.tencent.mm";
  uin: string;          // 从 CompatibleInfo.cfg 读出，标识账户
  dbDirHash: string;    // /data/data/com.tencent.mm/MicroMsg/<hash>/
  cachedKey?: string;   // hex，24h TTL
  cachedKeyAt?: number;
}
```

### 6.2 同步主流程

```
0. 启动前置检查：
   a. 用户是否同意法律 gate (OQ-7)？否 → return
   b. 设备是否 root？否 → return
   c. SELinux 上下文可达 com.tencent.mm 数据域？否 → 引导 Magisk 配置
   d. WeChat 是否在前台运行（hook 需要进程活着）？否 → 提示用户打开微信

1. 密钥提取：
   a. 检查 cachedKey 是否在 24h TTL 内 → 是用 cached
   b. 否则：Frida attach com.tencent.mm + hook sqlite3_key
      - 设 30s 超时
      - 触发用户在微信里执行任意操作（打开聊天）触发 DB 访问
      - 拿到 key → cache 到 Keystore (namespace wechat-db-key)
   c. fallback: 内存扫描

2. DB 复制（避免锁竞争）：
   a. 复制 EnMicroMsg.db + SnsMicroMsg.db 到临时目录（微信运行时不可直接读）
   b. 关闭 WAL（拷贝时 checkpoint）
   c. 在副本上做后续解密 / 查询

3. 解密：
   a. 用 native sqlcipher 库 (better-sqlite3-multiple-ciphers) 打开副本
   b. PRAGMA key = "x'<hex-key>'"
   c. PRAGMA cipher_compatibility = 3 (匹配微信版本)
   d. 测试 query SELECT count(*) FROM message

4. 增量拉消息：
   For each contact_wxid in rcontact:
     last_msgSvrId = sync_watermark.wechat.<wxid> or 0
     rows = SELECT * FROM message WHERE talker=? AND msgSvrId > ? ORDER BY msgSvrId
     for each row → RawMessage yield
   更新 watermark

5. 增量拉朋友圈：
   last_sns_createTime = ...
   SELECT * FROM snsinfo WHERE createTime > ?

6. 拉联系人 / 群（每次全量，量小）

7. 媒体附件按 type 处理：
   - type=3 (image): imgPath 找 image2/<hash>.dat → 解密 (XOR + JPEG header) → 缩略图本地
   - type=34 (voice): fileName 找 voice2/<hash>.amr → 解密 (XOR) → 全量本地
   - type=43 (video): videoFileName → 缩略图本地，原视频引用
   - type=49 sub=6 (file): appattach 元数据 + 原文件路径

8. normalize 每条 → UnifiedSchema → vault ingest
```

### 6.3 图片解密

微信图片 `.dat` 文件 = 在 JPG/PNG 前加了固定 XOR 字节：

```
原始 .dat 前两字节：0xVV 0xWW
JPEG header 前两字节应该是：0xFF 0xD8 (固定)
异或 byte = 0xVV ^ 0xFF
反推所有字节都 XOR 这个 byte → 还原原图

PNG: 0x89 0x50 → 异或 byte = 0xVV ^ 0x89
GIF: 0x47 0x49 → 异或 byte = 0xVV ^ 0x47
```

代码 ~10 行：

```javascript
function decryptWeChatImage(buf) {
  const xor = buf[0] ^ 0xFF;  // 假设 JPEG，可启发判别
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) {
    out[i] = buf[i] ^ xor;
  }
  return out;
}
```

### 6.4 语音解密

微信 amr 文件 = AMR header + 固定 XOR：

```
正常 AMR 第一字节：0x23 ('#') 来自 "#!AMR" header
微信加密 amr 第一字节：0xVV
xor = 0xVV ^ 0x23
全文件 XOR
```

### 6.5 群消息 sender 解析

群聊 `message.content` 字段：
```
"wxid_abc123:\n你好大家"
```

解析：
- 第一行（直到 `:\n`）= sender wxid
- 余下 = 实际文本
- 通过 sender wxid 在 rcontact 表查 nickname / remark

### 6.6 type=49 子类 XML 解析

```xml
<msg>
  <appmsg appid="" sdkver="0">
    <title>这是公众号文章标题</title>
    <des>摘要</des>
    <url>https://mp.weixin.qq.com/s/...</url>
    <type>5</type>  <!-- 5 = 链接 -->
    <thumburl>https://...</thumburl>
  </appmsg>
</msg>
```

解析后落 Event.content.text=title, content.mediaRefs=[url], extra.appmsgType=5。

---

## 7. UnifiedSchema 映射

### 7.1 RawMessage → Event

```typescript
{
  id: "evt-uuid",
  type: "event",
  subtype: "message",     // 与 AI Chat / Email 的 "ai-message" 区分
  occurredAt: row.createTime,
  actor: row.isSend ? "person-self" : lookupPerson(row.talker, row.senderInGroup),
  participants: [
    "person-self",
    ...(isGroup ? groupMembers : [lookupPerson(row.talker)])
  ],
  topics: isGroup ? [`topic-group-${row.talker}`] : [`topic-1on1-${row.talker}`],
  content: {
    text: parsedText,
    mediaRefs: [imageLocalPath, voiceLocalPath, ...].filter(Boolean),
  },
  source: {
    adapter: "wechat",
    adapterVersion: "0.1.0",
    originalId: row.msgId,
    capturedAt: <now>,
    capturedBy: "sqlite",
  },
  extra: {
    wechatTalker: row.talker,
    wechatType: row.type,
    wechatAppmsgType: row.type === 49 ? appmsgSubType : undefined,
    isGroup,
    senderWxid: row.senderInGroup,
    msgSvrId: row.msgSvrId,
  },
}
```

### 7.2 RawContact → Person

```typescript
{
  id: "person-wxid-<wxid>",
  type: "person",
  subtype: row.username === selfWxid ? "self" : "contact",
  names: [row.conRemark, row.nickname, row.alias].filter(Boolean),
  identifiers: {
    wechatId: row.username,           // wxid_xxx
    wechatAlias: row.alias,           // 可能等于手机号
    phone: row.phone || undefined,    // 部分情况可获
  },
  relation: undefined,                // 用户后续标注
  notes: undefined,
}
```

EntityResolver Phase 8 会把这个 Person 与其它源（高德足迹 / 美团订单收件人 / Alipay 转账对方等）merge 起来——这是中台跨源合一的核心价值。

### 7.3 RawMoment → Event + Topic

```typescript
// Event: 朋友圈条目
{
  id: "evt-sns-<snsId>",
  type: "event",
  subtype: "post",
  occurredAt: row.createTime,
  actor: lookupPerson(row.userName),
  content: {
    text: parsedContent.text,
    mediaRefs: parsedContent.images.map(img => imageLocalPath),
  },
  topics: ["topic-moments"],     // 全局朋友圈 topic
  source: { adapter: "wechat", ... },
  extra: {
    snsId: row.snsId,
    location: parsedContent.location,
    likeCount: parsedContent.likeCount,
    commentCount: parsedContent.commentCount,
    // 评论作为子 Event 单独建条目
  },
}

// 子 Event: 评论 / 点赞
{
  type: "event",
  subtype: "interaction",
  occurredAt: comment.createTime,
  actor: lookupPerson(comment.userName),
  // ... 链接回原 sns Event
}
```

### 7.4 KG triples 派生

```
Event(message) --sender--> Person(<wxid>)
Event(message) --in-group--> Topic(group-<chatroomname>) (if group)
Event(message) --replies-to--> Event(<msgSvrId-quoted>) (引用消息时)
Event(post) --posted-by--> Person(self)
Event(post) --at-place--> Place(<location>) (if any)
Event(interaction) --on-post--> Event(post)
```

---

## 8. AI 分析价值

### 8.1 仅 WeChat adapter 接入后可问

| 问题 | 数据路径 |
|---|---|
| "我妈最近 3 周没主动找我" | last message FROM mom WHERE isSend=0 时间窗 |
| "我和老板最近一次聊啥" | recent N messages WHERE talker=boss-wxid |
| "去年这个时候我朋友圈发了啥" | sns WHERE createTime IN window |
| "我加过最多群的话题是什么" | group chatroom names + LLM 聚类 |
| "我和我老婆相识满 N 年了" | first message between us → 计算 |
| "我最近转账给谁最多" | type=49 sub=21 (red envelope) + sub=2000 (transfer) |
| "我收藏夹里关于 X 的文章" | Favorite + 全文检索 |
| "我妈生日是哪天" | LLM 搜索过往聊天提及"生日"+ 我妈名字 |
| "去年中秋我跟谁过的" | sns + messages 时间窗 |
| "我跟 X 最长的连续对话" | window slide 找最大密度 |
| "我加了某人多久了" | rcontact 中 wxid 出现的最早消息时间 |

### 8.2 跨源旗舰 use case

**"我妈生日那周买了啥送哪儿？"**

跨源串接：
1. WeChat: 搜索"妈"近期消息 → 找到她说过的生日（"周三我生日"）
2. WeChat 联系人 → 妈妈 wxid + remark + 手机号
3. Alipay: 那一周转账给妈妈手机号的记录
4. Taobao: 那一周下单收件人 = 妈妈
5. 高德: 那一周我去过妈妈家附近的足迹
6. 美团: 那一周给妈妈下的外卖订单

**Cowork agent 跨 4 个 adapter 自动 join** → 完整故事线呈现。这是 Personal Data Hub 真正的旗舰能力。

### 8.3 关系分析

| 维度 | 数据 |
|---|---|
| 互动频率 | 每联系人月均消息数 |
| 主动方占比 | isSend=1 比例 |
| 情感倾向 | LLM 抽消息情感（"开心"/"担心"/"生气"） |
| 共同话题演化 | LLM 月度主题抽取 + 趋势 |
| 失联预警 | 长期没互动的重要关系（家人 / 老友） |

### 8.4 公众号阅读画像

| 维度 | 数据 |
|---|---|
| 阅读偏好 | favorites + 群里转过的链接 |
| 兴趣领域演化 | 月度主题抽取 |
| 收藏 vs 转发 比例 | favorites count vs 群消息 type=49 sub=5 |

---

## 9. UI/UX

### 9.1 法律 gate（首次启用）

```
┌─ 微信数据 adapter ────────────────────────────────────┐
│                                                       │
│  ⚠️  启用前请阅读：                                     │
│                                                       │
│  本 adapter 将通过 root 权限读取本机 com.tencent.mm    │
│  数据库，提取您的微信聊天、朋友圈、联系人等。           │
│                                                       │
│  ☐ 我承诺：                                            │
│      仅分析我自己的微信账户                             │
│      不为他人代提取                                    │
│      数据仅本地存储，不上云                             │
│      朋友圈 / 群聊 等含他人 PII 内容仅个人查阅          │
│                                                       │
│  ☐ 我了解：                                            │
│      微信 ToS 未明示授权程序化读取                      │
│      理论上存在被微信端识别异常使用的可能性             │
│      ChainlessChain 已做规避但不承诺 100% 隐蔽         │
│      用户对自己账户风险自负                             │
│                                                       │
│  ☐ 我同意：                                            │
│      "个人或家庭事务"《个保法》豁免框架下使用           │
│                                                       │
│  [取消]                              [我已阅读并同意]   │
└───────────────────────────────────────────────────────┘
```

### 9.2 环境检查向导

```
┌─ 启用前环境自检 ──────────────────────────┐
│  ✅ Android 设备已 root (Magisk 检测)      │
│  ✅ Magisk Zygisk 已启用                   │
│  ⚠️  Magisk DenyList 中 com.tencent.mm    │
│       建议从 DenyList 移除（否则 Frida    │
│       无法 attach）→ [打开 Magisk 设置]   │
│  ✅ Frida server 运行中                    │
│  ⚠️  WeChat 未在前台 → [打开微信]         │
│  ✅ 数据目录可达 /data/data/com.tencent.mm│
│                                            │
│  [重新检查] [继续启用]                     │
└────────────────────────────────────────────┘
```

### 9.3 密钥提取实时反馈

```
正在提取密钥...
  📌 等待 Frida 注入微信进程
  📌 等待 sqlite3_key 调用（请在微信中打开任意聊天）
  ✅ 已捕获密钥（缓存 24h）
  📌 复制数据库...
  📌 解密验证...
  ✅ EnMicroMsg.db 解密成功 (124,832 条消息)
  ✅ SnsMicroMsg.db 解密成功 (1,234 条朋友圈)
```

### 9.4 同步进度

```
微信数据同步中... 进度 [████████████░░░] 78%
  联系人：1,234 / 1,234 ✅
  群聊：145 / 145 ✅
  消息：97,432 / 124,832 (78%)
  朋友圈：890 / 1,234 (72%)
  媒体：12.3 GB / 18.7 GB (66%)
  ETA：~8 分钟

[暂停] [取消]
```

### 9.5 同步完成报告

```
┌─ 同步完成 ────────────────────────────────┐
│ 总耗时：22 分 18 秒                        │
│                                            │
│ 已 ingest：                                 │
│   消息：124,832 条                          │
│   朋友圈：1,234 条                          │
│   联系人：1,234 人                          │
│   群：145 个                                │
│   转账记录：2,184 笔                        │
│   收藏：573 条                              │
│   语音：5,892 段（128 MB）                  │
│   图片缩略图：8,231 张（391 MB）            │
│                                            │
│ 跨源关联（与已有 adapter 数据）:            │
│   邮箱 ←→ 微信公众号收藏: 41 link           │
│   Alipay ←→ 微信转账: 1,128 link            │
│   高德足迹 ←→ 朋友圈位置: 89 link           │
│                                            │
│ AI 分析就绪 → [打开个人 AI 助手]            │
└────────────────────────────────────────────┘
```

---

## 10. 安全 & 隐私

### 10.1 数据本地化承诺

- vault 落地：AES-256 SQLCipher (master key in Keystore + optional U-Key)
- 不写任何缓存到非 vault 区域
- 不向 ChainlessChain 后端或任何第三方传任何 byte
- 抓包验证：sync 期间网络流量目的地仅 LAN（如跨设备同步走 P2P）

### 10.2 密钥分级

- WeChat DB key (32 bytes hex)：cache in Keystore namespace `wechat-db-key`，24h TTL，重启微信失效
- Adapter 主进程读取后即用即销，不写日志
- vault master key 独立（与 WeChat key 不混）

### 10.3 朋友圈他人数据策略

- 默认入 vault（per OQ-5）
- 默认**只对本人 LLM 可见**
- 用户可设"分析时屏蔽他人内容"开关
- 用户可对单条朋友圈"删除"（仅删 vault，不影响微信）
- 跨设备同步**强加密**且**只同步给该用户的其它设备**

### 10.4 audit log

- 每次 sync：开始时间 + 提取条数 + 失败数 + 耗时
- 每次密钥使用：cached / re-extracted
- 每次 AI 分析读取消息：query + 召回 N 条 + 时间
- 用户可查可导出

### 10.5 用户离开 ChainlessChain

- 完整导出：JSON-LD + 解密媒体（按用户选择）
- 一键擦除：删 vault + 删 cached key + audit log 记录
- 没有"后台沉积"

### 10.6 微信账号风险评估

| 风险 | 概率 | 缓解 |
|---|---|---|
| 微信检测到 Frida → 限号 | 低（Magisk Zygisk 注入 + 反检测） | UI 明示用户自担 |
| 微信检测到异常 DB 访问模式 → 限号 | 极低（adapter 只复制 DB，不动微信本身） | 复制走 root，微信视角无异常 |
| 微信版本升级 → adapter 失效 | 高（每月） | 版本检测 + UI 提示等社区脚本更新 |
| Magisk 被微信识别 → 部分功能受限 | 中（已知问题，与 adapter 无关） | DenyList 配置文档 |

---

## 11. 测试计划

### 11.1 单测

- Schema parser：每张表 fixture ≥ 30 条（含边缘场景：撤回 / 引用 / 转发 / 表情包 / 系统消息）
- 消息 type 路由：每 type 至少 5 条 fixture
- 群消息 sender 解析：100 条边缘格式
- type=49 子类 XML：每 sub-type ≥ 10 条
- 图片解密：5 种格式 + 5 种 XOR byte
- 语音解密：amr / aac 多版本
- normalize → UnifiedSchema：1000 条 fixture → JSON Schema 校验
- KG triples 派生：含群 / 含引用 / 含位置

### 11.2 集成测试

- E2E：fixture DB（团队自建测试微信账号 + 数月数据） → adapter → LocalVault → KG → RAG → Q&A
- 增量：重跑同窗口 → 0 重复
- 跨源 link：与 Alipay / 高德 / 邮箱 fixture 同时 ingest，验 link 数

### 11.3 真机 E2E

| 场景 | 验收 |
|---|---|
| Redmi 24115RA8EC + 当前微信版本 密钥提取 | ≥ 95% 成功 |
| 首次全量同步 100k+ 消息 | < 30 分钟 + 100% 解密 |
| 法律 gate 流程 | 用户必须勾全才能继续 |
| Magisk DenyList 引导 | 文档清晰 + 一键打开 Magisk |
| Frida hook 失败 fallback | 内存扫描 / 用户提示 |
| 增量第 2 天同步 | 仅新消息（≥ 95% 减小 IO） |
| 群消息 sender 准确 | 1000 条 ≥ 99% |
| 朋友圈 + 图片缩略图 | 95% 加载 |
| 公众号文章解析 | 标题 + 链接 + 摘要 |
| 转账记录抽取 | 金额 + 对方 + 备注 + 时间 |
| 跨源旗舰 use case | "我妈生日那周买了啥送哪儿"答全 |
| 数据导出 + 销毁 | 完整 |

### 11.4 微信版本兼容矩阵

| 微信版本 | 状态 | 验证日期 |
|---|---|---|
| 8.0.0 - 8.0.49 | 已知方案 | TBD |
| 8.0.50+ | v1 主测目标 | 2026-05+ |
| 9.0.x | adapter 尝试自动适配；失败提示用户社区脚本 | 视发布 |

---

## 12. Phase 拆分（adapter 内部）

| Sub-phase | 内容 | 工期 |
|---|---|---|
| 12.1 | 环境检测 + 法律 gate UI + Magisk DenyList 引导 | 1d |
| 12.2 | Frida hook 脚本 + 密钥提取主流程 + cache | 2d |
| 12.3 | DB 复制 + SQLCipher 解密 + schema 探测 | 1d |
| 12.4 | message 表解析（个人 + 群 + 各 type）+ normalize | 2d |
| 12.5 | snsinfo 表解析 + 评论 / 点赞 | 1d |
| 12.6 | 联系人 / 群 / 转账 表解析 | 1d |
| 12.7 | 媒体附件解密（image / voice） | 1d |
| 12.8 | type=49 XML 子类 + 公众号收藏 | 1d |
| 12.9 | E2E 真机验 + 性能 + 跨源 link 测 | 1d |

**总**：~10 天，与父文档 §12 Phase 12 工期一致。

可加速：12.2 + 12.3 并行（环境 + 密钥 / DB）。

---

## 13. Traps & 风险

| # | Trap | 描述 | 缓解 |
|---|---|---|---|
| T1 | 微信版本升级密钥派生变 | 8.0.X 升 9.0 路径完全可能换 | Frida hook 名称 fallback list + 社区共享 patch |
| T2 | Frida 检测越来越严 | 微信投入反 Frida 资源 | Magisk Zygisk + LinkerHook 隐藏 + 必要时用户切旧版微信 |
| T3 | SQLCipher 版本不匹配 | WCDB fork 与官方 SQLCipher 兼容性 | `PRAGMA cipher_compatibility = 3` + better-sqlite3-multiple-ciphers 支持版本广 |
| T4 | message 表过大 | 100k+ 行 + 大量 BLOB 字段 | 分批 query + LIMIT 1000 + offset |
| T5 | WAL 文件含未 checkpoint 数据 | 拷贝时丢最新几条 | 拷贝前 `PRAGMA wal_checkpoint(FULL)` + 备份 wal |
| T6 | XML 解析 corner case | 历史消息含古早 XML 格式 | 多版本 parser fallback + parse 失败的消息进 review 队列 |
| T7 | 群成员表过期 | 已退群但历史消息含未知 wxid | 容忍未知 sender，仅显示 wxid |
| T8 | 撤回消息行被删 | 数据库 row 真删 | v1 失踪即失踪；v2 可能可恢复（WAL / 数据库 free page） |
| T9 | 表情包 / GIF 占带宽 | 大量 emoji 解密无价值 | type=47 默认跳过 |
| T10 | type=49 sub=21 红包 | 含特殊嵌套 ProtoBuf | 单独子 parser；失败容忍 |
| T11 | 大量未读消息 | 用户刷过未打开 → DB 没数据 | sync 提示用户"打开微信浏览过聊天再同步" |
| T12 | Magisk DenyList 用户忘配 | 微信检测 Magisk → 拒启 | 环境检测明示 + 文档 |
| T13 | 多账号 / 切号 | 一台手机历史多个 wxid | per-uin 独立 vault entry |
| T14 | 朋友圈 location 字段格式多变 | 坐标 / 城市名 / POI 混存 | 多 parser fallback + 失败时仅存原 string |
| T15 | 数据库被锁 | 微信前台运行时主 DB lock | 复制 -> 副本上做查询（不竞争锁） |
| T16 | 微信内置删除聊天功能 | 用户在微信里删了一个对话 → DB row 真删 | 同步前已 ingest 的 Event 保留在 vault（vault 是 single-writer） |
| T17 | 数据库 schema 频繁变 | 表新增字段 / type 新增 sub-type | adapter manifest semver + 未知字段进 extra |
| T18 | 用户朋友圈数千张图全量下载爆磁盘 | 缩略图 1k 张 × 50KB = 50MB 还行，原图全拉 GB | OQ-3 分级策略 + 用户磁盘空间阈值 |
| T19 | uin 与 md5 dir 关系 | md5(uin) 但有的版本可能改算法 | 试枚举 MicroMsg/<*>/ 所有子目录而非硬算 |
| T20 | 反 Frida 检测影响 hook 时机 | sqlite3_key 调用瞬间 hook 已被 detect | 在 libwcdb.so 加载后立刻 hook，比微信反检测线程早 |

---

## 14. 法律 & 合规深度分析

### 14.1 中国法律框架

**《个人信息保护法》第十三条第七项**："个人信息处理者**为应对突发公共卫生事件，或者紧急情况下为保护自然人的生命健康和财产安全所必需**或为公共利益实施新闻报道、舆论监督等行为，在合理的范围内处理个人信息……"

**第七十二条**："自然人因**个人或者家庭事务**处理个人信息的，不适用本法。"

本 adapter 适用第 72 条**家庭/个人事务豁免**：
- 用户处理**自己手机里的自己微信账户数据**
- 处理**自己看到的他人朋友圈 / 群聊**（与本人手机微信看到的相同范围）
- 不向任何第三方传输
- 仅本地分析、用户自用

### 14.2 微信 ToS

腾讯《微信软件许可及服务协议》典型限制：
- 禁止反编译 / 修改客户端
- 禁止使用外挂 / 自动化工具
- 禁止商业化使用账户

ChainlessChain 边界：
- **不修改微信客户端**（只读 root 文件系统）
- **不自动化操作微信**（不发消息 / 不点赞 / 不回复）
- **不商业化**（用户自用工具）
- 但 ChainlessChain **读取微信数据库****严格说违反"未授权访问"条款** —— 即便是用户自己的数据

**风险等级**：低-中。腾讯历史上仅对"自动化营销"、"群控外挂"等商业化滥用维权。个人用户**自用解密自己数据**的单独维权案例少见。

**ChainlessChain 立场**：
- adapter 默认关闭，用户主动启用
- 法律 gate 明示风险
- 不主动绕过任何反检测（如 Frida 反检测）—— 若微信明确检测到并限号是用户自担
- 不分发解密的他人数据
- 强烈建议用户**保持微信正常使用习惯**——adapter 是辅助记忆工具，不替代微信

### 14.3 国际法律（v2 + 海外用户考虑）

- **GDPR**：数据主体本人对自己数据的"数据访问权"（Article 15）适用——用户读自己数据是法定权利
- **CCPA**（加州）：同上，"right to access personal information"
- 但 ToS 违反在国际诉讼也有先例（如 hiQ Labs v. LinkedIn）

v2 海外推广前需独立法律咨询。

### 14.4 用户协议附录

```
WeChat Adapter Specific User Agreement

By enabling this adapter, you acknowledge and agree:

1. You are accessing only your own personal WeChat account data
   on your own device.

2. ChainlessChain does not undertake or assume responsibility for:
   - Violations of WeChat ToS that may result from using this adapter
   - Account restrictions or bans imposed by Tencent
   - Legal disputes arising from your secondary use of friends'
     content visible in your timeline

3. All extracted data:
   - Stored locally with AES-256 encryption
   - Never transmitted to ChainlessChain servers
   - Subject to your full control (export / delete anytime)

4. You commit to:
   - Not extracting WeChat data of others on their behalf
   - Not redistributing extracted data to third parties
   - Not using extracted data for commercial purposes

5. Legal framework: this use case falls under PIPL Article 72
   "personal or family affairs" exemption.

[ I have read and agree ]
```

---

## 15. 演进路线

### v1（本设计稿）

- Android root + Frida hook 单账号当前手机
- 消息 / 朋友圈 / 联系人 / 转账 / 收藏 / 媒体
- 增量同步
- 跨源旗舰 use case

### v2

- Magisk Zygisk 模块自启动（用户体验"零配置"）
- PC 客户端 / Mac 客户端数据互补（更老的历史聊天）
- 反 Frida 检测增强 / 社区脚本生态
- 撤回消息恢复尝试
- 视频号 adapter

### v3

- iOS WeChat 数据（iTunes 备份解析）
- 企业微信 adapter
- 跨设备聚合（多手机同账号同步）

---

## 16. 参考

- 父文档 [`Personal_Data_Hub_Architecture.md`](./Personal_Data_Hub_Architecture.md)
- 姐妹 [`Adapter_Email_IMAP.md`](./Adapter_Email_IMAP.md) (Phase 5)
- 姐妹 [`Adapter_Alipay_Bill.md`](./Adapter_Alipay_Bill.md) (Phase 6)
- 姐妹 [`Adapter_AIChat_History.md`](./Adapter_AIChat_History.md) (Phase 10)
- Frida 文档（hook + Memory + Interceptor API）
- better-sqlite3-multiple-ciphers（SQLCipher 兼容版本广，已为 ChainlessChain 既有依赖）
- 微信 SQLCipher 解密相关历史研究：社区已有逆向项目（仅作技术学习参考；本 adapter 全部自研验证）
- 《个人信息保护法》第七十二条家庭事务豁免

---

## 17. Addendum — 模块化与"无设备可建"范围（2026-05-20）

> Phase 6 收口后回看 §12 Phase 拆分。完整 Phase 12 落地需要 **rooted Android 测试设备 + 当前微信版本**，但**约 60% 工作量是 frida-independent 的**，可以**先**写完落库，等设备到位再做后 40% (key extraction + on-device 集成)。本节用于指导这个分割。

### 17.1 模块分层（按 frida 依赖切分）

```
packages/personal-data-hub/lib/adapters/wechat/   ← v1 落地范围
├── content-parser.js          ★ frida-independent: XML / ProtoBuf / type=49 子类
├── db-schema.js               ★ frida-independent: 表/列常量 + version probe 逻辑
├── db-reader.js               ★ frida-independent: better-sqlite3-multiple-ciphers
│                                 wraps SQLCipher pragma 设置 + WAL 处理；
│                                 接收 `keyProvider({getKey()})` 注入
├── normalize.js               ★ frida-independent: RawMessage → Event/Person/Topic
│                                 mapping per §7
├── media-decryptor.js         ★ frida-independent: image .dat XOR / voice .amr XOR
│                                 (算法已知公开)
├── moments-parser.js          ★ frida-independent: SnsMicroMsg.db 解析
├── wechat-adapter.js          ★ frida-independent (with DI): 主 Adapter 类
│                                 ─ 接收 `keyProvider` (生产环境注入 Frida 桥；
│                                   测试 / dev 注入 plaintext key)
│                                 ─ 接收 `dbPath` (生产环境是 adb pull 后的本地
│                                   副本路径；测试用 fixture 路径)
└── adb/                       ☆ frida-dependent: 真机集成
    ├── frida-bridge.js        DOWN: Frida CLI / device server 桥接
    ├── adb-puller.js          DOWN: adb pull DB + media 到 hubDir/wechat-cache/
    └── env-detector.js        DOWN: Magisk / SELinux / 微信版本检测
```

**★ 标记 = 在 dev box (no device) 上 100% 可建 + 单测**：所有 SQLCipher 操作通过 `keyProvider` 注入测试 key；DB fixture 用 **bun create-fixture** 脚本生成（写一个 mini-EnMicroMsg.db 含 50 条消息 + 5 个联系人 + 10 条朋友圈）。

**☆ 标记 = 真机依赖**：留出明确接口边界，待设备就绪 land。

### 17.2 "无设备可建" v0.5 范围（建议先落地）

| Module | LOC 估 | 单测 fixture | 验收 |
|---|---|---|---|
| `content-parser.js` | ~400 | XML 50 条 (type 1/3/34/49 sub 2/5/21 etc.) | 解析率 ≥ 95% |
| `db-schema.js` | ~150 | 微信 8.0.X / 8.1.X / 8.2.X 三版 schema 常量 | version probe 单测 |
| `db-reader.js` | ~200 | 合成 SQLCipher DB (better-sqlite3-multiple-ciphers 自带工具创建) | open / read / WAL 处理 |
| `normalize.js` | ~500 | RawMessage 100 条 → Event/Person/Topic 黄金输出 | UnifiedSchema 校验全过 |
| `media-decryptor.js` | ~200 | 合成 .dat / .amr XOR 文件 | 解密后 magic bytes 匹配 |
| `moments-parser.js` | ~300 | 朋友圈 30 条 fixture | 字段完整 |
| `wechat-adapter.js` | ~400 | DI key + DI db path | sync()/normalize() 跑通 |

**总**：~2150 LOC src + ~1500 LOC test，**约 4 天工作量可落**。Phase 12 §12.1 + 12.4-12.8 全部 frida-independent 部分。

### 17.3 真机依赖 v0.5 → v1 增量（设备到位后）

| Module | 工期 |
|---|---|
| Frida hook 脚本（§5.2 骨架基础上加强）| 1.5d |
| `adb-puller.js` | 0.5d |
| `env-detector.js` + UI 检测向导 | 0.5d |
| 端到端真机 E2E（5 年 100k 消息 ingest）| 1d |
| Phase 12 §12.9（性能 + 跨源 link 验）| 0.5d |

**总**：4 天，与 §12 原计划合计 8 天，比原 10 天**还省 2 天**（因为 frida-independent 部分单测先驱动，避免设备上反复调试 schema parser）。

### 17.4 推荐实施顺序

```
1. WAIT: Phase 7 (Shopping) + Phase 8 (EntityResolver) + Phase 9 (Travel)
         按 Architecture §12 排
   ↓
2. NOW BUILDABLE (no device): Phase 12 §12.1 + 12.4-12.8 frida-independent 部分
   = 提前 4 天写好 content-parser / db-schema / db-reader / normalize / media / moments / adapter
   ↓
3. DEVICE READY: Phase 12 §12.2 + 12.3 + 12.9 (Frida + adb + E2E)
   ↓
4. ECN v0.6 release
```

### 17.5 fixture 生成策略

**为什么 fixture 重要**：无设备时 dev box 没真微信 DB，没法验证 parser。需要"合成 EnMicroMsg.db"——内容是假的但 schema 真实。

**生成脚本**（`packages/personal-data-hub/scripts/gen-wechat-fixture.js`）：
```javascript
// 1. 用 better-sqlite3-multiple-ciphers 创建空 SQLCipher DB（已知 key）
// 2. CREATE TABLE message (...) 用真实 schema（从 Phase 12 §4.2 抄）
// 3. INSERT 50 条 mock messages:
//    - 20 条个人聊天 type=1 (各种 talker)
//    - 10 条群聊 type=1 (含 "<wxid_xxx>:\n" prefix)
//    - 5 条 type=3 (图片) content=mock XML
//    - 5 条 type=34 (语音)
//    - 5 条 type=49 sub=5 (链接)
//    - 5 条 type=49 sub=21 (红包)
// 4. CREATE TABLE rcontact + INSERT 20 contacts
// 5. CREATE TABLE chatroom + INSERT 5 groups
// 6. CREATE TABLE WechatTransfer + INSERT 5 transfers
// 7. close + 输出文件路径
```

fixture 落 `__tests__/fixtures/wechat-en-microsg-v8-2-mock.db`（**进 git** — 假数据，不算 PII 泄露）。

单测：
```javascript
const dbPath = path.join(__dirname, "../fixtures/wechat-en-microsg-v8-2-mock.db");
const adapter = new WechatAdapter({
  keyProvider: { getKey: async () => "test-key-32-bytes" },
  dbPathOverride: dbPath,
});
for await (const raw of adapter.sync()) raws.push(raw);
expect(raws).toHaveLength(50);
```

### 17.6 跨源 link anchor

**复用 Phase 8 EntityResolver**：
- WeChat `rcontact.alias / nickname / conRemark` → `Person.names[]`
- WeChat 转账 `WechatTransfer.feedesc` 含 "妈" / 备注 → 给 EntityResolver R4 段 embedding stage
- WeChat 群成员 wxid 间接对应 → 已经被微信派生但不暴露 phone

**WeChat 与 Alipay 同人候选 anchor**：
- 名字（nickname / conRemark） → embedding cosine
- 朋友圈 location 与 Alipay 商家地理位置 → Place anchor (Phase 9 Travel adapter 后)

### 17.7 v0.5 验收（落地 frida-independent 部分时）

| # | 项 | 验收 |
|---|---|---|
| V1 | 全部 ★ 模块单测过 | hub suite +200 tests |
| V2 | mock fixture E2E：50 raw → normalize → vault → query 回来 | smoke 跑通 |
| V3 | content-parser 解析率 ≥ 95% on type=1/3/34/49 五子类 | golden test |
| V4 | EntityResolver 能 process WeChat Person rows | Phase 8 + WeChat 联合 smoke |
| V5 | 真机集成边界清晰：keyProvider / dbPath 是 DI 唯一桥 | 文档 + 代码 review |

### 17.8 已知差距 (gaps in original design)

| Gap | 当前文档状态 | 建议补充位置 |
|---|---|---|
| `keyProvider` 抽象（让 adapter 在 dev / prod 走同一接口） | §6.1 类结构只示 hook 调用 | §6.1 加 DI 注释 ✓ (本 addendum) |
| fixture 生成脚本规格 | §11 测试计划仅说 "100k 消息合成数据" | §17.5 ✓ |
| frida-independent vs frida-dependent 模块边界 | 全文混着写 | §17.1 ✓ |
| `media-decryptor.js` 算法明示 | §6.3-6.4 只示个别 hex bytes | 留 v0.5 实施时验证 |
| 多 uin (多账号) 在 sync 阶段如何区分 vault entries | §2.2 标 v2 | §17.6 留 anchor |
| ProtoBuf 解析依赖（type=49 嵌套 PB）| §4.5 提到双层解析无 lib 选择 | v0.5 实施时选 `protobufjs` 或 `pbf` |
| Adapter 与 Phase 8 EntityResolver 跨源 contract | 散见 §1.2 § 8.2 | §17.6 ✓ |

### 17.9 修订建议

完整修订留实施前 review。本 addendum 不改 §1-16 原文，只**追加** §17 作为"无设备可建"的实施前导索引。当 v0.5 frida-independent 部分落地后，回过头来 update §1-16 的 "无 root 模式" 部分。

