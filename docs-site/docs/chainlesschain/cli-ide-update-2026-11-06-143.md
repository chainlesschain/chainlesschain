# CLI .143 与 IDE：本地算力平台和待审创建请求

## 概述

Session Core **0.3.26** 和 CLI **0.166.143** 已公开，准确提交的 CLI CI **76/76**、Strict Sandbox **6/6** 三平台门禁及 Actions OIDC 发布、独立字节/签名来源回读均通过。
Open VSX **0.37.179** 已公开，下载的 VSIX 与官方制品一致；JetBrains **0.4.196** 已获批且可下载，627 个原始 payload 文件与官方构建一致。两端均推荐 CLI **0.166.143**；公开状态以[发布记录](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release143-public/README.md)为准。
本次不发布桌面、Android 或 iOS 客户端。

## 核心特性

- 两端 IDE 增加独立的 **Local compute / OpenAI compatible** 选项，支持力数、vLLM、SGLang 等平台的 OpenAI Chat Completions 接口。
- Base URL、模型 ID 和平台密钥显式绑定；密钥可按平台要求留空，切换地址不会复用旧端点的配置密钥。
- 原子保存和回读确认配置；HTTP 局域网连接需要显式勾选允许，中转站协议选项继续保留。
- 目标工具可显式导出创建请求文件或使用独立 v6 待审授权。需要匹配桌面实现及原生预览/确认，不会自动创建或执行任务。

## 使用指南

安装已核验的公开 CLI：

```bash
npm i -g chainlesschain@0.166.143 --registry https://registry.npmjs.org
cc --version
cc doctor
```

重启 IDE 聊天宿主，打开“配置大模型 / Configure LLM”，选择本地算力平台，填写平台公布的 API Base URL 和模型 ID。
力数截图示例为 `http://192.168.31.79:8889/v1`；管理页显示 `glm5.3-flash-tensorfold`，实际模型 ID 仍以 `/v1/models` 返回为准。
API Key 按平台要求填写，不使用火山引擎密钥。保存后可显式测试，测试会发送一次简短模型请求，可能产生费用。
CLI 既有签名部署等聊天运行前置要求继续生效。

## 系统架构

IDE 原生宿主收集连接配置，经 stdin 交给实际使用的 CLI 原子保存，再读取脱敏配置确认版本与端点。
聊天启动只传非敏感 provider、模型和 Base URL；CLI 从匹配端点的安全配置读取凭据。
`custom` 使用 OpenAI Chat Completions 协议，不把本地平台名称映射为云端供应商，也不会自动使用云端模型 ID。
目标创建提议与桌面业务写入分离，只有匹配桌面实现的当前预览及原生确认才能创建任务。

## 配置参考

| 字段      | 力数示例                          | 含义                                          |
| --------- | --------------------------------- | --------------------------------------------- |
| 服务类型  | Local compute / OpenAI compatible | CLI provider 为 `custom`                      |
| Base URL  | `http://192.168.31.79:8889/v1`    | 使用平台 API 地址，不附加 `/chat/completions` |
| 模型      | `glm5.3-flash-tensorfold`         | 管理页示例名称，仍需以 `/v1/models` 核验      |
| API Key   | 按平台要求填写或留空              | 不复用旧端点配置中的密钥                      |
| HTTP 确认 | 显式勾选允许                      | 适用于未加密局域网接口                        |

## 使用示例

在 VS Code 或 JetBrains 打开“配置大模型 / Configure LLM”，选择本地算力平台，输入上述 API 地址和经平台核对的模型 ID。
如平台启用鉴权，填写该平台密钥；允许无密钥访问时可留空。显式确认 HTTP 后保存，再点击“测试已保存连接”。
测试成功后重启旧聊天宿主或发送下一条新消息；运行中的任务继续使用其已经捕获的连接身份。
如果示例网络仍返回 `ECONNRESET`，先恢复服务连通性，不将该结果当作成功保存后的模型可用证明。

## 性能指标

本轮没有新的吞吐或业务效果基准。桌面火山/私有 OpenAI 草稿源码每次最多 512 输出 tokens；本机 Ollama 为 2,048。总期限为 30 秒，无自动重试。
IDE 连接配置与模型能力、模型质量及平台可用性分别验证；不能从平台名称推断工具或视觉能力。

## 测试覆盖

此前工程批次 25 文件/类、374 项回归及 22 项检查通过，JetBrains 本地构建成功。
两个合成真实火山场景通过，共 1,176 tokens，费用未知；这是桌面源码链路验证，不是 IDE GUI 或独立业务验收。
准确发行提交 `3fa3a4b258bbcb60b23b4298cec375661ad6f410` 的完整 CLI CI 和 Strict Sandbox 三平台结果，以及独立 npm 公开制品字节与签名来源回读均已通过。IDE 宿主发布门禁和渠道公开状态单独记录。

## 安全考虑

密钥通过 CLI 安全输入/存储，不写入 IDE 设置或子进程 argv。已有端点留空可保留该端点的密钥；切换新端点不得借用旧密钥。
HTTP 确认不表示访问已加密。目标创建与模型草稿仍需独立授权；Memory 撤权阻止未确认输出继续使用，不撤回已发往模型的资料。

## 故障排查

- 力数示例端点当前检查返回 `ECONNRESET`，尚未收到 HTTP 状态，不能据此判断密钥或模型不存在。先确认本机到该 API 的网络和服务状态。
- 模型 ID 不能使用未经 `/v1/models` 核对的管理页名称。
- 连接测试与聊天运行使用实际配置的 CLI；遇到 CLI 启动或签名部署错误，按提示修复对应前置条件。
- 新创建能力需要匹配桌面实现；本次 CLI/IDE 发布不等于现有公开桌面端已升级。

## 关键文件

- `packages/vscode-extension/src/ui/llm-config-panel.js`：VS Code 配置。
- `packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/LlmConnectionPanel.java`：JetBrains 原生表单。
- `packages/cli/src/lib/llm-connection-config.js`：原子保存与凭据隔离。
- [工程完成表](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/agents/chainlesschain-dots-muse-mods-analysis-2026-10-06.md)。

## 相关文档

- [CLI 指南](./cli.md)
- [IDE 桥接指南](./ide-bridge.md)
- [上一版升级说明](./cli-ide-update-2026-11-05-142.md)
- [本次发布状态](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release143-public/README.md)
