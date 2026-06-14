# Phase 12.10.7 — Android WeChat 反检测加固设计

> **范围**: 从 Phase 12.10.6 §12.10.6.8 长稳跑反检测 fail 时 (WeChat 弹"环境异常" / 自杀进程 / 静默拒密钥写入)，按本文档对应表项加固。**首次实施推荐 §3 Magisk DenyList 配置** + **§4 frida-inject 改名/进程隐藏** 双管齐下。
>
> **状态**: v0.1 (2026-05-22)，设计 only — 真验需 §Phase 12.10.6.8 触发 fail 后才知道当前 WeChat 反检测命中的是哪条。**这是猫鼠游戏文档**: WeChat 每个大版本可能加新反检测，我们这边每个失效就追一次。
>
> **谁该读**: Phase 12.10.6.8 fail 后 / 计划 ship 给非技术用户 (用户不会自己配 Magisk DenyList) / WeChat 出新版后 sanity 复检。

---

## 1. 已知 WeChat 反检测向量 (基于 sjqz + 公开 RE 资料)

| # | 检测点 | 触发位置 | 命中后果 |
|---|---|---|---|
| 1 | `/proc/self/maps` 含 `frida`/`libgum` 字符串 | WeChat 启动 + 周期性 (每 5 min) | 弹"环境异常" + 1-2s 自杀 |
| 2 | `/proc/<wechat-pid>/task/*/maps` 同上 | 同上 | 同上 |
| 3 | 进程列表 (`ls /proc | grep [0-9]+`) 含 `frida-server`/`frida-inject` | 同上 | 同上 |
| 4 | `/system/xbin/su` 存在 + 可读 (没 Magisk DenyList 时) | WeChat 启动 | 弹"建议关闭 root" toast / 部分功能禁用 |
| 5 | ptrace 状态 (`/proc/self/status` `TracerPid != 0`) | 周期性 | hook 失效 (SIGSTOP 自身) |
| 6 | libWCDB.so 内部 `Interceptor.attach` 痕迹检测 (vtable / GOT) | DB open 时 | 改写 SQLCipher key → 旧 key 不再解密新写入 |
| 7 | DenyList 检测 (`getStorageVolume()` 看是否伪装) | WeChat 启动 | 部分启用反 hook 路径 |
| 8 | SafetyNet / Play Integrity (近年新加) | 启动 + 关键操作 | 部分网络功能禁用 (登录无影响，msg 同步有时受波及) |

---

## 2. 我们的应对总览 (按命中可能性排序)

| 优先级 | 应对 | 文件 / 配置 | 工时 |
|---|---|---|---|
| **P0** | Magisk Zygisk + DenyList(`com.tencent.mm`) — 抹掉向量 1-4 + 7 | 用户运行时配置 | 5 min 一次性 |
| **P0** | frida-inject 二进制改名 + tmp 路径随机 | `WeChatFridaInjector.kt` | 0.5d |
| **P0** | frida-inject 一启就杀 (≤ 5s 全过) — 抹掉向量 3 长尾 | 同上 | 已在 v0.1 设计里 |
| **P1** | frida agent 自己用 `Memory.protect()` 隐藏 hook page — 抹掉向量 6 | `wechat-key-hook.js` | 1d |
| **P1** | 改 `frida-magisk` patch (上游 frida 项目维护) — 抹掉向量 1 + 5 | external dep | 用上游版本即可 |
| **P2** | hook 完立刻 chmod 600 binary + delete on exit | `WeChatFridaInjector.kt` | 0.2d |
| **P3** | Play Integrity bypass (e.g. Tricky Store module) | 用户运行时配置 | 5 min 一次性 |

---

## 3. P0 — Magisk DenyList 配置 (用户侧)

最便宜也最有效的应对 — DenyList 让 WeChat 启动时看到的是"无 root + 无 Zygisk"环境。**v0.2 UI 必须强制引导**。

### 3.1 用户操作 (UI 引导文案)

WechatUinEntryDialog 加一个 step "前置 - Magisk 配置确认":

```
□ 已打开 Magisk app → 设置 → "Zygisk" → 已启用
□ 已在 Magisk app → 超级用户 → "ChainlessChain" 设为"允许"
□ 已在 Magisk app → 排除列表 (DenyList) → 勾选 "微信 com.tencent.mm"
□ 已 force-stop 一次 WeChat → 重新打开 (生效 DenyList 必须重启 WeChat)
```

未全勾不允许进 "绑定" 按钮。

### 3.2 程序化检测 (`WeChatFridaInjector.kt`)

