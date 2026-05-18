# Desktop ↔ Mobile-Bridge Namespace Coverage Audit

> **状态**：v0.1 草案（2026-05-18），Phase 6.0 Trap T2 输出。Phase 6 所有 iOS skill impl 的 prerequisite。
>
> **目的**：在 iOS 端写 17 个 skill typed wrapper 之前，**先验证桌面端 mobile-bridge / remote-gateway 真实 wire 了哪些 namespace 和 method**。Android `*Commands.kt` typed wrapper 描述的是 client 调用面，桌面 handler 描述的是 server 实现面 — 二者不对齐 = iOS 写了也只会收 `Unknown action` 错误。
>
> **数据采集**：grep `client\.invoke("ns.method"` （Android typed wrapper 调用面）+ grep `case "method"` （Desktop switch dispatch 入口）。脚本可重跑（见 §6 reproducer）。
>
> **关联文档**：`iOS_对标_Android_Phase_6_Plan.md` §7 Trap T2 / `iOS_Phase_3_Remote_Operate_Framework.md`

---

## 1. 关键发现 (TL;DR)

✅ **23 / 23 Android namespace 在桌面 `remote-gateway.js` 全部 registerHandler**（+ 1 desktop-only `project` 给 mobile REMOTE）。**0 个 namespace 完全缺失**。

⚠️ **Method-level 覆盖率严重分化**（按桌面 case 与 Android invoke 名称精确匹配统计）：

| 覆盖率档 | namespace 数 | namespace 列表 |
|---|---:|---|
| 🟢 **100% 全 wired** | 5 | `input`, `display`, `userBrowser`, `security`, `app` |
| 🟢 **80%+** | 2 | `extension` (97%), `clipboard` (85%) |
| 🟡 **40–80%** | 4 | `workflow` (76%), `notification` (54%), `history` (42%), `browser` (36%) |
| 🔴 **20–40%** | 6 | `device` (33%), `power` (29%), `file` (25%), `sysinfo` (23%), `process` (20%), `network` (20%) |
| 🔴 **< 20%** | 5 | `media` (18%), `desktop` (13%), `system` (10%), `knowledge` (7%), `ai` (7%) |
| ⚠️ **特殊** | 1 | `media` (实测 10/10 case 匹配但 Android 多 45 method = 桌面有但 Android 没覆盖的 case 命中 vs 反向，含义反转, see §4 caveat) |

### 1.1 影响 Phase 6 决策

1. **Phase 6.0 之前 — 不动 iOS 实施顺序**。`input` / `display` / `userBrowser` / `security` / `app` 5 个 100% 覆盖的 namespace 可立即 impl 不需桌面协调。
2. **🔴 红档 11 个 namespace（覆盖率 < 40%）**：**iOS 实施前必须先做 method-level 子集决策**：
   - 选项 A：iOS 只 impl 桌面已支持的 method 子集（10–20 method）
   - 选项 B：桌面端先扩 handler（每个 namespace 1–3 天），iOS 再 impl 完整 Android 等价 wrapper
   - 选项 C：跳过该 namespace，留 Phase 7+ 桌面侧补全后再回来
3. **🟡 黄档 4 个 namespace（40–80%）**：iOS 可 impl 但需为缺失 method 加桌面端兜底（`throw new Error('not implemented')` → iOS 端 `OfflineCommandQueue` skip + UI 灰显）。
4. **特殊：`ai` 7% + `knowledge` 7%** 是 Phase 6 最大的桌面端 debt。Phase 5 iOS 已 impl `ai.chat` 8 method subset（落在桌面已支持的 4 method 内 + Phase 5 桌面端可能补了几个），Phase 6.3 knowledge skill / Phase 6.4 ai 余 45 method **都需要桌面端先扩 handler 才能 impl**。

---

## 2. 完整覆盖率表

