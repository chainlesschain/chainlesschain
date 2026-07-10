# Artifacts 交付物（cc artifacts / publish_artifact）

> **版本: Artifacts v1（cli `0.162.157`，2026-07-10；web-panel 预览面板与浏览器下载随批 24/25 增强）| 状态: ✅ 生产可用 | 命令数 172→173 | AGENT_TOOLS 23→24 | ~31 专项测试**
>
> agent 干完活产出的**交付物**（报告 / 补丁 / 截图 / 日志 / 数据文件）不再散落在工作目录里靠翻聊天记录找——`publish_artifact` 工具把成品拷进持久化的个人交付物库，**只有元数据进会话转录**（文件本体绝不膨胀上下文），随后用 `cc artifacts` 命令或 web-panel「交付物」视图浏览、预览、下载、清理。

## 概述

跑完一个 headless 任务，agent 生成的分析报告在哪？上周让它导出的数据 CSV 呢？此前答案是"在当时的 cwd 里，自己找"。Artifacts v1 给交付物一个**统一的家**：

- **agent 侧**：任务收尾时调用 `publish_artifact` 工具，把成品文件拷贝进 `~/.chainlesschain/artifacts/`，登记标题 / 类型 / TTL；工具返回元数据 + 提示语，**文件内容不进上下文**。
- **用户侧**：`cc artifacts list/show/open/remove/clean` 五个子命令管理；web-panel「交付物」视图提供表格浏览、按类型过滤、**Markdown / 图片 / 文本在线预览**（DOMPurify 消毒渲染）、**浏览器完整下载**、删除与过期清理。
- **生命周期**：每个交付物带 TTL（默认 30 天），过期后 `cc artifacts clean` 一键回收，库不会无限膨胀。

## 核心特性

- 📦 **持久化交付物库**: `~/.chainlesschain/artifacts/`（`CC_ARTIFACTS_DIR` 可改），JSONL 索引 + 按 id 存储副本，坏行容忍（单行损坏不毒化整库）
- 🏷️ **六种类型**: `report` / `patch` / `screenshot` / `log` / `data` / `other`，list 可按类型过滤
- 🧾 **元数据完备**: id、标题、类型、MIME（按扩展名推断，~24 种映射）、大小、**sha256**、来源路径、会话 id、创建 / 过期时间
- 🪶 **上下文零污染**: 工具只回传元数据——100MB 的数据文件发布后，会话转录只多几行字
- ⏳ **TTL 自动过期**: 默认 30 天（`ttl_days` 参数可调，最小 1 天），`clean` 只删已过期项
- 🖥️ **web-panel 视图**: 表格 + 类型过滤 + 预览卡（图片 / Markdown / 文本）+ 下载 + 删除 + 一键清理过期
- 📝 **Markdown 在线预览**: `text/markdown` 走面板既有 MarkdownRenderer（marked + DOMPurify + hljs），非 Markdown 文本回退 `<pre>`
- ⬇️ **浏览器完整下载**: WS 预览有体积上限，下载走独立 HTTP 端点流式传输**完整原件**，token 走 Bearer 头不进 URL
- 🔒 **纵深防御**: 100MB 发布上限、路径穿越双闸、常数时间 token 比较、`Content-Disposition` 注入清洗、`nosniff`

## 系统架构

```
agent 任务收尾
    │ publish_artifact { path, title, kind, ttl_days }
    ▼
ArtifactStore (src/lib/artifact-store.js)
    ~/.chainlesschain/artifacts/
      ├── index.jsonl          每交付物一行元数据（坏行跳过）
      └── files/<id><ext>      字节级拷贝副本
    │
    ├──── cc artifacts list/show/open/remove/clean   (CLI)
    │
    └──── WS gateway (artifact-protocol.js)
            artifact-list / show / content / remove / clean
              │                    │
              │            预览分级: 文本≤256KB utf8 / 图片≤8MB base64
              │                    │ 超限 previewable:false
              ▼                    ▼
          web-panel「交付物」视图 (Artifacts.vue + stores/artifacts.js)
              │
              └── GET /api/artifacts/<id>/download   完整原件流式下载
                  (web-ui-server.js, Bearer token, 常数时间比较)
```

- **发布路径**：`path` 相对 cwd 或绝对均可，`path.resolve` 后整文件拷入库；超 100MB 拒绝。
- **预览与下载分离**：WebSocket 预览按 MIME 分级限额（防灌爆 socket）；完整取回走 HTTP 下载端点，字节精确。

## `cc artifacts` 命令

别名 `cc artifact`，无子命令时默认 `list`。

