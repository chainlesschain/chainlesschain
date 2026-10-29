# 第四十六批：修复 .131 干净构建与产物来源审计

日期：2026-10-29。修复直接提交主分支，新准确提交需要重新完成发布门禁。本批未发布，真实任务累计仍为 **34/45**。

| 项目           | 当前结果                                                                                             | 剩余工作                                            |
| -------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 旧候选 98c4    | CLI CI 40832331503 最终失败：三系统 verify-cli 均失败，后续 PM 聚合也失败；其他测试分片通过          | 原日志、原固定标签保留，不能用于发布                |
| 旧候选其他检查 | Strict 6/6、Kernel 3/3、IDE 18 成功及 1 个预期跳过，整体成功                                         | 结果只属于旧 SHA，新候选全部重新验证                |
| 根因复现       | 干净 checkout 没有被 Git 忽略的四个 JS 产物；原审计报告 REMOVED_OR_NO_LONGER_CANDIDATE               | 本机缓存不能充当干净 CI 证据                        |
| 生产构建修复   | 依赖安装保留开发依赖；Vite 运行显式 production，移除随机临时目录 \_\_file；缓存哈希包含 builder 本身 | 三系统实际构建与原完整审计继续验证                  |
| 独立构建复现   | Windows Node 22.22.2，不同源码根及不同随机临时目录，两次实际构建 **256 文件全部一致**                | 不能代表 Linux/macOS 已通过                         |
| 来源分类       | Astra 独立审查四个新生产产物；完整扫描 **82 候选、0 未分类、0 审查问题、0 解析错误**                 | paidReady 与 runtimeCoverageVerified 仍为 false     |
| CI 调整        | 扇出前先干净构建及审计；三系统 verify-cli 仍逐一构建并执行原审计；原矩阵、阈值及所有既有检查保留     | 新 SHA 的完整 CLI CI / Strict / Kernel / IDE 待执行 |
| 本地验证       | 74 项 Node、25 项发行 contract、4 项 builder 测试通过；8 组静态/构建 contract 检查通过               | 本地结果不替代 Actions                              |
| 发布顺序       | 新提交完整门禁通过后先发布子包与 CLI，核对公开包，再发 IDE 并继续 verify-10 → verify-04              | Microsoft 暂缓，原 .129 verify-11 未知请求不重放    |

四个新产物为 Artifacts-BuJgG5jf.js、index-3RqDry-K.js、MtcAudit-D3aa8XP4.js、RemoteSession-BGGzPdS5.js。候选计数分别为 1 / 4 / 1 / 24；RemoteSession 压缩别名多匹配了七处 UI 回调，实际仍只有 relay/direct 两处 WebSocket 构造。类别不扩大到正式付费或原生准入。

证据：[review.json](./cli/evidence/web-panel-production131-2026-10-29/review.json)，含原始与 gzip 字节摘要、双构建清单、完整审计、本地检查以及旧候选最终门禁观察。预提交审计中的 sourceCommit 是当时 HEAD，实际修复字节由 bindings 绑定；新候选 SHA 单独冻结后记录，不能倒填为旧源码通过。
