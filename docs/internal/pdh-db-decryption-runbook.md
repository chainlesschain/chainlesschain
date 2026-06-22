# PDH 端侧加密 DB 解密 / 采集 Runbook（真机，已验证）

> 目的：把已 root 真机上、已登录 App 的**加密本地数据库**（WeChat / Douyin / QQ
> 等用 SQLCipher / WCDB2 透明加密的库）解密出来，供你自己的个人数据中台（PDH）
> 做互通分析。
>
> **授权边界**：仅在**你本人拥有**的已 root 设备、**你本人**的账号、**你本人**的
> App 上进行。不要对他人账号/设备进行。配套：[`pdh-endpoint-capture-runbook.md`](./pdh-endpoint-capture-runbook.md)（cookie 端点抓包）、内存 `android_app_db_decryption_findings`。

## 0. 两条路线（按 App 加密形态选）

> **🟢 已 root 手机 = 一律优先方法 B（`/proc/<pid>/mem` 免密钥内存扫描）。**
> 理由：① 免密钥（不用逆 SQLCipher key 也不用逆 metasec）② 引擎无关（标准
> SQLCipher / WCDB2 专有 cipher 都吃，因为 App 自己已经把页解密进内存）③ 用
> `/proc/mem` 读、不 ptrace → 绕过 App 反调试（frida attach 会被拦，`/proc/mem`
> 读不会）。方法 A（frida hook key）只在你**特别想拿到 key 做离线解密**时才用。
> 脚本：`scripts/android/pdh-mem-sqlite-scan.sh`（见 §2）。**已在 Douyin 实测拉出
> 数十个解密库（含 2 万+ 页的大库）。**

| App | DB 引擎 | 密钥位置 | 推荐方法 |
|---|---|---|---|
| WeChat `com.tencent.mm` | 标准 SQLCipher（`libWCDB.so` 导出 `sqlite3_key`）| 进程内运行时（登录后才存在）| **方法 A：frida hook `sqlite3_key`** → 拿 key → `better-sqlite3-multiple-ciphers` 离线解密 `EnMicroMsg.db` |
| Douyin `com.ss.android.ugc.aweme` | **WCDB2 + 专有 cipher `libEncryptor.so`**（无导出 `sqlite3_key`、无 sqlcipher 串）| metasec 加密的 `.material` 文件 | **方法 B：免密钥内存扫描**（key 拿不到，但页缓存里是明文）|
| QQ `com.tencent.mobileqq` | 加密（hex 命名库）| —— | 方法 B（同 Douyin，引擎无关）|

**关键事实**：两条路线都要求 **App 已登录且 DB 已被打开**（key 只在打开时进内存；
明文页只在 DB 打开后进页缓存）。登出的账号 = 无 key、无明文页。

## 1. 方法 A — frida 抓 SQLCipher key（WeChat，已验证可 attach）

项目自带：`android-app/app/src/main/assets/frida/{frida-inject-arm64, wechat-key-hook.js}`
+ `WeChatFridaInjector.kt`。host 侧等价命令：

```sh
adb shell su -c '/data/local/tmp/cc-fi -p <wechat-pid> -s /data/local/tmp/wechat-key-hook.js --runtime=v8'
# 解析 stdout 里 {"kind":"key","hex":"<64hex>"}，再用该 key 开 EnMicroMsg.db
```

**实测**：hook 能 attach 到 `libWCDB.so` 的 `sqlite3_key`/`sqlite3_key_v2`。但：
- 账号登出 → 无 key（须先登录，凭据边界，不可代填密码）。
- WeChat 8.0.74 **anti-debug**：进程启动后置不可 ptrace，首次 attach 后 EPERM；
  `frida-inject -f`（spawn）在该 standalone 二进制上坏（找不到 system_server）。
  → 走 in-app `WeChatFridaInjector`（in-context 时机对）。

