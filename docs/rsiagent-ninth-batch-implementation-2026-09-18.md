# RSIAgent 第九次工程实施：预算执行与签名轮次证据

> 日期：2026-09-18（Asia/Shanghai）<br>
> 前置实施：[第八次存储与 authority 故障关闭](./rsiagent-eighth-batch-implementation-2026-09-17.md)<br>
> 状态：PM 轮次已具备宿主强制墙钟退出、token/tool 计量、工具白名单代理、四角色 Ed25519 回执、独立密钥清单绑定和重启后完整回执包复验；完整证据包已随 v2 PM Ledger record 由 durability authority 保留，并能在 Desktop 只读投影中显示认证状态。执行仍默认关闭，未接入真实 Desktop provider 或生产进程沙箱。
> 后续实施：[第十次本机火山引擎真实调用与用量结算](./rsiagent-tenth-batch-implementation-2026-09-18.md)已补真实 Volcengine 连通、provider usage 计量和费用估算 adapter；签名 Evolution deployment 与真实受治理 PM/Desktop 任务仍未配置。

本批关闭的是可在仓库内独立验证的“预算与签名证据合同”缺口，不把同进程测试 handler、测试密钥或本地单元测试解释为真实 Agent、独立服务、生产隔离或效果提升。

## 1. 实施结果

新增 [PM 签名回执](../packages/cli/src/lib/evolution/pm-exploration-receipts.js)，为以下四种角色定义互不混用的 Schema 和 Ed25519 域分离签名：

- execution：绑定计划、环境、请求、轮次、任务、输入/输出 Memory、trace、终态、失败分类和资源计量；
- grader：绑定 execution receipt、输出 Memory、判定、分数、结果摘要和独立计量；
- merge：绑定全部 Broad 分支末端 checkpoint、合并输出、冲突处理摘要、终态和计量；
- evaluator：绑定 merge receipt、最终 checkpoint/Memory、最终判定、评估摘要和计量。

每个 authority 描述符绑定角色、authority ID、revision、handler artifact digest 和公钥摘要。执行清单要求四个角色使用不同 authority ID 和不同公钥；验签对象只持有公钥，不能签发新回执。摘要、签名、角色、authority 和调用方指定的业务字段任一不匹配都会失败。

新增 [PM 预算执行器](../packages/cli/src/lib/evolution/pm-exploration-budget-executor.js)：

- 墙钟到期后即返回受控失败，并触发 `AbortSignal`，不会等待忽略取消的 Promise；
- token 超限、工具调用超限、未授权工具和不可用 broker 都主动中止；
- 工具只能按执行清单 allow-list 通过宿主 broker 调用，输入输出限制为有界无环 JSON；
- 运行结束立即关闭计量 capability，迟到回调不能继续计费或调用工具；
- 失败只进入有限 failure class 和摘要，不把内部异常正文写入正式回执。

[PM 执行宿主](../packages/cli/src/lib/evolution/pm-exploration-execution-host.js)将上述合同接到现有 Broad/Deep 状态机：

1. 清单精确绑定计划、环境、工具策略与四个回执 authority；
2. runner 只能通过预算 capability 记录 token、调用允许的结构化工具；
3. 独立 grader 读取签名 execution receipt 后签发 accept/reject/unsafe 判定；
4. checkpoint 使用两份实际回执摘要和宿主计量结算，失败执行不能被 grader 接受；
5. merge 和 evaluator 分别签名，最终 freeze 只接受 `accept` evaluator receipt；
6. 达到预算上限即停止后续轮次准入，不再允许“刚好用尽后再开一轮”。

各阶段返回值继续保留 `qualifiesForPromotion:false`。单次宿主调用可确认回执真实性，但基础 recovery snapshot 仍保持 `authenticated:false`，不会因出现签名摘要而自动升级。

## 2. 重启回执复验

新增 [PM evidence bundle](../packages/cli/src/lib/evolution/pm-exploration-evidence-bundle.js)，把静止点 snapshot 与完整签名回执重新关联：

- 每个 checkpoint 必须恰好找到对应 execution/grader receipt；
- 轮次、任务、阶段、输入/输出 Memory、判定和两份回执计量之和必须与 checkpoint 一致；
- merge receipt 必须精确对应 snapshot 中的分支末端和 merge digest 引用；
- frozen snapshot 必须具有接受判定的 evaluator receipt，并绑定最终 checkpoint/Memory；
- 多余、缺失、重复、篡改、跨计划、跨环境或错误 authority 回执全部拒绝。

验证通过的 evidence bundle 可声明 `snapshotAuthenticated:true`，表示给定可信计划、执行清单和四个公钥 authority 下，snapshot 的业务转换证据可复验。它仍固定 `qualifiesForPromotion:false`。