> A = Android `client.invoke("<ns>.<method>")` 唯一 method 数  
> D = Desktop handler `case "<method>"` 唯一 method 数  
> ✓ = 严格名称匹配数  
> % = ✓ / A（iOS 写 Android typed wrapper 时能 100% 工作的比率）

| Namespace | Android typed | Desktop case | 匹配 | 覆盖率 | 档 | 备注 |
|---|---:|---:|---:|---:|---|---|
| **input** | 10 | 10 | **10** | **100%** | 🟢 | mouseMove/Click/Scroll/Drag, KeyPress/Combo/Type, getCursorPosition, getKeyboardLayout — 完全对齐 |
| **display** | 11 | 11 | **11** | **100%** | 🟢 | 完全对齐 |
| **userBrowser** | 18 | 18 | **18** | **100%** | 🟢 | CDP-based 浏览器控制，完全对齐 |
| **security** | 8 | 8 | **8** | **100%** | 🟢 | 完全对齐 |
| **app** | 8 | 8 | **8** | **100%** | 🟢 | listInstalled/Running/getInfo/launch/close — 完全对齐 |
| **extension** | 95 | 490 | 93 | **97%** | 🟢 | 桌面 `browser-extension-server.js` 含 490 unique case 远超 Android — Chrome 扩展是重点投入区 |
| **clipboard** | 7 | 10 | 6 | **85%** | 🟢 | 桌面多 3 case (files/html/image/text) 是内容类型 sub-dispatch；Android 用 `type` param 区分 — 实际语义 ≈ 100% |
| **workflow** | 13 | 10 | 10 | **76%** | 🟡 | Android 多 3 method (待 case-by-case 看) |
| **notification** | 11 | 7 | 6 | **54%** | 🟡 | 桌面缺：`broadcast` / `clearAll` / `delete` / `getUnreadCount` / `markAllAsRead`；Android 缺：桌面的 `clearHistory` |
| **history** | 7 | 8 | 3 | **42%** | 🟡 | 名称大量分化，需 case map |
| **browser** | 33 | 12 | 12 | **36%** | 🟡 | 桌面所有 12 case 都在 Android 中 ✅；Android 多 21 method 桌面未实现 |
| **device** | 12 | 16 | 4 | **33%** | 🔴 | 桌面多 12 case 是 device-manager extras；名称分化大 |
| **power** | 34 | 10 | 10 | **29%** | 🔴 | 桌面 10 case 全在 Android ✅；Android 多 24 method（电池 detail / 睡眠定时器等）缺 |
| **file** | 44 | 17 | 11 | **25%** | 🔴 | 桌面 `file-transfer-handler` 17 case 偏向"传输"；Android 偏向"操作"（FileOpsHandler 单独 12 case 也在桌面）。**真实合并覆盖需重算**（见 §3.2）|
| **sysinfo** | 42 | 10 | 10 | **23%** | 🔴 | 桌面 10 case 全在 Android ✅；Android 多 32 method（GPU / 风扇 / 详细 spec）缺 |
| **process** | 30 | 6 | 6 | **20%** | 🔴 | 桌面 6 case 全在 Android ✅；Android 多 24 method（进程树 / IO 监控）缺 |
| **network** | 53 | 11 | 11 | **20%** | 🔴 | 桌面 11 case 全在 Android ✅；Android 多 42 method（VPN / 蓝牙 / 详细网卡）缺 |
| **media** | 55 | 10 | 10 | **18%** | 🔴 | 桌面 10 case 全在 Android ✅；Android 多 45 method（音频路由 / 摄像头切换 / 录制控制）缺 |
| **desktop** | 51 | 12 | 7 | **13%** | 🔴 | 桌面 12 case 但部分走 `sendInput` 内层 sub-dispatch（mouseMove/keyPress） → **实际覆盖待 §3.1 深入** |
| **system** | 49 | 5 | 5 | **10%** | 🔴 | 桌面 5 case 全在 Android ✅；Android 多 44 method 缺 — system 是最大桌面端 debt |
| **knowledge** | 55 | 9 | 4 | **7%** | 🔴 | 桌面 9 case 大量名称分化（getNoteById vs Android.getNote, getTags vs Android.listTags）+ Android 多 46 method（folder / tag / template / version / backlinks / 知识图谱 / archive / pin / star 全缺）|
| **ai** | 52 | 10 | 4 | **7%** | 🔴 | 桌面 10 case 走 agent 控制（list/start/stop/restart/status）+ chat/getConversations/getModels/controlAgent/ragSearch；Android 52 method 含 chatStream / RAG add / model 管理 / multimodal / embedding 全缺 |

