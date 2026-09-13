# 受治理的 Skill 自进化

> 适用版本：Agent Platform CLI `0.166.46`；更新：2026-09-13
>
> 适用对象：使用学习合成、Evolution Workbench、证据排序 Skill Retrieval、Desktop Skill Creator、Skill Sync 或加密知识同步的用户与管理员

> 发布状态：npm `chainlesschain@0.166.46` 是当前 `latest`，对应标签 `v-npm-0-166-46` 与提交 `b15104ebbe`。安装或升级 CLI：`npm i -g chainlesschain@0.166.46`。

> `0.166.46` 恢复未配置 evolution deployment 时的普通 Agent 聊天，并修复缓存标识绑定的隐私误报。无需为普通对话部署治理宿主；candidate、Eval、Workbench、知识合并和发布仍需要受信配置。已配置治理链的错误不会降级为普通请求，automatic active promotion 仍为 HOLD。完整变化见[发布与升级指南](/chainlesschain/agent-platform-release)。

## 概述

受治理的 Skill 自进化把学习结果先变成隔离候选，再通过评测、证据和发布事务决定是否可以进入 active。它解决旧路径中“生成成功”和“已经安装”容易混淆的问题：候选生成、内容改进、跨设备导入都不再直接覆盖正在运行的 Skill。

`0.166.21` 在既有 candidate、目标矩阵 Eval、证据投影、可检测篡改的 append-only 账本、mutation authority、promotion/release、持久 `EvolutionRun`、Wiki/Memory 和 registry transition 之上，公开了 Evolution Workbench、摘要绑定的 Skill Retrieval，以及受治理的加密知识冲突审核与合并入口。候选比较、人工批准/拒绝、回滚请求、冲突分页和合并计划现在都有 CLI/App Server 投影。

这些入口不把客户端变成 authority。Workbench 和知识审核需要部署方注入受信治理宿主；未接线时 CLI 明确失败闭合。批准只提交与确切 revision、digest 和 dependency lock 绑定的决定，发布仍由 mutation authority、CAS、账本和策略共同裁决。生产 KMS/PKI、identity、policy、witness、scheduler 与真实 grader 仍由目标部署提供，当前版本不宣称会无人值守地升级 active Skill。

`0.166.44` 将新建 Volcengine 文本配置的默认模型更新为 DeepSeek V4 Flash GA（`deepseek-v4-flash-ga-260731`）。此项更新不会修改已保存的模型设置，也不会改变本页的候选、审核、发布或 automatic promotion `HOLD` 边界。

## 如何开启：没有一个“自动进化总开关”

**CLI 默认不开启受治理的 Skill 自进化。** 安装包只默认注册命令入口；没有受信宿主时，候选生成、Workbench、知识合并和发布能力保持 unavailable。普通用户不能只在设置页打开一个开关就获得候选生成、审核和发布权限。请先区分下面三件事：

| 能力                  | 如何开启                                                                                | 开启后会发生什么                                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 学习数据与 Skill 检索 | 安装 CLI 后直接使用 `cc learning stats`、`cc learning trajectories`、`cc skill search`  | 读取已有学习记录或 Skill 索引；不会创建或激活 Skill                                                                                      |
| CLI 治理链            | 管理员同时配置签名 deployment descriptor 和 Ed25519 trust root                          | CLI 可加载部署方提供的 candidate、Eval、Review、Wiki、Memory、release 等 authority；实际可用范围由 descriptor 的命令白名单和宿主实现决定 |
| Desktop 演化工作台    | 在 CLI 治理链已配置的基础上，启动 Desktop 前设置 `CHAINLESSCHAIN_CC_APP_SERVER_PILOT=1` | 只打开 Desktop 到 `cc serve --app-server` 的固定能力通道；它本身不授予审核身份或 active 写权限                                           |

因此，`CHAINLESSCHAIN_CC_APP_SERVER_PILOT=1` 是 **Desktop 通道开关**，不是 **Skill 自动进化开关**。只设置这个变量时，Desktop 中可以看到“演化工作台”入口，但服务端仍会报告 `Evolution Workbench is not configured` 或 `a trusted deployment host is required`。反过来，只配置治理宿主而不打开 Desktop pilot，CLI 可以使用，Desktop 页面不能连接该能力。

当前没有生产用的“自动晋升 active”开关。automatic active promotion 继续保持 `HOLD`；候选通过 Eval 和人工批准后，仍要经过部署方的 mutation authority、Pilot/Canary 策略、CAS 和 release transaction 才可能进入 active。

### 管理员开启 CLI 治理链

仓库和公开 npm 包不会生成生产密钥、审核身份或 grader。管理员需要先部署一个导出 `createChainlessChainCommandDependencies()` 的单文件 ESM 宿主模块，再生成并签名 `chainlesschain.evolution-deployment-descriptor/v1` 描述文件。描述文件必须绑定模块绝对路径及 SHA-256、trust-root SHA-256、单调 revision，并按需要允许 `learning`、`evolution`、`agent`、`ask`、`chat`、`compact`、`complete`、`cowork`、`hub`、`marketplace`、`orchestrate`、`serve`、`stream`、`ui`、`desktop` 等命令。

拿到管理员提供的签名描述符和 Ed25519 公钥后，推荐使用持久化配置，不必每次设置环境变量：

```bash
cc evolution deployment configure \
  --descriptor /managed/chainlesschain/evolution-deployment.json \
  --trust-root /managed/chainlesschain/evolution-deployment-ed25519-public.pem
cc evolution deployment status
```

`configure` 会先校验 descriptor schema、签名、信任根摘要、模块摘要和绝对路径，全部通过才原子写入 `$CHAINLESSCHAIN_HOME/evolution/deployment-profile.json`（默认 `~/.chainlesschain/evolution/deployment-profile.json`，owner-only）。之后所有 `cc` 命令自动读取该配置。可用 `cc evolution deployment disable` 暂停、`enable` 恢复；这两个命令只控制本机部署宿主，不会开启自动晋升。若同时设置环境变量，环境变量优先于持久配置。

也可以从图形界面完成同一操作：

