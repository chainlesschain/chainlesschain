# Windows 实验 runtime 与冻结工具链续做（2026-10-08）

[readback.json](./readback.json) 列出私有原件摘要、公开派生摘要、当前源码摘要、实际使用的 addon 及重新核对结果。公开 JSON 脱敏宿主路径，并将完整 native manifest/inventory 改为明确的 `manifestSummary`/`inventorySummary`；原件保留在 `.work` 和各次私有 staging 中。**公开派生件不是准入票据**；适配器保持 `experimental:true`、`admissionEligible:false`、`capabilities={}`，没有替换原七项 capability 结果或正式 36+9。

## 真实结果

| 诊断                | 结果与证据                                                                                                                                                                                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 有限 Win32 路径控制 | [realpath-api-bound-child.json](./realpath-api-bound-child.json)：四种 scratch/workspace 与 share 控制均 open 成功、DOS flags 0/8 返回 Win32 5、规范 NT flags 2 成功；实际 CLR 子进程 PID 和关闭/退出/Job 清理均核对                                                       |
| 管道 v1             | [pipe-v1-validated.json](./pipe-v1-validated.json)：同步、异步、fork IPC 的 97 字节输入摘要、PID/PPID、stdout/stderr 核对；四个进程八份安装/退出回执；真实 pipe hooks 被调用                                                                                               |
| runtime v2          | [runtime-v2-validated.json](./runtime-v2-validated.json)：上述三种进程操作、scratch/workspace 与三个子进程 `fs.realpathSync.native` 成功；`C:\Windows` 实际句柄触发受限回退，rejected +1、mapped 不增；同 SID、零 capabilities、Job、无 loopback exemption、退出和清理确认 |
| 冻结导入            | [capsule-import.json](./capsule-import.json)：原 Vitest/Vite/happy-dom 字节导入、关键导出核对；实际两个 Node 进程共四份回执；15 秒 Job 内完成                                                                                                                              |
| 冻结 globalSetup    | [capsule-setup.json](./capsule-setup.json)：原 setup 与 teardown 均执行完成，父 Node 两份回执；15 秒 Job 内完成                                                                                                                                                            |
| 原生 transport 回归 | [transport-success.json](./transport-success.json)、[篡改](./transport-tampered.json)、[未列出文件](./transport-unlisted.json)：81 文件/12 MiB、只读 workspace/control、可写 scratch、最小环境 SID 绑定通过；两个拒绝均在 target 创建前，清理确认                          |

本地是 **Windows 10.0.19045 / Node 22.22.2 / ABI 127**，不同于冻结的正式目标。根目录证明来自真实规范 NT 路径、固定根目录句柄、每层非 reparse/single-link 句柄、原目标与重开目标的 FileId；不用 `path.resolve` 或 FILE_NAME_OPENED 代替规范证明。证明针对实际已解析目标，不能恢复调用者此前经过的内部别名。

v1 只安装当前 `node.exe` 的两个 IAT 项，v2 增加规范路径项。每个实际 Node 子进程都须显式 preload 并核对自己的回执，不能靠继承 `NODE_OPTIONS` 宣称全部后代已覆盖。hooks 只在实验进程内生效，未扩大 AppContainer 权限或生产 allowlist。

## 保留的失败与修复

1. 受限宿主令牌的 readiness/cleanup 拒绝：`*-restricted.json`，保留原错误后用真实用户令牌重跑。
2. 监督器最小环境未传入已核对 SID：`pipe-v1-missing-sid.json`；仅在 native evaluator 分支覆盖填入可信字段，helper 已重建并验证源摘要 `e007bc6e264216ada6f74bdd0f4fa6fa4592126b3713c8d4a572341044a7e879`。
3. Windows NODE_OPTIONS 吃掉反斜杠：`pipe-v1-node-options.json`；参数编码改用等价正斜杠，两种 preload 均补真实 Node 启动解析测试。
4. `GetModuleFileNameW` 的严格 extended drive 前缀：`runtime-v2-module-prefix.json`、`runtime-v2-root-proof.json`；只接受并核对 `\\?\C:\` 类盘符前缀，拒绝 UNC/device/dot/ADS 等其他形式，再建立真实根目录证明。
5. 首次 outside 负例在 OS open 阶段被拒绝：`runtime-v2-drive-prefix.json`；没有把它计作 adapter 实际句柄拒绝，后用原本可 open 的 Windows 目录完成真实负例。
6. 完整操作已成功但旧 validator 拒绝 libuv 正常重试计数：`runtime-v2-transient-counter.json`；保留 `ERROR_PIPE_BUSY=231` 的真实计数，以实际数据、close、退出和回执核对成功，不清零或删除失败计数。

旧 `pipe-v1-child-options` 和 `realpath-api-first` 只保留各自当时合同的结果。最终 v1/v2/API/capsule 原件已经用当前 validator 独立回读，源码时间点与回读源码分别记录。

## 构建与验证

官方 LLVM-MinGW 20261006 archive 大小 **190,836,485** 字节，SHA256 `317492c456aa27ee607a5919f1d2d38dcdc1112516a24d0bf4b00d078f52d17a`，已校验、检查 ZIP 路径并解压到私有 `.work/toolchains`；没有全局安装或修改系统 ACL。来源见 [官方 release](https://github.com/mstorsjo/llvm-mingw/releases/tag/20261006)。N-API 通过当前 Node 动态解析，产物不依赖额外的 C++ runtime DLL。

实际成功执行的 v1 addon SHA256 为 `999fec7e044ee6d72b5be02b1c40c079f0aa1b77277bcde137b9c23ed8af7abd`，v2 为 `0dab7447d7732ebb132a087daefba158c6e2d4f26855ba488b7a0b8471428077`；它们保留在私有工作目录。[build-report.json](./build-report.json) 是随后本地构建的独立记录，包含源码、preload、Node/header/compiler/DLL 摘要、完整 argv、自测和新产物摘要。原链接参数保留 PE 时间戳，输出名称也可能影响字节，**重建结果不能冒用先前成功的 binary digest**；此记录不宣称 hermetic 编译器闭包。

原生自测实际覆盖严格 pipe parser、页保护交换/回滚、规范 NT/private identity/硬链接及根外拒绝、缓冲区约定、错误 PID/重复安装。每个 selftest 的 JSON 和退出状态见构建记录；自测的 DOS 拒绝是模拟输入，真实 AppContainer 证明以另列的运行回执为准。

[Node 原始回归](./node-regression.tap) **391/391**、[Vitest](./vitest.json) **52/52**、真实 transport **3/3**，合计 **446 项、零跳过**。失败诊断未混入此计数。Node 合同已接入 CLI CI 的三系统步骤；三个 workflow 的 actionlint 通过（未启用 shellcheck/pyflakes）。当前实验 addon 没有被加入生产或自动原生发布。

## 尚未完成

NUL、冻结原 forks/config/full review、Rollup GNU 的整体 ABI、Windows/macOS durable authority/网络撤销/崩溃恢复均保持开放。NUL 下一版需要真实 `\Device\Null` 对象/权限证明、监督器的精确继承列表与每次 Node 后代启动的精确句柄传播；普通磁盘、管道或 stdin 不能作为替代。

目标 Windows 11/macOS/Linux、Node 22.12.0、独立人工 setup/check 签核、官方账号/账单、正式 36+9、首次公开安装、真人辅助技术及 8h/24h/SLO 仍缺证据。没有新增付费请求或发布。
