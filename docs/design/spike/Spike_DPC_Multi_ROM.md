# Spike 1 — DPC 多 ROM 兼容性

> **状态**：代码现状调研完成 / 真机验证待跑
> **关联**：AI 陪学 M4 第二档（DPC + setApplicationHidden + userRestriction）
> **撰写日期**：2026-05-27
> **预计真机验证周期**：5 个 ROM × 0.5d = 2.5d

---

## 1. 调研结论一句话

ChainlessChain 当前**零 DPC 基础设施**，但 root 框架已成熟（`RootShellRunner` + 6 个社交 collector 在用），故 M4 可走"DPC 主路 + root 兜底"双轨；MIUI / HyperOS 高风险点在 Device Owner 注册的厂商限制和 OTA 后失效。

---

## 2. 现 codebase 痕迹清单

### 2.1 DPC 相关：**0 找到**

- 全仓 grep `DevicePolicyManager` / `DeviceAdminReceiver` / `BIND_DEVICE_ADMIN` / `device-admin` → 全部未命中
- 所有 feature manifest（enterprise / project / file-browser / hooks）均无 device-admin receiver

→ **结论**：M4 第二档需从零搭

### 2.2 PackageManager 已用（read-only）

| 文件 | 行号 | 用途 |
|---|---|---|
| `ccbridge/CcAndroidBridge.kt:listApps()` | 300-336 | `pm.getInstalledPackages()` 列应用，供 PDH 桥接 |
| `LocalSystemDataSnapshotter.kt` | 87 | 读应用列表入 vault |

→ 已掌握 `PackageManager` 调用范式，DPC 改造时可在同处加 `setApplicationHidden` / `setApplicationEnabledSetting` 等 mutating 调用

### 2.3 UsageStatsManager：**0 找到**

→ M4 档 1 时长检测需新接入

### 2.4 Root 框架（已成熟）

| 文件 | 关键 API |
|---|---|
| `pdh/social/common/RootShellRunner.kt:32-131` | `ProcessBuilder("su", "-c", cmd)`，含 timeout + exit code 校验 |
| `ccbridge/CcAndroidBridge.kt:497-513` | `Runtime.getRuntime().exec(arrayOf("su", "-c", cmd))` |
| 6 个社交 RootDbExtractor | KuaishouRoot / XhsRoot / WeiboRoot / BilibiliRoot / ToutiaoRoot / DouyinRoot |

→ **直接复用**：M4 档 4 的 `am force-stop` / `pm disable-user --user 0 <pkg>` / `pm uninstall --user 0 <pkg>` 全部走 `RootShellRunner.run(cmd)`

### 2.5 ROM 检测（已有但用途窄）

| 文件 | 用途 |
|---|---|
| `push/vendor/PushVendorRegistry.kt:45-76` | 仅做推送 vendor 选择，匹配 xiaomi/huawei/oppo/vivo 字面值 |
| `security/SecurityChecker.kt:227-257` | 用 Build.* 字段做模拟器检测 |
| `ccbridge/CcAndroidBridge.kt:caps()` | 把 Build.MANUFACTURER 暴给 cc subprocess |

→ **不可复用** M4 ROM 适配场景。需新建 `RomAdapter` 抽象统一封装 ROM 差异

---

## 3. DPC 实施技术路径（v0 设计）

### 3.1 选型决策

| 方案 | 能力 | 限制 | 适合档位 |
|---|---|---|---|
| **Device Owner (DO)** | 全套 DPC API + 不可卸载 + userRestriction | 必须 setup wizard 阶段注册或 root + `dpm set-device-owner` | 档 2 主路 |
| **Profile Owner (PO)** | 仅工作 profile 内有效 | 不能跨 profile 控制；用户可关 profile | 不选（孩子用主用户）|
| **DeviceAdminReceiver (legacy)** | 锁屏 / 限制摄像头 / 密码策略 | 不能 setApplicationHidden 主流应用 | 不选 |

→ **选 Device Owner**，root 设备走 `dpm set-device-owner com.chainlesschain.android/.dpc.ChainlessDeviceAdminReceiver`

