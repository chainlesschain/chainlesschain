# CLI 0.166.98 与配对 IDE 候选准备（2026-10-11）

用户已明确授权测试成功后发布 CLI 和 IDE 插件。候选为 Session Core **0.3.19** → CLI **0.166.98** → VS Code **0.37.142** / JetBrains **0.4.160**；准确提交的完整 Actions 发布门尚待完成，当前没有新发行或合并。

首次火山旅程原失败及 b015 的 201 份原件保留在[独立实测归档](../../first-run-2026-10-11/live-postmortem/README.md)。本增量不覆盖该归档；不回填模型成功，不产生正式 observations。

## 从实际任务继续优化

- 有限预算提示改为可信尾部临时消息，避免每轮变化的计数打断 OpenAI-compatible 稳定 conversation 前缀。真实 chatWithTools + stub fetch 检查火山序列化 HTTP 请求：旧消息前缀和工具 schema 保持、剩余次数 1→0、旧预算不累积、tool ID 保留。此回归无网络和账户，不证明实际缓存命中率或省费；Anthropic 合并所有 system 为同一块，仍有动态 system 缓存限制。
- 旧 UserPromptExpansion 测试把最后消息当作 user，九套首轮出现 **521 pass / 1 fail**。测试改为直接检查最后 user 中的原有 expanded prompt、hook context、policy note，保留原功能断言。安全映射 producer 摘要同步更新。此前两个四分钟超时且无 JSON reporter 的运行原件也保留，不能计为通过或断言其根因只是负载。
- 初始 VS 单位套件 **259 pass / 1 fail / 260 tests**：Windows PowerShell CIM 快照超过原 10 秒期限，原断言仍要求 launcher cleanup deadline。受控单进程夹具持续持有 IPC；独立所有者清理回执保留。新增 afterEach 仅 SIGKILL 本测试直接创建的 fixture，五秒未 close 则拒绝；disconnect/unref 只避免失败时无限等待，不算退出确认。没有修改生产期限或原断言。初始完整 TAP 未保存，本归档只保留明确标识的历史工具观察，不冒充完整原件。
- JetBrains 首次因默认 Java 17 找不到所需 21 toolchain，在测试前失败；显式复用已有 JDK **21.0.12.1+1** 后测试和 buildPlugin 成功，保留 setup 边界，未修改生产 Java 要求。初始完整 Gradle stdout 未保存，同样只作历史工具观察。
- 唯一变更的 npm 子包为 Session Core 私有存储诊断，升为 **0.3.19**，CLI 精确依赖和 lock 对齐；其他子包须依准确源码及公开字节核验后沿用。IDE manifest、Doctor 推荐 CLI、Java 常量及版本合同同步。

## 实际验证

| 验证                  | 结果与范围                                                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| CLI 九套最终回归      | Windows owner Node22.22.2、WSL Linux固定Node22.12.0 各 **522/522**，零 skip；同一用例不跨平台累加                                   |
| 新增集成文件单独回归  | 两平台各 **36/36**；最终九套已包含它                                                                                                |
| VS controlled cleanup | 最终 owner **3/3**，完整原始 TAP 在 process.json                                                                                    |
| VS 完整单位套件       | owner **260/260**，零 skip，完整原始 TAP 保存                                                                                       |
| JetBrains JDK21       | **955 tests / 0 failures / 0 errors / 3 skipped**，113 份 JUnit XML；test 与 buildPlugin 成功，不代表 GUI/ARM64 实际宿主门          |
| 格式与生成检查        | Prettier、ESLint（0 errors，22既有warnings）、command manifest、help index、completions、IDE manifest、JetBrains metadata 共7项通过 |
| Web Panel             | 本机隔离构建exit0、4079 modules；完整构建stdout未保存，Actions必须从准确源码重新生成并校验发行包                                    |

[manifest](./manifest.json) 保存 **159份 gzip 双摘要**，23份 normalized 源码/元数据 snapshot；源集合指纹 **sha256:56ff44af1a6e08cbcf6ba5e6a59d697c3a9853f3d27d4822428713a6d3fed4b9**。本机 WSL 使用已有 Linux Rollup optional 解析目录和固定 Node PATH，没有安装新依赖或更换 SQLite。最终提交须逐项与 Git blob 核对，不能将父提交的 CI 成功移给候选。

发布必须在最终准确 SHA 的 **CLI CI、CLI Strict Sandbox、IDE Extensions、独立 ARM64** 完整矩阵通过后，用既有 GitHub Actions OIDC 发布子包/CLI并公开回读，再发布 IDE；JetBrains upload/pending 与 approved/listed/downloadable 分开记录。未授权合并。

正式 **36 tasks + 9 firstRuns / NOT_RUN / observed=0 / $99** 与冻结计划指纹保持；优化之后尚未再次付费实跑。独立人工预审/外部锁、可靠invoice/硬额度、目标GUI/辅助技术、8h/24h/SLO、Windows/macOS durable/owner-only/native review仍开放。旧窗口北京时间10月12日08:00截止，延长须新版本。
