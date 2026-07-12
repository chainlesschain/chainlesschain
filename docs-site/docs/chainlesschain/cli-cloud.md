# 自托管云端接管 — Bundle → Run → Reflow（`cc cloud`）

> **版本: 第四阶段（跨端与长任务）· 2026-07-11 | 状态: ✅ 生产就绪 | 私有 runner，无 Anthropic 云依赖 | git bundle 上传 → 私有 HTTP runner 执行 → 结果回流本地（patch/plan/PR/artifacts）**
>
> `cc cloud` 是 Claude Code `--cloud` / `--teleport` 的**自托管等价物**：把一个编码任务卸载给你自己的私有 runner 去跑，全程不经过任何第三方云。它把当前分支打成 git bundle 上传，记入本地任务台账，轮询 runner，最后把结果 **reflow（回流）** 到本地工作区。

## 概述

有些任务你不想占着本地机器跑（耗时长、要独立环境、或想在一台更强的机器上跑）。`cc cloud` 让你把任务交给一个配置好的**私有 runner**——那台机器上通常就跑着一个 `cc agent`：

1. **Bundle**：`git bundle` 打包**当前分支的完整历史**（base64 编码），连同任务文本、分支名、base SHA 一起 `POST` 到 runner 的 `/v1/jobs`。
2. **Run**：runner 返回 `jobId`；本地在 `~/.chainlesschain/cloud-jobs/<jobId>.json` 记一笔任务台账（`queued`）。
3. **Reflow**：轮询 `/v1/jobs/{id}` 直到终态；`done` 时拉 `/v1/jobs/{id}/result`，把 `patch` / `plan` / `pr` / `artifacts` 回流本地——patch 经 `git apply --3way` 应用到工作区，plan 与 artifacts 落到结果目录。

runner 被当作一个**不透明的 HTTP 端点**——它是什么、怎么沙箱化，由你自己掌控（参考实现就是「一台跑着 `cc agent` 的机器」）。

## 核心特性

- ☁️ **无第三方云依赖**：runner 是你自己的 HTTP 服务，代码与数据只在你信任的机器之间流转。
- 📦 **完整分支 bundle**：`git bundle create <file> HEAD <branch>` 打包整个分支历史，runner 端可 clone 出一个可工作的仓库。
- 🔄 **结果回流**：done 后把 `patch`（`git apply --3way`）/ `plan.md` / `pr` URL / `artifacts` 拉回本地；失败的 patch **不丢弃**，改存到结果目录供手动解决。
- 🧾 **本地任务台账**：每个 job 一份 JSON（`jobId / task / branch / baseSha / baseUrl / status / submittedAt / cwd`），可 `list` / `status` / `attach`。
- 🔐 **Bearer 鉴权**：配置 token 时自动加 `Authorization: Bearer`；job id 有 `^[\w.-]+$` 白名单守卫 + URL 转义；artifact 文件名 `[^\w.-]→_` 消毒防路径穿越。
- ⏳ **轮询到终态**：默认每 3s 轮询，30 分钟超时；超时/失败置退出码 1。
- 🖥️ **一步提交并等待**：`run --attach` 提交后阻塞直到完成并回流，适合脚本/CI。
- 🚫 **不动工作区选项**：`attach --no-apply` 只取结果不改工作区（patch 存盘待审）。

## 系统架构

```
┌──────────────────── cc cloud run <task...> ───────────────────┐
│  bundleBranch()  (lib/cloud/bundle.js)                        │
│   git rev-parse HEAD / --abbrev-ref HEAD                      │
│   git bundle create <tmp> HEAD <branch>   ← 完整分支历史        │
│   → { bundle: base64, branch, baseSha, bytes }               │
└───────────────────────────────┬───────────────────────────────┘
                                │ POST /v1/jobs
                                ▼  { task, bundle, branch, baseSha }
 ┌─────────────────────────────────────────────────────────────┐
 │  私有 runner（你的机器，通常跑 cc agent）                       │
 │   ← { jobId }                                                 │
 └───────────────────────────────┬───────────────────────────────┘
                                │ saveJob()
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │  本地任务台账  ~/.chainlesschain/cloud-jobs/<jobId>.json       │
 │   status: queued → running → done | failed | timeout          │
 └───────────────────────────────┬───────────────────────────────┘
        cc cloud status / attach  │ GET /v1/jobs/{id}  轮询
                                ▼ done → GET /v1/jobs/{id}/result
 ┌─────────────────────────────────────────────────────────────┐
 │  reflow (attachJob)                                           │
 │   patch    → git apply --3way --whitespace=nowarn（可 --no-apply）│
 │   plan     → <id>-result/plan.md                             │
 │   artifacts→ <id>-result/<sanitized-name>（base64 解码）       │
 │   pr       → 打印 PR URL                                       │
 │   失败 patch→ 存 <id>-result/ 供手动解决                        │
 └─────────────────────────────────────────────────────────────┘
```