## 2. 方法 B — 免密钥 `/proc/pid/mem` 内存扫描（已验证，绕过 anti-debug）

**原理**：WCDB/SQLCipher 打开 DB 后，会把**解密后的页**放进进程页缓存（WCDB 常用
mmap → 整库明文连续）。所以**明文 SQLite 页就在 App 内存里**，根本不需要 key。
**root 直接读 `/proc/<pid>/mem` 不用 ptrace** → 不触发 anti-debug（frida 的 ptrace
attach 会被反调试拦，`/proc/mem` 读不会）。

**已验证**：在 Douyin 上 frida `Memory.scan` 命中 53 个 `SQLite format 3` 页头，
dump 出真实明文库（`android_metadata`/`downloader`/`segments` 等），**全程无 key**。
后续改用纯 root `/proc/mem` 路径（`cat /proc/<pid>/maps` + `dd if=/proc/<pid>/mem`
实测可读），彻底绕过 ptrace 反调试。

脚本 `scripts/android/pdh-mem-sqlite-scan.sh`（本仓）：解析 `rw-p` 段 → `dd` 读 →
grep `SQLite format 3` → 按页头 page_size/page_count dump 成 `.db`：

```sh
adb push scripts/android/pdh-mem-sqlite-scan.sh /data/local/tmp/
adb shell su -c 'sh /data/local/tmp/pdh-mem-sqlite-scan.sh <pid>'   # dump 到 /data/local/tmp/ccmem/*.db
adb shell su -c 'chmod 666 /data/local/tmp/ccmem/*.db'
adb pull /data/local/tmp/ccmem ./dumps
sqlite3 dumps/<x>.db .tables       # 读明文表
```

**前提**：目标 App **必须先用起来**让它把库打开（刷信息流加载 feature/downloader
库；进「消息」加载 `encrypted_<uid>_im.db`）。刚冷启动、库没打开 → 内存里没有明文页
（实测 fresh pid 扫描 = 0）。

## 3. 踩坑表（血泪，照做省几小时）

| 坑 | 现象 | 解 |
|---|---|---|
| **64 位地址溢出（最坑）** | toybox sh `$(())` 是 32 位；`$((0x66xxxxxxxx/4096))` 算成**负数** → `dd` seek 到错偏移 → 扫描永远 0 命中（低地址 dalvik 段碰巧 <4GB 能读，误以为脚本没问题）| 地址换算用 `printf "%d" 0x..`（64 位）+ `bc` 大数运算 + `dd iflag=skip_bytes`（脚本已修）|
| anti-debug | frida `-p` → `Unable to access process with pid X`（EPERM）| 用方法 B（`/proc/mem`，不 ptrace）；或 attach 自然热进程（别 force-restart）|
| force-restart 触发反调试 | 冷启动进程秒置不可 ptrace；热进程（用户自然启动、跑了一阵）可 attach | **别 `am force-stop` 后再 attach**；用现有热进程 |
| 库没打开 | 内存扫描 0 命中 | 先把 App 用起来（刷/进消息）再扫 |
| App 自清 cache | dump 写 App cache 后秒被清 | dump 写 `/data/local/tmp`（root 可写，免 SELinux/清理）|
| SELinux 跨 App 目录 | magisk root `cd`/`ls`/glob 另一 App 目录被拒 | 按**全路径** `cp`/`cat`；或全程在 `/data/local/tmp` |
| `adb exec-out` 损坏二进制 | Windows 下 LF→CRLF，文件大小膨胀、sqlite 打不开 | 用 `dd`→`/data/local/tmp` + `adb pull`（二进制安全）|
| frida agent 在 App 上下文 | `new File("/data/local/tmp/..")` → Permission denied | frida 只能写该 App 自己的 cache/files；root 路径用方法 B |
| `seq` 缺失 | toybox sh 无 `seq` | 用 `while [ $n -lt N ]` |
| `su -c "多行..."` | MagiskSU 解析炸（`option requires argument -- c`）| 写成**脚本文件** push 后 `su -c 'sh /data/local/tmp/x.sh'` |
| 设备 USB 掉线 | 重 frida 负载后 `device offline` | `adb kill-server && adb start-server` |
| input 注入 | `SecurityException INJECT_EVENTS` | MIUI 需 `su -c 'input tap/swipe ...'`（root）|

