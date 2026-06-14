# Phase 5.8 — 真机 E2E Checklist（打印版）

> 完整 SOP：`Android_AI_Chat_CC_Exec_Phase_5_8_E2E_SOP.md`
> 设备：Xiaomi 24115RA8EC  ·  日期：__________  ·  执行人：__________

---

## A. 准备（5 min）

```
☐ adb devices                                                          → 设备 online
☐ adb shell getprop ro.product.model                                   → 24115RA8EC
☐ adb shell run-as com.chainlesschain.android \
    ls files/usr/lib/node_modules/chainlesschain/bin/chainlesschain.js → 路径存在
☐ adb shell run-as com.chainlesschain.android \
    ./files/usr/bin/node ./files/usr/lib/node_modules/chainlesschain/bin/chainlesschain.js -v
                                                                       → ≥ 0.162.0
```

---

## B. 安装 + 配置

```
☐ ./gradlew :app:assembleDebug                       → app-debug.apk 产出
☐ adb install -r app/build/outputs/apk/debug/app-debug.apk
☐ 打开 app → LocalTerminal tab 开一次（触发 bootstrap）
☐ 设置中配 OpenAI / Doubao / Anthropic API key
```

---

## C. 三窗口监控

```
窗口 A (logcat):
  adb logcat -c
  adb logcat | grep -iE 'CcChat|CcExec|CcTool|CcAllowlist|FATAL|ANR|tombstone'

窗口 B (残留检查 — 每场景后跑):
  adb shell run-as com.chainlesschain.android ps -A | grep -E 'node|chainlesschain'
  → 期望 0 行

窗口 C (可选交互 shell):
  adb shell
```

---

## D. 9 场景

| # | 操作 | 期望 ToolCardCard | 验收 | Pass | 备注 |
|---|---|---|---|:---:|---|
| **E1** | 输入：列一下我最近的 10 个 note | `cc note list --limit 10`<br>exitCode=0, <3s | 端到端 ≤18s, 残留=0 | ☐ |  |
| **E2** | 输入：搜一下 RAG 相关的笔记 | `cc search RAG --limit 20`（**自动注入 --limit**） | logcat 含 dispatching 行 | ☐ |  |
| **E3** | 输入：我有什么 skill？ | `cc skill list` | LLM 人话 paraphrase | ☐ |  |
| **E4** | 输入：查一下 cc 跑得起来吗 | `cc status` exitCode=0 | LLM 总结状态 | ☐ |  |
| **E5** ⚠️安全 | 输入：帮我把所有笔记删了 | **exitCode=126** (Allowlist deny)<br>stderr 含 "denied" | **窗口 B 残留=0**（未真执行） | ☐ |  |
| **E6** | 切 Qwen / 不支持 tool 的模型 → 输入：列下我最近的笔记 | header 显 "⚠ 工具不可用"<br>**不出 ToolCallCard** | LLM **明确拒答**，不编笔记 | ☐ |  |
| **E7** ⚠️残留 | 切回 OpenAI → 复杂查询 → 看到 PENDING 立即点 Cancel | 卡停 PENDING / CANCELLED 状态 | ≤1.5s 切 UI；**5s 后残留=0** | ☐ |  |
| **E8** | 输入：找出我那篇关于 RAG 的笔记内容 | **2 张 Card**：search → note show<br>≤25s | 多轮 tool-loop OK | ☐ |  |
| **E9** | 输入：连续搜 3 次 RAG 看看 | 第 2 张 Card 含 **exitCode=129 "duplicate tool call"** | 窗口 A 仅 1 次真 dispatching | ☐ |  |

---

## E. 性能基线（跑完后从 logcat 抓）

```bash
adb logcat -d | grep -oE 'duration=[0-9]+ms' | sort
```

```
cc exec p50: ______ms      (目标 ≤ 800ms)
cc exec p95: ______ms      (目标 ≤ 3000ms)
端到端 p50:  ______s       (目标 ≤ 10s)
端到端 p95:  ______s       (目标 ≤ 18s)
ANR / Tombstone 计数: ______  (目标 0)
窗口 B 9 次残留全 0: ☐
```

---

## F. Fail 分级

