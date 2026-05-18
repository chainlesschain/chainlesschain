# iOS watchOS Companion Spike — 决策文档

> **状态**：Spike v1.0（2026-05-18）。本文档是 **Phase 6.9 决策输出**，非实施计划。
>
> **背景**：Android 端 `wear-app/` 模块存在（Wear OS Compose target，但未深度开发）。Phase 6 Plan §5 §6.9 + OQ-6 列了 3 option (不做 / MVP push mirror 3-5d / Full mirror Android wear-app 4-6w)。本 spike 调研 Apple Watch 自动 mirror 现状、用户场景、ROI，给出推荐。

---

## 1. Apple Watch + iPhone 现状

### 1.1 通知 / push 自动 mirror（默认行为）

iPhone 收到的 **push notification 自动镜像到 Apple Watch**，前提：
- Watch app 在 iPhone 端"Apple Watch" app 设置中允许通知镜像（默认 on）
- iPhone 端 app 已经走标准 UNUserNotificationCenter 推送通知

**Phase 4 Notification skill 已配置**：iOS 端走 UNUserNotificationCenter，**所以 Phase 4 通知已经天然 mirror 到 Apple Watch** — 用户在手腕看到桌面 push 消息。**0 额外工作**。

### 1.2 自定义 watchOS app target — 能力上限

如果加 watchOS app target，可做：

- **Complications**（表盘小部件）— 显示当前状态（在线/离线 / 未读消息数 / 桌面 CPU/Mem 等）
- **Notifications 自定义 UI**（vs 默认 mirror 显示）
- **Standalone watchOS app**（无 iPhone 在场也可用）— 但需独立 networking 实现，复杂
- **WatchConnectivity** — 与 iPhone 应用通信（small data / files / userInfo）
- **快捷操作**（Watch 上点按发命令到桌面 — 如锁屏 / pause music）

不可做：
- WebRTC DataChannel（无 native lib；理论 WebKit 内可但 Watch 浏览器无）— **Phase 2/6.6 远程终端 + 桌面流不可移植到 Watch**
- 大 payload 通信（WatchConnectivity userInfo 限 65 KB）
- 长时间运行任务（watchOS app 是激活式短时窗口）

---

## 2. 3 option 重新评估

### Option 1 — 不做 (不加 watchOS target)

**自动行为**：Phase 4 notification skill 走 UNUserNotificationCenter → 用户在 Apple Watch 默认看到桌面 push 消息（标题 + body 内容）。

**优点**：
- 0 开发工作
- 包体积不增（watchOS app 通常 +20-30 MB）
- 维护负担 0

**缺点**：
- 无表盘 complication
- 无 Watch 上快捷操作（lock screen / pause music 等）
- 无 standalone 模式

### Option 2 — MVP：push notification mirror 增强 + 1 个 Watch 复杂功能 ("3-5 天")

**范围**：
- 加 watchOS app target（Empty 模板 + Info.plist + entitlements）
- 实现自定义 push notification Watch UI（更紧凑 / 含 ChainlessChain logo）
- 加 1 个 complication：显示桌面 online/offline + 未读数
- WatchConnectivity 拉 iPhone 配对桌面状态

**优点**：
- 表盘 complication 是 Watch 用户高频感知（每次抬腕都看到）
- 安装 Watch app 体验 — 卖点

**缺点**：
- watchOS target 引入额外 build / signing / TestFlight 流程
- 包体积 +30 MB
- 维护 watchOS-iOS 版本兼容

**实施估时**：5-7 天（Apple Watch dev 学习曲线 + Watch UI + complication + WatchConnectivity 状态同步）

### Option 3 — Full：mirror Android `wear-app` 完整功能 ("4-6 周")

**范围**（推测 — Android wear-app 暂未深度开发，按 Wear OS 典型 app 想象）：
- 多 complication 类型（CPU 使用 / RAM 使用 / 网络状态 / 桌面 online）
- Watch 上完整通知历史 + 标记已读
- Watch 上快捷动作（锁桌面 / 暂停媒体 / 投屏开关 / pause AI agent）
- 心率传 LLM 上下文（"用户心率 110，建议放慢 query 速度"）
- Standalone 模式（无 iPhone 在场时通过 cellular Watch 与桌面通信）

**优点**：
- 完整 Apple Watch 生态参与
- ChainlessChain 卖点之一

**缺点**：
- 4-6 周开发（Apple Watch 是独立 platform，学习曲线 + 多 framework）
- 包体积 +50-100 MB（含 standalone networking 实现）
- 维护负担 高
- **Apple Watch 用户基数** vs **ChainlessChain 用户重叠** 未知 — 投入回报不确定