| 子命令                | 参数 / 选项                               | 说明                                                              |
| --------------------- | ----------------------------------------- | ----------------------------------------------------------------- |
| `list`（默认）        | `--session <id>` `--kind <kind>` `--json` | 列出交付物（旧→新）：id、标题、[类型]、MIME、大小、时间、所属会话 |
| `show <id>`           | `--json`                                  | 全部元数据 + `storedPath`（副本绝对路径）                         |
| `open <id>`           | —                                         | 只打印副本绝对路径（便于管道 / 交给系统打开）                     |
| `remove <id>`（`rm`） | `--json`                                  | 删除副本 + 索引行                                                 |
| `clean`               | `--json`                                  | 删除所有**已过期**（`expiresAt` 早于现在）的交付物，打印数量      |

找不到 id 时 exit 1（`--json` 模式返回 `{ found: false }`）。

## `publish_artifact` 工具（agent 侧）

第 24 个 AGENT_TOOL，tier `extension`；**Plan 模式不可用**（发布是完工副作用，不是分析动作）。

| 参数       | 类型   | 必填 | 默认    | 说明                                      |
| ---------- | ------ | ---- | ------- | ----------------------------------------- |
| `path`     | string | ✅   | —       | 要发布的文件（相对 cwd 或绝对路径）       |
| `title`    | string | —    | 文件名  | 人类可读标题                              |
| `kind`     | enum   | —    | `other` | `report/patch/screenshot/log/data/other`  |
| `ttl_days` | number | —    | `30`    | 保留天数（最小 1），过期后 `clean` 可回收 |

返回 `{ published: <元数据>, hint }`。权限域 `filesystem:read` + `artifact:write`——读工作区一个文件、只写用户自己的配置目录，无第三方外发；风险级 LOW。

```text
# agent 会话内的典型收尾：
"分析完成，报告已写入 report.md"
→ publish_artifact { path: "report.md", title: "依赖漏洞分析报告", kind: "report" }
→ { published: { id: "art_kx9m2p_3f8a1c2d", …, expiresAt: "2026-08-09…" } }
```

## web-panel「交付物」视图

`cc ui` 打开面板 → 侧栏「交付物」：

- **表格**：标题 / 类型（着色标签）/ MIME / 大小 / 创建时间 / 会话；顶部类型过滤、刷新、「清理过期」。
- **行操作**：**预览**（图片直接渲染、Markdown 经 DOMPurify 消毒渲染、其他文本 `<pre>`，超限项标"已截断"）、**下载**（完整原件）、**删除**。
- **预览卡尾部**：id · 会话 · sha256（可据此校验完整性）。
- 不可预览的类型（如二进制数据）显示元数据，提示本机用 `cc artifacts open <id>` 取路径。

## 配置参考

| 配置项             | 默认                           | 说明                                       |
| ------------------ | ------------------------------ | ------------------------------------------ |
| `CC_ARTIFACTS_DIR` | `~/.chainlesschain/artifacts/` | 交付物库目录                               |
| 发布大小上限       | 100 MB                         | `publish` 超限拒绝                         |
| 默认 TTL           | 30 天                          | 工具参数 `ttl_days` 可调（最小 1 天）      |
| WS 文本预览上限    | 256 KB                         | 超限 `truncated: true`                     |
| WS 图片预览上限    | 8 MB（base64）                 | 超限 `previewable: false`，请走下载        |
| 下载鉴权           | 面板 wsToken（若配置）         | Bearer 头或 `?token=`，未配 token = 仅本机 |

## 性能指标

| 维度      | 表现                                                                   |
| --------- | ---------------------------------------------------------------------- |
| 发布      | 一次文件拷贝 + 一行 JSONL 追加 + sha256 计算；上下文只增元数据几十字节 |
| list      | 单文件 JSONL 顺序读，坏行跳过不中断                                    |
| WS 预览   | 文本 ≤256KB / 图片 ≤8MB 限额，超限直接拒载不灌 socket                  |
| HTTP 下载 | 流式传输完整原件，`Content-Length` 精确、`no-store` 不缓存             |
| 清理      | 只扫索引行比对 `expiresAt`，文件删除 best-effort（索引为准）           |

## 测试覆盖

~31 项专项测试，全部无宿主可跑：

| 测试文件                                              | 覆盖                                                                    |
| ----------------------------------------------------- | ----------------------------------------------------------------------- |
| `cli/__tests__/unit/artifact-store.test.js`           | publish/list/get/remove/cleanupExpired、100MB 守卫、TTL、JSONL 坏行容忍 |
| `cli/__tests__/unit/artifact-ws-protocol.test.js`     | 五个 WS 路由、预览分级限额、basename 路径穿越守卫                       |
| `cli/__tests__/unit/web-ui-artifact-download.test.js` | 真 HTTP server + fetch：字节精确下载、token 四态门、404 / 篡改 400      |
| `web-panel/__tests__/unit/artifacts-store.test.js`    | Pinia store：fetch/preview/remove/clean、Markdown 判定、下载流          |

另有 web-ui-server 回归套（106+28）随批 25 全绿。

## 安全考虑

