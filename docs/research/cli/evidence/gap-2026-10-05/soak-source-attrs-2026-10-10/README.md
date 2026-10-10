# CI 归档换行属性失败与修复

准确 SHA `4928e50ef109712a36e3a39e08405b943ffd136b` 的 Agent Team Soak 三平台全部在源码校验阶段失败，尚未执行 round，也没有上传结果报告。两份归档 PowerShell 原件继承根目录 `*.ps1 text eol=crlf` 的 eol，但目录属性已将 text 设为 unset；严格校验器正确拒绝此组合。见[原始 run/jobs/日志清单](./manifest.json)。日志是 `gh api --include` 输出的完整 HTTP 头与 ZIP 原字节，逐 job 根日志 entry 摘要也保留。

同 SHA 的 CLI CI 仍未完成。三个失败的 integration shard 1/8 各包含 168 个 testcase，各有 1 项失败，均为 `proves every tracked source byte at the exact SHA` 的相同属性拒绝。三份原始 JUnit ZIP 与 XML entry 摘要见[制品清单](./cli-failures.json)，[JUnit 回读](./cli-junit-readback.json)保留全部失败内容。[API 快照](./cli-snapshot.json)只说明查询时点，不声称完整矩阵通过。

修复仅给原证据目录增加 `!eol`，使脚本最终属性为 `text: unset / eol: unspecified`；原件字节、源码校验器、生产 runtime 及 soak 期限/重试/lease 均未改变。Windows Node 22.22.2 与 WSL Ubuntu Node 22.12.0 分别建立独立 Git fixture，复现旧拒绝、提交修复后通过生产源码校验；每个环境另做 `core.autocrlf=false/true` 两次真实克隆，核对准确 SHA、脚本工作树与 blob 原字节。见[Windows](./windows-source-validation.json)、[Linux](./linux-source-validation.json)和[验证清单](./local-validation.json)。选定既有源码合同 3 项通过，6 项未选择；首次误用根目录 Vitest 配置的调用已中断并排除。

十份压缩 API/日志/制品的原字节及存储字节摘要、两个本地报告来源摘要均复核。受限环境的日志请求曾 403，获准普通用户环境后归档成功，未修改 GitHub 权限或凭证配置。修复提交须自身完整矩阵，旧成功不转移。正式 36+9、$99、observations、旧 Windows 211 = 194/16/1、6/4/4 及整体 `NOT_ADMITTED` 保持原状；其余 native/durable、账号账单、真人辅助技术、长时/SLO 仍开放，无付费请求或发布。