- VS Code/VSCodium：命令面板运行 **ChainlessChain: Configure Skill Evolution**。
- JetBrains：**Settings → Tools → ChainlessChain IDE → Governed Skill evolution**，或 **Tools → ChainlessChain: Configure Skill Evolution**。
- `cc ui`：左侧 **配置 → Skill 自进化**。浏览器不能替服务器选择文件，需要填写运行 `cc ui` 那台机器上的绝对路径；非回环监听必须给 `cc ui` 配置 `--token` 才允许修改。

如需由系统服务或集中配置强制覆盖本机 profile，可在启动 CLI 或 Desktop 的同一个进程环境中同时设置下面两个绝对路径。只设置其中一个会失败关闭。

Linux/macOS：

```bash
export CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR=/managed/chainlesschain/evolution-deployment.json
export CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT=/managed/chainlesschain/evolution-deployment-ed25519-public.pem

cc evolution workbench list --limit 1
```

Windows PowerShell：

```powershell
$env:CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR = "C:\ProgramData\ChainlessChain\evolution-deployment.json"
$env:CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT = "C:\ProgramData\ChainlessChain\evolution-deployment-ed25519-public.pem"

cc evolution workbench list --limit 1
```

命令返回一个有效投影（即使候选列表为空）表示 Workbench 宿主已加载。出现 `a trusted deployment host is required` 表示宿主没有加载；出现 signature、digest、revision、authority 或 ledger 错误时不要绕过校验，应由管理员修复部署。

### 开启 Desktop 页面

Desktop 还需要在应用启动前显式打开 App Server pilot，并从设置这些变量的同一个终端启动应用：

```powershell
$env:CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR = "C:\ProgramData\ChainlessChain\evolution-deployment.json"
$env:CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT = "C:\ProgramData\ChainlessChain\evolution-deployment-ed25519-public.pem"
$env:CHAINLESSCHAIN_CC_APP_SERVER_PILOT = "1"
npm run dev:desktop-vue
```

进入“AI 对话”，打开 Agent 模式后，工具栏会显示“演化工作台”“知识冲突”和“知识撤销”。Desktop 启动后再修改环境变量不会生效，需要完全退出并重新启动。生产 descriptor 若要同时支持 Desktop 自身和它启动的 App Server 子进程，命令白名单至少应包含部署实际使用的 `desktop` 与 `serve`。

当前 Desktop 设置页没有等价的生产开关；不要把测试 profile、fixture 密钥或本地 Workbench 演示脚本当作生产开启方式。

## IDE 插件如何使用 Skill 自进化

IDE 插件是 Workbench 的审阅客户端和 Skill Retrieval 的展示客户端，不是候选生成器或发布 authority。安装插件后不会自动开始学习、修改 Skill 或晋升 active。标准使用顺序是：先由 CLI/Agent/调度器产生受治理候选，再在 IDE Workbench 中查看和审核，最后由部署宿主执行 Pilot/Promotion。

### VS Code / VSCodium

VS Code 扩展提供两种互斥的 Workbench 连接方式。

首次使用先从命令面板运行 **ChainlessChain: Configure Skill Evolution**，选择管理员提供的 descriptor 与 trust root，然后点击“校验、保存并启用”。面板显示“签名校验：已通过”后，这份配置会由 CLI 持久化并与终端、JetBrains 和 `cc ui` 共享；无需让 VS Code 进程继承两个环境变量。下面的独立 Workbench profile 仍适合需要隔离 state directory、身份或环境的生产审阅席位。

#### 方式一：独立 governed Workbench profile（推荐）

由管理员提供一个 `chainlesschain.evolution-workbench-profile/v1` JSON，并在 VS Code 设置中把 `chainlesschain.evolution.workbench.profile` 指向该文件的绝对路径。也可以先运行命令面板中的 **ChainlessChain: Evolution Workbench**，在“宿主未配置”的提示中选择“配置演化工作台”，再选择该 JSON。

```json
{
  "schema": "chainlesschain.evolution-workbench-profile/v1",
  "mode": "governed",
  "cliPath": "C:\\Users\\example\\AppData\\Roaming\\npm\\node_modules\\chainlesschain\\bin\\chainlesschain.js",
  "cwd": "C:\\work\\project",
  "stateDirectory": "C:\\ProgramData\\ChainlessChain\\app-server-state",
  "env": {
    "CHAINLESSCHAIN_HOME": "C:\\ProgramData\\ChainlessChain\\cli-home",
    "CHAINLESSCHAIN_SECURITY_ANCHOR_HOME": "C:\\ProgramData\\ChainlessChain\\security-anchor",
    "CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR": "C:\\ProgramData\\ChainlessChain\\evolution-deployment.json",
    "CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT": "C:\\ProgramData\\ChainlessChain\\evolution-deployment-ed25519-public.pem"
  }
}
```

profile 中所有路径都必须是绝对路径。该模式为 Workbench 启动独立的 `cc serve --app-server` 进程，profile 内的部署环境不会注入普通 Chat、集成终端或其他 App Server 功能。`mode: "local-test"` 只用于源码测试，页面会持续显示测试标识，不能用于生产审核。

全局 npm 安装的 CLI 入口可在 PowerShell 中用 `(Join-Path (npm root -g) "chainlesschain\bin\chainlesschain.js")` 定位；应把计算后的真实绝对路径写入 profile，不能把这段命令文本直接写进 JSON。

#### 方式二：复用扩展的 App Server pilot

不设置 Workbench profile，改为在 VS Code 设置 JSON 中启用：

```json
{
  "chainlesschain.appServer.pilot.enabled": true
}
```

随后确保启动 VS Code 的进程环境已经包含 `CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR` 和 `CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT`，完全退出并重启编辑器。这个设置只打开 App Server 通道；如果 `serve` 不在 descriptor 白名单中，或宿主没有提供 `evolutionWorkbenchHost`，Workbench 仍会显示不可用。

#### VS Code 中的审核操作

1. 先打开一个工作区，再从命令面板运行 **ChainlessChain: Evolution Workbench**。
2. 首页查看连接模式、运行状态、候选数、当前 active、LKG、Pilot 和 reconciliation 状态。
3. 选择候选查看 evidence、diff、目标运行时和实际 outcome；选择两个版本进行比较。
4. `pending` 候选在宿主声明 `review` 方法时显示 Approve/Reject；填写原因并通过原生确认框。
5. 已批准、非 active 的历史版本在宿主声明 `rollback` 且存在当前 active 时显示回滚操作。
6. 操作后等待页面重新读取状态；响应超时不等于失败，不要在未刷新确认前重复提交。