## 3.5 散页重组 / 记录打捞（malformed dump → 真数据）

方法 B 的连续 dump 对**散列页缓存**库是 malformed（头有效、b-tree 断）。直接 `sqlite3`
打不开，且 platform-tools 的 sqlite3 **没有 `.recover`**。用本仓打捞器按 SQLite 记录格式
直接从叶子页（type `0x0D`）捞记录（顺序无关，等价 `.recover`）：

```sh
# 对单个 dump 或整目录扫
node scripts/android/pdh-sqlite-leaf-salvage.js dumps/cc_xxx.db > rows.jsonl
for f in dumps/*.db; do node scripts/android/pdh-sqlite-leaf-salvage.js "$f"; done > all-rows.jsonl
```

输出每行一条 `{rowid, cols:[...]}`（列按位置；UTF-8 正确解码，已测中文+emoji）。再按目标
schema 映射（如抖音 `msg`：cols=[msg_uuid, conversation_id, sender, content(JSON), created_time]）。
**已单测**（`packages/personal-data-hub/__tests__/sqlite-leaf-salvage.test.js`，真 sqlite 库往返）。
覆盖度取决于 dump 是否含该库的叶子页——尽量 dump 全 rw 段（方法 B 默认就扫所有 <256MB 段）。

### 3.5.1 一键入库 `cc hub salvage`（打捞→映射→vault 一步到位）

打捞器已收进可 bundle 的 pdh lib（`packages/personal-data-hub/lib/forensics/leaf-salvage.js`），
并封装成单条命令，dump → 叶子页打捞 → `mapSalvaged` → snapshot → `social-douyin` 入库：

```sh
cc hub salvage dumps/cc_xxx.db --json        # 列序自动推断（content/created_time 启发式）
cc hub salvage dumps/cc_xxx.db --columns msg_uuid,conversation_id,sender,content,created_time
```

返回 `{ingested, douyin:{salvage:{recordsSalvaged}}}`。本机真 sqlite 库端到端验证（中文+emoji
无损）。**v1 经 `social-douyin` 适配器入库**——别家 app dump 需各自 salvage 适配器（避免源归属错挂）。

### 3.5.2 Android 一键 root 采集按钮（自动化）

「本机数据」tab →「一键 root 采集（免密钥）」+ 目标 app 下拉：`MemSalvageCollector` 编排
`su` 内存扫描（assets/pdh/pdh-mem-sqlite-scan.sh）→ 拷 dump 进 app 目录 → 逐个 `cc hub salvage --app`
入库（按所选 app 正确来源归属）。仅 root 机；目标 app 须前台登录在用。手动脚本路径仍保留供调试。

### 3.5.3 ⚠️ 适用范围：标准 SQLCipher 可，WCDB2（抖音/头条等 ByteDance）不可

**2026-06-17 三轮证据驱动（D1 内容扫描 / D2 进程硬化 / E2 锚定头+多页大小，真机 dump
60 区域 119MB 分析）定论：**

- **标准 SQLCipher app（微信/QQ，libWCDB.so 带 `sqlite3_key`）**：解密页是标准 SQLite
  b-tree 叶子页 → leaf-salvage 有效。
- **抖音 IM = WCDB2（腾讯私有改版，`libwcdb2.so`/`libEncryptor.so`，无 `sqlite3_key`）**：
  内存里 IM 的解密页**不是标准 SQLite b-tree 叶子页**——leaf-salvage 解出全误报（779KB/
  1.37MB 单字段、列数 2–976 乱飞、无一致表形状），只能拿到抖音的**小配置/资源缓存库**。
  **抖音 IM 经「/proc/mem → leaf-salvage」走不通**，不是页大小/对齐/超时能修的，要它需
  WCDB2 页格式逆向或 frida hook DB 读 API（独立大工程）。UI 下拉已标「抖音（WCDB2·IM 暂不支持）」。
