# QQNT Frida 采集方案（module 101 · PDH 加密 IM 采集）

> 把"手动 frida 解密 QQNT 数据库"自动化进 App，让个人助手一句话即可采集 QQ 聊天数据。
> 状态：**设计**（待实现）。归属 module 101 个人数据 IDE 桥接的 L4 root 采集层。

## 0. 背景与定位（先厘清，避免重复造轮子）

QQ 在设备上有 **两套** 数据库，是两个完全不同的采集问题：

| 数据库 | 格式 | 路径 | 现状 |
|---|---|---|---|
| **旧版** `<uin>.db`（如 `896075341.db`） | 明文 SQLite，`msgData` BLOB 用 **IMEI XOR** | `/data/data/com.tencent.mobileqq/databases/<uin>.db` | ✅ **已有采集器** `QQLocalCollector`/`QQDbExtractor`/`QQXorDecryptor`，但**未接入 PDH bridge** |
| **新版 QQNT** `nt_msg.db` | **SQLCipher 加密**，消息体是 **protobuf** | `…/databases/nt_db/nt_qq_<md5>/nt_msg.db` | ❌ 无采集器；用户当前主力数据在这里；手动 frida 已能解密 |

**"之前采集成功过"** = 你用 `scripts/android/pdh-frida-decrypt.sh`（Method C）手动把 `nt_msg.db` 在线导出成 `QQ_android_nt_msg_decrypted.db`。本方案就是**把这一步搬进 App**。

**关键结论：QQNT 走 frida（SQLCipher），旧版不需要 frida（明文 + IMEI XOR）。** 本方案聚焦 QQNT；旧版作为零成本的兜底一并接入 bridge。

## 1. 目标与非目标

**目标**
- 个人助手一句话「采集我的 QQ 聊天」→ 解密 `nt_msg.db` → 解析 c2c/群消息 → 入 vault → 可查询/分析。
- **可复现**（用户首要诉求）：frida 二进制 + 导出脚本随 APK 下发；流程确定性、可重跑；密钥永不落盘。
- 复用现成基建（WeChat frida 注入器 / Method C 在线导出 / collector→vault 管线），不重写。

**非目标**
- 不做 QQ 发消息/写操作（只读取证）。
- 不绕过 QQ 反调试做对抗升级（首版遇 anti-frida 直接如实降级报告，不硬刚）。
- 不碰云端 QQ 空间（服务端数据，非本地可取）。

## 2. 端到端数据流

```
个人助手 chat
  └─(mcp__pdh__collect_qqnt 或 collect_app_data_root{app:"qq"})
      └─ QQNTFridaCollector.snapshot()              [新增, Kotlin]
          1. 前置闸：root? + pidof com.tencent.mobileqq 在前台?
          2. FridaSqlcipherExporter.export()         [新增, 复用 WeChatFridaInjector 骨架]
               - su cp frida-inject-arm64 + qqnt-sqlcipher-export.js → /data/local/tmp
               - su frida-inject -p <pid> -s qqnt-sqlcipher-export.js --runtime=v8
               - hook: 借 QQ 自身已 keyed 连接 → ATTACH '' KEY '' + sqlcipher_export
               - 产出明文副本 /data/local/tmp/dec/nt_msg.plain.db
          3. su cp 明文副本 → app filesDir，chown app uid，chmod 644，删 /data/local/tmp/dec
          4. 解析 nt_msg.plain.db（QQNT schema + protobuf 消息体）→ staging JSON
          5. LocalCcRunner.syncAdapter("messaging-qq", stagingJson)  → 入 vault
          6. finally：删明文副本 + 删 staging（密钥/明文不留存）
```

复用矩阵：

