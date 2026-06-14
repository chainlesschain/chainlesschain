# WeChat Frida Hook — Setup Runbook

> **范围**：Phase 12.6+ frida-dep 路径的**用户端 setup 步骤**。本文档是 [`Adapter_WeChat_SQLCipher.md §18`](./Adapter_WeChat_SQLCipher.md) 的实施配套手册 —— §18 讲架构，本文档讲"我作为用户怎么把它跑起来"。
>
> **状态**：v0.1（2026-05-21，与 Phase 12.6.1–6 代码同 commit 落地）。
>
> **谁该读**：手上有 rooted Android 设备 + WeChat 8.0+ 想拉自己 5 年聊天记录的最终用户。如果你的微信是 7.x 版本，看 [§3 Quick Path B](#3-quick-path-b-wechat-7x-不需要-frida)，**不要**读本文余下章节。

---

## 0. 重要前提

**仅服务于"用户分析自己手机里的自己微信账户"**。不为他人代提取、不商业化、不上传云端。本工具触碰 `/data/data/com.tencent.mm/`，按《个保法》"个人或家庭事务"豁免使用。

**不可逆操作**：root + Magisk 操作会让设备保修失效，部分 App（银行 / 支付 / 政务）可能被反 root 检测拒绝运行。**用旧手机或备用机**做这件事，不要拿主力机冒险。

---

## 1. 你需要准备的东西

| 物 | 说明 | 替代品 |
|---|---|---|
| 一台 rooted Android 手机 | 装了 Magisk；建议 ≥ Android 10 | iPhone 不行（无法 root WeChat 沙盒） |
| 这台手机上**装着你自己的微信** | 已登录 + 至少进过一次任何聊天（触发 libwcdb 加载） | 不接受"刚装的微信" |
| 一根能传数据的 USB 线 | 充电线常没有数据 pin | 无线 adb 在 §6 |
| 一台 Win/Mac/Linux 桌面机 | 装好 Node.js ≥ 22.12 + ChainlessChain Desktop | — |
| `adb` 命令行 | Android Platform Tools | 桌面 ChainlessChain 自带不另装 |
| `frida-server` 二进制 | **不预置，需要你自己下载，见 §2** | — |

---

## 2. 在手机上跑起 frida-server

### 2.1 下载对应 ABI 的 frida-server

frida 团队在 GitHub 维护官方 build：

```
https://github.com/frida/frida/releases
```

打开最新 release（例 16.x），找：

- `frida-server-<ver>-android-arm64.xz`  （骁龙/天玑/麒麟 现代机 — 99% 的国内用户）
- `frida-server-<ver>-android-arm.xz`     （32-bit ARM，2016 年以前的老机）
- `frida-server-<ver>-android-x86_64.xz`  （x86 模拟器 / 平板，少见）

> **不知道选哪个？** 让 ChainlessChain 桌面端的"WeChat 添加适配器"按钮跑 env-probe，会告诉你 `device.abi`。或自己跑：`adb shell getprop ro.product.cpu.abi`。

桌面机解压：

```bash
# Win / Mac / Linux 同
xz -d frida-server-16.x.x-android-arm64.xz
mv frida-server-16.x.x-android-arm64 frida-server
chmod +x frida-server
```

### 2.2 推到设备 + 跑起来

```bash
adb push frida-server /data/local/tmp/
adb shell "chmod 755 /data/local/tmp/frida-server"
adb shell "su -c '/data/local/tmp/frida-server -D &'"
# -D = daemonize；& = 让它跑后台不阻塞 adb shell
```

**验证它跑起来了**：

```bash
adb shell "pgrep -f frida-server"
# 输出一个数字（PID）= 跑起来了
adb shell "netstat -tln | grep 27042"
# 见到 tcp 0.0.0.0:27042 LISTEN = 端口监听中
```

### 2.3 反检测加固（可选但推荐）

WeChat 8.0+ 在启动时主动扫描 `frida-server` 端口 27042 + frida-gum 注入痕迹。三层加固：

#### 2.3.1 Magisk DenyList 配置（隐藏 root 痕迹给 WeChat）

```
Magisk → Settings → Enable Zygisk → 重启
Magisk → Configure DenyList → 勾选 com.tencent.mm
```

效果：WeChat 启动时调用 `/system/bin/su` 等 root 探测全返回 "not exist"，绕过简单 root 检测。

#### 2.3.2 改 frida-server 默认端口

WeChat 反检测最先扫的就是 27042。给 frida-server 换端口：

```bash
adb shell "su -c '/data/local/tmp/frida-server -l 0.0.0.0:13337 &'"
```

然后桌面端添加适配器时填 `port: 13337`（UI 引导有占位输入框）。

#### 2.3.3 用社区 patched build（高阶）

`frida-server` 官方 build 内含 `frida_agent.so` 字符串，可被反检测识别。社区维护改名版（搜索 "frida server patched"），把 `gum-js-loop` / `gmain` 等指纹 string 改掉。**自带风险**：patched build 不一定与你的 Android 版本 ABI 完美匹配，按需用。

---

## 3. Quick Path B（WeChat 7.x 不需要 Frida）

如果 `adb shell "dumpsys package com.tencent.mm | grep versionName"` 返回 7.x：

1. **不需要 frida-server** — 关掉手机上的所有 Frida 进程（防误用）
2. 拉一次微信数据目录：`adb pull /data/data/com.tencent.mm /tmp/wechat-data`
3. 桌面端"WeChat 适配器"切到 **MD5 路径** —— UI 会自动识别版本走 v0.5 path
4. 提示你输入 UIN（在 `/tmp/wechat-data/shared_prefs/auth_info_key_prefs.xml` 里能找到，或让 extractor 自动找）

→ **跳过本文档余下章节**。

---

## 4. 桌面端添加适配器

打开 ChainlessChain Desktop → 个人数据中台 → 添加适配器 → WeChat。

UI 会自动跑 `env-probe`，给出报告：

```
设备：✅ Xiaomi 24115RA8EC（arm64-v8a）
Root：✅ 检测到（Magisk 已装）
Frida：✅ frida-server 跑在 :27042
WeChat：✅ 8.0.50（≥ 8.0，将使用 Frida hook 路径）
建议：frida
```

点"开始"。UI 会显示：

```
请打开 WeChat 进入任意聊天界面，然后点"我已经打开了"。
（这是为了触发 sqlite3_key 调用，让 frida hook 抓到密钥。）
```

照做。30 秒内 UI 显示密钥已捕获，开始解密 + 同步。

---

## 5. 故障树

### 5.1 env-probe: 设备未检测到

| 现象 | 排查 |
|---|---|
| `adb devices` 输出空 | USB 线只能充电不能传数据；换线 |
| `adb devices` 输出 `<serial>\tunauthorized` | 手机上弹了 USB 调试确认框，没点；点"始终允许" |
| `adb devices` 输出 `<serial>\toffline` | 重插 USB；或 `adb kill-server && adb start-server` |

### 5.2 env-probe: root 未检测到

| 现象 | 排查 |
|---|---|
| `su -c id` 不返回 `uid=0` | 没真正 root；用 Magisk 重刷 boot.img |
| 返回 `uid=2000` | 你跑在普通 shell user，没切 su；权限自检会拉 root 授权 popup，点"允许" |
| Magisk 装了但 DenyList 没配 | WeChat 仍可能反检测起作用；按 §2.3.1 配 |

### 5.3 env-probe: frida-server 未运行

| 现象 | 排查 |
|---|---|
| `pgrep -f frida-server` 空 | frida-server 没跑；按 §2.2 重启 |
| 跑了但端口不监听 | SELinux 拦截；`adb shell "su -c setenforce 0"`（**警告**：临时关 SELinux，重启后恢复） |
| 端口冲突 | 某 App 占了 27042（极少）；换端口 §2.3.2 |
| frida-server 启动后秒退 | ABI 选错；重看 §2.1 + 桌面端 env-probe 显示的 `device.abi` |

### 5.4 hook 阶段：30 秒等不到密钥

| 现象 | 排查 |
|---|---|
| `WCDB_KEY_TIMEOUT` + `libwcdb.so never loaded` | 用户没进微信聊天界面；UI 引导再读一次 |
| `WCDB_KEY_TIMEOUT` + `libwcdb.so 已加载但 sqlite3_key 没触发` | WeChat 缓存了 DB session 没重开；杀 WeChat（设置 → 应用 → 强行停止）+ 重开 + 再触发 |
| `FRIDA_ATTACH_FAILED` + `unable to find process` | WeChat 没在前台跑；先打开 WeChat 再点桌面端"开始" |
| `FRIDA_ATTACH_FAILED` + `Process crashed` | WeChat 反检测把自己整死；按 §2.3 加固后重试；或考虑用 patched frida-server |
| 反复失败 ≥ 3 次 | UI 提示降级 v0.5 — 但你是 8.x 不能降。建议升级 Magisk + Zygisk 到最新，或试试 patched frida-server |

### 5.5 WeChat 版本升级后突然失败

WeChat 每月小版本可能改 `libwcdb.so` 的导出符号。本工具的 `wechat-key-hook.js` 维护一个 fallback 符号列表：

```
sqlite3_key
sqlite3_key_v2
wcdb_setkey
WCDBKeyDerive
_ZN4WCDB8Database13setCipherKeyERKNSt6__ndk1...
```

如果你的 WeChat 升级后命中不了，UI 会提示 `module-waiting → timeout`。提 [issue](https://github.com/chainlesschain/chainlesschain/issues) 带：

- WeChat 版本号
- `adb shell "su -c 'cat /proc/$(pidof com.tencent.mm)/maps | grep libwcdb'"` 输出
- 桌面端日志里 frida-message 完整序列

我们会评估 + 加新符号到候选。

---

## 6. 无线 adb（手机不插 USB）

适合长期 setup（一次 USB pair，之后无线触发）：

```bash
# 一次性 USB pair（Android 11+）
adb tcpip 5555
adb connect <phone-ip>:5555  # 在 Settings → About → Status 见 IP

# 之后桌面端检查
adb devices
# 输出：<phone-ip>:5555  device
```

frida-server 仍只能在手机本地跑（不能远程注入），但 adb 端到端走 WiFi 后续不用插线。

---

## 7. Uninstall / 关停

抓完想停用：

```bash
adb shell "su -c 'pkill -9 frida-server'"
adb shell "rm /data/local/tmp/frida-server"
```

Magisk → DenyList → 取消 `com.tencent.mm` 勾选（可选 — DenyList 留着无害）。

桌面端：个人数据中台 → 找到 WeChat 适配器 → 点"卸载"。**vault 里已抓的事件不会被删** —— 数据已落地，你的就是你的。

---

## 8. 相关

- [`Adapter_WeChat_SQLCipher.md`](./Adapter_WeChat_SQLCipher.md) — 完整设计文档（包括 §13 trap 登记，遇到诡异现象先翻一下）
- [`Personal_Data_Hub_Architecture.md`](./Personal_Data_Hub_Architecture.md) §12 — Phase 12 路线图
- [`Personal_Data_Hub_Fixture_Pin_Protocol.md`](./Personal_Data_Hub_Fixture_Pin_Protocol.md) — schema pin 方法论（如果你想为非 8.0.50 版本贡献 fixture）
- frida 官方文档：<https://frida.re/docs/android/>
- Magisk 官方文档：<https://topjohnwu.github.io/Magisk/>

## 附录：规范章节补全（v5.0.3.108）

> 本文为用户端 setup runbook（Frida hook 路径）。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文步骤。

### 1. 概述

见正文头部说明。本文是 `Adapter_WeChat_SQLCipher.md §18` 的实施配套手册——讲「rooted Android + WeChat 8.0+ 用户怎么把 Frida hook 跑起来」拉回自己 5 年聊天记录；7.x 用户走 §3 Quick Path B（不需要 Frida）。

### 2. 核心特性

frida-dep setup 步骤；8.0+ Frida hook 路径 + 7.x quick path 分流；rooted 设备前置。

### 3. 系统架构

见 `Adapter_WeChat_SQLCipher.md §18`（架构）；本文为其用户端实施配套。

### 4. 系统定位

WeChat adapter（Phase 12.6+）的**用户端 Frida setup runbook**。

### 5. 核心功能

环境准备 → frida-server 部署 → hook 拉 SQLCipher key → 解密同步。详见正文步骤。

### 6. 技术架构

Frida（frida-server / hook）+ Magisk（root）；目标 WeChat 8.0+。

### 7. 系统特点

仅面向 rooted 设备 + WeChat 8.0+；7.x 走免 Frida 的 Quick Path B。

### 8. 应用场景

最终用户取回自己 5 年微信聊天记录。

### 9. 竞品对比

见 `Adapter_WeChat_SQLCipher.md`（封闭生态唯一取回路径）。

### 10. 配置参考

frida-server 版本 / Magisk / 设备 root 配置见正文步骤。

### 11. 性能指标

setup 为一次性；解密同步性能见主设计文档。

### 12. 测试覆盖

非 8.0.50 版本贡献 fixture 见 `Personal_Data_Hub_Fixture_Pin_Protocol.md`。

### 13. 安全考虑

root + Frida 提权操作仅本机自用；聊天语料极高敏感；落盘经 LocalVault 加密。

### 14. 故障排除

遇诡异现象先翻 `Adapter_WeChat_SQLCipher.md §13` trap 登记；frida attach 失败见主文档 T26–T28。

### 15. 关键文件

frida-server；Magisk；FridaKeyProvider（见主设计文档）。

### 16. 使用示例

见正文各步骤命令（frida-server 部署 / hook 启动）。

### 17. 相关文档

见正文「8. 相关」：`Adapter_WeChat_SQLCipher.md`、`Personal_Data_Hub_Architecture.md` §12、`Personal_Data_Hub_Fixture_Pin_Protocol.md`、frida / Magisk 官方文档。
