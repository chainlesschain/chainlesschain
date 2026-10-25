# CLI .121：普通文本投影边界与公开发行核验（2026-10-26）

## 代码与公开发行基线

文档核对主线 `190cd133d9`，其中 PR #490 合入运行时修复，PR #492 记录公开发行证据。CLI **0.166.121**、Open VSX **0.37.161**、JetBrains **0.4.178** 均已公开，两个 IDE 推荐 CLI **0.166.121**。三者的不可变发行标签均绑定源提交 `4a7e5adc5e6a241434ecfa906a272e34b5ea6d2a`，文档提交不是重新发布的软件构建。

| 发行面            | 核验结果                                                                                       | 精确提交工作流                                                                                                                                                                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI 0.166.121     | Linux、Windows、macOS CLI CI 与 Strict Sandbox 通过；OIDC 发布、公开包完整性及 provenance 通过 | [CLI CI](https://github.com/chainlesschain/chainlesschain/actions/runs/40214024645)、[Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/40214031253)、[OIDC](https://github.com/chainlesschain/chainlesschain/actions/runs/40225573887) |
| Open VSX 0.37.161 | 真实宿主门禁通过；公开 VSIX 原始 SHA-256 与完整 ZIP 内容摘要均匹配不可变候选                   | [发布工作流](https://github.com/chainlesschain/chainlesschain/actions/runs/40227329131)                                                                                                                                                                             |
| JetBrains 0.4.178 | 宿主、构建及兼容性门通过；已批准并公开上市，公开 ZIP 描述符和编译后 CLI 推荐值通过验证         | [发布工作流](https://github.com/chainlesschain/chainlesschain/actions/runs/40227329241)                                                                                                                                                                             |

[公开发行证据](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release121-public/publication.json)记录 CLI CI 的 71 个成功任务与一个可选 dry-run 跳过，以及 Strict Sandbox 的 6 个成功任务。独立公共 npm 安装使用 `--ignore-scripts`，检查 CLI 包、十个直接子依赖的地址、完整性和固定版本，再执行 `--version` 与静态 `agent --capabilities`。这不是安装脚本、真实模型任务或原生产品验收。

JetBrains update `1202806` 的公开 ZIP 与 CI ZIP 原始字节不同。比较确认所有候选内部 JAR 条目一致，且无新增条目；不将该结论扩大为 ZIP 逐字节相同，也不推断打包差异的原因。此前审核中的观察仍保存在回读记录内。

## v6 投影规则与历史验证

`evolution-evidence-projector.js` 新增 `chainlesschain.evolution-agent-model-projection-rules/v6`，使用 JSON text policy v3：

- `bracketMarkerPolicy: bounded-display-markers-v1` 识别完整、有界的显示格式。
- `proseQuotedPairPolicy: non-sensitive-top-level-expression-v1` 处理独立、非敏感的引号说明，并约束表达式边界。
- v1 至 v5 的规则对象与摘要继续用于历史验证；不把历史证据重新解释成 v6。

`evidence-json-text.js` 原先把 `[` 后的数字或容器起始字符直接当作 JSON 候选。普通 Git、Shell、日志与 Markdown 中的 `[0 26]`、日期等随后被严格解析拒绝。v6 在通用 JSON 扫描之前，只对指定的显示格式做有限识别；这些文本仍进入普通凭据、PII 与注入扫描。

| 输入类别                                 | v6 行为                                                      |
| ---------------------------------------- | ------------------------------------------------------------ |
| 数字状态、进度、百分比、日期和时间       | 接受完整标记，例如 `[0 26]`、`[1/3]`、`[100%]` 和 ISO 时间戳 |
| Git 哈希及范围、版本链接、简单 wiki 链接 | 按有限格式识别；指数形式不能借十六进制外观绕过数值预算       |
| 数字正则范围、有限无引号 Shell 判断      | 保留显示文本，例如 `[0-9]`、`[ 1 -eq 1 ]`                    |
| ANSI 控制序列                            | 不再误报 JSON 解析错误；原有注入隔离仍执行                   |
| 独立引号说明                             | 非敏感键下可保留普通表达式，如 `"Status": done`              |
| 真正的 JSON 容器、工具参数               | 继续严格解析；工具参数仍须为对象                             |

标记扫描窗口有界，不提供通用 JSON 修复。重复键、非法转义、未闭合容器、非安全整数、无穷数及深度、层数、节点或字节超限仍拒绝。遇到识别范围以外的复杂文本，不能通过捕获全部解析异常并原样放行来规避投影。

## 敏感表达式的词法边界

`b084995bf0` 修复原始值前缀与表达式之间的边界：`"password": trueSecretValue`、带后缀的数值和拼接字符串不能只脱敏前一个 token 而泄露后缀。敏感键探测复用结构化字段规则；无法安全投影的表达式失败闭合。非敏感 prose 恢复扫描后，后续 JSON 和转义敏感键仍须独立处理。

该变更不绕过 Evolution ingress，不直接改变工具执行权限，也不把 Git push 或其他外部副作用标记为回滚。错误恢复继续以已持久化的真实工具结果、会话修订和当前 authority 为准。

## 发行验证中的平台夹具修正

`.121` 发行还修正了测试对宿主平台的假设，生产身份检查及锁预算未放宽：

- POSIX 上模拟 Windows 卷根时，测试绑定 fixture 所在卷；不假设 `/tmp` 与 `/` 的设备编号相同。真实跨设备拒绝正反例在所有平台执行。
- Windows 原生 Workbench 测试先验证正常目录身份的真实 flush；缺少 `GetFileInformationByName` 时，模拟零设备身份应准确拒绝，而不是跳过检查。
- 四进程设置写入成功夹具使用明确的十秒获锁窗口；生产默认两秒严格获锁、所有权校验和短预算拒绝反例不变。子进程二十秒、测试三十秒总期限仍保留。

这些测试变化解释发布门禁的适配范围，不构成对生产安全契约的降级。

## 继承的预算与验收边界

Session Core **0.3.23**、Agent SDK **0.2.16**、Context/Memory Kernel **0.1.10**、Personal Data Hub **0.4.66** 保持独立子包版本。文本输入快照 1 MiB、模型可见投影 896 KiB、单消息图片 20 MiB、单请求图片 40 MiB、JSONL 单事件 16 MiB 等边界沿用既有实现；详见[上一轮预算与恢复设计](./release-runtime-update-2026-10-23.md)。

跨版本累计验收仍为 **32/45**，**13** 项未完成。本轮没有新增真实模型任务验收，正式付费就绪 **NOT_PAID_READY**、原生准入 **NOT_ADMITTED**、自动晋升 **HOLD** 不变。Microsoft VS Code Marketplace 仍未发布；原版 VS Code 可安装公开版本化 VSIX。

原生产品 **v5.0.3.141** 已于 **2026-10-25 18:12:59 UTC** 正式公开（非草稿、非预发布），源码为 `a024f3c6723375bbf76d17f701917243c118b1d1`，[Release 工作流 40213914325](https://github.com/chainlesschain/chainlesschain/actions/runs/40213914325) 成功。该产品发行具有独立源码与制品，不属于 CLI `.121` 的发行树，也不增加本轮原生或模型验收；历史 `.140` 记录仅保留当时范围。
