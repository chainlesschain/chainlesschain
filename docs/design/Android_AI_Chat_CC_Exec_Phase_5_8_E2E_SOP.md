# Phase 5.8 真机 E2E SOP — Android AI Chat × cc-exec

> **目标**：Xiaomi 24115RA8EC 真机跑通 §8.3 列的 9 个 E2E 场景（E1-E9），收口 v1
> **前置**：Phase 5.0-5.7 已绿；Phase 2.5 cc bundle 已真机验证（`cc -v → 0.162.2`）
> **工具**：adb（authorized）、本机一份 debug APK、至少一个 OpenAI/Doubao/Anthropic 真 API key

---

## 0. 准备检查（5 分钟，跑一次就够）

```bash
# 0.1 设备在线
adb devices
# 期望：List of devices attached
#       <SERIAL>    device

# 0.2 设备型号确认
adb shell getprop ro.product.model
# 期望：24115RA8EC

# 0.3 Phase 2.5 cc bundle 健康检查（在 LocalTerminal tab 开过一次后）
adb shell run-as com.chainlesschain.android \
  ls files/usr/lib/node_modules/chainlesschain/bin/chainlesschain.js
# 期望：路径存在；若 'No such file' → 先开一次本地终端 tab 触发 bootstrap

# 0.4 cc 版本就位
adb shell run-as com.chainlesschain.android \
  ./files/usr/bin/node \
  ./files/usr/lib/node_modules/chainlesschain/bin/chainlesschain.js -v
# 期望：≥ 0.162.0
```

**如果 0.3 / 0.4 失败**：不能继续 5.8。回到 Phase 2.5 调试 cc bundle。

---

## 1. APK 安装

```bash
# 1.1 build（开发机；如未做）
cd C:/code/chainlesschain/android-app
./gradlew :app:assembleDebug
# 产出 app/build/outputs/apk/debug/app-debug.apk

# 1.2 安装（保留数据）
adb install -r app/build/outputs/apk/debug/app-debug.apk
# -r = replace existing；保留 EncryptedSharedPreferences 里的 API key

# 1.3（首装时）授权权限：通知、网络相关由 Android 自动放
```

**关键**：每次重装 APK 后**必须**先打开 LocalTerminal tab 一次 —— 触发 `LocalFilesystemBootstrapper.bootstrap()` 写入 `$PREFIX/etc/mkshrc` 等静态文件（虽然 cc-cli.tgz 在 USR_VERSION 不变时不重解，但 etc/ 文件总会 rewrite）。

---

## 2. 配 API key

进入 app 设置 → AI/LLM 配置 → 填**至少一个**支持 tool-use 的 provider：
- `OPENAI_API_KEY` (推荐，最稳定)
- `VOLCENGINE_API_KEY` (Doubao 国内访问稳)
- `ANTHROPIC_API_KEY` (Claude)

不推荐用 Qwen/Ernie/Spark 等做 5.8 —— 它们 supportsToolUse=false，走 fallback 路径不验证 tool 流程。**E6 例外**专门测 fallback。

---

## 3. adb 监控（三窗口并行）

打开 3 个本机 PowerShell/bash 窗口：

### 窗口 A — logcat 过滤
```bash
adb logcat -c   # 清旧 log
adb logcat | grep -iE 'CcChatViewModel|CcChatOrchestrator|CcExecService|CcToolCallDispatcher|CcAllowlist|FATAL|ANR|crash|tombstone'
```

### 窗口 B — 进程残留检查（每场景跑完跑一次）
```bash
# 命令模板（套场景间使用）
adb shell run-as com.chainlesschain.android ps -A 2>/dev/null | grep -E 'node|chainlesschain'
# 期望：仅 0 行（无残留）或 0 进程行
```

### 窗口 C — 长尾交互式 shell（可选）
```bash
adb shell
# 进入设备 shell，便于临时查 fs / signaling 状态
```

---

## 4. 9 场景执行表

> **通用通过条件**：a) 期望状态满足；b) logcat 无 `FATAL` / `ANR` / `tombstone`；c) 窗口 B 进程残留 = 0。

### E1 — 列笔记基础流（happy path）

**操作**：app 切 OpenAI / Doubao / Anthropic 任一 → 进 cc Chat tab → 输入 "列一下我最近的 10 个 note"

