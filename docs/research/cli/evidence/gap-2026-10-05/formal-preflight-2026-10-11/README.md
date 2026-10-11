# 正式 36+9 优先执行预检（2026-10-11）

用户提出先做正式 36 项任务与 9 项首次安装旅程。本轮完成只读预检和首批选择，尚未运行模型任务或安装旅程。冻结计划、36+9 分母、99 USD 上限和 observations 不变；正式执行仍为 `NOT_RUN`，observed=0。

## 本轮实际结果

| 检查                       | 结果                                                                                                                 | 对启动的影响                                                                |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 冻结计划与目录             | 校验成功，36 tasks / 9 firstRuns；指纹仍为 `sha256:665a5254c32a9a267cec5e5c85ccb52f938cd0884470546a92f58fae5dcf87a0` | 无需重新选题                                                                |
| 既有 Linux review pack     | 全部 36 项配置及 72 个 setup/check 文件摘要通过只读 collection 校验；退出 2，observed=0                              | 摘要一致不代表独立人工预审或实际项目 checkout 验证                          |
| WSL 系统与运行时           | Ubuntu 24.04.3 LTS / x86_64 / Node 22.12.0                                                                           | 可作为 Linux CLI 首批候选；WSL 1 不证明完整宿主准入                         |
| Linux Docker               | 命令退出 1，实际提示该 WSL 1 distro 无法使用 Docker，需要 WSL 2 与 Docker Desktop integration                        | 当前机器不能运行现有 Linux Docker 验收包                                    |
| Windows 本机               | Windows 10.0.19045 / x64 / Node 22.22.2                                                                              | 不符合计划的 Windows 11 24H2 / Node 22.12.0，不能代替 Windows 正式宿主      |
| 冻结项目对象               | `git cat-file -t b2aa3aba082873570e85dce39b00754e5504ff37` 返回 commit                                               | 只证明对象存在；还需独立 checkout 及实际 HEAD 核对                          |
| 模型、费用、人工及其他机器 | 可用性未验证，现有 pack 的 `independentHumanReview:false`                                                            | 启动前取得受控账号注入、精确模型/端点、可靠费用计量或硬额度、预审与目标宿主 |

已有 Linux Docker 的 36/36 验收器与 42 个反例结果见[历史 CI 回读](../verify01-docker-ci-6196/tasks-readback.json)。其成功不转移为本机 Docker 可用性、独立人工预审或模型任务成功。Windows/macOS 的 native review 继续按既有阻塞分别处理，不要求 Linux 候选等待其全部工程工作完成。

## 首批范围与执行顺序

资源满足后先做 Linux CLI：普通任务 `verify-04`、`verify-22`（Volcengine）及 `verify-13`、`verify-31`（OpenAI），另独立执行 `first-run-linux-cli`。该首批最多 11 USD（4×2 + 3），占用原 99 USD 总上限，不是新增额度。每项上限包含最多一次补救重试；不同 provider 必须分开调用普通 CLI suite，首次旅程必须走独立五阶段采集。

先落实 Linux Docker 操作者、冻结 review 的独立预审和外部摘要、账号与费用控制，再准备冻结项目 checkout 和绑定来源的公开安装。普通任务保存真实协议终态、完整 diff、独立 check 与实际 usage/账单；首次旅程保存 `install → configure → authenticate → tool → artifact` 回执。随后分别推进 Linux 两 IDE、符合要求的 Windows 11 三入口及 macOS 15 arm64 三入口；真实 IDE 提示提交、tab 切换和 reload 恢复仍为必需。完整九入口与 45 个样本映射见[预检清单](./retry/readiness.json)。

原冻结窗口结束于 **2026-10-12 00:00 UTC / 北京时间 10 月 12 日 08:00**。本轮预检时剩余不足 24 小时；现在开始的运行不能取得窗口内完整 24h 观察。可以分别保留窗口内的真实任务及不足时长，但若延长窗口或调整冻结约束，必须在新执行前创建新计划版本及指纹，保留旧计划缺失分母，不覆盖历史结果。

## 回执范围

[成功重跑清单](./retry/manifest.json)绑定本轮系统探测、plan validation、collection 与 Git 对象检查的完整 stdout/stderr，以及[结构化结果](./retry/readiness.json)。collection 只读取 review、核对字节及声明，没有执行 setup/check；`--project-sha` 在此命令中仅为声明。费用、安装真实性、正式身份和独立人工预审均未由该检查认证。

首次沙箱内的 Node 子进程 WSL 调用实际返回 `Wsl/Service/CreateInstance/E_ACCESS_DENIED`；该次[清单](./manifest.json)和结果保留在本目录根部。首次脚本以 UTF-8 解码 WSL 的 UTF-16 错误，因此根部 WSL stdout 是有损记录，不作为系统身份原件。获得沙箱外只读执行批准后，重跑将原始字节保存于 `retry/`；四项身份探测退出 0，Docker 自身退出 1。未改变 WSL 版本、Docker 配置或系统状态，也未调用付费 provider。