## 命令参考

`list` 是默认子命令（`cc cloud` 等同于 `cc cloud list`）。

### `cc cloud run <task...>`

打包当前分支并把任务提交给 runner。`<task...>` 是可变参数，多个词以空格拼接。

```bash
cc cloud run "把 auth 中间件重构成异步 guard"
cc cloud run "给 http client 加重试逻辑" --attach
```

| 旗标       | 说明                                           | 默认 |
| ---------- | ---------------------------------------------- | ---- |
| `--attach` | 提交后阻塞等待完成并回流结果                   | 关   |
| `--json`   | 机器可读输出（未加 `--attach` 时提交后即返回） | 关   |

### `cc cloud status [id]`

轮询一个 job 的状态；省略 `id` 时取**最近一个** job。

```bash
cc cloud status
cc cloud status job-1234 --json
```

| 旗标     | 说明         | 默认 |
| -------- | ------------ | ---- |
| `--json` | 机器可读输出 | 关   |

### `cc cloud attach <id>`

等待一个 job 完成并把结果回流本地。

```bash
cc cloud attach job-1234
cc cloud attach job-1234 --no-apply    # 取结果但不动工作区
```

| 旗标         | 说明                                         | 默认           |
| ------------ | -------------------------------------------- | -------------- |
| `--no-apply` | 拉取结果但**不**应用 patch（存盘待手动应用） | 应用（默认开） |
| `--json`     | 机器可读输出                                 | 关             |

### `cc cloud list`（默认）

列出本地全部 cloud job。

```bash
cc cloud
cc cloud list --json
```

## 配置参考

首次使用前必须配置 runner 地址（环境变量或 config 二选一，环境变量优先）：

| 项           | 环境变量         | config 键       | 默认                                        | 备注                                             |
| ------------ | ---------------- | --------------- | ------------------------------------------- | ------------------------------------------------ |
| runner 地址  | `CC_CLOUD_URL`   | `cloud.baseUrl` | `""`（必填）                                | 缺失时报 `no cloud runner configured`            |
| 鉴权 token   | `CC_CLOUD_TOKEN` | `cloud.token`   | `null`                                      | 有值时加 `Authorization: Bearer`；无则不带鉴权头 |
| 任务台账目录 | —                | —               | `~/.chainlesschain/cloud-jobs/`             | 每 job 一份 `<jobId>.json`                       |
| 结果目录     | —                | —               | `~/.chainlesschain/cloud-jobs/<id>-result/` | plan/artifacts/失败 patch                        |

```bash
export CC_CLOUD_URL=https://runner.internal.example
export CC_CLOUD_TOKEN=<bearer-token>
# 或在 config.json 里设 cloud.baseUrl / cloud.token
```

Runner 需实现三个端点：`POST /v1/jobs`（返回 `{jobId}`）、`GET /v1/jobs/{id}`（返回 `{status, summary?}`）、`GET /v1/jobs/{id}/result`（返回 `{patch?, plan?, pr?, artifacts?, log?}`）。

## 性能指标

| 维度        | 特性                                                             |
| ----------- | ---------------------------------------------------------------- |
| bundle 上限 | git 调用 `maxBuffer` 64 MB；bundle 内容 base64 编码              |
| 轮询节奏    | 默认每 3s 一次（`intervalMs`），30 分钟超时（`timeoutMs`）       |
| 终态集合    | `{ done, failed }` 为终态；超时返回 `timeout`                    |
| patch 应用  | `git apply --3way --whitespace=nowarn`；失败即回退存盘，不半应用 |
| 临时文件    | bundle 打包用 `mkdtemp`，`finally` 中清理                        |

## 测试覆盖

| 现状            | 说明                                                                                                                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ⚠️ 暂无专用测试 | `lib/cloud/cloud-client.js` 与 `lib/cloud/bundle.js` 均以 `_deps` 注入方式写成，可单测（git 调用、fetch 可注入），但当前仓库树中**尚无** `cloud` 相关测试文件。使用时以真机 runner 端到端验证为准。 |