- 调试要点：dump 后查 DB 头 +16(BE,1=65536) 得页大小；非 512 对齐的标准 DB 页须**锚定
  "SQLite format 3\0"(16 字节含 NUL,别用带空格的 sig)走 header+k×pageSize**（--unaligned
  512-stride 扫不到非对齐页；但对 WCDB2 仍无效）。

**各 app salvage 状态（2026-06-17，基于项目自带 `*DbExtractor` 引擎证据 + 真机；UI 下拉已标注）**
——⚠️ **只有抖音是真机确认；其余是引擎预测 + 未真机验证**（抖音教训：extractor doc 的"明文"
预测被真机推翻成 WCDB2，别把预测当结论）：

| app | 引擎（来源） | salvage 状态 |
|---|---|---|
| 抖音 | WCDB2 私有页格式（真机 dump 分析 + `aweme_database`=file is not a database） | ❌ 真机确认不支持 |
| 今日头条 | **WCDB2**（真机 `/proc/25576/maps` 实证加载 `libwcdb2.so`+`libEncryptor.so`+IM 插件 `com.ss.android.im.so/libwcdb.so`；dump 60 区域仅 1 个标准 SQLite 头 0 记录） | ❌ 真机确认不支持（同抖音 ByteDance WCDB2 栈） |
| 微信 | 标准 SQLCipher（`libWCDB.so` 带 `sqlite3_key`，WeChatDbExtractor） | ✅ 理论甜区·需登录·未真机验 |
| QQ | plain SQLite（Android stock，QQDbExtractor 注"NOT SQLCipher"） | ✅ 理论最易·未验证（当前不在 TargetApp 列表） |
| 快手 | 自研加密/SQLCipher + libmsaoaidsec 反 frida（KuaishouRootDbExtractor） | ⚠️ 加密强·未验证 |
| 小红书 | SQLCipher/libshield（XhsRootDbExtractor） | ⚠️ 未验证 |
| 微博 | v0.1 假设明文，可能 SQLCipher（WeiboRootDbExtractor） | ⚠️ 未验证 |

真要扒某个的 IM：先按 §3.5/§3.5.3 真机 dump（app 须登录+开会话载库进内存）+ 查页结构验证，
别凭 extractor 的乐观预测当结论。**最高产可靠仍是 system-data，不是 app IM。**

> 注：上表 ❌ 仅指**方法 B（leaf-salvage）不适用**，**不等于该库无法解密**——头条/抖音的 WCDB2 IM
> 改走**方法 C（§3.6 frida `sqlcipher_export`）**，头条 `libwcdb2.so` 有导出符号可 hook（抖音反 frida）。

## 3.6 方法 C — frida `sqlcipher_export` 在线解密（2026-06-17 突破，WCDB/WCDB2 IM 正解）

§3.5.3 的「/proc/mem → leaf-salvage」对 WCDB2 走不通；而「frida 抓 key → 离线解密」也**走不通**
——2026-06-17 实测：frida hook `sqlite3_key`（头条 `libwcdb.so`/`libwcdb2.so` 均导出，头条无
`libmsaoaidsec` 反 frida）**稳定拿到 raw key**（`x'<64hex key><32hex salt>'`，salt 与 `encrypted_<uid>_im.db`
文件头 16 字节完全一致），但用 better-sqlite3-multiple-ciphers 的标准 SQLCipher 参数
（compat 1–4 × HMAC SHA1/256/512 × page/plaintext-header）**72 组合全 "file is not a database"**
——WCDB 用**自研 cipher 配置**（导出 `setDefaultCipherConfiguration`/`cipherHmacAlgorithm`/
`cipherPlainTextHeaderSize`），光有 key 不够。

