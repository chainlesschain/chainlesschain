# DPC AOSP Baseline 取数 Runbook

> **状态**：操作手册 / 待执行
> **关联**：[[Spike_DPC_Multi_ROM]] §4 风险矩阵 / §9 真机 checklist
> **目的**：在干净 AOSP 上拍 DPC 行为基线，作为 5 个国产 ROM 对比的"控制组"
> **执行人**：有 root + 闲置测试机 + Win/Mac 开发环境的同事
> **预计耗时**：刷机 1.5h + 取数 1.5h = **3h 一台机**

---

## 1. 为什么先做 AOSP baseline

不做基线直接跑 MIUI / HyperOS / EMUI / OriginOS / ColorOS，遇到失败时**无法判断是 ROM 限制还是 DPC API 本身的行为**。例如：
- `setApplicationHidden` 失败 — 是 MIUI 拦下，还是 Android 14 行为变化？
- 注册 DO 报 "current user has account" — 是 MIUI 严，还是 AOSP 也有同样限制？

→ **基线 = "在最干净最标准的 Android 上，每个 DPC 调用怎样运行"**，5 ROM 偏离基线的地方就是 ROM 锁

---

## 2. 设备选择

### 2.1 推荐设备（按优先级）

| 设备 | 优势 | 劣势 |
|---|---|---|
| **Pixel 6 / 7 / 8** | 官方 GrapheneOS / LineageOS / 原版 AOSP 镜像最齐 | 国内不易借到 |
| **Pixel 4a / 5** | 二手便宜（500-1000）；GrapheneOS 长期支持 | API 32-33，需补 API 34 case |
| **Xiaomi Mi A3 / Nokia X20** | Android One 原生系统，类似 AOSP | 国内借不到，已停产 |
| **任意可解锁 Bootloader 的旗舰**（OnePlus 7T/8/9，红米 K30 Pro）| 闲置率高，可刷 LineageOS | LineageOS ≠ 纯 AOSP，但够近 |

**最低要求**：
- API 31+（Android 12+），覆盖 DPC 主要 API 变化
- 可解锁 BL（Bootloader）+ 可刷 recovery
- 至少 64GB 存储

### 2.2 不推荐

- 模拟器：`adb shell dpm set-device-owner` 在模拟器上行为与真机偏差大，不适合做基线
- 仅 userdebug 的开发机：默认有内建账户和系统应用，不"干净"

---

## 3. 刷干净 AOSP

### 3.1 镜像选择（按"最干净"排序）

1. **GrapheneOS**（仅 Pixel）— 最严格的"零 Google 服务"AOSP，DPC 行为最接近规范
2. **LineageOS without GApps**（多机型）— 次纯，无 Google Services
3. **官方 AOSP 镜像**（Pixel 系列）— Google 编译的纯 AOSP，适合 baseline

**本 runbook 默认走 GrapheneOS / Pixel 6 路径**，其他机型对应步骤等价。

### 3.2 准备工具（Windows / Mac / Linux 都行）

```bash
# 确认 adb / fastboot 在 PATH
adb version   # 至少 1.0.41
fastboot --version
```

### 3.3 解锁 Bootloader

⚠️ **会清除所有数据**

```bash
# 1. 设备打开开发者选项 + OEM 解锁 + USB 调试
# 2. 重启进 fastboot
adb reboot bootloader

# 3. 解锁（不同厂商命令略异）
fastboot flashing unlock    # Pixel / OnePlus
# 或 fastboot oem unlock
# 或 mi-unlock-tool（小米）

# 4. 设备会要求物理按键确认（电源键 +/-），按提示
# 5. 自动 wipe 后重启
```

### 3.4 刷入 GrapheneOS / AOSP

```bash
# GrapheneOS 路径（推荐）
# 访问 https://grapheneos.org/install/web 用 Chrome 一键刷（最简单）

# 或命令行
unzip grapheneos-<device>-<version>.zip
./flash-all.sh

# 完成后等设备自启
```

### 3.5 完成 setup wizard — **关键**

⚠️ **不要登录任何账户**！  
⚠️ **不要连 Wi-Fi**（连了会触发系统更新检查 + 偶发自动创建 user）

按以下方式过 setup wizard：
- 跳过 Wi-Fi
- 跳过登录
- 跳过指纹
- 跳过备份
- 跳过附加 app