- **路径穿越双闸**：WS `artifact-content` 与 HTTP 下载路由都校验 `entry.file` 必须是纯 basename 且不含 `..`——手工篡改 `index.jsonl` 写 `"file":"../../secret"` 也无法把下载端点变成任意文件读；下载 URL 的 id 段另限 `[A-Za-z0-9_]+`。
- **下载鉴权**：面板配置了 `wsToken` 时，下载端点要求同等强度凭据，**sha256 + `timingSafeEqual` 常数时间比较**防时序侧信道；token 走 Bearer 头**不进 URL**（不落浏览器历史）。
- **响应硬化**：`Content-Disposition` 用 RFC 5987 `filename*=UTF-8''…` 且剥 CR/LF/引号（防头注入）、`Cache-Control: no-store`、`X-Content-Type-Options: nosniff`；非 GET → 405。
- **Markdown 消毒**：面板预览经 DOMPurify，绝不裸插 HTML。
- **无外发**：工具只写用户自己的配置目录；MIME 仅按扩展名推断，不嗅探内容。
- **Plan 模式禁用**：规划阶段不允许发布（写副作用）。

## 故障排除

| 现象                              | 原因 / 处理                                                                            |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| `publish_artifact` 报文件过大     | 单文件上限 100MB——先压缩或拆分，交付物库不是数据仓库                                   |
| 面板预览显示"不可预览"            | 二进制类型或超预览限额（文本 256KB / 图片 8MB）→ 用下载按钮或 `cc artifacts open <id>` |
| 预览内容带"已截断"标签            | 正常：WS 预览限额所致，下载可得完整原件                                                |
| 下载返回 401                      | 面板启用了 token → 确认从面板内点下载（自动带 Bearer 头）而非裸 URL                    |
| `cc artifacts clean` 删得比预期少 | `clean` 只删**已过期**项；要删未过期的用 `remove <id>`                                 |
| list 里少了某条                   | 检查是否已过 TTL 被 clean；或索引行损坏被跳过（其余条目不受影响）                      |
| agent 从不发布交付物              | 提示词里明确要求"完成后把报告发布为 artifact"；Plan 模式下该工具不可用                 |

## 关键文件

| 文件                                                        | 作用                                             |
| ----------------------------------------------------------- | ------------------------------------------------ |
| `packages/cli/src/commands/artifacts.js`                    | `cc artifacts` 五个子命令                        |
| `packages/cli/src/lib/artifact-store.js`                    | ArtifactStore：发布 / 索引 / TTL / 清理          |
| `packages/cli/src/runtime/coding-agent-contract-shared.cjs` | `publish_artifact` 工具 schema                   |
| `packages/cli/src/runtime/agent-core.js`                    | 工具 dispatch                                    |
| `packages/cli/src/gateways/ws/artifact-protocol.js`         | 五个 WS 路由 + 预览分级策略                      |
| `packages/cli/src/lib/web-ui-server.js`                     | `GET /api/artifacts/<id>/download` + 鉴权 / 硬化 |
| `packages/web-panel/src/views/Artifacts.vue`                | 面板视图（表格 / 预览卡 / 下载）                 |
| `packages/web-panel/src/stores/artifacts.js`                | Pinia store                                      |

## 使用示例

### agent 产出报告并发布

```bash
cc agent -p "审计 package.json 依赖漏洞，产出 Markdown 报告并发布为 artifact"
# agent: write_file report.md → publish_artifact { kind: "report" }
```

### 浏览与取回

```bash
cc artifacts                          # 列出全部
cc artifacts list --kind report       # 只看报告类
cc artifacts show art_kx9m2p_3f8a1c2d # 全部元数据 + 存储路径
cc artifacts open art_kx9m2p_3f8a1c2d # 只打印路径 —— 可直接交给编辑器/系统打开
cat "$(cc artifacts open art_kx9m2p_3f8a1c2d)"
```

### 按会话回溯

```bash
cc session list                                   # 找到那次任务的会话 id
cc artifacts list --session sess-xxxx --json      # 该会话产出的全部交付物
```

### 清理

```bash
cc artifacts clean                    # 回收全部已过期项
cc artifacts rm art_old_id            # 手动删除指定项
```

### web-panel 图形化

```bash
cc ui                                 # 打开面板 → 侧栏「交付物」
# 表格浏览 → 预览（Markdown 渲染 / 图片直显）→ 下载完整原件 → 清理过期
```

## 相关文档

- [`cc agent` 托管智能体](/chainlesschain/cli-agent) — `publish_artifact` 所在的 agent 工具面
- [Vue3 Web 管理面板](/chainlesschain/cli-web-panel) — 「交付物」视图所在的面板
- [会话管理](/chainlesschain/cli-session) — 交付物按会话 id 关联与回溯
- [权限系统](/chainlesschain/permissions) — `artifact:write` 权限域
