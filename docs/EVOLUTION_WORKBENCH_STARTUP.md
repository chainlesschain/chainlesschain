# Workbench 完整宿主启动合同

## 本地开启与测试（源码仓库）

IDE 出现“已安装的 CLI 部署未配置受治理的工作台宿主”表示当前 App Server
未加载部署。仅升级 CLI 或启用 pilot 不会创建签名部署和治理资源。

现在可在仓库根目录创建独立的本地测试环境：

```powershell
node packages/cli/scripts/evolution-workbench-local-test.mjs init
```

命令输出 `profilePath`。安装包含本次改动的 VS Code/VSCodium 扩展，在**用户设置**中将
`chainlesschain.evolution.workbench.profile` 设为该绝对路径，再执行
`ChainlessChain: 演化工作台`。更改配置后下次打开会重建工作台进程，无需重启普通聊天。
首次安装新扩展时需要重载 IDE 窗口。

工作台现在分别显示启动服务和读取版本的状态。只读加载最多等待 45 秒，超时后恢复
“刷新”和“连接配置”；晚到的旧读取不会覆盖重试后的页面。缺少数据时统计显示 `—`，
不把连接失败显示成零个版本。SDK 的管道背压、断连或协议错误会及时结束待处理请求；
超时只表示本次等待结束，不代表后台审批或回滚已取消，不应自动重发写操作。

列表按 CLI 分页读取最多 10,000 个版本，逐页核对同一投影摘要、治理状态、总数与连续
偏移，拒绝漏页、重复版本或读取期间的状态变化。页面每页显示 25 个版本，搜索和统计
覆盖已验证的完整集合；超过第 500 个的版本也可进入审核、比较与回滚。

工作台会显示“本地测试（测试身份与数据）”，提供一个当前版本、一个已批准历史版本和
一个待审核候选。可以查看证据、对比、批准/拒绝候选，以及回滚到已批准历史版本；
操作落入本地测试账本，关闭后重新打开可继续查看。此流程不调用大模型，不需要 API Key。

自动验证整个测试旅程（会审核候选并执行回滚，应使用新建的测试环境）：

```powershell
node packages/cli/scripts/evolution-workbench-local-test.mjs verify "<profilePath>"
```

该验证使用真实 IDE 客户端、CLI 子进程和签名持久运行时，程序化选择界面动作；
它不是屏幕点击测试。覆盖列表、证据、对比、审核、回滚、重启保留和测试环境标识。
重新运行 `init` 可获取新的待审核候选；可用 `--root <新的绝对目录>` 指定保存位置。
已存在目录会被拒绝，已有环境不会被覆盖。

真实页面点击与 CLI 持久化联合验证：

```powershell
npm --workspace packages/vscode-extension run test:workbench-live-ui
```

该命令新建独立测试部署，用 Chromium 加载实际 Webview HTML/脚本，通过页面批准候选
并回滚，再重启 CLI 验证账本状态。它还覆盖连接超时后的刷新、501 个版本的翻页/检索
和窄窗口布局。输出的 `screenshots` 目录包含截图与 `result.json`；可用
`CC_SETTINGS_UI_REPORT_DIRECTORY` 指定新的报告目录。自动确认只存在于此测试宿主，
实际扩展仍要求人工确认与服务端认证。IDE Extensions 工作流的 Linux、Windows、macOS
矩阵均执行该旅程并保留当前提交的截图与结果；它不替代真实 IDE 安装或生产 authority 验收。

profile 仅用于独立工作台进程，不注入聊天、其他 App Server 功能或终端环境。
清空此用户设置即可恢复原有部署。配置文件是受信任的本机启动配置，只应选择自己生成或
部署方审核过的文件；CLI 仍负责验证 descriptor 签名和模块摘要。

测试脚本仅在源码仓库可用，不随 npm CLI 发布。使用已有 TEST fixture 的公开密钥、
固定时钟、模拟真人授权与 Eval，并在 Windows 使用测试目录 fsync 适配器。
它不能作为生产身份、自动演化、模型质量或物理断电耐久性的验收结果。
生产部署仍需下文列出的真实身份、审批服务、信任根及存储资源。

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

**文件 opener 不等于一键启用。** 下述控制工厂可以组装真实 controller 与 mutation authority，但部署仍须提供实际 CandidateRegistry、principal/receipt authority、真实回执来源，以及真人身份/审核/回滚签名和当前撤销策略。`secure:false` 不是耐久性兼容开关，不会忽略 fsync 错误；Windows 测试显式使用 TEST directory-fsync 适配器，不能把这些测试当作原生 Windows 物理断电或生产文件系统验收。两个本机 reader 也不等于两个独立主机故障域。

## 真实回滚控制端口

`createEvolutionWorkbenchControlPorts(options)` 使用文件 opener 的原始 branded 返回对象，构造同一主账本 audit/nonce store 上的真实 `SkillMutationAuthority`，再构造 `SkillPromotionController`，仅返回 `rollbackProvider/authorizationProvider`。不返回 controller、通用 authorize、promote、候选 writer 或私钥。签名 evolution/serve loader 同样固定其 handler 模块摘要。

六个必填字段为 `descriptor/fileResources/candidateRegistry/principalResolver/receiptVerifier/rollbackReceiptSource`。descriptor 须与文件资源完全相同；CandidateRegistry 须为同租户的实际实例。文件资源的 JSON/浅复制对象、伪 Candidate、替换 descriptor、访问器或缺端口都拒绝。三个 authority 方法分别为固定 own `resolve/verify/resolve`；回执来源与 verifier 不得是同一对象或同一个函数。该进程内端口隔离并不证明外部 PKI 或故障域已独立部署。