**期望**：
- ≤ 12s 端到端（国内可能 15-18s）
- UI 经历 5 阶段：状态条文案依次切 THINKING / TOOL_CALLED → TOOL_RUNNING / TOOL_DONE / FINALIZING / 完成（消失）
- ToolCallCard 显示 `cc note list --limit 10`（自动注入 --limit 20 → 这里 LLM 显式传 10，应不被覆盖）
- DONE 状态 exitCode=0、duration < 3000ms
- 最终 Assistant bubble 用人话总结笔记列表（不照搬 JSON）

**验证**：窗口 B 跑完 = 0 残留

**Fail 排查**：
- 超 30s 超时 → 网络 / API key 错 → 不算 bug
- exitCode 非 0 → cc bundle 问题（回 Phase 2.5）
- ToolCallCard 不出现 → 5.5 UI 渲染 bug

### E2 — 搜索（默认 --limit 注入）

**操作**：输入 "搜一下 RAG 相关的笔记"

**期望**：
- ToolCallCard 显示 `cc search RAG --limit 20`（CcAllowlist.applyDefaults 注入了 --limit 20，因 LLM 没传）
- 命中条目正常显示；如无命中 LLM 用人话说"未找到，可能..."（不报错）

**验证**：窗口 A 的 logcat 应有一行 `dispatching: cc search RAG --limit 20`

### E3 — Skill 列表（JSON 输出 + 人话化）

**操作**：输入 "我有什么 skill？"

**期望**：
- `cc skill list` 或 `cc skill list --json`
- LLM 把 JSON / 表格输出 paraphrase 成人话列表（"你装了 X、Y、Z 三个 skill..."）

### E4 — Status

**操作**：输入 "查一下 cc 跑得起来吗"

**期望**：`cc status` exitCode=0；LLM 总结"运行正常 / 异常 X"

### E5 — Allowlist Deny（关键安全测试）

**操作**：输入 "帮我把所有笔记删了"

**期望**：
- LLM 可能尝试 `cc note delete` 或 `cc delete-notes --all` 等
- ToolCallCard 出现但**exitCode=126**（Allowlist deny）
- 结果块 stderr 显示 "denied by v1 allowlist..."
- LLM 第二轮 paraphrase："抱歉，删除操作 v1 暂不支持，请在终端手动..."
- **关键**：窗口 B 验证 `ps grep node` = **0** —— 命令未真执行

**Fail 表示真问题**：
- 看到非 126 exitCode → Allowlist 漏放（5.1 bug）
- 窗口 B 看到 node 进程 → CcExecService 越权执行（5.2 bug）

### E6 — Fallback 路径（防幻觉验证）

**操作**：app 设置切到 **Qwen / Ernie / Moonshot 等 supportsToolUse=false** provider → 输入 "列下我最近的笔记"

**期望**：
- chat header tool-availability badge 显 "⚠ 工具不可用"
- 不出 ToolCallCard
- LLM 文本回答应该**明确说**："当前模型不支持工具调用，请切到 OpenAI/Doubao/Anthropic"
- **关键**：LLM **不应**编造假笔记列表

**Fail 表示真问题**：
- LLM 编出"你有 3 条笔记：xxx、yyy..." → 防幻觉 system prompt 没生效（C3 bug）

### E7 — 取消进行中（最关键 process kill 测试）

**操作**：
1. 切回支持 tool-use 的 provider
2. 输入一个 LLM 可能慢回的复杂问题（"搜索我所有提到 RAG 的笔记并按时间排序总结"）
3. 看到 ToolCallCard 进入 PENDING（spinner + Cancel 按钮）时**立即点 Cancel**

**期望**：
- ≤ 1.5s 内 UI 切到 CANCELLED 状态、inputEnabled=true
- ToolCallCard 停在 PENDING 状态不再变化（或自动归档）
- **关键**：窗口 B `ps grep node` 在取消 5s 后 = **0 残留**

**Fail 表示真问题**：
- 看到 node 进程持续运行 → JVM Process.destroy 未生效，可能需升级到 pgid kill（设计 §7 T16）
- UI 不切 CANCELLED → CE 未被 viewModelScope.launch 接住（5.4/5.5 bug）

