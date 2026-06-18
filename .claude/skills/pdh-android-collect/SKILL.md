---
name: pdh-android-collect
description: Collect a rooted Android device's real personal data into the Personal Data Hub (PDH) vault to feed the user's personal-AI knowledge base (RAG/KG) for assisting personal affairs & decisions. Triggers when the user wants real on-device collection / 真机采集. DO SYSTEM DATA FIRST (method D, highest-yield & reliable: contacts/SMS/call_log/media/browser via plain DBs + content query — run scripts/android/pdh-device-collect.mjs); the key-free /proc/<pid>/mem memory scan (method B) is only for encrypted app IM (WeChat/Douyin/QQ SQLCipher/WCDB2). Only for the user's OWN device / OWN account / OWN apps.
---

# PDH 真机采集 / 解密（已 root 安卓）

**授权边界（先确认）**：仅对**用户本人拥有**的已 root 设备、**本人**账号、**本人**
App 进行，用于与用户自己的个人数据中台（PDH）互通。不要对他人账号/设备进行。

**目的**：采集进 PDH vault 的数据 = **个人 AI 知识库**的语料——经 RAG/KG 让用户的个人 AI
能读懂自己的真实生活数据（联系人/通话/短信/消费/社交/媒体），用于**协助处理个人事务 +
个人决策**。采完用 `cc hub ask "<问题>"`（RAG over vault）/ `analysis.*` 技能验证 AI 能用。
字段含义见 `docs/internal/pdh-app-db-schemas.md`（AI 解读 + UI 展示字典）。

## 决策：先采「系统数据 + 明文库」（方法 D，最高产），加密 App IM 才上方法 B

| 情况 | 方法 | 产出 |
|---|---|---|
| **任何 root 手机（默认第一步）** | **方法 D：系统数据 + 明文库直采**（见下，脚本 `scripts/android/pdh-device-collect.mjs`）。通话/短信/联系人/媒体/浏览器/微博等——明文或 `content query`，**无需解密**，量大、可靠、可复现。 | 实测单机 2 万+ events / 1 千+ 联系人 / 2 千+ 媒体 |
| 加密 App IM（微信/抖音/QQ 聊天记录）且已登录+热进程 | **方法 B：`/proc/<pid>/mem` 免密钥内存扫描**。引擎无关、绕反调试、不用密码。⚠️ WCDB2(抖音)解密页未必以标准 SQLite 页驻留→可能捞不到 IM（2026-06-17 实测）。 | 视 App/版本而定 |
| **加密 App IM 且 App 能跑起来+无强反 frida（头条✅/微信✅；抖音有 libmsaoaidsec 可能杀 frida）** | **方法 C：frida `sqlcipher_export` 在线解密**（见下，脚本 `pdh-frida-decrypt.sh`）。借 App **自己已用正确 key 打开的连接** `ATTACH '' KEY ''`+`sqlcipher_export` 导出明文副本——**不碰 cipher 参数**。⚠️**离线解密别走**：拿 key 后用 better-sqlite3 复现 WCDB 自研 cipher，2026-06-17 实测 72 组合全失败。 | 明文库副本（**链路可达·端到端待验**，见下方诚实状态）|
| 标准 SQLCipher(微信 `libWCDB.so`) 且**已登录** | 方法 A：frida hook `sqlite3_key`（`android-app/.../assets/frida/`）拿 key——**但解密优先走方法 C**（在线导出，省去 cipher 复现）。**登出态无 key，免谈**。 | key（解密走方法 C）|
| 无 root（HyperOS 非 root 等）| 都不行；只能 snapshot / cookie-api 端点（`pdh-endpoint-capture-runbook.md`）| 受限 |

## 方法 D 流程（系统数据 + 明文库 — **先做这个**，可复现）

