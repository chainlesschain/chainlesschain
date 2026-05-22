# A8 Bilibili — 真机 E2E 测试计划

**Status**: v0.1 计划 (2026-05-22) — stub `A8BilibiliE2ETest.kt` 已落，真机执行需 Mac/Linux + Android 真机 + 真账号；Win dev box 无法运行。

## 范围

A8 v0.1 端到端覆盖 Bilibili 完整路径：

```
WebView 登录 → CookieManager 提取 cookie → DedeUserID 落 EncryptedSharedPreferences
   ↓
HubLocalViewModel.syncBilibili()
   ↓
BilibiliLocalCollector.snapshot()
   ↓ BilibiliApiClient × 4 (history / favourite / dynamic / follow)
   ↓ JSON 拼装写 filesDir/.chainlesschain/staging/social-bilibili.json
   ↓
LocalCcRunner.syncAdapter("social-bilibili", path)
   ↓ mksh 起 in-APK cc 子进程
   ↓ cc hub sync-adapter --input <path> --json
   ↓ adapter._syncViaSnapshot → registry → 本机 SQLCipher LocalVault
   ↓
UI 显示 "已同步 N 条"
```

## 前置（一次性）

1. 真 Bilibili 账号（任意 v0.1 不依赖账号有视频）
2. Mac/Linux dev box（Win 不能跑 Android emulator + 缺 SDK + adb）
3. 真 Android 设备（Xiaomi 24115RA8EC 已验过 Plan A v0.1 工程基础 + system-data-android adapter）
4. APK 已 bundle in-APK cc + PDH 0.2.2+（新 BilibiliAdapter 必须在 in-APK cc 里可见）
5. Termux 不需要——使用 APK 内嵌的 cc

## 8 个 E2E 场景

### 场景 1 — 首次登录成功（happy path）

**设定**: 全新装的 APK，从未登录过 Bilibili

**步骤**:
1. 打开 ChainlessChain → 个人数据中台 → 本机数据 tab
2. 看到 Bilibili 卡片，状态 "未登录"，按钮 "登录"
3. 点 "登录" → WebView 加载 `https://passport.bilibili.com/login`
4. 用真账号登录（密码/扫码/短信均可）
5. 登录成功后 WebView 自动跳到 `https://www.bilibili.com/`
6. ChainlessChain 检测到 `isLoginSuccess` 命中 → 提取 cookie → 关 WebView → 回 5 卡片列表
7. Bilibili 卡片状态变 "已登录 UID:<你的uid>"

**断言**:
- WebView 在登录后 ≤ 3s 内自动关闭
- 卡片 UID 与 Bilibili 网页 console `document.cookie.match(/DedeUserID=(\d+)/)[1]` 一致
- EncryptedSharedPreferences `pdh_social_bilibili` 文件存在于 APK 数据目录

### 场景 2 — 同步 4 类数据成功

**设定**: 已完成场景 1，账号上有 ≥ 1 条历史 + ≥ 1 个收藏夹有视频 + ≥ 1 条动态 + ≥ 1 个关注

**步骤**:
1. 在 Bilibili 卡片点 "同步"
2. 按钮变 "同步中…"，旋转圈出现
3. ~5-15s 后 toast "social-bilibili 同步完成 (+N 事件)"
4. 卡片显示 "上次同步：<时间> (+N 事件)"

**断言**:
- N ≥ 4（至少各类 1 条）
- 通过 `adb shell run-as com.chainlesschain.android cat databases/<vault>.db | sqlite3 ".tables"` 可见 events / persons / items 表
- LocalCcRunner 子进程日志含 4 类 originalId（grep `bilibili:history:` / `bilibili:favourite:` / `bilibili:dynamic:` / `bilibili:follow:`）

### 场景 3 — Cookie 过期（cookie 主动清除模拟）

**设定**: 已登录，强制让 cookie 失效

**步骤**:
1. 进 Android 系统 "应用设置" → ChainlessChain → 存储 → 清除数据（仅清 WebView 数据）
2. **或**手动 `adb shell run-as com.chainlesschain.android rm -rf cache/WebView` + `app_webview/Cookies*`
3. 点 "同步"

