# PDH Douyin 双路径真机 E2E checklist (Win 优先)

> 状态: v1 (Phase 2c, 2026-05-25)
> Phase 2 收口动作 — P2a (Node C 路径) + P2b (Kotlin B 路径) 全 land 后真机验证
> 关联: [[pdh-douyin-c-path-phase-2a]] / [[pdh-multipath-phase-b0-scaffold]]
> 方案: `docs/design/PDH_Social_Multipath_Local_Collection_Plan.md` §6.1

## 0. 这是什么 / 为什么手动跑

Phase 2a + 2b 把 Douyin 两条 root 路径全 ship 了：

  - **C 路径** (Phase 2a): PC + ADB 拉 `<uid>_im.db` cohort → Node 端 parse + 入 vault
  - **B 路径** (Phase 2b): Android in-APK root + SQLite 直读 (复用 B0 scaffold) → 写 staging JSON + 走 LocalCcRunner.syncAdapter 入 vault

**两路径产同 vault data** — 同 schema (schemaVersion=1)、同事件类型 (`message` + `contact`)、同 abrignoni DFIR 解析逻辑 (byte-parity 由 22 Node + 16 Kotlin = 38 测试守护)。User 选哪条路径取决于场景：

| 场景 | 推荐路径 |
|---|---|
| 手机插 USB 到 PC + 想在 PC 上看数据 | **C 路径**（`cc hub douyin-adb-sync`） |
| 手机离 PC + 只在手机本机用 | **B 路径**（HubLocalScreen — 待 P2d UI 整合）|
| 想避免 ADB 配置 / USB 驱动麻烦 | B 路径 |
| 想最快迭代 / 调试 | **C 路径**（Node iterate 比 build/install APK 快 100×） |

**Win 跑得动** — 我们代码已经 Win-friendly (CRLF / UTF-8 / chcp 65001 / maxBuffer 32MB / explicit utf8 encoding 全 handle 过了)。下面以 **Win 为主推路径**写步骤。Mac/Linux 同步骤 work，只是 USB 驱动设置简单一些。

## 1. 准备清单 (Win 桌面)

| 项 | 验证命令 (PowerShell / cmd) |
|---|---|
| Win 装好 Android Platform Tools | `adb version` ≥ 35.0 |
| 解压 platform-tools 加 PATH | `where adb` 显具体路径 |
| Android 手机 Magisk-root（或 KernelSU 同等）| `adb shell su -c "id -u"` 返 `0` 或 `uid=0(...)` |
| Win 装小米/OPPO/华为等厂商 USB 驱动 | `adb devices` 显示 device 状态非 `unauthorized` |
| USB debugging + USB 调试（安全设置）双开 | MIUI/HyperOS 特殊 — 不开第二个 `pm list packages` 返空 silent |
| 手机装抖音正式版 APK | `adb shell pm list packages com.ss.android.ugc.aweme` 命中 |
| 抖音 App 已登录 + 打开任一聊天会话 | 生成 `<uid>_im.db`（关键：不开聊天 db 不会被 Douyin 物化）|
| 项目 cc CLI 装好 (≥ Phase 2a) | `cc --version` 显示含 Phase 2a 的版本 |
| Terminal 中文编码 | `chcp 65001`（项目 ensure-utf8.js 自动做了，但 PowerShell 偶尔需手动） |

