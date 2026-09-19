# 第三十六次工程实施：PM Memory 检索与模型出口父进程代理

日期：2026-09-19

## 本批结论

本批继续收敛 G01/G05 的运行时隔离缺口，把 PM Actor 的 Memory 检索和模型调用从普通子进程能力改为显式的父进程代理端口：

- execution manifest v7 可同时绑定独立的 `memory-retrieval` 与 `model-egress` authority；两者必须成对出现，并且不能与 receipt signer 共用 authority ID；
- egress-brokered Actor 使用 runner isolation v2。子进程只取得 `retrieveMemory()`、`invokeModel()` 代理，不取得 authority handler 或凭据；
- Memory 请求必须精确引用本轮 `inputMemoryDigest`，跨快照检索在调用 handler 前失败关闭；
- 模型请求必须声明用途和输出 token 上限。父进程把实际 input/output usage 计入本轮 token 预算，Memory/模型调用也计入外部调用预算；
- 父进程按调用顺序计算请求/结果摘要。成功执行的 execution receipt v3 同时签入进程监督摘要和 egress transcript 摘要；
- evidence bundle 在 manifest v7 下拒绝缺少 egress 证据的 execution receipt；
- 签名 Desktop deployment loader 暴露两个 authority 工厂，并要求其 handler artifact digest 与已认证 deployment 模块一致。

这完成的是仓内“只经父进程端口调用”的协议、预算和证据链，不是操作系统级断网。Node 22 子进程仍可能自行发起网络连接；生产验收必须由目标环境 sandbox/container 阻断直接网络出口，才能证明 Actor 无法绕过模型代理。

## 主要实现

### 1. 独立 egress authority

新增 `pm-exploration-egress-authority.js`：

- authority descriptor 固定 kind、authority ID、revision、handler artifact digest、policy digest 和 authority digest；
- Memory handler 只接收本轮计划、环境、manifest、round、task 与输入 Memory 绑定，以及有界 JSON query；
- 模型 handler 只接收同一轮上下文、有界 JSON input、用途、输出上限和剩余 token 预算；
- handler 的返回值必须是有界 JSON；模型 usage 必须为非负安全整数，并不得超过调用上限或剩余预算。

### 2. 预算执行器与进程 broker

预算执行器新增两个受控端口：

- `retrieveMemory(request)`；
- `invokeModel(request)`。

两类调用都先占用一次外部调用配额；模型返回后再按可信父端 handler 报告的 usage 计入 token 配额。handler 拒绝、越界快照、超预算、端口缺失或未结算请求都会使本轮进入 sandbox/budget 失败路径。

进程 broker 协议新增 `retrieve-memory` 与 `invoke-model` 操作。旧 runner isolation v1 仍只装配 token/工具端口；只有显式启用 egress broker 的 runner isolation v2 才会装配 Memory/模型端口。

### 3. Manifest、回执与恢复证据

- manifest v2-v6 保持兼容读取；v7 增加成对的 Memory/模型 authority descriptor；
- execution receipt v1/v2 保持兼容读取；v3 要求 egress evidence 与 runner isolation evidence 同时存在；
- 成功调用的 transcript 只保留顺序、类型、请求摘要和结果摘要，不把 Memory 内容或模型正文写入签名回执；
- manifest v7 的 evidence bundle 会验证 execution receipt 未被降级为不含 egress evidence 的旧版本。

## 负例覆盖

本批新增或扩展以下验证：

1. 子进程经父进程读取本轮 Memory，并经父进程调用模型；
2. Memory/模型调用数量与模型 usage 进入统一预算；
3. 跨 `inputMemoryDigest` 检索即使被子进程捕获异常，本轮仍失败关闭；
4. 模型声明的输出上限超过剩余预算时，handler 不会被调用；
5. egress transcript 摘要篡改导致 execution receipt 验签失败；
6. manifest v7 配合降级 execution receipt 时，evidence bundle 拒绝构造；
7. deployment 外部实现不能伪装成已认证 Memory/模型 authority handler。

## 验证结果

相关 Eval、PM、监督、部署回归：

```text
Test Files  23 passed (23)
Tests       372 passed (372)
```

本批涉及的 JavaScript/ESM 文件通过 ESLint，全部相关文件通过 Prettier；`git diff --check` 无空白错误。

## 仍未完成

- 目标环境的网络 namespace、容器或等价 sandbox 尚未接线，不能证明子进程无法直连任意模型/网络服务；
- 尚未由 operator 签发生产 manifest v7、Memory/模型 policy 和 handler artifact；
- 尚未在真实 Electron PM 入口与 DID/RBAC 身份下完成端到端泄漏负例；
- 独立未见隐藏集、真实多轮探索、断电恢复和后一轮消费前一轮经验仍需目标环境验收。
