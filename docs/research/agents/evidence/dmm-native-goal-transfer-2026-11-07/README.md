# CLI 与 Windows 原生目标移交旅程（2026-11-07）

最终功能脚本在 `947f861886a7592753dc4d2de362413c8f0320e6` 上退出 **0 / passed**，见 [journey.json](./journey.json)。真实 Electron 主进程/preload、生产 Vue renderer、实际 DID/密码登录、原生文件选择和确认，以及真实 CLI binary 串联完成移交、签名回退和拒绝覆盖新修订的旅程。首次设置完成标志由 fixture 准备；数据来自每次新建的临时个人项目和 CLI 根，未复制真实用户配置。没有替换 dialog、审批、IPC、数据库、签名、CLI 或时钟。

本批仅新增真实 GUI/CLI 验收和 CI 约束，没有修改业务授权或发行版本。草稿 [#543](https://github.com/chainlesschain/chainlesschain/pull/543) 依赖 [#542](https://github.com/chainlesschain/chainlesschain/pull/542)；移交实现源自 [#539](https://github.com/chainlesschain/chainlesschain/pull/539)。公开 CLI/IDE .143 不包含这批新增源码，必须使用相同源码的 CLI、Session Core 与桌面构建复跑。

## 实际通过的场景

- 先对实际保存和打开选择器做前置探针：把错误默认名称改为预期文件名，核对 Electron 返回的实际路径，再允许业务导出。探针不保存业务文件。
- 原生取消凭据导出后没有文件或目标记录；确认后只准备一个绑定当前项目/归属/公钥的凭据。
- 真实 CLI 创建源目标、冻结并导出。保留 [原始备份](./original-backup.json)；源文件不可见，后续 CLI 写入被 `GOAL_TRANSFER_FROZEN` 拒绝。
- 原生取消导入不写项目目标、不解冻来源。确认后保留原 ID/revision/digest 映射与 key results，新目标保持 paused；动作、授权、记忆、触发器为空，completion=null。重复选取同一移交文件并确认后仍只有一个目标。
- 原生取消作废不产生回执或删除目标。确认作废后才保存 [签名回执](./cancellation.json)，来源仍冻结。修改一个签名字节且保留合法 Base64 格式时，真实 CLI 拒绝 `GOAL_TRANSFER_CANCELLATION_INVALID`。
- 真实 CLI 凭正确回执恢复 [源文件](./restored-source.json)，与原始备份字节、SHA-256 完全相同；原生作废历史和原始备份保留。见 [恢复后界面](./restored.png)。
- 原生重新导出 [同一持久回执](./cancellation-reexport.json)，字节与原回执一致，已恢复的来源不变化。
- 第二个独立合成来源导入后，通过实际 Vue“重新启用目标”按钮建立新 revision。再次经过原生回退确认，主进程返回 `GOAL_TRANSFER_ROLLBACK_HAS_CHANGES`；不签发文件、不移除项目目标，CLI 来源仍冻结。见 [拒绝后界面](./rollback-refused.png)。此负例刻意保留在临时 profile，不伪造恢复成功。

该旅程包含 **22 份业务原生窗口操作回执、2 次选择器前置探针和 9 次真实 CLI 命令**，分别记录取消、正常结果和预期拒绝。它不是 954 项 unit/integration 的新增计数，也不与旧 790、870、954 等重叠批次相加。

## 文件选择驱动的失败与修正

最初对跨进程 Edit 使用 GetWindowText/SetWindowText，读到的是窗口标题缓存，实际选择器仍沿用默认文件名。[首次失败](./failed-caption-cache.json)整体返回 failed；误存到工作区的本轮合成公开凭据经项目 ID 核对后移回其临时诊断目录，没有提交进仓库。另保留 [初始化期间输入不完整](./failed-picker-readiness.json)和 [打开框控件 ID 不同](./failed-open-control.json)的失败记录。

最终驱动只匹配实际 Electron PID、精确标题和 `#32770`；等待唯一可见、启用的文件名 Edit 就绪，保存框使用 1001，打开框使用 1148。通过 WM_CHAR 输入、跨进程 WM_GETTEXT 读取实际控件值，再点击唯一启用按钮；不使用全局键盘输入、标题缓存或选择器返回替身。正文确认仍在同一 HWND 上通过 UI Automation 核对完整合成提议，再执行实际 BM_CLICK。文件路径必须属于本次临时目录，保存不覆盖已有文件。前置探针和业务实际落盘/回读共同防止再把缓存文本误当成选定路径。

## 已归档的父批远端证据

`parent-ci/` 保存准确源码 **1fa51166b6391b178f8ceba75526b42b349bccf6** 的 GitHub 原始报告、工作流快照、制品信息和 [run 状态](./parent-ci/runs.json)：

- [DMM Project Host 42280378044](https://github.com/chainlesschain/chainlesschain/actions/runs/42280378044)：Linux、Windows、macOS 全部 success。每平台桌面 402、renderer 292、完整组织配置 338；排除组织/桌面重复用例后，每平台为 **52 个文件、954 项通过，0 失败、0 跳过**。不将跨平台相同用例再次相加。
- [DMM Native Goal Journey 42280378063](https://github.com/chainlesschain/chainlesschain/actions/runs/42280378063)：实际 Windows 构建、登录、原生创建/修改、风险/血缘、独立验收拒绝和真实 70 秒停止观察成功，见 [原始 GUI 报告](./parent-ci/goal-journey.json)。

该 GUI 报告明确记录 `M package-lock.json`：旧共享安装动作包含额外 npm install，不能将这次工程通过描述为锁文件完全不变，或用来批准新 SHA/发行。本批两个原生工作流分别对根与桌面执行 npm ci，在运行时准备/构建前后拒绝 tracked source/index 漂移，保留 Windows TEMP 真实路径规范化。新的严格工作流必须重新通过；父批结果不替代它们。

## 复跑与限制

已存在完整主进程/preload 和生产 renderer 构建；本批测试代码没有改变它们的业务源码。运行时 Electron 39.8.10、Node 22.22.1、ABI 140；执行器 Node 22.22.2。实际安装包、安装/首次设置向导和整体数据库回滚未在此验收。

```powershell
node desktop-app-vue/scripts/project-goal-transfer-native-journey.mjs --electron <Electron可执行文件> --output <新的输出目录>
node docs/research/agents/evidence/dmm-native-goal-transfer-2026-11-07/verify-evidence.mjs
```

先按锁文件准备匹配 Electron ABI 的驱动并完成 main/preload 与生产 renderer 构建。脚本设 10 分钟看门狗；失败保存报告/截图并退出 1。原始应用日志、随机登录密码、私钥和数据库留在本地临时 profile，不公开。复核器只核对归档报告、源码摘要和已发生的断言，不重新运行应用或测试。历史批次复核需使用其标明的源码快照，不能要求旧工作流摘要匹配后续改进后的文件。

源码 `947f861886` 候选的远端观察快照见 `remote-checks.json`；后续结果以对应 head 的 GitHub 检查为准，不把父提交的绿灯当成当前门禁。独立真实业务样本/效果、Linux/macOS GUI、IDE/扩展组合、客户端安装升级/迁移/回退、真实生产来源与 72 份签名回执仍未验收。这里只回退未使用的导入目标，拒绝覆盖新修订/活动，不代表整个项目数据库或已安装客户端可安全降级。没有发布新包，总体目标仍进行中。