**正解**：不离线复现 cipher，而是**借 App 进程里已用正确 key 打开的那条连接**，在它上面执行
`ATTACH DATABASE '<out>' AS ccpt KEY ''`（空 key=明文目标库）+ `SELECT sqlcipher_export('ccpt')`
（SQLCipher 内建函数，整库导出明文）→ 得到**完整明文副本**，完全绕开 cipher 参数。

```sh
# 设备已 root；目标 App 已登录并【前台进到「私信/消息」界面】（库被查询，hook 才命中）。
bash scripts/android/pdh-frida-decrypt.sh <serial> com.ss.android.article.news ~/pdh-data 60
#  → 明文 encrypted_<uid>_im.db.plain.db 拉到 ~/pdh-data（仓库外，勿入 git），脚本自动清设备侧。
```

- hook：`scripts/android/pdh-frida-sqlcipher-export.js`（装 `sqlite3_key/_v2` 开库 + `sqlite3_prepare*`
  下次查询；只对 `DB_MATCH=/_im\.db$/` 导出，INEXEC 防递归）。改 `DB_MATCH` 可解微信
  `EnMicroMsg.db` 等。
- 触发：停在信息流时 IM 插件 `.so` 未加载、`sqlite3_key` 不出现 → **必须进「私信」**让库被查询。
- 反 frida：头条✅、微信✅；**抖音带 `libmsaoaidsec` 可能 attach 后被杀** → 换头条同账号 IM
  （ByteDance 同 `com.ss.android.im` 框架、schema 一致，见 `reference/{toutiao,douyin}_im_schema.sql`）。
- privacy：明文副本含真实聊天 → 只在仓库外 `~/pdh-data` 留存，接完 PDH / 查完即删。

### 3.6.1 实战状态（2026-06-18，**诚实**：链路打通到 export 可达，但本机未取到真实数据）

⚠️ **方法 C 目前是「`sqlcipher_export` 可达」，不是「已产出明文库」**。2026-06-17/18 真机深入：
- ✅ 头条 `libwcdb2.so` **导出 sqlite3_exec/prepare/key**（per-module hook 实测 `[db][libwcdb2.so]
  encrypted_92585448288_im.db` 命中），sqlcipher_export **被调用到**。
- ❌ 但 export **rc=1 "disk I/O error"**（目标写 `databases/` 目录）。怀疑 **WCDB 自定义 VFS 管
  `databases/` 目录** → 目标文件页操作失败。改把目标写到 **`cache/` 目录（默认 VFS）+ 唯一 alias**
  （脚本里把 `DB_MATCH` 放宽到 `/encrypted_.*\.db$/`、out 改 `cache/`）——**此修复尚未验证**。
- ❌ 验证不了的原因：**头条私信本机是空的**（`encrypted_92585448288_im.db` idle 无会话→无 IM 查询触发；
  `encrypted_im_biz_*.db` 1.4MB=服务/系统通知非个人聊天）；**抖音有真实私信但反 frida**（见下）。
- **关键坑（复现必读）**：
  1. **写权限**：frida 以 **App uid** 跑，**写不了 `/data/local/tmp`**（root/shell 属主）→ export 目标 +
     日志都要写 **App 自己可写目录**（`cache/`），再 `su cp` 出来。
  2. **hook 时机**：必须在 **libwcdb2 加载之后**才 attach（`/proc/pid/fd` 已有 `_im.db` fds 时）；
     在 app 启动即 attach → libwcdb2 未加载 → frida-inject 的 `setTimeout` 重试**不 pump**（无 interceptor
     时 gum 事件循环不转）→ 后到的 libwcdb2 永不被 hook。**正确=等 IM 库开了再 attach**。
  3. **触发**：prepare hook 只在**有新查询**时 fire；停私信列表/库 idle 不 fire → 要**点开具体会话+滑动+下拉刷新**。
  4. **DB_MATCH 太窄**：`/_im\.db$/` 漏掉 `encrypted_im_biz_<uid>.db`（真有数据那个）→ 用 `/encrypted_.*\.db$/`。
  5. **重入**：在 prepare **onEnter** 里调 exec 会让连接重入 → "disk I/O error"/"ccpt already in use"；改 **onLeave** + 唯一 alias + 先 DETACH。