```kotlin
suspend fun preflight(): PreflightResult = withContext(Dispatchers.IO) {
    // 1. su available + uid=0
    val uidResult = runSu("id -u")
    if (uidResult.exitCode != 0 || uidResult.stdout.trim() != "0") {
        return@withContext PreflightResult.NoRoot
    }

    // 2. Zygisk on (Magisk 25+)
    val zygiskStatus = runSu("magisk --denylist status")
    if (!zygiskStatus.stdout.contains("Zygisk:") || !zygiskStatus.stdout.contains("enabled")) {
        return@withContext PreflightResult.ZygiskOff
    }

    // 3. com.tencent.mm 在 DenyList
    val denylist = runSu("magisk --denylist ls")
    if (!denylist.stdout.contains("com.tencent.mm")) {
        return@withContext PreflightResult.WeChatNotInDenyList
    }

    PreflightResult.Ok
}

sealed class PreflightResult {
    object Ok : PreflightResult()
    object NoRoot : PreflightResult()
    object ZygiskOff : PreflightResult()
    object WeChatNotInDenyList : PreflightResult()
}
```

UI 在 `extractKey` 前调一次，把 `ZygiskOff` / `WeChatNotInDenyList` 渲为 actionable banner (链 Magisk 设置 deep-link via `magisk://app/zygisk` if 存在该 intent，否则纯文字步骤)。

---

## 4. P0 — frida-inject 二进制改名 + 路径随机

WeChat 反检测扫 `/proc/<wechat-pid>/maps` 含 `frida` 字符串。我们的二进制叫 `frida-inject` 被自动命中。改名是必需的。

### 4.1 命名策略

```kotlin
companion object {
    // 不能用任何 frida / gum 子字符串。同时不能写死，避免 WeChat 加这串到 blocklist。
    // 派生策略: SHA-1(packageName + installTime) 前 12 char → 看起来像普通 hash 文件。
    fun deriveTempBinaryName(context: Context): String {
        val packageInfo = context.packageManager.getPackageInfo(context.packageName, 0)
        val seed = "${context.packageName}-${packageInfo.firstInstallTime}"
        val hash = MessageDigest.getInstance("SHA-1").digest(seed.toByteArray()).take(6)
        val hex = hash.joinToString("") { "%02x".format(it) }
        return "cc-helper-$hex"
    }
}
```

落地路径: `/data/local/tmp/cc-helper-<hex>` (不是 `/data/local/tmp/frida-inject`)。

**Note**: 别用 `.` 前缀 (`/data/local/tmp/.frida-inject`) — Magisk 反检测扫描会展开 dotfile。

### 4.2 内嵌 ELF section 字符串清理

frida-inject 二进制内部 `.rodata` section 含 `frida-` 字符串 (frida.version / debug strings)。WeChat 反检测有时 `mmap` + grep。**v0.2 ship 时必须 strip + replace**:

```bash
# Mac/Linux build pipeline (Phase 12.10.4 prep step)
# strip debug symbols
strip --strip-unneeded frida-inject-arm64
# blank out version string (16-char random replace)
sed -i 's/frida-core-16.5.9/cc-helper-runtime-x9/g' frida-inject-arm64
```

CI step (release.yml build-android 加):
```yaml
- name: Strip frida-inject anti-detection
  run: |
    cd android-app/app/src/main/assets/frida
    strip --strip-unneeded frida-inject-arm64 frida-inject-arm 2>/dev/null || true
    # version-string scrub: NOP-out any sub-string identical to "frida"
    perl -i -pe 's/frida/xxxxx/g' frida-inject-arm64 frida-inject-arm
    # post-scrub sanity: ensure no "frida" literal remains
    if strings frida-inject-arm64 | grep -i frida; then
      echo "::error::frida string still in arm64 binary after scrub" && exit 1
    fi
```

**Trap**: `perl -i -pe s/frida/xxxxx/g` 在 ELF 二进制里也会替换 — 风险是替换到机器码偏移导致 binary 损坏。`strings | grep` 完取出真正的字符串先用 `dd seek=` 精准 patch 更安全；上面 perl 一步快但要 CI 复检。

### 4.3 一启就杀

`WeChatFridaInjector.extractKey()` 收到首条 `kind:"key"` event 就立刻 `process.destroyForcibly()`。当前 v0.1 设计已是这样。**追加**: 在 finally 块 unlink 临时二进制:

```kotlin
try {
    // ... spawn + parse stdout ...
} finally {
    runSu("rm -f $tempBinaryPath $tempScriptPath")
}
```

WeChat 反检测周期性扫 /proc — 我们存活窗口 ≤ 5s + binary 已 unlink → 大幅减少命中概率。

---

## 5. P1 — frida agent 隐藏 hook page

frida `Interceptor.attach` 在 target 进程 GOT / vtable / inline-hook trampoline 留痕。WeChat 8.0.50+ 据 sjqz 观察 加了 `JNI_OnLoad` 时校验 libWCDB.so 的 sqlite3_key_v2 GOT entry是否还指原 ELF。

**对策**: 在 `wechat-key-hook.js` `Interceptor.attach` 之后立刻 `Memory.protect(addr, 16, "r-x")` 把 trampoline page 改回 r-x 并 dump → restore，让 WeChat 那次校验通过。但这是 frida agent 高级用法，**v0.2 先不上**；等 §12.10.6.8 fail 才追。