> 一条命令把高价值、最可靠的真机数据采进 vault：
> ```sh
> node scripts/android/pdh-device-collect.mjs --serial <serial>     # contacts+SMS+call_log+apps+media
> #   --dry-run 只读计数 / --no-media 等按需跳过
> cc hub stats                                  # 看 events/persons/items 增长
> cc hub search --adapter system-data-android   # 抽查
> ```
> 原理（全部明文，无解密）：联系人走 **root 读 `contacts2.db`**（`content query` 对 contacts 被拒）；
> 短信/通话走 **`adb content query content://sms` / `content://call_log/calls`**（shell 即有权限）；
> 媒体走 **`find /sdcard/{DCIM/Camera,Pictures,Movies,Download,Documents}`**（仅元数据）。
> 落库 = `system-data-android` 适配器 **bridge 模式**（脚本里现搭 bridge + `registry.register` 注入，
> 因为 `cc` 无对应 CLI 命令——这是 bridge 仅给 in-APK cc 用的历史包袱）。**幂等**（按 originalId dedup，可反复跑）。

**其它明文库直采（同思路，按 App 加）**：
- **微博** `com.sina.weibo`（明文）：root 读 `ArticleDb.db`(本人长微博)/`sina_weibo`(配图)/`message_<uid>.db`(私信)
  → 拼 `social-weibo` snapshot(`{schemaVersion:1,account:{uid},events:[{kind:"post",...}]}`)→ `cc hub sync-adapter social-weibo --input`。
- **浏览器** AOSP `com.android.browser`/`browser2.db`(明文,`history` 表)：转 Chrome 形(urls+visits, `visit_time=(ms+11644473600000)*1000`)→ `cc hub sync-adapter browser-history-chrome --profilePath`。
- 先 `su -c 'find /data/data/<pkg> -type f | head -c 15 == "SQLite format 3"'` 判明文；明文就能直采，省去方法 B。
- ⚠️ **未登录/未用过的 App 没数据**（如本测试机的高德/QQ邮箱：data 目录仅 cache/code_cache）——别白费劲。

## 方法 B 流程（key-free memory scan）

## 方法 B 流程（key-free memory scan）

> 原理：App 打开加密库后，WCDB/SQLCipher 把**解密页**放进进程页缓存（明文）。root 读
> `/proc/<pid>/mem` 不用 ptrace → 绕过反调试。扫 "SQLite format 3" 页头 → dump 成库。
> 已在 Douyin 实测拉出数十个解密库。脚本：`scripts/android/pdh-mem-sqlite-scan.sh`。

1. **让 App 把库打开**：让用户把目标 App 用起来——进信息流刷几条、进「消息」——
   这样库才被打开、明文页才进内存。**冷启动/后台进程内存里没有明文页**（实测=0 命中）。
   ⚠️ **别 `am force-stop` 再启动**——冷启动会触发反调试且没加载库；用现成的热进程。
2. **推脚本 + 跑**（`<serial>` 多设备时必带 `-s`）：
   ```sh
   adb -s <serial> push scripts/android/pdh-mem-sqlite-scan.sh /data/local/tmp/cc-scan.sh
   PID=$(adb -s <serial> shell su -c 'pidof <pkg>' | tr -d '\r' | awk '{print $1}')
   adb -s <serial> shell su -c "sh /data/local/tmp/cc-scan.sh $PID"   # dump → /data/local/tmp/ccmem/*.db
   ```
3. **拉出来读**（脚本已 `chmod 666`；`/data/local/tmp` shell 可读，二进制安全）：
   ```sh
   adb -s <serial> pull /data/local/tmp/ccmem ./dumps
   for f in dumps/*.db; do echo "== $f"; sqlite3 "$f" ".tables"; done   # 找 msg/conversation/contact
   ```
4. **散页重组（dump 打不开时）**：连续 dump 对散列页缓存库是 malformed（头有效、
   b-tree 断），platform-tools sqlite3 无 `.recover` → 用打捞器直接捞叶子页记录：
   ```sh
   for f in dumps/*.db; do node scripts/android/pdh-sqlite-leaf-salvage.js "$f"; done > rows.jsonl
   ```
   输出 `{rowid, cols:[...]}`（UTF-8 正确），再按 schema 映射。