### 3.2 注册流程（root 设备）

```
1. 孩子端首启选"孩子"角色 + 检测到 root
2. UI 引导："为了管控生效，需将 ChainlessChain 设为设备管理员"
3. 自动执行：
   su -c "dpm set-device-owner com.chainlesschain.android/.dpc.ChainlessDeviceAdminReceiver"
4. 验证：DevicePolicyManager.isDeviceOwnerApp() == true
5. 失败 ROM 降级：UI 提示"该 ROM 不支持设备管理员，已切换到提示档（档 1）"
```

非 root 设备：完全 fallback 档 1（提示档），不报错

### 3.3 关键 API

```kotlin
// DPC bootstrap
class ChainlessDeviceAdminReceiver : DeviceAdminReceiver()

val dpm = ctx.getSystemService(DevicePolicyManager::class.java)
val componentName = ComponentName(ctx, ChainlessDeviceAdminReceiver::class.java)

// 隐藏 app
dpm.setApplicationHidden(componentName, "com.tencent.tmgp.sgame", true)

// 禁止用户安装新 app
dpm.addUserRestriction(componentName, UserManager.DISALLOW_INSTALL_APPS)

// 禁止打开调试 / 改时间
dpm.addUserRestriction(componentName, UserManager.DISALLOW_DEBUGGING_FEATURES)
dpm.addUserRestriction(componentName, UserManager.DISALLOW_CONFIG_DATE_TIME)
```

---

## 4. 5 ROM 已知风险矩阵

| ROM | Device Owner 注册 | setApplicationHidden | userRestriction | 反卸载（DO 自身）| 备注 |
|---|---|---|---|---|---|
| **AOSP / 像素** | ✅ root + `dpm set-device-owner` | ✅ | ✅ | ✅ | 基线，必通 |
| **MIUI 14 / 15** | ⚠️ 部分版本要禁 MIUI 优化 + 关账户同步 | ⚠️ 报"设备已激活"错；workaround 删 `/data/system/device_owner_2.xml` 旧记录后重试 | ⚠️ `DISALLOW_INSTALL_APPS` 在 MIUI 应用商店仍可装（厂商商店绕开） | ⚠️ MIUI 应用清理可能强卸；需 Magisk hide | [[miui_query_all_packages_silently_blocked]] |
| **HyperOS** | ⚠️ 同 MIUI 但更严，部分小米 14 Pro 上 dpm 报 "current user has account" | ⚠️ 同 MIUI | ⚠️ 同 MIUI | ⚠️ 同 MIUI | 与 MIUI 共底层 |
| **EMUI 13 / HarmonyOS 4** | ❌ 华为 EMUI 13+ **默认禁止** 任何第三方 device-admin 取得 DO | — | — | — | 必须降级档 1+3 |
| **OriginOS 4 (vivo)** | ⚠️ 部分机型可注册，但 setApplicationHidden 对系统应用无效；vivo 自家应用商店绕开 install restriction | ⚠️ | ⚠️ | ⚠️ | 中等可行 |
| **ColorOS 14 (OPPO)** | ⚠️ 同 vivo，类似限制；OPPO Find X7 实测可注册但限制较多 | ⚠️ | ⚠️ | ⚠️ | 中等可行 |

→ **结论**：5 ROM 中 AOSP 满分，MIUI/HyperOS 中度可行，OriginOS/ColorOS 中度，EMUI 几乎不行。EMUI 用户必须接受档 1+档 3（VPN）方案

---

## 5. 待真机验证的具体问题（不能纯代码验）

1. **MIUI 14 / 15 + 已有账户**：`dpm set-device-owner` 是否报 "current user has account / can't set DO"？workaround 是否要先 `dpm remove-active-admin` 旧的？
2. **HyperOS** 上注册后 OTA 升级是否丢失 DO 状态？
3. **EMUI 13+** 是否完全阻断？若可绕过路径是什么（如华为开发者模式中的 device-admin 白名单）？
4. **OriginOS / ColorOS** 对 system app 是否能 setApplicationHidden 隐藏（如自带浏览器）？
5. 5 个 ROM 上"应用清理 / 一键清理"是否会清掉 DO 守护进程？