| 步骤 | 复用现成 | 文件 |
|---|---|---|
| frida 注入骨架 | `WeChatFridaInjector`（su stage→frida-inject spawn→stdout 解析→cleanup + 测试 seam `suExec`/`spawnProcess`/`pidofImpl`） | `pdh/social/wechat/WeChatFridaInjector.kt` |
| 在线导出 hook | Method C agent（`ATTACH '' KEY '' + sqlcipher_export`，库无关，已对 WCDB/WCDB2 验证） | `scripts/android/pdh-frida-sqlcipher-export.js` |
| frida 二进制 | APK 内 `assets/frida/frida-inject-arm64`（+arm） | 已随 APK |
| collector→vault | `LocalCcRunner.syncAdapter(adapter, inputPath)` | `pdh/LocalCcRunner.kt` |
| 适配器 | `messaging-qq`（扩展支持 QQNT schema 输入） | `packages/personal-data-hub/lib/adapters/messaging-qq/` |
| root cohort copy / 凭据 | `QQCredentialsStore`（存 uin；QQNT 不需 IMEI） | `pdh/messaging/qq/QQCredentialsStore.kt` |

## 3. Frida 在线解密（Method C 为主，库无关）

**为什么用 Method C（sqlcipher_export）而不是抓 key 离线解密：**
- QQNT 用自研/WCDB 派生 cipher；离线 better-sqlite3 用抓到的 key 不一定能开（cipher 参数不标准）。memory 实测「frida 截 key 后离线 72 组合全败」。
- Method C 借 **App 自己已经 keyed 的连接**，在进程内 `ATTACH '' KEY ''`（空 key=明文目标）+ `SELECT sqlcipher_export('plain')`，把整库导成明文 —— 绕开 cipher 参数问题。**这正是产出你 Desktop 上 `*_decrypted.db` 的方法。**

**agent 脚本**（`assets/frida/qqnt-sqlcipher-export.js`，从 `pdh-frida-sqlcipher-export.js` 改）：
- hook `sqlite3_key`/`sqlite3_key_v2`/`sqlite3_prepare_v2/v3`。
- `DB_MATCH` 正则改为匹配 `nt_msg\.db`（兼带 `group_info.db`/`profile_info.db` 一并导出，你 Desktop 已有这三件套）。
- 命中 keyed 连接后对每个目标库执行一次 export（`DONE` map 去重，`INEXEC` 防递归）。
- 输出 `/data/local/tmp/dec/<name>.plain.db`；脚本自身退出前不删（Kotlin 侧搬运后删）。
- **触发条件**：QQ 必须前台进过「消息」列表/某会话，IM 插件 .so 已加载且查询过库（否则 keyed 连接不出现）→ collector 前置提示用户「请打开 QQ 消息页后重试」。

**反调试风险**：QQ 近年带 `libmsaoaidsec`（与抖音同源风控）。首版策略：
1. 先直接 attach（多数机型/版本可成）。
2. 失败（`InjectFailed`/秒退）→ 如实返回 `AntiFridaSuspected`，提示「QQ 反调试拦截，建议旧版 `<uin>.db` 路径或手动 Method C」。
3. 不在首版做 spawn-gating/early-instrument 对抗（留 Phase 2 评估）。

## 4. QQNT schema 解析（nt_msg.db）

以你 Desktop 的 `QQ_android_nt_msg_decrypted.db` / `group_info` / `profile_info` 为 **fixtures**（+ `QQ_关系分析.md` 你已做的关系分析）。要点：

- 主表：`c2c_msg_table`（单聊）、`group_msg_table`（群聊）；典型列 `40050`(time)/`40011`(type)/`40020`(peer uid)/`40030`(sender)/消息体 BLOB。
- **消息体是 protobuf**（QQNT 富消息）：纯文本在 elem 链里。首版**启发式抽取**可读文本（UTF-8 段 + 去控制字节），Phase 2 上最小 protobuf 解析（按 elem type 取 text/pic/at）。
- 联系人/群名：`profile_info.db` / `group_info.db`（昵称、群名）→ 用于把数字 uid/peer 映射成可读名（对齐 wechat-pc 群名解析的经验）。
- 时间：QQNT 用秒级 epoch；统一转毫秒。

落 staging JSON 用 **messaging-qq 既有 schema v1**（contacts/groups/messages），让 `messaging-qq` 适配器零改或最小改即可 ingest；新增 `source.variant:"qqnt"` 区分旧版。

## 5. 落地分期

