# 正式付费执行的费用条件

用户已授权火山测试，并指定 Astra 代替人工预审。火山短测已实际返回完整 usage；Astra 也已通过修后评估器范围的审阅。这两项分别取得回执，不再等待该项人工审阅，但它们不能证明全部样本的费用控制。

原计划允许 provider 硬额度或可靠实时计量。目前 `cost-budget` 根据响应后usage累加，formal eval只传本次 `--max-budget-usd`；缺usage/unpriced没有覆盖全部出口的强制停止，补救和不同样本也没有共享预留。仅把停止线从 $2 降到 $1.8 不足：Volcengine请求只在存在maxOutputTokens时传max_tokens，当前formal launcher没有建立经验证的单次计费上界。现有session预算调用前仅传callId，并不预留本次最大美元责任额；eval也没有启用这项authority。Astra已只读核对相关生产代码，未把诊断估算当作硬额度。

可靠实时计量的替代工程需要：按精确endpoint/model收费合同，在每个物理请求前计算最坏计费责任额；在唯一的持久authority中原子预留，同时约束样本$2/$3及原lineage共享$99；完整可定价usage结算后才释放余量；断流、超时、崩溃、missing/unpriced保留全部责任额并停止后续调用；补救复用原样本余款，所有付费出口和物理重试都经过同一控制。输入不能采用字符数÷4等估算作硬界，model context/output、reasoning、缓存/分档/服务等级及币种均需实际合同依据。新窗口不重置之前的已花费或未结算责任额。

该设计需要故障、并发、跨平台恢复和准确源码CI，并审查是否改变冻结endpoint/推理/产品身份。当前尚未实现或验证，不作为本次已完成能力。若不实现这套替代控制，仍需真实provider额度控制和跨样本预算分配记录，才能启动正式付费样本。单次 `max_tokens=1024`、20秒、零重试的用户授权短测为独立诊断；该参数限制回答长度，不是回答加推理的总输出硬上限。正式observations仍为0，未知费用保留unknown/null。

2026-10-13增量：[官方费用合同核查](../evidence/gap-2026-10-05/continuation-2026-10-12/volcengine-cost-contract-review/README.md)确认精确模型常规在线价以人民币计费（未缓存输入3、缓存输入0.10、输出9元/百万token）。现有美元配置估价不能作为官方费用；旧短测的公开常规价token-only估算为¥0.000384，实际账单未知。官方全模型上限形成¥7.86432、圆整¥8的条件预留候选，但账号适用合同、非token费用及可靠CNY→USD预算上界尚未核实，不能据此宣称共享$99控制已就绪。实际响应service_tier为default；13 completion包含11 reasoning，结算不得重复计价。

2026-10-13 离线准备增量：[Astra预算ledger原型与方案](../evidence/gap-2026-10-05/continuation-2026-10-12/formal-budget-offline-readiness/README.md)的7项fixture回归通过，覆盖原子预留、重启pending保留、一次补救共享额度、unknown停止和幂等结算。尚无provider transport、生产接线、实际价格/FX映射或历史lineage导入；未证明真实崩溃持久性或全部付费出口控制，仍NOT_PAID_READY。已检查的本地配置仅有推理凭据，账号适用合同及FX上界尚缺；冻结18+18+9、默认thinking、每样本2/3美元与共享99不变。