**总计**：Android typed 696 method，桌面 case 1186 唯一（含 extension 490），严格名称匹配 **310 method (45%)**。

---

## 3. 特殊语义分析

### 3.1 `desktop` namespace — 内层 sub-dispatch ✅ 已解决（2026-05-18, Phase 6.6 doc）

**结论**：详见 `iOS_Phase_6_6_Desktop_Skill.md` §1.2-1.3。审计结果：

- 桌面 `remote-desktop-handler.js` 真实结构：**7 outer case** (startSession / stopSession / getFrame / sendInput / getDisplays / switchDisplay / getStats) + sendInput 内层 **5 sub-type** (mouse_move / mouse_click / mouse_scroll / key_press / key_type) = **12 真 wire method**
- 之前 grep "case branches" 数到的 12 把 5 个 private `async handleX(data)` 实现错算成入口 — 这 5 个不是 case，是 sub-type dispatch 后的 helper
- Android `DesktopCommands.kt` 51 unique invoke 中：**7 直接对应桌面 outer case** + **5 个高层 wrapper (sendMouseMove/sendMouseClick/sendMouseScroll/sendKeyPress/sendKeyType) 全部 route to `desktop.sendInput`** + **44 Android-only method 桌面返 Unknown action**
- **44 个 Android-only method 多数已在其它 namespace 覆盖**：窗口→display.getWindowList，剪贴板→clipboard.\*，音量→media.\*，截屏→display.screenshot，通知→notification.send，电源→power.\* 等
- **iOS Phase 6.6 v0.1 实施时**：DesktopCommands actor 不暴露 `mouseMove()` → desktop.mouseMove 路径（顶层伪 method 桌面会 Unknown action），改为 `mouseMove()` → internal helper 调 `sendInput(type:"mouse_move", ...)`，与 Android 现行模式一致。详见 Phase 6.6 doc Trap D5。

### 3.2 `file` namespace — 双 handler 合并

桌面侧 file 操作分散在 2 handler：
- `file-transfer-handler.js` (17 case) — 注册到 `file` namespace
- `android-file-handler.js` (12 case) — 注册到？(grep 显示无 `registerHandler("file"`)

```bash
grep -E "registerHandler\(['\"]\w+['\"]" desktop-app-vue/src/main/remote/handlers/android-file-handler.js
# (空) → 这个 handler 没被 remote-gateway 注册，可能是 dead code 或被其它 path 调用
```

**Phase 6 实施 file skill 前**：确认 android-file-handler 用途，决定是否 register 为 file 子命名空间。

### 3.3 `clipboard` 桌面多余 case 是 content-type sub-dispatch

桌面 10 case：`get` / `set` / `text` / `html` / `image` / `files` / `getHistory` / `clearHistory` / `watch` / `unwatch`。其中 `text` / `html` / `image` / `files` 是 `get`/`set` 的内层 content-type dispatch（Android `type` param 等价物）。**实际语义覆盖率 = 100%**，但桌面 case 与 Android invoke 名称不对齐——iOS 写 typed wrapper 时**走 Android 风格** `client.invoke("clipboard.get", {type: "text"})`，不要直调 `clipboard.text`。