**断言**:
- 全部 4 API 返回 `code: -101`（账号未登录）
- 卡片显示 "4 个 API 都返回空 — cookie 可能过期，请重新登录"
- 点 "退出登录" 清除本地 store
- 点 "登录" 进 WebView，发现仍是登录页（cookie 真没了）

### 场景 4 — WebView 取消登录

**步骤**:
1. 全新装 APK 或退出登录后
2. 点 "登录" 进 WebView
3. 在 Bilibili 登录页**不输任何信息**，点系统返回键 / 顶部 "取消"

**断言**:
- WebView 关闭返回卡片列表
- Bilibili 卡片状态仍是 "未登录"
- 无 toast 错误，无 errorMessage
- EncryptedSharedPreferences 中 cookie 字段空

### 场景 5 — 部分 API 失败（一个 5xx）

**设定**: 用网络代理拦截 `api.bilibili.com/x/relation/followings` 返 503

**步骤**:
1. 已登录场景下，开网络代理（Charles / mitmproxy）
2. 设规则：拦截 follow API 返 503，其他放行
3. 点 "同步"

**断言**:
- 同步完成不抛异常
- 卡片显示 "+M 事件"，M < 总数（缺 follow 那部分）
- 子进程日志含 OkHttp warn "503 on /x/relation/followings"
- 其他 3 类 events 正常写入 vault

### 场景 6 — 反复同步幂等性

**设定**: 已登录 + 已同步过一次

**步骤**:
1. 立即再点 "同步"（数据没变化）
2. 再点一次

**断言**:
- 三次 sync 之后 `vault.queryItems()` 数量不变（同 bvid 的视频 item 走 UPSERT）
- `vault.queryPersons()` 数量不变
- events 表可以累积（每次 browse 是新事件，design 如此）
- 子进程日志中 originalId 在 raw_events 表里有 dedup

### 场景 7 — EncryptedSharedPreferences keystore corruption

**设定**: 模拟 keystore 损坏（极少见，但 OS 升级时可能发生）

**步骤**:
1. `adb shell` 进 app data dir，备份当前 `pdh_social_bilibili.xml`
2. 手动改 xml 文件让 AES-256-GCM 解密失败（改一个 byte）
3. 重启 app，进 PDH 本机数据 tab

**断言**:
- App 不 crash
- Bilibili 卡片状态显 "未登录"（store catch Throwable 兜底）
- Timber log 含 "BilibiliCredentialsStore: read failed"
- 用户能重新登录恢复

### 场景 8 — 退出登录 + 重新登录

**步骤**:
1. 已登录状态点 "退出登录"
2. 卡片立即状态变 "未登录"
3. 点 "登录" 进 WebView
4. 重新登录同一账号
5. 同步

**断言**:
- 退出后 EncryptedSharedPreferences 中 cookie/uid 字段被 clear
- 重新登录后 uid 同上次（同账号）
- 同步成功

## 执行方式

- **手动**: 按上面 8 场景逐一跑，每个 ~5-10 分钟，总 ~1.5h
- **自动化**: 暂不可（Bilibili 登录需要人验证码/扫码，不能 instrument）
- **CI**: `connectedAndroidTest` 仅跑非真账号场景（场景 4 + 8 + 7 + 部分 6）；真账号场景需手动

## stub 占位

`androidTest/.../A8BilibiliE2ETest.kt` 8 个测试方法已 `@Ignore` 占位，每个含 TODO 链接到本计划对应章节。等真机测试时 unignore 跑。

## 不在本 plan 范围

- 微博 / 抖音 / 小红书 — v0.2 单独写 plan
- WBI 签名 — 当前不需要；如 Bilibili 收紧再补
- 性能（同步时长 / 内存） — 单独 perf plan
- 并发同步（system-data + bilibili 同时点）— globalSyncingAdapter 互斥已防，不再 E2E

## 关联文档

- `docs/design/Personal_Data_Hub_Android_Standalone_Cc.md` — Plan A v0.1 主架构
- `docs/design/Adapter_Social_Cookie.md` — A8 通用设计
- memory `pdh_a8_social_adapters_landing.md` — implementation 落地记录 + 7 traps
