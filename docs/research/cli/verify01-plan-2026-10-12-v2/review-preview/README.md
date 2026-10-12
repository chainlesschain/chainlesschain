# v2 完整 Linux 验收包预览

[linux-review-preview.tgz](./linux-review-preview.tgz) 包含36项任务的72个自包含setup/check脚本及review.json、review.sha256、pack.json；[manifest.json](./manifest.json)锁定压缩包和全部75个文件的字节摘要。当前为 **PREVIEW_NOT_HUMAN_APPROVED**，不授予实际付费执行或账号额度。

此包对应v2计划指纹 `sha256:9c3db6e9b49da0c152b9e5cfba56ade64da50e727591b75d2dc9203ba6ae53cd` 和reviewDigest `sha256:14033f24125c7319f978d5044b2cec16cb5245cfa7019c7879c9d02c2b78dc79`。其中Docker image ID来自历史实际记录，本轮尚未重验。新的Actions预检将真实拉取/锁定镜像并生成自己的reviewDigest，必须审阅并外部锁定那一份。

解包到新的、位于被测项目外的目录后，审阅各check脚本的正向断言、原回归、确定性反例、Docker挂载/网络/权限和允许改动路径；结合[原验收合同](../../verify01-plan-2026-10-04/COLLECTION_README.md#36-项-setupcheck-生成器)核对。签核应提供实际人员、时间、记录路径及对应plan/review/image摘要，不能用生成器或Astra的AI检查替代。

| 任务      | 内容                               | 解包后脚本                                    | 允许改动                                                                                                                      |
| --------- | ---------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| verify-01 | 官方 endpoint 与同名自定义网关隔离 | `verify-01-setup.mjs` / `verify-01-check.mjs` | `packages/cli/__tests__/verify-01.test.js`<br>`packages/cli/src/lib/model-context-catalog.js`                                 |
| verify-02 | 精确模型能力查找                   | `verify-02-setup.mjs` / `verify-02-check.mjs` | `packages/cli/__tests__/verify-02.test.js`<br>`packages/cli/src/lib/model-capabilities.js`                                    |
| verify-03 | 新家族未知计价                     | `verify-03-setup.mjs` / `verify-03-check.mjs` | `packages/cli/__tests__/verify-03.test.js`<br>`packages/cli/src/lib/llm-pricing.js`                                           |
| verify-04 | 请求级缓存与阶梯费用               | `verify-04-setup.mjs` / `verify-04-check.mjs` | `packages/cli/__tests__/verify-04.test.js`<br>`packages/cli/src/lib/usage-pricing-context.js`                                 |
| verify-05 | 安装与准入分离                     | `verify-05-setup.mjs` / `verify-05-check.mjs` | `packages/cli/__tests__/verify-05.test.js`<br>`packages/cli/src/lib/agent-router.js`                                          |
| verify-06 | 付费分解前预检                     | `verify-06-setup.mjs` / `verify-06-check.mjs` | `packages/cli/__tests__/verify-06.test.js`<br>`packages/cli/src/commands/orchestrate.js`                                      |
| verify-07 | 持久正文分页边界                   | `verify-07-setup.mjs` / `verify-07-check.mjs` | `packages/cli/__tests__/verify-07.test.js`<br>`packages/cli/src/lib/session-transcript-history.js`                            |
| verify-08 | fork 历史归属                      | `verify-08-setup.mjs` / `verify-08-check.mjs` | `packages/cli/__tests__/verify-08.test.js`<br>`packages/cli/src/lib/session-branch-history.js`                                |
| verify-09 | 历史来源篡改拒绝                   | `verify-09-setup.mjs` / `verify-09-check.mjs` | `packages/cli/__tests__/verify-09.test.js`<br>`packages/cli/src/lib/session-history-origins.js`                               |
| verify-10 | 分页索引失效回归                   | `verify-10-setup.mjs` / `verify-10-check.mjs` | `packages/cli/__tests__/verify-10.test.js`<br>`packages/cli/src/lib/background-agent-list-index.js`                           |
| verify-11 | 问题持久记录归属                   | `verify-11-setup.mjs` / `verify-11-check.mjs` | `packages/cli/__tests__/verify-11.test.js`<br>`packages/cli/src/lib/background-interaction-journal.js`                        |
| verify-12 | 含空格参数完整性                   | `verify-12-setup.mjs` / `verify-12-check.mjs` | `packages/cli/__tests__/verify-12.test.js`<br>`packages/cli/src/lib/background-command-argv.js`                               |
| verify-13 | 附件同句柄读取边界                 | `verify-13-setup.mjs` / `verify-13-check.mjs` | `packages/cli/__tests__/verify-13.test.js`<br>`packages/cli/src/lib/image-file-boundary.js`                                   |
| verify-14 | 图片逐项错误                       | `verify-14-setup.mjs` / `verify-14-check.mjs` | `packages/cli/__tests__/verify-14.test.js`<br>`packages/cli/src/lib/image-input.js`                                           |
| verify-15 | 权限修订溢出拒绝                   | `verify-15-setup.mjs` / `verify-15-check.mjs` | `packages/cli/__tests__/verify-15.test.js`<br>`packages/cli/src/lib/scoped-permission-store.js`                               |
| verify-16 | 无效设置来源保守失败               | `verify-16-setup.mjs` / `verify-16-check.mjs` | `packages/cli/__tests__/verify-16.test.js`<br>`packages/cli/src/lib/settings-source-observation.cjs`                          |
| verify-17 | 持久进程所有权记录                 | `verify-17-setup.mjs` / `verify-17-check.mjs` | `packages/cli/__tests__/verify-17.test.js`<br>`packages/cli/src/lib/process-execution-broker/process-ownership-journal.js`    |
| verify-18 | 所有权未知保持阻断                 | `verify-18-setup.mjs` / `verify-18-check.mjs` | `packages/cli/__tests__/verify-18.test.js`<br>`packages/cli/src/lib/process-execution-broker/process-ownership-quarantine.js` |
| verify-19 | 取消审批迟到回调                   | `verify-19-setup.mjs` / `verify-19-check.mjs` | `packages/cli/__tests__/verify-19.test.js`<br>`packages/cli/src/lib/permission-request.js`                                    |
| verify-20 | deny 决策不降级                    | `verify-20-setup.mjs` / `verify-20-check.mjs` | `packages/cli/__tests__/verify-20.test.js`<br>`packages/cli/src/lib/permission-decision.js`                                   |
| verify-21 | Memory 影子读取无写入              | `verify-21-setup.mjs` / `verify-21-check.mjs` | `packages/cli/__tests__/verify-21.test.js`<br>`packages/cli/src/lib/context-memory-kernel/segmented-memory-port.js`           |
| verify-22 | Memory 发布后故障语义              | `verify-22-setup.mjs` / `verify-22-check.mjs` | `packages/cli/__tests__/verify-22.test.js`<br>`packages/cli/src/lib/context-memory-kernel/segmented-memory-port.js`           |
| verify-23 | 缺失样本固定分母                   | `verify-23-setup.mjs` / `verify-23-check.mjs` | `packages/cli/__tests__/verify-23.test.js`<br>`packages/cli/src/lib/eval/outcomes.js`                                         |
| verify-24 | 比较身份严格隔离                   | `verify-24-setup.mjs` / `verify-24-check.mjs` | `packages/cli/__tests__/verify-24.test.js`<br>`packages/cli/src/lib/eval/evidence.js`                                         |
| verify-25 | 草稿写失败保留旧记录               | `verify-25-setup.mjs` / `verify-25-check.mjs` | `packages/vscode-extension/__tests__/verify-25.test.js`<br>`packages/vscode-extension/src/chat/draft-store.js`                |
| verify-26 | 敏感问题字段排除                   | `verify-26-setup.mjs` / `verify-26-check.mjs` | `packages/vscode-extension/__tests__/verify-26.test.js`<br>`packages/vscode-extension/src/chat/question-draft-contract.js`    |
| verify-27 | 重载问题精确绑定                   | `verify-27-setup.mjs` / `verify-27-check.mjs` | `packages/vscode-extension/__tests__/verify-27.test.js`<br>`packages/vscode-extension/src/chat/question-drafts.js`            |
| verify-28 | 迟到加载不覆盖编辑                 | `verify-28-setup.mjs` / `verify-28-check.mjs` | `packages/vscode-extension/__tests__/verify-28.test.js`<br>`packages/vscode-extension/src/chat/question-form-drafts.js`       |
| verify-29 | 模式 ACK 关联                      | `verify-29-setup.mjs` / `verify-29-check.mjs` | `packages/vscode-extension/__tests__/verify-29.test.js`<br>`packages/vscode-extension/src/chat/permission-mode-state.js`      |
| verify-30 | 累计动画帧预算                     | `verify-30-setup.mjs` / `verify-30-check.mjs` | `packages/vscode-extension/__tests__/verify-30.test.js`<br>`packages/vscode-extension/src/chat/image-decode-budget.js`        |
| verify-31 | 快照失败资源清理                   | `verify-31-setup.mjs` / `verify-31-check.mjs` | `packages/vscode-extension/__tests__/verify-31.test.js`<br>`packages/vscode-extension/src/chat/image-file-snapshot.js`        |
| verify-32 | 预览取消失效                       | `verify-32-setup.mjs` / `verify-32-check.mjs` | `packages/vscode-extension/__tests__/verify-32.test.js`<br>`packages/vscode-extension/src/chat/image-preview-gate.js`         |
| verify-33 | 快速多图添加预算                   | `verify-33-setup.mjs` / `verify-33-check.mjs` | `packages/vscode-extension/__tests__/verify-33.test.js`<br>`packages/vscode-extension/src/chat/image-attachments.js`          |
| verify-34 | 冻结计划操作说明                   | `verify-34-setup.mjs` / `verify-34-check.mjs` | `docs/development/verify-34-outcome-runbook.md`<br>`packages/cli/scripts/task-outcome-report.mjs`                             |
| verify-35 | 模型失败分类回归                   | `verify-35-setup.mjs` / `verify-35-check.mjs` | `packages/cli/__tests__/verify-35.test.js`<br>`packages/cli/src/lib/model-failure-policy.js`                                  |
| verify-36 | 启动配置身份保真                   | `verify-36-setup.mjs` / `verify-36-check.mjs` | `packages/cli/__tests__/verify-36.test.js`<br>`packages/cli/src/lib/background-launch-profile.js`                             |

任务、提示词和验收要求的原文在[任务清单](../tasks.json)。此预览没有运行setup/check，没有调用模型，没有产生observations；真实Docker工程验证、独立人工预审与正式任务分别记录。