回滚适配器只在重新认证已有人工 preparation 与当前 active/LKG 后，临时赋予原有 expected 对象一个不可序列化的、绑定确切主 Registry/Ledger 实例和完整 descriptor（含 run/stream/handler）的 mutation context。新控制端口必须一次性消费该上下文；裸 JSON、克隆、跨实例或跨 scope 借用、重复调用均不能申请 authority。回调结束或失败时未消费的 context 也失效。这个标记不改变既有 expected 字段或持久格式；重启后必须从真实 preparation 重新验证和生成上下文，不能从日志反序列化权限。

`rollbackReceiptSource.resolve` 收到下列只读数据；`mutation` 是尚未附回执的固定请求字段（包含新的 32 字节随机 nonce 和有效期），不是 capability：

```js
const receiptInput = {
  mutation,
  planDigest,
  authorizationReceiptDigest,
  policyReceipt,
  fromReleaseDigest,
  targetReleaseDigest,
};
```

来源必须精确返回五个非空 opaque 回执字符串：`candidateReceipt/evalReceipt/actorReceipt/parentReceipt/targetReceipt`。不能返回或替换 `policyReceipt`，也不能添加自报成功字段；实际 policy 始终来自适配器已认证的 preparation 引用和人工授权。完整六种回执交给独立的真实 principal/receipt verifier 复核，字符串或摘要本身不代表验签通过。

请求固定 rollback/active、原 active 的 CAS、当前精确 LKG 及其依赖锁/transition subject。有效期取“当前时间加 120 秒”与人工回滚授权/目标 Review 的最早期限；来源返回后及 authority 签发后都重读两组实际 active/target 并检查期限，陈旧状态或迟到回执不能得到可返回的 capability。外部异步来源的网络超时/取消由其部署适配器负责；这里的时效检查不是进程强杀或网络中断器。随后控制器的实际消费、nonce 落账和 Registry prepare/CAS/finalize 仍走原有安全边界。授权失败可能已经留下审计或人工 preparation，但不能据此声称已回滚。

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

现在可用文件与控制工厂实现上述资源函数的大部分装配。以下 `readTrustedFileResourceOptions` 和 `openDeploymentAuthorities` 仍由目标部署提供；它们不是仓库内已经实现的凭据安装器：

```js
const fileResources = factories.openEvolutionWorkbenchFileResources(
  await readTrustedFileResourceOptions({
    handlerArtifactDigest: descriptor.moduleDigest,
  }),
);
const { runtimeResources } = fileResources;
const authorities = await openDeploymentAuthorities();
const controls = factories.createEvolutionWorkbenchControlPorts({
  descriptor: runtimeResources.descriptor,
  fileResources,
  candidateRegistry: authorities.candidateRegistry,
  principalResolver: authorities.principalResolver,
  receiptVerifier: authorities.receiptVerifier,
  rollbackReceiptSource: authorities.rollbackReceiptSource,
});
const { workbenchHost } = await factories.createEvolutionWorkbenchRuntime({
  ...runtimeResources,
  ...controls,
  identityProvider: authorities.identityProvider,
  decisionVerifier: authorities.decisionVerifier,
  humanDecisionProvider: authorities.humanDecisionProvider,
  humanDecisionVerifier: authorities.humanDecisionVerifier,
  humanRollbackProvider: authorities.humanRollbackProvider,
  humanRollbackVerifier: authorities.humanRollbackVerifier,
});
```

`controls` 只提供两个治理端口，不替换 `runtimeResources` 中的存储；显式可选 invocation/Pilot 来源仍由部署配置。controller 的 capability 已固定由使用同账本 audit/nonce ports 的真实 authority 签发、消费，但仅将外部 authority 函数名写进配置不代表该部署已完成。

descriptor 签名、module/trust-root digest 与 command allowlist 验证仍由现有 loader 完成；其入口模块是按精确字节认证的单文件 ESM。目标环境需要同时设置绝对路径 `CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR` 和 `CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT`。CLI 数据目录、安全锚和工作目录必须满足现有隔离规则，不能把 `CHAINLESSCHAIN_HOME` 放在工作区里。

lazy/eager 入口会保留部署认证、资源组装及已配置宿主的注册错误，不再通过兼容重试将其隐藏为 unknown command；部署组装可能已经补记持久状态，也不能被这种回退重复调用。普通无部署的模块加载兼容行为保持不变。

## 验证边界

单元用例验证历史 preparation 审计、过期/后续晋升的待处理计划、已发生效果补账、当前撤销和错误资源拒绝。五窗口 SIGKILL 回归在新进程先调用完整启动工厂，证明它只补记实际效果；尚未实际回滚的计划随后由显式 `resume()` 处理。

真实进程用例使用公开 CLI bin、真实签名 descriptor 和实际文件存储，覆盖 CLI 审核、stdio 能力协商与回滚、重启后的相同当前投影及部署模块篡改拒绝。其身份是明确标注的签名、file-fsync TEST fixture，Ledger/witness/Eval 也为测试 authority；不代表生产真人、模型或用户 IDE 安装已验收。具体运行结果见总任务文档 §7.2。

文件资源入口回归还验证空存储不造数、旧真实晋升历史的双实例重开、当前信任撤销、默认 owner-only、缺端口/访问器/Proxy/重叠目录/junction/错误文件类型的启动拒绝。签名 CLI/stdio 测试使用该生产 opener 构造持久层，五个回滚 SIGKILL 旅程的 startup 子进程同样通过它重开；造数和外部 authority 仍清楚隔离在 TEST fixture 中。

默认环境未配置上述资源时仍必须 unavailable。未修改用户的环境变量、IDE 安装或生产密钥；GitHub、子 npm 包与插件发布门禁不因这些本地测试而放宽。
