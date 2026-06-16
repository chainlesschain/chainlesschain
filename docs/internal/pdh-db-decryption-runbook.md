# PDH 端侧加密 DB 解密 / 采集 Runbook（真机，已验证）

> 目的：把已 root 真机上、已登录 App 的**加密本地数据库**（WeChat / Douyin / QQ
> 等用 SQLCipher / WCDB2 透明加密的库）解密出来，供你自己的个人数据中台（PDH）
> 做互通分析。
>
> **授权边界**：仅在**你本人拥有**的已 root 设备、**你本人**的账号、**你本人**的
> App 上进行。不要对他人账号/设备进行。配套：[`pdh-endpoint-capture-runbook.md`](./pdh-endpoint-capture-runbook.md)（cookie 端点抓包）、内存 `android_app_db_decryption_findings`。

## 0. 两条路线（按 App 加密形态选）

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

## 4. 结论

- 真机解密采集**已验证可行**：方法 B 从 Douyin 内存 dump 出真实明文 SQLite 库（免 key，
  绕过 anti-debug）。技术**引擎无关**，对任何透明加密 App 通用（其他 app 也可以）。
- 定向抓某库（如 IM 消息库）= 让 App 先打开它 + 在热进程上 `/proc/mem` 扫；最稳是接进
  in-app collector 自动化。