运行 **ChainlessChain: Skill Library (Browse & Search)** 可以查看 Skill 来源、版本、摘要及 Retrieval 证据。它只调用 `skill list/search`，不会创建候选、执行 Skill 或授予权限。

### JetBrains IDE

JetBrains 插件直接在当前项目目录执行固定的 `cc evolution workbench ... --json` 命令，并提供共享配置入口。打开 **Settings → Tools → ChainlessChain IDE**，点击 **Governed Skill evolution**，选择 descriptor 与 trust root，再点击“校验、保存并启用”；也可直接使用 **Tools → ChainlessChain: Configure Skill Evolution**。保存成功后不必重启 IDE。

1. 在配置窗口确认 effective 为 enabled、signature 为 verified，并确保 descriptor 允许 `evolution`。
2. 在 IDE 集成终端先运行 `cc evolution workbench list --limit 1`。返回有效投影后再打开图形界面；若这里失败，插件也不会绕过 CLI 校验。
3. 从 **Tools → ChainlessChain：演化工作台** 打开候选表格。使用 Refresh、Evidence / Diff、Compare selected、Approve、Reject 和 Rollback to selected；变更操作都会再次要求原因和确认。
4. 从 **Tools → ChainlessChain：检索技能** 打开 Skill Retrieval。该入口只展示 digest-bound 搜索结果，不执行或安装 Skill。

JetBrains 没有 VS Code 的 `chainlesschain.appServer.pilot.enabled` 要求，因为 Workbench 当前走固定 CLI 子命令，而不是插件 App Server pilot。可视化配置只保存 descriptor 与公钥路径，不保存治理私钥、审核身份或 authority。

### 从 IDE 产生一个待审核候选

两个 IDE 的 Workbench 都不会主动运行合成器。需要在具备 `learning` authority 的环境中显式执行：

```bash
cc learning trajectories --limit 20
cc learning synthesize --json
```

然后回到 Workbench 刷新。VS Code 如果只配置了独立 Workbench profile，其 profile 环境与集成终端隔离；此时应由管理员的学习作业产生候选，或在集成终端另行配置同一受信 descriptor/trust root。不要把 profile 中的测试身份或密钥复制到普通 Chat/终端。

### IDE 常见状态

| 提示或现象                                  | 含义                                            | 处理                                                                   |
| ------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------- |
| `requires the CC App Server pilot`          | VS Code 未配置独立 profile，且通用 pilot 关闭   | 配置 governed profile，或启用 `chainlesschain.appServer.pilot.enabled` |
| `deployment has no governed Workbench host` | 通道已启动，但 CLI 部署没有 Workbench authority | 管理员检查 descriptor 白名单、签名和宿主导出                           |
| 页面只有列表，没有批准/回滚按钮             | 宿主只声明了 `list`，或候选状态不允许该动作     | 以服务端 capability 为准，不要尝试绕过                                 |
| `LOCAL TEST`                                | 当前使用测试 profile、测试身份和测试数据        | 仅用于开发验证，不作生产审核                                           |
| `no candidate versions` / 空列表            | 宿主可用，但当前投影没有候选                    | 先通过受治理学习/同步/Release Train 产生候选，再刷新                   |
| JetBrains 显示 unavailable 或 timed out     | 固定 CLI 命令失败、超时或投影在读取期间变化     | 在集成终端运行同一 `cc evolution workbench list` 诊断，修复后刷新      |

## 什么时候会触发 Skill 自进化

“触发”分为证据采集、候选生成和晋升三个不同阶段，不能把其中一个阶段的成功当成整条链已经完成：

1. **证据采集**：受信 evolution composition 已注入时，Agent/Chat/Cowork/Graph 的真实运行可在模型调用、工具调用和最终结果边界写入 Raw、`EvolutionRun`、结构化 Memory 和 outcome receipt。未注入宿主时不会偷偷启用这条生产证据链。
2. **Wiki 维护**：经过认证的 Agent 完成事件或 `SchedulerStore` 成功 occurrence 可以生成 Wiki maintenance trigger。失败、取消、来源不明或缺少 trigger authority 的运行不会成为可信 Wiki 更新。
3. **候选生成**：普通 CLI 的明确入口是 `cc learning synthesize`；Desktop Skill Creator、Skill Sync、市场安装或部署方 Release Train 也可以显式提出候选。默认学习合成器只扫描“已完成、尚未合成、工具调用数不少于 5、outcome score 不低于 0.7”的 trajectory，并要求至少 2 条工具集合相似度不低于 0.5 的相似轨迹；部署宿主可以收紧或调整这些阈值。LLM、隔离 candidate store、独立 evaluator 或 active roots 任一缺失时返回 `LEARNING_SYNTHESIS_UNAVAILABLE`。
4. **Eval 与 Review**：候选创建后才会进入目标矩阵 Eval 和人工审核；缺 cell、receipt、grader、安全检查或当前 revision 时停在 `needs-more-evidence`、`rejected` 或 `pending`。
5. **Pilot 与晋升**：批准不等于激活。只有部署方显式执行并通过 shadow/canary、mutation authority、CAS、release 和结算后，状态才可能变成 `active`；当前公开安装不会无人值守自动执行这一步。

最常见的手动触发方式是：

```bash
cc learning trajectories --limit 20
cc learning reflect
cc learning synthesize --json
cc evolution workbench list --status pending --limit 20
```

成功结果中的 `created` 只表示隔离候选已经评测并持久化，不表示它已安装或启用。

## 如何审核候选

审核时建议按“内容与来源 → 运行边界 → Eval → 实际效果 → 决策”的顺序检查：

