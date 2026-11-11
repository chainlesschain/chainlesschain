# Git worktree 宿主恢复驱动修复（2026-11-12）

[PR #608](https://github.com/chainlesschain/chainlesschain/pull/608) 已合并，准确修正源为 `817903715360d762cdc9521ea81fbd6c04a61c77`。旧驱动把普通分支引用当作 worktree 私有文件读取，在桥接旅程开始前因找不到私有 `packed-refs` 失败。修正后通过 `commondir` 读取共享 loose/packed refs，worktree 私有引用仍在本地解析；最小 WSL/container 环境中的生产驱动继续支持没有 Git 可执行文件的情况。

| 验证                                                                                            | 结果与范围                                                                                                |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 旧函数回放                                                                                      | 从 Git 源 `703b22e89` 提取原始解析函数，在所需 CLI/vendor/fixture 已落盘的真实 worktree 中仍复现 `ENOENT` |
| 新函数对照                                                                                      | 返回值与真实 `git rev-parse HEAD` 一致                                                                    |
| 本地恢复套件                                                                                    | 4/4，包含真实桥接进程断连、终止和持久检查点恢复                                                           |
| VS Code 标准 / 扩展套件                                                                         | 353/353 与 387/387；Node 24.12.0                                                                          |
| [实际宿主恢复工作流](https://github.com/chainlesschain/chainlesschain/actions/runs/43072452004) | 4/4：真实 WSL、devcontainer、严格 SSH 及可信汇总                                                          |

[回执](./receipt.json) 保存四个原始 ZIP 的摘要、25 个原始 JSON 成员的长度和摘要、三种实际环境标志、汇总中的 manifest/outcome 绑定及两份修正源码的 Git 摘要。另保留一份本地只读回放回执，与托管原始成员分开标记。三个宿主的丢失/重复检查点、孤儿进程、过期监听接纳、未授权接纳和凭据泄露计数均为 0。

两个变更文件均在现有 `.vscodeignore` 的 `test/**` 排除范围内；CLI 运行时代码保持不变。本次完成的是测试驱动及桥接源码进程恢复验收，36+9 真实模型任务仍按独立清单验收。

```powershell
node --test packages/vscode-extension/test/host-recovery-matrix.test.cjs
npm run test:unit --prefix packages/vscode-extension
node --test packages/vscode-extension/test/*.test.cjs
```
