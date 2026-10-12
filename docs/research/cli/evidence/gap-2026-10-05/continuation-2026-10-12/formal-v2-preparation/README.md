# 正式 36+9 v2 准备与执行窗口保护

原计划在 2026-10-12 00:00 UTC 结束且没有正式 observations。用户要求继续处理正式 36+9，按原计划建立独立的 [v2](../../../../verify01-plan-2026-10-12-v2/README.md)。窗口为 2026-10-12 14:46:52.556 UTC 至 2026-10-19 14:46:52.556 UTC；新指纹 `sha256:9c3db6e9b49da0c152b9e5cfba56ade64da50e727591b75d2dc9203ba6ae53cd`，原目录完全不变。validator 自动验证除 window 外的 plan 完全相同、catalog/bindings 字节相同及 revision 的新旧指纹绑定。仍为共享 $99、36 任务与 9 独立首次旅程，未增加额度。

CLI setup 在 checkout/setup 前检查完整任务预算能否落在窗口内；不可变 Agent binding 在实际 launch 前再次检查，过期的保存 binding 不能发送。IDE preparation 在创建目录/setup 前检查，并用同一时间戳确定 deadline。检查拒绝未来窗口、过期窗口、剩余时间不足和无效时间格式。实际 IDE driver 仍需在提交提示词前检查 deadline/window；准备成功不授权晚于截止时刻发送。

原准确源码 **4e6ae449a57ecfa16e32f53a43b2d7dd61326742** 的两模块隔离副本复现 **8 失败 / 0 通过 / 24 条未选中**，仅替换导入文件名；原 Git blob、别名副本、测试与复现脚本均保留。最初 8 项失败、较窄的 65/65 和最终 Windows Node22.22.2 / WSL Ubuntu Node22.12.0 各 **177/177** 六文件报告均保留。后者不是正式目标宿主验收，也不代表实际 Docker/model 任务。

完整 72 份 setup/check 的可移植包见 [review-preview](../../../../verify01-plan-2026-10-12-v2/review-preview/README.md)。其历史 image pin 未在本轮重验，reviewDigest 为 `sha256:14033f24125c7319f978d5044b2cec16cb5245cfa7019c7879c9d02c2b78dc79`。Astra 实现窗口辅助函数并只读复核，建议的旧发行摘要哈希/OIDC/不可变字节检查、原 lock 归档及 v2 一致性校验均已补齐；AI 审阅不作为独立人工签核。

[summary.json](./summary.json) 保存当前执行源摘要、两计划校验及只读 collection。collection 退出 2，`reviewValidated:true` 仅代表机械校验，`INSUFFICIENT_EVIDENCE / NOT_RUN / observed=0` 保持；总费用及维护时间未知。新采集的 stdout/stderr 由 Node 保存原始 process Buffer，较早 PowerShell re-encoded JSON 明确标作 derivative。[manifest.json](./manifest.json) 保存 44 份源码、前后报告及驱动的压缩/原文双 SHA256；所有对象解压核对一致。

此快照仅完成本地准备和新 workflow 静态校验，真实 keyless Actions 尚未运行。该工作流不带 provider 密钥，不认证、不执行 Agent、不写 observations；真实预检通过后，`paidExecutionReady` 仍须保持 false，直到人工及账号硬额度条件落实。公开 CLI0.166.99 不含本次 guard，新源码需自身准确 CI。Windows11/macOS15 arm64 宿主、完整 native/durable、真人辅助技术、8h/24h 和正式 SLO 仍缺，没有新增付费请求或发行。
