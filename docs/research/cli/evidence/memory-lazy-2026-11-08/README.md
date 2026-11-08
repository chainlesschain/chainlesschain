# Memory 按需倒排与混合基准续作

日期：2026-11-08。观测基线 `74f8df309ee69741003fab426ae30bb50514505a`；Windows x64，基准与后续 Vitest 使用 Node **22.20.0**。无产品侧付费模型调用，不授予发行或生产准入。原始JSON与关键源码以gzip保留原字节，见[清单](./manifest.json)与[离线校验器](./verify-evidence.mjs)。

完成的9个实现 / 测试 / CI文件现已提交并由既有post-commit推送GitHub：`884dfffcff06924291725dcc332220773561dc5d`，分支 `feature/cli-ide-memory-validation-20261108`。远端ref及与已验证源码的逐文件字节对照已核对；以下原始报告仍保留各自测量身份，运行中验收不计入提交完成范围。

后续 `07287a51c00b8d336e65a7324ba0777dea590525` 延迟加载无RAG时不用的NLP依赖；`8ffcbd8f8d4b5dc88d585d0c2ec0e57ed0b1ee03` 修复真实GUI工作目录隔离、原子阶段回执和有界收尾。均经正常门禁由仓库钩子推送同一功能分支；原始测量身份不移用到后续提交，准确提交的跨平台CI仍另行验收。

## 已完成的工程验证

- 原生 Node 回归 **43/43**，无跳过：Memory 按需倒排、真实进程恢复和桌面安装器。该次使用 Node 24.12.0，命令见下文。
- [Memory 组合回归](./raw/memory-integration-tests.json.gz)：Node 22.20.0，**10 文件、115 通过、1 跳过**。覆盖索引、bundle、损坏恢复、解码缓存、代际隔离及取消；跳过项是 Windows 不适用的目录 fsync 故障注入，不算通过。
- [混合基准检查点最终回归](./raw/mixed-checkpoint-tests-final.json.gz)：Node 22.20.0，**8/8**。覆盖真实八进程成功、第二轮 worker 在 ready 前终止、最终审计失败、源码绑定变化、证据写失败、业务成功 / 失败后的清理失败和既有输出拒绝覆盖。[修正路径后的首次8/8](./raw/mixed-checkpoint-tests-fixed.json.gz)另存。
- [检查点回归首次失败](./raw/mixed-checkpoint-tests-before-path-fix.json.gz)：**7/8**，唯一失败来自测试按 cwd 定位 CLI 脚本；已改为相对 `import.meta.url` 定位。保留原报告，不覆盖失败身份。
- 修复后的 `npm run postinstall --workspace desktop-app-vue` 已退出 **0**。这证明 npm lifecycle 接线，不等于完整锁定安装、Electron / SQLite ABI 或产品 GUI 已通过。
- [真实Electron原生预检首轮](./raw/encrypted-electron-probe.json.gz)失败：加密SQLite模块ABI137，Electron要求140；按现有 `dmm-native-goal-workspace.yml` 使用 `prebuild-install --runtime=electron --target=39.8.10` 安装对应预编译件，退出0。[修复后预检](./raw/encrypted-electron-probe-fixed.json.gz) **10/10检查通过**：真实加密项目、无密钥拒绝、Graph结果、幂等、存储域隔离、关闭不复活和显式重开等。范围为Electron39.8.10、内置Node22.22.1、ABI140、加密SQLite12.11.1的合成宿主；未覆盖登录、renderer或原生确认GUI。

混合基准现在逐轮原子保存已验证结果；只有最终全量审计、源码一致性和临时目录清理均成功后，整体 `complete` 才为 true。超时仍为每个 worker 自 fork 起 **120 秒**，八进程及重叠 / 代际 / 删除 / 全量审计断言不变。报告新增 spawn、ready、dispatch、result、close 时间与失败阶段。运行阶段内部的锁等待、bundle 重建和归一化耗时仍需另行定位。夹具生成器改为仅由父进程动态加载，不再让 worker 导入无关的后台运行时模块。

## 性能测量与剩余场景