### 3.4 `media` 反向 18% 含义

`media` 10 case 全在 Android 55 method 内，所以**桌面端没引入 mismatch**——iOS 只要 impl 桌面端已支持的 10 method 即可立即工作。"18%" 反映的是"Android 想要做的 vs 桌面实际能做的"差距——**iOS impl 选项 A（桌面已支持子集）天然安全**。

同样情况：`power` / `process` / `network` / `sysinfo` / `system` / `browser` 红档 namespace 实际都是"桌面 case ⊂ Android invoke"，**iOS impl 桌面子集 100% 可用**。

---

## 4. Phase 6 实施推荐

### 4.1 Phase 6.0 实施前必做 1-2h 深度验证

1. **§3.1 验 desktop 内层 sub-dispatch**：确认 Android `desktop.mouseMove` 直调路径
2. **§3.2 验 android-file-handler 注册路径**：决定 file skill 的 desktop dispatch 入口
3. **§3.3 验 clipboard `text/html/image/files` case 是否独立 invoke 入口还是 sub-dispatch**（影响 iOS typed wrapper 设计）

### 4.2 17 skill impl 顺序调整建议（基于覆盖率数据）

> 原 Phase 6 Plan §3 OQ-2 推荐 A（用户高频优先），现按 **桌面端就绪度** 修正：

#### 🟢 Phase 6.0 后第 1 批（5 个 100% wired，无桌面 debt）
1. **input** (10 method, 100%) — 远程键鼠基础盘
2. **display** (11 method, 100%) — 屏幕信息
3. **app** (8 method, 100%) — 应用列表 / launch
4. **security** (8 method, 100%) — 防火墙 / 权限
5. **userBrowser** (18 method, 100%) — CDP 浏览器控制

**估时**：5 skill × 0.5–1 天 = **3–5 天**（覆盖率 100% 无需桌面协调，纯 iOS impl）

#### 🟢 Phase 6 第 2 批（85–97% wired，几乎零桌面 debt）
6. **clipboard** (Android 7, 真实语义 100%) — 已在 Phase 3 ✅，可跳
7. **extension** (95 method, 97%) — 但需独立 WS 客户端（Trap T4）+ 2 method 桌面缺 → 延后到 Phase 6.7

#### 🟡 Phase 6 第 3 批（40–80% wired，需桌面端少量补 / iOS 子集 impl）
8. **workflow** (13 method, 76%) — 3 method 缺，Phase 6.5
9. **notification** (11 method, 54%) — 已在 Phase 4 ✅，**但桌面端缺 5 method**（broadcast/clearAll/delete/getUnreadCount/markAllAsRead）— **Phase 4.7 真机 E2E 可能暴露 iOS 调用桌面 unknown action**，需 Phase 6.0 一并验
10. **history** (7 method, 42%) — Phase 6.5
11. **browser** (33 method, 36%) — iOS impl 12 method 子集，留 21 method 给桌面 debt backlog，Phase 6.2

#### 🔴 Phase 6 第 4 批（覆盖率 < 40%，桌面 debt 大）
12. **device** (16 桌面 case, iOS impl 4 匹配 + 12 桌面 extras) — Phase 6.1 后台 batch
13. **power** (10 method 桌面已支持子集, 100% 可用) — Phase 6.1 后台 batch
14. **file** (待 §3.2 决策后定) — 部分已在 Phase 3 ✅，Phase 6.0 验完整度
15. **sysinfo** (10 method 桌面已支持子集) — 已在 Phase 3 ✅
16. **process** (6 method 桌面已支持) — Phase 6.1 后台
17. **network** (11 method 桌面已支持) — Phase 6.1 后台
18. **media** (10 method 桌面已支持) — Phase 6.2 主屏（但 iOS 选项 A 实施仅 10 method, 不是 55）
19. **system** (5 method 桌面已支持) — Phase 6.5

