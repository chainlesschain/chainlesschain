# Memory 派发与模型输入诊断合并验证

本批对应 **5193dcf960a361a1178a7fbcd08736da1bc23c77 合并 main d23e386a6ddd48087d769d5fd369c065024fec6d 后的未提交工作区快照**。两个父提交都不是合并后实现的准确 SHA；[manifest.json](manifest.json) 的 8 份源码/测试快照绑定本次结果，后续提交须逐文件核对。

## 结果与计数

- Node 22 本地相关回归：21 个文件，**425/425**，0 失败、0 跳过。manifest 列明每个测试文件的用例数。
- 先行组合回归：3 个文件，**42/42**，全部属于上述 425 项，不额外累加。这 42 项为 Memory 派发 23、模型输入诊断 12、诊断日志 7。
- Node 24 / SQLite ABI 137 预算组合：**108/108**，0 失败、0 跳过，其中包含新增的 adapter-body 与 governed-fetch-body 两个诊断阶段 Memory 删除用例。四个 logical-input/fetch-body × delete/supersede 用例已包含在 425 项中。
- 静态出口审阅：89 个候选全部分类为 REVIEWED，未分类 0；仍有 **78 条调用链未映射**。这不是完整运行时覆盖，也不授予付费或 OS 隔离准入。
- Web Panel 原始日志含构建完成与产物 hash 标记。原日志没有独立进程退出码字段；只作为本地构建记录，不是已安装产品验收。

原诊断模块的 observer 是直接 await，**没有对永不 settle 的 observer 提供强制取消保证**。这些用例证明诊断回调正常结束后重新验证 Memory 权限、拒绝陈旧派发，不把 Memory 锁等待取消的结论扩展到全部诊断等待。完整 REPL legacy 注入与历史恢复问题另待处理。

## 原始字节与边界

五份原始报告及八份实现/测试快照保存于 raw/，均逐字节 gzip，记录压缩前后的 SHA-256 和长度。预算文件原名以 .tap 结尾，但实际内容是 **带 BOM 的 UTF-16LE Node spec 报告**（✔ 用例、ℹ 汇总），不是 TAP 协议；Web Panel 日志也是 UTF-16LE。本归档不转码原件，离线核对时才按 BOM 解码。

旧 memory-admission-2026-11-08 的 24 条记录保持不可变；归档前后核对其全部文件摘要一致。本目录是独立的新批次，不覆盖旧的失败、成功或环境故障证据。原始报告仅含合成测试、摘要、构建信息及源码分类，不包含真实模型 Call log、私钥或实际凭据。

本批没有真实模型调用；paidReady、runtimeCoverageVerified、productionAdmission、OS 隔离、跨平台和性能准入均为 false。旧 727c/698b 性能成绩也不授予本次合并快照。普通诊断与合成 SQLite 预算测试不是正式账单或账户证据。

## 离线复核

```powershell
node docs/research/cli/evidence/memory-diagnostics-2026-11-08/verify-evidence.mjs
node docs/research/cli/evidence/memory-diagnostics-2026-11-08/verify-evidence.mjs --check-current-sources
```

第一条只读本目录，核对 13 条原字节记录、425 项逐用例/逐文件来源、42 项子集关系、108 项汇总及新增阶段通过、89 项分类、实现摘要与构建完成标记。第二条额外要求当前检出的 8 份源码/测试字节与快照完全一致。校验器不联网、不执行归档源码、不重跑测试或构建，也不修改文件。摘要是完整性校验，不是外部签名或独立时间戳。
