# 火山实际任务结果与工程优化（2026-10-11）

两题使用冻结项目 `b2aa3aba082873570e85dce39b00754e5504ff37`、独立registry安装的公开CLI **0.166.97**（发行来源 `22ef588c1bb8f71c45feaa115df1d75d5ca505c5`）、火山 `deepseek-v4-flash-ga-260731` / Ark v3。20min任务期限、8min模型期限、20轮、$0.25估算stop、0retry/no fallback均保持。模型仅使用文件工具，只写该题expectedFiles，源码及已有tests只读；独立Docker验收无账户、验收阶段无网络。ignore-scripts安装不证明SQLite native。所有结果formal=false、independentHumanReview=false。

## 实际结果

| 尝试                                                                                                        | 费用题 verify-04                                                                   | Memory题 verify-22                                               |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [第一轮38112972900](https://github.com/chainlesschain/chainlesschain/actions/runs/38112972900) / bee3f0f397 | 基线22/22；HOME与config相同，模型前CONFIG_HOME_UNSAFE拒绝                          | 基线19/19；同一前置拒绝；无usage                                 |
| [第二轮38113336010](https://github.com/chainlesschain/chainlesschain/actions/runs/38113336010) / c4203749e3 | 16条usage、25对工具；12903字节候选；8min SIGKILL，无终态；候选12/14，mutants未运行 | 首次fetch failed、无usage；75字节占位，0例候选拒绝；底层原因未知 |
| 第三轮38114586541 / 5e23ef5ce0                                                                              | 4924字节候选6/6、两mutants各检出1例；原事件审计拒绝，费用语义不足                  | 7634字节候选3/4，mock未恢复即再次读取；mutants未运行             |

第三轮 [38114586541](https://github.com/chainlesschain/chainlesschain/actions/runs/38114586541) 已 completed/failure，保留公开 CLI .97 原始结果：

- **verify-04**：exit0、terminal success、12条usage、无timeout/fallback；基线22/22，候选**6/6**，两种变异分别**5pass/1fail**，Docker结构gate通过。但15个tool_use/16个tool_result导致原model审计settled=false/pass=false，原整题passed=false。额外结果是 `call_l7sb16yy86s4b0m2ems607rt` 的绝对路径write_file，exact scope在执行前正确拒绝；随后相对路径写入成功。无重复use ID，不能归因于ID复用，也不能伪造工具执行。候选未调用priceRollup或断言金额，“同总量”样本的400000 input与271000/273000 requestInput不自洽，缺少272000/+1及各缓存类型边界/逐费用分量求和，故不能声称完整费用合同通过。
- **verify-22**：exit0、terminal success、14条usage，model审计通过；基线19/19，候选**3pass/1fail**，未执行mutants，原整题passed=false。第181行在恢复fsync spy前调用exportSnapshot，loadManifest→collect→syncDirectory再次触发注入错误，导致第183行restore及后续reopen未执行。第二例固定directory-sync-completed、第四例未skip也不适用于Windows的目录同步unsupported分支。这是候选故障生命周期错误，没有证明生产Memory缺陷。

第三轮verify-04的input/output/cacheRead为134170/22742/45312，CLI估算 **$0.025785928**；verify-22为125873/40463/98816，估算 **$0.030335284000000004**；合计 **$0.056121212000000004**（显示约$0.05612），实际invoice均null。第二轮04已观察153363/40225/91904，但无terminal完整估算；第二轮22无usage不代表未收费。不能补零或把第三轮金额当作全部尝试累计账单。

三轮完整原件：[131件attempt1](./attempt1/manifest.json)、[137件attempt2](./attempt2/manifest.json)、[137件attempt3](./attempt3/manifest.json)。候选、stdout、timeout/signal、前后工作树、setup/check/receipt、baseline/candidate/mutant reporter与发行/运行来源按原始字节gzip保存，manifest绑定压缩和原始SHA256。没有以工程修正版覆盖模型产物。

## 已落实优化

1. **正式eval真实接线**：审核setup后排他创建零字节expectedFiles；用不可伪造的冻结binding传每题范围、provider/model和独立HOME/config。分别保留absent→candidate与seed→candidate diff，no-op空种子拒绝；审核允许的source可修改。child只带必要平台变量和选定provider key，剥离其他账号、fallback/NODE_OPTIONS，无共享process.env变更，checker无账户；Windows Path大小写及macOS临时目录alias由可信入口处理。运行器先loadConfig预检再付费。
2. **费用题工程回归**：[usage-pricing-context.test.js](../../../../../../packages/cli/__tests__/unit/usage-pricing-context.test.js)六例以真实一致请求经merge→priceRollup，覆盖同420000 tokens费用$5/$8.25、uncached/cacheRead/cacheCreation各272000/272001边界、正反请求顺序逐费用分量求和。隔离合并长短桶导致6/6失败，忽略缓存阈值导致4/6失败。这补齐了两轮候选的语义不足，没有回填模型成功；现有计费实现没有已证实生产缺陷。
3. **Windows CI夹具修复**：c420实际XML确认RUNNER~1临时入口引发Memory authority directory resolves elsewhere。共享Vitest globalSetup先native-realpath可信临时根，再绑定TEMP/TMP/TMPDIR，正常/setup失败/teardown失败均恢复环境。真实junction正向Memory写入和显式redirect拒绝均覆盖，生产canonical guard不放宽。其他chat/IDE/审批旧失败无独立根因原件，未补造原因；优化后四套本机CLI E2E14/14。
4. **事件关联与失败审计**：执行前拒绝不产生tool-executing，这是原authority gate的正确行为。后续工程为该拒绝增加execution_started:false，并修复single/stream headless遇到显式未知tool_use_id时回退上一调用的问题：保留原ID、不污染旧调用/计划或产生副作用STARTED。诊断仅分类preExecutionDenials与tool-settlement-unverified，原1:1 settled验收未放宽；第三轮原verdict及候选不回写。prompt补充所有mutation必须使用repo-relative path，不传具体题目答案。
5. **效率与故障生命周期**：prompt从已知文件精确搜索有限片段，最多六聚焦例，先核对API再尽早写入/读回结束；新增timeout/signal/exit、partial usage/完整性及固定失败类别。Memory测试须先记录revision/注入次数，在finally恢复mock并syncBuiltinESMExports，再export/reopen/commit；既有segmented-memory-port.test.js已覆盖post-rename fsync/gc、reopen新record/revision与stale-CAS，保留实际失败候选，不额外复制重复用例。

## 后续事件修复验证

本次增加19份后续源码/分析/回归原件，全部归档共**1082份**gzip双摘要文件。

为避免 Windows checkout 的路径长度限制，gzip 文件存入各分组的短 `objects/` 路径；manifest 的 `path` 指向存储位置，`artifactOriginalPath` 保留完整制品/来源名称。按该映射解压可恢复原目录。最长本机绝对文件路径为150字符；布局调整后1082份原始及压缩SHA256再次全部校验，候选和原始verdict字节未改。

后续事件修复新增七项回归，Windows两个完整headless套件 **171/171**；真实loop确认成功read→绝对write拒绝（原字节未改）→相对write成功。single/stream覆盖显式未知ID、已完成/待完成调用、plan/compact记录和sideeffect只started→committed，未新增被拒参数内容留存。新源码及raw reporter见[后续修复原件](./third-task-followup/manifest.json)，按工作树原字节和normalized Git blob保存，需与最终提交核对。Linux Node22.12两个完整套件同样171/171（与Windows是相同171项，不累加），首次缺Rollup解析路径的真实启动失败原件保留，仅用NODE_PATH指向已有optional后通过，未安装依赖或更换SQLite；刷新producer digest后的mapped29pass/940未选中/0fail，诊断9/9、lint/格式/diff通过，后续准确提交CI见[草稿PR #429](https://github.com/chainlesschain/chainlesschain/pull/429)，不能继承旧SHA的Strict成功。

## 补充验证与CI

[41件工程原件](./engineering/manifest.json)绑定5e23源码Git blob、diff、raw reporter、两类mutant源及旧CI XML；[9件后续E2E原件](./post-fix-e2e/manifest.json)绑定同源码四套真实CLI E2E **14/14**。原stale-map失败及刷新后mapped结果见[5件原件](./stale-map/manifest.json)。

| 本地补充                                                   | 实际结果                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| 正式接线4套 / Windows10 Node22.22.2、WSL Linux Node22.12.0 | 各73/73，真实headless允许交付并拒绝越scope                               |
| 新费用+两旧基线 / Windows                                  | 28/28                                                                    |
| 同组Linux首次                                              | 27/28；唯一失败为加载Windows SQLite binary的invalid ELF header，原件保留 |
| 新费用+session-usage / Linux                               | 18/18；未声称Linux SQLite重跑成功                                        |
| 临时根/原清理/真实teardown三套 / Windows                   | 21/21                                                                    |
| mapped security                                            | 29pass / 937未选中 / 0fail（5e23来源）                                   |
| 新诊断离线合同                                             | 9/9，result-only即使可分类仍拒绝                                         |

先前准确源码 `dc9226b577` 的[Docker run38112676784](https://github.com/chainlesschain/chainlesschain/actions/runs/38112676784)已6分片全部成功：36题、72setup/check、42行为mutants检出，阶段/receipt摘要独立核验，见[603份完整原件](./docker-pack-dc9226/manifest.json)。candidate为冻结基线+确定性controls，agentExecuted/providerAssessed/independentHumanReview=false，不能计模型任务或转移到新SHA。

准确工程源码 `5e23ef5ce0a487e775aa305bb03ba63ab76a8d9e` 的 Actions 回读时点为 **2026-10-11T05:56:08.391Z**。该提交 Strict 已完成；其余状态如下。后续事件关联修复将产生新提交，必须使用自己的准确 SHA 验证，不能继承此门。

| 工作流                                                                                                                         | 状态 / 结论         | job 计数                            |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------- | ----------------------------------- |
| [CLI CI / 38114590109](https://github.com/chainlesschain/chainlesschain/actions/runs/38114590109)                              | queued / null       | queued=54，success=8，in_progress=3 |
| [CLI Strict Sandbox / 38114589983](https://github.com/chainlesschain/chainlesschain/actions/runs/38114589983)                  | completed / success | success=5                           |
| [VERIFY01 Docker Review Pack / 38114586545](https://github.com/chainlesschain/chainlesschain/actions/runs/38114586545)         | queued / null       | success=4，queued=1，in_progress=1  |
| [VERIFY01 Volcengine Task Diagnostic / 38114586541](https://github.com/chainlesschain/chainlesschain/actions/runs/38114586541) | completed / failure | failure=1                           |

重复的同 SHA PR Docker run 38114589944 在六个 job 全部 queued 时取消，保留 push run 38114586545；取消只表示去重。

正式 **36 tasks + 9 firstRuns / NOT_RUN / observed=0**、$99、旧计划digest/冻结窗口及observations均保持。当前新启动无法取得旧窗口内完整24h观察，延长须保留旧版并新建计划版本。目标宿主、独立人工预审/辅助技术、真实invoice、IDE首次安装和8h/24h/SLO仍待完成；Astra的AI审查和GitHub Docker checker不替代独立人工。Windows/macOS durable、owner-only/LowBox合同与完整native review的NOT_ADMITTED仍开放。本轮没有新发行或合并。