**Phase 0 — 接通旧版（半天，零 frida 风险，先有数据）**
- 把现成 `QQLocalCollector` 接入 PDH bridge：新增 `CollectQqTool`（或并入 `collect_app_data_root{app:"qq"}` 的 QQ 分支），走 `<uin>.db` + IMEI XOR。
- 价值：立刻让 chat 能采到旧版 QQ；验证 collector→vault 管线对 QQ 通。

**Phase 1 — QQNT frida 导出 MVP（核心）**
- `FridaSqlcipherExporter.kt`（抽 `WeChatFridaInjector` 通用骨架；agent=`qqnt-sqlcipher-export.js`）。
- `QQNTFridaCollector.kt`：前置闸 → export → cohort copy → 解析（启发式文本）→ syncAdapter。
- bridge 工具 `collect_qqnt`（L4, requiresRoot）；wire 进 `PdhBridgeModule`。
- 单测：用 Desktop fixtures 跑解析器（纯 JVM，零设备）；注入器用 `WeChatFridaInjector` 同款 seam 做无设备单测。

**Phase 2 — 富化 + 健壮**
- protobuf 最小解析（text/at/pic 占位）；uid→名映射（profile/group_info）。
- anti-frida 探测与降级文案；WAL checkpoint 一致性（cp 三件套 `.db/-wal/-shm`）。
- 增量（按 `lastSyncAt` 水位只取新消息）。

**Phase 3 — 体验 + 复现**
- chat 信任卡：预览「将采集 QQ 聊天 N 条入金库」→ 用户确认（§3.5.9 预览卡）。
- 引导卡：未前台打开 QQ 消息页时提示一步（§3.6）。
- 文档化复现步骤 + fixtures 入 `docs/internal/reference`（schema 字典）。

## 6. 安全 / 隐私（北极星：数据主权回个人）

- 明文副本与 staging **仅落 app 私有目录**，ingest 完 `finally` 即删；**绝不入 git、绝不出设备**（对齐 memory：明文只存仓库外 `~/pdh-data`）。
- frida agent JS 含个人数据访问逻辑，用完即删 `/data/local/tmp` 下的脚本与 `dec/`。
- 密钥永不写盘（Method C 不导出 key，只导明文表；即便 Phase 2 抓 key 也只在内存用）。
- root + 前台 QQ 是硬前置；非 root / QQ 未登录 → 如实 `NoRoot`/`AppNotRunning`，不假装成功。
- 入 vault 的 QQ 消息按 §3.5.11 标「来源=QQ·设备本地·非 AI 判断」，可见可纠可删（`cc hub destroy`）。

## 7. 风险与未知（诚实清单）

| 风险 | 影响 | 缓解 |
|---|---|---|
| QQ `libmsaoaidsec` 反调试 | attach 秒退 | 首版如实降级；Phase 2 评估 spawn-gating |
| QQNT cipher 跨版本漂移 | export hook 命中点变 | Method C 库无关 + 多符号 hook；版本探测日志 |
| protobuf 消息体复杂 | 文本抽取不全 | Phase 1 启发式先用；Phase 2 最小 proto |
| keyed 连接未出现 | 导出空 | 前置引导「打开 QQ 消息页」；轮询/超时如实报 |
| 真机机型差异 | 仅本机验证 | 以 chopin(已验) 为基线；端点 best-effort 标注 |

## 8. 验收

- 设备：chopin（rooted）QQ 前台登录态。
- 跑 `collect_qqnt` → 解密 `nt_msg.db` → vault 新增 QQ 消息事件 > 0 → `analysis.overview` 见 `messaging-qq`(qqnt) → chat 可查「我和某人的 QQ 聊天」。
- 解析器单测对 Desktop fixtures 全绿（无设备 CI 可跑）。
- 明文/staging/agent 脚本跑后全部清理（`ls` 验空）。

---
**一句话**：QQNT = SQLCipher，复用 WeChat frida 注入器 + Method C 在线 `sqlcipher_export`（产出你 Desktop 那批 `*_decrypted.db` 的同款方法）把 `nt_msg.db` 导明文，解析 protobuf 消息入 vault；旧版 `<uin>.db` 顺手接入 bridge 作零风险兜底。