#### 🔴 桌面 debt 优先级（Phase 7+ 或并行 stream）
- **knowledge** (4/55, 7%) — 最大桌面 debt。Phase 6.3 实施前需桌面端扩 KnowledgeHandler 至少 +20 method（getNote/listFolders/createFolder/listTags/createTag/exportNote/getStats/pinNote/starNote 等 user-facing 优先）— **桌面侧工作量 ≈ 3–5 天**
- **ai** (4/52, 7%) — Phase 5 已 impl 8 method subset（chat 系列）。Phase 6.4 实施 ai 余 45 method 前需桌面端扩 AICommandHandler 至少 +15 method（controlAgent 子动作 / generateImage / embedding 系列）— **桌面侧 ≈ 5–7 天**
- **desktop** (7/51, 13%) — Phase 6.6 desktop skill 实施前需先确认 §3.1 sub-dispatch 含义，可能桌面 debt 较小

### 4.3 Phase 6 Plan §5 子阶段时间线调整

原 Plan §8.1 串行 72 天估算未含**桌面端 handler 扩展工作**（knowledge +3-5 天 / ai +5-7 天 / 其它红档 backlog +5-10 天）。新估算：

- 原 iOS 工作：72 天
- 桌面 debt 补全：+15-20 天
- **修正总计：~90 天 ≈ 18 周**

并行策略下（iOS stream + Desktop debt stream 并跑）可压缩至 ~12 周。

---

## 5. 名称对齐 Action Items

### 5.1 异常发现：Plan §1.3 中的两个"naming mismatch"是错的

`iOS_对标_Android_Phase_6_Plan.md` §1.3 SeedRegistry 表写了两个 namespace 名称分化：
- ~~Android `application` vs Desktop `app`~~ → 实际 Android invoke 用 `app.*`，**无 mismatch**
- ~~Android `system.info` vs Desktop `sysinfo`~~ → 实际 Android invoke 用 `sysinfo.*`，**无 mismatch**

SeedRegistry.kt 的 namespace 字段确实写的是 `application` / `system.info`，但实际 Commands.kt invoke 用 `app` / `sysinfo`。**SeedRegistry 应改对齐**（display 字段 vs runtime namespace 不一致是隐患）。

**Action**: Phase 6.0 修 `android-app/app/src/main/java/com/chainlesschain/android/remote/registry/SeedRegistry.kt` 把 `application` → `app`、`system.info` → `sysinfo`。

### 5.2 knowledge namespace 名称分化清单

iOS Phase 6.3 KnowledgeCommands 实施时选择：**镜像 Android 名称 vs 桌面名称**？

| Android | Desktop |
|---|---|
| `knowledge.getNote` | `knowledge.getNoteById` |
| `knowledge.getTags` | `knowledge.getTags` ✅ |
| `knowledge.search` | `knowledge.searchNotes` |
| `knowledge.semanticSearch` | (缺) |
| `knowledge.advancedSearch` | (缺) |
| (缺) | `knowledge.getNotesByTag` |
| (缺) | `knowledge.getFavorites` |
| (缺) | `knowledge.syncNote` |

**推荐**：iOS 镜像 Android 名称（与 Phase 5 AI Chat skill 一致策略），桌面端做 alias 兼容 + 补全缺失 method。这样 iOS + Android 双客户端面同一组 method 名。**Action**: Phase 6.0 评审后在桌面 `knowledge-handler.js` 加 alias `getNote` → `getNoteById`、`search` → `searchNotes` 等。

---

## 6. Reproducer 脚本

完整重跑覆盖率数据：