5. **接入 PDH**：识别目标库（IM 库含 `msg`/`conversation_list`/`participant`），走对应
   adapter（如 `social-douyin` `_syncViaImDb`：msg→EVENT / participant→PERSON /
   conversation_list→TOPIC）normalize/ingest。schema 见 `docs/internal/pdh-app-db-schemas.md`。
5. **善后**：`adb shell su -c 'rm -rf /data/local/tmp/ccmem /data/local/tmp/cc-scan.sh'`；
   删本地 dump（含个人数据）。

## 方法 C 流程（frida `sqlcipher_export` 在线解密 — 加密 IM，**链路可达·端到端待验**）

> **关键洞见（2026-06-17）**：加密 IM 库（WCDB/SQLCipher，如头条/抖音 `encrypted_<uid>_im.db`）
> **不要走「拿 key → 离线解密」**——frida hook `sqlite3_key` 能稳拿 raw key（salt 与文件头一致），
> 但 WCDB 用**自研 cipher 配置**（非 vanilla SQLCipher），better-sqlite3-multiple-ciphers 标准参数
> **72 组合全失败**。思路 = **借 App 进程里已用正确 key 打开的那条连接**，直接在它上面跑
> `ATTACH '<out>' AS ccpt KEY ''`（空 key=明文）+ `SELECT sqlcipher_export('ccpt')` → 明文副本，
> **绕过 cipher 参数复现**。脚本：`scripts/android/pdh-frida-decrypt.sh` + `pdh-frida-sqlcipher-export.js`。
>
> ⚠️ **诚实状态（2026-06-18）**：目前是「`sqlcipher_export` **可达**」，**还没真机产出过明文库**。
> 头条 `libwcdb2.so` 有符号、hook 命中 IM 库、export 被调用到，但 **rc=1 "disk I/O error"**（疑 WCDB
> 自定义 VFS 管 `databases/` 目录）→ 已把输出改写 `cache/`（默认 VFS）+ 唯一 alias + onLeave，但**未验证**
> （头条私信空·抖音反 frida）。复现坑与 checklist 见 `pdh-db-decryption-runbook.md` §3.6.1：
> ① frida 以 App uid 跑，输出/日志必写 App 可写目录（`cache/`）非 `/data/local/tmp`；② 必须等 libwcdb2
> 加载后（`_im.db` fds 已开）再 attach；③ 要点开会话+滑动才有查询触发；④ `DB_MATCH` 用 `/encrypted_.*\.db$/`
> 才能覆盖 `encrypted_im_biz_*`；⑤ export 必须 onLeave 调（onEnter 重入→I/O error）。

```sh
# 1) 设备已 root；目标 App 已登录并【前台进到「私信/消息」界面】——库必须被查询，hook 才命中。
# 2) 一键：
bash scripts/android/pdh-frida-decrypt.sh <serial> com.ss.android.article.news ~/pdh-data 60
#   → 明文副本 encrypted_<uid>_im.db.plain.db 拉到 ~/pdh-data（仓库外，勿入 git），脚本自动清设备侧。
# 3) 读 / 接 PDH：
sqlite3 ~/pdh-data/encrypted_<uid>_im.db.plain.db '.tables'   # msg / conversation_list / participant ...
#   再走对应 adapter（social-toutiao / social-douyin 的 _syncViaImDb）normalize→ingest。schema 见字段字典。
```

- **触发要点**：hook 装在 `sqlite3_key`(开库时) + `sqlite3_prepare*`(已开库的下次查询时)。若 App 已开过库但
  界面没在查它 → 进到「私信」刷一下即命中（实测：停在信息流时 IM 插件 `.so` 未加载、`sqlite3_key` 不出现）。
- **反 frida**：头条无 `libmsaoaidsec`，frida-inject 正常；**抖音带它——实测 frida 能 attach 上但 send()
  输出被压制 + 重负载把 USB/adb 打 offline（`adb reconnect` 恢复）→ Method C 在抖音不实用**。抖音才有真实
  私信；要它需先绕 libmsaoaidsec（spawn-time hook/反 ptrace），独立工程。退路：换头条同账号 IM（ByteDance
  同 `com.ss.android.im` 框架 schema 一致），或先解抖音的非 IM 明文库。
