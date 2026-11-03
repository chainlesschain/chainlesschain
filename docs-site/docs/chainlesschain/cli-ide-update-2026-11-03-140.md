# CLI 与 IDE 升级：损坏工具参数恢复补丁

<!-- release140-candidate:start -->

## CLI 0.166.140 / IDE 恢复补丁准备（2026-11-03）

计划配套 CLI **0.166.140**、Open VSX **0.37.176**、JetBrains **0.4.193**。新版本完成准确源码检查和 OIDC 发布前，已核验公开 CLI 仍为 **0.166.139**。

修复模型返回损坏工具参数后自进化解析退出的问题：非法参数在执行前被拒绝，后续请求只为唯一配对、明确未执行的记录生成临时占位；原始会话历史保持完整，旧版失败调用不会被重放。有效对象、重复键与嵌套 JSON 校验、脱敏和预算边界继续生效。

本地相关检查 **129 项通过**；两条真实火山模型恢复路径通过，共 **5 次请求 / 6,401 tokens**，其中新请求场景明确注入了日志中的损坏参数。这些结果仅验证本缺陷，不增加历史大任务验收成绩。SDK **0.2.17**、Protocol **0.1.12**、Kernel **0.1.11** 和其他子包版本不变。

同一发行提交必须通过 Linux、Windows、macOS 的 CLI CI / Strict Sandbox，再由 GitHub Actions OIDC 发布并验证公开 CLI，随后发布并核验两款 IDE。JetBrains 上传、商店审核和公开可下载状态分别记录。Microsoft Marketplace 与独立 PC/移动产品不在本补丁范围。

发布后安装：`npm i -g chainlesschain@0.166.140 --registry https://registry.npmjs.org`，重启 CLI 与 IDE Agent，运行 `cc --version`、`cc doctor`。

[本次恢复实测证据](docs/research/cli/evidence/tool-argument-recovery-20261103/live-volcengine.json)。

<!-- release140-candidate:end -->

升级后可继续原会话，不需要删除历史。若自进化被关闭，普通 Agent 工具参数校验同样适用；重新启用后按原配置启动。
