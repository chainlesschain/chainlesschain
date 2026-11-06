# 火山引擎真实推理与本地算力平台接入

日期：2026-11-06。基线 `09843429a4`，分支 `feature/dmm-native-task-create-20261106` 的未提交组合工作树。历史证据原样保留；本批与之前的测试有重叠，不累计。

| 交付项               | 当前完成情况                          | 证据与边界                                                                                                                  |
| -------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 火山引擎真实推理     | 2/2 成功                              | `deepseek-v4-1-flash-economy-261017`；说明修改不使用记忆、创建建议使用合成记忆；各一次发送，无自动重试                      |
| 真实用量             | 输入 1,015、输出 161，共 1,176 tokens | 供应商返回计数；共享 usage 记录 565/611 tokens，费用 `null`，未查验账单                                                     |
| 输出与记忆授权       | 通过                                  | 两项仅保存 pending；业务任务未修改；原 ID 重查不再发送；记忆撤权后不能读取派生草稿                                          |
| 本地 OpenAI 兼容平台 | 工程接通                              | `custom` provider，明确 loopback/RFC1918 地址及 `/v1`，可选本平台密钥；同样受治理和逐次原生授权                             |
| 力数实机             | 待连通                                | 用户截图提供 `http://192.168.31.79:8889/v1`；两次只读 `/models` 检查失败，第二次报告 `ECONNRESET`，没有 HTTP 状态或推理调用 |
| VS Code / JetBrains  | 本地算力配置入口已补齐                | 独立本地平台选项；任意平台模型 ID、可选密钥、HTTP 显式确认、原子 CLI 保存和回读；更换地址不带旧端点凭据                     |
| 回归与构建           | 见 [summary.json](./summary.json)     | 桌面/Vue、协议与恢复、CLI/IDE、Java JUnit 与本地插件构建分列；付费真实调用单列                                              |
| 尚未完成             | 保留未完成状态                        | 力数实际模型推理、真实 IDE/Electron GUI、独立业务效果、准确提交三平台发行门、灰度和迁移回退                                 |

真实推理见 [live-results.json](./live-results.json)，其中保存了调用前固定的评估条件、源码摘要、合成输出、用量与撤权检查结果。两份输出均要求核实逾期 API 交付复核状态和补充负责人/日期清单，没有声称业务已经完成；第二份实际使用了 `AZURE-17` 与 `Mira`。这是两个合成场景的初步质量核对，未做独立真实业务效果评测。

调用经过真实 SQLite、品牌 manager/client、DMM 持久请求日记、Memory Kernel 和签名**测试部署** ingress/projector，再由原生 HTTPS 向固定火山端点发送。测试宿主的原生确认回调按用户本次授权返回同意；Electron 窗口、生产部署与 GUI 没有运行。非活动 provider 与 Axios 健康探测被隔离，实际推理没有使用替身传输。治理证据可能保留输入和响应；撤权不表示已经发送的资料被收回。

适配器固定一次请求、最多 512 输出 tokens 和 30 秒总期限，拒绝重定向、压缩、非终态、工具和非法/超限回包。真实模型别名可返回不同快照 ID，供应商返回 ID 单独写入治理结果；不把请求别名冒充实际返回模型。局域网 adapter 复用这一边界，Ollama 原有 literal loopback 限制保留。有限 token/费用预算仍会在发送前拒绝；运行次数/时间预算和实际计数继续生效，未知费用不按零处理。

两端 IDE 在 **配置大模型 / Configure LLM** 选择 **Local compute / OpenAI compatible (LEXDATA / vLLM / SGLang)**，填写 Base URL 和平台 API 模型 ID。截图显示模型为 `glm5.3-flash-tensorfold`，仍以 `/v1/models` 实际返回为准。API Key 按平台要求填写，不使用火山引擎密钥。HTTP 局域网访问须在配置表单显式勾选允许。保存后测试的是聊天实际使用的 CLI；签名部署等现有运行前置条件仍然生效。DMM 起草目前在桌面入口，IDE 此次增加的是聊天/CLI 的平台配置支持。

真实调用命令（会产生费用，本目录使用独占结果文件，已有结果时拒绝再次执行）：

```powershell
node desktop-app-vue/scripts/project-goal-volcengine-live.cjs --inspect
node desktop-app-vue/scripts/project-goal-volcengine-live.cjs --confirm-live
```

力数只读连通检查（可选密钥仅通过 `DMM_PRIVATE_OPENAI_API_KEY` 环境变量提供）：

```powershell
$env:DMM_PRIVATE_OPENAI_BASE_URL='http://192.168.31.79:8889/v1'
node desktop-app-vue/scripts/project-goal-private-openai-discover.cjs
```

协议回归中的 OpenAI HTTP 回包是合成服务，不是力数/GLM 权重推理。网络检查没有取得服务响应，因此不能把失败归因为密钥或模型不存在。没有修改用户现有模型配置、安装插件、提交、发布或提升公开版本。
