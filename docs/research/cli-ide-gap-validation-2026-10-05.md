# CLI / IDE 差距续做：Actions 修复与身份诊断

本记录补充两份 2026-10-05 审计的实施结果，保留原审计和历史发布的各自源码时点。本轮直接修改 `main`；本机 Docker 不可用，实际容器验收交由 GitHub Actions 执行。

## 1. Docker review pack 权限修复

[VERIFY01 Docker Review Pack #37303181923](https://github.com/chainlesschain/chainlesschain/actions/runs/37303181923) 的准确源码为 `07a383c906add37eae2067a1e20b41bbd22ded2d`。六分片均在 setup 失败；下载的第 4 分片六项原始回执显示 locked dependency installation failed，实际 npm 退出码 243，错误为 `EACCES: mkdir /workspace/node_modules`。合并提交 `ae6adbe13c` 的[后续运行 #37304444663](https://github.com/chainlesschain/chainlesschain/actions/runs/37304444663) 也失败。

Node 官方镜像默认使用 root；验收器使用 `--cap-drop ALL`，该 root 无法越过 runner 用户拥有的 bind mount 权限。修复提交 `feda6d1eeee84330a8c22e48b4fc98c419f833e8` 让安装和测试容器都使用 Linux 操作者真实的 `process.getuid()/process.getgid()`，并将身份写入阶段回执。UID/GID 必须是 `0..0xfffffffe` 的整数，缺失、字符串、负数、分数和越界值均拒绝。

容器根文件系统保持只读，setup 仅工作区可写；check 的工作区与控制目录均只读、断网。继续移除全部 capabilities、启用 no-new-privileges、使用限时 watchdog 与既有资源限制，没有增加权限或修改工作区所有权。Astra 只读复核确认该方案适用于 GitHub 标准 rootful Docker runner；启用 user namespace remapping 的自建宿主需要单独验证。

本地 Windows / Node 22.22.2 / Vitest 4.1.10 的两个相关文件 **10/10 通过**，定向 ESLint 与 Prettier 检查通过。WSL 补验启动因恢复后的缓存缺少 Linux native binding 失败，没有产生新的 Linux 通过结果。

该提交的[六分片运行 #37308413469](https://github.com/chainlesschain/chainlesschain/actions/runs/37308413469) 全部结束为失败，但原始回执确认安装权限问题已解决，部分题已完成 setup/check 与行为反例。六份原始 ZIP 与 GitHub artifact digest 逐份一致，见[失败材料回读](./cli/evidence/gap-2026-10-05/verify01-docker-ci-feda/readback.json)。未将该次失败覆盖为成功。

第二轮修复提交 `49d36bc06e65969b7f1dbf665e1ef585b84c4b81` 包含：

- 官方 Node 22.12.0 bookworm 完整镜像，提供冻结权限测试调用的真实 Git；工作流仍按实际 image ID 固定容器。
- CLI 与 root 的完整锁定依赖安装，补齐冻结 DOM 测试需要的 happy-dom。继续 `--ignore-scripts`，仅显式调用锁定的 SQLite prebuild installer；实际内存查询验证及原生文件字节摘要写入回执。WSL / Node 22.12.0 的独立安装与查询补验通过，该结果不代表本机 Docker 可用。
- 精确识别 Vitest `rejects/resolves` 序列化为 Error 的断言失配，同时要求实际 matcher 栈。真实子进程的三种 Promise 断言分别接受，普通应用错误、加载异常、skip/空测试仍拒绝。
- 保留基线完整执行，并为实际漏检的行为反例增加可执行控制。verify-07 的原基线在游标反例下进入同步死循环；该题候选使用有限次分页直接断言边界，基线仍在 setup/check 单独完整执行，两个原反例不变，未扩大 timeout。
- 文档题使用明确短句要求缺失样本不得报告 PASS，仍运行真实 fingerprint 与空报告退出码检查。

三个定向 Windows 测试文件 **21/21 通过**，格式、定向 ESLint 与 diff 检查通过；冻结主模块及原始反例的补充测试均通过，其中 headless approval 的完整冻结源码本地控制为正常实现通过、原 `pending.resolve(true)` 反例触发 AssertionError。主模块补验不替代完整 frozen Docker 环境。

准确提交的[第二轮六分片运行 #37312209419](https://github.com/chainlesschain/chainlesschain/actions/runs/37312209419) 已触发，完整结果待回读；当前不能标记整包成功。

## 2. JetBrains 身份旅程

真实 Windows IntelliJ 2024.2 / 插件 0.4.152 的同一 IDE 进程完成八阶段诊断：有效 CLI、显式错误路径且存在 managed fallback、修复显式路径、同路径替换为 GCC、PATH 上 GCC、四个命令别名均缺失、managed fallback、安装到 PATH 后无需重启恢复。两次手动更新也显示正确的身份失败原因。

该诊断只使用本地命令 fixture，没有发送模型请求、运行 agent 任务或安装公开产品。[安全归档与回读](./ide/evidence/gap-2026-10-05/onboarding-identity-windows/readback.json) 包含 29 份原始文件，其中 10 张截图限定 IDE/对话框；前两次失败尝试的整桌面截图不公开，前三次失败原因和清理结果分别保留。最终回执绑定 `ae6adbe13c` 加 dirty 工作区及逐文件字节摘要，五份源码摘要与当前文件一致；不能将其描述为干净提交的 CI 或首次公开安装样本。实际 IDE 正常退出，Gradle owner exit 0、taskkill 未使用、已记录进程身份均已消失。

## 3. 仍需独立完成的任务

| 项目                      | 当前证据与剩余条件                                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| MODEL-03 / PERF-02        | 模型、价格、reasoning 与 usage 工程合同已实现；真实目标账号、usage、账单及估算器校准仍未执行                           |
| VERIFY-02 / VERIFY-IDE-02 | 36 题 setup/check、42 行为反例及双 IDE 采集已有实现；Docker 整包成功、独立人工审阅、正式 provider 与公开安装样本仍开放 |
| PLATFORM-02 / NET-02      | 显式 Linux controlled-host 已接通；Windows/macOS durable 权限存储、持久网络撤销与崩溃恢复仍缺后端实现                  |
| IDE-ONBOARD-02            | 本地真实 Windows 宿主身份诊断通过；Linux/macOS 对应旅程及公开安装来源仍需验证                                          |
| IDE-COLD-02               | 120 秒有界等待及迟到 init 不补发已有合同；真实慢初始化、永不 init 与 Stop 竞态的 GUI 旅程仍需补验                      |
| 辅助技术与性能            | 真实宿主语义/性能采集存在；NVDA、VoiceOver、Orca 真人听测、8h/24h 观察与获批 SLO 仍开放                                |
| CLOUD-02                  | 完整跨机器 resume 仍为需求条件项，现有 self-hosted handoff 不承担该支持声明                                            |

只读冻结计划回读仍为 `executionStatus:NOT_RUN` / `INSUFFICIENT_EVIDENCE`，真实进程退出码 **2**。任务 observed=0、missing=36；首次安装 observed=0、missing=9；总费用为 null。正式分母与预算 $72+$27=$99 不变。本轮没有付费调用、发布新候选或写入正式 observations。