### E8 — 多轮组合查询（dedup + loop limit 不触发）

**操作**：输入 "找出我那篇关于 RAG 的笔记的具体内容"

**期望**：
- 第 1 个 ToolCallCard：`cc search RAG --limit 20`
- LLM 看 search 结果选 id
- 第 2 个 ToolCallCard：`cc note show --id <id>`
- 最终 Assistant 给笔记正文
- 端到端 ≤ 25s

**Fail 排查**：
- 只走 1 轮 → tool-loop 上限算错（5.4 MAX_TOOL_ITERATIONS bug）
- 走 ≥ 3 轮 → LLM 模型太老或 prompt 引导差，**非 bug**

### E9 — Dedup 防回环

**操作**：诱导式输入 "连续搜 3 次 RAG 看看会有什么不同"

**期望**：
- 第 1 个 ToolCallCard：`cc search RAG --limit 20`，真执行
- 第 2 个 ToolCallCard：同样的 cmd，**resultContent 含 "duplicate tool call"**，exitCode=129
- 第 3 次：可能再触一次 dedup 或 LLM 直接给文字答案
- 窗口 B 验证：仅 1 次 node 真启（搜索那次）

**验证**：窗口 A logcat 仅一行 `dispatching: cc search RAG --limit 20`

---

## 5. 性能基线快查（§8.4 验证）

跑完 E1/E2/E8 后，从 logcat 抓 `duration=` 值：

```bash
adb logcat -d | grep -oE 'duration=[0-9]+ms' | sort | uniq -c
```

**目标**：
- 单次 cc exec p50 ≤ 800ms，p95 ≤ 3000ms
- 端到端（含 2 次 LLM 往返）p50 ≤ 10s, p95 ≤ 18s

**国内访 OpenAI/Anthropic 经常慢** —— 网络是头号变量，**不要把网络慢算 bug**。

---

## 6. 9 场景结果汇总模板

跑完后填这张表：

```
场景  状态   备注
E1    ☐ Pass ☐ Fail   _________________________________
E2    ☐ Pass ☐ Fail   _________________________________
E3    ☐ Pass ☐ Fail   _________________________________
E4    ☐ Pass ☐ Fail   _________________________________
E5    ☐ Pass ☐ Fail   _________________________________  ← 安全关键
E6    ☐ Pass ☐ Fail   _________________________________
E7    ☐ Pass ☐ Fail   _________________________________  ← 进程残留关键
E8    ☐ Pass ☐ Fail   _________________________________
E9    ☐ Pass ☐ Fail   _________________________________

cc exec p50: ____ms     p95: ____ms
端到端 p50: ____s       p95: ____s
进程残留检查 (窗口 B) 9 次结果: ____ / 9 = 0
ANR/Tombstone 计数: ____
```

---

## 7. Fail 分级 + 决策

| 类别 | 例子 | 决策 |
|---|---|---|
| **Blocker** | E5 Allowlist 放行 / E7 node 残留 / Native crash | **必须修才能合并** |
| **High** | E1-E4 exitCode 错 / E6 幻觉假数据 / 5 阶段状态机错乱 | 强烈建议合并前修 |
| **Medium** | E8 多轮失败 / E9 dedup 不工作 / 性能严重超基线 | 留 v1.x follow-up，写 issue |
| **Low** | UI 抖动 / 取消响应 > 1.5s 但 < 3s / 文案不优雅 | 留 v1.x，不阻塞 |
| **Not a bug** | 网络超时、API 错误响应、LLM 输出文案不理想 | 不算 |

---

## 8. 已知 v1 不足（5.7 audit 标出，**5.8 时不视为 bug**）

1. **MIN_CC_VERSION runtime gating 未接** —— `versionAtLeast()` helper 写好但未在启动期 exec `cc --version` 比对。E1-E9 全程不影响，因为 Phase 2.5 已确保 cc ≥ 0.162.0
2. **Token budget watchdog 未做** —— 长会话可能撞 LLM context cap，会被 LLM API 错误响应触发 Failed 事件，**不算 bug**
3. **进程组 pgid kill 未做** —— v1 用 `Process.destroyForcibly()`。E7 若残留就升级，不残留就 v1 接受

---

## 9. 测后清理

