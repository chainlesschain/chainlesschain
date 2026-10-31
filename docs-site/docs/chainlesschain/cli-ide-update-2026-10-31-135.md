# CLI 0.166.135 / IDE 升级说明

CLI **0.166.135** 与 Open VSX **0.37.173** 已公开并完成正式制品核验；JetBrains **0.4.189** 已通过完整测试、构建与上传，仍待 Marketplace 审核/上架。两个新 IDE 的推荐版本均为 CLI **0.166.135**，但目前公开 JetBrains 仍是 **0.4.188**，其推荐标记为 CLI **0.166.133**。Kernel 保持 **0.1.11**。完整精确源码 CLI CI（76/76）和 Strict Sandbox（6/6）、OIDC 发行与独立回读已通过。

CLI / JetBrains 来源为 `82aa6d703a8695721a7ccf0793a435853bc2bbf2`，Open VSX 来源为 `98db89940de30106f57ee73c063acf249d23bec0`；后者仅修改两个 VS Code README/版本文件，CLI、Web Panel、锁文件、SDK 和 Kernel 对象相同。 [发行回执](https://github.com/chainlesschain/chainlesschain/blob/feature/fix-openai-turn-termination/docs/research/cli/evidence/release135-public/publication.json)区分公开状态和待审上传；PR #513 仍未合并。

本版修复非流式 OpenAI Responses 读取 JSON 时断连直接显示 `terminated` 的路径；无已接受输出时使用既有有限重试，每个物理请求单独记录，HTTP/provider 拒绝、取消、用量持久化失败与工作流禁止重放策略仍有效。请求头与 JSON 正文读取都有期限，用户取消优先。

流式请求收到完成事件即可结算，连接持续开放不再阻塞下一步；超时不再等待一个可能永不结束的 reader.cancel。未完成工具调用仍不执行、不自动重放，已经执行的工具不会因这次恢复而再次执行。

保存与恢复后台启动配置时，显式空工具白名单继续表示不允许工具；非法权限、沙箱及预算值被拒绝。修复前，空列表可能在 argv 重建时丢失，非法值可能静默变为默认值。

使用 `npm i -g chainlesschain@0.166.135 --registry https://registry.npmjs.org` 升级，然后重启已经运行的 `cc ui`、终端或 IDE 聊天宿主，运行 `cc --version` 与 `cc doctor` 确认实际加载版本。Microsoft Marketplace、PC 与移动端不在本轮范围。

历史 OpenAI 实测为 **39/45**，不是本版新的 45 项通过率。此次补充错误场景回归并修复根因；旧任务、候选文件、原始失败和用量没有改写。详情见[根因分析](https://github.com/chainlesschain/chainlesschain/blob/feature/fix-openai-turn-termination/docs/research/cli/openai-turn-recovery-134.md)。

CLI 0.166.134 的候选标签指向已通过完整测试的源码，但其提交包含 `[skip ci]`，没有触发正式发布。该版本未发布到 npm。0.166.135 使用新的、无跳过标记的发布提交并重新运行完整精确提交门禁；已推送标签的源码身份保持不变。

VS Code 0.37.172 被现有 Marketplace overview 单测拦截，因为 README 首段混入发行说明，不再等于包描述。保留原测试和不可变标签，仅修复 README 结构与版本，顺延到 0.37.173；没有重复发布 CLI。双 IDE 公开核验后的单次恢复探针尚未运行，历史 39/45 不改写。
