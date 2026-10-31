# CLI 0.166.135 / IDE 升级说明

CLI **0.166.135**、Open VSX **0.37.172**、JetBrains **0.4.189** 为本轮配对版本，Kernel 保持 **0.1.11**。当前为发布准备：先完成精确源码的三系统 CLI CI 与 Strict Sandbox，再经 Actions OIDC 发布 CLI、公开回读，最后发布 IDE 插件。

本版修复非流式 OpenAI Responses 读取 JSON 时断连直接显示 `terminated` 的路径；无已接受输出时使用既有有限重试，每个物理请求单独记录，HTTP/provider 拒绝、取消、用量持久化失败与工作流禁止重放策略仍有效。请求头与 JSON 正文读取都有期限，用户取消优先。

流式请求收到完成事件即可结算，连接持续开放不再阻塞下一步；超时不再等待一个可能永不结束的 reader.cancel。未完成工具调用仍不执行、不自动重放，已经执行的工具不会因这次恢复而再次执行。

保存与恢复后台启动配置时，显式空工具白名单继续表示不允许工具；非法权限、沙箱及预算值被拒绝。修复前，空列表可能在 argv 重建时丢失，非法值可能静默变为默认值。

公开后使用 `npm i -g chainlesschain@0.166.135 --registry https://registry.npmjs.org` 升级，然后重启已经运行的 `cc ui`、终端或 IDE 聊天宿主，运行 `cc --version` 与 `cc doctor` 确认实际加载版本。Microsoft Marketplace、PC 与移动端不在本轮范围。

历史 OpenAI 实测为 **39/45**，不是本版新的 45 项通过率。此次补充错误场景回归并修复根因；旧任务、候选文件、原始失败和用量没有改写。详情见[根因分析](https://github.com/chainlesschain/chainlesschain/blob/feature/fix-openai-turn-termination/docs/research/cli/openai-turn-recovery-134.md)。

CLI 0.166.134 的候选标签指向已通过完整测试的源码，但其提交包含 `[skip ci]`，没有触发正式发布。该版本未发布到 npm。0.166.135 使用新的、无跳过标记的发布提交并重新运行完整精确提交门禁；已推送标签的源码身份保持不变。