[PM Ledger adapter](../packages/cli/src/lib/evolution/pm-exploration-ledger-adapter.js)新增 v2 authenticated record：

- 可信组合必须同时提供 execution manifest 与四个只验签 authority；只配置其中一部分会在构造阶段失败；
- `commitJournal(journal, evidenceBundle)`先完整复验 bundle，再把 snapshot、bundle、evidence digest 与 manifest digest 写入同一个 canonical Ledger-retained artifact；
- artifact 仍按既有顺序完成本地写后回读、独立 authority retain，最后才追加 Ledger event；event ID 同时摘要绑定 snapshot 和 evidence；
- 回读会重新验证 Ledger、durability authority、snapshot replay 和全部签名回执；缺少验签上下文的旧 adapter 读取 v2 会失败关闭；
- v1 未签名记录继续兼容并保持 `snapshotAuthenticated:false`，不能被自动升级；同一 v2 snapshot 的不同 evidence 不能替换已提交证据；
- Desktop storage host 只投影认证布尔值，不暴露 bundle、回执、公钥、路径或写端口，并继续固定 `qualifiesForPromotion:false`。

## 3. 安全边界

本批没有宣称或开放以下能力：

- handler 当前是受信宿主回调合同，不是 OS 进程、容器或虚拟机隔离；不受信代码仍必须由现有 process broker/平台沙箱承载；
- token 计量要求真实 provider adapter 在流式使用量到达时调用 capability；测试 handler 的主动上报不能代替付费 provider 对账；
- 工具 broker 限制通过 capability 发起的调用，不证明同进程恶意模块无法使用 Node.js 自身权限；
- 未配置生产密钥、远端签名服务、一次性 workspace/database clone、真实 DID/RBAC、安装包或真实模型；
- 未执行 holdout、等预算 baseline/Explorer 对照、Pilot、人工审核或发布门。

因此，Desktop readiness 和 Explorer 执行开关继续保持 fail-closed。测试 signer 不能迁入生产，四个角色也不能在生产中共用同一私钥。

## 4. 自动化验证

新增测试覆盖：

- 四角色正常签发/验签、字段篡改、摘要替换、签名替换、错误 authority、密钥不匹配和 accessor 输入；
- token/tool/墙钟/父级取消、工具白名单、broker 未调用、capability 关闭；
- runner → grader → checkpoint、预算失败签名 unsafe、未授权工具、Broad merge、Deep round、evaluator freeze；
- JSON 往返后的完整 evidence bundle 复验及 grader receipt 篡改拒绝；
- 轮次预算恰好耗尽时停止准入。

本批验证结果：

| 检查                                   | 结果                   |
| -------------------------------------- | ---------------------- |
| 新增回执、预算、执行宿主与轮次定向测试 | 38 passed              |
| PM Ledger adapter（含认证 v2 record）  | 13 passed              |
| 完整 PM 定向回归（不含多进程演练）     | 119 passed             |
| 多进程恢复故障演练                     | 2 passed，31 processes |
| CLI deployment loader                  | 56 passed              |
| Desktop deployment / readiness         | 28 passed              |
| 相关 ESLint                            | 0 error                |
| Prettier / Node syntax                 | passed                 |

多进程恢复演练仍使用第八批的 synthetic fault 与测试 authority；本批没有改变其生产资格字段。

## 5. 仍需目标环境完成的事项

1. 在目标 Desktop 签名 deployment 中配置经过审查的生产 durability authority、manifest、公钥和存储目录，对 v2 snapshot + evidence record 重复只读、磁盘满、断连、重连与物理断电演练。
2. 通过现有 process execution broker 和平台沙箱承载 runner，将模型、文件、IPC、网络和工具权限限制在一次性 workspace/database clone 中；宿主退出后验证无残留。
3. 将四种 signer 放入独立进程或远端受审查服务，绑定生产密钥轮换、撤销、审计和超时/断连语义；私钥不得进入 renderer 或 Actor 上下文。
4. 已由第十批接入本机 Volcengine 的真实 provider usage 流与费用估算；仍需在签名 Evolution deployment 中用合法/越权身份运行结构化 PM 任务，将 settlement 纳入 durable evidence，并保存精确 release SHA 的三系统证据。
5. 冻结实验合同后完成等预算 baseline/Explorer holdout 对照、人工审核、Pilot 和回滚演练；只有安全、恢复、收益与成本门全部通过才可申请运行令牌或晋级。

这些事项依赖目标部署、生产凭据、外部服务或真实实验预算，不能由本地 fixture 合法替代，也不能通过把布尔字段改为 `true` 来关闭。