完成后桌面只有 Android 自带的几个 app（Phone / Messages / Settings 等）

---

## 4. 注册 ChainlessChain 为 Device Owner

### 4.1 准备 APK

```bash
# 选项 A：跑 release build
cd C:\code\chainlesschain\android-app
./gradlew :app:assembleRelease

# 选项 B：用最新 GitHub Actions 产物
gh release download v5.0.3.97 --pattern '*.apk'
```

### 4.2 安装 + 设为 DO

```bash
# 1. 连 USB，启用 USB 调试
adb devices       # 确认设备在线

# 2. 装 APK
adb install -r android-app/app/build/outputs/apk/release/app-release.apk

# 3. 设置 device owner（核心）
adb shell dpm set-device-owner com.chainlesschain.android/.dpc.ChainlessDeviceAdminReceiver

# 期望输出：Success: Device owner set to package ComponentInfo{com.chainlesschain.android/...}
# 失败常见输出（记录之）：
#   - "Not allowed to set the device owner because there are already several users on the device"
#   - "Trying to set the device owner, but device owner is already set"
#   - "Can't set DO because there's an account: com.google ..."
```

⚠️ **当前 v5.0.3.97 APK 还没有 `ChainlessDeviceAdminReceiver` 类**（spike 1 §2.1 全空）。本 runbook 假设已有一个**测试用 stub APK** 包含：

```kotlin
// android-app/app/src/main/java/com/chainlesschain/android/dpc/ChainlessDeviceAdminReceiver.kt
package com.chainlesschain.android.dpc
import android.app.admin.DeviceAdminReceiver
class ChainlessDeviceAdminReceiver : DeviceAdminReceiver()
```

```xml
<!-- AndroidManifest.xml 加 -->
<receiver
    android:name=".dpc.ChainlessDeviceAdminReceiver"
    android:permission="android.permission.BIND_DEVICE_ADMIN"
    android:exported="true">
    <meta-data
        android:name="android.app.device_admin"
        android:resource="@xml/device_admin_receiver" />
    <intent-filter>
        <action android:name="android.app.action.DEVICE_ADMIN_ENABLED" />
    </intent-filter>
</receiver>
```

```xml
<!-- res/xml/device_admin_receiver.xml -->
<device-admin>
    <uses-policies>
        <limit-password />
        <watch-login />
        <reset-password />
        <force-lock />
        <wipe-data />
        <disable-camera />
    </uses-policies>
</device-admin>
```

→ 跑 baseline 前需先**改主仓增 stub receiver + manifest** 并出 `app-baseline.apk`。这是 spike 必要前置（~0.5d）

---

## 5. 测试用例（4 个 TC，与 spike 1 §9 对齐）

每个 TC 跑完记录：(a) **是否成功** (b) **完整 adb 输出** (c) **观察到的设备 UI 变化** (d) **耗时**

执行前先 `adb logcat -c`，结束后 `adb logcat -d > tc<N>_logcat.txt`

### TC1 — 注册 Device Owner

```bash
# 已在 §4.2 跑过，但每台机器跑 baseline 都重新走一次
adb shell dpm list-owners | tee tc1_owners_before.txt
adb shell dpm set-device-owner com.chainlesschain.android/.dpc.ChainlessDeviceAdminReceiver 2>&1 | tee tc1_set_do.txt
adb shell dpm list-owners | tee tc1_owners_after.txt

# 验证
adb shell "dumpsys device_policy | grep -A 2 'Device Owner'" | tee tc1_dumpsys.txt
```

**baseline 预期**：list-owners 之前空，之后含 `Device Owner: ...`；set-device-owner 输出 `Success: ...`

### TC2 — setApplicationHidden（隐藏 app）