1. 用 `workbench list` 找到 `pending` 项，记录 `packetDigest`、`candidateContentDigest` 和当前 active/LKG。
2. 用 `workbench compare` 查看候选与 active/LKG 的精确 diff；同时核对来源 trajectory/Wiki revision、dependency lock、runtime、permission/capability 和目标矩阵。
3. 核对所有必需 Eval cell、grader/safety/verifier receipt，以及真实 outcome 中的成功率、失败/阻断、成本和延迟。模型自评不能代替确定性测试。
4. 证据完整时提交 `approve`；证据不足或权限扩大不可接受时提交 `reject`。必须填写具体原因，决定只对当前 packet digest 和 revision 有效。
5. 批准后继续观察 Pilot/Canary；发生回归时，只能回滚到 Workbench 允许且受信 Registry 仍确认的 LKG/已批准版本。

```bash
cc evolution workbench compare <active-packet-digest> <candidate-packet-digest>
cc evolution workbench review approve <candidate-packet-digest> --reason "已核对来源、权限、目标矩阵和回归结果"
# 或
cc evolution workbench review reject <candidate-packet-digest> --reason "缺少 Windows cell 和安全回归证据"
```

Desktop 中的“演化工作台”提供相同的列表、证据/Diff、比较、批准、拒绝和回滚动作；按钮只是向 CLI 权威提交摘要绑定的请求，Desktop 不持有 active writer。

## 生成的 Skill、Wiki 和证据存放在哪里

生产部署没有一个可由普通用户随意指定的统一 `wiki/` 或 `skills/` 目录。真实路径由受信部署宿主固定，并与 tenant、文件身份、账本和 witness 绑定；Workbench 默认只暴露 digest 和受限 artifact reference，不暴露可被客户端改写的任意路径。

| 数据                              | 默认或典型位置                                                                                                                            | 说明                                                                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI 可执行的 active Skill         | `cc skill sources --json` 返回的各层；通常是 `$CHAINLESSCHAIN_HOME/skills`（managed）和 `<项目>/.chainlesschain/skills`（workspace）      | 这是运行时 Skill 搜索层，不是演化候选区。默认 `CHAINLESSCHAIN_HOME` 为用户目录下 `.chainlesschain`                                              |
| 内容寻址 Skill candidate          | 库默认根为 `$CHAINLESSCHAIN_HOME/evolution/registry/candidates/tenants/<tenant-key>/`，文件名为候选 SHA-256 的 JSON；生产宿主可覆盖根目录 | candidate JSON 包含规范化 Skill 内容和绑定信息；不能把该目录加入 active 搜索路径                                                                |
| `cc learning synthesize` 文件候选 | 部署宿主指定的 `candidateOutputDir/<skill-name>/1.0.0/SKILL.md`，并可包含 `EVALUATION.json`                                               | `candidateOutputDir` 是宿主必填项，公共 CLI 没有固定默认值，也没有面向普通用户的覆盖开关                                                        |
| Release、active 与 LKG            | 库默认根为 `$CHAINLESSCHAIN_HOME/evolution/registry/releases/tenants/<tenant-key>/`；生产 Workbench 使用宿主指定的 `releaseRootDir`       | release 内容、active 指针、journal 分开保存，并通过 CAS/ledger 结算                                                                             |
| Wiki revision                     | 宿主指定的 ArtifactStore 与 EvolutionLedger 中                                                                                            | Wiki 是带 schema、revision、来源和 tombstone 的治理制品，不保证对应一个可直接编辑的 Markdown 文件                                               |
| Raw、投影与账本                   | 典型运行布局为 `<stateRootDir>/<url-encoded tenantId>/<url-encoded runId>/raw`、`artifacts`、`ledger-events`、`ledger-authority` 和 `witness/checkpoint.json` | `stateRootDir` 由生产 composition 指定，没有公共默认值；`raw/` 是仅存外部 encryptor 生成的密文的 ArtifactStore，明文 Raw 不落盘。model-visible/trusted projection 与 Wiki revision 位于 `artifacts/`，但不等于 Raw 副本 |
| 正式 Active governed Skill        | 部署宿主提供的一个或多个绝对 `activeSkillsDirs`                                                                                              | 没有固定默认目录；candidate 不会自动复制到 Active root。必须先完成 Eval、人工审核、Pilot/Canary、CAS 和 release authority 才能写入。普通 managed/workspace Skill 目录不能据此视作治理 Active release |
| Desktop 普通 managed Skill        | Electron `app.getPath("userData")/skills`                                                                                                 | 这是 Desktop 的现有 Skill 层。Skill Creator 返回 `candidateOnly: true` 或 Skill Sync 返回 `candidate-staged` 时，不代表内容已写入或激活到该目录 |

定位 active Skill 时可以运行：

```bash
cc skill sources --json
```

定位治理数据时，应查看目标部署模块传给 `openEvolutionWorkbenchFileResources()` 和 Agent evolution composition 的 `artifactDir`、`ledgerRootDir`、`ledgerAuthorityRootDir`、`witnessFilePath`、`releaseRootDir`、`stateRootDir`、`candidateOutputDir` 与 `activeSkillsDirs`。没有签名 deployment descriptor/trust root 或 status 显示 unavailable 时，机器上不存在可据此推断的 Evolution Raw/Wiki/Active 运行目录；不要把 `~/.chainlesschain/artifacts` 当作已启用的 Raw/Wiki 库。不要直接修改这些文件；任何脱离 ledger、receipt 和 CAS 的手工复制都不会构成合法晋升，并可能导致后续验证失败。

## 0.166.23–0.166.24：恢复、撤销与候选安装

- **工作台恢复**：审核、回滚计划与真实结果持久保存。宿主启动时核验当前 Registry，并补记已发生而未结算的效果；尚未执行的计划保持 deferred，不自动续批审批或切换 active。CLI 返回 `workbenchHost`，App Server 使用 `evolutionWorkbenchHost`。
- **撤销来源**：对 Knowledge 的直接来源、历史 Wiki 和跨 Wiki 多级来源做认证追踪；受影响的 Skill 回滚、候选处置和指定 Wiki tombstone 分别留下效果证据，再完成联合结算。重新启动或重复请求不会让已撤销来源重新晋升。
- **隔离与拒绝**：`quarantine` 是独立候选处置，保留隔离状态及原因；`reject` 表示拒绝该候选，`rollback` 针对已经发布的 Skill，`tombstone` 针对受影响的 Wiki 来源状态。不能把这几种结果当作同一成功状态，也不能把 tombstone 当成磁盘或备份物理擦除证明。
- **持久 Wiki 与模型边界**：剪枝计划、checkpoint、检索投影和依赖影响可重放；模型入口只接受经过验证的投影，长文本有界处理，结构化 JSON 中的敏感信息同样脱敏。
- **市场候选**：签名清单与精确摘要固定后才写入真实候选文件；`candidate-staged / activated:false` 表示待审核。后续 shadow/canary/active 每步都需要新状态摘要及独立回执，详见[CLI 技能市场](/chainlesschain/cli-marketplace)。