- **微信**：同法把 `DB_MATCH` 改成 `/EnMicroMsg\.db$/` 等（`pdh-frida-sqlcipher-export.js` 顶部常量）。
- **privacy**：明文副本含真实聊天 → 只在本地 `~/pdh-data`（仓库外）留存；接完 PDH 或查完即删。

## 血泪坑（照做省几小时）

- **64 位地址溢出（最坑）**：toybox sh `$(())` 是 32 位，`$((0x66xxxxxxxx/4096))` 算成
  负数 → `dd` seek 错 → 扫不到。脚本已用 `printf "%d"` + `bc` + `dd iflag=skip_bytes` 修。
- **反调试**：frida `-p` 对热进程可 attach、对 force-restart 的进程 `Unable to access pid`
  （EPERM）。方法 B 用 `/proc/mem` 不 ptrace，不受影响。
- **App 自清 cache / SELinux 跨 App 目录**：所以 dump 写 `/data/local/tmp`（root 可写），
  不要写 App 自己的 cache。
- **`adb exec-out` 在 Windows 会 LF→CRLF 损坏二进制**：用 `adb pull`，别 `exec-out > file`。
- **`su -c "多行"` 会被 MagiskSU 解析炸**：写成脚本文件 push 后 `su -c 'sh x.sh'`。
- **MIUI 注入输入**：`adb shell input` 被拒 → `su -c 'input tap/swipe'`（root，首次弹超级用户授权）。

## 接入个人 AI 知识库（采完必做——这才是目的）

采集只是手段，目的是**让用户的个人 AI 用这些真实数据协助个人事务/决策**。采完验证 AI 能用：

```sh
cc hub stats                                   # 确认 events/persons/items 已增长
cc hub run-skill relations                     # 联系人/通话→关系强度（决策：该联系谁/谁重要）
cc hub run-skill overview                       # 跨 app 汇聚一张决策快照（决策依据）
cc hub run-skill spending                       # 消费分析（账单短信/订单→花在哪）
cc hub run-skill timeline | footprint | interests
cc hub ask "最近一个月谁给我打电话最多？"        # NL 问答（RAG over vault，走配置的 LLM）
cc hub ask "我都收到过哪些银行/平台的验证码短信？我注册了哪些金融服务？"
```

- **数据流**：adapter → vault(events/persons/items) → 可选 `kgSink`(知识图谱三元组)/`ragSink`(RAG 文档)
  → `cc hub ask`/`retrieve-context`(RAG 召回 + LLM) + `run-skill`(确定性分析) → 个人 AI 决策。
- **字段含义字典**（AI 正确解读 + UI 展示的依据）：`docs/internal/pdh-app-db-schemas.md`——每张表的列/含义/
  单位/→PDH 实体/解读要点/决策价值。新采一个 App 就照模板补一节，AI 才不会误读。
- **决策映射举例**：通话频次+时长→关系亲密度；验证码短信→账号资产盘点；账单短信/订单→财务画像；
  媒体拍摄时间分布→活动/出行节律；联系人单位/职务→社交圈层。

详尽版：`docs/internal/pdh-db-decryption-runbook.md`、`docs/internal/pdh-endpoint-capture-runbook.md`。
复现脚本：`scripts/android/pdh-device-collect.mjs`（系统数据一键采，方法 D）/ `pdh-mem-sqlite-scan.sh`+`pdh-sqlite-leaf-salvage.js`（免密钥内存扫描，方法 B）/ `pdh-frida-decrypt.sh`+`pdh-frida-sqlcipher-export.js`（frida 在线解密加密 IM，方法 C）。
数据库结构字典：`docs/internal/pdh-app-db-schemas.md` + 导出 SQL `docs/internal/reference/{toutiao,douyin}_im_schema.sql`。
记忆：`android_app_db_decryption_findings`（含 2026-06-17 系统数据/媒体/浏览器/微博实测 + 复现配方）。
