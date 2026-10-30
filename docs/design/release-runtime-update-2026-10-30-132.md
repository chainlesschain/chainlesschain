# CLI .132：响应终态与当前任务保护

## 公开制品与来源

CLI **0.166.132**、Kernel **0.1.11**、Open VSX **0.37.170**、JetBrains **0.4.187** 的公开状态与配对已经核对。发行源码为 `772fcdbda85bcf91df95bfced5b476dcf4c74614`；两个 IDE 推荐 CLI `.132`。PC / mobile 保持独立 **v5.0.3.143**，Microsoft Marketplace 暂缓。准确源码门禁、OIDC 与制品回读见[公开发行回执](https://github.com/chainlesschain/chainlesschain/blob/0d57ebfea919ae941a36a1f11a9ee10964722120/docs/research/cli/evidence/release132-public/publication.json)。不从 CLI 更新推断客户端新版本或功能验收。

## 响应终态完整性

OpenAI Chat JSON 与 SSE 路径保留 provider 的终止原因。`length` 截断响应中的工具调用不得执行，也不能以其文本判定任务成功；完整用量结算、仍有预算且满足恢复条件时，最多一次重新规划。`content_filter` 与显式不完整终态返回明确失败。未知用量、硬预算或取消条件不因恢复提示而放行。

恢复提示由 canonical pending hint 承接，不伪装成新的用户任务。当前真实任务由 CLI 宿主统一绑定，覆盖普通工具、恢复、thinking 和 review；按完整 role/content/metadata 重定位，兼容重复 Continue，保留 hermetic 原合同。缺失任务身份明确失败，不猜测或静默替换任务。修改限于相应 CLI 宿主与响应处理，Kernel `.11`、协议及默认通用 adapter 不因此改变。

发布前 7f 候选因 `readContext` 无 tool 分支重复合成 user、导致唯一任务匹配歧义而 superseded；canonical 原 user 未丢失。修复按准确 index 移动同一完整 user 对象到 `readContext` 之后，不复制 content、不丢 metadata、不造无 user fallback；matcher、Kernel、authority、budget 未改。7f 的 452+6 与 Strict 6/6、Kernel 3/3 仅为历史结果，CLI 双平台各四条失败保留，其余 CLI / IDE 作业取消，不能转作新源码门禁。

## 验证与限制

| 证据                | 已验证范围                                                                                                  | 不外推的范围                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| abbe 本机运行时组合 | 18 文件 **456/456**，无跳过；3 文件实际 CLI **10/10**，无跳过；后续仅修测试夹具，原 24 个运行时组件字节一致 | 没有声称最终夹具源码完整重跑此本机组合；不是付费模型任务或完整双 IDE 旅程   |
| 新版发行            | 准确源码完整门禁及公开回读见本页发行回执                                                                    | 本机回归不能替代云端发行门；旧 source44 macOS 容量取消结果不转移            |
| 辅助回归            | verify-07 / 09 / 10 原 checker 通过并已安装；辅助交付 **3 项**                                              | 自动交付仍 **34/45**；原失败、历史未决与各自 journal 保留                   |
| 原 broker 403       | 原截断锁定当前 task；CLI 未收到该次完整 usage                                                               | 产品收到正常 provider 终态时的修复不能补齐原 403 协议、推算费用或清除旧失败 |
| Memory              | 既有 100K 本机冷 p95 **2258.233ms**                                                                         | 冷查询 1 秒目标和完整 SLO 仍未解决，私有 I/O 原型不算产品成功               |

**NOT_PAID_READY / NOT_ADMITTED / HOLD** 保留。新版真实重测以新 plan/source 单独记账，不迁移旧 journal。实现、发行和真实任务验收分别记载。

## 关联记录

- [本批修复与验证来源](https://github.com/chainlesschain/chainlesschain/blob/0d57ebfea919ae941a36a1f11a9ee10964722120/docs/research/cli-ide-release132-progress-2026-10-30.md)
- [用户升级说明](https://docs.chainlesschain.com/chainlesschain/cli-ide-update-2026-10-30-132.html)
- [.131 历史设计](./release-runtime-update-2026-10-29-131.md)

`docs/design/` 为权威源。`docs-site/docs/design/` 与 `docs-site-design/docs/` 由既有同步脚本生成；源码同步、站点构建、部署和公网回读分别验证。
