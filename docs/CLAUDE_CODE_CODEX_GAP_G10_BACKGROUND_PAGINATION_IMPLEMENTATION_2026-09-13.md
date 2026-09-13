# Claude Code / Codex 差距优化：G10 后台 Agent 游标分页实施记录

> 实施日期：2026-09-13
>
> 范围：为后台 Agent 权威状态列表提供稳定、有界的游标分页，并接入 `cc daemon status`。本批不引入第二权威源、只读索引、归档或性能 SLO；分页也不替代精确 SHA 的三平台容量测量。

## 1. 交付结果

新增 `listBackgroundAgentsPage(options)`，返回冻结的 `{ sessions, nextCursor }`：

- `limit` 只能是 `1`–`200` 的整数，默认 `50`；
- 顺序固定为 `startedAt` 降序、相同时间戳按 Agent ID 升序；
- `nextCursor` 是不携带授权信息的排序边界，编码版本、`startedAt`、ID 与 `all` 过滤条件；
- 非法、非规范、超长、篡改或跨 `--all` 过滤条件复用的游标均失败关闭；
- 生命周期状态仍由现有 `effectiveBackgroundAgentState` 计算，展示字段不会回写状态文件。

`cc daemon status` 增加：

```powershell
# 获取第一页并保留下一页游标
cc daemon status --all --limit 50 --json

# 使用上次 JSON 的 nextCursor 继续读取；--all 必须保持一致
cc daemon status --all --limit 50 --cursor <nextCursor> --json
```

非 JSON 输出在存在下一页时会显示可复制的续页命令。未指定 `--limit` 或 `--cursor` 时保持原有全量列表行为，避免改变既有脚本的默认合同。

## 2. 保留的性能与一致性边界

分页限制的是调用方持有的会话数组与 IPC/CLI 输出大小，当前实现仍需枚举、读取、投影并排序全部状态 JSON，才能维持现有心跳过期和生命周期权威语义。因此：

- 未宣称磁盘读取已从 O(n) 降低；
- 未引入可能在崩溃或 CAS 竞争后陈旧的二级索引；
- 归档、只读索引与 formal 1k/10k 三平台曲线继续由 G10 容量测量的后续工作决定。

## 3. 本地验证

| 检查                                     | 结果                                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| 分页排序、同时间戳续页、游标过滤条件绑定 | `background-agent-supervisor.test.js -t stable.bounded.pages`：1 passed |
| 命令注册                                 | `background-session-command.test.js`：21 passed                         |
| 格式与空白                               | Prettier 通过；`git diff --check` 通过                                  |

完整 `background-agent-supervisor.test.js` 在当前工作树运行 598.98 秒，得到 119 passed、1 failed、22 skipped。失败项为既有真实 transport 场景 `runs follow-up turns over the session transport and finalizes on detach`，诊断状态停在 `turnBootstrapStatus:"awaiting-ready"`。本批未修改 session transport、bootstrap 或 runtime 文件；工作树同时存在这些区域的未提交变更，因此该失败不计为本批通过，也不能据此归因于分页。应在相关改动独立验证后重跑。

## 4. 后续验收

在干净的精确候选 SHA 上运行 G10 formal 三平台容量 workflow，比较全量与分页读取的响应大小、RSS 和延迟；只有数据证明索引收益且能保留 JSON 状态/CAS 权威语义时，才评估追加只读索引或归档。
