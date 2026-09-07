# Desktop 模型治理与失败闭合

> 适用范围：`main@5db62db246` 源码（2026-09-07）  
> 发布边界：本页描述晚于 CLI `0.166.30@87ddf8b126` 的 Desktop 源码。它不是 npm CLI 字节，也不代表公开 Desktop 安装包已经完成发布、升级与回滚验收。

## 概述

桌面端的模型请求不再只治理“聊天”入口。普通对话、流式输出、函数工具、多模态、记忆摘要等已接入同一受治理 Run；已识别但尚无可信桥接的旧 embedding、reranker、媒体、项目、文档和 RAG 直连会在发送数据前拒绝。

这意味着：

- prompt、工具调用、工具结果和模型终态保持同一条可审计链路。
- 治理或证据写入失败时不会静默改走另一个 provider、旧 HTTP backend 或普通关键词 fallback。
- 图片、音频、视频、query、候选文档和项目内容不会因辅助功能绕过统一入口。
- 已验证的缓存命中可以复用，但必须与当前请求的 provider、model、connection、messages 和 options 精确绑定。

## 核心特性

### 正常对话与工具调用

已配置可信 Desktop deployment host 时，聊天、流式响应和工具调用照常运行。一次工具工作流中的多轮模型请求会共用同一 Run；工具执行失败会被记录后返回，不会伪装成成功。

### 旧功能被拒绝

若看到 `CC_AGENT_EVOLUTION_INGRESS_FAILED` 或 “requires a governed model ingress”，表示该请求无法满足当前治理条件，系统已在网络发送前停止。常见范围包括：

- 外部图片生成、视觉识别、Whisper 转写或视频生成；
- 独立 embedding / CrossEncoder / BGE reranker；
- 项目 AI backend 与项目流式创建；
- Word、PPT、PDF、Excel、Document 的旧 AI backend；
- legacy RAG 的 index/query/update。

这不是网络重试类错误。不要通过修改旧 URL、关闭错误检查或直接调用 backend 绕过。可继续使用产品保留的本地路径、规则引擎或默认结构 fallback；需要远程模型能力时，由管理员接入受治理 bridge。

### 健康检查

Volcengine 健康检查现在只验证 `apiKey`、`baseUrl` 和 `model` 是否已配置，不再发送一次真实模型请求，因此不会因打开设置页产生 token 或费用。

“配置完整”不等于远端服务、余额和模型权限可用。需要真实连通性检查时，请显式执行 `cc llm test`；该命令会发送一条很短的模型请求，可能产生少量费用。

## 系统架构

```text
Desktop UI / IPC
       │
       ▼
DesktopModelIngress ── admission / policy / EvolutionRun
       │
       ├─ provider adapter ── OpenAI / Anthropic / Gemini / Ollama
       ├─ governed tool loop ── request / result / terminal evidence
       └─ response cache ── request key + authenticated receipt

legacy media / embedding / reranker / project / document / RAG
       └─ no trusted bridge → reject before network send
```

Renderer 只提交有界请求；provider 适配、工具循环、终态验证、缓存 receipt 和审计结算留在主进程受治理入口。任一必需证据不可用时，整个请求失败闭合。

## 使用示例

CLI `0.166.30` 支持原子保存连接。配置从 stdin 读取，API Key 不进入命令行参数或 shell history：

```bash
printf '%s' '{"provider":"openai","model":"gpt-4o","baseUrl":"https://api.openai.com/v1","apiKey":"REPLACE_ME"}' \
  | cc llm configure

cc llm test
```

PowerShell 7 可避免把密钥写入历史：

```powershell
$secret = Read-Host "API Key" -MaskInput
$payload = @{ provider = "openai"; model = "gpt-4o"; baseUrl = "https://api.openai.com/v1"; apiKey = $secret } | ConvertTo-Json -Compress
$payload | cc llm configure
cc llm test
```

## 配置参考

