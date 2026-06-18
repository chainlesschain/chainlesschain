# Android WeChat (EnMicroMsg.db) 解密 → PDH 入库 — 可复现 Runbook

> 实测 2026-06-19，chopin / M2104K10AC，WeChat 8.0.74，账号 `e1d7e7a2…`：
> **52129 消息 / 1926 联系人**解密入库。另两账号 `2d80efb…`(1142 msg/11752 联系人)、
> `60e2c317…`(密钥未知)。一键脚本：`scripts/android/pdh-wechat-decrypt.mjs`。

## TL;DR（密钥已知时，一条命令）

```sh
node scripts/android/pdh-wechat-decrypt.mjs --serial <serial> --out-dir ~/pdh-data/wx --ingest
```

- 自动：枚举所有登录账号 → root adb-pull 每个 `EnMicroMsg.db` → 用候选 7 位密钥 ×
  SQLCipher 配置暴力匹配 → Node 纯 crypto 逐页解密 → 写 `EnMicroMsg_decrypted_<acc>.db`
  → `--ingest` 时把 message/rcontact 灌进 vault（可 `cc hub search`）。
- 成功的口令会存到 `~/.pdh-wechat-keys.json`，下次秒解。
- **本机已知可用口令**（已内置进脚本候选 + 存盘）：账号 `e1d7e7a2…`=`7361a23`，
  `2d80efb…`=`371f24e`（皆 SQLCipher1 配置）。

## 关键事实（为什么这么做）

1. **WeChat 密钥 = `MD5(IMEI+uin)[:7]`**（7 位小写 hex）。**一旦得到，账号生命周期内不变**
   （sjqz 2026-02 抓的 `7361a23` 到 6 月仍有效）。
2. **WeChat 8.x WCDB 不调用导出的 `sqlite3_key`**——hook 它永不 fire。真正的 AES key
   走 `aes_v8_set_encrypt_key`(libWCDB.so，arg0=32 字节原始 key，arg1=bits)。
3. **解密配置 = SQLCipher1**：page **1024** / reserve **16** / **no HMAC** / kdf_iter 4000 /
   SHA1 / AES-256-CBC。page1 前 16 字节是 salt(明文)，每页 IV=该页 reserve 前 16 字节。
   page1 校验：解密后 `pt[5]==0x40 && pt[6]==0x20 && pt[7]==0x20`(SQLite header 偏移21/22/23)。
4. **别用 better-sqlite3-multiple-ciphers**：它的 pragma 路对 WeChat 库反复 `file is not a
   database`。用 **Node 内置 crypto** 逐页解（`pbkdf2Sync(pass,salt,4000,32,'sha1')` +
   `createDecipheriv('aes-256-cbc',key,iv).setAutoPadding(false)`）——脚本已封装。

## 密钥获取（新账号 / 候选都不中时）

`MD5(IMEI+uin)[:7]` 在 Android 13 上 IMEI 通常读不到 → 计算不出。两条路：

### A. frida 抓原始 AES key（fallback，脚本已带）

```sh
# 1) 一次性：装 frida node binding + 推 frida-server(必须 root！)
#    npm i frida   (本机在 C:\fridatools)
#    下载 frida-server-<ver>-android-arm64.xz(github releases，版本对齐 node frida)
#    python -c "import lzma;open('frida-server','wb').write(lzma.open('frida-server.xz').read())"
#    adb push frida-server /data/local/tmp/frida-server
#    adb shell su -c 'chmod 755 /data/local/tmp/frida-server'
#    # 用脚本启动确保 root（&  在 su -c 里会掉成 shell uid → attach 全失败）：
#    printf 'setenforce 0\nnohup /data/local/tmp/frida-server -D >/dev/null 2>&1 &\n' > /tmp/fr.sh
#    adb push /tmp/fr.sh /data/local/tmp/fr.sh; adb shell su -c 'sh /data/local/tmp/fr.sh'
#    adb shell su -c 'ps -A -o USER,NAME | grep frida-server'   # 必须显示 root
# 2) 抓 key（窗口内打开微信、多点几个会话）
node scripts/android/pdh-frida-wechat-aeskey.mjs --serial <serial> --seconds 90 --out wxkeys.json
# 3) 喂给解密器（raw-key 模式 brute）
node scripts/android/pdh-wechat-decrypt.mjs --serial <serial> --out-dir ~/pdh-data/wx \
     --raw-keys-file wxkeys.json --ingest
```

⚠️ `aes_v8` key 是**每库一把**，且 EnMicroMsg 连接登录时就建好、不会重设 → attach 抓到的多
是别的库的 key。多浏览会话/搜索增加命中；抓不到就只能靠**口令路**（A 失败回到下面 B）。

### B. 口令暴力（已知 IMEI/uin 时）

脚本会自动从 `shared_prefs` 读 uin，并对常见 IMEI 候选（空 / androidId / `1234567890ABCDEF`
/ 全 0）算 `MD5(IMEI+uin)[:7]`。真 IMEI 可读时（`adb shell service call iphonesubinfo …`）传
`--keys-file`（一行一个 7 位 hex）。参考工程 `C:\code\sjqz`（同机 2026-02 解过，候选列表见其
`tools/wechat/decrypt_sqlcipher.py`）。

