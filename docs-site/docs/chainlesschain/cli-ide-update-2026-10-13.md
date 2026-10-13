# CLI 0.166.100 升级与运行时修复

## 概述

2026-10-13 已核验公开 CLI **0.166.100** 与 Open VSX **0.37.144**，发行源码为 `6a8db627c8`；Open VSX 推荐 CLI `0.166.100`。JetBrains **0.4.162** 已通过发布工作流并上传，公开上架与下载尚待核验；最后已核验的公开版本 **0.4.161** 推荐 CLI `0.166.99`。主线已合并 PR #435，文档源码基线为 `main@283634169a`。

本轮重点是流式响应重试、任务交付、文件字节保护、工作树读取及 IDE 刷新。Session Core **0.3.19**、Context/Memory Kernel **0.1.9**、Agent SDK **0.2.14**、PDH **0.4.64** 保持各自发行身份。桌面与移动端仍单独使用产品 **v5.0.3.140**。

## 核心特性

- 网络恢复遵守可取消、最多 60 秒的单次等待；终止性服务错误或已经显示的流式输出不会自动重放。
- Chat 正确传递 token 回调与请求选项；有限预算任务获得交付提醒，同时保留稳定的模型缓存前缀和当前用户任务。
- 编辑遇到无效 UTF-8 时拒绝改写原文件；有效 BOM、Unicode 与 CRLF 保持原有字节语义。空搜索和暂停工具请求也有更明确的校验与关联。
- 读取 Git 工作树登记时，仅对指定的临时缺失锁文件错误最多读取三次；创建、删除等写操作不重试。
- Open VSX 在用户操作期间延后周期刷新，丢弃过期结果，并隔离各面板的刷新状态。JetBrains .162 的检查点菜单交接改进在公开回读完成前仍属于未公开版本。

## 系统架构

CLI 负责会话、权限、工具执行和模型请求；IDE 展示其权威状态，不直接取得执行或发布权限。工作树重读仍校验最新登记结果，不会绕过已锁定工作树或路径保护。Session Core .19 增补 Windows 私有存储 ACL 启动和阶段诊断，失败仍拒绝访问；Kernel .9 的版本变化用于绑定测量脚本的规范临时目录修复，不代表新增记忆功能。

## 配置参考

| 项目 | 当前状态 |
| --- | --- |
| Node.js / npm | ≥22.12.0 / ≥10.0.0 |
| CLI | 0.166.100，npm 已公开 |
| Open VSX | 0.37.144，已公开，推荐 CLI 0.166.100 |
| JetBrains | 0.4.162 已上传，公开上架与下载待核验；公开 0.4.161 推荐 CLI 0.166.99 |
| Session Core / Kernel | 0.3.19 / 0.1.9，使用已发布子包 |
| 原生产品 | v5.0.3.140，独立安装包 |

原有 provider、模型和权限设置继续使用。Haiku 5.5 的能力、输出与计费规则按准确模型身份处理；Sonnet 5.5 cache-read 费率已更正。缺失账户价格、地区或缓存期限证据时，不把估算当作实际账单。

## 性能指标

60 秒是流式重试单次等待上限，不是回答时延承诺。IDE 刷新修复减少过期投影和重复读取，不代表已完成长时性能验收。CI scheduler smoke 的 lease 余量调整属于测试配置修正，不能解释为已证明此前短 lease 失败的根因。

## 测试覆盖

CLI 与 Open VSX 的发行结论来自准确源码的 GitHub Actions 门禁、发布及公开制品核对，[发行记录已归档](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/gap-2026-10-05/release-0.166.100/publication-20261013/README.md)。工作树回归包括真实 Git fixture 和指定错误的故障注入；它不等同于自然复现并发竞态。JetBrains 宿主通过也不等同于 Marketplace 已公开，安装状态以[发布指南](./agent-platform-release)为准。

正式 **36+9** 评测仍为 **NOT_RUN**，完整 native review 为 **NOT_ADMITTED**，自动晋升保持 **HOLD**。局部真实模型诊断、离线回归和发布门禁不能代替这些验收。

## 安全考虑

本轮继续保留审批、沙箱、工作树锁和失败闭合。不要手动删除活跃锁以解决重试错误。预算权威开发分支 `31ff33a228` / PR #436 未进入本次发行，仍为 **NOT_PAID_READY**；CLI .100 不提供已完成全运行时覆盖的正式付费预算承诺。

## 故障排查

| 现象 | 建议 |
| --- | --- |
| IDE 仍显示旧 CLI | 重启聊天宿主，运行 Doctor，核对实际可执行文件路径并与 `cc --version` 比较 |
| JetBrains 仍推荐 .99 | 当前公开 .161 的推荐值；等待 .162 公开回读，并用 Doctor 核对已安装版本 |
| 服务返回终止错误或输出中断 | 保留错误与已显示内容，确认任务状态后决定下一步；不要假定系统已自动重放 |
| 工作树读取三次仍失败 | 保留 Git 错误，检查仓库和其他活动进程；写操作没有自动重试 |
| 文件编辑提示 UTF-8 无效 | 先确认文件编码并备份，使用合适的编码工具处理；拒绝编辑会保留原字节 |
| 费用显示未知 | 核对账户和请求用量；工具估算、鉴权调用及整段任务费用分别记录 |

## 关键文件

源码中的 `stream-retry.js`、`chat-core.js`、`agent-core.js` 与 `harness/worktree-isolator.js` 对应流式和工作树修复。IDE 的实际 CLI 身份通过 Doctor 查看；不要直接修改已安装扩展或其 SDK 文件。

## 使用示例

结束活动任务后安装公开 CLI：

```bash
npm i -g chainlesschain@0.166.100 --registry https://registry.npmjs.org
cc --version
cc doctor
```

从 [Open VSX](https://open-vsx.org/extension/chainlesschain/chainlesschain-ide) 安装 .144，重启聊天宿主后确认推荐值。JetBrains 用户先查看 [Marketplace](https://plugins.jetbrains.com/plugin/32208-chainlesschain-ide-bridge) 的实际公开版本与[发布指南](./agent-platform-release)。桌面、Android 和 iOS 使用[产品 .140 下载](https://github.com/chainlesschain/chainlesschain/releases/tag/v5.0.3.140)，不会随 npm 安装自动更新。

## 相关文档

- [发布与升级](./agent-platform-release)、[安装](./installation)、[IDE 安装与诊断](./ide-plugin)。
- [CLI 当前运行时](./cli-runtime-current)、[10 月 10 日历史指南](./cli-ide-update-2026-10-10)。
- [本轮设计与验收范围](/design/release-runtime-update-2026-10-13)。