参考: https://frida.re/docs/javascript-api/#interceptor `Interceptor.flush()` + `Memory.protect()`。

---

## 6. 验证

每加一项加固，回 Phase 12.10.6.8 跑 2h 长稳:
- 加固前: 触发 WeChat 弹窗的次数 / WeChat 自杀次数
- 加固后: 同样指标

PASS 标准: 2h 内 0 弹窗 + 0 自杀。

---

## 7. 风险 + 限制

| 风险 | 说明 |
|---|---|
| **猫鼠游戏** | WeChat 每出大版本可能新加反检测；本文档每次 sanity 复检 + 追加 §1 表项 |
| **CI strip 误伤** | §4.2 sed/perl 对 ELF section 改字符串可能破坏 binary；CI 必加 sanity (binary 能 `./frida-inject --version` 跑成) |
| **DenyList 用户教育成本** | §3.1 4-step UI checklist 是 v0.2 体验下限；可考虑 deep-link 自动跳 Magisk 配置 |
| **Play Integrity bypass 不能写进 APK** | §2 P3 是用户运行时事，APK 不能内嵌 (违反 Google 服务条款) |

---

## 8. 相关

- [`Android_WeChat_InApp_Frida_Collector.md`](./Android_WeChat_InApp_Frida_Collector.md) §6.2 — 已有反检测风险概述
- [`Android_WeChat_Phase_12_10_6_RealDevice_E2E_Runbook.md`](./Android_WeChat_Phase_12_10_6_RealDevice_E2E_Runbook.md) §12.10.6.8 — 长稳测试用本文档作为 fail 排查指南
- [`Adapter_WeChat_SQLCipher.md`](./Adapter_WeChat_SQLCipher.md) §18.6 — 桌面侧等同反检测设计 (frida-server 而非 frida-inject — 用户侧 ssh)
- Memory `android_wechat_collector_phase_12_10.md` Trap 7 — 反检测 P0+P1 提要
- Memory `wechat_frida_hook_audit_traps.md` — JS hook 3 audit trap (与本文档 §5 hook 隐藏正交)

## 附录：规范章节补全（v5.0.3.108）

> 本文为反检测加固设计（猫鼠游戏文档）。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述

见正文「范围」。Phase 12.10.7 Android WeChat 反检测加固：当 §12.10.6.8 长稳跑反检测 fail（微信弹"环境异常" / 自杀进程 / 静默拒密钥写入）时，按本文加固；首推 Magisk DenyList + frida-inject 改名/进程隐藏双管齐下。

### 2. 核心特性

已知反检测向量梳理；按命中可能性排序的应对；P0 Magisk DenyList + frida-inject 改名 + P1 agent hook page 隐藏。

### 3. 系统架构

见正文「2. 应对总览」；与 `Adapter_WeChat_SQLCipher.md` §18.6 桌面侧反检测对应（frida-server vs frida-inject）。

### 4. 系统定位

Android 微信采集的**反检测加固设计**（Phase 12.10.7，fail 时按表加固）。

### 5. 核心功能

见正文 1–6：已知向量 / 应对总览 / Magisk DenyList / frida-inject 改名路径随机 / agent hook page 隐藏 / 验证。

### 6. 技术架构

Magisk DenyList（用户侧）；frida-inject 二进制改名 + 路径随机；frida agent hook page 隐藏。

### 7. 系统特点

猫鼠游戏文档——微信每大版本可能加新反检测，每次失效追一次；设计 only，真验需 fail 触发后才知命中项。

### 8. 应用场景

长稳反检测 fail 后的加固应对。

### 9. 竞品对比

桌面侧 frida-server + ssh 路径（`Adapter_WeChat_SQLCipher.md` §18.6）vs 移动端 frida-inject。

### 10. 配置参考

见正文 3「Magisk DenyList 配置」与 4「frida-inject 改名 + 路径随机」。

### 11. 性能指标

加固对采集成功率的影响（长稳验证）。

### 12. 测试覆盖

见正文 6「验证」；触发条件为 Phase 12.10.6.8 长稳 fail。

### 13. 安全考虑

加固本身是绕过微信环境检测；仅本机自用；见正文 7「风险 + 限制」。

### 14. 故障排除

本文即 §12.10.6.8 fail 的排查指南（按命中向量对应表项加固）。

### 15. 关键文件

frida-inject 二进制；Magisk DenyList 配置；frida agent。

### 16. 使用示例

见正文 3/4 P0 加固配置步骤。

### 17. 相关文档

见正文「8. 相关」：`Android_WeChat_InApp_Frida_Collector.md` §6.2、`Android_WeChat_Phase_12_10_6_RealDevice_E2E_Runbook.md` §12.10.6.8、`Adapter_WeChat_SQLCipher.md` §18.6。