**Win-specific 易踩坑**：
- **小米 MIUI / HyperOS**: 必须开 "USB 调试（安全设置）" 第二开关，否则 `adb shell pm list packages` / `su -c` silent 返空
- **USB Debugging 授权弹窗**: 第一次插 PC 时手机会弹「允许 USB 调试？」，必须勾「始终允许此电脑」，否则下次插 USB 又要重弹
- **OEM 解锁**: 部分品牌 (OPPO / vivo) Magisk root 需先在网上申请解锁码，等待 168 小时
- **小米 USB 驱动**: Win 自带驱动不识别 fastboot，需装 [MIUSB 官方驱动](https://www.miui.com/shouji/) 或 [PdaNet Universal Driver](http://pdanet.co/install/)

## 2. C 路径 (PC + ADB) — 最常用入口

### 2.1 dry-run probe (推荐先跑 — 不动 vault)

```powershell
# Win PowerShell / cmd
cc hub douyin-adb-sync --json
```

**期望输出（happy）**:
```json
{
  "ok": true,
  "report": {
    "adapter": "social-douyin",
    "status": "ok",
    "rawCount": 12,
    "entityCounts": { "events": 12, "persons": 0, "places": 0, "items": 0, "topics": 0 },
    "douyin": {
      "uid": "1234567890123456789",
      "eventCounts": { "message": 10, "contact": 2, "total": 12 },
      "parserDiagnostic": {
        "hadMsgTable": true,
        "hadSimpleUserTable": true,
        "messageCount": 10,
        "contactCount": 2
      },
      "cleanupFailed": false
    }
  }
}
```

human 输出（不加 `--json`）:
```
✓ douyin-adb-sync succeeded
  uid:        1234567890123456789
  messages:   10
  contacts:   2
  total:      12
  status:     ok
  rawCount:   12
```

### 2.2 失败 reason → 修复 (5 类典型)

| reason | 修复 |
|---|---|
| `BRIDGE_UNAVAILABLE` | adb 未在 PATH — 装 platform-tools 或 set `ADB_PATH` 环境变量 |
| `DOUYIN_NO_ROOT` | 手机未 root — 装 Magisk + reboot |
| `DOUYIN_NOT_INSTALLED` | 装抖音 App，登录一次 |
| `DOUYIN_NO_IM_DB` | 抖音装了但未登录 / 未开聊天 — **抖音 App 内打开任一聊天会话物化 IM db**，然后重试 |
| `DOUYIN_MULTIPLE_USERS` | 同手机登多个抖音号 — 加 `--uid <19位数字>` 选一个 |
| `DOUYIN_PULL_FAILED` / `DOUYIN_NOT_SQLITE` | base64 stream 被 MIUI 干扰 — 拔插 USB 重试，或检查 `adb logcat` |

### 2.3 抽样验证真账号数据 (after 场景 §2.1 成功)

```powershell
# 看私信
cc hub query-events --adapter social-douyin --subtype message --limit 5

# 看联系人
cc hub query-events --adapter social-douyin --subtype contact --limit 5

# 看最近一周事件
cc hub query-events --adapter social-douyin --since (Get-Date -UFormat %s 7 days ago)
```

**通过条件**:
- `cc hub query-events --subtype message` 返回真账号的私信内容 (text 字段非空 / 含 Chinese / 联系人 nickname 命中)
- `cc hub query-events --subtype contact` 返回的 name 是用户真账号关注过的 UP / 互关朋友
- 没有出现 `(no text)` / placeholder 字面 (说明 contentBlob 提 text 正常)

## 3. B 路径 (Android in-APK root) — phone-only 场景

> **当前状态**: Kotlin 代码 ship 了 (Phase 2b)，但 HubLocalScreen UI 触发入口 **待 Phase 2d 整合**。本节描述 P2d UI 整合后的入口；现阶段 user 可走 P2a C 路径替代（同 vault data）。

### 3.1 准备 (跟 §1 一样的 Magisk root + 抖音登录 + 开聊天)

不需要 PC / ADB / USB（核心优势）。

### 3.2 在手机 HubLocalScreen 触发（P2d 待落地）

1. 打开 cc Android App
2. 进入 HubLocalScreen → 抖音卡
3. tap "本机 root 同步" 按钮（P2d 待加）
4. dialog 让 user 输入 19 位 uid（暂时手动输入；P2d+ 可加 auto-discover from `ls databases/`）
5. 进入 sync 状态 → DouyinRootDbCollector.snapshot() 在 background 跑
6. 成功 → 红点消失 + 提示 "已同步 N 条私信 + M 个联系人"
7. 失败 → 弹 banner 带 reason 文案

### 3.3 命令行验证 (跟 §2.3 同) — phone-only 场景下用 cc Android 内 terminal 跑

```bash
# 手机 cc Android 内 terminal 跑 (need Phase 2.5 Local Terminal land)
cc hub query-events --adapter social-douyin --limit 5
```

## 4. 6 个验证场景 (跟 §2 一样 reason 但场景化)

### 场景 1 — Happy path C 路径 (5 min)

跟 §2.1-§2.3 完整跑一遍 ≥ 30 条 events。

### 场景 2 — `DOUYIN_NO_ROOT` (1 min)

非 root 手机插上跑 → 看到 NO_ROOT banner + Magisk 安装提示。

### 场景 3 — `DOUYIN_NOT_INSTALLED` (1 min)

卸载抖音 App 跑 → 看到 NOT_INSTALLED banner。

### 场景 4 — `DOUYIN_NO_IM_DB` (2 min)

装了抖音但从未登录 / 未开聊天跑 → 看到 NO_IM_DB banner + "登录 + 开聊天" tip。

**变体**: 已登录但**没开过任何聊天**也会触发 — 这是真实场景里最容易漏的，要 explicit 测。

### 场景 5 — `DOUYIN_MULTIPLE_USERS` (2 min)

同手机登录 2 个抖音账号（第二账号需要在 App 内手动添加 + 切换一次让 IM db 物化）→ 不加 `--uid` 跑 → 看到 MULTIPLE_USERS banner + uid 列表。

```powershell
cc hub douyin-adb-sync --uid 9876543210987654321  # 选第二账号
```

### 场景 6 — Win MIUI silent failure 验证 (3 min) — Win 重要场景

**前置**：小米/红米手机 MIUI 14+

1. **关掉** "USB 调试（安全设置）" 开关
2. 跑 `cc hub douyin-adb-sync`
3. **可能现象**：
   - `BRIDGE_UNAVAILABLE` — adb 直接连不上（最理想，user 立刻知道）
   - `DOUYIN_PULL_FAILED` — adb 连上但 `su -c base64` silent 失败（MIUI 安全设置拦截）
   - 部分成功 — pull 一部分 db 但 SHA mismatch 或 truncated

**修复**: 开第二开关后重试。

## 5. 真账号数据抽样深验 (after happy path)

跟 Bilibili E2E doc §5 同模板，但 Douyin specific:

```powershell
# 看最近 24h 收到的私信
cc hub query-events --adapter social-douyin --subtype message `
  --since (Get-Date -UFormat %s -Date (Get-Date).AddDays(-1))

# 看互关好友列表 (follow_status=2)
cc hub query-events --adapter social-douyin --subtype contact --limit 100 `
  | grep '"followStatus":2'

# 看自己发出的私信（senderUid == DB filename uid）
cc hub query-events --adapter social-douyin --subtype message --limit 100 `
  | grep '"senderUid":"<your-19-digit-uid>"'
```

**抽样验证点**:
- 私信 text 字段含真账号会话中的中文 / 表情符号
- 收发方区分正确 (自己发的 senderUid == 自己 uid)
- 联系人 name 字段是真账号好友的中文 nickname
- followStatus 取值 0/1/2 (none/following/mutual) 与抖音 App 内一致

## 6. 反检测 / 反爬触发 (Douyin 特有)

抖音对 db 直读路径**不触发反爬**（我们没碰 HTTP API），但 *如果* 真机后续被 `libmsaoaidsec.so` 检测到我们的 cc Android App 异常进程行为：

1. cc App 不会 crash（我们不 attach 抖音进程）
2. 抖音 App 可能短暂封号 / 风控（极少见但有报告）

**缓解**: 如果 user 报告抖音 App 收到 "异常登录" 提示，立刻：
- 卸载 cc App
- 退出抖音重登
- 等 24h 再用

## 7. 回归 trap 记录位置

跟 Bilibili E2E §7 同模板：
1. memory `pdh_douyin_c_path_phase_2a.md` 加 "Phase 2c 真机踩坑" 区
2. handbook `docs/internal/hidden-risk-traps.md` 加 #26+（如新 silent failure 模式）
3. 代码: `packages/personal-data-hub/lib/adapters/social-douyin-adb/` (C 路径) + `android-app/.../pdh/social/douyin/Douyin*Root*.kt` (B 路径)
4. 测试: P2a Node `__tests__/adapters/social-douyin-adb-*.test.js` + P2b Kotlin `pdh/social/douyin/Douyin*Test.kt`
5. **byte-parity check**: 任何 root cause fix 必须**两边同改** — Node parser 跟 Kotlin parser 同 schema-drift handling / 同 epoch normalize / 同 content JSON 提逻辑。一边改一边不改就是回归。

## 8. 已知风险 / Phase 2d+ 待补

- **HubLocalScreen B 路径 UI 整合**: P2b Kotlin 代码 ship 了但 phone-only UI 触发入口待 Phase 2d。现阶段 user 走 P2a C 路径 替代（同 vault data）
- **uid auto-discovery**: 现在 P2a C 路径 `cc hub douyin-adb-sync` 自动 ls databases/ 但 P2b Kotlin B 路径需 user 手动输 uid (P2d UI 可补 auto-discover)
- **多账号支持**: P2a `--uid` 是手动选；P2d 可加 UI dropdown 列设备所有抖音账号
- **`libmsaoaidsec.so` 风险监控**: 长期 user 反馈是否触发抖音风控，决定是否需要绕过措施
- **抖音 db schema 漂移**: defensive column picker 已 land，但若抖音改 db 文件名 (`<uid>_im.db` → 其他) 需要更新 IM_DB_PATTERN 正则

---

跑完 E2E 后 + 找到的 trap 都收口到 memory，**Phase 2 完整收口**，下一段 Phase 3 (Weibo C + Xhs A 加固) 或 Phase 6 (defer Weibo/Xhs/Toutiao/Kuaishou B 路径)。
