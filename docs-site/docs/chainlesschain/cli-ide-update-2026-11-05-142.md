# CLI .142 与 IDE 配套升级：授权目标事件和历史恢复

## 概述

截至 2026-11-05，Session Core **0.3.25**、CLI **0.166.142**、Open VSX 扩展 **0.37.178** 已公开。
JetBrains **0.4.195** 已通过官方宿主矩阵和上传，商店已批准并公开列出，626 个原始 payload 文件与官方构建内容一致。
不可变 npm 和 IDE 发行源码为 `b78cf0af8c8b0491189465773b148ac77c332222`。

PC、Android 和 iOS **v5.0.3.145** 正在准备发行，当前已核验公开客户端仍是 **v5.0.3.144**。
用户已明确授权本次客户端在核验 JetBrains 官方上传后先行发布，不等待商店审核。
其他公开依赖、构建和制品核验继续执行。Microsoft Marketplace 渠道仍暂缓。

## 核心特性

- **另行授权的目标事件。** 插件可显式观察目标状态或桌面风险与动作摘要，读取时重新检查授权、信任和插件声明。
- **保留历史恢复。** 新桌面端 v5 历史授权独立于旧授权。CLI 每次读取一页，确认输出和重新核验后原子提交检查点；中断可能重复事件，应按事件 ID 去重。
- **IDE 显式恢复。** 原生文件选择器传递连接与检查点路径，提供新建、恢复、下一页和取消操作，没有自动重试或持续翻页。
- **组合交付场景。** `project-delivery-assistant` 0.2.0 组合已有证据、事件、历史和待确认描述草稿；安装不会启动自动工作，也不自动创建或执行任务。

新的原生历史入口需要匹配的新版桌面客户端；仅升级 CLI 或扩展不能为旧桌面端增加该入口。
日志保留最近 1000 条已接入事件，没有旧版本历史回填。事件、检查、动作回执和描述编辑都不证明业务目标完成。

## 系统架构

桌面端保留原生授权与确认入口，Session Core 记录已接入的事件，CLI 通过独立历史连接读取一页并提交检查点。
IDE 启动所属 CLI 子进程，验证成功退出后的有界结果并显示纯文本；它不读取连接凭据或检查点正文。
插件的信任与能力同意、桌面连接授权和原生动作确认分别生效。

## 配置参考

使用 Node.js **22.12.0+**、npm **10+**：

```bash
npm i -g chainlesschain@0.166.142 --registry https://registry.npmjs.org
cc --version
cc doctor
```

重启 CLI、`cc ui` 和 IDE 聊天宿主，检查 IDE 实际连接的可执行路径。
Open VSX 可安装 **0.37.178**，JetBrains Marketplace 可安装 **0.4.195**，两者均推荐 CLI **0.166.142**。
上一已核验公开的 JetBrains **0.4.194** 推荐 CLI **0.166.141**，新插件的推荐关系不适用于旧插件。

## 性能指标

本轮没有新增吞吐或延迟基准。恢复操作每页最多扫描 20 条事件、返回 16 KiB，账本最多保留最近 1000 条已接入事件。
IDE 实时观察最长运行 60 秒，显示最近 50 条观察结果。这些是操作边界，不代表目标完成率或业务效果。

## 测试覆盖

准确发行提交的 CLI CI 跨全部配置操作系统完成，**75 项成功、1 项可选 dry-run 跳过**；Strict Sandbox **6/6** 成功。
Actions OIDC 先发布并核验必需子包，再发布 CLI。独立回读确认公开 tarball 与不可变工作流制品逐字节一致，来源签名匹配准确提交。
Open VSX 流程已核验公开 VSIX。JetBrains 上传与商店审核通过分别记录。

registry-only 的 `--ignore-scripts` 安装和签名核验不等于完整 native/postinstall、真机或真实 DMM GUI 验收。
本轮未新增付费模型任务评测，既有任务验收结果不因工程检查或发行而提升。

历史 Sol 原冻结项目 **41/45**、含修正项目的跨版本累计 **45/45**、独立修正四项 **2/4**，以及火山修正轮生成 **39/45**、严格 **24/45**、历史累计 **36/45** 各自保留原范围，不构成本轮 DMM 的业务效果验收。

## 安全考虑

历史读取必须另行导出 v5 授权；v1–v4 连接不会自动获得历史权限。连接文件包含私密授权信息，应保存在本机并避免提交到 Git。
检查点仅保存绑定和不透明游标，不包含凭据或事件正文。插件同意被撤销、连接失效或目标绑定变化时，读取会停止。
退出码 0 表示检查点已提交，不表示下游已消费结果。取消后检查点可能已经推进，应保留文件并显式恢复。

## 故障排查

- 版本不一致：检查 `cc --version`、`cc doctor` 和 IDE 配置的可执行路径，重启旧宿主后重新连接。
- 连接过期：在桌面端重新授权。目标版本和插件声明仍相同时可使用原检查点；身份或绑定变化需要显式新建检查点。
- `GOAL_EVENT_HISTORY_GAP` 或 `GOAL_EVENT_HISTORY_REGRESSED`：分别检查历史淘汰或数据库恢复情况，避免无条件删除检查点重试。
- JetBrains 未刷新到新版：检查所选商店和缓存；本次 .195 已公开，其他版本的上传成功仍不能代替公开核验。

## 关键文件

| 文件                               | 用途                                   |
| ---------------------------------- | -------------------------------------- |
| `history-connection.json`          | 用户另行导出的私密 v5 授权，需妥善保存 |
| `goal-checkpoint.json`             | 新建或恢复读取的本地检查点，中断后保留 |
| `chainlesschain-npm-readback.json` | 官方公开包与不可变构件字节核验回执     |
| `jetbrains-upload-authority.json`  | 本轮客户端先行发行所核验的官方上传身份 |

后两项公开证据见下方完整发行记录；前两项是用户自选的本地文件名。

## 使用示例

在匹配的新版桌面端导出独立历史连接，并安装、信任和同意所选插件后，显式创建检查点并读取一页：

```bash
cc goal replay <goal-id> --connection ./history-connection.json --checkpoint ./goal-checkpoint.json --checkpoint-mode new --plugin goal-project-observer --scope project --json
```

下一次使用相同目标、连接绑定和插件显式恢复，读取下一页：

```bash
cc goal replay <goal-id> --connection ./history-connection.json --checkpoint ./goal-checkpoint.json --checkpoint-mode resume --plugin goal-project-observer --scope project --json
```

已有文件不能用于 `new` 模式；`resume` 不会创建丢失的检查点。发生中断时先检查已显示的事件 ID，按至少一次投递处理可能的重复。

## 相关文档

[完整发行记录](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release142-public/README.md)
· [npm 发布](https://github.com/chainlesschain/chainlesschain/actions/runs/41887211826)
· [独立回读](https://github.com/chainlesschain/chainlesschain/actions/runs/41950556751)
· [Open VSX](https://github.com/chainlesschain/chainlesschain/actions/runs/41950792178)
· [JetBrains](https://github.com/chainlesschain/chainlesschain/actions/runs/41950791667)
