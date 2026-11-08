# Memory 两个既定提交的完整本地基准证据

本目录归档两套已完成的 **Windows / Node v22.20.0 本地合成测量**。结果只属于以下确切提交，**不授予当前 admission 修复分支或后续新 SHA 的 SLO、发布、生产或付费许可**。

- 基线：727c64962fb2ea9e20447d7b59b459a13e0625d6。query 与 recovery 各 600 样本；Stop 600 次取消；mixed 300 轮、每轮 8 进程，共 1800 次生命周期提交。原队列 5 阶段均 exit 0，原生合同测试 55/55。
- 组合首次冷查询：698b87d79720c75809e830fa826437e021569a1c。三档 × 三场景 × 100 样本 = 900；每档另有 12 个过滤/分页合同检查、4 个非法 cursor 检查和全量审计完成记录。cleanup、source/Git 稳定与 clean 身份均在原报告中确认。
- 所有 providerCalls 为 0。两次测量使用共享开发工作站；只保证本工作流中组合基准排在旧队列结束之后，未控制其它系统负载。组合报告 loadContext 原值为 unspecified，不重写为“空闲机器”。

## 原始数据与版本边界

[manifest.json](manifest.json) 将原报告、日志、runner、历史审计脚本/回执与源码映射到 raw/ 下按 SHA-256 去重的 gzip。压缩前字节原样保留（含换行/BOM），同时记录压缩前后摘要及长度。本目录没有原始应用会话、模型 Call log、凭据或私钥。

保留基线报告直接引用的 17 个源码文件、组合报告记录的 55 个本地源码文件和 18 个 Kernel 文件，以及基线 package-lock.json。相同字节可共用 gzip。两次测量的 memory-query-control.js 摘要不同，不能合并为一个实现成绩。组合解析到本地 Kernel 0.1.11；Node 可执行文件摘要在两套身份报告中一致，但可执行文件本身未归档。

1945 个源码条目加 package-lock.json 的 **1946 文件 Git 核对**属于已保存的历史独立审计：只报告两个 PowerShell 文件 CRLF/LF 差异。原 source-identity.json、audit-memory-727c.mjs 和完成版 independent-audit.json 均保留。未完成的 independent-audit-pending.json 仅作为历史过程记录，不能作为完整验收。离线校验器不会执行历史脚本、读取当前仓库或声称重新核对全部 1946 文件。

## p95（毫秒）

基线 query 冷查询指新 Node 进程的首次查询，未清空 OS 文件缓存。热查询为同一进程的后续查询。fixture 构建不计入 durationMs。rebuild 删除派生索引，corrupt 损坏派生索引；authority 保持不变。

| 记录数 |    cold |    hot |  rebuild |  corrupt |
| -----: | ------: | -----: | -------: | -------: |
|   1000 |  42.483 |  20.01 |   635.64 |  667.401 |
|  10000 |  79.315 | 22.704 |  967.348 |  992.802 |
| 100000 | 400.169 | 43.743 | 4210.296 | 4334.758 |

mixed 使用 IPC ready 屏障并行释放 4 reader、2 writer、2 deleter；每轮全部 8 项操作重叠。计时包含屏障后的 IPC 和进程收尾，不包含 fixture 和最后全量审计。下列是本地观测，不是持续生产吞吐承诺。

| 记录数 | reader p95 ms | lock wait p95 ms | 操作/秒 |
| -----: | ------------: | ---------------: | ------: |
|   1000 |       935.966 |              728 |   9.707 |
|  10000 |      1011.428 |              749 |   9.045 |
| 100000 |      1880.978 |             1338 |   4.654 |

组合场景均经过真实 CLI service.listPage 和磁盘 authority/bundle；每个样本在新进程执行首次 list，continuation 的 cursor 预先生成。导入、启动、fixture 与 oracle 不计入查询 durationMs。表格仅四舍五入展示，原始浮点样本和未舍入统计保留。

| 记录数 | category-narrow | tag-narrow | cold-continuation |
| -----: | --------------: | ---------: | ----------------: |
|   1000 |          45.278 |     42.946 |             45.13 |
|  10000 |          87.996 |     82.334 |            89.895 |
| 100000 |         484.842 |    516.613 |           499.743 |

Stop 的全部 600 个样本均 aborted、锁已释放、authority 未变、无迟到成功；每样本 delivery delay 与 acknowledgement 均不超过原门限 500 ms。完整六组 p95 与样本在 manifest 和原报告内。这不是原生 IDE Stop 旅程。

## 离线核对

运行 `node verify-evidence.mjs`（Node >=22.12；只用 Node 内置模块）。校验器不联网、不运行基准、不导入归档源码，也不写文件。

校验所有 gzip 的压缩/解压摘要与字节数、全部 17+55+18 源码绑定、Kernel/Node 身份字段、所有样本数量与状态、每组 min/p50/p95/p99/max、mixed revision 连续性/reader 与已记录变更的一致性/8 方重叠/lock wait/吞吐、组合 entries 摘要与 query/cursor/revision 绑定、完整矩阵和清理标记。它重新计算归档样本的统计及内部一致性；**不重建原始 authority、独立重跑全量 oracle，或再次证明原报告的 full-audit 声明**。所有摘要提供完整性核对，不是独立签名或外部时间戳。

fullDependencyClosureVerified=false；组合覆盖为 literal-relative-imports-with-explicit-source-extensions，第三方依赖未冻结，动态和省略扩展名导入不在闭包证明内。真实语义召回质量、跨平台矩阵、当前 admission 修复性能、paidReady 与 productionAdmission 均未通过本归档验收。
