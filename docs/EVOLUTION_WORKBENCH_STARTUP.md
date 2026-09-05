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

## 文件资源打开入口

`openEvolutionWorkbenchFileResources(options)` 已实现文件持久层的打开与重开，不再要求部署模块手工构造全部存储实例。签名 loader 仅向获准的 `evolution/serve` 部署模块提供此工厂，`descriptor.handlerArtifactDigest` 仍须等于正在执行的认证模块摘要。

必填配置如下；它是部署模块的受信输入，不接受 IDE 请求中的路径、权限或 authority 替换：

- `descriptor`：精确包含 `tenantId/artifactTenantId/streamId/runId/skillName/audience/purpose/authorityId/revision/handlerArtifactDigest`；purpose 固定为 `evolution-ledger`。
- `storage`：精确包含 `artifactDir/ledgerRootDir/ledgerAuthorityRootDir/witnessFilePath/witnessId/releaseRootDir`。路径必须为绝对路径，Artifact、事件账本、账本信任根、Registry 与 witness 所在目录互不包含；拒绝符号链接、junction、路径别名、文件类型错误及多链接 witness 文件。
- `authorities.artifact`：`envelopeSigner.sign/envelopeVerifier.verify/currentAuthorityResolver.resolve`。
- `authorities.ledger` 与 `authorities.witness`：各自的 `trust/signer/verifier`（`signer` 含 `sign` 方法；`verifier` 含 `verify` 方法）。两者的 signer、verifier、keyId 与 policy digest 必须独立。
- `authorities.releaseDurability`：`id/retain/resolve`，提供既有 Release 制品的持久保留与重新解析证明；没有本地默认成功实现。

可选 `secure` 默认 `true`，`fsImpl` 默认 Node 文件系统，`now` 默认 `Date.now`。配置、固定 own-method authority 与路径检查先于存储打开；随后创建实际 ArtifactStore/ArtifactPorts、文件 Ledger/witness、领域 transaction ledger 和 ReleaseRegistry，独立重开第二组实例，并核验两个完整账本的同一身份与 head。Registry 构造函数先恢复自己的 journal，后续完整宿主仍须验证当前 Registry/Run/Review 投影并补记已有 Workbench 效果。

返回值分为两个只供部署装配使用的对象：

- `runtimeResources`：可传给 `createEvolutionWorkbenchRuntime` 的 descriptor、ArtifactPorts、主账本/resolver/Registry/transaction ledger、独立校验实例与时钟。
- `mutationPorts`：同一主账本的 `auditSink/nonceStore`，供部署的真实 `SkillMutationAuthority` 使用。

该入口不构造真人、候选、审批、mutation capability 或演化 Run，不把空存储填成演示成功状态，也不返回 Workbench host。它不自动迁移旧格式、不覆盖既有状态、不安装插件。构造中途失败可能留下已经初始化的合法目录或已经恢复的 Registry journal；不执行破坏性清理或跨存储回滚，后续重开必须重新认证。

**文件 opener 不等于一键启用。** 部署仍需提供控制端口：实际 CandidateRegistry、同 Registry 的 controller rollback provider、mutation principal/receipt 与 request authority，以及真人身份/审核/回滚签名和当前撤销策略。`secure:false` 不是耐久性兼容开关，不会忽略 fsync 错误；Windows 测试显式使用 TEST directory-fsync 适配器，不能把这些测试当作原生 Windows 物理断电或生产文件系统验收。两个本机 reader 也不等于两个独立主机故障域。

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

现在可用实际文件 opener 实现上述资源函数的存储部分。以下 `readTrustedFileResourceOptions` 和 `openDeploymentControlPorts` 仍由目标部署提供；它们不是仓库内已经实现的凭据安装器：

```js
const { runtimeResources, mutationPorts } =
  factories.openEvolutionWorkbenchFileResources(
    await readTrustedFileResourceOptions({
      handlerArtifactDigest: descriptor.moduleDigest,
    }),
  );
const controls = await openDeploymentControlPorts({
  descriptor: runtimeResources.descriptor,
  releaseRegistry: runtimeResources.releaseRegistry,
  mutationPorts,
});
const { workbenchHost } = await factories.createEvolutionWorkbenchRuntime({
  ...runtimeResources,
  ...controls,
});
```

`controls` 只提供必需的治理端口（及显式可选来源），不得替换 `runtimeResources` 中的存储；controller 的 capability 必须由使用上述同账本 audit/nonce ports 的真实 authority 签发、消费。仅将外部 authority 函数名写进配置不代表该部署已完成。

descriptor 签名、module/trust-root digest 与 command allowlist 验证仍由现有 loader 完成；其入口模块是按精确字节认证的单文件 ESM。目标环境需要同时设置绝对路径 `CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR` 和 `CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT`。CLI 数据目录、安全锚和工作目录必须满足现有隔离规则，不能把 `CHAINLESSCHAIN_HOME` 放在工作区里。

lazy/eager 入口会保留部署认证、资源组装及已配置宿主的注册错误，不再通过兼容重试将其隐藏为 unknown command；部署组装可能已经补记持久状态，也不能被这种回退重复调用。普通无部署的模块加载兼容行为保持不变。

## 验证边界

单元用例验证历史 preparation 审计、过期/后续晋升的待处理计划、已发生效果补账、当前撤销和错误资源拒绝。五窗口 SIGKILL 回归在新进程先调用完整启动工厂，证明它只补记实际效果；尚未实际回滚的计划随后由显式 `resume()` 处理。

真实进程用例使用公开 CLI bin、真实签名 descriptor 和实际文件存储，覆盖 CLI 审核、stdio 能力协商与回滚、重启后的相同当前投影及部署模块篡改拒绝。其身份是明确标注的签名、file-fsync TEST fixture，Ledger/witness/Eval 也为测试 authority；不代表生产真人、模型或用户 IDE 安装已验收。具体运行结果见总任务文档 §7.2。

文件资源入口回归还验证空存储不造数、旧真实晋升历史的双实例重开、当前信任撤销、默认 owner-only、缺端口/访问器/Proxy/重叠目录/junction/错误文件类型的启动拒绝。签名 CLI/stdio 测试使用该生产 opener 构造持久层，五个回滚 SIGKILL 旅程的 startup 子进程同样通过它重开；造数和外部 authority 仍清楚隔离在 TEST fixture 中。

默认环境未配置上述资源时仍必须 unavailable。未修改用户的环境变量、IDE 安装或生产密钥；GitHub、子 npm 包与插件发布门禁不因这些本地测试而放宽。
