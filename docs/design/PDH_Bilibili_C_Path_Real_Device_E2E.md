# PDH Bilibili C 路径真机 E2E checklist

> 状态: v1 (Phase 1e, 2026-05-25)
> Phase 1 收口动作 — Phase 1a-1d 全部 land 后，user 在真机上验证全链路
> 关联: [[pdh-bilibili-c-path-phase-1a]] / [[pdh-multipath-phase-b0-scaffold]]
> 方案: `docs/design/PDH_Social_Multipath_Local_Collection_Plan.md` §6.4

## 0. 这是什么 / 为什么手动跑

Phase 1a-1d 已经把 Bilibili C 路径（PC + ADB → 桌面端调 api.bilibili.com）的全链路代码 + 测试 + 三入口 UI 都 ship 了。但**单元测试只覆盖到 mock bridge / mock fetch 一级**，真正决定能不能 ship 的是：

1. **真 root Android 手机** + **真 Bilibili App** + **真账号 cookie** 端到端跑一遍
2. 验 4 个 endpoint 真返事件（而不是 `{code:0,data:[]}` 静默失败）
3. 验 9 typed reason banner 至少能命中 4 个常见路径（happy / no-root / not-installed / logged-out）

**Win 跑得动 — 推荐 Win 桌面优先** (user 用 Win 比较多)。我们代码已经 Win-friendly:
- `.replace(/\r+$/, "")` handle CRLF / `chcp 65001` UTF-8 / `maxBuffer: 32 * 1024 * 1024` / `encoding: "utf8"` explicit
- ADB Win 二进制行为跟 Mac/Linux 对齐 (Google 官方 Platform Tools ZIP 包)

Mac/Linux 同步骤可跑，只是 USB 驱动设置简单一些。**Win 跑通 ≠ Mac/Linux 必跑通**（MIUI/HyperOS FUSE SELinux trap 历史上在 Win adb 触发率低，bug 可能 latent）— 如果有 Mac/Linux 可跑就 cross-verify。

## 1. 准备清单 (Win 桌面优先)

| 项 | 验证命令 (PowerShell / cmd) |
|---|---|
| 桌面装好 Android Platform Tools（adb 在 PATH） | `adb version` 显示 ≥ 35.0 |
| Android 手机 Magisk-root（或 KernelSU / LineageOS 同等） | `adb shell su -c "id -u"` 返 `0` 或 `uid=0(...)` |
| Android 启 USB debugging + 授权 PC RSA fingerprint | `adb devices` 显示 device 状态 `device`（非 `unauthorized`） |
| Win 装小米 / OPPO / 华为等厂商 USB 驱动 | `adb devices` 命中（部分品牌 Win 不带原生驱动） |
| MIUI/HyperOS: 开 "USB 调试（安全设置）" 第二开关 | `adb shell pm list packages -3 \| Select-Object -First 3` 应返 ≥ 1 行 |
| 手机装 Bilibili 正式版 APK | `adb shell pm list packages tv.danmaku.bili` 命中 |
| Bilibili App 已登录账号 | 手机点开 Bilibili App 看到自己头像（不是登录页） |
| 项目 cc CLI 装好 (`cc serve` 能起来) | `cc --version` ≥ 0.16x（含 Phase 1c） |
| Terminal 中文编码 | `chcp 65001`（cc 自动做了，但 PowerShell 偶尔需手动） |