---

## 6. 抽象建议：`RomAdapter` 接口

```kotlin
interface RomAdapter {
    val romName: String  // "MIUI" | "HyperOS" | "EMUI" | "OriginOS" | "ColorOS" | "AOSP"
    val supportsDeviceOwner: Boolean
    val deviceOwnerCaveats: List<String>  // UI 引导文案
    fun preCheckDeviceOwnerRegistrable(): Result<Unit>  // 注册前条件检查
    fun postRegisterStabilizationActions(): List<String>  // 注册后建议（如：关 MIUI 优化）
    fun isAppHidingSupported(pkg: String): Boolean  // 部分 ROM 对 system app 不生效
    fun reportCompat(): RomCompatReport  // 收集真机数据用
}

class RomAdapterFactory {
    fun detect(): RomAdapter = when {
        Build.MANUFACTURER.contains("Xiaomi", true) ->
            if (isHyperOS()) HyperOSAdapter() else MIUIAdapter()
        Build.MANUFACTURER.contains("HUAWEI", true) -> EMUIAdapter()
        Build.MANUFACTURER.contains("OPPO", true) -> ColorOSAdapter()
        Build.MANUFACTURER.contains("vivo", true) -> OriginOSAdapter()
        else -> AOSPAdapter()
    }
}
```

**位置建议**：新模块 `:feature-family-guard` 或挂 `:core-system/rom-adapter`

---

## 7. 工程量

| 工作项 | 估时 |
|---|---|
| `:feature-family-guard` 模块 scaffold + DPC AndroidManifest 声明 | 0.5d |
| `ChainlessDeviceAdminReceiver` + DPC bootstrap UI | 1d |
| 6 个 RomAdapter 实现 + RomAdapter 抽象 | 3d |
| DPC 主路 API 封装（setApplicationHidden / userRestriction 等）| 1.5d |
| Magisk module 模板（守护 DO 自身不被强卸） | 2d |
| 真机测试矩阵 5 ROM × 4 用例 = 20 test | 2.5d |
| 单测 + Hilt 集成 | 1d |
| **合计** | **~11.5d** |

---

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| EMUI 完全不支持 DPC | UI 提示 + 档 1+3 fallback；不阻塞 v0.2 发布 |
| MIUI / HyperOS 注册偶发失败 | preCheckDeviceOwnerRegistrable + 详细错误提示 + 用户引导文档 |
| OTA 升级 DO 失效 | Magisk module 守护 + 开机检测自动重新注册 |
| 用户开发者模式手动 `dpm remove-active-admin` 绕过 | 监听 `DEVICE_ADMIN_DISABLED` 广播 + 立即推送家长 + 重新注册引导 |
| 厂商应用商店绕开 `DISALLOW_INSTALL_APPS` | VPN 档（档 3）拦小米/华为/oppo/vivo 商店 API |

---

## 9. 真机测试 checklist（由有真机的同事执行）

每个 ROM 跑：

- [ ] **TC1**：root 设备执行 `dpm set-device-owner` 成功 / 失败 + 错误信息
- [ ] **TC2**：注册后调 `setApplicationHidden("com.tencent.tmgp.sgame", true)` → 桌面是否消失？
- [ ] **TC3**：`addUserRestriction(DISALLOW_INSTALL_APPS)` 后从厂商应用商店尝试装 app → 是否拦住？
- [ ] **TC4**：在系统设置中尝试卸载 ChainlessChain → 是否拦住？强卸 + Magisk 守护是否恢复？

收集到的数据回填本文档 §4 表格 + 写入 memory `dpc_multi_rom_compat_matrix.md`

---

## 10. 与 spike 2 / spike 3 的依赖

- 独立，可并行
- 一旦档 2 不可行（EMUI），档 3 VPN（独立 spike，未列入本批次）+ 档 4 root 兜底要承担更多职责
