# CLI .132 与配对 IDE 升级

## 概述

CLI **0.166.132**、Kernel **0.1.11**、Open VSX **0.37.170**、JetBrains **0.4.187** 已公开并核验配对，发行源码为 `772fcdbda85bcf91df95bfced5b476dcf4c74614`。PC / mobile 仍为独立 **v5.0.3.143**。Microsoft Marketplace 暂缓；公开制品与准确来源见[发行回执](https://github.com/chainlesschain/chainlesschain/blob/0d57ebfea919ae941a36a1f11a9ee10964722120/docs/research/cli/evidence/release132-public/publication.json)。

## 核心特性

模型输出被截断时，不执行其中可能不完整的工具参数，也不把截断文本当作任务完成。只有完整用量已经记录且预算仍允许时，才可进行一次重新规划。被过滤或明确未完整结束的响应会停止并给出失败原因。

小窗口中的恢复提示不会替换原任务。普通工具执行、恢复、thinking 和 review 都保留当前真实任务的绑定；找不到任务上下文时明确停止，避免继续处理错误任务。

## 系统架构

终态与任务保护由 CLI 执行，两个 IDE 推荐同一 CLI `.132`；本版不增加独立 IDE UI 能力。Kernel、协议和默认通用 adapter 保持原边界。详情见[运行时设计](/design/release-runtime-update-2026-10-30-132)。

## 使用示例

使用 Node.js **22.12.0+**、npm **10+**：

```bash
npm i -g chainlesschain@0.166.132 --registry https://registry.npmjs.org
cc --version
cc doctor
```

版本应为 `0.166.132`。升级后重启 IDE 聊天宿主，用 Doctor 核对实际 CLI 路径。VS Code-compatible 编辑器核对 Open VSX **0.37.170**；官方 VS Code 使用[版本化 VSIX](https://open-vsx.org/api/chainlesschain/chainlesschain-ide/0.37.170/file/chainlesschain.chainlesschain-ide-0.37.170.vsix)。JetBrains 核对 **0.4.187**，从[已核验公开下载](https://plugins.jetbrains.com/files/32208/1206433/chainlesschain-ide-bridge-0.4.187.zip)安装。

## 配置参考

无需新的开关启用这组完整性保护。原硬预算、审批、权限、取消及模型配置继续生效；升级不自动启用自进化、`--review-changes` 或实验性路由。

## 性能指标

本版不承诺模型费用或性能改善。既有 Memory 100K 本机冷 p95 为 **2258.233ms**，冷目标及完整 SLO 仍未满足；不能把私有 I/O 原型当作本版已实现的性能收益。

## 测试覆盖

abbe 本机实际通过 **456/456**（18 文件、无跳过）及 **10/10 实际 CLI**（3 文件、无跳过；output-limit 5、resume 1、compaction-memory-restart 4）。后续仅修测试夹具，原 24 个运行时组件字节一致；没有声称最终夹具源码完整重跑该本机组合。准确发行源码的完整云端门禁和制品回读另见发行回执。辅助交付 **3 项**与自动验收 **34/45** 分开；不代表原任务或完整首次安装旅程已重跑通过。

发布前 7f 候选因 `readContext` 无 tool 分支重复合成 user、导致唯一任务匹配歧义而 superseded；canonical 原 user 未丢失。修复按准确 index 移动同一完整 user 对象到 `readContext` 之后，不复制 content、不丢 metadata、不造无 user fallback；matcher、Kernel、authority、budget 未改。7f 的 452+6 与 Strict 6/6、Kernel 3/3 仅为历史结果，CLI 双平台各四条失败保留，其余 CLI / IDE 作业取消，不能转作新源码门禁。

## 安全考虑

截断不授予工具执行许可，恢复不绕过硬预算。用量缺失时不能视为免费；过滤或不完整终态不能视为成功。既有 **NOT_PAID_READY / NOT_ADMITTED / HOLD** 保留。

## 故障排查

若提示缺失任务上下文，先核对当前会话和原任务，不依赖重复 Continue 猜测目标。若服务返回原 broker 的 HTTP 403，产品仍可能收不到完整用量；本版不清除旧任务锁或原失败，不应凭此重复派发历史未决请求。新版本重测使用新计划和来源，原 journal 保留。

## 关键文件

[本批实现与限定验证](https://github.com/chainlesschain/chainlesschain/blob/0d57ebfea919ae941a36a1f11a9ee10964722120/docs/research/cli-ide-release132-progress-2026-10-30.md)说明终态、当前任务绑定及原 broker 的边界；[公开发行回执](https://github.com/chainlesschain/chainlesschain/blob/0d57ebfea919ae941a36a1f11a9ee10964722120/docs/research/cli/evidence/release132-public/publication.json)绑定实际渠道和来源。

## 相关文档

- [CLI Agent](./cli-agent) · [IDE](./ide-plugin) · [Memory](./cli-memory)
- [本版运行时设计](/design/release-runtime-update-2026-10-30-132)
- [.131 历史升级说明](./cli-ide-update-2026-10-29-131)