- **抖音 = 反 frida**：`libmsaoaidsec` —— frida **能 attach 上但 send() 输出被压制**（无诊断行）+ 重负载
  **把 USB/adb 打 offline**（`adb kill-server/start-server` 或 `adb reconnect` 恢复）→ 抖音 Method C **不实用**。
  抖音才有真实私信；要它需先绕过 libmsaoaidsec（spawn-time hook / 反 ptrace 检测），是独立工程。
- **下次复现 checklist**：① 找个**私信有真实会话**的 ByteDance App（头条多半空）；② 先把 App 用进私信、确认
  `_im.db` fds 已开，再 attach；③ 用 cache/ 输出 + 宽 DB_MATCH + onLeave 版脚本；④ 验证 export rc=0 后
  `su cp` 出明文副本到 `~/pdh-data`。

### 3.6.2 抖音深入定论（2026-06-22，**符号级铁证**：方法 C 对抖音 IM 走不通，且推翻两个旧假设）

⚠️ **抖音私信 = frida 符号名 hook 够不着，到此为止**。2026-06-22 用 frida-server **spawn 模式**（比 frida-inject 强）真机深挖，拿到符号级证据：

- **环境问题全部排除（spawn 模式解决了 §3.6.1 的所有运行时障碍）**：
  - ✅ **PC frida 17.14.1 + 设备 frida-server 17.14.1**（版本必须一致——之前 frida-inject 是 16.5.9、设备 server 是 17.14.1，**版本错位**是早先反复失败的隐藏因之一）。PC 装 frida 撞 pip 代理坑（`ProxyError: Cannot connect to proxy`，env/pip.ini/git 都查不到代理源）→ 解法=`curl --noproxy '*'` 直下 wheel（`frida-17.14.1-cp37-abi3-win_amd64.whl`，abi3 兼容 Py3.7+）+ `pip install --no-index <wheel>` 本地装。
  - ✅ **spawn 冷启动稳定不 ANR**（`dev.spawn([pkg]) → attach → resume`）。**推翻旧假设①：抖音并无 `libmsaoaidsec` 反 frida**（`grep -c libmsaoaidsec /proc/<pid>/maps`=0）。之前 frida-inject「attach 即 ANR + USB 掉线」**不是反 frida，是 frida-inject 工具太重 + 版本错位**——spawn 模式抖音全程存活。
  - ✅ **hook 全装上**（prepare_v2/prepare/prepare_v3/open，frida 17.x API：`Module.findExportByName(null,name)` 已废 → 用 `Module.getGlobalExportByName` 或遍历 `Process.enumerateModules()` 的 `mod.findExportByName`）。
  - ✅ 语句缓存问题也排除（冷启动=空缓存，首查必走全新 prepare）。
