# Windows 只读 review 设置域与取消审批控制

代码提交 `147fa9653a`；本机 Windows 10 x64 / Node 22.22.2 独立诊断。保持 `NOT_ADMITTED / admissionEligible:false / formalSample:false`。此 profile 只证明选中的 fixture 设置域，不证明真实宿主个人/组织设置被读取，也不建立 Windows/macOS durable authority。

`--fixture-settings` 将用户/managed 候选显式放入既有只读、无 reparse、保留句柄的 workspace 树。宿主前后与子 actor 的来源缺失/父目录 dev/ino、实际 home/managed 路径和写拒绝都须吻合。原真实用户路径 EPERM 保留，未翻译成 ENOENT。配置源位于不可写树，缓存/普通临时数据仍使用 scratch。新的 verify-19 控制复用既有 Linux donor，直接检查阻塞工具收到的 permission promise 值。

| 原件目录                                                       | 实际断言                         | 结果与界限                                                                                                                |
| -------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [baseline](./baseline/manifest.json)                           | 17/17                            | 新域的原冻结审批文件通过；早期 producer 字节单独保留                                                                      |
| [mutant-survived](./mutant-survived/manifest.json)             | 17/17                            | `pending.resolve(true)` 实际存活；拒绝记为检出，原进程正常结束及清理有记录                                                |
| [controls-baseline](./controls-baseline/manifest.json)         | 18/18                            | 最终 producer 的成功基线；原 17 项加直接工具结果控制                                                                      |
| [controls-mutant](./controls-mutant/manifest.json)             | 17 pass / 1 fail                 | 唯一目标 AssertionError 为 `expected true to be false`；匹配基线、来源、reporter、原 HANDLE/Job/profile 结算核验通过      |
| [full-baseline-timeout](./full-baseline-timeout/manifest.json) | 未观察到 reporter，人口未知      | 系统睡眠期间外层 `SIGTERM / ETIMEDOUT`；host stdout 空，原 HANDLE/Job/profile 结算未取得                                  |
| [full-baseline](./full-baseline/manifest.json)                 | 211 = 208 pass / 2 fail / 1 skip | 全 12 文件加载、零 collection errors；owner-only ACL 与 junction 仍失败，skip 仍被 frozen parser 拒绝，完整 review 不准入 |

最终完整失败中的源码/映射/actor 原 HANDLE 和 Job 0/profile 删除都有记录；四条 settlement errors 均源于 baseline 要求成功 root exit 0。不能因这四条结果约束把缺失的测试成功补造出来。原 14 项设置来源失败只是在新诊断域内通过，不修改旧真实用户域的 194/16/1。

首轮完整尝试的系统事件记录睡眠 `2026-10-10T09:51:16.907Z → 11:50:41.591Z`，保存 [Event.ToXml API 原字节及清理来源](./suspend-original/manifest.json)，不称原始 EVTX。总计时包含停机，不是两小时持续运行/soak。随后胶囊 ACL、注册名、派生 SID 三重吻合，独立删除准确 profile 注册；[HRESULT 0/注册项消失回执](./suspend-original/cleanup.json)不代替原 Job 恢复。retry 的 [临时 idle-sleep 请求](./awake-retry.json)在同一 thread 获得并释放，没有改电源计划、原 240 秒期限或生产 runtime。

每个原生目录都有 manifest，文件以 gzip 保存，原字节与压缩字节的长度/SHA-256 均保留。六个目录 **237** 文件以及 **31** 份独立 local/CI/System API 原字节已验证，见 [archive-validation.json](./archive-validation.json)。编译产物和共同 source/runtime/dependency 闭包仍在本机；compiler closure 非 hermetic，不能仅凭这些压缩报告独立重建完整执行环境。初始 baseline/survivor 是早期 source 字节，后续控制基线/反例是匹配的最终 producer；不转移旧报告。

两环境最终回归分别 **349/349，零失败/跳过**：[Windows 22.22.2](./local-windows-final.json)、[WSL Ubuntu 22.12.0](./local-linux-final.json)。同时保存初次三条测试辅助字段错误及修正后的 348 项输出、沙箱 WSL E_ACCESSDENIED 和获准宿主执行后的结果。重复执行不增加正式样本。Prettier、定向 ESLint、spawn inventory 和 diff 检查通过。

先前准确 SHA `533e75868dc5c7613524d192a65fcb376e8d44e4` 的 [最终 CI API 回读](./ci-prior-complete/manifest.json)证明 CLI CI **71/71**、Strict **5/5**、Scheduler **4/4**、IDE Safety **4/4**；[较早快照](./ci-prior/manifest.json)也保留。这些结果不授予新提交成功，最终新 SHA 自身完整矩阵仍待完成。本轮不发布。

各轮来源、人口、失败、结算和时点见 [matrix.json](./matrix.json)。正式 [冻结采集回读](./frozen-summary.json)仍实际 exit 2 / **36 tasks + 9 firstRuns / NOT_RUN / INSUFFICIENT_EVIDENCE**；$99、observations、旧 Windows **211 = 194/16/1、6 检出/4 存活/4 未运行**保持原状。Windows/macOS durable 服务/journal/自身恢复/WFP、冻结平台冲突、官方账号/账单、独立人工/辅助技术及 8h/24h/SLO 仍未完成。
