# iOS Local Terminal Spike — 决策文档

> **状态**：Spike v1.0（2026-05-18）。本文档是 **Phase 6.8 决策输出**，非实施计划。
>
> **背景**：Android 端 `feature-local-terminal` Phase 0.5 已 land（mksh R59c + toybox 0.8.11 cross-build + W^X 修复 + Compose UI via xterm.js WebView, 5 commits 至 `c25a72767`）。Phase 6 Plan §5 §6.8 + OQ-5 列了 4 plan (A WebKit JS REPL / B iSH x86 emu / C 放弃 / D 等 iOS 26+)。本 spike 调研 Apple 政策、技术可行性、用户场景，给出推荐。

---

## 1. iOS 沙盒约束 — 核心限制

### 1.1 不能做什么

iOS App Sandbox + App Store Review Guidelines 4.7（"Code interpretation"）禁止：

1. **`fork()` / `exec()` / `posix_spawn()`** — 标准 POSIX shell 实现的基石，iOS 完全禁用（NSTask 仅特权应用可用，普通分发应用 reject）
2. **下载并执行任意原生代码** — 不能像 Android Phase 0.5 那样 vendoring mksh + toybox cross-build .so 然后 exec
3. **从外部 source 加载脚本解释器** — Python / Ruby / Lua 等非内置语言要 sideload 才可，App Store 直接 reject
4. **Just-In-Time 编译** — 禁用 `MAP_JIT` flag in production apps（仅 dev 启用），影响 V8/LuaJIT/QuickJS 部分性能

### 1.2 能做什么（WebKit / JS 例外）

App Store Guidelines 4.7 **例外条款**：

> "Apps may **execute code via JavaScript** that runs within the context of a WKWebView..."

WebKit + JavaScriptCore 是 Apple 钦点的 sandbox-friendly script runtime。任何 Web-based 终端模拟（xterm.js + 自实现 shell as JS REPL）合规。

---

## 2. iOS 终端 app 生态调研

调研当前 App Store 上已存在的"iOS 终端 app"，了解 Apple 实际接受的实现路径：

### 2.1 a-Shell — 静态链接 GNU userland (App Store 上活)