**实施估时**：4-6 周

---

## 3. 用户场景重新审视

### 3.1 真实用例评估

| 场景 | 频率 | Option 1 (不做) | Option 2 (MVP) | Option 3 (Full) |
|---|---|---|---|---|
| Watch 显示桌面 push 通知 | 高 | ✅ 自动 mirror | ✅ 自定义 UI | ✅ 完整 |
| 表盘 complication 看桌面状态 | 中 | ❌ | ✅ | ✅ |
| Watch 点按锁桌面 / 控制媒体 | 低 | ❌ | ⚠️ 部分 | ✅ |
| 心率/活动数据传 AI agent | 极低 | ❌ | ❌ | ✅ |
| 无 iPhone 在场单 Watch 控桌面 | 极低 (蜂窝 Watch only) | ❌ | ❌ | ✅ |
| 教学 / 展示 (Watch 卖点) | 低 | ❌ | ✅ | ✅ |

### 3.2 用户基数估计（粗）

- iPhone 用户 / iOS app 用户比例（假设 ChainlessChain 已发布）：100%
- 其中 Apple Watch 配对：~25%（行业平均）
- 其中实际用 watchOS app 的：~10%
- = **ChainlessChain 整体 iOS 用户中 ~2.5% 真用 watchOS app**

Option 3 (Full) 4-6 周开发投入对 2.5% 用户基数 — ROI 较低。

### 3.3 与 Android wear-app 对标

Android `wear-app/` 目录存在但是基本骨架（看 commit 历史无深度 feature 开发）。Android Phase 6+ wear-app 进度 = 0。所以与 Android 对齐 = Option 1 / 2 都可。

---

## 4. 推荐 — Option 1+ (不加 watchOS target，依靠 Phase 4 自动 mirror)

### 4.1 决策

**Phase 6.9 推荐 Option 1 增强版**：

1. **不加 watchOS app target**（避免 30 MB 包体积膨胀 + 维护负担）
2. **Phase 4 notification skill 已配置 UNUserNotificationCenter** → Apple Watch 自动 mirror 桌面 push 消息（**用户已有基础 Watch 体验**）
3. **在 iOS app Settings 加一段说明** — 告知用户 Watch mirror 配置（如何在 Apple Watch app 中允许通知 mirror）
4. **未来重评条件**（任一触发可推进到 Option 2）：
   - 用户调研显示 ≥ 10% 用户主动询问 watchOS app
   - Android `wear-app` 推进到深度 feature 阶段 → 平台对齐压力
   - 新 watchOS framework 发布显著降低开发成本

### 4.2 不做的事（明确 deferred）

- ❌ 不加 watchOS target
- ❌ 不写 complication
- ❌ 不实现 standalone watchOS 模式
- ❌ 不写 心率→LLM 集成

### 4.3 文档化用户引导

在 iOS app README / docs 加 FAQ：

> **Q：Apple Watch 上能用 ChainlessChain 吗？**
> A：
> - **通知 mirror（已支持）**：iPhone 收到的桌面通知会自动同步到 Apple Watch（前提：iPhone 端 Apple Watch app 设置 → 通知 → ChainlessChain 允许 mirror）
> - **专属 Watch app（暂不支持）**：当前版本未加 watchOS target。如需表盘 complication / Watch 快捷操作，请到 GitHub issue 反馈，根据需求量推进 Phase 7+

---

## 5. Option 决策表

| Option | 推荐？ | 工作量 | 包体积 | 维护负担 | 用户价值 / 用户比例 |
|---|---|---|---|---|---|
| **1 不做 (推荐)** | ✅ | **0** | **0** | **0** | Phase 4 通知 mirror 自动 (95% Watch 用户需求) |
| 2 MVP | ❌ (暂时) | 5-7 天 | +30 MB | 中 | 表盘 complication / Watch UI (10% Watch 用户) |
| 3 Full | ❌ | 4-6 周 | +50-100 MB | 高 | 完整 Watch 体验 (~2.5% 用户) |

---

## 6. 关联

- `iOS_对标_Android_Phase_6_Plan.md` §5.6 OQ-6 (Option 1/2/3) — **本 spike 决策 Option 1**
- Android: `wear-app/` (基本骨架，无深度 feature)
- iOS Phase 4 Notification skill ✅ 已 wire UNUserNotificationCenter (自动 Apple Watch mirror)
- 外部参考: [WatchConnectivity Framework](https://developer.apple.com/documentation/watchconnectivity) / [WidgetKit (Complications)](https://developer.apple.com/documentation/widgetkit)
