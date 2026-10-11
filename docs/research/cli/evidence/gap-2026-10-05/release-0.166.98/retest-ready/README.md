# 公开 CLI .98 独立复测准备

发行候选 0b1f0e748299c729f8f28b407e146efb44df78ed，独立准备分支 80b8b140a17f5a8fad74844e13d33674b456ef65，保留旧已推历史并合入发行候选。CLI0.166.98、Memory Kernel0.1.9与DIAGNOSTIC公开发行固定值一致。普通准备push的[Actions 38130764139](https://github.com/chainlesschain/chainlesschain/actions/runs/38130764139)为completed/skipped，唯一job没有步骤，没有调用provider。须CLI公开回读成功后另作显式付费marker提交。

Windows Node22.22.2与独立、干净、无依赖Linux Node22.12.0七源码逐项匹配最终独立Git blob；各43/43、零skip。Windows原沙箱dubious ownership失败及旧配置结果继续保留，不修改safe.directory或覆盖旧clone工作。认证使用llm test --json；缺认证/tool估算保持null，仅两者均已知才求旅程总额，invoice/budget/hardQuota不回填。

静态collector的费用一致性四项与ZIP五项共9/9。解压前检查单文件/累计32MiB及4096条，bounded inflate限制实际输出，解压后再核验；仅处理digest绑定原件，不执行候选、不独立证明checker、定价或账单。原冻结项目、prompt、20turn和$0.25估算stop保持。

[manifest](./manifest.json)保存45份gzip原件与双SHA256。此准备不证明发行、模型交付或正式样本通过。正式36+9/NOT_RUN/observed=0/$99及独立人工、账单、目标宿主/辅助技术、durable/native与8h/24h/SLO仍开放。