**Win-specific 易踩坑**:
- **小米 MIUI / HyperOS**: 必须开 "USB 调试（安全设置）" **第二个开关**，否则 `adb shell su -c "..."` 静默 silent 返空，user 看到的是 `BILIBILI_NO_ROOT`
- **USB Debugging 授权**: 第一次插 PC 弹窗必须勾「始终允许此电脑」
- **OEM 解锁**: OPPO / vivo Magisk root 需先申请解锁码 + 168 小时等待
- **小米 USB 驱动**: Win 自带不识别 fastboot，装 [MIUSB 官方驱动](https://www.miui.com/shouji/) 或 PdaNet Universal Driver

可选（多设备时）：`set ADB_SERIAL=<device-serial>` (cmd) 或 `$env:ADB_SERIAL = "<serial>"` (PowerShell) 选一台。

## 2. 三种入口任选其一

### 入口 A — `cc hub bilibili-adb-doctor` (推荐先跑 dry-run)

```bash
cc hub bilibili-adb-doctor
```

输出示例 (happy)：
```
✓ bilibili-adb-doctor: env ready to sync
  uid:                 1234567890
  cookies found:       5
  extracted at:        2026-05-25T08:30:21.000Z

  Next: run `cc hub bilibili-adb-sync` to ingest 4 endpoints.
```

如果 dry-run 不绿就别动同步。9 种 reason 的修复建议都在 inline tip 里。

### 入口 B — `cc hub bilibili-adb-sync` (CLI 实际同步)

```bash
cc hub bilibili-adb-sync
```

输出示例 (happy)：
```
✓ bilibili-adb-sync succeeded
  uid:        1234567890
  history:    30
  favourite:  5
  dynamic:    2
  follow:     5
  total:      42
  status:     ok
  events:     42
```

如果带反爬：
```
✓ bilibili-adb-sync succeeded
  uid:        1234567890
  history:    30
  favourite:  0
  dynamic:    0
  follow:     5
  total:      35
  ⚠ partial: lastErrorCode=-412 (anti-spider)
```

### 入口 C — Web Panel UI (`cc serve` + 浏览器 / desktop V6)

```bash
cc serve --port 8200
# 浏览器打开 http://localhost:8200，进入 PersonalDataHub 页
```

页面顶部 extra-bar 有两个按钮：
- "诊断 Bilibili ADB" → 调 `bilibiliAdbDoctor()` (dry-run)
- "通过 PC ADB 同步 Bilibili" → 调 `bilibiliAdbSync()` (实际同步)

成功/失败都通过 antd `message` notification 提示。9 种 reason 都有中文 banner 映射。

## 3. 6 个验证场景

### 场景 1 — Happy path (5 mins)

**前置**: 准备清单全绿 + Bilibili App 已登录
**操作**: 跑 `cc hub bilibili-adb-doctor` → 看 `✓ env ready` → 跑 `cc hub bilibili-adb-sync` → 看 `✓ succeeded`
**验证**:
```bash
cc hub query-events --adapter social-bilibili --limit 5
# 应返 5 个真账号的 events，含 kind in (history/favourite/dynamic/follow)
```
**通过条件**: vault 里写入 ≥ 30 个 events (history 通常 ≥ 30 因为 ps=30) + 至少 2 个 kind 命中

### 场景 2 — `BILIBILI_NO_ROOT` (1 min)

**前置**: 拿一台非 root 设备插上（或 Magisk denylist 加上 cc shell）
**操作**: 跑 `cc hub bilibili-adb-doctor`
**通过条件**: 输出 `✗ BILIBILI_NO_ROOT` + tip "phone needs Magisk root"

### 场景 3 — `BILIBILI_NOT_INSTALLED_OR_NEVER_LOGGED_IN` (1 min)

**前置**: root 手机但**没装** Bilibili App（或卸载/清数据后从未登录过）
**操作**: 跑 `cc hub bilibili-adb-doctor`
**通过条件**: 输出 `✗ BILIBILI_NOT_INSTALLED_OR_NEVER_LOGGED_IN` + tip "install Bilibili App + log in"

### 场景 4 — `BILIBILI_COOKIES_INCOMPLETE` (2 min)

**前置**: root 手机 + Bilibili App **已注销登录**（点头像 → 退出登录）
**操作**: 跑 `cc hub bilibili-adb-doctor`
**通过条件**: 输出 `✗ BILIBILI_COOKIES_INCOMPLETE` + tip "relog on the Bilibili App"
**预期**: 退登后 Cookies 文件还在但缺 `SESSDATA` (或 SESSDATA 为空字符串)

### 场景 5 — `BRIDGE_UNAVAILABLE` (1 min)

**前置**: 拔掉 USB（或 `export ADB_PATH=/nonexistent`）
**操作**: 跑 `cc hub bilibili-adb-doctor`
**通过条件**: 输出 `✗ BRIDGE_UNAVAILABLE` 或 `BILIBILI_NO_ROOT` (取决于 adb 阶段失败点) + tip "install Platform Tools"

### 场景 6 — Multi-device (2 min)

**前置**: 同时插 2 台 Android 设备 (或 1 台手机 + 1 个 emulator)
**操作**:
```bash
adb devices    # 看到 2 行 device
cc hub bilibili-adb-doctor   # 应失败 + tip 让 set ADB_SERIAL
export ADB_SERIAL=<具体 serial>
cc hub bilibili-adb-doctor   # 应成功
```
**通过条件**: 第一次失败带 "multiple devices attached" 错误，set serial 后成功

## 4. UI 入口 (PersonalDataHub.vue) 6 场景

跟 §3 一样的 6 场景，但走 Web UI：
1. 跑 `cc serve --port 8200`
2. 浏览器打开 PersonalDataHub 页
3. 每个场景设置好前置（root/notroot/installed/loggedout/usbplug/multidevice）
4. 点 "诊断" 按钮 → 看 antd notification
5. notification.content 应包含对应中文 banner (`bilibiliReasonMessage` 映射)

抓 desktop console (DevTools → Console) 看 ws 应有 `personal-data-hub.bilibili-adb-doctor.response` 帧。

## 5. 真账号数据抽样验证 (after 场景 1)

```bash
# 看 5 个 history
cc hub query-events --adapter social-bilibili --subtype history --limit 5

# 看收藏夹
cc hub query-events --adapter social-bilibili --subtype favourite --limit 5

# 看 dynamic 摘要
cc hub query-events --adapter social-bilibili --subtype dynamic --limit 3

# 看 follow list
cc hub query-events --adapter social-bilibili --subtype follow --limit 10

# 验最近一周事件
cc hub query-events --adapter social-bilibili \
  --since $(($(date +%s%3N) - 604800000)) \
  --limit 100
```

**抽样验证点**:
- BV-id 跟手机 Bilibili App 历史顺序大致一致
- 收藏夹的 folderName 是用户自己起的中文名
- follow 列表里能看到 uname 是真账号关注的 UP
- 没有出现 `(no title)` / `(unnamed)` 这种 placeholder 字面（说明 fallback 字段没被触发）

## 6. 反检测 / 反爬触发场景 (可选, 1 hour)

短时间内重复跑 `cc hub bilibili-adb-sync` ~10 次（间隔 < 30s），观察是否进入 `lastErrorCode=-412 / -352 / 401` 状态：

```bash
for i in {1..10}; do
  cc hub bilibili-adb-sync --limit-history 50
  sleep 5
done
```

**通过条件**: 至少 3 次成功 + 部分次进 partial-result (lastErrorCode != 0) — 这说明反爬抗性 OK 且 partial fallback 工作。如果 10 次全 fail，可能 buvid3 / WBI 漂移了，去 Android Kotlin BilibiliApiClient.kt 那边对照看是否需要 refresh。

## 7. 回归 trap 记录位置

如果 E2E 跑出真机才暴露的 bug，按下列顺序更新：

1. **memory** `pdh_bilibili_c_path_phase_1a.md` 在 "Phase 1e 真机踩坑" 区追加 entry
2. **handbook** `docs/internal/hidden-risk-traps.md` 加 #26+（如果是新的 silent-failure 模式）
3. **代码**: 修在 `packages/personal-data-hub/lib/adapters/social-bilibili-adb/` 对应文件
4. **测试**: 加 reproducer 到 `__tests__/adapters/social-bilibili-adb-*.test.js`
5. **同步 Android**: 如果 root cause 也在 Android Kotlin 那边（WBI/buvid3/HTTP shape），改 `android-app/.../pdh/social/bilibili/BilibiliApiClient.kt` 保持 byte-parity

## 8. 已知风险 / Phase 1f 待补

- **encrypted_value 加密 cookie 路径未支持** — Phase 1a `chromium-cookies-reader.js` 当前 skip 这些行并记 `_skippedEncryptedCount`。如果真机命中（Android 14+ 较新 Bilibili App + Keystore wrap），需要先攻 Android Keystore unwrap 才能继续。doctor 会显黄色 ⚠ encrypted rows 提示。
- **多设备 picker UI 缺失** — 当前 `pickDevice()` 在 0/多设备时让 user 手动 `export ADB_SERIAL`。UI 可以更友好（列设备让 user 点选）。推 Phase 1f。
- **WBI 签名漂移** — 64-index mixin table 是 Bilibili web 客户端固定的，但万一改了会让 4 endpoint 全静默返 `{code:0,data:[]}`。监控 lastErrorCode 频率，如果 -403 / -352 持续高，跟进 Android Kotlin 那边的 WBI fix 再同步过来。
- **Bilibili 卡 detail panel 缺失** — 当前 PDH UI 只有同步按钮，没有显示 last-sync / event 总数 / 按 kind 细分的卡 detail。推 Phase 1f。

---

跑完 E2E 后，**Phase 1 完整收口**，可以进 Phase 2 (Douyin B+C 双路径 — 明星案例 abrignoni DFIR 参考)。

## 附录：规范章节补全（v5.0.3.108）

> 本文为真机 E2E checklist。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文场景。

### 1. 概述

见正文头部。PDH Bilibili C 路径（cookie + HTTP）真机 E2E checklist（Phase 1e），跑通后 Phase 1 完整收口。

### 2. 核心特性

C 路径（cookie + 签名 + HTTP）；Win 优先；真机场景逐项勾选；trap 收口 memory。

### 3. 系统架构

见 `Adapter_Social_Cookie.md`（A8 通用）+ `Personal_Data_Hub_Architecture.md`。

### 4. 系统定位

PDH Bilibili C 路径的**真机 E2E 验收 checklist**。

### 5. 核心功能

见正文场景：登录 / cookie 采集 / 同步 / vault 落地。

### 6. 技术架构

cookie + HTTP；`cc hub` Bilibili adapter；本机 SQLCipher vault。

### 7. 系统特点

Win 优先；剩 Bilibili 卡 detail panel（last-sync / event 总数）推 Phase 1f。

### 8. 应用场景

Bilibili C 路径采集器发版前真机验收。

### 9. 竞品对比

C 路径 vs Mode B（`PDH_Bilibili_Mode_B_Real_Device_E2E.md`）。

### 10. 配置参考

cookie / 账号；Win-first 真机环境。

### 11. 性能指标

采集随数据量线性（见正文场景）。

### 12. 测试覆盖

本文即 E2E checklist；trap 收口 memory。

### 13. 安全考虑

cookie 高敏感；落盘经 SQLCipher 加密。

### 14. 故障排除

cookie 过期 / 签名漂移 → 见正文场景与 trap。

### 15. 关键文件

`cc hub` Bilibili adapter；PDH vault。

### 16. 使用示例

见正文真机执行步骤。

### 17. 相关文档

`Adapter_Social_Cookie.md`、`Personal_Data_Hub_Architecture.md`、`PDH_Douyin_Real_Device_E2E.md`（Phase 2）。