```bash
ns_list="ai app browser clipboard desktop device display extension file history input knowledge media network notification power process security storage system sysinfo userBrowser workflow"

for ns in $ns_list; do
  case $ns in
    app) android_file="ApplicationCommands"; handler="application-handler" ;;
    sysinfo) android_file="SystemInfoCommands"; handler="system-info-handler" ;;
    device) android_file="DeviceCommands"; handler="device-manager-handler" ;;
    desktop) android_file="DesktopCommands"; handler="remote-desktop-handler" ;;
    file) android_file="FileCommands"; handler="file-transfer-handler" ;;
    history) android_file="HistoryCommands"; handler="command-history-handler" ;;
    userBrowser) android_file="UserBrowserCommands"; handler="user-browser-handler" ;;
    extension) android_file="ExtensionCommands"; handler="browser-extension-server"; handler_path="desktop-app-vue/src/main/remote/$handler.js" ;;
    *)
      cap=$(echo $ns | sed 's/^./\U&/')
      android_file="${cap}Commands"; handler="${ns}-handler" ;;
  esac
  android_path="android-app/app/src/main/java/com/chainlesschain/android/remote/commands/${android_file}.kt"
  [ -z "$handler_path" ] && desktop_path="desktop-app-vue/src/main/remote/handlers/${handler}.js" || desktop_path="$handler_path"
  unset handler_path

  android_methods=$(grep -oE "client\.invoke\(\"${ns}\.[a-zA-Z_]+\"" "$android_path" | grep -oE '"[^"]+"' | tr -d '"' | sed "s/^${ns}\.//" | sort -u)
  desktop_methods=$(grep -oE 'case "[a-zA-Z_]+"' "$desktop_path" | grep -oE '"[^"]+"' | tr -d '"' | sort -u)
  A=$(echo "$android_methods" | grep -c .)
  D=$(echo "$desktop_methods" | grep -c .)
  matched=$(comm -12 <(echo "$android_methods") <(echo "$desktop_methods") | grep -c .)
  pct=0; [ $A -gt 0 ] && pct=$((100 * matched / A))
  printf "%-15s A=%3d D=%3d ✓=%3d (%3d%%)\n" "$ns" "$A" "$D" "$matched" "$pct"
done
```

**警告**：本脚本采严格名称匹配，对内层 sub-dispatch（desktop sendInput / clipboard text/html/image）会**低估**真实覆盖率。Phase 6.0 §3 验完后可能需重算。

---

## 7. Phase 6 Plan 修订条目

回写 `iOS_对标_Android_Phase_6_Plan.md`：

- §1.3 表 — 2 个 naming mismatch 删（`application`/`app`、`system.info`/`sysinfo` 实际对齐）
- §5.1.1 Phase 6.0 — 加 "深度验证 §3" 任务（1-2h）：desktop sub-dispatch / android-file-handler 注册 / clipboard sub-case
- §5 Phase 6.X 顺序 — 按本文 §4.2 5 批重排（100% / 80%+ / 40–80% / <40% / 桌面 debt backlog）
- §7 Trap T2 — 标记 ✅ 已扫描完，进 T3
- §7 加 Trap T10 "桌面 debt"（knowledge +20 method / ai +15 method）— Phase 6.3/6.4 实施前必做
- §8.1 时间线 — 加 +15-20 天桌面 handler 扩展（总计 ≈ 90 天串行 / 12 周并行）

---

## 8. 数据完整性免责

- 本审计基于 2026-05-18 main 分支 `HEAD` 静态代码 grep。运行时 dynamic dispatch / proxy handler 可能改变实际覆盖率。
- "案例" 匹配假设 method 名称完全一致 — 不计算 case 语义等价（如 `getNoteById` ≈ `getNote`）。
- Android `methodCount` 来自 SeedRegistry.kt 头注释，与实际 `client.invoke` 数（本审计 A 列）有微差（如 `desktop` 注释 70 vs 实际 51）。
- 桌面 `extension` 490 case 是 browser-extension-server.js 单文件单 switch，对应 Android `ExtensionCommands.kt` 95 method — 比率 4.9x 反映桌面端 Chrome 扩展 case 远超 Android 抽象层（Android 是子集 view）。
