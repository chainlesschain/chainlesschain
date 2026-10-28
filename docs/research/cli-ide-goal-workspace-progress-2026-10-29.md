# Goal 证据与工作区版本绑定

日期：2026-10-29。对应[差距评审](./cli-ide-codex-claude-gap-review-2026-10-27.md)第 4.2、4.3、4.10 节，承接[第十三批预算修复](./cli-ide-goal-budget-progress-2026-10-29.md)。本批直接修改 `main`，Microsoft 渠道继续暂缓。

原实现只通过已观察的工具调用判断证据是否过期；用户、编辑器或后台进程直接修改文件不会增加该轮工具修订号。默认模型评审可能引用已不对应当前文件的成功检查结果。

本次提取 [goal-workspace-evidence.js](../../packages/cli/src/lib/goal-workspace-evidence.js)，由主机读取实际字节、计算 SHA-256 和文件身份信息。默认模型 Goal 的工具执行前后、模型评审前后均核对同一范围；判定采用评审返回后的证据状态。

| 项目       | 本次完成情况                                                              | 验证证据 / 边界                                                                                           |
| ---------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 产物绑定   | `read_file` 绑定工作区内具体文件的字节数、内容摘要与工作区身份            | 外部覆写、删除、同路径替换，以及评审期间改动均拒绝原成功声明；包括被 Git 忽略的产物                       |
| 源码绑定   | `run_shell` 绑定检查开始和结束时的源码范围                                | Git 范围为 `cwd` 下已跟踪及未忽略文件，含已删除跟踪文件的缺失状态；普通目录递归覆盖文件集合               |
| 读取一致性 | 校验路径 / 打开句柄身份、读前读后属性、文件清单和工作区身份               | 读取过程不稳定、文件集合新增、链接指向外部、特殊文件或覆盖不足不产生合格证据                              |
| 模型判定   | 只能引用成功、结束、当前且绑定有效的观察                                  | 模型返回后再次核对；模型消耗的已知用量仍计入结果，即使其成功结论被拒绝                                    |
| 取消       | 读取过程接入运行及 session budget 的取消信号                              | 取消不降级为普通未达标后再触发外层续跑；原有预算、取消回归继续通过                                        |
| 持久化     | evaluated Goal checkpoint 附带本次 evaluation；完成事件保留引用范围与摘要 | 沿用先持久化、后公布完成的顺序；恢复时不把旧绑定当成本轮新观察                                            |
| 回归       | Windows / Node 22.22.2，10 个套件、240 项通过                             | 13 项新文件绑定测试、3 项默认模型评审集成负例，加完整 headless / Goal / 预算 / 账本回归；没有真实模型调用 |
| 源码审查   | 1,701 个源码 / 脚本文件，78 个网络候选，0 项审查问题                      | Git 只读清单通过既有进程 broker，未新增模型出口或改变付费 / native 准入                                   |

代码范围与证据边界：

- Git 源码范围不覆盖 `.git` 元数据、被忽略的依赖 / 构建目录或工作区外文件。被忽略的具体产物可经 `read_file` 独立绑定；其他工具观察不能自动获得这两类覆盖。模型提示明确说明这些范围，不能由摘要推断整个运行环境或远端资源已验收。
- 不创建 Git 检查点、不写索引、不运行过滤器；只读清单失败时不退回不完整的目录扫描。未建立跨进程排他锁，不宣称防住恶意文件系统 ABA 替换，也不保证最终核对之后永不变更。
- 每次捕获上限为 50,000 项、总计 512 MiB、单文件 64 MiB、15 秒；Git 清单调用最多 5 秒。超过上限保持待核验，不能截断后当作完整证据。对超大工作区可使用用户明确指定的确定性检查，不将未覆盖范围标为已验证。
- 摘要只证明指定范围的新鲜度；仍需独立 checker 判断产物质量、固定真实任务统计误报率，以及 CLI / 双 IDE 原生旅程和准确提交的三系统门禁。本批未发布 npm / IDE 包，不改变 `NOT_PAID_READY` / `NOT_ADMITTED` / `HOLD`。

新增读取成本单独测量：Windows 本地合成目录含 1,000 个各 1 KiB 的文件，五次顺序捕获耗时分别为 **1512.32、1401.05、1489.04、1485.74、1605.88 ms**。这是小规模开销样本，不是全仓库或生产 SLO；源码检查前后及评审前后会产生额外读取。原第 4.8 节 Memory 完整性能验收仍未完成。

原始测试 JSON 压缩归档、源码摘要、出口审查与开销样本见[验证回执](./cli/evidence/goal-workspace-2026-10-29/verification.json)。语法、Prettier 和 `git diff --check` 通过；本地 ESLint 依赖缺失问题沿用上一批记录，未声称 lint 通过。

复现回归：

```powershell
cd packages/cli
node ../../node_modules/vitest/vitest.mjs run __tests__/unit/goal-workspace-evidence.test.js __tests__/unit/goal-check-evidence.test.js __tests__/unit/headless-goal-model-budget.test.js __tests__/unit/goal-model-call.test.js __tests__/unit/headless-runner.test.js __tests__/unit/headless-runner-cost-budget.test.js __tests__/unit/headless-runtime-ledger-failclosed.test.js __tests__/unit/goal-assess.test.js __tests__/unit/direct-model-usage.test.js __tests__/unit/goal-condition-engine.test.js --maxWorkers 1
```

真实任务合格产物仍为 **34/45**，剩余 **11** 项；本批只推进证据可信度，不把本地回归次数计入产物验收。
