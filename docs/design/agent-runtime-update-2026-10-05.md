# CLI 与 IDE 运行时增量设计（2026-10-05）

本次设计核对以 `main@85f2f14aa1c36169e9f362eaaf733fde561a906c` 的代码和 Git 记录为基线。CLI `0.166.87`、VS Code `0.37.132`、JetBrains `0.4.150` 是源码候选；公开版本及安装步骤以[发布与升级指南](https://docs.chainlesschain.com/chainlesschain/agent-platform-release.html)为准。工作区中继续开发的 VERIFY-01 采集与审阅包不计入该提交的发布资格。

## 记忆查询索引与分页

`88efef197d` 为 canonical Memory v2 增加 category、scope、state、tag、sink 及排序字段的派生索引，不复制正文、证据或审计。manifest 同时绑定权威分片和索引的摘要、字节长度，写入随同一 manifest 发布。索引缺失或损坏时，从已验证权威分片重建，不信任文件 mtime；过滤在 limit 之前执行，recall 保持原 relevance 排序。

`967a057625` 将分页接入 `cc memory show --page --json` 与 `--cursor`。返回 `entries` 和 `nextCursor`；游标绑定存储路径、generation、过滤条件及稳定排序（importance 降序、updatedAt 降序、memoryId 升序）。续页保持相同 category 和 limit；存储代际变化或游标篡改时返回 `CONTEXT_MEMORY_CURSOR_INVALID`，调用方从第一页重新读取。默认 `show --json` 仍输出条目数组；legacy/shadow 模式拒绝分页。

升级旧 v2 存储保留权威正文、revision 与审计，但新 descriptor 会被不认识索引字段的旧 reader 拒绝。升级前备份，停止旧 writer；降级需要兼容快照。默认 shadow 不触发迁移。索引不是全文搜索，也不构成新的权限来源。

Windows x64 / Node 22.22.2 的本地 100K、category-7、limit 20 测量中，全扫 p95 为 14,160.960 ms，冷索引 2,416.313 ms，热索引 1,746.812 ms，重建 28,615.208 ms。每路径 11 次，冷查询使用新进程但未清空 OS 缓存；热查询仍需验证索引字节，重建可能持锁。该结果不是跨平台性能 SLO。原始测量见[查询索引回执](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/gap-2026-10-05/memory-query-index.json)。

## VERIFY-01 执行与结果采集

`482c1b2727` 接入 `cc eval --suite verify01`，执行前要求外部固定的 plan/review 摘要、项目准确提交及项目外的可信 reviewer 根。独立 setup/check 在有界任务工作区运行；执行材料保存原始进程输出和完整 diff，报告保留失败及 missing。36 个项目任务与 9 个首次安装样本的固定分母不能通过选择部分样本缩小。

结果采集适配器复用 Eval history 与 outcome report；采集是已有结果的读取，不是模型或 GUI 验收。静态合同、代码审查、无模型 dry-run 与本地测试不能替代独立人工签核、真实账号/账单、完整 GUI driver 或 8h/24h 长期观察。当前工作区新增审阅包生成、宿主协议 observer 与导入器，仍未提交；其本地验证不是基线提交的完整 CI。

## Linux 进程所有权恢复

恢复实现记录 cgroup 的 boot/inode/所有权身份；隔离记录、新启动准入和恢复动作都重新核对身份。监督器丢失后清理确认的遗留进程组，清理成功才允许新执行，不重放原命令。记录过期、身份漂移或持久化失败时继续拒绝准入，并保留可重试记录。它不扩大到未知进程或 Windows/macOS 的等价耐久恢复。

[Process Ownership Recovery #37258234311](https://github.com/chainlesschain/chainlesschain/actions/runs/37258234311) 绑定 `320301e6e7`，Linux x64/arm64 各 2 项真实 cgroup2 测试通过，覆盖监督器死亡后仍存活的孙进程、清理后重新准入、无重放及失败后重试。专项结果只属于该提交和测试范围。

## IDE 会话能力与慢初始化

`0a07882df7` 的两端 Doctor 先报告 CLI/插件版本与推荐配对，再依据实际会话记录判断能力。配置声明不能替代运行时观察；缺少会话证据时标记 degraded/unconfirmed，实际观察满足协议要求后才 confirmed。后续 `b883e14652` 与 `85f2f14aa1` 固定了对应回归与烟测断言。

初始化超过 30 秒时继续等待，最多 120 秒；期限内完成握手才按当前会话提交。超时保留文本和附件草稿并取消本次提交，迟到 init 不补发；过期会话不能消费新草稿。文件附件使用有界快照、验证后的文件身份及解码预算。IDE 读取 CLI 投影并提交审阅决定，不持有 CLI writer、Skill 路由、执行或发布权限。

## 模型合同与互操作探针

`355b23de08` 更新十月模型能力、上下文窗口及价格合同，漂移审查保留所读资料摘要；静态目录匹配不证明账号可访问、真实调用成功或账单已核对。校准矩阵区分模型服务身份与网关，尚无付费样本时不生成真实成本结论。

`eaa3014a58` 将外部 Codex app-server 的 Schema 与真进程探针固定到 `0.160.0`；受控 loopback provider 验证审批取消与断线无 fallback，不等于正式账号验收。`eb68107727` / `b85ec50aed` 使用未修改的官方 MCP server factory 与 SDK HTTP transport，工具已完成后由代理隐藏响应并注入 404，客户端恢复连接但保留 outcome unknown、自动重放次数为 0，下一次显式调用成功。外部 Agent 逐请求治理、真实服务费用和完整云端连续工作仍待验收。

## 发行与验收边界

最新候选必须完成准确提交的 CLI CI 全矩阵、CLI Strict Sandbox 全矩阵和 IDE 门，再按子 npm 包 → CLI OIDC → IDE 的顺序发布。旧发行或专项成功不转移为候选发布资格。本次工作只部署静态文档与官网。

历史 unsigned native 六目标验证及后续 journal 诊断已在[实施证据](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli-ide-gap-implementation-2026-10-05.md)分开记录；它们不等于准确候选提交的签名 native 发行。真实 PM 效果、完整成本、真人辅助技术验收和自动 active Skill 晋升仍保持 HOLD。

## 相关文档

- [上一阶段运行时设计](agent-runtime-update-2026-09-26.md)
- [运行时实现与取舍](cli-runtime-current.md)
- [记忆命令](https://docs.chainlesschain.com/chainlesschain/cli-memory.html)
- [评估命令](https://docs.chainlesschain.com/chainlesschain/cli-eval.html)
- [IDE 使用指南](https://docs.chainlesschain.com/chainlesschain/ide-plugin.html)