- **❌ 但 `[db]=0, [export]=0`（铁证）**：冷启动 + 全 hook + 用户实际滚动私信 + `encrypted_*_im.db` fd 开 **22 个**（IM 库高度活跃）→ 导出的 `sqlite3_prepare_v2`/`sqlite3_open` **被调用 0 次**。诊断版（prepare onLeave 记录**每个**被 prepare 的 db 名，不限匹配）全程只在非 IM 路径偶尔命中（如 `ss_push_monitor.db`），**IM 库一次都没经过导出的 sqlite3 符号**。
- **根因（ELF 符号表证实）**：`libwcdb2.so` **只有 `.dynsym`、无 `.symtab`**（内部符号被 strip）。抖音 IM 查询走 libwcdb2 **未导出的私有 sqlite 实现**（`sqlite3LockAndPrepare`/`sqlite3VdbeExec` 等，静态编入、符号被 strip）；导出的那批 `sqlite3_prepare_v2`/`open`/`step`/`exec` 只是给**非 IM 的简单库 / 第三方**用的入口。**按符号名 frida 够不着 IM 查询路径**。**修正旧假设②（§3.6.1「头条 libwcdb2 导出 prepare 命中 encrypted_im.db」）：那条「命中」大概率是非 IM 库或测量误记——本次抖音上同款导出符号对 IM 查询 0 命中**。
- **再往下需要的是逆向工程级工作（非「引导式采集」可覆盖）**：① 对 libwcdb2 内部 `sqlite3_step`/`prepare` 实现做**机器码特征模式扫描**→按地址 hook（strip 了符号只能这么找）；② 或攻 `libEncryptor.so` 拿 WCDB2 自研 cipher 参数离线解。两者都是独立大工程。
- **为什么微信/QQ 能成、抖音/头条不行**：微信/QQ 用**标准 SQLCipher**（导出标准 `sqlite3_key`/`prepare` + key 可**派生**）→ `collect-wechat`/`collect-qq` 纯 Node 解；抖音/头条的 **WCDB2 是另一个物种**（自研 cipher + strip 内部符号 + 不暴露 IM 查询入口）。**别再拿「能 attach / 无反 frida」当「能导出 IM」的依据——符号可见性才是关键**。
- **复现脚本**：`/c/tmp/dy_export.py`（frida-server spawn 版，本次用，仓库外）；旧 frida-inject 版 `scripts/android/pdh-frida-sqlcipher-export.js`（对标准 SQLCipher app 仍有效，对 WCDB2 IM 无效）。

## 4. 结论

- 真机免密钥采集**对标准 SQLCipher app（微信/QQ）已验证路径成立**：方法 B 从内存 dump 出
  明文标准 SQLite 页 → leaf-salvage 打捞（免 key，绕 anti-debug）。**但非"引擎无关通用"**：
  WCDB2（抖音）的私有页格式解不了（见 §3.5.3）。
- 个人数据采集**最高产可靠的是 system-data（通讯录/短信/通话/媒体，明文/content-query）**——
  优先做这个，不是跟 WCDB2 app 死磕。
- **加密 App IM**：①标准 SQLCipher（微信/QQ）可 leaf-salvage（方法 B）+ 派生 key 纯 Node 解（`collect-wechat`/`collect-qq`，**已验证产出真实数据**）；②**WCDB2（头条/抖音）的 IM 走方法 C（§3.6）frida `sqlcipher_export` 理论上不靠 cipher 复现，但 2026-06-22 抖音符号级实测=`sqlite3_prepare/open` 对 IM 查询 **0 命中**（libwcdb2 strip 内部符号、IM 走未导出私有入口）→ **frida 符号名 hook 对抖音 IM 走不通**（详见 §3.6.2）。要它需机器码模式扫描内部 prepare/step（逆向工程级）或攻 libEncryptor 离线解——均非引导式采集范畴。
- **WCDB2 IM ≠ frida 可达**：关键不是「能不能 attach / 有没有反 frida」（抖音两者都 OK），而是**导出符号是否覆盖 IM 查询路径**——抖音 libwcdb2 **不覆盖**（symtab 被 strip）。**别把「能 attach」当「能导出 IM」**。头条同款 WCDB2 栈，谨慎假设同样走不通（§3.6.2 修正了 §3.6.1 的乐观记录）。
- **抖音/头条的现实价值**：明文非-IM 库（`cc hub collect-db`，抖音实测 18669 条）+ cookie-API（`douyin-adb-sync`/`toutiao-adb-sync`）——**加密私信放弃，采明文库**。