- **路径**：bundle 静态链接的 BSD/GNU 工具 (~50 个 binary) 进 app；用 `ios_system` 开源框架 **patch POSIX 函数** 让 ls / grep / awk / 等在主进程内执行 (不 fork)
- **状态**：App Store 长期分发，未被下架（已 5 年以上）
- **关键技术**：[ios_system framework](https://github.com/holzschu/ios_system) — 通过 dlopen + 函数指针重定向把"独立进程"伪装在 main 进程；不是真 fork
- **包大小**：~30 MB（含全套工具）
- **限制**：每个 command 是独立 dylib，启动延迟 ~50ms；不能跑 Node.js / Python / Ruby（这些是动态语言解释器，禁）

### 2.2 Blink Shell — 类似 a-Shell + SSH client (App Store 付费)

- **路径**：与 a-Shell 同 ios_system 基础，但定位 SSH client（远程终端）+ mosh 支持
- **状态**：App Store 付费 ~$20，长期分发
- **关键**：本质上是"远程终端 + 少量本地 utility"

### 2.3 iSH — Linux user-mode emulator (TestFlight，曾 App Store)

- **路径**：x86 emulator (musl libc + busybox) 运行 Alpine Linux 用户态在 iOS app 内
- **状态**：曾在 App Store 上架，**被 Apple 多次下架后撤回**；当前主要通过 TestFlight 分发 + 开源 (https://github.com/ish-app/ish)
- **关键问题**：Apple Guideline 4.7 解读分歧 — "apt-get install" 算不算"下载执行外部代码"？iSH 团队和 Apple 反复磨合。**目前 ChainlessChain 不应依赖 iSH 路径**：Apple 政策不稳定，且 iSH 性能差 (10-100x slowdown)。
- **包大小**：~30 MB base + Alpine rootfs ~50 MB

### 2.4 Termius / Prompt 等 — 纯 SSH client

- **路径**：远程终端 only — 不是 local terminal
- **状态**：商业产品，App Store 主流
- **结论**：用户主流接受 "iOS 上做远程终端" — 没人指望真 local shell

---

## 3. 4 plan 重新评估

### Plan A — WKWebView + xterm.js + JS-based shell REPL

**架构**：xterm.js (终端 UI) + JavaScriptCore (执行内置 JS 函数) + 自实现命令处理器 (ls / cd / cat / echo / 等模仿 shell)

**优点**：
- 合规 100%（WebKit 例外条款）
- 包体积小（xterm.js + JS shell ~200 KB）
- 0 沙盒风险

**缺点**：
- **不是真 shell** — 命令处理是 JS 函数 dispatch，不能 pipe (`|`)、redirect (`>`)、background (`&`)
- 用户感知"假终端"：试输入 `python` / `node` / `vim` 全失败
- 文件系统操作受限（仅 app sandbox 内）
- 无 bash/zsh script 语法（变量赋值 / for loop / function definition 等）

**实施估时**：1-2 周（xterm.js 集成 + ~30 内置命令 + 文件系统适配）

### Plan B — iSH-style x86 emulator

**优点**：
- 真 Linux user space（apt-get / python / node / vim 全工作）
- 与 Android Phase 0.5 mksh/toybox 体验最像

**缺点**：
- **Apple 政策风险高** — iSH 被反复下架（详 §2.3）
- 性能差 (10-100x slowdown) — JIT 禁用让 emulator 跑得慢
- 包体积大 (~80 MB base + apk 包)
- 维护成本高 — emulator 跟进 iOS 版本兼容

**实施估时**：3-6 周（fork iSH + 适配 + 测试 + 提交审核 — 可能 rejected）

### Plan C — 放弃 local terminal，主推 Phase 2 远程终端

**优点**：
- 0 工作量
- Phase 2 远程终端已 land（v0.1 + Plan A.1 WebRTC DC）
- 用户场景"地铁里临时执行命令"通过远程终端覆盖（连家里 PC / 服务器 SSH）

**缺点**：
- 用户没有"完全离线时仍能用 shell" 的能力
- 与 Android feature-local-terminal 不对齐

**实施估时**：0 天

### Plan D — 等 iOS 26+ Apple 政策放开

**优点**：
- 未来 Apple 可能放开 BSD shell API（已有传闻 iOS 18 解禁部分 NSTask 用法）

**缺点**：
- 时间不确定（12+ 个月以上）
- 是个 wait-and-see，不是 actionable

**实施估时**：监控 WWDC 2026 + 后续

---

## 4. 用户场景重新审视

### 4.1 真实用户需求

| 场景 | 远程终端能覆盖? | Local 终端是否必需? |
|---|---|---|
| 上下班路上执行命令 / 看 log | ✅ Phase 2 远程终端连家 PC / 服务器 | ❌ 不需要 |
| 学校 / 工地 / 工厂内网无外连 | ⚠️ 需 VPN 或同 LAN 桌面 | ⚠️ Local 有价值，但用户极少 |
| 完全离线（飞机 / 地铁深部） | ❌ 远程不工作 | ✅ 唯一需求 |
| 学 Linux / 教学场景 | ✅ 远程 VM 即可 | ⚠️ Marginal |
| 跑本地脚本工具 (grep / awk 数据处理) | ⚠️ 远程不流畅 | ✅ Local 真有价值 |

**结论**：local terminal 真实需求 = **完全离线 + 文本处理工具** — 占用户场景 < 5%。

### 4.2 与 Android feature-local-terminal 价值差

Android 端 Phase 0.5+ local terminal 价值高，因为：
1. Android 没有 fork 限制，mksh/toybox 真跑（性能接近原生）
2. Android 用户多 root / 折腾 / 开发者场景
3. Termux 等已建立 Android shell 文化

iOS 端价值低：
1. iOS 用户文化少 shell
2. 即使做出来也是阉割版（Plan A）或被下架风险（Plan B）
3. 与 a-Shell / Blink 重复 — 用户已有现成 App Store 选项

---

## 5. 推荐 — Plan C 放弃 (with documentation)

### 5.1 决策

**Phase 6.8 推荐 Plan C — 放弃 iOS 端 local terminal，明确文档化理由**：

1. iOS 沙盒约束让 local terminal 在 iOS 上**永远是阉割版** vs Android Phase 0.5+ 的真 mksh + toybox
2. 用户场景 < 5%（完全离线 + 文本处理）— 不值得 1-6 周开发 + 可能被 Apple reject (Plan B)
3. **Phase 2 远程终端已覆盖 95% 用户场景**（地铁里临时执行 = 远程连家 PC）
4. 想要本地 shell 的 iOS 用户可装 App Store 上的 **a-Shell**（免费）或 **Blink Shell**（付费）— 不是 ChainlessChain 核心定位
5. 监控 Apple 政策 (Plan D)：如果 iOS 26+ 解禁 NSTask，2026 后期重新评估

### 5.2 用户引导

在 iOS 端 README / docs 加 FAQ 条目：

> **Q：iOS 端没有本地终端？**
> A：iOS 沙盒不允许应用执行任意 shell 进程。我们建议：
> - **远程终端**（已支持）：进 RemoteOperate → 终端 tab，连接桌面 / 服务器
> - **真本地终端**：App Store 装 a-Shell（开源免费）或 Blink Shell（付费 SSH client + 本地 utility）

### 5.3 不做的事（明确 deferred）

- ❌ 不集成 ios_system 框架（30 MB+ 体积，长期维护负担）
- ❌ 不 fork iSH（政策风险）
- ❌ 不做 WebKit JS shell（用户会失望 — "假终端"）

### 5.4 监控

- 跟踪 WWDC 2026 announcements 关于 NSTask / fork() 政策放开
- 跟踪 Apple App Store Review Guidelines 4.7 修订
- 如 a-Shell / Blink 被下架或 Apple 政策剧变，重新评估

---

## 6. Plan 决策表

| Plan | 推荐？ | 工作量 | 风险 | 用户价值 |
|---|---|---|---|---|
| A WebKit JS REPL | ❌ | 1-2 周 | 低 | 低（假终端体验差）|
| B iSH x86 emu | ❌ | 3-6 周 | 高（Apple reject）| 中（真 shell 但慢）|
| **C 放弃 (推荐)** | ✅ | **0** | **0** | 已被 Phase 2 + a-Shell 覆盖 |
| D 等 iOS 26+ | 监控 | 0 | 0 | 暂无 |

---

## 7. 关联

- `iOS_对标_Android_Phase_6_Plan.md` §5.6 OQ-5 Plan A/B/C/D 矩阵 — **本 spike 决策 C**
- Android: `feature-local-terminal/` Phase 0.5+ (mksh R59c + toybox 0.8.11 cross-build)
- iOS Phase 2 `RemoteTerminal/` — 远程终端 ✅ 已 land 覆盖用户主场景
- 外部参考: [a-Shell](https://github.com/holzschu/a-shell) / [Blink Shell](https://blink.sh) / [iSH](https://github.com/ish-app/ish) / [ios_system](https://github.com/holzschu/ios_system)