```bash
# 先装一个测试用 app（任选，例如 com.android.calculator2 系统计算器，或装一个 demo apk）
adb shell pm list packages | grep calc | tee tc2_pkgs.txt
# 若无 calculator2，用 Android 自带的：
TARGET_PKG=$(adb shell pm list packages | head -5 | tail -1 | sed 's/package://')
echo "Using target: $TARGET_PKG"

# 通过 ChainlessChain 触发 setApplicationHidden（需在 stub APK 中加一个 ADB-trigger 命令）
# 或临时方案：用 adb 直接调
adb shell dpm device-owner-installed-test-apps  # 可能无效；只是想确认 DO 上下文
# 实际触发：暂用 reflection 测试 app，或在 stub APK 加 broadcast intent receiver

# 验证：图标在桌面消失？
# 验证：adb shell pm list packages -s --user 0 | grep $TARGET_PKG  → 是否带 hidden 标志
adb shell pm list packages --user 0 -d | grep $TARGET_PKG | tee tc2_after_hide.txt
# -d 显示 disabled，但 hidden 不一定显示在这里；用以下：
adb shell cmd package list packages --uid 0 --show-versioncode | grep $TARGET_PKG | tee tc2_pkg_state.txt

# 取消隐藏
# （通过 stub APK 调 setApplicationHidden(componentName, pkg, false)）
```

**baseline 预期**：`setApplicationHidden(true)` 后图标从启动器消失，从 `pm list packages` 仍可见但带 hidden flag；`setApplicationHidden(false)` 后恢复

### TC3 — userRestriction DISALLOW_INSTALL_APPS

```bash
# 通过 stub APK 调 dpm.addUserRestriction(componentName, UserManager.DISALLOW_INSTALL_APPS)
# 然后尝试装一个 APK：
adb push test_app.apk /sdcard/
adb shell pm install /sdcard/test_app.apk 2>&1 | tee tc3_install_attempt.txt

# 设备上尝试通过 Files 应用打开 APK 安装 — 看 UI 是否拦下
```

**baseline 预期**：`pm install` 命令报 `INSTALL_FAILED_USER_RESTRICTED`；UI 安装弹"系统不允许安装"对话框

### TC4 — 反卸载 DO 本身

```bash
# 设备上：Settings → Apps → ChainlessChain → 卸载
# 预期：按钮变灰 / 报"该应用被管理员设为活动设备管理员"

# adb 强卸：
adb shell pm uninstall com.chainlesschain.android 2>&1 | tee tc4_uninstall.txt
# 预期：DELETE_FAILED_DEVICE_POLICY_MANAGER 或类似

# 拍 UI 截图：设置页 ChainlessChain 详情
adb shell screencap -p /sdcard/tc4_settings_app_detail.png
adb pull /sdcard/tc4_settings_app_detail.png
```

**baseline 预期**：两种方式都拦下；要卸载必须先 `dpm remove-active-admin` 解 DO

---

## 6. 数据采集格式

每台 baseline 设备的输出整理成下面这个 YAML，命名 `baseline-aosp-<device-name>-<android-version>.yml`：

```yaml
device:
  vendor: "GrapheneOS"
  model: "Pixel 6"
  android_version: "14"
  api_level: 34
  rom_build: "2026.05.28-graphene"
  setup_wizard_completed: true
  google_account: false
  test_apk_version: "v5.0.3.97-baseline-stub"
  tester: "<同事名>"
  test_date: "2026-05-28"

tc1_register_device_owner:
  status: success    # success | failure
  stdout: |
    Success: Device owner set to package ComponentInfo{...}
  duration_ms: 250
  ui_notes: "无任何 UI 提示，dpm 静默成功"
  notes: ""

tc2_set_application_hidden:
  target_pkg: "com.android.calculator2"
  hide:
    status: success
    api_returned: true
    icon_disappear_ms: 100
    pm_list_output: "package:com.android.calculator2  (hidden=true)"
  unhide:
    status: success
    icon_reappear_ms: 100
  notes: ""

tc3_disallow_install:
  install_attempt_stdout: "INSTALL_FAILED_USER_RESTRICTED"
  ui_dialog_text: "系统不允许安装应用"
  bypass_possible: false
  notes: ""

tc4_uninstall_blocked:
  ui_uninstall_button_state: "disabled_with_message"
  ui_message: "此应用被管理员设为活动设备管理员，无法卸载"
  adb_uninstall_stdout: "DELETE_FAILED_DEVICE_POLICY_MANAGER"
  notes: ""

issues_observed: []
followup_questions:
  - "GrapheneOS 默认禁用 Google FCM，对推送有何影响？"
```

→ 放到 `docs/design/spike/baselines/` 目录（首次建）；每个 ROM 测完后产出同结构 YAML，可机械化对比

---

## 7. 还原 / 还机

测试完成后让设备回到可用状态：

