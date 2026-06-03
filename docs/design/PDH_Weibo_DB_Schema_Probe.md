# PDH Weibo Mode B — schema 探测 (P7.3)

> 状态: v1 (Phase 7.3, 2026-05-26) — **user-driven exploration**
> 关联: [[pdh-mode-b-phase-7]] / [[pdh-multipath-phase-b0-scaffold]]
> 上游方案: `docs/design/PDH_Mode_B_Phase_7_Plan.md` §2.2 (Weibo 4/5 难度, schema 公开度 = 低)
> 上游 plan: `docs/design/PDH_Social_Multipath_Local_Collection_Plan.md` §6.2 (Weibo: 零公开资料 → 从零逆向)

## 0. 为啥要先探测才能 ship Mode B

Phase 7 Plan 评估 Weibo Mode B = 4/5 难度，主要因为 **schema 公开度极低**:
- Toutiao 可以推论字节系 framework 共用 (abrignoni Douyin 类比) → P7.1 直接 ship v0.1
- Bilibili 有 [bilibili-android-decompile](https://github.com/2bllw8/bilibili-android-decompile) 公开 → P7.2 直接 ship
- **Weibo 既无字节系类比也无公开 decompile** → 必须先真机 dump 确认:
  1. DB 文件叫什么 (路径 `/data/data/com.sina.weibo/databases/?`)
  2. 加密 or 明文 (SQLCipher? libshield 自研? 明文?)
  3. 我们关心的 table (status / mblog / favorite / follow) 存在否, 叫啥
  4. column 命名规则

P7.3 的产物是**填好的本文档** — 用户跑下面的 §3 adb probe 把结果贴回来, 然后 §5 决策树决定 P7.4 实施路径.

## 1. 准备清单

| 项 | 验证命令 |
|---|---|
| Win + Android Platform Tools | `adb version` ≥ 35.0 |
| 设备 Magisk root | `adb shell su -c "id -u"` 返 `0` |
| MIUI/HyperOS: USB 调试第二开关 | `adb shell pm list packages -3` ≥ 1 |
| 微博官方版 APK 已装 (不是国际版/Lite) | `adb shell pm list packages com.sina.weibo` 命中 |
| 微博 App 已登录 + 发过/收藏过/关注过 | DB 内有真实数据可探 |
| (可选) frida-tools host-side | `pip install frida-tools` (frida-server 真机侧需对应 ABI) |
| (可选) jadx / apktool 桌面 | 反向看 schema 类的 fallback path |

## 2. 探测目标 (要回答的 4 个问题)

**Q1: DB 文件清单是什么?**
- `/data/data/com.sina.weibo/databases/` 下有哪些 `.db` 文件
- 每个文件大小 + 修改时间 (判断"活跃数据"还是 legacy)

**Q2: 是否加密?**
- 普通 sqlite3 能否 open + `.tables` 列出表
- 不能 = SQLCipher 或自研加密 → 走 §4 frida 路径
- 能 = 明文 → 直接进 Q3

**Q3: 我们要的数据 (微博 / 收藏 / 关注 / 评论) 在哪张表?**
- 候选表名: `status` / `mblog` / `weibo` / `feed` / `favorite` / `attention` / `follow` / `comment` / `attitude` (点赞)
- 每个 candidate 看 `PRAGMA table_info(<table>)` 得 column

**Q4: column 命名规则是什么?**
- e.g. timestamp 列叫 `create_time` 还是 `created_at` 还是 `time`?
- weibo ID 列叫 `mid` (mblog id, 微博 ID) 还是 `id` 还是 `wid`?

## 3. Probe Script (用户跑 — Win PowerShell)

### 3.1 一键脚本

把下面整段贴到 PowerShell 里跑. 中间任何一步失败保留输出 (`tee` 写文件方便回报):

```powershell
$out = "$env:TEMP\weibo-probe-$(Get-Date -Format yyyyMMdd-HHmmss).txt"
"=== 1. root + pkg sanity ===" | Tee-Object -FilePath $out
adb shell su -c "id -u" 2>&1 | Tee-Object -FilePath $out -Append
adb shell pm list packages com.sina.weibo 2>&1 | Tee-Object -FilePath $out -Append

"=== 2. databases/ 目录清单 ===" | Tee-Object -FilePath $out -Append
adb shell su -c "ls -la /data/data/com.sina.weibo/databases/ 2>/dev/null" | Tee-Object -FilePath $out -Append

"=== 3. 每个 .db 文件 magic header (判加密) ===" | Tee-Object -FilePath $out -Append
adb shell su -c "for f in /data/data/com.sina.weibo/databases/*.db; do echo === \$f ===; head -c 16 \$f | xxd; done" 2>&1 | Tee-Object -FilePath $out -Append

"=== 4. 每个 .db 文件 .tables (明文才有输出) ===" | Tee-Object -FilePath $out -Append
adb shell su -c "for f in /data/data/com.sina.weibo/databases/*.db; do echo ====== \$f ======; sqlite3 \$f '.tables' 2>&1; done" | Tee-Object -FilePath $out -Append

"=== 5. 看 files/ 里有没有非 databases/ 的 sqlite (有些 App 把 db 放 files/) ===" | Tee-Object -FilePath $out -Append
adb shell su -c "find /data/data/com.sina.weibo/files -name '*.db' 2>/dev/null" | Tee-Object -FilePath $out -Append
adb shell su -c "find /data/data/com.sina.weibo/files -name '*.sqlite*' 2>/dev/null" | Tee-Object -FilePath $out -Append

"=== 6. APK 版本号 (schema 跟版本绑定) ===" | Tee-Object -FilePath $out -Append
adb shell dumpsys package com.sina.weibo | Select-String -Pattern "versionName|versionCode" | Select-Object -First 4 | Tee-Object -FilePath $out -Append

"=== Done. Output saved to: $out ===" | Tee-Object -FilePath $out -Append
Write-Host "`n输出已写入: $out`n把这个文件贴回来 (cat / Get-Content)"
```

### 3.2 (条件) 如果 §3.1 step 4 有任何表输出 (明文)

继续探每个候选表的 schema:

```powershell
# 替换 <DB> 为 §3.1 step 4 显示有表的文件名
$candidateTables = @(
  "status", "mblog", "weibo", "feed",
  "favorite", "fav", "attention", "follow", "subscription",
  "comment", "attitude", "message"
)
foreach ($t in $candidateTables) {
  Write-Host "--- $t ---"
  adb shell su -c "sqlite3 /data/data/com.sina.weibo/databases/<DB>.db '.schema $t'" 2>&1
}
```

### 3.3 (条件) 如果 §3.1 step 3 magic header 显示 `SQLite format 3`

明文 SQLite (跟 Toutiao / Douyin / Bilibili 同) — Mode B v0.1 模板可复用. 跳到 §5 决策.

### 3.4 (条件) 如果 §3.1 step 3 magic header 不是 `SQLite format 3`

可能是 SQLCipher 或自研加密. magic header 应是文件第一 16 字节, 看输出特征:

| Hex pattern | 推断 | 后续 |
|---|---|---|
| `53 51 4c 69 74 65 ...` ("SQLite f") | 明文 | §5 决策 (直接 ship v0.1) |
| 随机 hex 看不出规律 | SQLCipher (典型 cipher header) | §4 frida hook 路径 |
| `01 09 19 ...` 或 jpeg/png 类 magic | 自研格式 / 文件被压缩 | §4 + jadx 反向 |

### 3.5 (高级 / 可选) frida hook dump live schema

如果 §3.4 提示加密, 可以用 frida 在 Weibo 进程内 hook `SQLiteOpenHelper.onCreate()` 或 `SQLiteDatabase.openOrCreateDatabase()` 截获 schema DDL:

```javascript
// frida-script: weibo-schema-hook.js
// 用法: frida -U -f com.sina.weibo -l weibo-schema-hook.js --no-pause

Java.perform(function() {
    var SQLiteDatabase = Java.use("android.database.sqlite.SQLiteDatabase");
    SQLiteDatabase.execSQL.overload("java.lang.String").implementation = function(sql) {
        if (sql.toLowerCase().indexOf("create table") >= 0) {
            send("CREATE_TABLE: " + sql);
        }
        return this.execSQL(sql);
    };
    // Also hook SQLCipher's net.sqlcipher.* if present
    try {
        var SQLCipherDb = Java.use("net.sqlcipher.database.SQLiteDatabase");
        SQLCipherDb.execSQL.overload("java.lang.String").implementation = function(sql) {
            if (sql.toLowerCase().indexOf("create table") >= 0) {
                send("CIPHER_CREATE_TABLE: " + sql);
            }
            return this.execSQL(sql);
        };
        console.log("[+] hooked net.sqlcipher (SQLCipher in use)");
    } catch (e) {
        console.log("[-] net.sqlcipher not present (probably plaintext)");
    }
});
```

Pipe `send()` output → host stdout — collect 5-10 min of normal app use to see init + later table creates.

### 3.6 (高级 / 可选) frida hook SQLCipher key derivation

如果 §3.5 confirms SQLCipher, 找 key:

```javascript
// frida-script: weibo-sqlcipher-key-hook.js
Java.perform(function() {
    var SQLiteDatabase = Java.use("net.sqlcipher.database.SQLiteDatabase");
    // openOrCreateDatabase(File, String, ...) — String 参数是 key
    SQLiteDatabase.openOrCreateDatabase.overloads.forEach(function(overload) {
        overload.implementation = function() {
            for (var i = 0; i < arguments.length; i++) {
                if (typeof arguments[i] === "string" && arguments[i].length >= 16) {
                    send("CIPHER_KEY_CANDIDATE: " + arguments[i]);
                }
            }
            return overload.apply(this, arguments);
        };
    });
});
```

Same pattern as WeChat 12.10 — see `wechat_frida_hook_audit_traps.md` for libWCDB.so 大小写 + sqlite3_key_v2 args[2]+[3] / ASCII-hex vs raw-bytes traps.

## 4. 用户填入: 探测结果

(空 — 跑完 §3 后把这里填上)

### 4.1 §3.1 输出 (databases/ ls + magic header + .tables)

```
(粘贴 PowerShell 文件内容)
```

### 4.2 §3.2 候选表 schema (如果 §3.1 step 4 有输出)

```
(粘贴 .schema 输出)
```

### 4.3 §3.5/3.6 frida hook (如果加密)

```
(粘贴 frida send() 输出, 5-10 分钟正常使用 App)
```

## 5. 决策树 — P7.4 实施路径

填完 §4 后, 用本节决策树:

```
§4.1 magic header = "SQLite format 3"?
├── YES (明文) → 看 §4.2 schema 是否有 status/mblog/favorite/follow 类表
│   ├── 4 个 kind 都有 → P7.4 v1.5 ship template (复刻 P7.2 Bilibili 3 文件结构)
│   ├── 部分有 (e.g. 只有 status + favorite) → P7.4 v1.5 ship 子集
│   └── 都没有 → 用 §3.5 frida hook 看是否 schema 在 init 阶段动态创建后 db 文件名不直观
└── NO (加密)
    └── §4.3 frida 能拿到 key 吗?
        ├── 是, key 稳定 → P7.4 v2.0 SQLCipher 模式 (复刻 WeChat 12.10 模板, 加 key derivation)
        ├── 是, key rotate (per-session salt) → P7.4 v2.0+ 必须 frida 注入到 Weibo 进程才能 decrypt (复杂度同 WeChat)
        └── 不行 (libshield 系反 frida) → **defer Mode B 到 v2.5+**, 推 path A 加固
```

## 6. 已知 Weibo 反爬 hints (来自现有 path A 经验)

(来自 [[pdh-multipath-phase-b0-scaffold]] + path C 实跑) 帮助预判加密强度:

- Weibo path A (m.weibo.cn cookies + HTTP) 通过 **多 cookie 校验** + JS-set 时序 race 拦未签名 client. 表明 server 端反爬强.
- Weibo 没有 libshield.so / libmsaoaidsec.so 这种**进程级 anti-frida** 跨 client 共享 lib (跟 Xhs / Kuaishou 不同). 单 process level frida 应该能跑.
- Weibo Android client 较老 codebase, **SQLCipher 概率比自研加密高** (跟新一代字节系不同).

预期: §3.1 step 3 magic header 可能是 `SQLite format 3` (明文) 或 SQLCipher header — **不太可能**是自研加密.

## 7. 完工标记

- [ ] §3.1 一键脚本跑完 + 输出贴 §4.1
- [ ] §3.2 候选表 schema 跑完 + 输出贴 §4.2 (如果明文)
- [ ] §3.5/3.6 frida hook 跑完 + 输出贴 §4.3 (如果加密)
- [ ] §5 决策树走完 → 决定 P7.4 实施路径 (v1.5 明文 / v2.0 SQLCipher / v2.5+ 反 frida defer)
- [ ] commit P7.3 doc + (如果决策树指向 ship) 起 P7.4 task

## 8. 下一步

填完 §4 + 走完 §5 后:

- 如果决策 = P7.4 v1.5 (明文): 我会基于 §4.2 schema 写 3 个 WeiboRoot Kotlin 文件 (mirror P7.1.1 Toutiao 模板)
- 如果决策 = P7.4 v2.0 (SQLCipher): 我会写 4 个 WeiboRoot 文件 (加 WeiboFridaInjector + key derivation, mirror WeChat 12.10)
- 如果决策 = defer: 推 path A 加固 (e.g. SignProvider for Weibo HTTP) → 跳过 P7.4 进 P7.5 Xhs (其实 Xhs 已 defer v2.0+) 或回去做 P7.1.0/P7.2.0 schema 探测填实

---

related: [[pdh-mode-b-phase-7]] [[android-wechat-collector-phase-12-10]] [[wechat-frida-hook-audit-traps]]
