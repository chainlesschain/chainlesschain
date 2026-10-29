# verify-10 辅助修复与原检查器复验

日期：2026-10-30（Asia/Shanghai）。**本页 verify-10 辅助修复 1 项完成；连同 verify-07 / 09，辅助交付共 3 项成功，原自动验收仍为 34/45。** 两次独立 GitHub Actions 均未调用模型。原生运行 `40897500088` 的候选失败事实和原 ledger 保持不变；此次人工辅助修复不补算为原自动任务成功，也不修改正式付费、native 准入或自动晋升状态。

可直接审阅或下载：[修正后的完整测试文件](./cli/evidence/native131-assisted-verify10-2026-10-30/corrected-verify-10.test.js)及[相对原候选的补丁](./cli/evidence/native131-assisted-verify10-2026-10-30/repair.patch)。该文件现已安装到 `packages/cli/__tests__/verify-10.test.js`，仅做 Prettier 格式化，保持 **6 个用例**和原关键断言；归档文件仍保留独立 CI 实际验证的原字节。

verify-07 / 09 / 10 分别通过 [40916508225](https://github.com/chainlesschain/chainlesschain/actions/runs/40916508225)、[40916174023](https://github.com/chainlesschain/chainlesschain/actions/runs/40916174023)、[40907857461](https://github.com/chainlesschain/chainlesschain/actions/runs/40907857461) 的原检查器。三份安装后的测试在当前源码上另行验证：**6 文件 70/70**（transcript 40、origins 12、index 2、新增 16），来源为已修改、尚未提交的工作区。见[安装与当前源码回执](./cli/evidence/native131-assisted-integration-2026-10-30/review.json)；这不证明冻结 b2aa 与当前 main 的完整依赖闭包相同。

CLI CI 三系统 `verify-cli` 已增加三个新增文件的定向步骤，新 HEAD 云端验证仍未完成；旧 source44 的 CLI CI / Strict 因两个 macOS 作业未获得 runner 而取消，不能作为完整门禁。下一版 .132 的输出截断 / termination 修复仍在私有实现，尚未合入或发布，不宣称原 broker 故障已解决。后续先完成新 CLI / IDE 发行，再用新版本真实重测，Microsoft Marketplace 继续暂缓。

| 阶段                                                                                              | 实际结果                                                            | 原因或修复                                                                                                                            |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 原生候选 `40897500088`                                                                            | baseline 2/2；候选 4/6，失败                                        | 第一例 4 条记录按每页 2 条却要求末页 1 条；第二例删除后 3 条按每页 3 条，却要求至少两页。原失败不改写。                               |
| 本机分页补修                                                                                      | 冻结模块上 baseline 2/2、候选 6/6                                   | 第一例 pageSize 2→3，第二例 3→2；保留末页、完整列表和删除断言。Windows Node 22.22.2 / Vitest 4.1.11 的局部复验不等于 Docker 检查。    |
| 云端 v1：[40905084060](https://github.com/chainlesschain/chainlesschain/actions/runs/40905084060) | **failure**；原候选 4/6 复现；分页补修 6/6，但未杀死原行为变异      | 测试只用增加或删除 ID 改变文件集合，其他完整性检查也会拒绝旧索引；移除 inventoryDigest 守卫后仍 6/6。原检查器正确拒绝。               |
| 辅助修复 v2                                                                                       | 在原写入用例内新增同 ID 覆写阶段，不增加 case、不删除断言           | 已建立完整 4 条索引后，仅将现有 `bg-b` 改为 `startedAt: 2`、`status: running`，保持 ID 集合和条数；核对当前投影、分页内容与完整列表。 |
| 本机精确变异对照                                                                                  | 分页补修仍 6/6 漏过；v2 正常 6/6，原 baseline 2/2；变异后 5/6       | 唯一失败是 `bg-b` 仍返回旧状态，属于行为断言失败；私有冻结副本恢复原摘要。未据本机结果宣布云端通过。                                  |
| 云端 v2：[40907857461](https://github.com/chainlesschain/chainlesschain/actions/runs/40907857461) | **success**；baseline 2/2、最终候选 6/6；唯一原变异 5 通过 / 1 失败 | 同一流程先复现原候选 4/6 和分页补修漏过变异，再验证最终文件；原生产源码与测试支持文件在每个阶段结束后核对恢复摘要。                   |

v1 固定来源 `4f257075e328342542605c438e1da5831fe14e6d`，标签 `ci-verify10-assisted-20261029-v1`；v2 固定来源 `f498a6be767f1c2c3c3617564dadca937f03ae4c`，标签 `ci-verify10-assisted-20261029-v2`。两次各为独立的 `workflow_dispatch`，不是修改原生失败运行或重写其摘要。归档的 UTC 时刻保留原值；v2 在北京时间 10 月 30 日完成。

## 不变的检查合同

使用冻结项目 `b2aa3aba082873570e85dce39b00754e5504ff37` 和原 acceptance artifact `12909036700` 中直接提取的 setup/check 脚本。脚本内联原运行时，无需复用旧签名密钥或操作者凭据；未生成伪造的 native generation summary。Docker 固定 `node:22.12.0-bookworm`，image ID 为 `sha256:344dbe71e1c47a59db0e94bebdcc94ef3a7bc8bd828393c820168993539048da`。setup 按原脚本安装依赖，候选及变异检查在禁止网络的容器内执行；不是声称依赖安装也完全离线。

| 对象           | SHA-256                                                            |
| -------------- | ------------------------------------------------------------------ |
| 原候选         | `de5d61da09be63d267a35b6eec3e8d6deaf470ed713ca61cb149abd1241cf93e` |
| 仅分页补修候选 | `afe516ff8d7c5ddc683a78d25f3eb786d2e21d506093740da56e02ed46ed1afc` |
| 最终修复文件   | `ffa9f351672028d511ce2081f07ae8dc40cb6ca9dc2fce9ac54c34d5cffd7e61` |
| 原 setup 脚本  | `07a4788abc297d9933405136e952457046e86cad2e6096b8d6e5984f8c88d0ef` |
| 原 check 脚本  | `7b8aeeb9d121c3301f2d3a37cd769d180053cea3581c16f0cc0d9982f3231b98` |
| 原生产模块     | `178296fb536522ccfbc3dc214d38a964517bb16f514d8c805e5e32f70a1e7e55` |
| 精确变异模块   | `3217f66247957bb1f3f43ce6547313e47ac4c1f0a219b2e09365091f2b550d7c` |

原变异 `reuse-index-after-state-update` 仅将 `parsed.inventoryDigest !== inventory.digest ||` 替换为 `false ||`。原检查器要求失败来自断言而非语法、导入或运行器故障。v1 漏过变异时先抛错，`mutations` 数组因此为空；其最后一条原始 execution 的 JSON 才是 6/6 漏检证据，不能补造“变异已验证”记录。v2 的真实 `mutations` 记录为 `total: 6, passed: 5, failed: 1`，并绑定上述变异源码摘要。

本机 Docker daemon 不可用，故没有声称本机执行过原容器检查器；后来由两次真实 GitHub Actions 完成。归档时当前主线的 `background-agent-list-index.js` 与冻结模块摘要相同，这仅证明该文件相同字节，不证明当前 main 的完整源码、依赖闭包或其他任务通过。

## 归档与独立复核

[证据清单](./cli/evidence/native131-assisted-verify10-2026-10-30/review.json)保存两次实际 artifact 的全部已下载文件、调度回执与完成观察，共 **67 个逻辑文件**。每个文件保留原字节长度与 SHA-256，以 gzip 归档并另记压缩长度及摘要；相同内容可共享一个对象。没有复制私有资金、provider 凭据或原模型费用记录。

[独立校验脚本](./cli/evidence/native131-assisted-verify10-2026-10-30/verify-evidence.mjs)只读归档和本地 Git 对象，核对双摘要、云端来源/状态、阶段回执与真实输出、两个固定 CI 提交的 payload 字节、冻结 Git 文件及测试支持摘要、最终行为变异和公开交付文件。它不执行模型、网络请求或重新派发工作流：

```bash
node docs/research/cli/evidence/native131-assisted-verify10-2026-10-30/verify-evidence.mjs
```

复核结果：67 个文件全部通过；辅助修复 **1 项完成**，原自动验收 **34/45 不变**。此后原生重测若要增加自动成功数，仍需独立真实运行与验收证据。