管理员必须同时配置签名部署描述文件和信任根。文件资源与控制端口工厂已提供，但真实人工身份、签名/撤销规则、policy、账本见证及目标环境验收仍由部署负责。VS Code `0.37.87` 会先核对 Workbench 能力并提供页面化只读入口；未配置宿主时显示不可用。JetBrains 公共 `0.4.113` 继续只消费 CLI-owned 投影，其内置推荐 CLI 为 `0.166.29`。

## 核心特性

- 自动生成和改进只写隔离候选或返回 diff，active Skill 保持不变。
- 缺少 LLM、候选存储、评测器或 active roots 时明确返回 unavailable。
- 候选绑定 Skill/版本/内容摘要、依赖锁、运行时、权限和目标矩阵。
- target、grader、safety、supervisor 与 verifier 分权，缺少任一必要 receipt 即失败。
- 所有目标矩阵 cell 必须合取通过，不能用平均分掩盖缺失平台或负迁移。
- release、active、last-known-good 与 rollback 使用 lease、CAS、journal 和 recovery。
- append-only `EvolutionLedger` 提供签名链、witness、receipt 与 subject-bound 状态转换。
- candidate/release registry 绑定 tenant 与真实文件身份，拒绝链接逃逸和跨租户复用。
- CLI Agent 的交互、单轮 headless、stream headless 和 `AgentRuntime` 可在宿主启用后，于模型/工具继续执行前持久确认 `EvolutionRun` 事件。
- Wiki revision、Memory event/snapshot、human-review packet/decision 与 registry transition 复用 ArtifactPorts + Ledger，可在响应丢失或进程重启后按同一 digest 恢复。
- Agent 完成和 `SchedulerStore` 成功 occurrence 可由独立 authority 生成 Wiki 维护触发；客户端不能替换触发来源或 composition。
- 旧 Phase 100 simulator 与不可达 IPC 已退役；历史公式训练只保留 metrics，不再显示为真实训练或 active mutation。
- Session Core `0.3.12` 已公开共享 `EvolvableArtifact` 协议，CLI 提供 Skill/Prompt/Hook/Knowledge 的持久发布与依赖重验基础。Desktop 源码中的 Prompt、Hook、Skill Sync 与市场入口先写候选，执行时只读取验证后的 active release；npm 更新不会升级 Electron 安装包。Hook 还需代码签名、SBOM、沙箱、网络出口策略及高风险审批。
- Evolution Workbench 可列出候选、比较 revision、提交 approve/reject 决定和 rollback 请求；CLI、Desktop、VS Code 与 JetBrains 消费同一受治理投影。
- `cc skill search` 对 bundled、marketplace、managed 与 workspace Skill 做摘要绑定的混合检索，验证后的结果和 outcome evidence 优先。
- 加密知识同步只输出删节冲突投影；合并计划经过认证、签名，并绑定基线、vector clock 与依赖处置，在 crash/response-loss 恢复后才可发布 canonical record。
- review、merge、revocation 与 settlement 都以可回读信任账本绑定确切 subject，避免旧授权或旧回执被换用于新状态。

## 系统架构

```text
Trajectory / Skill Creator / Skill Sync
                 │
                 ▼
       candidate-only boundary
                 │
                 ▼
      Tenant Candidate Registry
          │               │
          ▼               ▼
 Target-matrix Eval   Evidence Projector
          │               │
          └───────┬───────┘
                  ▼
         EvolutionLedger
                  │
                  ▼
 Mutation Authority + Promotion CAS
                  │
          Release / Active / LKG
```

生成器没有 active 写权限，评测器没有发布写权限，同步 peer 也没有晋升权限。只有受信宿主组合完整证据与当前 active revision 后，才能调用 promotion/release 原语。

## 四阶段应该怎样理解

外部材料把演化概括为 Mutation、Selection、Promotion 和 Stabilization，这个方向可以借鉴，但在当前产品中必须按下面的治理语义理解：

| 阶段          | 可借鉴的做法                                                    | `0.166.21` 的真实边界                                                                                                                                                                                |
| ------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mutation      | 从重复失败、成功模式和用户纠正中提出一个聚焦改动                | 只能生成单 Skill candidate 或 diff；一次失败不会直接改 active，provider/MCP/sandbox/权限故障也不能被误记为 Skill 缺陷                                                                                |
| Selection     | 在隔离环境使用独立 grader、隐藏 holdout、安全门和目标运行时矩阵 | 仓库已有进程 Eval supervisor、隔离 target 与持久子回执；目标部署仍须提供真实 runner/grader、终止权限和版本化回归集，不能据此声称已执行全部历史测试                                                   |
| Promotion     | 先 Shadow，再以稳定 cohort 做 Canary，越界立即回滚              | 仓库已有统计门、progressive canary traffic worker 和外部 watchdog；实际流量及运营密钥仍由部署方接入。`1%` 不是固定规则；低流量使用固定 N 个显式 cohort，高流量才按风险和统计功效使用预注册百分比阶梯 |
| Stabilization | 把发布结果和回滚影响作为持久知识，供下一轮复用                  | 一次晋升只新增 evidence，不自动成为“真理”；需要独立结果、观察窗口和多来源佐证后，Wiki pattern 才能从 hypothesis 变为 corroborated/actionable                                                         |

因此，“可控”在这里指变更制品可版本化、可审计、可失败关闭，不代表 LLM 行为、第三方工具或已经发生的外部副作用绝对可控。回滚可以恢复受管 Skill 的 active/LKG 指针，但不能自动撤销已发送的网络请求、已写入的外部数据库或 SaaS 操作。

