# 正式付费执行的费用条件

用户已授权火山测试，并指定 Astra 代替人工预审。火山短测已实际返回完整 usage；Astra 也已通过修后评估器范围的审阅。这两项分别取得回执，不再等待该项人工审阅，但它们不能证明全部样本的费用控制。

原计划允许 provider 硬额度或可靠实时计量。目前 `cost-budget` 根据响应后usage累加，formal eval只传本次 `--max-budget-usd`；缺usage/unpriced没有覆盖全部出口的强制停止，补救和不同样本也没有共享预留。仅把停止线从 $2 降到 $1.8 不足：Volcengine请求只在存在maxOutputTokens时传max_tokens，当前formal launcher没有建立经验证的单次计费上界。现有session预算调用前仅传callId，并不预留本次最大美元责任额；eval也没有启用这项authority。Astra已只读核对相关生产代码，未把诊断估算当作硬额度。

可靠实时计量的替代工程需要：按精确endpoint/model收费合同，在每个物理请求前计算最坏计费责任额；在唯一的持久authority中原子预留，同时约束样本$2/$3及原lineage共享$99；完整可定价usage结算后才释放余量；断流、超时、崩溃、missing/unpriced保留全部责任额并停止后续调用；补救复用原样本余款，所有付费出口和物理重试都经过同一控制。输入不能采用字符数÷4等估算作硬界，model context/output、reasoning、缓存/分档/服务等级及币种均需实际合同依据。新窗口不重置之前的已花费或未结算责任额。

该设计需要故障、并发、跨平台恢复和准确源码CI，并审查是否改变冻结endpoint/推理/产品身份。当前尚未实现或验证，不作为本次已完成能力。若不实现这套替代控制，仍需真实provider额度控制和跨样本预算分配记录，才能启动正式付费样本。单次1024token、20秒、零重试的用户授权短测为独立诊断，正式observations仍为0，未知费用保留unknown/null。