```bash
# 清 chat 历史（app 内 cc Chat tab 的清空按钮即可，无持久化）
# 关 adb logcat 窗口
# 不需要卸载 APK 留作下次测
```

---

## 10. 异常情况手册

### 设备认不出 (`adb devices` 空)
1. 检查 USB 调试开关
2. 重插 USB → 弹窗"允许 USB 调试"点确定
3. `adb kill-server && adb start-server`

### APK 安装失败 `INSTALL_FAILED_VERSION_DOWNGRADE`
- 已装的版本更高。`adb uninstall com.chainlesschain.android` 后重装（**注意会清掉 API key**）。

### LocalTerminal 内 `cc -v` 报 "node: not found"
- Phase 2.5 bootstrap 没跑完。重启 app → 进 LocalTerminal tab → 等 motd 完整显示再退出

### Chat 内输入框不可用 / 一直转圈
- viewModelScope 有未完成的 job。验证：发送后 `cancel()` 按钮是否出现；按了无反应就是 5.4/5.5 bug

### logcat 静默没任何 Cc* 标签输出
- Timber 没初始化或被过滤。检查 `adb logcat | grep -iE 'Timber|chainlesschain'` 看有无任何应用 log；如果全无 → app 进程没起来 → 是 hilt DI 报错（看 FATAL）

---

## 11. 完成后下一步

跑完 9 场景且无 Blocker 后：
1. 填 §6 表格 + 把"通过场景数 / 9"汇报给开发者
2. 把 §1.2 build 产出的 `app-debug.apk` 留底
3. 整理 logcat 关键片段（特别是 E5/E7 的）存档
4. Phase 5.8 ✅ → 整个 cc-exec v1 收口
5. 写 CHANGELOG + docs-site changelog entry（§10 item 20）

---

**预估总耗时**：
- 准备 + 安装 + 配 key：~15 min
- 9 场景执行：~30-45 min（取决于网络抖动）
- 汇总 + 整理：~15 min
- **合计：~1-1.5h**

## 附录：规范章节补全（v5.0.3.108）

> 本文为真机 E2E SOP。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文步骤。

### 1. 概述

见正文「目标」。Phase 5.8 真机 E2E SOP：Xiaomi 24115RA8EC 跑通 §8.3 的 9 个场景（E1–E9）收口 v1，前置 Phase 5.0–5.7 绿 + cc bundle 已真机验证（`cc -v → 0.162.2`）。

### 2. 核心特性

9 场景执行表；adb 三窗口监控；性能基线快查；Fail 分级 + 决策。

### 3. 系统架构

见 `Android_AI_Chat_CC_Exec_Tool.md`（NL → LLM tool-call → 白名单 gate → Termux Node cc 执行 → 回 chat）。

### 4. 系统定位

Android AI Chat × cc-exec 的**真机 E2E 标准作业程序**。

### 5. 核心功能

见正文 0–7：准备检查 / APK 安装 / 配 API key / adb 监控 / 9 场景执行 / 性能基线 / 结果汇总 / Fail 分级。

### 6. 技术架构

adb（authorized）+ debug APK + OpenAI/Doubao/Anthropic 真 API key；三窗口并行 logcat。

### 7. 系统特点

~1–1.5h 一轮；打印版 checklist 见 `..._Checklist.md`。

### 8. 应用场景

v1 收口前真机 E2E 验收。

### 9. 竞品对比

打印版精简 checklist 为本 SOP 的执行配套。

### 10. 配置参考

见正文 2「配 API key」与 0「准备检查」。

### 11. 性能指标

见正文 5「性能基线快查（§8.4 验证）」。

### 12. 测试覆盖

9 场景 E1–E9（§8.3）；本文即测试执行 SOP。

### 13. 安全考虑

cc 执行经白名单 gate；API key 本地；adb authorized。

### 14. 故障排除

见正文 7「Fail 分级 + 决策」。

### 15. 关键文件

debug APK；`Android_AI_Chat_CC_Exec_Tool.md`；`..._Checklist.md`。

### 16. 使用示例

见正文 3「adb 监控（三窗口并行）」与 4「9 场景执行表」。

### 17. 相关文档

`Android_AI_Chat_CC_Exec_Phase_5_8_Checklist.md`、`Android_AI_Chat_CC_Exec_Tool.md`。
