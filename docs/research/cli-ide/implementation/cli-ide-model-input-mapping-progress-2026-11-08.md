# 模型输入跨阶段来源映射（2026-11-08）

本批继续[差距复核第 2 项](../plans/cli-ide-codex-claude-gap-review-2026-11-08.md)，并减少第 9 项的重复转换接线。分支 feature/model-input-source-mapping-20261108，基线 3591769ba40190c1017b4556ef3e5320258ed6ef。本批尚未发行，完整计划仍未完成。

**实现范围**

实际 bundle 排序及展开循环记录 item 到消息位置的关系；工具按具体 definition 和原 registry 顺序绑定。provider-context 的模块私有 WeakMap 仅保存完整请求的 canonical 摘要及冻结位置关系，不导出 mint API，不长期保留图片或正文副本。未知 plan 或请求变化不能取得映射。

签名入口在现有 manifest 持久化、验签与读回成功后，将输入 / 输出摘要和结构位置绑定到私有 receipt。原消息向后移动一位，新增宿主 provenance 消息不冒充来源。redactionTouched / injectionTouched 来自已验证路径；不从全局计数推导某来源的处理次数。

Chat / Responses / Anthropic / Ollama 的实际生产转换循环登记输出位置。Anthropic 合并 system 时记录字符串区间，合并工具结果时记录各 content block；Responses 保留 reasoning、文本、function call / output 的展开关系。工具定义保留精确数量和原始顺序，不按同名工具补齐。

协议登记还核对转换实际消费的完整逻辑快照。body-prepared 再验证已覆盖输入根及片段，将位置摘要与同一 requestId、attempt、bodyDigest 绑定。governed transport 只改变 JSON 序列化时仍可关联；更改已覆盖输入根则报告未知。

来源达到诊断截断或位置上限时报告 mapping_limit；旧日志仍可查询，但不能补造完整映射。对外仅输出摘要、固定字段、枚举、索引和受限协议路径，不输出正文、服务器身份、工具名称、工作区路径或原始来源身份。

observer 在脱离当前诊断 AsyncLocalStorage 的范围中执行，仍等待持久化结果并传播失败，主动回调重入不会改写外层请求状态。写入与查询均执行白名单投影。

**验证状态**

17 文件最终组合回归：182 通过、0 失败、0 跳过。完整 production composition 文件最终 288 通过、0 失败、0 跳过，包含四协议来源映射及实际 headless canonical 持久化断言。

四协议专项此前 11 项通过、277 项未选中，包含相同文本的不同来源、双 system、双工具结果 bundle、schema、图片、单来源脱敏、小预算排除，以及 headless / REPL 原会话续跑。新加入的 headless 持久化断言已在最终完整回归通过；REPL 范围是恢复候选与 core/provider 桥接，仍不是完整交互终端。

Responses 专项保留生产的官方端点协议选择门禁，使用明确断言的测试 fetch 将请求转到真实回环 HTTP 接收端；没有请求 OpenAI 官方服务或验证账号。其他三类专项直接连接回环 HTTP。所有端点均为合成夹具，无真实模型调用或付费请求。

**复核与保留失败**

初次 26 项中 25 通过、1 失败：新增夹具错误地要求 dropped 带 kind，而既有合同只保留 digest / reason；改用原工具 item.digest 对照，没有改变生产规划合同。

首次真实组合 9 通过、2 失败、277 未选中：自定义端点走既有 Chat 门禁，未授信的第二条 system 来源按规则被排除。修正夹具的实际协议与 host trust 后 11 项通过，没有扩大生产支持。

Astra 复核发现截断仍可能报 complete、协议登记缺少逻辑输入摘要绑定，已修正并增加回归。另发现新增精确工具筛选用 isDeepStrictEqual 比较原 schema 与规范化快照，会丢失合法 null-prototype schema；修复前失败报告保留。筛选现使用与规划相同 domain 的 canonicalDigest 多重集匹配，保留精确数量与顺序。补充 observer 重入隔离，不将主动宿主 JavaScript 当作模型沙箱。

**剩余工作**

CLI 映射不能代替双 IDE 新字段展示、独立任务验收和完整故障归因。完整交互终端、原生 IDE / 桌面、真实模型 / 服务、其他系统和准确提交 CI 仍需各自证据。未对新增规范化及摘要成本完成性能 SLO；没有扩大正式付费、默认启用或发行准入，也没有重跑历史付费样本。

[查询说明](../../../cli/model-input-diagnostics.md)

完整首次回归为 271 / 288 通过、17 失败。两项 headless 夹具没有在真实环境启用 canonical 规划；按实际宿主环境配置后，与 receipt 新结构严格核对共 5 项通过。没有改变 headless 选项白名单或默认规划阶段。

其余 14 项 PDH 失败已在准确基线 3591769ba40190c1017b4556ef3e5320258ed6ef 复现：相同 19 项为 5 通过、14 失败，失败名称逐项一致。包名导入与相对导入加载了内容相同、物理路径不同的品牌模块，WeakSet 不共享。使用每个 worktree 独立的依赖 overlay 统一到各自 PDH 包后，基线同组 19 项全部通过；未修改共享依赖或生产品牌校验。当前完整 288 项在同样单实例布局复验全部通过，首次失败报告保留。

[证据清单与哈希](./evidence/model-input-mapping-20261108/manifest.json)保留 15 份原始报告 / 归因记录，以及最终 11 个源码和测试文件的验证哈希。182 项组合使用原依赖布局；288 项使用独立单实例布局，两组分别报告。基线 19 项不计入本提交结果，早先 11 项专项已包含在完整文件中，不另行累加。ESLint 0 错误、23 个基线已有警告；Prettier / diff 检查通过。
