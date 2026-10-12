# 当前安全映射的测试源码摘要同步

准确 08e883 提交的 Strict run38201137335 在 Linux/macOS 的 mapped Claude security delta step 被 producer digest 校验拒绝。新增暂停拒绝的 headless-runner 回归后，映射仍指向该测试文件旧摘要。

已审阅新增回归并仅同步 cc-2.1.223-agent-org-policy-ceiling 一行的 producer SHA-256；门、阈值、OS、disposition 和旧发行证据均不变。原失败日志完整保留，新准确提交必须自己取得 Actions 结果。

Windows 原映射执行入口本地 **29 个选择合同全部通过**；同一批 942 个非映射测试按名称过滤未执行，不计为通过。报告、前后摘要、当前映射及两个平台失败日志的双摘要见 [manifest.json](./manifest.json)，范围见 [summary.json](./summary.json)。没有发布、provider 调用或正式样本。
