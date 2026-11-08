# canonical Memory 派发前授权证据

日期：2026-11-08。基线 `698b87d79720c75809e830fa826437e021569a1c` 加本轮工作区修改；[manifest](./manifest.json)保存12份实现、测试、CI及源码分类快照，不把基线SHA当作修复后的准确提交。后续提交应逐文件与这些快照核对。

真实磁盘和实际adapter/fetch边界的初轮16项中，2项对照通过、14项失败，均记录旧合成正文实际进入一次请求。后续分别复现closed范围的两个微任务竞态、派发后清理失败缺少noReplay、disabled scope兼容退化，以及预算取消在Memory锁等待期间不settle；各轮原始失败按身份保留，不累计为同一轮成绩。

最终Node22.20回归为19文件、**402/402**，无跳过；其中33项新增用例已包含在402中。Node24.12/ABI137的真实SQLite预算/传输及Memory交互为 **106/106**，无跳过；其中3项Memory预算交互已包含在106中。Node22未用于这次本机SQLite组合，因为共享普通SQLite二进制匹配Node24；没有重建或替换共享依赖。

首次预算组合因稀疏树解析到旧Ajv而缺少`ajv/dist/2020.js`，原环境失败日志保留；接入CLI既有Ajv8后复验。Web Panel首次构建也缺少稀疏树SDK源码，补齐后按锁定安装和生产配置重建成功；此为本机源码构建，非已安装产品验收。最终静态出口审计89个候选全部分类，仍明确 `paidReady:false`、`runtimeCoverageVerified:false`。

归档仅含合成正文、测试结果及公开源码。没有调用真实模型，没有改变历史账单或正式冻结状态，也不授予跨平台、任意自定义网络/SDK/OS隔离、语义质量、REPL旧注入治理或生产准入。

```powershell
node docs/research/cli/evidence/memory-admission-2026-11-08/verify-evidence.mjs
node docs/research/cli/evidence/memory-admission-2026-11-08/verify-evidence.mjs --check-current-sources
```

第一条只读归档，核对24条原字节、失败与成功边界及源码快照；第二条另要求当前检出源码与12份快照字节相同。两者不重跑测试、不联网。