`provider` 同时选择 wire protocol，可用 `openai`、`anthropic`、`gemini` 或 `ollama` 等内置标识。自定义中转站通常选择其兼容协议，并把 `baseUrl` 填到 API 基础路径，不要填 `/chat/completions`、`/messages` 等完整调用端点。

安全规则：

- 远程地址默认要求 HTTPS；显式确认后才允许远程 HTTP。
- URL 不允许内嵌用户名、密码、query 或 fragment。
- 切换 provider 或 Base URL 时必须提供新目标自己的 API Key，旧密钥不会跨站复用。
- `cc llm test` 拒绝重定向，使用 20 秒有界超时，并按各 provider 原生协议探测。

VS Code / VSCodium `0.37.87` 可从 **ChainlessChain: Configure LLM** 打开页面化配置。页面不会回显已保存密钥；保存成功后再测试，下一条聊天消息使用新配置。CLI 还可用 `--storage auto|keychain|file` 选择密钥存储；生产桌面环境优先使用 `auto` 或 `keychain`。

## 性能指标

治理入口不承诺固定模型延迟；耗时取决于 provider、模型、上下文、工具轮次和网络。实现中的硬边界包括：连通探测 20 秒超时、工具循环最多 16 轮、有界输入/输出，以及取消后不再提交缓存。trust-epoch 缓存已把千事件基准的签名检查从约 2,017,022 次降到 1,002 次，但历史 JSON 读写仍是后续优化项，不能据此承诺线性端到端耗时。

## 安全考虑

Desktop response cache 只接受带认证 evidence receipt 的记录。以下情况不会复用缓存：

- provider、model、Base URL、消息或 generation options 任一变化；
- options 包含无法安全快照的值；
- receipt、request key 或恢复结果不一致；
- 请求已取消。

缓存验证失败会终止受治理工作流，不会读取旧裸值或回退到未治理模型请求。

密钥不得出现在 argv、日志、会话导出或 URL 中；远程 HTTP 必须显式确认，重定向默认拒绝。不要把本地测试 profile、测试密钥或 renderer payload 当作生产 authority。

## 故障排查

1. 记录最外层错误和 `cause`，确认是否为 `CC_AGENT_EVOLUTION_INGRESS_FAILED`。
2. 核对签名 deployment descriptor、tenant identity、policy、ArtifactStore、Ledger 与 witness 是否可用。
3. 核对 provider 返回是否包含合法终态：OpenAI SSE 终止帧、Gemini `finishReason`、Ollama `done: true`。
4. 工具循环检查 tool ID、函数名、JSON 参数与 1–16 轮限制。
5. 只有治理链恢复后才重试；不要改回 direct HTTP 或把治理错误当普通 fallback。

生产环境还需提供真实 KMS/HSM、PKI、身份/撤销服务、跨主机 witness、grader 和灾备演练。源码中的本地测试 profile 或测试密钥不能用于生产。

## 测试覆盖

当前源码覆盖普通响应、SSE 流、四类 provider 协议、工具调用与多轮结算、多模态桥、缓存 receipt、取消、非法终态、旧直连拒绝和 witness trust-epoch。发布或部署前仍需在目标系统上验证真实 provider、密钥存储、代理/TLS、故障注入、KMS/PKI/witness 和 Desktop UI journey；源码单测不能替代这些验收。

## 关键文件

- `desktop-app-vue/src/main/evolution/desktop-model-ingress.js`：统一 Desktop 模型入口。
- `desktop-app-vue/src/main/evolution/`：EvolutionRun、证据、账本与 witness 组合。
- `packages/cli/src/commands/llm.js`：`cc llm configure/test` 用户入口。
- `docs/design/modules/113-governed-desktop-model-ingress-design.md`：完整设计与边界。

## 相关文档

- [Agent Platform 发布与升级](/chainlesschain/agent-platform-release)
- [LLM 管理](/chainlesschain/cli-llm)
- [受治理的 Skill 自进化](/chainlesschain/governed-skill-evolution)
- [设计文档：Desktop 受治理模型入口](/design/modules/113-governed-desktop-model-ingress-design)
