# 准确候选 CI 临时目录失败与修复（2026-10-11）

原候选 a21913df8be0f7f4d06f9dd95d1a63f7bd978312 的 [Memory Query Index run38126875809](https://github.com/chainlesschain/chainlesschain/actions/runs/38126875809) 和 [Context Memory Kernel run38126869720](https://github.com/chainlesschain/chainlesschain/actions/runs/38126869720) 在 Windows 失败。前者单位32pass/1skip，后者Kernel112/112；真正失败分别发生在benchmark importSnapshot和writer probe canonical mutation。Windows TEMP含RUNNER~1短名，新native canonical guard报 authority directory resolves elsewhere。完整job/API原件保留，不记作通过或省略相关失败。

benchmark和writer probe创建夹具前使用 realpathSync.native(tmpdir())；benchmark清理边界使用同一物理temporaryRoot。生产 segmented/durable guard没有变化。真实Windows junction TEMP夹具：benchmark修复前复现原拒绝，修复后1000records/1sample，baseline/cold/hot/rebuild各20条、digest一致、夹具清理完成；不是完整11sample三tier性能验收。

writer在干净993805b651165cdbadafaf7eff58c3aa7d7fb832实跑exit0，canonical committed/store created，既有fences与projection校验通过。初始driver把整个临时根都为空作为断言，因Desktop logger导入创建独立chainlesschain-test/logs而失败；product原receipt为passed。后续仅静态回读确认writer前缀夹具已删除，原process的fixtureCleaned=false原件不覆盖，独立logger目录仍留存，没有重跑product或调用provider。

本机Windows owner Node22.22.2：Memory两套32pass/1skip，Kernel112/112，五文件版本/格式检查通过。Kernel完整源码tree随诊断修正改变，升0.1.9并对齐CLI依赖/lock；Session0.3.19、CLI0.166.98、VS0.37.142、JB0.4.160保持。其余11子包仅在完整tree与公开字节一致时复用。Kernel要求本次发行签名provenance和公开packedfile Gitblob/lib完整性，Session绑定准确OIDC候选，不虚构Kernel候选。

独立付费复测仪器同步使用llm test --json，认证身份/usage/估算有效且工具估算已知才加总；HTTP失败/未完成或无usage保持unknown，失败认证的有效usage不丢弃，invoice/budget/hardQuota均未确立。Windows owner与独立WSL Node22.12.0无依赖clone五套各43/43、零skip，七源码摘要一致；旧WSL Windows worktree gitdir不可识别导致41pass/2fail保留。这两份仪器源码快照与发行产品源码分开标识，不改变冻结prompt、20turn或$0.25估算stop，不产生正式样本。另一次clone checkout尚未完成便启动检查的ENOENT仅有工具观察，未保存完整stdout，不冒称原件。Astra的35模块bare-import阻断/HTTP stub检查同样仅有会话工具观察，无独立完整文件。

公开回读helper合同本轮工具观察20/20，包含完整preflight71/5/19/10、VS标签14项、JB19项、npm7项、SHA/run/attempt、OIDC/child/CLI顺序、tag污染和包篡改/缺lib反例。完整TAP未单独保存，此处只声明工具观察；helper源码归档可供复核。尚未发布，新准确发行提交须自身完整Actions门及两个相关失败工作流通过，不能沿用a219的ARM64成功。

[manifest](./manifest.json)共52份gzip双摘要，发行修正源码集合 sha256:4aaf0e27440a916a2fb1407097491a9043ae1832e9bd28706f991f5ff202ec79。原preparation和既有首次实跑失败不覆盖。用户已授权成功后发布；CLI公开回读成功后才启动显式火山复测，再以实际候选/semantic/usage结果总结优化效果。正式36+9/NOT_RUN/observed=0/$99保持，人工/账单/GUI/辅助技术/durable/native/长时项仍开放，未合并。
