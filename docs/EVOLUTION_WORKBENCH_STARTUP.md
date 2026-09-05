# Workbench 完整宿主启动合同

`createEvolutionWorkbenchRuntime(options)` 将真实 Registry source、Review runtime、rollback runtime 和 CLI host 组装为同一个受信宿主。它是异步工厂；必须等待完成后再向命令或服务端提供 host。它不创建生产身份、密钥、测试数据或自动审批权限。

## 实际资源

部署先打开真实 Registry，完成其自身 journal 恢复，并提供以下 own data 属性；未知字段、资源 getter/Proxy、替换的 projection/transition reader 会被拒绝。

- `descriptor / artifactPorts / ledger / ledgerArtifactResolver`：同租户、同 run/Skill/stream 的真实持久资源；descriptor 与既有 Review/rollback 合同一致。
- `releaseRegistry / transactionLedger` 和独立重开的 `verifierLedger / verifierLedgerArtifactResolver / verifierReleaseRegistry / verifierTransactionLedger`：真实关联实例，不能复用同一个对象。
- `rollbackProvider / authorizationProvider`：真实控制器 capability 与 mutation authority。
- `identityProvider.current`：部署的持久、当前认证、非自动化真人身份，绑定同一 tenant；不从 CLI 参数推定 reviewer。
- `decisionVerifier.verify / humanDecisionProvider.request / humanDecisionVerifier.verify`：canonical Review 与独立 Workbench 外层人工响应的真实服务、签名及当前撤销策略。
- `humanRollbackProvider.authorize / humanRollbackVerifier.verify`：精确计划的真人授权及当前验证。
- 可选 `invocationReceiptSource / pilotSource / now`：目标部署的受治理来源和时钟，不在缺失时生成成功数据。

固定端口必须是 own 方法，构造时捕获函数本身。真实签名和授权规则分别见[Review 合同](EVOLUTION_WORKBENCH_REVIEW_RUNTIME.md)、[回滚合同](EVOLUTION_WORKBENCH_ROLLBACK_RUNTIME.md)与[当前 Registry 读取](EVOLUTION_WORKBENCH_REGISTRY_RUNTIME.md)。这里没有默认身份或部署资源提供器。

## 启动只补账，不继续未执行操作

工厂顺序为：构造并验证全部真实适配器 → Review 已发生效果补账 → rollback 已发生效果补账 → 认证当前完整投影 → 返回 `workbenchHost`。

两个适配器新增的 `reconcileCommitted()` 与原 `resume()` 不同：

- 已真实写入 Review decision 或已完成 Registry mutation，但缺少 Workbench settlement：重新验证效果及当前签名/撤销策略后补记 settlement。
- 仅有 preparation、尚无实际效果：只审计，不请求身份、真人审批或 mutation authority，不继续批次中尚未开始的其他项，也不切换 active。
- 已过期的 pending 授权按实际持久 preparation 事件的时间检查历史合法性；这不是让它在当前时间重新有效。回滚计划的历史 active/LKG 从两个真实 Ledger reader 的精确 preparation checkpoint 重建，不用当前新版本否定当时合法的待处理记录。
- 当前信任撤销、伪造绑定或账本变化仍拒绝启动，不能用“只读模式”跳过认证。旧 `resume()` 的显式执行继续要求当前授权有效，并保留其原有状态漂移检查。

工厂返回 `recovery` 中四个计数：`reviewsSettled`、`reviewPreparationsDeferred`、`rollbacksSettled`、`rollbackPlansDeferred`。deferred 只计真实保存、尚未产生效果的 preparation，不代表所有待审核候选。返回值没有 writer、审批密钥或通用 RPC。

补记不是跨两个适配器的全或无事务：后一个域失败时，前一个域已完成的持久 settlement 保留，宿主不对外开放；修复后重试会重新验证且不重复实际效果。完整存储备份、跨主机 witness 和物理断电仍是部署验收。

## 签名部署入口的两种参数名

签名 loader 在 `evolution` 和 `serve` 提供此工厂，并要求 `options.descriptor.handlerArtifactDigest` 等于该部署模块的实际认证字节摘要。两个 registrar 使用不同的已有依赖字段，必须显式映射同一个 host：

| 命令                                       | 部署入口返回字段                            |
| ------------------------------------------ | ------------------------------------------- |
| `evolution workbench ...`                  | `{ workbenchHost }`                         |
| `serve --app-server`（stdio 或 WebSocket） | `{ evolutionWorkbenchHost: workbenchHost }` |

以下是部署入口合同片段，不是自带身份/存储配置的一键安装脚本；`openDeploymentResources` 必须由部署方提供并审核：

```js
export async function createChainlessChainCommandDependencies({
  commandName,
  descriptor,
  factories,
}) {
  const options = await openDeploymentResources({
    handlerArtifactDigest: descriptor.moduleDigest,
  });
  const { workbenchHost } =
    await factories.createEvolutionWorkbenchRuntime(options);
  if (commandName === "serve") {
    return { evolutionWorkbenchHost: workbenchHost };
  }
  if (commandName === "evolution") return { workbenchHost };
  throw new Error("Unsupported Workbench deployment command");
}
```

descriptor 签名、module/trust-root digest 与 command allowlist 验证仍由现有 loader 完成；其入口模块是按精确字节认证的单文件 ESM。目标环境需要同时设置绝对路径 `CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR` 和 `CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT`。CLI 数据目录、安全锚和工作目录必须满足现有隔离规则，不能把 `CHAINLESSCHAIN_HOME` 放在工作区里。

lazy/eager 入口会保留部署认证、资源组装及已配置宿主的注册错误，不再通过兼容重试将其隐藏为 unknown command；部署组装可能已经补记持久状态，也不能被这种回退重复调用。普通无部署的模块加载兼容行为保持不变。

## 验证边界

单元用例验证历史 preparation 审计、过期/后续晋升的待处理计划、已发生效果补账、当前撤销和错误资源拒绝。五窗口 SIGKILL 回归在新进程先调用完整启动工厂，证明它只补记实际效果；尚未实际回滚的计划随后由显式 `resume()` 处理。

真实进程用例使用公开 CLI bin、真实签名 descriptor 和实际文件存储，覆盖 CLI 审核、stdio 能力协商与回滚、重启后的相同当前投影及部署模块篡改拒绝。其身份是明确标注的签名、file-fsync TEST fixture，Ledger/witness/Eval 也为测试 authority；不代表生产真人、模型或用户 IDE 安装已验收。具体运行结果见总任务文档 §7.2。

默认环境未配置上述资源时仍必须 unavailable。未修改用户的环境变量、IDE 安装或生产密钥；GitHub、子 npm 包与插件发布门禁不因这些本地测试而放宽。