## 入库验证

```sh
cc hub stats                          # events 增长
cc hub search --adapter wechat        # 微信消息可搜
cc hub ask "我和谁聊得最多？"           # RAG over vault
```

入库走自定义 plaintext reader 喂 wechat adapter 的 normalize（message→event / rcontact→person
/ chatroom），消息单独经 `vault.putEvent`(upsert，幂等)。`normalizeWeChatMessage` 返回
`{events:[...]}`(**复数**)。

## 隐私

明文库 + 解密产物只放仓库外（`~/pdh-data` 或桌面 `我的数据库\`），**绝不入 git**。
`~/.pdh-wechat-keys.json` 存的是口令，注意保护。

## QQ NT (nt_msg.db) — ✅ 已验证（PC 路）

> 实测 2026-06-19，PC QQ NT 9.9.31，账号 896075341：**group_msg 2662 / c2c 私聊 / 49 会话**
> 解密。库在 `~/Documents/Tencent Files/<qq>/nt_qq/nt_db/nt_msg.db`。

**关键事实**（与微信完全不同）：
1. **头部 1024 字节是明文头**（伪装 `SQLite header 3\0`）→ **必须 SKIP 1024 字节**，真 SQLCipher
   库从 byte 1024 开始（salt 在 1024..1039）。
2. SQLCipher：page **4096** / **reserve 48**（IV16+HMAC_SHA1=20+pad）/ **IV 在 reserve 开头
   (offset 0)** / kdf_iter 4000 / AES-256-CBC。（**IV 位置是最大的坑**——标准 SQLCipher IV 在
   reserve 开头，不是 HMAC 之后。）
3. **密钥**：QQ SQLCipher 走 **OpenSSL `EVP_CipherInit_ex`(crypto.dll, arg3=32字节 AES key)**，
   **不是** sqlite3_key（libsqlite.so 是标准 SQLite 无 cipher；libDBEncryptV2 只是文本字段混淆）。
   key 仅**登录建连**时设一次 → 运行态读页缓存抓不到 → **必须 frida spawn QQ + 登录瞬间抓**。
   DB 主进程可能拒绝 frida 注入（反调试），但渲染/工具子进程里的 EVP 也经手 DB key（实测命中）。
4. 消息正文 `40800`/`40900` 是 **protobuf 二进制**，需 qq-pc adapter/sidecar 解码为可读文本。

**复现命令**：
```sh
# 1) frida 抓 key（杀 QQ → spawn → 登录）
node scripts/android/pdh-frida-qq-aeskey.mjs --out qq-keys.json --seconds 180
# 2) 解密（确定性）
node scripts/android/pdh-qq-decrypt.mjs --db "C:/Users/<u>/Documents/Tencent Files/<qq>/nt_qq/nt_db/nt_msg.db" \
     --raw-keys-file qq-keys.json --out-dir "C:/Users/<u>/Desktop/我的数据库"
```

### ✅ Android QQ NT — 已验证（**无需 frida**，密钥可推导）

> 实测 chopin / 账号 896075341：group_msg 466 / c2c 7 解密。比 PC 路干净得多。

**密钥推导**：`key = MD5( MD5(uid) + rand )`（32-hex 串作 SQLCipher 口令）
- `rand` = nt_msg.db 头部 "QQ_NT DB" 后的可读串（protobuf field2，~8 chars，如 `6bd8giTC`）；
  头里还写 HMAC 算法（`HMAC_SHA1`）。
- **坑：`nt_qq_<hash>` 目录名的 hash ≠ MD5(uid)**（实测不符）！必须用**真实 uid**。uid 无固定
  位置 → 从 QQ 全量数据 `strings|grep u_` 收候选（实测 417 个），逐个套公式暴力，page1 解出有效
  SQLite header 即命中 self uid（本机 `u_UIQoK3voMJD53LvjlHj3aw`，与 PC 同账号）。
- 解密参数：SKIP 1024 / page 4096 / reserve 48(HMAC_SHA1) / IV@reserve开头 / PBKDF2_HMAC_SHA512
  iter 4000 / AES-256-CBC。

**复现命令**（一条龙：pull + 推导 + 解密）：
```sh
node scripts/android/pdh-qq-android-decrypt.mjs --serial <serial> --out-dir "C:/Users/<u>/Desktop/我的数据库" --self <qq>
node scripts/android/pdh-qq-ingest.mjs --db "C:/Users/<u>/Desktop/我的数据库/QQ_android_nt_msg_decrypted.db" --self <qq>
```

## Schema 字典（供 AI 解读/展示）

```sh
node scripts/android/pdh-dump-decrypted-schema.mjs --dir "C:/Users/<u>/Desktop/我的数据库"
# → SCHEMA_字典.md：核心表速查 + 每表 CREATE TABLE SQL + 列含义 + 样本
#   微信列名自带语义；QQ 数字列(40001/40050/40033/40800…)含义见 qq-pc COL_CANDIDATES。
```

## 相关
记忆 `pdh_realdevice_collect_2026_06_18`、`android_app_db_decryption_findings`。
参考工程 `C:\code\sjqz`(微信 7 位口令候选)、`QQBackup/qq-win-db-key`(QQ NT 1024 头+SQLCipher 参数)。
