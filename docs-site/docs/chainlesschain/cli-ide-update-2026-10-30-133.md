# CLI 0.166.133 与配套 IDE 升级

## 概述

CLI **0.166.133** 已由 GitHub Actions OIDC 发布，公开 npm 下载包与工作流不可变制品逐字节一致，签名来源已核验。Open VSX **0.37.171** 已公开，下载的 VSIX 与官方制品逐字节一致；JetBrains **0.4.188** 已批准、列出并可公开下载，ZIP 中的两份原始文件均与 CI 制品逐字节一致。两个 IDE 均推荐 CLI **0.166.133**，Kernel 保持 **0.1.11**。

[Open VSX VSIX](https://open-vsx.org/api/chainlesschain/chainlesschain-ide/0.37.171/file/chainlesschain.chainlesschain-ide-0.37.171.vsix) · [JetBrains ZIP](https://plugins.jetbrains.com/files/32208/1208135/chainlesschain-ide-bridge-0.4.188.zip)。

## 使用示例

```bash
npm i -g chainlesschain@0.166.133 --registry https://registry.npmjs.org
cc --version
cc doctor
```

升级后重启终端 Agent、`cc ui` 与 IDE 聊天宿主。

## 核心特性

- OpenAI Responses 工具续接保留必须存在的空 `reasoning.summary`，修复 `Missing required parameter: 'input[21].summary'`。
- `cc ui` 的 Chat、Agent、流式请求、Quick Ask 与 Personal Data Hub 在新请求时重新读取自进化开关。关闭自进化后，普通模型请求无需自进化证书。
- 支持通过 `custom` 显式配置 OpenAI 兼容的本机或局域网模型平台，保留配置的接口与模型别名，允许免 key 平台；此支持不限于 Ollama。
- 已授权的文件写入工具在模型 schema 中声明规范相对路径。执行时的路径、权限与文件身份检查继续生效。

## 系统架构

终端、`cc ui` 与 IDE 聊天宿主通过 CLI 运行时执行模型请求和工具调用。IDE 推荐版本与 CLI 配对，Kernel 保持 **0.1.11**。

## 配置参考

通过 `custom` 配置 OpenAI 兼容平台时，使用平台提供的接口地址和模型别名；免 key 平台可按其要求配置。自进化开关在新请求时重新读取。

## 性能指标

本次升级未提供独立的延迟、吞吐量或资源占用基准；工程回归和模型任务验收不能代替性能测量。

## 测试覆盖

CLI 与 IDE 共用准确发行源码 `2eb0c5b1e048509362f9d980f94acee55c2ffa9f`。CLI 的 Linux、Windows、macOS CI 与 Strict Sandbox 全部通过；[OIDC 发布](https://github.com/chainlesschain/chainlesschain/actions/runs/41073612529)和[独立公开回读](https://github.com/chainlesschain/chainlesschain/actions/runs/41075409835)均已成功。公开回执保存在仓库 `docs/research/cli/evidence/release133-public/`。

本次 IDE 更新推荐配套 CLI，没有独立界面改动。Microsoft Marketplace 继续暂缓，PC/mobile 保持独立版本 **v5.0.3.143**。发行和工程回归不增加真实模型任务通过数；OpenAI 36+9 任务测试在三个配套包公开核验后另行记录。历史自动累计 **34/45** 不代表新版 OpenAI 的测试结果，正式付费与原生就绪状态保持原有边界。

## 安全考虑

模型 schema 中的相对路径声明不替代执行时的路径、权限与文件身份检查。CLI 通过 Actions OIDC 发布，并核验公开制品来源和字节一致性。

## 故障排查

升级后若仍出现缺失 `reasoning.summary` 的错误，先运行 `cc --version` 确认实际加载版本，再重启终端、Web 与 IDE 宿主。运行 `cc doctor` 检查本机配置。

## 关键文件

`packages/cli/src/runtime/agent-core.js` 实现模型请求流程；`packages/cli/README.md` 记录 CLI 配套说明；`docs/research/cli/evidence/release133-public/` 保存发行核验回执。

## 相关文档

参见[后续 CLI 0.166.135 升级说明](./cli-ide-update-2026-10-31-135)及 [CLI 发行回执](https://github.com/chainlesschain/chainlesschain/tree/main/docs/research/cli/evidence/release133-public)。