## WikiSkill 论文数据怎么读

> **Provenance：`external-paper-only / HOLD`。** 以下数字不得生成 ChainlessChain 产品性能声明；只有通过仓库 benchmark truth gate 的可信签名报告才能切换为 `chainlesschain-measured / VERIFIED`。

以下数字来自 [WikiSkill 论文](https://arxiv.org/html/2608.27454) Table 1 的五个 benchmark 等权平均，是外部研究结果，不是 ChainlessChain 实测或性能承诺：

| 模型                 | No skill | WikiSkill | 相对自身提升 | 相对 Qwen-3.6-27B No skill `39.4%` |
| -------------------- | -------: | --------: | -----------: | ---------------------------------: |
| Qwen-3.5-4B-Instruct |  `26.2%` |   `38.5%` |    `+12.3pp` |                           `-0.9pp` |
| Qwen-3.5-9B-Instruct |  `29.9%` |   `47.4%` |    `+17.5pp` |                           `+8.0pp` |
| Qwen-3.6-27B         |  `39.4%` |   `63.3%` |    `+23.9pp` |                          `+23.9pp` |

流传摘要中的“Qwen-4B + WikiSkill `33.3%`、相对 27B 裸模型 `-6.1pp`”是抄录错误，正确值为 `38.5%` 和 `-0.9pp`。论文结果是三次完整演化运行的平均，并使用 paired bootstrap 做显著性检验；论文没有提供官方代码仓库、逐题原始结果和完整运行环境，因此只能用于说明研究趋势。ChainlessChain 在固定模型、数据集、seed、runner、prompt/Skill digest、逐题 receipt 和 exact Git SHA 完成独立复现前，不会把这些数字当作自身 benchmark。

## 快速开始

查看学习数据：

```bash
cc learning stats
cc learning trajectories --limit 20
cc learning reflect
```

尝试合成候选：

```bash
cc learning synthesize
cc learning synthesize --json
```

默认 CLI bootstrap 不伪造 candidate evaluator、生产 candidate store 或演化 authority。依赖未由可信宿主注入时，命令会以非零状态返回 `LEARNING_SYNTHESIS_UNAVAILABLE`；这表示自动写入被安全阻断，不表示 active Skill 损坏。

检查 Agent 能力和安装是否完整：

```bash
cc --version
cc agent --capabilities
```

`0.166.21` 的公共安装应能加载 `agent`、`evolution workbench`、`evolution knowledge` 与 `skill search` 命令；命令存在不代表当前宿主已启用 active promotion 或知识合并 authority。

## Evolution Workbench 与知识冲突审核

```bash
# 只读候选和差异
cc evolution workbench list --status pending --limit 20
cc evolution workbench compare <left-packet-digest> <right-packet-digest>

# 精确 revision 上提交治理决定；服务端 authority 最终裁决
cc evolution workbench review approve <review-packet-digest> --reason "评测与证据已复核"
cc evolution workbench review reject <review-packet-digest> --reason "证据不足"
cc evolution workbench rollback <from-packet-digest> <to-packet-digest> \
  --reason "canary 指标退化"

# 分页查看删节后的知识冲突，并提交摘要绑定的合并计划
cc evolution knowledge conflicts --cursor 0 --limit 20
cc evolution knowledge merge <conflict-envelope-digest> \
  --record '<canonical-record-json>' \
  --reason "已复核双方来源与撤销依赖"
```

以上变更命令必须连接 branded trusted deployment host。缺少宿主时会返回 `a trusted deployment host is required`，不会退回本地文件直写。冲突列表不返回原始明文、密钥材料或可复用 authority；Desktop/IDE 也只能提交投影中明确允许的动作。

## 证据排序的 Skill Retrieval

```bash
cc skill search "审阅 Spring Boot 安全配置"
cc skill search "知识冲突合并" --source managed --limit 8
cc skill search "browser automation" --source bundled --category automation --tag browser --json
```

`--source` 可取 `bundled`、`marketplace`、`managed` 或 `workspace`，`--limit` 为 `1..64`。候选始终绑定 canonical digest；只有部署方配置并通过验证的 outcome/vector/index authority 才会提供相应证据并参与排序，未配置时会明确报告 unavailable，而不是伪造见证。检索命中本身不会安装、激活或晋升 Skill。

## 使用示例

CI 中应同时检查进程退出码和 JSON `status`：

```powershell
cc learning synthesize --json
if ($LASTEXITCODE -ne 0) {
  Write-Error "候选合成不可用或失败；不要继续发布"
}
```

成功结果中的 `created` 只表示候选已经过 evaluator 并持久化到隔离候选区。它仍不是 active Skill。Desktop Skill Creator 返回 `candidateOnly: true`、`persisted: false`、`activeMutation: false` 时，只应展示为“待审阅候选”。

## 配置参考

当前公开 CLI 没有稳定的 candidate/promotion 配置文件。可信宿主构造合成器或改进器时必须提供以下边界；普通用户不应自行伪造：

| 依赖                                | 用途                                                     | 缺失结果                        |
| ----------------------------------- | -------------------------------------------------------- | ------------------------------- |
| LLM callable                        | 从 trajectory 提取单 Skill 模式                          | unavailable                     |
| candidate output registry           | 隔离持久化不可变候选                                     | unavailable                     |
| candidate evaluator                 | 对内容和证据做独立判定                                   | unavailable                     |
| active Skill roots                  | 证明候选目录不与 active 树重叠                           | unavailable                     |
| tenant authority/marker             | 隔离候选与 release namespace                             | fail closed                     |
| durable ledger/release adapters     | 跨进程持久证据和 CAS 状态                                | promotion HOLD                  |
| KMS/PKI + witness                   | 加密、签名、撤销和独立账本见证                           | composition unavailable         |
| review identity/policy              | 认证人工决定、quorum 与风险确认                          | active mutation denied          |
| scheduler/transition authority      | 认证 trigger 与 registry 状态事件                        | maintenance/transition disabled |
| target runner/grader                | 执行真实平台 cell 和独立判定                             | matrix `needs-more-evidence`    |
| trusted Workbench host              | 校验 revision、review packet、rollback target 与可用动作 | Workbench unavailable           |
| knowledge KMS/PKI + merge authority | 解密、验签、撤销依赖结算与 canonical merge               | knowledge review unavailable    |

## 管理员接线与恢复检查

`CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR` 与 `CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT` 必须同时指向绝对路径，描述文件固定模块摘要、信任根摘要、版本和命令 allowlist；环境变量仅选择已签名部署，不能授予权限。

启动恢复报告的 `reviewsSettled` / `rollbacksSettled` 是已核验并补账的效果数；`reviewPreparationsDeferred` / `rollbackPlansDeferred` 是已保存但尚无效果的计划数。对后者应先核对当前状态和有效授权，再显式恢复。签名撤销、陈旧状态或账本损坏时停止变更并保留证据。

部署接口详见[Workbench 启动合同](https://github.com/chainlesschain/chainlesschain/blob/main/docs/EVOLUTION_WORKBENCH_STARTUP.md)。

## 状态与结果

| 状态                 | 含义                           | 是否改变 active    |
| -------------------- | ------------------------------ | ------------------ |
| `completed`          | 返回项已评测并持久化为隔离候选 | 否                 |
| `candidate-proposed` | 返回内存候选、文件集合或 diff  | 否                 |
| `diff-only`          | 只提供内容差异                 | 否                 |
| `unavailable`        | 缺少必需的可信依赖             | 否                 |
| `error`              | 生成、评测、持久化或审计失败   | 否                 |
| `validated`          | 基础原语已确认候选证据完整     | 否，仍需 promotion |
| `active`             | 仅受信发布事务可以形成         | 是                 |

## 性能指标

目标矩阵评测按 cell 独立执行并受全 run deadline、settlement 上限和资源回收约束；安全性优先于吞吐。当前仓库测试验证 10,000 task / 64 worker 的 Team 调度门与大量治理单元场景，但这不是 Skill 自动晋级的生产 SLA。真实 P50/P95 必须绑定模型、grader、OS/arch、工具版本、样本数和 exact release SHA。

## 测试覆盖

- Candidate、release 与 promotion：租户隔离、摘要绑定、lease/CAS、journal/recovery、LKG/rollback。
- Eval Gate：角色分权、签名 receipt、deadline、撤销、后验校验、hard termination 边界。
- Target matrix：signed plan、reserve/finalize、完整 child receipt、有序摘要根与 all-cell conjunction。
- Ledger/artifact ports：append-only hash chain、witness、回读绑定、篡改和 schema 拒绝。
- Ingress：CLI REPL/headless/stream/`AgentRuntime`、canonical Graph 和 legacy WebSocket 的 pre-model/pre-tool 持久确认。
- Wiki/Memory/review：CAS、幂等恢复、四层 authority、PostCompact、人工 quorum 与 content-risk acknowledgement。
- Migration/transition：旧 candidate/release/state ledger journal、启动 reconciliation、故障阶段恢复和 durable registry request/attempt/settlement。
- Desktop：Skill Creator candidate-only、Skill Sync candidate store、Phase 16 metrics wiring 与 legacy simulator 退役。
- Typed artifacts：共享 Skill/Prompt/Hook/Knowledge schema、类型隔离 policy/authority、Prompt/Hook candidate gate、Hook 高风险硬门与依赖 stale 级联；stale 制品只能以新 dependency lock 和 revalidation receipt 生成候选，不能原地恢复；Skill Sync 成功结果已强制进入共享 Skill gate，旧 Skill-only store 只作为 tenant-bound 持久后端，knowledge 统一 adapter 尚待收口。
- Workbench/Retrieval：候选比较、陈旧 revision、批准/拒绝/回滚、canonical digest、索引 witness、来源过滤与 verified outcome 排序。
- Governed knowledge：密文冲突删节、认证 merge plan、Ed25519/AES-256-GCM、撤销依赖结算、响应丢失和进程重启恢复。
- 路径安全：canonical ancestor alias、leaf link、父目录逃逸与 marketplace fail-closed 路径。

本地测试通过不能替代发布提交自己的 Linux、Windows、macOS CI 与 Strict Sandbox 门禁。

## 安全考虑

- 不要把 candidate 目录加入 active Skill 搜索路径。
- 不要通过复制文件绕过 promotion；这样会丢失内容摘要、授权、评测、policy 和 active revision 绑定。
- candidate/release root 必须是受信目录，叶节点不能是符号链接或重解析跳转。
- 评测结果必须绑定同一 tenant、candidate、依赖锁、runtime manifest、target matrix 和 grader identity。
- Ledger 缺失、断链、witness 不一致或 transition subject 不匹配时必须拒绝发布。
- 同步导入内容默认是不受信 candidate；peer 身份不能变成 active-layer authority。

### 已安装 CLI 的部署宿主装载

公开 npm CLI 的 lazy/eager 入口支持由管理员装载目标部署宿主。部署必须同时设置绝对路径
`CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR` 与
`CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT`。描述符使用
`chainlesschain.evolution-deployment-descriptor/v1`，以 Ed25519 签名固定 revision、单文件 ESM
宿主路径及 SHA-256、trust-root SHA-256 和 `agent/evolution/serve` 命令白名单。宿主必须导出
`createChainlessChainCommandDependencies()` 并返回各命令需要的 branded authority；调用上下文按命令提供 Workbench、knowledge review 与 Agent composition 的窄内置 factory，使已验签模块无需重新导入可变包文件也能取得 CLI 自身的不可伪造品牌。CLI 直接执行已验签的模块字节，避免摘要校验后的路径替换窗口。

这只是安全装载入口，不会生成生产身份或密钥。描述符/信任根只配置一项、签名或摘要漂移、导出缺失，或目标 KMS/PKI/Ledger/witness/identity authority 不完整时，Workbench 继续显示 unavailable，且不会回退测试密钥、内存 store 或客户端自报权限。

## 故障排查

| 现象/错误                                     | 原因                                                  | 处理                                                            |
| --------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------- |
| `LEARNING_SYNTHESIS_UNAVAILABLE`              | 缺 LLM、candidate registry、evaluator 或 active roots | 使用提供完整受信依赖的宿主；不要手工安装候选                    |
| `candidate-output-overlaps-active-skill-tree` | 候选目录与 active 根重叠                              | 改用独立、owner-private 的候选根                                |
| candidate persistence failed                  | 回读摘要、schema、文件身份或 tenant 绑定不一致        | 保留证据并检查 adapter/文件系统，不要重试晋升                   |
| matrix `needs-more-evidence` / rejected       | 缺 cell、receipt 或真实 grader 未通过                 | 补齐同一计划的目标证据后重新评测                                |
| revision/CAS conflict                         | active 已被另一事务更新                               | 重新读取当前 revision，重新评测并审批                           |
| ledger verify failed                          | 日志断链、签名/witness 或 subject 不一致              | 停止发布，使用可信备份和审计流程恢复                            |
| `unknown command 'agent'`                     | 安装了存在依赖导出缺口的 `0.166.18`                   | 从官方 npm registry 升级到 `0.166.21` 后重试                    |
| `a trusted deployment host is required`       | Workbench 或知识审核未接入受信部署宿主                | 保持失败闭合；由管理员接线 identity/policy/ledger/KMS authority |
| search result digest/witness mismatch         | Skill 索引记录与 canonical 内容或见证不一致           | 丢弃结果并重建/回填受信索引，不要安装该 Skill                   |
| capability 显示未接线                         | 宿主未注入 branded production composition             | 保持关闭；由管理员配置生产 authority，勿使用测试密钥绕过        |

## 关键文件

- `packages/cli/src/lib/evolution/skill-candidate-registry.js`
- `packages/cli/src/lib/evolution/evolution-eval-gate.js`
- `packages/cli/src/lib/evolution/skill-target-matrix-eval.js`
- `packages/cli/src/lib/evolution/evolution-evidence-projector.js`
- `packages/cli/src/lib/evolution/evolution-ledger.js`
- `packages/cli/src/lib/evolution/agent-evolution-runtime-composition.js`
- `packages/cli/src/lib/evolution/evolution-run-ledger-adapter.js`
- `packages/cli/src/lib/evolution/evidence-backed-wiki-maintainer.js`
- `packages/cli/src/lib/evolution/wiki-maintainer-ledger-adapter.js`
- `packages/cli/src/lib/evolution/structured-memory-agent-control-plane.js`
- `packages/cli/src/lib/evolution/skill-promotion-review-ledger-adapter.js`
- `packages/cli/src/lib/evolution/skill-registry-transition-ledger-adapter.js`
- `packages/cli/src/lib/evolution/skill-mutation-authority.js`
- `packages/cli/src/lib/evolution/skill-promotion-controller.js`
- `packages/cli/src/lib/evolution/skill-release-registry.js`
- `packages/cli/src/commands/evolution-workbench.js`
- `packages/cli/src/commands/evolution-knowledge.js`
- `packages/cli/src/commands/skill.js`
- `packages/cli/src/lib/evolution/evolution-workbench-projection.js`
- `packages/cli/src/lib/evolution/governed-knowledge-review-host.js`
- `packages/cli/src/lib/skill-retrieval-router.js`
- `packages/cli/src/lib/skill-outcome-authority.js`
- `packages/cli/src/lib/evolution/skill-outcome-index-authority.js`
- `packages/cli/src/lib/skill-vector-authority.js`
- `packages/cli/src/lib/skill-vector-process-authority.js`
- `packages/cli/src/lib/learning/skill-synthesizer.js`
- `desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/skill-creator/handler.js`
- `desktop-app-vue/src/main/ai-engine/cowork/skills/skill-sync-manager.js`

## 最佳实践与限制

- 把 candidate 视为待审代码：查看 diff、来源、反例、权限和目标矩阵后再决定下一步。
- 使用确定性测试与独立 grader；模型自评不能替代退出码、产物哈希和真实 UI 状态。
- 任何 permission、policy、model、tool、grader 或 dependency lock 变化都应使旧 approval/Eval cache 失效。
- 当前 Workbench 提供统一的 review/rollback 请求入口，但它不是客户端自有 promotion authority，也没有承诺自动 active mutation 或 canary；仓库文件持久化与重启恢复不替代目标环境的生产 PKI/KMS、跨主机 witness 和灾备验收。

## 后续优化路线

当前优先补齐的是已有治理原语的生产纵切，而不是再增加一个平行“自进化”模块：

1. 建立可复现 benchmark 与文案 truth gate，严格分开外部论文结果和本项目实测。
2. 用同一个签名 EvolutionPlan 串起证据触发、Wiki、单 Skill candidate、真实 Eval、人工审阅、Pilot、发布和 Wiki impact。
3. 部署真实 Linux/Windows/macOS runner、独立 grader/safety/verifier、版本化 regression corpus 和进程级 hard kill。
4. 让 Pilot 成为 promotion 必经门，增加稳定分桶、同期 baseline、统计置信门、渐进 Canary、外部 watchdog 和 `ACTIVE_PROBATION → STABLE`。
5. 把 reject/rollback/revoke 结果反向传播到 Wiki、Memory、检索索引和 marketplace badge，避免旧知识继续参与决策。
6. 在不降低类型专属安全门的前提下，逐步把 Prompt、Hook 和 Knowledge 接入与 Skill 一致的不可变 candidate/evidence/review/release 协议。
7. 为公共 CLI 装载真实 branded deployment host，并完成 KMS/HSM、PKI/身份、独立 witness、流量 authority、灾备和 kill-switch 演练。

详细任务、状态与验收标准见仓库 `docs/AGENT_SELF_EVOLUTION_GAP_ANALYSIS_2026-09-01.md`。完成目标部署验收前，production auto-promotion 继续保持 HOLD。

## 相关文档

- [受治理的 Skill 自进化设计](/design/modules/112-governed-skill-evolution-design)
- [自进化 AI 系统](/chainlesschain/self-evolving-ai)
- [自进化 CLI 命令](/chainlesschain/cli-evolution)
- [Skill Creator](/chainlesschain/skill-creator)
- [Desktop Graph 调试与 Skill 安全](/chainlesschain/desktop-graph-skill-security)
- [Agent Platform 发布与证据边界](/chainlesschain/agent-platform-release)