[首批冷 / 热原始报告](./raw/query100.json.gz) `complete:false`，进程退出 **1**。1K 冷 / 热、10K 冷 / 热、100K 冷各保存了100个结果，但运行中工作区 `memory-query-control.js` 出现另一项取消让步改动，组间源码一致性检查拒绝继续执行100K热组。

报告初始该文件 SHA-256 为 `8ed862b2f44187e2019bb51e5be767fd0ba28573b14a87647a4380fd167bd259`，终止时为 `e3687ae0c03273064eebd3c7160107c83af7402eae39435ba0d80b4320c626bc`。已保存的500个样本不能构成同一固定源码的完整600次测量或当前工作树 SLO；不据此宣布性能目标达标。原始失败不重写为成功，工作区取消改动保留。

后续采用忽略目录中的 CLI 源码 / 脚本与 Context/Memory Kernel 冻结副本，[位置与实际Kernel解析路径](./raw/frozen-runtime.json.gz)单列。首次启动因副本遗漏Kernel schema而退出1，补齐schema与inventory后已开始新测量。`import.meta.resolve`及物理realpath确认Kernel来自冻结副本；其他已安装依赖仍沿工作区解析，未声称冻结完整依赖闭包。开始执行及进程存活均不计为测量通过。冷 / 热、重建 / 损坏、混合并发各场景100次和 Stop、组合过滤、跨平台与真实 IDE 验收仍按实际完整回执更新。

[冻结副本冷 / 热报告](./raw/query100-frozen.json.gz)已退出0，`complete:true`；再次逐条读取报告核对，**600/600**结果数20且摘要匹配相应规模全量参考，六组各100次。源码摘要组间及结束检查通过，默认 `validate-disk / bundle`，100K每次仍读取8,831,462字节的选中authority。

| 记录数 | 冷 p95（ms） | 热 p95（ms） |
| ------ | ------------ | ------------ |
| 1K     | 45.446       | 21.563       |
| 10K    | 80.748       | 23.584       |
| 100K   | 393.375      | 44.448       |

该范围满足本机列表冷<1秒、热<200ms的候选目标。计时排除导入及夹具构造，冷指新Node进程而非清空OS缓存；工作站同时进行桌面构建，不是受控单因素性能比较。不能把与历史`.131`的差异全部归因于按需倒排，也不代表全部过滤器、语义召回或完整Memory SLO。原始报告保留事件循环延迟、RSS、堆、读取次数和全部样本；本批没有逐样本独立哈希全部authority物理文件。

08:14本地再次核对工作区时，取消检查点文件已回到 `8ed862b2…`，而冻结副本保留测量时的 `e3687ae0…`（额外的32次工作量让步候选）。保留并行工作区变动，不将冻结候选成绩移用到当前工作区。是否采用该候选及最终源码的性能 / Stop结论，仍须在明确的最终实现上复验。

重建 / 损坏、Stop与混合队列已退出0，[阶段终态](./raw/validation-queue.json.gz)和[逐项审计](./raw/frozen-candidate-audit.json.gz)均已核对：重建 / 损坏六组各100次，共600/600匹配全量参考；两种缓存模式、三档各100次Stop，共600/600取消、锁释放，无迟到成功；混合三档各100轮，共300轮、2400个进程操作、1800次变更提交，均通过代际核对及各档最终全量记录 / 事件审计。

| 记录数 | 重建p95（ms） | 损坏恢复p95（ms） | 混合读取p95（ms） | 混合锁等待p95（ms） |
| ------ | ------------- | ----------------- | ----------------- | ------------------- |
| 1K     | 761.003       | 803.025           | 901.254           | 740                 |
| 10K    | 1159.207      | 1048.382          | 1096.550          | 850                 |
| 100K   | 4652.038      | 4455.164          | 2086.161          | 1479                |

混合正确性通过不代表混合延迟目标通过；没有设置恢复 / 混合性能准入阈值。Stop的authority不变检查仅比较每组前后的manifest原字节，不是逐时刻哈希全部物理分片。上述结果均属于保留 `e3687ae0…` 工作量让步的冻结候选；当前 `8ed862b2…` 检查点、最终源码、跨平台、真实IDE与语义质量仍须各自验证。

## 永久记忆加载与实际Windows组合GUI

