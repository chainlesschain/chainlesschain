# CLI .127：可选自进化、完整恢复摘要与跨端发行（2026-10-27）

## 源码与发行基线

本次核对主线 `6589d0fa332f38f1565b74c0e075f9e9be1c4cfe` 及自上一轮文档后的 Git 提交。文档提交与以下各渠道的软件发行提交分别记录：

| 渠道      | 当前公开版本            | 精确发行提交                               | 发布工作流                                                                                    |
| --------- | ----------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| CLI       | 0.166.127               | `0377050191b61894ccfa9566394560c3d1425fbe` | [OIDC 40399252204](https://github.com/chainlesschain/chainlesschain/actions/runs/40399252204) |
| Open VSX  | 0.37.165，推荐 CLI .127 | `43eff58a75c0702b17d7b99b2da5a199cef45a20` | [40403003998](https://github.com/chainlesschain/chainlesschain/actions/runs/40403003998)      |
| JetBrains | 0.4.182，推荐 CLI .127  | `abc3450c13a7f5b2ba8111973bfea6e9d8090dde` | [40409875752](https://github.com/chainlesschain/chainlesschain/actions/runs/40409875752)      |
| 移动 / PC | v5.0.3.142              | `c9881a2b710cf49f0ad3d63673e0998ecc608514` | [40418182439](https://github.com/chainlesschain/chainlesschain/actions/runs/40418182439)      |

[发布回执](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release127-public/publication.json)记录各渠道与依赖顺序。CLI 精确提交通过三平台 [CLI CI](https://github.com/chainlesschain/chainlesschain/actions/runs/40385426230) 和 [Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/40385426186)。本轮十个直接子依赖固定版本不变，Session Core **0.3.24**、Kernel **0.1.10**、PDH **0.4.66**、Agent SDK **0.2.16** 各自独立发行。Microsoft VS Code Marketplace 仍未发布。

## 可选 Evolution 入口

`0029417dfd` 与 `2aa2a250bc` 将普通 Agent、ask、chat、会话恢复与 UI 模型入口改为按选择使用 Evolution。`evolution-enabled.js` 读取用户配置 `evolution.enabled`；`evolution-deployment-loader.js` 决定部署来源并执行验证。

| 配置与部署                                             | 选择行为                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------ |
| 显式布尔值 `false`                                     | 关闭，优先于继承的部署环境变量。                             |
| 显式布尔值 `true`                                      | 开启；本地运行时可在实际使用时初始化，部署命令可主动初始化。 |
| 配置缺省，新安装或旧自动本地部署                       | 默认关闭。                                                   |
| 配置缺省，已手动配置并启用 managed/test 或显式外部部署 | 保留主动开启语义；已停用的手动部署不会重新开启。             |

缺省值与显式关闭必须区分，修改其他设置不能把用户未选择的状态意外保存成 `false`。配置只接受布尔值。外部 descriptor 和 trust root 须配套；启用部署验证失败仍向上传递错误，不自动退回普通请求。

共享入口是 CLI 配置命令、deployment enable/disable、cc ui 和两个 IDE 的 **Skill 自进化配置** 页。共享依赖相同配置目录，`CHAINLESSCHAIN_HOME` 可改变目录。关闭保留部署、信任材料与历史记录，普通工具权限和沙箱继续执行。

Quick Ask 与 UI 模型意图请求按新请求重新读取配置；运行中的 Agent 持有已选运行时，要停止再启动。切换开关本身不取消已经发出的模型请求。`evolutionEnabled`、`effectiveEnabled`、`verified` 分别表示策略、部署选择与验证结果，界面不能把“选中”显示为“已验证”。

## .123–.126 继承修复

- `8c861bdeba` 修复模型继承中的 `fable[1m]` 串用及火山引擎 404；Session Core **0.3.24** 复用 Windows ACL 校验 helper，逐次权限校验保留，减少首次响应前的进程启动开销。
- `.125` 使用 v8 投影处理已知代码字段中的 Python 列表解包、JavaScript 展开及有限表达式；Python `["git", *args]` 的成功工具历史可进入下一轮请求。严格工具参数 JSON、嵌套 JSON 校验及历史证据兼容保留。
- `8e0238ffbf` 的 `retained-context-preview.js` 统一有界恢复表示：JSON 结构化缩减或明确省略，避免按字符裁切后留下无效 JSON。文件/远端读取防循环摘要、任务进度、检查点、旧会话恢复、WORKLOG 与交接路径共同使用。

原始会话历史与证据未重写。派生摘录被省略不能充当已读取源内容；再次读取需要明确范围。`CC_AGENT_EVOLUTION_INGRESS_FAILED` 也可能表示其他原始证据或部署错误，不能宣称所有该错误均已解决。

## IDE 与客户端衔接

`6da5e0a333` 使 Open VSX 扩展在 Agent 仍可能读取输入时保留附件，并拒绝来自旧页面或会话的排队丢弃请求。公开 `.165` VSIX 的原始归档与规范 ZIP 内容摘要均匹配 CI 制品。JetBrains `.182` 已批准、上架并验证包内版本及推荐 CLI；原始候选的四个 payload 条目一致且无新增条目，但公开 ZIP 原始摘要不同，不能写成整包逐字节一致。

`70d0457181` 为 Android 本地终端增加开关按钮，通过独立 CLI 进程修改共享配置。桌面 Web 壳在每次新模型请求时重新读取共享开关；Android 发布步骤核对归档内 CLI 版本，防止旧归档混入产品。`c9881a2b71` 将产品冻结到公开 CLI `.127`。

产品 `.142` 已公开，Linux、Windows、macOS、Android、iOS 五平台工作流成功，22 个公开资产与 CI manifest 匹配，三套桌面 updater 元数据通过回读。Android 运行时另有 27 个公开内部资产；它们不是产品 Release 的 22 个资产。`14654dce73` 关闭重复的旧 Linux publisher，Linux 制品由 canonical `release.yml` 生成，避免内部 Android 二进制发布触发重复发行。

## 资源、安全与验收边界

文本输入快照 **1 MiB**、模型可见投影 **896 KiB**、图片单消息 **20 MiB**、单请求 **40 MiB**、JSONL 单事件 **16 MiB** 沿用原边界。真正损坏/重复键 JSON、敏感数据和超预算证据仍校验。会话恢复须保留图片消息包；异常不意味着外部工具副作用回滚。

自进化开关不启动完整 RRSI 活动，不发布或自动晋升候选 Skill。跨版本验收 **32/45**、**13** 项未完成，本轮未新增真实模型任务验收；**NOT_PAID_READY / NOT_ADMITTED / HOLD** 保留。公开客户端构建和制品完整性通过，不等于新增完整 native review 或模型效果验收。

## 验证与文档维护

发行权威证据为对应精确提交的 GitHub Actions 矩阵、OIDC 来源及公开制品回读。用户操作见[本轮升级指南](https://docs.chainlesschain.com/chainlesschain/cli-ide-update-2026-10-27.html)与[开关配置](https://docs.chainlesschain.com/chainlesschain/self-evolution-configuration.html)。

设计权威源位于 `docs/design/`，两个 VitePress 站点通过同步脚本生成副本；官网中英文共用 `release-status.json`。三站使用同一文档提交构建并部署，部署 manifest 记录提交、归档摘要和文件数，保留旧站点供回滚。历史日期页保留当时事实，当前入口指向本轮。

## 关键文件

- `packages/cli/src/lib/evolution/evolution-enabled.js`
- `packages/cli/src/lib/evolution/evolution-deployment-loader.js`
- `packages/cli/src/lib/evolution/optional-ui-model-turn.js`
- `packages/cli/src/lib/retained-context-preview.js`
- `packages/cli/src/lib/context-memory-kernel/task-worklog-port.js`
- `packages/vscode-extension/src/chat/draft-store.js`
- `desktop-app-vue/src/main/web-shell/ws-cli-loader.js`
- `.github/workflows/release.yml`

前序架构见[2026-10-26 普通文本投影设计](./release-runtime-update-2026-10-26.md)。