```bash
# 1. 解除 DO（必须在 dpm 仍能调时跑；DO 设置后不允许从 Settings 解）
adb shell dpm remove-active-admin com.chainlesschain.android/.dpc.ChainlessDeviceAdminReceiver

# 2. 卸载 ChainlessChain
adb shell pm uninstall com.chainlesschain.android

# 3. 验证
adb shell dpm list-owners   # 应该空了
```

如果误操作锁死设备：
- 进 recovery：`adb reboot recovery` → Wipe data / factory reset
- 重新刷系统：回 §3.4

---

## 8. 已知陷阱与注意

| 陷阱 | 现象 | 应对 |
|---|---|---|
| **setup wizard 时连了 Wi-Fi → 自动注册 google 账号** | DO 设置报 "Cannot set DO when there are accounts" | factory reset 重来；跳过 Wi-Fi |
| **APK 已签过 release 签名但被 OEM 校验**| Pixel 不会触发；非 Pixel 注意 | 用 debug 签名跑 baseline 反而更稳 |
| **设备有 secondary user（如 work profile）** | DO 注册失败 | factory reset 重来；Setup wizard 不要点"添加用户" |
| **API 33 vs 34 行为差**| 同样 API 调用，结果不同 | 至少跑 API 33 + API 34 两个 baseline；填到 YAML 的 api_level |
| **`adb shell dpm` 在 user build 上可能拒绝**| Pixel 官方 release 是 user build，应该可调 | 失败时改用 root + `su -c dpm set-device-owner ...` |
| **dpm 命令变体**| 部分 Android 版本要求 `set-device-owner --user 0 ...` | 失败时加 `--user 0` 重试 |

---

## 9. 完成判定

baseline 完成的标准：
- [ ] 至少 1 台 Pixel（API 34）跑完 4 个 TC，YAML 产出
- [ ] 至少 1 台 Pixel / LineageOS（API 33）跑完同 4 TC，YAML 产出
- [ ] 两份 YAML 数据一致（除 api_level 字段外）
- [ ] YAML 提交到 `docs/design/spike/baselines/`
- [ ] 任何 TC 失败 → 记到 `issues_observed`，**不阻塞** baseline 完成（baseline 就是要记录真实情况，包括失败）

---

## 10. 输出 → 下一步

baseline YAML 拍完后，5 个国产 ROM 跑同样 4 TC，每个生成 `baseline-<rom>-<model>-<version>.yml`；diff 工具脚本（待写）自动 highlight 偏离基线的 case 填回 [[Spike_DPC_Multi_ROM]] §4 风险矩阵的具体值

未来扩展（v0.2 spike）：
- TC5：`setPermittedInputMethods` — 限制输入法
- TC6：`addCrossProfileWidgetProvider` — 跨 profile widget
- TC7：`setKeyguardDisabledFeatures` — 锁屏限制
- TC8：`setPermissionGrantState` — 一键授权
- TC9：`createAndManageUser` — 多用户

---

## 附 A：stub APK build 一次性脚本

```bash
# 在主仓加最小 receiver + manifest，build 一个 baseline-only APK

cd C:\code\chainlesschain\android-app

# 1. 加 stub 文件
cat > app/src/main/java/com/chainlesschain/android/dpc/ChainlessDeviceAdminReceiver.kt <<'EOF'
package com.chainlesschain.android.dpc
import android.app.admin.DeviceAdminReceiver
import android.content.Context
import android.content.Intent
class ChainlessDeviceAdminReceiver : DeviceAdminReceiver() {
    override fun onEnabled(context: Context, intent: Intent) {
        android.util.Log.i("ChainlessDPC", "Device admin enabled")
    }
    override fun onDisabled(context: Context, intent: Intent) {
        android.util.Log.i("ChainlessDPC", "Device admin disabled")
    }
}
EOF

# 2. 加 res/xml/device_admin_receiver.xml（见 §4.2）
# 3. AndroidManifest.xml 加 receiver（见 §4.2）
# 4. 加一个 ADB-broadcast trigger Activity 用来调用 setApplicationHidden 等（避免每次手写 reflection）

./gradlew :app:assembleRelease

# 5. 输出
ls app/build/outputs/apk/release/app-release.apk
# 拿这个 APK 跑 baseline
```

→ stub APK 完成后可 commit 到一个独立分支 `spike/dpc-baseline-stub`，不合 main（避免污染主线 release）