[加载前](./raw/module-load-before.json.gz)与[加载后](./raw/module-load-after.json.gz)使用相同Node22宿主和真实Electron，只require模块、不构造manager：永久记忆模块从20517ms变为13ms；加载后没有Hybrid/BM25/natural事件。此为单次模块对照，未宣称同等比例的产品启动收益。有RAG时依赖加载异常仍传播，原构造参数和构造失败处理保留；启动合同4/4、[永久记忆及检索功能回归](./raw/permanent-memory-functional-tests.json.gz)83/83通过。

旧GUI有一次未处理Playwright超时，未留下旅程JSON；随后[原工作目录诊断](./raw/workspace-gui-diagnostic-20261108.json.gz)和[只改NLP加载后的诊断](./raw/workspace-gui-lazy-20261108.json.gz)均因180秒无窗口失败，未回填为成功。检查发现原runner以开发工作区为cwd，可能迁移已有 `.chainlesschain` 配置。现以独立profile为cwd，并在真实Electron中断言物理路径；不改变30秒launch、180秒firstWindow、原生确认、业务断言或10分钟watchdog。

新runner原子保存阶段与失败回执；诊断5秒、关闭15秒分别有界，保存失败不会跳过清理。公开错误只保留安全分类，完整driver堆栈留在私有profile，避免附带应用Call log。安装 / 启动 / 观察组合17/17通过，Astra最终只读复审无阻断。

[实际GUI最终报告](./raw/workspace-gui-isolated-20261108.json.gz)已退出0，[独立审计](./raw/workspace-gui-audit.json.gz)核对：真实密码/DID登录、3次原生确认、记忆创建 / 修正 / 撤权 / 取消及确认删除、无正文操作历史、通知中心已读 / 授权深链 / 去重 / 静默检查均通过；实际Stop观察 **70088ms**，检查次数及历史不变，正常关闭。3个IPC错误分别是未准入扩展、结束后的Goal、显式Stop负例的预期拒绝，原记录保留。

该通过仅是本机Windows、源码构建、真实Electron / Vue / 加密SQLite的合成场景；不代表真实业务、已安装产品或其他平台。quietHours只验证设置持久化，没有修改时钟或观察实际跨夜投递。历史36/45、付费readiness、正式NOT_RUN与发行准入均不改变。

## Astra 只读审查

用户授权后使用 Astra 只读审查，未修改源码或发送产品侧付费模型请求。其独立内存探针从 `git HEAD` 加载原 compiler，对9字段 × 13替换值和6种整行替换共 **123** 个畸形输入比较异常类别及五类 postings，报告一致；这不替代磁盘损坏或 schema / descriptor 专项回归。

审查未发现当前端口接线削弱 authority 校验；公共结果为 authority 记录的独立克隆。内部索引行若被直接修改，lazy / eager 构建时机会产生不同结果，故索引必须继续由宿主内部持有。多条件首次查询可能重复遍历，尚需专门测量。混合检查点的清理时机和 worker 终止测试竞态已按审查修复，最终复审未发现新阻断项。

## 复验入口

离线核对50份归档、18个关键源码绑定、所有采样和GUI关键状态，不重跑基准、不调用网络：

```powershell
node docs/research/cli/evidence/memory-lazy-2026-11-08/verify-evidence.mjs
```

```powershell
node --test packages/cli/test-node/memory-lazy-postings.node-test.mjs desktop-app-vue/scripts/__tests__/install-electron.test.mjs packages/cli/test-node/context-memory-kernel.node-test.mjs
```

从 `packages/cli` 执行：

```powershell
node ../../node_modules/vitest/vitest.mjs run __tests__/integration/memory-mixed-checkpoints.test.js
node scripts/memory-mixed-concurrency-benchmark.mjs --counts 1000,10000,100000 --rounds 100 --output <新的报告路径>
```

第二条是最终源码应使用的独立基准入口；本页冻结候选已经完成其限定测量，不能从8项工程回归推导其他源码已通过。失败后检查 `failure.stage`、`failure.worker`、`activeRound` 和已保存 `rounds`；只有 `complete:true` 且相应tier最终审计通过，才有该范围的完整回执。