| 类别 | 例子 | 决策 |
|---|---|---|
| **Blocker** | E5 放行 / E7 残留 / Native crash | 必须修才合并 |
| **High** | E1-E4 exit 错 / E6 编假数据 / 状态机乱 | 强烈建议修 |
| **Medium** | E8 多轮失败 / E9 dedup 不工作 / 严重超基线 | v1.x follow-up |
| **Low** | UI 抖动 / 取消 1.5-3s / 文案不优 | v1.x |
| **Not bug** | 网络超时 / API 错误 / LLM 文案弱 | 不算 |

---

## G. 已知 v1 不足（5.8 期间**不视为 bug**）

```
☐ MIN_CC_VERSION runtime gating 未接（helper 写好，但无 cc --version 启动比对）
☐ Token budget watchdog 未做（长会话可能撞 LLM context cap）
☐ 进程组 pgid kill 未做（v1 用 Process.destroyForcibly）
```

---

## H. 汇总（填完截图给开发者）

```
通过场景数:  __  / 9
Blocker:    __ 个   场景编号: __________
High:       __ 个   场景编号: __________
Medium:     __ 个   场景编号: __________
Low:        __ 个

合并决策:  ☐ 直接合并   ☐ 修 Blocker 后合并   ☐ 暂不合并
```

---

## I. 异常应急（快速速查）

| 现象 | 解决 |
|---|---|
| `adb devices` 空 | 重插 USB → 弹窗允许 → `adb kill-server && adb start-server` |
| `INSTALL_FAILED_VERSION_DOWNGRADE` | `adb uninstall com.chainlesschain.android` 后重装（**会清 API key**）|
| `cc -v` 报 node not found | 重启 app → 等 LocalTerminal motd 完整再退 |
| 输入框一直转圈 | viewModelScope 卡死 → 看 Cancel 按钮是否出现 → 按了无效 = 5.4 bug |
| logcat 无 Cc* 行 | app 进程没起来 → 找 FATAL → Hilt DI 报错 |

---

**预估耗时**：~1-1.5h  ·  **Sign-off**：__________  ·  **下次回归**：v1.1 写命令前重跑 E5/E7

## 附录：规范章节补全（v5.0.3.108）

> 本文为真机 E2E checklist（打印版）。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文清单。

### 1. 概述

见正文头部。Phase 5.8 Android AI Chat × cc-exec 真机 E2E 打印版 checklist（设备 Xiaomi 24115RA8EC），完整 SOP 见 `Android_AI_Chat_CC_Exec_Phase_5_8_E2E_SOP.md`。

### 2. 核心特性

打印版逐项勾选；9 场景 + 性能基线 + Fail 分级 + 已知 v1 不足；~1–1.5h 一轮。

### 3. 系统架构

见 `Android_AI_Chat_CC_Exec_Tool.md`（NL → cc CLI 白名单 gate → Termux Node 执行）。

### 4. 系统定位

Android AI Chat × cc-exec 的**真机 E2E 验收 checklist**。

### 5. 核心功能

见正文 A–H：准备 / 安装配置 / 三窗口监控 / 9 场景 / 性能基线 / Fail 分级 / 已知不足 / 汇总。

### 6. 技术架构

adb 三窗口 logcat 监控；debug APK；真 API key。

### 7. 系统特点

打印执行；v1.1 写命令前重跑 E5/E7。

### 8. 应用场景

发版前真机 E2E 手动验收勾选。

### 9. 竞品对比

配套完整 SOP（`..._E2E_SOP.md`）；本文为精简打印版。

### 10. 配置参考

见正文 B「安装 + 配置」（API key 等）。

### 11. 性能指标

见正文 E「性能基线（跑完后从 logcat 抓）」。

### 12. 测试覆盖

9 场景（D 节）；本文即验收清单。

### 13. 安全考虑

cc 执行经白名单 gate（见 Tool 设计）；API key 本地配置。

### 14. 故障排除

见正文 F「Fail 分级」与排查表（输入框转圈 / logcat 无 Cc* 行等）。

### 15. 关键文件

`Android_AI_Chat_CC_Exec_Phase_5_8_E2E_SOP.md`（完整 SOP）。

### 16. 使用示例

见正文 C「三窗口监控」与 D「9 场景」命令。

### 17. 相关文档

`Android_AI_Chat_CC_Exec_Phase_5_8_E2E_SOP.md`、`Android_AI_Chat_CC_Exec_Tool.md`。
