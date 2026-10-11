# 迁移夹具与发行源码身份修复

[Kernel PR run38130344361](https://github.com/chainlesschain/chainlesschain/actions/runs/38130344361)的Windows迁移/恢复步骤25项=11pass/14fail；Kernel112/112和writer probe此前通过。API head为0b1f0e748299c729f8f28b407e146efb44df78ed，实际checkout与writer参数是PR merge **7f5bfca5c86647a03b8f6fc6b662baaac128e6e7**。这些结果绑定该合并源码，不能冒称准确发行HEAD执行。工作流改为PR head SHA检出，显式HEAD比较，writer/soak/benchmark/制品身份均绑定同一值。

修复源码41f65013f9572c4e54830a9808724920d45675c6只修改16个Node测试夹具、capacity默认TEMP与生成verify21/scratch的可信TEMP入口及工作流身份。生产segmented/durable guard没有变化，Kernel源码树及候选0.1.9保持。真实Windows同短junction环境原测试源码重放9pass/16fail，修后25/25，两个计数不能混同CI11/14。既有文件symlink隐私断言因EPERM没有执行，虽TAP skip=0仍明确保留此限制；真实目录junction已覆盖。长夹具22/3 ACL lookup失败和旧repo内HOME不适合的失败均保留，短长对照不能独立确证底层长度机制。

capacity默认分配器修前真实alias拒绝，修后10条Memory/10条Background、一sample/concurrency1完成、夹具清理；运行时源码未提交，measurement.cleanWorktree=false，不是完整容量或SLO门。相关三套真实单位21/21（含所有既有行为反例），随后只有review scratch的Prettier换行整理，格式、lint/diff检查通过。单位原件绑定格式前源码，格式后准确SHA由Actions另验。

[manifest](./manifest.json)共89份双摘要gzip，原失败、全部定向TAP/JSON reporter、辅助探针与四份准确修复Git blob保留。另有[独立复测准备](../retest-ready/README.md)：80b8b140分支绑定旧发行准备0b1f，Windows/Linux43/43与静态collector9/9；最终发行SHA改变后必须重新同步固定值，不能沿用其作为新发行实跑身份。此前[离线23合同](../final-release/offline-contracts-2026-10-11T10-07-40.889Z/manifest.json)只绑定旧0b1f与旧helper；后续新六门helper须自己验证。

同0b1f全部未启动的push Host诊断38130339027已去重，保留PR38130344375，原始核对与取消API归档；运行过的Kernel push没有取消。尚未发CLI或IDE标签，未新增付费调用、未合并。新准确候选必须自身完整六门通过，随后按OIDC子包→CLI→IDE公开回读和独立显式火山复测。正式36+9/NOT_RUN/observed=0/$99、旧计划和窗口保持，其余独立人工/账单/目标宿主/辅助技术、durable/native及8h/24h/SLO仍开放。
