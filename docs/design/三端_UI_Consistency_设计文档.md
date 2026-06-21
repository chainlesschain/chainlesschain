# 三端 UI Consistency 设计文档 v0.1

> **版本**: v0.1（2026-05-15，A.2 baseline，等 GA 反馈触发 v0.2 revise）
> **关联 Issue**: [#21](https://github.com/chainlesschain/chainlesschain/issues/21) A.2（GA 后续 scope · P1，GA-independent baseline 部分）
> **关联设计文档**: [Android 重新定位](Android_重新定位_设计文档.md) §10 A.2 / [MofN 多签应用扩展](MofN_多签_应用扩展_v1.md) §8 / [桌面 V6 P7+P8+P9 Preview Shell] memory `desktop_v6_p7_preview_shell.md`
> **范围**: 三端 (Phone Android / Wear OS / Desktop V6) **共用语义**与**容许差异**的明确边界。本文档 baseline 仅落地"GA-独立"的硬约束；GA 反馈到位后 v0.2 复评 P1 主体边界。
> **不涉及**: Auto (车载) — 见 Android 重新定位文档 ADR-4 / Wear 已有专文 (§5)

---

## 0. 目标

回答三个问题：
1. **必须一致**：哪些视觉/交互信号在三端语义不能漂移（否则用户认知断裂）？
2. **必须不同**：哪些必须按 surface native 风格走（否则违反 platform HIG）？
3. **现有偏差**：现状哪些项需要 sweep 收口？

---

## 1. 三端 surface inventory（2026-05-15 真实代码）

| Surface | 路径 | 主题机制 | 主色 | DID 短显示 | m-of-n 展示 |
|---|---|---|---|---|---|
| **Phone Android** | `android-app/app/` + `core-ui/` | Material3 `ChainlessChainTheme` (`Theme.kt`) | Claude Coral `#D97757` (light + dark)；error `#B3261E` light / `#E36F61` dark | `take(10) + '…' + takeLast(6)` (`MultisigState.shortDid`) | `progressLabel() = "${collected+1} / $m"` |
| **Wear OS** | `android-app/wear-app/` | 默认 Wear Compose `MaterialTheme` (无自定义 palette) | Wear Material 默认 primary | `take(20) + '...' + takeLast(8)` (`MyQRCodeScreen.kt`) | (未实现 — Wear approval 当前只显示 amount + 同意/拒绝) |
| **Desktop V6** | `desktop-app-vue/src/renderer/shell-preview/` + `packages/web-panel/` | CSS custom properties `--cc-*` (`design-tokens.css`) + Ant Design Vue | Ant blue `#1677ff`；danger `#f5222d`；success `#52c41a`；warning `#faad14` | 3 个变体不统一：`(0,16)+'...'+(-8)` / `(0,12)+'...'+(-8)` / `(0,16)+'…'+(-6)` | 3 种格式：`${m}/${n}` (list tag) / `${m}-of-${n}` (policy header) / `${sigs.length} / ${thresholdM}` (drawer) |

**核心观察**：Phone 走 Claude 暖色品牌、Desktop 走 Ant 冷蓝企业风。这是 **故意的** — 各 surface 跟用户在该 surface 的同类应用 mental model 对齐。但 **DID 短显示**与 **m-of-n 进度**这两类信号应该跨 surface 形态一致（同一 proposal 在手机看跟桌面看应该一目了然是同一笔）。

---

## 2. 必须一致 (must-be-consistent) — 4 条硬规则

### 2.1 语义颜色：高风险红 / 低风险绿 / 中性灰

不是说三端 hex 完全相同（HIG 各异），而是**用法语义对齐**。

| 语义 | 用法 | Phone (Material3) | Wear | Desktop V6 (Ant) |
|---|---|---|---|---|
| **Primary** | 品牌识别 / 主 CTA | `ClaudeCoral #D97757` | Wear Material default | `--cc-primary: #1677ff` |
| **Success** | 操作完成 / 状态绿 | `MaterialTheme.colorScheme.tertiary` 或 custom green | (避免，watch 信息密度低) | `--cc-success: #52c41a` |
| **Warning** | 需注意 / 中等风险 | (case-by-case，避免用 primary 替代) | (避免，用 vibration) | `--cc-warning: #faad14` |
| **Danger / Error** | **高风险** / 不可撤销 | `MaterialTheme.colorScheme.error` | `MaterialTheme.colors.error` | `--cc-danger: #f5222d` |

**Rule 2.1.a — 高风险红**：任何**涉及私钥签名 / m-of-n 阈值跨越 / DID rotate / 跨链桥 outbound / 大额支付**的最终确认按钮，三端**必须**用 `error/danger` 色（红系），**不允许**用 warning（橙）替代。

**Rule 2.1.b — 反例**：成功 toast 不允许用红；普通"删除"按钮可以用 warning 而非 danger（区分"可撤销删除"与"不可撤销链上操作"）。

### 2.2 DID 短显示 (canonical helper)

**Rule 2.2.a — 三档语境**：
| 语境 | 格式 | 字符数 | 例 |
|---|---|---|---|
| **Compact** (表格 / 列表 / Wear 1 行) | `head(12) + '…' + tail(6)` | ~19 | `did:cc:test-bu…-abc1` |
| **Standard** (卡片 header / drawer title) | `head(20) + '…' + tail(8)` | ~29 | `did:cc:test-buyer-pr…-bc1d2e3f` |
| **Full** (详情页 / QR / 复制按钮) | 无截断 | 完整 | `did:cc:test-buyer-proposal-001-abc1d2e3f4` |

**Rule 2.2.b — 省略号 `…` (U+2026)**，不用三个点 `...`。原因：单字符占位、视觉密度低、不会跟 ASCII 数据混淆。

**Rule 2.2.c — Helper 落点**：每端落一个共享 helper，名字一致 (`shortDidCompact` / `shortDidStandard`)。

| Surface | Helper 位置（建议） | 现状 |
|---|---|---|
| Phone Android | `android-app/core-ui/src/main/java/com/chainlesschain/android/core/ui/text/DidFormat.kt` | ⚠️ `MultisigState.shortDid` 内联，未提取，threshold 16 不一致 |
| Wear | reuse Android `core-ui` (multi-module dependency) | ⚠️ `MyQRCodeScreen.kt` 内联 `take(20) + '...' + takeLast(8)` |
| Desktop V6 main / renderer | `desktop-app-vue/src/renderer/utils/did-format.ts` | ❌ 未抽出 |
| Desktop V6 web-panel | `packages/web-panel/src/utils/did-format.ts` | ❌ 现 3 个 view 各自定义 `shortDid` |

### 2.3 m-of-n 进度展示

**Rule 2.3.a — 三种语境**：
| 语境 | 格式 | 例 |
|---|---|---|
| **签名进度** (proposal in flight) | `${collected} / ${threshold}` 带空格 | `2 / 3` |
| **策略 header** (policy summary) | `${m}-of-${n}` 连字符 | `2-of-3` |
| **达阈勾标** (UI badge) | `${sigs}/${threshold}` 紧凑 + 颜色 (cyan 达阈, default 未达) | `2/3` 浅蓝 / `1/3` 灰 |

**Rule 2.3.b — 进度推进语义**：`collected` 永远指**已签名计数**，不要混入"本设备签完后的预测计数"。Android `MultisigState.progressLabel()` 当前用 `collected+1` 是 phone-side 预演 — 文档建议**提示文案分开**：`"已签 2 / 阈值 3"` (Standard) 或 `"再签 1 个 → 完成"` (action hint)。

**Rule 2.3.c — 算法标识**：当 multisig 涉及 hybrid Ed25519+SLH-DSA（[mtc_publisher_sig_threshold.md](默克尔树证书_MTC_落地方案.md)），三端 UI **可以**用 small badge 显示 `Ed25519+SLH-DSA` 算法名（详 [B5 spike](B5_Crosschain_Outbound_Multisig_spike.md) PR2 hybrid 案例），但不要强行展示给非技术用户。

### 2.4 高风险操作的"二次确认"语义

**Rule 2.4.a — 强制二次确认**：以下 5 种操作三端**必须**有二次确认，**不允许** single-tap commit：

1. 私钥导出 / 导入
2. DID rotate（v1.3+ B.3）
3. m-of-n 提案签名（marketplace.purchase / crosschain.bridge.outbound / did.rotate）
4. 跨链桥 outbound 发起（amount ≥ marketing-defined 阈值）
5. 数据擦除 / 设备解绑

**Rule 2.4.b — 二次确认形态按 surface 选**：

| Surface | 二次确认实现 |
|---|---|
| Phone | BiometricPrompt (`AndroidApprovalGate.kt`) — 优先 face/fingerprint，fail-safe deny |
| Wear | BiometricPrompt (Wear 4+) + 短 vibration — 同 phone 但 prompt 文案缩短 ≤ 30 字符 |
| Desktop V6 | Modal.confirm + `okType: 'danger'` + 输入密码或调用 U-Key (优先 U-Key) — 现 `Multisig.vue` `onCancel` 用 `Modal.confirm` 模板可复用 |

**Rule 2.4.c — Payload hash 显示**：所有签名操作**必须**显示 payload SHA-256 前 8 字符 + 后 4 字符 hex（共 13 字符），让用户至少有 base 视觉指纹比对。已实现：`mobile-approval-channel.js` 算 `payloadHash` recursive canonical-JSON + SHA-256 hex 64-char（v0.7 落，参 Android 重新定位 §6 M4 D2）。Phone 端 `ApprovalDialogHost.kt` 已展示，Wear 当前未展示（fix opportunity），Desktop V6 Multisig.vue drawer 当前展示 `payloadJcs` 全量 + `payloadHash` hex — 应改成短码 + 点击展开全量。

---

## 3. 必须不同 (must-be-different) — 4 条 surface-native 边界

### 3.1 Wear 专属

- **大按钮强制**：所有 tap target ≥ 48dp 高、`fillMaxWidth()` 横满；按钮文字 ≤ 4 字符（"同意" / "拒绝" / "查看"）。**禁止**并排按钮（圆表 / 矩形表都布局困难）。
- **单列布局**：所有 list / form 必须纵向 stacked column，不允许 Row 多列。
- **vibration 替代警告色**：高风险路径用 vibration pattern 区分（100ms entry + 50ms tap on approve；deny 不震动节省电），不依赖颜色对比度（圆表反射场景多）。
- **DID 强制 Compact 模式**：永远走 `shortDidCompact`；超 1 行强制截断不允许换行。
- **不展示完整 payload hash**：Wear 屏幕只能放 ≤ 60 字符，payload hash 13 字符占用太多 — 用图标 + "已校验" 替代。

### 3.2 Desktop V6 专属

- **侧栏 ProjectsPanel / MainLayout**：手机/手表**不复制**侧栏概念。手机用 BottomSheet drawer，手表用 ApprovalCard list。
- **详情 Drawer 宽度 600-720px**：手机用 BottomSheet 替代，全屏 push 替代。
- **表格 (`a-table`) 多列对齐**：手机/手表用 list / card 替代，不允许横向滚动。
- **键盘快捷键 (Cmd/Ctrl)**：手机/手表无键盘语境，不实现。

### 3.3 Phone 专属

- **BottomSheet 替代 Drawer**：drawer 在 Material3 仅用作 NavigationDrawer，不用 detail drawer；用 `ModalBottomSheet`。
- **BiometricPrompt 替代密码框**：高风险路径不允许密码输入框（除非 BiometricPrompt 不可用的 fail-safe）。
- **键盘 keyboard adjustment**：表单页面必须 `Modifier.imePadding()`，桌面无需。
- **Pull-to-refresh**：list 页面用 `PullRefreshIndicator`，桌面用 button refresh。

### 3.4 Auto (车载，与本文 ADR-4 互补)

- **语音 only**：禁止 touch (driving safety 合规)。语音 confirm/deny ApprovalUI 走 `cc.voice.start` IPC（参 Android 重新定位文档 §10 C.1 — 当前 Auto 私有，C.1 要求 generic 化）。
- **不显示**完整 payload hash / DID — 语音只播报短描述 + amount。
- **背景色**永远高对比度 (driving distraction 合规)；Color.Background = Material `surface` 的高亮版本，不允许暗色模式。

---

## 4. 现有偏差 sweep（opportunistic v0.2 触发）

按 P1 主体启动顺序处理，**baseline (v0.1) 不做硬性 sweep**，等 GA 反馈到位后 v0.2 再决定哪些 must-fix vs nice-to-have。

| 偏差 | 位置 | 当前 | 目标 | 工期 |
|---|---|---|---|---|
| DID short 字符数不一致 | `web-panel/src/views/Community.vue:328` / `DID.vue:280,407` / `Marketplace.vue:386` | `(0,16)+'...'+(-8)` × 3 + `(0,12)+'...'+(-8)` | 抽 `shortDidStandard` helper，threshold 24 字符 | ~0.3d |
| DID short 省略号字符 | 同上 | `'...'` (ASCII 3 字符) | `'…'` (U+2026 1 字符) | included above |
| Android DID short threshold 16 vs 24 | `MultisigState.kt:58` | `if (length <= 16) return did` | 抽 `core-ui DidFormat.kt`，threshold 与 Desktop 对齐 | ~0.2d |
| Wear DID 显示模式 | `MyQRCodeScreen.kt:165` | `take(20) + '...' + takeLast(8)` (Standard) | 改 `shortDidCompact` (Compact) — Wear 1 行约束 | ~0.1d |
| m-of-n 列表 tag 格式 | `Multisig.vue:103` | `${m}/${n}` 无空格 | `${m} / ${n}` 带空格 (matches Rule 2.3.a "签名进度") | ~0.1d |
| Wear payload hash 显示 | `WearApprovalActivity.kt` ApprovalContent | 未展示 | 加 "已校验 ✓" 图标 + tap 展开（不展开 hash 文字本身） | ~0.2d |

**总工 ~0.9d**，可在 P1 主体启动期间作 opportunistic 切，不单独排 sprint。

---

## 5. GA-dependent 复评（v0.2 触发条件）

下列项 baseline 不写死，等 GA 上架 + 真用户反馈到位后再复评：

- **DID short 长度阈值 24 vs 28**：现 web-panel 用 28，Android 用 16/不限；GA 用户实测 Play Console 截图反馈来定（如果用户多在小屏 list 看，倾向短一些；如果多在 detail 页，可放宽）。
- **是否需要 nickname / avatar 替代 DID 字符串**：本 baseline 都是字符串；如果 GA 反馈"DID 太密看不懂"，v0.2 引入 nickname （social DID 已有 nickname 字段，参 [02_去中心化社交模块.md](modules/02_去中心化社交模块.md)）。
- **m-of-n hybrid algorithm badge 是否展示给非技术用户**：现默认隐藏；如果 NIST 监管类客户 GA 后出现，v0.2 加 settings 开关。
- **必须一致 color 边界**：现仅要求"语义对齐"，未要求 hex 完全相同；如果 GA 反馈"切换设备时 primary 完全不同色让人困惑"，v0.2 评估是否拉齐 hex。
- **二次确认形态匹配 surface**：现按 Phone=Biometric / Desktop=U-Key+Modal / Wear=Biometric 区分；GA 反馈如果"切换设备时同一操作的确认手感差异大"，可能要求 Modal 文案完全对齐。

---

## 6. 实施进度

| 项 | 状态 | 备注 |
|---|---|---|
| §1 inventory | ✅ 2026-05-15 baseline 摸底 | 真实代码扫描，含 source-of-truth 文件路径 |
| §2 4 条 must-be-consistent rules | ✅ baseline 落地 | GA 反馈后 v0.2 复评边界 |
| §3 4 条 must-be-different rules | ✅ baseline 落地 | Auto/Wear/Phone/Desktop 各自 native HIG |
| §4 现有偏差 sweep | ⏳ opportunistic | P1 主体启动期间顺手切，~0.9d 总工 |
| §5 GA-dependent 复评 | ⏳ v0.2 触发 | 等 Play Console 数据 + 真用户反馈 |
| §2.2 DID helper extraction | ⏳ 当 §4 sweep 时同步落 | Phone / Wear / Desktop V6 / web-panel 4 处 |
| §2.4.c Payload hash 短码改造 | ⏳ Wear + Desktop V6 各 1 处 | Wear 不展示 hash 文字 / Desktop 改短码 + tap 展开 |

---

## 7. 与现有设计文档的关系

| 文档 | 关系 |
|---|---|
| [Android 重新定位 §10 A.2](Android_重新定位_设计文档.md) | issue #21 A.2 的设计 single-source；本文档是 A.2 的 baseline 实施细节 |
| [Android 重新定位 §10 C.1](Android_重新定位_设计文档.md) | Wear watch face VoiceMode 与 Auto `cc.voice.start` IPC generic 化前置 — 本文档 §3.4 引用 |
| [MofN 多签应用扩展 §8](MofN_多签_应用扩展_v1.md) | Desktop V6 / Mobile / web-panel UI 的 m-of-n 形态 — 本文档 §2.3 形式化 + §4 现有偏差 sweep |
| `desktop_v6_p7_preview_shell.md` (memory) | Desktop V6 shell `--cc-preview-*` token 命名约定 — 本文档 §1 引用 |
| `screenshot_ocr_cross_shell_memo.md` (memory) | 三端 LLM OCR 跨壳 wiring — 类似"必须一致"案例，本文档不重复 |

---

## 变更记录

- 2026-05-15 v0.1：A.2 baseline 收稿。三端 inventory + 4 must-be-consistent + 4 must-be-different + opportunistic sweep 清单。GA 反馈到位后触发 v0.2 复评 P1 主体边界。

## 附录：规范章节补全（v5.0.3.108）

> 本文为设计文档。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。三端 UI Consistency 设计（v0.1）：桌面/移动/Web 三端 UI 一致性。

### 2. 核心特性
三端一致性 / UI 对齐 / 信息架构。

### 3. 系统架构
见正文架构 / 设计章节。

### 4. 系统定位
ChainlessChain 的「三端 UI 一致性」。

### 5. 核心功能
见正文功能 / 设计章节。

### 6. 技术架构
见正文实现 / 技术章节。

### 7. 系统特点
见正文（状态 / 版本 / 特性）。

### 8. 应用场景
见正文应用场景 / 背景。

### 9. 竞品对比
见正文对比 / 借鉴（如有）。

### 10. 配置参考
见正文配置 / 参数章节。

### 11. 性能指标
见正文性能 / 指标章节。

### 12. 测试覆盖
见正文测试 / E2E 章节。

### 13. 安全考虑
见正文安全 / 权限章节。

### 14. 故障排除
见正文故障 / trap / 已知限制章节。

### 15. 关键文件
见正文实现位置 / 关键文件章节。

### 16. 使用示例
见正文使用 / 命令 / API 示例。

### 17. 相关文档
[系统设计主文档](./系统设计_主文档.md)、相关设计文档。