> 这是一个诚实的空缺记录：feature 已具备可测性设计，但测试待补。

## 安全考虑

- **完整分支历史会离开本机**：bundle 打包的是**整个当前分支的历史**（`git bundle ... HEAD <branch>`），凡在该分支 git 历史里的东西都会上传给 runner。提交前确认分支历史不含敏感内容。
- **传输层不强制 HTTPS**：代码不强制 `baseUrl` 的 scheme——用 `https://` 私有地址，别用明文 `http://` 走公网。
- **Bearer token 鉴权**：配置 token 时才带 `Authorization: Bearer`；token 来自 `cloud.token` / `CC_CLOUD_TOKEN`。runner 端应校验它。
- **路径穿越守卫**：job id 落盘前用 `^[\w.-]+$` 白名单拒绝，URL 中 `encodeURIComponent` 转义；runner 返回的 artifact 文件名 `[^\w.-]→_` 消毒后才写入结果目录。
- **patch 应用可控**：patch 用 `git apply --3way` 应用，失败被捕获并存盘（不半应用污染工作区）；`--no-apply` 让你先审再手动 apply。
- **客户端无沙箱**：本地端不隔离已应用的 patch；任何执行沙箱都是 **runner 的职责**（本命令把 runner 当不透明端点）。

## 故障排除

| 现象                                             | 原因                           | 处理                                             |
| ------------------------------------------------ | ------------------------------ | ------------------------------------------------ |
| `no cloud runner configured`                     | 未设 runner 地址               | `export CC_CLOUD_URL=...` 或设 `cloud.baseUrl`   |
| `runner did not return a jobId`                  | runner `/v1/jobs` 未回 `jobId` | 检查 runner 实现是否返回 `{jobId}`               |
| `cloud runner POST /v1/jobs → HTTP 401`          | token 缺失/错误                | 设 `CC_CLOUD_TOKEN`；确认 runner 校验逻辑        |
| job 卡在 `queued`/`running`（30 分钟后 timeout） | runner 未推进状态或任务超长    | `cc cloud status <id>` 看 summary；调 runner 侧  |
| patch 未应用                                     | `git apply --3way` 冲突        | patch 已存 `<id>-result/`，手动 `git apply` 解决 |
| 想拿结果但不改工作区                             | —                              | `cc cloud attach <id> --no-apply`                |
| bundle 过大失败                                  | 分支历史超 64 MB               | 精简分支历史或用浅分支再提交                     |

## 关键文件

| 文件                                         | 职责                                                                                     |
| -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `packages/cli/src/commands/cloud.js`         | `cc cloud run/status/attach/list`；`attachJob` 回流编排                                  |
| `packages/cli/src/lib/cloud/cloud-client.js` | `CloudClient` HTTP 类、任务台账（`saveJob/readJob/listJobs`）、`pollUntilDone`、终态集合 |
| `packages/cli/src/lib/cloud/bundle.js`       | `bundleBranch` / `applyResultPatch`（`git apply --3way`）/ `persistResultArtifacts`      |
| `packages/cli/src/lib/config-manager.js`     | `loadConfig().cloud`（baseUrl / token）                                                  |

## 使用示例

### 1. 提交当前分支为一个 cloud job

```bash
cc cloud run "把 auth 中间件重构成异步 guard"
# 打印分支、短 SHA、bundle 大小，并给出 attach 提示
```

### 2. 提交并阻塞等待、一步回流

```bash
cc cloud run "给 http client 加重试逻辑" --attach
# 完成后自动 apply patch / 落 plan / 打印 PR URL
```

### 3. 查看最近一个 job 的状态

```bash
cc cloud status                 # 省略 id → 最近 job
cc cloud status job-1234 --json
```

### 4. 事后回流但不动工作区

```bash
cc cloud attach job-1234 --no-apply    # patch 存 <id>-result/ 待手动 apply
```

### 5. 列出全部本地 job

```bash
cc cloud list
cc cloud            # 等价（list 是默认子命令）
```

## 相关文档

- [CLI Agent 模式](./cli-agent.md) — 私有 runner 背后通常就是一个 `cc agent`
- [动态 Worktree 批处理 `cc batch`](./cli-batch.md) — 本地并行的卸载类比（多 worktree 并行跑）
- [Agent Team — 任务图团队编排 `cc team`](./cli-team.md) — 独占租约 + 依赖 DAG 的多 teammate 编排
- [后台 Agent — daemon / attach / logs](./cli-background-agents.md) — 本机分离式长时运行
