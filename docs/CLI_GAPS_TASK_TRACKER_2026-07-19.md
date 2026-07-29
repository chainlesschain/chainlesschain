# CLI 差距任务跟踪表

> 来源：`CLAUDE_CODE_CLI_CURRENT_GAPS_AND_OPTIMIZATIONS_2026-07-18.md`
> 创建日期：2026-07-19
> 当前 CLI 版本：`0.162.186`
> 状态：P0-1 Broker/凭据、静态进程清单、Windows 原生进程边界、Node IPC/detached 语义与
> 真实三平台 strict CI 已完成；P0-2 当前 turn、持久化、跨宿主 authority/binding 与真实三平台
> 断线重连 E2E 已完成；P0/P1-3 权限控制面统一已完成。P1-4/P1-9 已在发布候选
> `e7b9d86a00ae93dd614b09e498253ae0d26b481f` 补齐 Linux generic background、direct
> policy-bearing Plugin bin async/background、CLI generic strong PTY、Desktop DB-root Linux
> strong PTY、Hooks v2 WS/durable opaque host binding、全部实际 bind source 的 private-only
> mount propagation attestation、raw PTY master FD 失效、Windows attached-session tree
> teardown，以及 Hook stdin EPIPE 与重复 CredentialTransport Worker 发布阻塞；远端请求、
> 同步数据和历史未证明根不能再取得 Desktop 本机 PTY 执行权限。同一精确 `head_sha` 的
> [CLI CI run 30378915792](https://github.com/chainlesschain/chainlesschain/actions/runs/30378915792)
> 与
> [CLI Strict Sandbox run 30378915392](https://github.com/chainlesschain/chainlesschain/actions/runs/30378915392)
> 已全绿：CLI CI 的 48 个测试分片、Linux pack dry-run 与 Ubuntu/macOS/Windows
> `verify-cli` 全过；Strict 三平台 0 failed。因此 P1-4/P1-9 的实现与精确 SHA 发布门均已完成。
> 非阻塞限制仍包括 dynamic ELF
> transitive/`dlopen`/hwcaps 完整闭包、tree/launch 的 `handleAtomic:false`、
> final-check→spawn 的 `mountTopologyAtomic:false`、shared source host 上的强路径 fail-closed
> provisioning requirement、非 Linux strong PTY、Desktop per-client
> principal/project-membership ACL，以及策略不会随交互 shell 内 `cd` 动态发现或放宽；
> P1-12 双语言 SDK 已完成，
> Python SDK 0.1.0 已发布 PyPI
> 最后更新：2026-07-29（按 `e7b9d86a00` 精确双门全绿、最终候选修复、安全终审与生成清单复核）

---

## 执行优先级

| 优先级    | 任务数 | 说明                                   |
| --------- | ------ | -------------------------------------- |
| 🔴 **P0** | **0**  | P0-1、P0-2 已完成                      |
| 🟠 P0/P1  | 0      | P0/P1-3 权限控制面统一已完成           |
| 🟢 P1     | 0      | P1-4、P1-9 实现与精确 SHA 发布门已完成 |
| 🟢 P2     | 4      | 差异化方向（不抢占 P0/P1）             |

---

## 🔴 P0 任务（优先执行）

### P0-1: 进程隔离（ProcessExecutionBroker 生产化）

**状态**: ✅ **Broker/凭据 transport/三平台执行计划、进程清单、Windows 特殊进程语义与真实三平台 CI 已完成**

**目标**:

- macOS: Seatbelt sandbox（`sandbox-exec` profile）
- Windows: 原生 Win32 Job Object + Restricted Token 强边界
- Linux: seccomp-bpf + Landlock（当前使用 bwrap namespace 隔离，landlock 后续增强）
- 所有 spawn 入口统一 Broker 审计
- 凭据代理 default-on（secrets 永远不裸传给子进程）

**验收标准**:

- [x] macOS Seatbelt wrapper 与 strict/default/network-only profile 生成、注入式测试
- [x] Linux bubblewrap 显式 Agent sandbox 与 Broker `prlimit` 执行计划
- [x] Windows Job Object + Restricted Token 原生 adapter
- [x] Broker `spawn`/`spawnSync`/PTY 接入 CredentialAgent，敏感 env/argv 默认过滤且审计不含值
- [x] Broker 签发的 credential ref 通过认证 transport 向目标进程按需解析
- [x] 生成清单中的 runtime 匹配全部迁移、记录审计豁免或判定为 non-executable（2026-07-28：228 项，0 unreviewed）
- [x] `CC_SANDBOX_STRICT` 在平台边界不可用时 fail-closed
- [x] Windows 原生 adapter 保真 Node IPC fd3 与 detached 目标 PID/handle 语义
- [x] macOS/Linux/Windows 严格隔离真实 CI 矩阵全部通过

**实现说明（2026-07-26 复核）**:

1. **`platform-sandbox.js` 平台执行计划**：
   - macOS：生成 Seatbelt profile，通过 `/usr/bin/sandbox-exec -f` 包装目标进程
   - Windows：Broker 控制的 Windows PowerShell/Win32 adapter 以 restricted primary token
     挂起创建目标，先加入 kill-on-close Job Object 并施加 CPU/内存/进程数限制，再恢复执行
   - Windows adapter 使用受控的 `windows-sandbox.cs` 源码契约与随包交付的托管 DLL/EXE；
     strict/AppContainer 路径由受保护 PowerShell host 校验并 byte-load 精确 DLL 字节，兼容路径可物化
     checked-in managed executable。helper 的 loader mode、二进制 SHA-256 与源码契约摘要均被探测，
     漂移或物化/清理无法证明时 fail-closed，npm 与 `pkg` 构建携带相同受控产物。运行时不会调用
     C# 编译器；构建脚本仅供 build/CI 生成或以 `-Check` 校验 embedded source digest。源码/helper
     SHA 与文件身份只能证明 freshness/integrity，不等同于编译器 provenance、可复现构建、
     Authenticode 或 publisher 身份证明
   - Windows 真实测试验证受限 privilege 集、`cmd.exe /s /c` 内嵌引号与 2 MiB 输出语义，
     父进程退出后 detached grandchild 被 Job Object 清理、Node fd3 双向 IPC/断连语义，
     以及 detached `spawn().pid` 对齐真实目标并由 wrapper handle 监督整棵 Job；adapter/PowerShell
     缺失或额外非 IPC 描述符无法保真时仍返回 unavailable 并由 strict 模式 fail-closed
   - helper 从自身 CRT fd 映射重建 libuv `cbReserved2/lpReserved2` 描述符表，在
     `CreateProcessAsUser` 前恢复可继承句柄；目标继承成功后关闭 helper 侧 fd，避免延迟
     `disconnect`/EOF。detached 路径在 Job 绑定且目标恢复后通过随机控制文件同步返回
     `targetPid`，Broker 对外暴露目标 PID，同时保留 `sandboxWrapperPid` 用于 Job 生命周期
   - Linux：Broker 可用 `prlimit` 施加通用资源限制；显式 Agent sandbox 继续复用既有 bubblewrap。
     Broker 强 filesystem/network backend 已覆盖直接、前台、同步及 async/background
     policy-bearing Plugin Node bin、静态/static-PIE-shaped native、窄型 direct-system-set 动态 ELF，
     以及 one-shot generic workspace command；后者已接入 Hook/MCP/LSP/Monitor/Agenda、
     `BackgroundTaskManager`/Agent generic background，并通过专用 controlling terminal 与
     descriptor-pinned launcher 接入 CLI/Desktop Linux PTY。不支持强边界的平台、缺少
     bwrap/setsid 或 node-pty raw seam 的 PTY 环境仍会 fail-closed

2. **`credential-agent.js` 凭据过滤代理（default-on）**：
   - 30+ 正则模式识别敏感 env（API_KEY/TOKEN/PASSWORD/SECRET/PRIVATE_KEY/BEARER/AUTH 等）
   - 40+ 安全 env 白名单（PATH/HOME/USER/SHELL/LANG/TZ/NODE_ENV 等直接放行）
   - 命令行参数密钥自动重写：
     - `--token=xxx` → `--token=***REDACTED***`
     - `-H "Authorization: Bearer xxx"` → `-H "Authorization: ***REDACTED***"`
     - 内嵌 `sk-xxx` / `ghp_xxx` / `xoxb-xxx` 模式自动打码
   - 敏感值替换为目标/审批绑定的短期 refId，明文不直接传入子进程
   - ref 签发、解析、撤销与审计已有核心 API；生产单例默认启用
     `local-ipc-v1`（Windows named pipe / POSIX Unix socket）
   - 每次 Broker 放行以 `executionId + decision` 生成不可伪造的审批绑定，并为该次启动签发
     256-bit capability；ref 同时绑定 agent、进程、目标 host、TTL 与最大使用次数
   - transport 服务运行于 Broker worker thread，`spawnSync()` 阻塞主线程时目标进程仍可按需解析；
     POSIX socket 权限收紧为 `0600`，错误鉴权、跨进程/跨 host、过期与超额使用均 fail-closed
   - transport/agent 审计仅记录 ref/审批指纹与计数，不记录 capability、ref 原文或凭据值

3. **Broker `index.js` 集成完成**：
   - 修复构造函数错误（移除错误的 `new PlatformSandbox()`，改为函数式 API）
   - `spawn()` / `spawnSync()` / PTY 路径统一执行凭据过滤、平台执行计划和脱敏审计
   - `getInfo()` 对外暴露沙箱状态（平台/启用/严格模式）和凭据代理状态（default-on/过滤计数）
   - STRICT 模式下平台边界不可用直接拒绝执行（fail-closed），非严格模式显式记录降级原因

4. **2026-07-24 入口收口**：
   - Agent `run_skill` 仅向声明 `shell-exec` 的 Skill 注入受限 Broker 门面
   - Desktop 语音、量化、CodeExecutor、Control Panel、Data Science、Project Automation 与
     Plugin Loader 已迁移到显式 Broker origin；Plugin Loader 的安装/解压链已去 shell
   - 生成清单由 317/236 项（total/runtime）降至 285/204；剩余 runtime 匹配继续逐项迁移或
     记录审计豁免

5. **2026-07-26 清单 fail-closed 收口**：
   - 生成器为每个 runtime 匹配输出 `brokered` / `audited-exemption` / `non-executable` /
     `unreviewed` disposition 与证据
   - 当前源码共 314 个词法匹配（runtime 228、tooling 56、test 30）；runtime 中
     164 项已路由 Broker、27 项有显式审计豁免、37 项为声明/注释/类型/安全正则噪声，
     `unreviewed` 为 0
   - `process-spawn-audit-policy.json` 记录 Broker 原生边界、Agent SDK 外部宿主与
     goal checker fail-closed 注入规则的 owner、复核日期和原因
   - `docs:spawn-inventory:check` 同时校验生成文档无漂移并在出现任意 unreviewed runtime
     匹配时失败

6. **2026-07-26 三平台验收完成**：
   - Broker 使用显式 `requiredBoundaries` / `guarantees` / `backend` 合约；平台只声明实际
     强制的边界，需求未满足时在 native spawn 前 fail-closed
   - Windows detached 调用同时把 libuv 等价的
     `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP` 应用于真实 restricted target，保留 helper
     的 detached/outlive-parent 与 Job 监督语义
   - Windows helper 改用 `STARTUPINFOEX + PROC_THREAD_ATTRIBUTE_HANDLE_LIST`，目标只继承
     stdin/stdout/stderr 与可选 Node IPC fd3；Restricted Token、Job、detached 与 CRT fd3
     语义保持不变
   - [GitHub Actions run 30207776309](https://github.com/chainlesschain/chainlesschain/actions/runs/30207776309)
     的 macOS 15、Ubuntu 与 Windows strict native boundary job 全部通过；Linux 独立
     bubblewrap 文件系统/网络边界也在同一矩阵验收
   - 句柄白名单加固后的
     [GitHub Actions run 30208893336](https://github.com/chainlesschain/chainlesschain/actions/runs/30208893336)
     再次通过 macOS 15、Ubuntu 与 Windows 三个 strict native boundary job

7. **2026-07-27 Windows 强 filesystem/network backend 验收**：
   - 明确要求 filesystem/network 时，Broker 使用零 capability AppContainer、
     Restricted Token、目标进程 token/SID attestation 与 kill-on-close Job Object；
     `STARTUPINFOEX` 句柄白名单继续只传递标准流和受支持的 Node IPC fd
   - 临时 AppContainer profile 在目标退出后有界删除并再次证明不存在；托管 helper
     使用进程内 SHA-256/文件身份缓存，源码、可执行文件或缓存身份漂移时重新编译并 fail-closed
   - [GitHub Actions run 30214672198](https://github.com/chainlesschain/chainlesschain/actions/runs/30214672198)
     的 macOS 15、Ubuntu 与 Windows 三个 job 全部通过；Windows live 用例真实证明宿主
     secret 不可读、宿主 marker 不可写、loopback 不可达、零 capability token 与 profile 清理

8. **2026-07-27 Linux 直接 Plugin Node bin 窄型强 filesystem/network backend 验收**：
   - 仅覆盖 Agent `run_shell` 解析出的单一 literal argv、`shell:false`、前台同步且显式要求
     filesystem/network 边界的 Plugin Node bin；resolver 签发、Broker 单次消费的私有 contract
     将当前 trust/managed policy、plugin root、entry、Node runtime、cwd 与调用 provenance 绑定，
     缺失、伪造、复用或启动前漂移均在 native spawn 前 fail-closed
   - `/usr/bin/bwrap` 构造 empty-root namespace；经打开 FD 固定的 Node/runtime 依赖与 plugin tree
     逐文件只读挂载，环境被清空并重新建立受限 `/proc`、`/dev`、`/tmp`；user/pid/ipc/net/uts/cgroup
     namespace、capability drop 与 seccomp 共同阻止网络创建，包括
     `socket`、`socketpair` 和 `io_uring_setup`
   - [GitHub Actions run 30220657085](https://github.com/chainlesschain/chainlesschain/actions/runs/30220657085)
     的 macOS 15、Ubuntu 与 Windows 三个 job 全部通过；Ubuntu live 用例证明插件依赖和声明文件可读、
     HOME secret 与宿主 `/etc/passwd` 不可读、插件树和宿主 marker 不可写、`/tmp` 仅沙箱内临时可写，
     且宿主 loopback 可达而沙箱创建 socket 返回 `EPERM`；缺少私有 contract 时目标 marker 未启动
   - 该批次当时的 Node 强 backend 仍只覆盖窄型直接 bin，不会自动成为 Plugin native、background、
     Hook/MCP/LSP/Monitor、`run_code`、REPL bang 或 PTY 的**通用强 backend**；这些执行面后来已接入
     pinned policy 或 upfront denial，详见第 10 项。FD pinning 已缩窄路径替换、symlink/mount 注入与身份漂移窗口，
     但 Linux sealed immutable executable snapshot 和 OS spawn 前 handle-atomic 绑定仍未完成

9. **2026-07-27 Linux 静态与 static-PIE-shaped Plugin native ELF 窄型强 filesystem/network backend 验收**：
   - 在相同 one-shot contract、empty-root bwrap、逐文件 FD 只读挂载、namespace/capability drop
     与网络 seccomp 边界内，实际目标保持插件 native entry 与 literal argv；attested Node runtime
     只用于 bwrap policy capability probe，不替代或解释执行 native 目标
   - 当前架构 little-endian ELF64 `ET_EXEC` 继续要求无 `PT_DYNAMIC`；另接受窄型
     static-PIE-shaped `ET_DYN`：无 `PT_INTERP`、恰一个有界且映射到 `PT_LOAD` 的 `PT_DYNAMIC`、
     dynamic table 以 `DT_NULL` 终止、无 `DT_NEEDED`，并由 `DT_FLAGS_1/DF_1_PIE` 明确标记。
     两类目标都要求 program-header table 有界、入口位于可执行 `PT_LOAD`；动态链接/带解释器及其他
     `ET_DYN`、ELF32、大端、异架构、越界 header、executable stack、W+X、setuid/setgid 与
     shebang/script 均在 bwrap probe 和目标启动前 fail-closed；`ldd` 仍只检查已证明身份的
     Node probe runtime，不检查不可信插件 ELF
   - 初始 `ET_EXEC` 验收由
     [GitHub Actions run 30232622815](https://github.com/chainlesschain/chainlesschain/actions/runs/30232622815)
     完成；`88ab0f414c` 扩展窄型 static-PIE-shaped `ET_DYN` 后，
     [GitHub Actions run 30271575856](https://github.com/chainlesschain/chainlesschain/actions/runs/30271575856)
     的 macOS 15、Ubuntu 与 Windows 三个 strict job 全部通过。Ubuntu live 现场以
     `cc -fPIE -static-pie` 编译并在真实 bwrap 内运行目标，证明插件文件可读、宿主
     secret/`/etc/passwd` 不可读、插件树与宿主 marker 不可写、沙箱 `/tmp` 可写且
     `socket` 返回 `EPERM`；带 `PT_INTERP` 的动态 PIE、动态 ELF 与 shebang 目标均未启动
   - 实现落在 `92ca5dc69f`，ELF segment 边界修正在 `0b2b638b11`，native probe 审计传播修正在
     `c2e4053c87`，static-PIE-shaped 扩展落在 `88ab0f414c`。该分类只证明受检 ELF shape，
     不是编译器来源、可复现构建、签名或启动/重定位代码正确性的证明。该批次当时的审计明确记录
     `targetRuntime:native-static-elf`、`contentSnapshot:false` 与 `handleAtomic:false`；
     同 inode 内容在最终 hash 后仍可能被另一写入者修改，动态链接/带解释器及其他 `ET_DYN` native、
     generic background/PTY 与通用 Hook/MCP/LSP/Monitor 强 backend 仍缺；`run_code`、REPL bang、
     CLI/Desktop PTY 与 BackgroundTaskManager 已有 policy plumbing/前置拒绝，但不能据此宣称强隔离
   - `3366418c56` 随后只为该窄型 Linux static native 入口增加 executable-content snapshot：
     已验证的入口 FD 被复制到匿名 `O_TMPFILE`，probe/final 使用两个独立只读 OFD，并由 bwrap
     `--perms 0500 --ro-bind-data` 复制为只读可执行目标；成功审计更新为
     `contentSnapshot:true`，scope `plugin-entry-executable`，mechanism
     `verified-o_tmpfile-copy-bwrap-ro-bind-data-v1`，但仍明确 `handleAtomic:false`

10. **2026-07-27 非直接执行面 policy plumbing、Windows 加固与 Desktop 运行时闭包**：
    - `7ae04a47e8` 在创建脚本/临时目录及解释器探测前固定 `run_code` 的 workspace policy，并把同一
      policy 传给实际解释器、pip 自动安装和 retry；`860bc7a0fc` 对严格策略下尚无缓存解释器的
      Python discovery 以 `python_interpreter_probe_requires_sandbox` 前置拒绝。`80fbe06e25`
      只是在兼容 shim 重新导出测试用 Python cache reset，不新增运行时安全语义
    - `e43f078a01` 对同一 slash/REPL bang macro 在第一条命令前一次性收集并冻结 policy，全部 bang
      共享该快照且 Broker boundary error 不再被扁平化；`764c0e0845` 让 CLI PTY 以固定 workspace
      root 加请求 cwd 在创建时收集 policy。该批次当时尚不存在 generic PTY 强 backend，required
      boundary 会在分配/启动前拒绝；`e7b9d86a00` 已补 Linux one-shot strong PTY。强路径内后续
      `cd` 始终受创建时的固定 namespace root 约束，因此维持隔离不需要重新计算宿主 root，但
      policy 也不会按新目录动态发现或放宽
    - `543c877cd2` 为 `BackgroundTaskManager` 注入固定 policy root，并在 `create()`（生成 task id/
      持久化前）和 `start()`（状态变更/spawn 前）两次重新收集、验证冻结 policy；出现 required
      boundary 时以 `ERR_BACKGROUND_TASK_SANDBOX_UNSUPPORTED` /
      `background_execution_unsupported` 前置拒绝。该双时点检查覆盖排队、恢复及启动时漂移，
      当时尚无 generic background 强 backend。`e7b9d86a00` 已在 Linux 用 canonical root/cwd、
      持久 boundary envelope、干净 worker 与 async one-shot contract 替换该拒绝；非 Linux、
      不支持的 boundary、policy/root 漂移仍在持久化或 spawn 前 fail-closed，并已由同 SHA
      三平台矩阵验收
    - `3f46fd1105` 将 Agenda command monitor 在 schedule 时绑定到可信 host `context.cwd` 并持久化
      规范化绝对路径，模型字段不能覆盖；consumer 以该快照同时作为实际 shell cwd 与 policy root，
      缺少绑定的 legacy entry、canonical shell hard deny、异步/非冻结 policy 及 Broker
      deny/prompt/sandbox error 都在执行或匹配 `stopWhen` 前 fail-closed，并释放 execution lease。
      null policy 保持原有 Broker shell 语义；`8c69f10aa5` 后强策略在 Linux 使用显式 shell argv、
      `shell:false` 与 one-shot generic contract，并已由 `e7b9d86a00` Strict contract gate 验收
    - `770b07aa33` 为 Desktop PTY 在构造 manager 前预载 CLI ESM policy collector；导入/导出失败会
      缓存为同步 fail-closed resolver。后续 DB binding resolver 从 project 表本机选择的 canonical
      `root_path` 签发执行 authority，远端 init/sync 不能写入该根，并按 project 对 IPC/Web/mobile
      session 做分区。`e7b9d86a00` 的 Linux Desktop PTY 复用 CLI one-shot strong PTY；非 Linux 或
      CLI/ABI/raw PTY seam 缺失时 fail-closed。固定 namespace 内 `cd` 不会逃出项目根，但 policy
      不会动态发现或放宽；共享设备 token 与 project/session partition 仍不是 per-client ACL
    - `130acdfa9c` 补齐 Forge 包的 CLI runtime closure：在 ASAR 外 vendor
      `packages/cli/src`、CLI `package.json` 和独立 production `node_modules`，所有
      package/make/publish 流程先准备依赖；`packageAfterCopy` 会从 staged Resources 布局真实动态
      import `plugin-runtime/bin.js` 并验证 `collectWorkspacePluginBinSandboxPolicy`，失败即阻断构建
    - Windows helper 现从干净、可信的 host environment 启动，显式固定
      `SystemRoot/WINDIR/ComSpec/PATH/PATHEXT/TEMP/TMP`；目标环境剥离 CLR/profiler 注入变量，窄型
      Plugin Node snapshot 还剥离 `NODE_OPTIONS`、IPC channel 与 OpenSSL 配置变量。仅同步前台
      `strict-plugin-node-bin` 的 `.cjs` entry 可进入 snapshot 路径：runtime/entry 的 path、bytes、
      SHA-256 与 Node `dev/ino` 必须成对匹配同一 libuv identity projection，helper 以 Filter oplock
      和已验证 handle 固定二者，并通过 inherited pipe 把 entry source 交给 Node module compile。
      审计因此记录 `contentSnapshot:true`、scope `plugin-entry-source`、mechanism
      `verified-handle-inherited-pipe-module-compile-v1`，但仍诚实记录 `handleAtomic:false`
    - Windows AppContainer `policyDigest` 绑定 backend/profile、排序后的 required boundaries/
      guarantees、helper loader/source/source-contract 摘要、零 capability AppContainer 与 restricted
      primary LowBox token、管理员 SID 禁用/reparse 选择/profile 生命周期、Job limits、execution
      contract、content snapshot 语义及 runtime/entry launch locks；瞬态 profile name/SID 和调用者
      payload 有意不参与摘要
    - 已确认 [GitHub Actions run 30263304582](https://github.com/chainlesschain/chainlesschain/actions/runs/30263304582)
      在 `764c0e0845` 上的 macOS 15、Ubuntu 24.04、Windows strict matrix 全绿。其后的
      `543c877cd2`、`80fbe06e25`、`130acdfa9c`、`770b07aa33`、`a650cd6c9e`、
      `3f46fd1105` 本表只记录本地定向验证，
      不虚构更新后的三平台全绿结论

**涉及文件**:

- `packages/cli/src/lib/process-execution-broker/index.js` (Broker 主逻辑，已完成集成)
- `packages/cli/src/lib/process-execution-broker/platform-sandbox.js` (✅ 新增完成)
- `packages/cli/src/lib/process-execution-broker/windows-sandbox.cs` (✅ Win32 helper 源码契约)
- `packages/cli/src/lib/process-execution-broker/windows-sandbox-helper.dll` (✅ 托管 helper)
- `packages/cli/src/lib/process-execution-broker/windows-sandbox-helper.exe` (✅ 兼容路径托管 helper)
- `packages/cli/scripts/build-windows-sandbox-helper.ps1` (✅ helper 构建与源码契约 freshness 校验)
- `packages/cli/src/lib/process-execution-broker/credential-agent.js` (✅ 新增完成)
- `packages/cli/src/lib/process-execution-broker/credential-transport.js` (✅ 认证客户端/父端控制)
- `packages/cli/src/lib/process-execution-broker/credential-transport-worker.js` (✅ 本地 transport 服务)
- `packages/cli/__tests__/unit/credential-transport.test.js` (✅ 认证拒绝、绑定与真实 `spawnSync`)
- `packages/cli/scripts/gen-process-spawn-inventory.mjs` (✅ disposition 与 fail-closed gate)
- `packages/cli/scripts/process-spawn-audit-policy.json` (✅ 显式审计豁免)
- `.github/workflows/cli-strict-sandbox.yml` (✅ 三平台 strict 边界矩阵及真实运行验收)
- `docs/cli/PROCESS_SPAWN_INVENTORY.generated.md` (✅ 228/228 runtime 已归类)
- 详细进度记录：`packages/cli/P0_CLI_SECURITY_PROGRESS.md`

---

### P0-2: 后台人机回路（Real-time Interruption）

**状态**: ✅ **CLI 当前 turn、pending/settlement 持久化、跨宿主 authority/binding 与三平台 E2E 已完成**

**目标**:

- 后台 Agent 运行时遇到 `AskUserQuestion` 立即暂停当前 turn
- 通过 IPC 总线发送问题到 UI/终端
- 用户回答后**原地恢复**执行（非结束后另起一轮）
- Resume 带相同 turn context、tool_call_id、消息序号

**验收标准**:

- [x] Agent 遇到提问 → pause → IPC 通知 → 等待 response
- [x] 用户回答 → resume → 同一 turn 继续执行
- [x] `backgroundAgentId/sessionId/turnId/toolUseId/sequence` 绑定不匹配时拒绝解析
- [x] 超时、取消、重复 request 与重连重放有显式处理
- [x] 单元/集成测试覆盖同 turn 解析和真实子进程链
- [x] Desktop/VS Code/JetBrains/Remote Control 共用 authority/binding resolver
- [x] worker/child 崩溃后的 pending request 持久恢复与 settlement exactly-once
- [x] 三平台真实 E2E：提问→断线→重连→回答→同 turn 完成

**实现说明（2026-07-26 复核）**：

1. **turn child ↔ worker Node IPC**：
   - `background-agent-worker.js` 以 `stdio: [..., "ipc"]` 启动 turn child
   - `background-interaction-resolver.js` 实现版本化
     `interaction-request` / `interaction-response`
   - request/response 保留同一 turn、tool call 和单调 sequence 绑定

2. **worker ↔ attach 宿主 transport**：
   - `background-session-transport.js` 使用 Unix socket / Windows named pipe
   - worker 广播 `interaction_request`，attach 发送 `interaction_response`
   - attach 重连后重放当前 pending request；response 必须携带完整 binding，重复的相同
     settlement 返回幂等确认，冲突的第二次回答被拒绝

3. **持久 pending/settlement journal**：
   - `background-interaction-journal.js` 在请求向宿主可见前，先把完整绑定与 payload 指纹作为
     tamper-evident session JSONL 快照持久化
   - worker 在向 child 交付结果前先持久化 terminal settlement；相同 settlement 重试不重复生效，
     不同答案、跨 session/turn/tool 的迟到回答 fail-closed
   - UI/attach 断线只触发重放，不结束当前请求；worker 重启或监管器确认 worker 已死时，
     遗留 pending 会确定性写成一次 rejected settlement，状态文件同步清除 `pendingQuestion`

4. **Headless 与状态接线**：
   - `headless-runner.js` 将 `ask_user_question` 接到 `backgroundInteractionClient`
   - 回答返回同一个 child，不写入下一 turn 的 `promptQueue`
   - session 状态在等待期间为 `needs_input`，settle 后回到当前 turn

5. **跨宿主 authority/binding 收口**：
   - `interaction-binding.js` 是 CLI runtime 的规范化与逐字段比较事实源；宿主只回传 request
     携带的 opaque binding，最终解析权仍在 runtime，不接受 UI 自报的 session/turn/tool 身份
   - Desktop trusted main、VS Code、JetBrains、Web Panel 与 Remote Control 均保留并回传完整
     binding；Remote Control 的回答操作要求认证的人类 actor 和 `prompt` scope，observe-only、
     未认证与非人类 actor 均 fail-closed
   - TypeScript/Python SDK 的自动 question/MCP elicitation callback 会原样回传 binding；
     WebSocket `session-answer`、后台 `bg-answer` 与 Remote Control `question.answer` 共用这一约束
   - Agent SDK 的 `interaction.ndjson` 提供共享 Golden 向量；CLI、SDK、VS Code 和 JetBrains
     对缺字段、跨 turn/tool/session 与 stale binding 做一致拒绝验证

6. **验证证据**：
   - `headless-side-effect-ledger-resume.test.js` 验证同 turn question resolve
   - `background-interaction-journal.test.js` 覆盖持久化失败、绑定冲突、重复 settlement 和
     崩溃恢复 exactly-once
   - `background-stability-realspawn.test.js` 在真实 worker/child 链上覆盖
     提问→attach 断线→重连重放→回答→同 turn 完成（本地 Windows 已通过）
   - `cli-background-interaction-e2e.yml` 在 Ubuntu/macOS/Windows 仅运行真实
     `background-stability-realspawn.test.js`，避免通用 CLI 36+ 分片的无关失败掩盖本验收；
     [GitHub Actions run 30207046775](https://github.com/chainlesschain/chainlesschain/actions/runs/30207046775)
     已在三个宿主全部通过
   - 本次定向回归：CLI 23 个文件 319 passed/2 skipped；Agent SDK 47 passed + TypeScript
     typecheck；Python SDK 13 passed；Web Panel 48 passed + production build；JetBrains 定向
     tests/build 通过；Desktop 新增 authority 流程用例通过

**涉及文件**:

- `packages/cli/src/lib/background-interaction-resolver.js`
- `packages/cli/src/lib/interaction-binding.js`
- `packages/cli/src/lib/background-interaction-journal.js`
- `packages/cli/src/workers/background-agent-worker.js`
- `packages/cli/src/runtime/headless-runner.js`
- `packages/cli/src/commands/background-session.js`
- `packages/cli/src/lib/background-session-transport.js`
- `packages/cli/__tests__/integration/headless-side-effect-ledger-resume.test.js`
- `packages/cli/__tests__/unit/background-interaction-journal.test.js`
- `packages/cli/__tests__/unit/interaction-binding.test.js`
- `packages/cli/__tests__/unit/background-agent-supervisor.test.js`
- `packages/cli/__tests__/integration/background-stability-realspawn.test.js`
- `.github/workflows/cli-background-interaction-e2e.yml`
- `packages/agent-sdk/__fixtures__/protocol/interaction.ndjson`
- `packages/agent-sdk/src/protocol.ts`
- `packages/agent-sdk-python/src/chainlesschain_agent_sdk/protocol.py`
- `packages/cli/src/gateways/ws/remote-session-protocol.js`
- `packages/cli/src/gateways/ws/background-agent-protocol.js`

---

## 🟠 P0/P1 任务

### P0/P1-3: 权限控制面统一

**状态**: ✅ 运行时规则、CLI 管理面和 Desktop 请求/刷新同步已完成；统一 parity 已验证

**目标**:

- `cc permissions` CLI 直接 gate Agent 工具运行时
- 统一规则来源：CLI 配置 + Desktop 策略
- 规则变更实时生效（无需重启）
- 决策审计日志

**验收标准**:

- [x] `cc permissions allow/ask/deny/list` 命令完整
- [x] Agent tool 调用前查 settings permission rules（Agent Core、Headless、REPL）
- [x] Deny 规则立即阻断，Allow 规则持久化
- [x] Desktop coding-agent store 与 CLI settings rules 同步（读取、写入后刷新确认）

**2026-07-22 进度**：新增 `cc permissions allow <rule>`、`ask <rule>`、`deny <rule>`
快捷命令，继续保留 `add <decision> <rule>` 兼容入口；新增单元测试覆盖三种快捷命令。
权限命令专项测试已通过：`permissions-command.test.js` 共 13 个用例全部通过。
同日补齐 CLI WebSocket → Electron IPC → Pinia store 的规则读取/写入链，Desktop store 回归测试
30 个用例全部通过；补充协议/Bridge 回归后，CLI 路由相关测试 81 个、Desktop Bridge/store 测试
64 个均通过。

---

## ✅ P1 任务（P1-4/P1-9 实现与发布门完成）

| #     | 任务                 | 状态                                            | 说明                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----- | -------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-4  | Hooks v2 完整实现    | ✅ 实现与精确 SHA 发布门完成                    | 40 事件、5 种公共 executor + trusted JS、producer、managed allowlist/delegated budget 与 policy 只增不减均已有；Windows AppContainer 与 Linux one-shot generic Hook filesystem/network backend 已通过 `9c01ee579a` strict CI。`e7b9d86a00` 发布线由 host bootstrap 注册 canonical root，以 `AsyncLocalStorage` 绑定 headless/stream/REPL/WS；request/event/model/plugin 提供的 root 不参与 Hook authority。durable binding format v3 以 canonical root、`dev/ino` 与 generation（优先 `birthtimeNs`，不可用时保守回退 `ctimeNs`）派生 opaque ID；恢复只解析当前 host registry，并在解析、使用与 release 时重新验真，缺失或 identity 漂移 typed fail-closed。同一 `e7b9d86a00` 的 [CLI CI](https://github.com/chainlesschain/chainlesschain/actions/runs/30378915792) 与 [CLI Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/30378915392) 三平台矩阵已全绿                                                                                                                                                                                                                                            |
| P1-5  | MCP Elicitation 路由 | ✅ form/URL/defer 已完成                        | 基于 MCP `2025-11-25`：声明 form/URL capability；`elicitation/create`、`notifications/elicitation/complete` 与 `URLElicitationRequiredError (-32042)` 已接入；URL 仅允许无凭证 HTTPS，所有交互宿主展示完整 URL 并在明确同意后打开；Headless 结构化 defer、完成关联及原工具调用 exactly-once retry 已覆盖，URL 敏感输入不回传 `content`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| P1-6  | Event Runtime 常驻化 | ✅ 宿主托管、观测与恢复闭环                     | 发布二进制的 lazy-dispatch 真实入口统一启动/停止 process-level host：长驻命令持续 drain，短命命令退出前有界 final drain；durable inbox/outbox、lease fence/续租/过期接管、重试/死信/背压、producer 自动接线均已有；Webhook/Telegram 使用 required-handler 恢复路由；`cc status --json` 暴露队列及跨进程 host 心跳/stale 状态，`npm run runtime:event-recovery` 用两个真实进程验证崩溃接管与副作用只应用一次                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| P1-7  | Context 来源归因     | ✅ 双层 Skill 缓存与交互式快照已完成            | `cc context --sources` 已对 instruction 文件、实际注入 persona Skill、admitted MCP schema、普通 Skill descriptor/body 按需读取、缓存命中及实际 prompt 注入分别计费；Headless 与交互 REPL 共用单一 Skill loader，并持续写入无正文 `context_sources` 快照                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| P1-8  | Checkpoint REPL 统一 | ✅ 统一 producer 与归因闭环                     | Agent Core 输出 provider 原始 `tool_use_id`/turn id/permission decision/checkpoint；Headless 与 REPL 共用 `createTurnBindingFeed`，交互 turn 逐次 fail-closed 持久化；child trace/checkpoint/tool/worktree、IDE user edit 与顶层 `--worktree` branch 均进入父 turn，shell/外部副作用诚实标为 partial                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| P1-9  | Plugin 安全强化      | ✅ 实现与精确 SHA 发布门完成                    | 签名、SBOM、consent、managed policy、secret 与 Broker provenance 已有；policy-bearing Plugin bin 以 pinned identity、`shell:false`、`detached:false` 进入 Broker。Windows AppContainer，以及 Linux Node、静态/static-PIE-shaped、窄型 direct-system-set 动态 ELF 和 Hook/MCP/LSP/Monitor/Agenda generic workspace backend 已由 `9c01ee579a` 的 contract gate + Ubuntu primitive live 验收。`e7b9d86a00` 发布线补齐 direct Plugin async/background、generic background、CLI generic strong PTY、Desktop DB-root Linux strong PTY、父端 pinned FD 及时关闭、raw PTY close/error 后立即失效、Broker/Windows attached-session tree teardown、全部实际 bind source 的 private-only mount propagation attestation，以及 Desktop V8 DB-root invariant、排他创建/重绑与外部缓存 containment；产品保持 fail-closed，并只在一次性 CI VM 建立 private topology。同一 SHA 的最终双门已全绿。非阻塞限制仍见后文：dynamic transitive/`dlopen`/hwcaps closure、tree/launch `handleAtomic:false`、mount final-check→spawn 非原子窗口、非 Linux strong PTY 及 Desktop per-client ACL；ELF shape/直接依赖集合不是编译器来源、签名或完整运行时闭包证明 |
| P1-10 | 并发状态 fail-closed | ✅ 关键状态分级与跨宿主锁已完成                 | Approval CAS、side-effect/turn/session、Agenda/Event Runtime、Cowork delivery lease、goal/config/MTC ledger、plugin/MCP trust/consent/凭据元数据均有界 fail-closed；VS Code/JetBrains 共享同一 `.lock` 目录协议与原子 session-index 写入；仅 Advisory cache 保留 best-effort                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| P1-11 | JSON Schema 完整支持 | ✅ 标准引擎、完整 vocabulary 与受限 refs 已完成 | `Ajv2020` + `ajv-formats` 统一执行 Draft 2020-12 meta-schema/动态引用/`unevaluated*`/组合互操作；所有 `--json-schema` 入口在模型调用前编译完整 schema graph；本地 ref 限于根 schema 目录，远程 ref 仅允许无凭证公网 HTTPS，并受 DNS-SSRF、文档数/单文档/总字节/超时上限保护；稳定 digest、错误码、JSON Pointer 与 `structured_result` 保持兼容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| P1-12 | SDK/CI 事件透传      | ✅ 源码完成；Python 0.1.0 基线已发布            | 当前 TypeScript + Python 源码覆盖契约中的 24 类 typed stream 事件（含 defer/complete）、approval/question/MCP elicitation callback、resume 与未知事件无损透传；共享 protocol fixture、穷举 CI consumer、GitHub Actions 模板及 22 项 hermetic 测试已补；已发布的 Python 0.1.0 是此前 22 类事件基线并通过 3.10/3.12/3.13 公网 wheel 烟测，本轮两个新增事件尚未发布新版本                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| P1-13 | 验收门与文档清理     | ✅ 已完成                                       | 统一 parity 10/10；旧文档持续维护                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

> 下列 dated increment 保留各批次当时的验收边界；若旧条目写“仍缺”，最新事实口径以
> 上方 P1 表和后文“2026-07-29 发布候选 `e7b9d86a00` 实现与验收完成”为准。

**2026-07-24 P1-5 进度**：三端表单已覆盖 MCP form elicitation 规定的受限 schema：
`title`/`description`/`default`、字符串长度与 `email`/`uri`/`date`/`date-time`、
数值上下界、`enum`/`enumNames`/带标题 `oneOf`，以及
`items.enum`/`items.anyOf` 多选与 `minItems`/`maxItems`。Desktop 和 VS Code
运行同一共享 normalize/coerce/validate 核心；JetBrains 原生适配器消费同一
conformance fixture。该完成口径不包含嵌套 object、任意 array、`$ref`、自动远程
schema 解析或完整 JSON Schema Draft 2020-12。

**2026-07-26 P1-5 完成**：MCP client 升级到
[MCP Elicitation 稳定协议版本 `2025-11-25`](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation)，同时声明
`elicitation.form` 与 `elicitation.url`。URL 请求必须携带 `elicitationId`、非空说明和
无用户名/密码的 HTTPS URL；CLI、Desktop、VS Code、JetBrains 与 SDK 都透传
mode/id/完整 URL/host，并只在用户明确同意后调用系统浏览器。URL 应答只含 action，
不把浏览器中的敏感输入带回 MCP。客户端关联
`notifications/elicitation/complete`，忽略未知、跨 server 和重复完成通知；工具返回
`-32042` 时最多处理 16 个有界 URL 请求，全部完成后只重试原调用一次；普通 elicitation
并发默认上限 32，超限 fail-closed decline。无交互宿主会发
typed `elicitation_deferred`，同时在 MCP wire 上 fail-closed `decline`，不会挂死。
TypeScript/Python SDK 还新增 typed `elicitation_deferred` /
`elicitation_complete` 事件。Streamable HTTP 同步补齐协商后的
`MCP-Protocol-Version` header、POST SSE 内嵌 server message 分派，以及带 session id、
`Last-Event-ID`/`retry` 恢复语义的 GET SSE 接收器；HTTP 上的
`elicitation/create` 与异步 complete 不再静默丢失。

本轮定向验收：CLI P1-5/VS Code 4 文件 39/39、MCP client 全组 12 文件
112/112、TypeScript SDK 全组 49/49 + strict typecheck、Python SDK 22 tests +
5 subtests、Desktop URL/form UI 5/5、JetBrains `ChatEvents` /
`ProtocolFixtures` 强制重编译测试通过；共享 NDJSON fixture 也已覆盖 form/URL、
deferred/complete 与完整 interaction binding。上述是本地 Windows 结果，不替代远端三平台 CI。

**2026-07-26 P1-6 完成**：此前 lifecycle 只放在 `src/index.js` 的 direct-run
分支，而实际发布 binary 走 `bin/chainlesschain.js → lazy-dispatch.js`，因此 durable
producer 虽已接线，真实入口并不稳定托管 worker。本轮把统一 lifecycle 包到 lazy
入口：先启动但延后首次 claim，待所选命令注册 handler；长驻命令按单一、非重叠 timer
持续 drain，短命命令在 `finally` 中执行最多 10 tick 的有界 final drain，并在退出时
等待 in-flight work。`EventRuntimeStore` 新增同锁域、100 条上限的 `hosts.json`
registry；每个 host 发布 pid/role/heartbeat/lastStats/lastError，`cc status --json`
的 `chainlesschain.event-runtime-health.v1` 可跨进程区分 running/stale/stopped host。
Webhook/Telegram durable 事件标记为 `requiresHandler`，由 Channel Manager 按
queue/type/origin 注册恢复 handler，停止时注销，避免 worker 无 handler 时把待恢复
事件误当成功。

新增 `npm run runtime:event-recovery` 恢复演练：进程 A claim 后硬退出，不 ack；
lease 过期后进程 B 以更高 fence 接管，通过真实 `EventRuntimeHost` 执行带幂等 marker
的副作用并结算。Windows 本地结果为 attempts 2、fence `1 → 2`、副作用应用 1 次，
同时观测到 1 个 stale claimant 与 1 个 stopped successor。Event Runtime/diagnostics
定向测试 53/53、Channels 16/16 通过。

**2026-07-26 P1-7 完成**：Skill discovery 只读取 YAML descriptor，正文按 persona
注入或 `run_skill` 首次使用才 materialize，并按 mtime/size 失效。cache ledger 现在分别
记录 descriptor prompt return、body 磁盘读取、cache hit、正文大小等价量以及真正进入
prompt 的 `contextLoads/contextTokens`；普通 `run_skill` 的 handler 正文不会被误计为
模型上下文。Headless 与交互 REPL 使用同一个 session-scoped loader，REPL 在 MCP 启动、
每轮完成、`/reload-skills` 和退出时持续写入 content-free `context_sources` 快照。
`cc context --sources` 的文本与 JSON 输出都能展示 resident/lazy、逐 Skill 来源、磁盘/
缓存读取和 prompt 注入成本；定向 Context/REPL 测试 82/82 通过。

**2026-07-26 P1-8 完成**：`createTurnBindingFeed` 已成为 Headless 与交互 REPL
共享的事件归因核心；REPL 会 rehydrate 旧表、在 rewind/clear/compact 后剪除被替代
timeline，并在每个 settled turn（包括无工具问答）以 fail-closed 锁定快照。Agent Core
的 checkpoint/tool-executing/tool-result 全程携带 provider 原始 `tool_use_id` 和
`turn_id`，决策事件携带稳定 permission decision id；父 turn 同时保存 child agent 的
trace、checkpoint、tool id 和 worktree lineage，IDE 修改标记会把 coverage 降为
partial。本轮补齐交互 `cc agent --worktree` 的 branch id 通过 runtime policy 进入
每条 REPL binding；shell/外部进程副作用仍明确为 partial，不承诺不可逆恢复。定向
7 个测试文件 111/111 通过。

**2026-07-26 P1-9 安全增量**：关闭 legacy capability bypass。此前管理员开启
`requirePluginCapabilityConsent` 后，插件仍可通过省略 `permissions` 绕过加载 gate；
现在强制 consent 必然隐含强制声明，且可用 managed
`requirePluginCapabilityDeclarations` 或 `CC_REQUIRE_PLUGIN_CAPABILITIES=1`
独立启用。默认仍保留兼容迁移窗口。直接 URL 型 plugin MCP 在进入连接器前会解析目标
hostname，并按声明的精确 domain / `*.subdomain` / `network:*` 执行 fail-closed
校验；stdio MCP 保持可用，其子进程 egress/filesystem 仍由平台 sandbox 边界负责。
定向 5 个测试文件 78/78 通过。P1-9 在该批次当时尚未标记完成，因为 Plugin bin/native
尚未纳入，Windows/Linux Broker 强 network/filesystem backend 当时也仍未完成。

**2026-07-26 P1-4/P1-9 sandbox contract 增量**：新增插件可声明的窄型
`sandboxPolicy.requiredBoundaries`，仅接受 filesystem/network。manifest 与
component/descriptor 要求按加法合并，现已贯穿 stdio MCP、LSP、Monitor 和 command
Hook 的启动链到 ProcessExecutionBroker；无效字段、类型或 boundary 均 fail-closed，
显式要求在 backend 不可提供时拒绝启动，未声明时保持兼容。顶层策略与 Plugin bin
共存时整个 manifest 直接判为无效，避免尚未接线的全局 PATH 可执行文件静默绕过。
此次未将 Plugin bin/native 纳入：全局 PATH 暴露的可执行文件身份与 wrapper/TOCTOU
尚无可证明绑定。Windows/Linux Broker 的真实 filesystem/network 强 backend 也仍未完成，
因此 P1-4/P1-9 在该批次当时均保持进行中。聚焦回归 11 文件 183/183、扩展 Hook 回归 5 文件
125/125 通过。

**2026-07-27 P1-9 Plugin bin/native 与 Windows backend 增量**：policy-bearing bin
不再进入 PATH；未声明 policy 的 legacy bin 保留兼容。Agent `run_shell` 解析到的 Node/native
bin 只接受单一 literal argv，并以 `shell:false` 直接进入 Broker；Windows
`.cmd`/`.bat`/`.ps1` wrapper、复合 alias、重复 alias、symlink/hardlink 与越界 realpath
均 fail-closed。manifest 与 per-bin `sandboxPolicy` 按加法合并，同目录 strict/legacy
混用时整个目录不进入 PATH，避免 legacy shell 间接命中 strict bin。入口在解析时和 Broker
启动前按 realpath、dev/ino、size、mtime 与 SHA-256 复验，结构化
`pluginExecutableIdentity` 写入审计但从 native spawn options 剥离；Agent 工作目录内任一
strict bin 的要求还会收紧全部同轮 `run_shell`，关闭 wrapper、动态 shell 和 PATH 注入旁路。
定向 3 文件 63/63、扩展 scopes/bin/Agent Core 46/46 与 background shell 21/21 通过。
后续 `af6ec8f1a6` 在 Windows 上通过第二个 path handle 与已打开主 handle 的
fstat-to-fstat 身份/摘要对照捕获同内容路径替换，进一步缩窄 path TOCTOU，但不宣称
OS spawn 已实现 handle-atomic。
Windows AppContainer backend 的真实文件/网络隔离由 run 30214672198 验收。P1-9 在该批次
当时仍保持进行中：`run_code`/REPL bang/PTY/background 后来虽已接入 policy plumbing 或
upfront denial，但 generic PTY/background、通用 Hook/MCP/LSP/Monitor 强 backend，以及
OS spawn 前窄 TOCTOU 的 handle-atomic 绑定当时尚未完成。

**2026-07-27 P1-9 Linux 直接 Plugin Node bin backend 增量**：`2caef1e2ac` 至
`e0ef465227` 为直接、前台、同步的 policy-bearing Plugin Node bin 加入 one-shot trusted
contract、empty-root bwrap、FD-backed read-only mounts 与网络 namespace/seccomp 强边界，
并由 run 30220657085 的 Ubuntu live 用例验收。该增量只关闭 Linux Plugin Node 的窄型
直接执行面；`run_code`/REPL bang/CLI/Desktop PTY 与 BackgroundTaskManager 后来已补 policy
plumbing/前置拒绝；静态 ELF64 `ET_EXEC` 与窄型 static-PIE-shaped `ET_DYN` native 后来也已有
直接强 backend，入口可执行内容后来也已有 snapshot；但动态链接/带解释器及其他 `ET_DYN`
native、generic PTY/background、通用 Hook/MCP/LSP/Monitor 强 backend，以及 OS spawn 前
handle-atomic 绑定仍是该批次 P1-9 残项，因此当时状态继续保持 🟡。

**2026-07-27 P1-9 Linux 静态与 static-PIE-shaped Plugin native ELF backend 增量**：`92ca5dc69f`、
`0b2b638b11` 与 `c2e4053c87` 把同一窄型强边界扩展到当前架构的 ELF64 little-endian
`ET_EXEC` 静态 native bin。Broker 在调用任何插件目标或 `ldd` 前从 attested FD 严格解析
ELF，拒绝 interpreter/dynamic/script、异架构和畸形 program header，并在 Node policy
probe 后同时复核路径身份与 pinned entry FD；实际 bwrap target 仍是 native entry，Node
仅是可信 capability probe。run 30232622815 的三平台 strict matrix 全绿，Ubuntu live
现场证明 static ELF 隔离成功且 dynamic ELF/shebang 在目标启动前被拒绝。`88ab0f414c`
进一步只接受无 `PT_INTERP`、唯一有界映射 `PT_DYNAMIC`、`DT_NULL`、无 `DT_NEEDED` 且
`DF_1_PIE` 的 static-PIE-shaped `ET_DYN`；run 30271575856 三平台 strict matrix 全绿，
Ubuntu 真实 `cc -fPIE -static-pie` + bwrap live 通过，带解释器的动态 PIE 在 probe/launch 前拒绝。
该批次当时尚未提供 sealed content snapshot，也不宣称 handle-atomic、编译器来源、可复现构建
或签名证明：审计固定为 `contentSnapshot:false`、`handleAtomic:false`；同 inode 写入窗口、
动态链接/带解释器及其他 `ET_DYN` native、generic PTY/background 和通用
Hook/MCP/LSP/Monitor 强 backend 仍是残项。`run_code`/REPL bang/CLI/Desktop PTY 与
BackgroundTaskManager 已有 policy plumbing/前置拒绝，但不改变上述强 backend 缺口，
因此该批次 P1-9 当时继续保持 🟡。

**2026-07-27 P1-9 Linux 静态 native entry snapshot 增量**：`3366418c56` 从已经
pinned、按合同验真的入口 FD 把全部字节复制到匿名 `O_TMPFILE`，在复制前后复核 source
identity/SHA-256，`fsync` 后回读 snapshot 的 size/SHA-256，再将匿名 inode 收紧为 `0400`。
probe 与最终启动分别通过 `/proc/self/fd` 获得独立只读 OFD；bwrap 使用
`--perms 0500 --ro-bind-data` 复制入口，原始 host entry FD 不进入 child descriptor。
policy digest 绑定稳定的 source contract、snapshot SHA/bytes、destination、mode 与 mechanism，
不绑定匿名 inode/mtime。成功审计记录 `contentSnapshot:true`、scope
`plugin-entry-executable`、mechanism `verified-o_tmpfile-copy-bwrap-ro-bind-data-v1`，失败路径
不冒充已应用快照。run
[30275966482](https://github.com/chainlesschain/chainlesschain/actions/runs/30275966482)
的 Windows、macOS 15、Ubuntu 24.04 三个 strict job 全绿；Ubuntu live 对 `ET_EXEC` 与真实
`cc -fPIE -static-pie` 目标都在 plan 建成后、spawn 前原地 truncate/write/fsync 同一 inode，
证明 host 随后执行 replacement，而沙箱仍执行封存的旧字节，目标模式为 `0500` 且不可写/chmod。
该快照只覆盖 plugin entry executable；它不是内核 seal，bwrap/Node probe runtime、其他 plugin
文件与完整启动链也未获得 handle-atomic 保证，因此继续记录 `handleAtomic:false`。不支持
`O_TMPFILE` 或只读 reopen 的环境 fail-closed；动态链接/带解释器及其他 `ET_DYN` native、
generic PTY/background、通用 Hook/MCP/LSP/Monitor 强 backend 与 Desktop 权威 project binding
仍是该批次残项，P1-9 当时保持 🟡。

**2026-07-28 P1-9 Linux bwrap supervisor descriptor binding 增量**：
`920615b0ea` 对 root-owned `/usr/bin/bwrap` 主 executable 的全宽 dev/ino、metadata 与
SHA-256 验真后固定其 inode；capability、policy probe 与最终启动分别重开独立只读 OFD，
映射为 child FD 3 并经 `/proc/self/fd/3` 启动，其他 mount/seccomp descriptor 从 FD 4
起分配。bwrap setup 以
`--perms 0000 --file 3 /run/.chainless-bwrap-supervisor` 消费并关闭 launch FD，随后以
`/run` tmpfs 遮蔽暂存副本；Node/native live 目标确认同 inode launch FD 不存在且暂存路径
为 `ENOENT`。成功审计记录 `supervisorDescriptorBound:true`、scope
`host-path-replacement`、mechanism
`pinned-child-fd3-file-consume-run-overmount-v1`，并继续记录 `handleAtomic:false`。
[run 30283391416](https://github.com/chainlesschain/chainlesschain/actions/runs/30283391416)
的 Windows、macOS 15、Ubuntu 24.04 三个 strict job 全绿，Ubuntu real-bwrap 的平台合同、
Broker strict boundary、filesystem/network live 步骤均通过。该 scope 只缩窄
`/usr/bin/bwrap` host path replacement/rename-over；它不是 executable content snapshot、
seal 或 `execveat`/`fexecve` 级原子启动，也不覆盖同 inode 原地改写、动态 loader/DSO。
bwrap 作为 PID 1 仍可能经 `/proc/1/exe` 暴露，因此审计明确记录
`supervisorPid1ExecutableExposure:procfs`，不宣称 supervisor 字节全局不可达。generic
PTY/background、Linux 通用 Hook/MCP/LSP/Monitor 强 backend、动态链接/带解释器及其他
`ET_DYN` native、Desktop 权威 project binding 与跨平台 handle-atomic 仍未完成，
P1-4/P1-9 在该批次当时均保持 🟡。

**2026-07-28 P1-9 Linux Plugin Node entry-source snapshot 增量**：
`4d806d222f` 把直接、前台、同步 policy-bearing Plugin Node bin 已验真的入口内容复制到
匿名 `O_TMPFILE`；复制前后复核 source identity/SHA-256，`fsync` 后回读 snapshot 的
size/SHA-256，并将匿名 inode 收紧为 `0400`。policy probe 与最终启动使用两个独立只读
OFD，bwrap 通过 `--perms 0400 --ro-bind-data` 把封存源码挂入固定目标；合法的零字节入口
同样受支持。成功审计记录 `contentSnapshot:true`、scope `plugin-entry-source`、mechanism
`verified-o_tmpfile-copy-bwrap-ro-bind-data-v1`，失败路径不冒充已应用快照，policy digest
绑定稳定的 source contract 与 snapshot 内容但不绑定匿名 inode/FD。
[run 30286701845](https://github.com/chainlesschain/chainlesschain/actions/runs/30286701845)
的 Windows、macOS 15、Ubuntu 24.04 strict job 全绿；Ubuntu real-bwrap live 在 plan 建成后、
spawn 前原地 truncate/write/fsync 同一 inode，证明 host 随后执行 replacement，而沙箱仍
执行封存的旧源码，目标模式为 `0400` 且不可写/chmod；child 同时验证
`NoNewPrivs:1`，以及 inheritable/permitted/effective/ambient/bounding capability 集均为零。
该提交自身只覆盖 plugin entry source，不覆盖同插件其他源码/包元数据、Node runtime、
dynamic loader/DSO 或完整启动链，也不是内核 seal 或跨平台 handle-atomic 保证，因此继续
记录 `handleAtomic:false`。不支持 `O_TMPFILE`、只读 reopen 或 bwrap `--ro-bind-data`
的环境 fail-closed；generic PTY/background、Linux 通用 Hook/MCP/LSP/Monitor 强 backend、
动态链接/带解释器及其他 `ET_DYN` native、Desktop 权威 project binding 与跨平台
handle-atomic 仍是该批次残项，P1-4/P1-9 当时均保持 🟡。

**2026-07-28 P1-9 Linux Plugin Node 有界 regular-file tree snapshot 增量**：
`c9b186afcb` 在 entry-source snapshot 上继续封存 `pinLinuxPluginTree()` 枚举出的全部普通
文件；最多 256 个文件、聚合最多 256 MiB，任一上限或复制/回读/只读 reopen 失败均在
bwrap probe 前 fail-closed。entry 目标仍固定为 `0400`，其余文件按原 source 任一执行位
归一为 `0500`，否则为 `0400`；每个文件的 policy-probe/final mount 使用独立只读 OFD，
原始 plugin file FD 不进入 target。Node policy digest 升为 v4，绑定按 destination 排序的
tree membership、source file-id/mtime/mode、SHA-256、bytes、source/target mode 及聚合
digest，不绑定匿名 inode 或 FD 数字。成功审计新增 `pluginTreeContentSnapshot:true`、
scope `all-pinned-plugin-regular-files`、mechanism
`verified-o_tmpfile-copy-bwrap-ro-bind-data-v1`、文件数/字节数/聚合 digest，并明确
consistency `per-file-pin-to-launch`、`pluginTreeSnapshotContractBound:false` 与
`pluginTreeSnapshotAtomic:false`；Broker 拒绝不完整、伪造 complete/atomic、超限或未绑定
真实 Linux bwrap policy/backend/guarantees 的证据。
[run 30293216204](https://github.com/chainlesschain/chainlesschain/actions/runs/30293216204)
的 Windows、macOS 15、Ubuntu 24.04 strict job 全绿；Ubuntu real-bwrap 对 manifest、entry、
dependency、config、allowed 五个 destination 做 exact-set 验收，全部唯一使用
`--ro-bind-data`，runtime 仍使用 `--ro-bind-fd`。live 在 plan 返回后、spawn 前分别原地
重写 entry 与 dependency 的同一 inode，证明沙箱仍执行/读取封存的 original，而宿主随后
执行/读取 replacement；目标文件不可写/chmod，并继续验证 `NoNewPrivs:1` 与全部 capability
集为零。该保证是逐文件 pin-to-launch，不是整棵树同一瞬间的原子快照，也未把 tree bytes
绑定到签名/SBOM；Node runtime、dynamic loader/DSO、bwrap 完整启动链、generic
PTY/background、Linux 通用 Hook/MCP/LSP/Monitor 强 backend、动态链接/带解释器及其他
`ET_DYN` native、Desktop 权威 project binding 与跨平台 handle-atomic 仍未覆盖，
`handleAtomic:false`，P1-4/P1-9 在该批次当时均保持 🟡。

**2026-07-28 P1-4/P1-9 Linux generic workspace 与动态 ELF 增量**：
`8c69f10aa5` 把 one-shot generic contract 的 trusted workspace root/cwd、exact argv、
`shell`/sync/stdio、冻结 boundary policy 与调用 provenance 一并绑定，Broker 单次 admission/
planner 消费后拒绝重放。empty-root bwrap 以只读 system mounts、读写 workspace、隔离的
`/home/sandbox`、`/dev`、`/run`、`/tmp`、`/var/tmp`、network namespace 与 seccomp 兑现
filesystem/network；mountinfo attestation 拒绝 escaped descendant mount、root/HOME/system
inode alias 与不透明 FUSE/overlay 来源。policy probe 与 final plan 前均复核 topology，probe
完成后 async spawn 会立即关闭父 FD，EIO/cleanup 路径也验证无 descriptor 泄漏。
Hook（settings/plugin/async/Hooks v2）、MCP、LSP、Monitor 与 Agenda 已使用显式 argv、
`shell:false` 和 fresh contract；合同测试逐入口覆盖，Ubuntu real-bwrap live 验收 generic
primitive、workspace/outside marker、socket `EPERM`、RPL hash chain、FD 清理与父进程/
wrapper 退出后的 descendant teardown。并非每个生产调用面都有独立 real-bwrap E2E。

同一发布线新增窄型 dynamic ELF：接受受检架构的动态 `ET_EXEC` 与 PIE `ET_DYN`，固定
`PT_INTERP` 和 entry 的直接 `DT_NEEDED`，且每个 SONAME 必须唯一落入已 attested/pinned 的
Node system runtime mount set；entry executable 继续使用内容 snapshot。RPATH/RUNPATH、
audit/filter/textrel 等扩大 loader surface 的元数据、歧义/越界依赖均 fail-closed。该证据只声明
initial direct-system-set，不声明 transitive dependency、`dlopen`、hwcaps 或任意运行时加载闭包。

[CLI Strict Sandbox run 30346500650](https://github.com/chainlesschain/chainlesschain/actions/runs/30346500650)
的精确 workflow `head_sha` 是 `9c01ee579a`，并通过 Ubuntu 24.04、macOS 15、Windows 三个
job；Ubuntu 从官方
release tarball 按固定 SHA-256 构建 bubblewrap `0.11.2` 并完成 Linux-only live step。该远端
证据只覆盖当时已提交源码。随后候选依次落到 `cd84dcf558`（background/PTY hardening）、
`75c8941561`（workspace authority）、`e4ca7d7402`（Desktop local-root attestation）和
`a5fbad16e9`（格式化）；复核时 `github/main`、`gitee/main` 与本地 HEAD 均为
`a5fbad16e9`。`75c8941561` 的
[CLI Strict Sandbox run 30359746705](https://github.com/chainlesschain/chainlesschain/actions/runs/30359746705)
与
[CLI CI run 30359749408](https://github.com/chainlesschain/chainlesschain/actions/runs/30359749408)
均因同一组 15 个跨平台用例失败，不能作为发布证据。`a5fbad16e9` 的
[CLI CI run 30363400698](https://github.com/chainlesschain/chainlesschain/actions/runs/30363400698)
已成功；其
[CLI Strict Sandbox run 30363400214](https://github.com/chainlesschain/chainlesschain/actions/runs/30363400214)
中 macOS、Windows job 成功，Ubuntu contract 为 857 passed / 14 skipped / 0 failed，但
Linux live 为 5 passed / 4 skipped / 3 failed：direct Plugin background 活动期出现标准
stdin sentinel `/dev/null`，generic final-target 与 interactive PTY 则因 runner 根挂载仍为
shared 而在 private-only preflight fail-closed。后续发布线分别收窄活动期 authority
断言、保留 teardown 后全部 FD 零增长，并在一次性 Ubuntu CI VM 上执行
`mount --make-rprivate /` 后验证 `/`、`/tmp`、`/usr`、`/etc/hosts` 与 workspace 的传播状态；
这些修复不在 `a5fbad16e9`，随后已由 `e7b9d86a00` 的 CLI CI 与 CLI Strict Sandbox 最终双门
证明；详见后文。
generic workspace 审计继续诚实记录
`contentSnapshot:false`、`handleAtomic:false`、`mountTopologyAtomic:false`；当前 private-only
attestation 阻止已证明 source 的后续 mount propagation，但 final-check→spawn 仍不是原子边界，
具备宿主 mount authority 的特权 actor，以及 root-owned bwrap/setsid/loader/system runtime/config
仍属于 TCB。

**2026-07-29 发布候选 `e7b9d86a00` 实现与验收完成**：

- `BackgroundTaskManager` 在 Linux 持久化 canonical workspace/cwd 与冻结 filesystem/network
  boundary envelope，start 时重新证明 policy/root 未漂移；trusted worker 移除
  `process.execArgv` 与 `NODE_`/`PYTHON*`/`LD_`/`DYLD_` 等注入面，再以 async contract 执行
  显式 shell。非 Linux、不支持 boundary、无 contract 或 envelope/root 漂移均在持久化或
  command spawn 前 typed fail-closed
- generic policy probe 增加 10 秒 availability 上限，mount attestation count/candidate evidence
  继续有界；每个实际 bind source（workspace、system directories 与 exact `/etc` files）的
  deepest containing mount 和 descendant mounts 都必须是 private。`shared`、`master`、
  `propagate_from`、`unbindable` 或未知 mountinfo optional field 均 fail-closed；审计绑定
  `sourceMountSetDigest` 和 `sourceMountPropagationPrivateAtAttestation:true`。生产 admission
  没有为 CI 放宽；一次性 Ubuntu runner 必须先把根 namespace 设为 `rprivate`，再逐个验证实际
  source，shared source host 若未完成该 provisioning 会继续拒绝强路径
- Agent `run_shell {run_in_background:true}` 对 generic 强策略使用 async one-shot contract、
  `detached:false` 与 bwrap supervisor tree teardown；direct policy-bearing Plugin bin 也以
  绑定 executable identity 的 `sync:false` one-shot contract 支持 async/background，spawn 后
  父端立即关闭 pinned descriptors，完成/取消/异常均由 Broker 回收整棵进程树
- attached background session 停止时不再只杀直接 child：POSIX 优先终止进程组并在必要时回退
  leader，Windows 则通过 Broker 以 `shell:false` 执行 `taskkill /PID <pid> /T /F`；拒绝或失败会
  返回 typed stop failure，不会误报整树已停止
- Hooks v2 由 host bootstrap 注册 canonical root，以 `AsyncLocalStorage`
  绑定不可由 hook/event/model/plugin payload 覆盖的 root，接通 headless、stream、整个 REPL
  与 WS turn。durable binding format v3 把 canonical root、`dev/ino` 与 generation 纳入
  domain-separated opaque ID；generation 优先使用 `birthtimeNs`，不可用时以会导致保守失效的
  `ctimeNs` 回退。恢复只解析当前进程由 host 注册且在解析/使用/release 时重新验真的 binding，
  删除、同路径替换或缺失均 typed fail-closed；非默认或隔离 WS worktree 跨进程重启若无宿主
  重新注册仍会 fail-closed
- CLI generic PTY 在 Linux 以 one-shot workspace contract 进入 Broker；Broker 分配专用
  controlling terminal，把 slave descriptor 映射到 child stdin/stdout/stderr，并以
  descriptor-pinned `/usr/bin/setsid --ctty` launcher、empty-root bwrap、mount topology
  attestation 与 fail-closed cleanup 兑现 filesystem/network 边界。master 写队列有 1 MiB
  backpressure 上限，并以非阻塞同步 write 避免 close 后 FD reuse race。master 的 `close`/
  `error` 会立即标记 disposed、清空 FD/队列/pending/immediate；write、queue 与 resize 在 native
  非重试错误或 closed/destroyed 状态立即失效，listener/setup 异常会 kill child 并释放 pipe，
  防止 OS 重用同一数值 FD 后被旧对象误写
- Desktop 数据库 V8 migration 增加 `root_path_local_attested`、CHECK/guard trigger 与启动期
  invariant；历史未证明 `root_path` 被隔离到 `pc_root_path`，迁移或 invariant 失败即 typed
  fail-hard。新项目 ID 必须是安全 portable 单段名，并先做 NOCASE DB/canonical owner 冲突检查，
  再排他创建 leaf；事务只回滚本次成功保留的目录，existing-project repair 也必须证明 exact
  ownership。AI/chat/code/planning 与 repair 的 marker-0 根同样使用排他创建
- Desktop PTY 只接受数据库中本机选择、marker-1 attested 的 canonical `root_path`。远端
  `project.init`、Mobile Bridge create/update/path sync、remote handler/field mapper 均不能创建、
  覆盖或提升该 authority；legacy cwd 仅是 DB lookup selector。外部项目 cache 使用随机 leaf，
  每次读、拷贝、RAG、验证、淘汰与清理均重新证明 realpath/lexical containment，历史越界 cache
  不会被读取或 unlink。Web/mobile 按 project 分区；共享设备 WS capability 仍不是 per-client
  principal/project-membership ACL

**2026-07-29 发布门阻塞修复（`d746beeb06`、`e7b9d86a00`）**：

- `d746beeb06` 修复 Node 22 下 Hook 子进程已经产生有效输出、但 `spawnSync` 同时返回整数
  `status` 与 stdin `EPIPE` 时被误判失败的问题。仅在存在整数 exit status 时把 `EPIPE`
  视为 stdin transport 结果并继续正常退出协议：status 0 输出保留、status 2 block 语义保留，
  null status 与其他 spawn 错误继续失败
- `e7b9d86a00` 移除 Broker 对 ESM Hooks v2 runtime 的同步反向加载环。旧路径既查找不存在的
  `hooksV2` 导出，又会建立第二份模块图、CredentialTransport Worker 与 Unix listener，造成
  generic background 稳态多出 FD/socket。默认 Hooks runtime 现显式注册为 Broker event sink；
  单元测试验证事件转发，Linux live 回归验证首次 Broker 执行后精确只有主 credential endpoint，
  且两次 generic background 后 endpoint、worker thread、listener 集合不变，相对预热基线
  FD 精确零增长

Dynamic ELF 证据仍只覆盖 initial `PT_INTERP` + direct `DT_NEEDED` system set，不证明
transitive、`dlopen` 或 hwcaps 完整闭包；empty-root 缺库会加载失败，而不是读取任意宿主文件。
Plugin regular-file tree 是逐文件 snapshot，不是整树同一瞬间快照，也未绑定签名/SBOM；
launcher/loader/system chain 仍是 `handleAtomic:false`。Strong PTY 内 `cd` 不能越过固定
namespace root，因此不是隔离残项，但策略不会随目录动态发现或放宽。非 Linux strong PTY、
packaged Linux Electron ABI/live、shared source host 的 private-topology provisioning 与
per-client ACL 属于后续兼容性、部署或产品边界工作。具有同 UID 文件系统/mount 权限的 actor、
本地主数据库/backup attestation、root-owned bwrap/setsid/loader/system runtime/config 和主动
`setsid`/detached 的 unsandboxed 后代仍属于已声明 host TCB；AI/repair 排他建目录成功后若 DB
marker 写入失败，可能留下 marker-0 orphan，但后续同名创建会 fail-closed，属于可用性而非
authority 提升。

本机验证覆盖 Desktop 9 个文件 257/257；background supervisor 为 34 passed / 1 skipped，
raw PTY 聚焦为 2 passed / 2 Linux-only skipped。与当前 Strict workflow 一致的 30 文件选择为
898 passed / 5 skipped / 4 failed；4 项均来自 Windows 本机真实 helper 的目标 application path
包含 reparse component，不能计作通过；随后已由 `e7b9d86a00` 托管 Windows job 复验通过。
生成进程清单共 314 项：
runtime 228、tooling 56、test 30；runtime 中 brokered 164、audited 27、nonexec 37、
`unreviewed:0`，drift check 通过。最终有界安全复核未发现残余 blocker/high/medium。

最终发布证据：
[CLI CI run 30378915792](https://github.com/chainlesschain/chainlesschain/actions/runs/30378915792)
与
[CLI Strict Sandbox run 30378915392](https://github.com/chainlesschain/chainlesschain/actions/runs/30378915392)
的 workflow `head_sha` 均为 `e7b9d86a00ae93dd614b09e498253ae0d26b481f`。CLI CI 共
53 个 workflow job：52 success、1 个条件式 `dry-run-publish` skip、0 failed/cancelled；48 个
Ubuntu/macOS/Windows unit/integration/e2e 分片、`pack-linux-dryrun` 与三平台 `verify-cli`
全部通过。CLI Strict Sandbox 三个 job 全绿，精确计数为：

- Ubuntu 24.04 contract 895 passed / 16 skipped，live 8 passed / 4 skipped
- Windows contract 906 passed / 5 skipped，live 5 passed / 7 skipped
- macOS 15 contract 890 passed / 21 skipped，live 2 passed / 10 skipped

六组均为 0 failed。Ubuntu live 同时验收 `rprivate` source topology、direct/generic
background、generic PTY、raw PTY EIO/FD reuse、精确单一 CredentialTransport listener，
以及活动期 authority 与 teardown 后全部 FD 零增长；contract gate 验收 Hook EPIPE 协议与
默认 Hooks runtime event sink。因此 P1-4/P1-9 的实现与精确 SHA 发布门完成。

**2026-07-27 P1-9 非直接执行面与 Desktop PTY 增量**：`7ae04a47e8` /
`860bc7a0fc` 固定 `run_code` policy 并让未缓存 Python discovery 在严格策略下前置拒绝，
`e43f078a01` 固定整条 slash/REPL bang macro 的 policy，`764c0e0845` 固定 CLI PTY 的
workspace root + create cwd；`543c877cd2` 在 BackgroundTaskManager create/start 双时点
检查并拒绝无法沙箱化的任务，`770b07aa33` 则让 Desktop PTY collector/broker 缺失或边界
不可满足时 fail-closed。`80fbe06e25` 只是 Python cache reset shim 的 CI 兼容修正。
`3f46fd1105` 进一步把 Agenda command monitor 绑定到 schedule-time trusted workspace，
并让 legacy unbound entry、hard shell deny 与 policy/sandbox error 在 spawn/匹配前 fail-closed；
`a650cd6c9e` 只修复共享 CJS hook runner 的测试污染。上述提交关闭了静默 policy bypass，
但在该批次当时不等于 generic PTY/background/Monitor 强 backend；Desktop 当时的
singleton 仍以 `process.cwd()` 固定 root，尚无权威 active-project binding。后续状态以上方
2026-07-29 发布候选验收为准；CLI/Desktop 交互 shell 内 `cd` 后仍不能重算。`130acdfa9c` 同时补齐 Forge 的 CLI runtime/vendor
依赖闭包与真实 import gate。P1-4/P1-9 在该批次当时均继续保持 🟡；这些非直接执行面改动的远端 strict
证据以全绿的 run 30263304582 为准；static-PIE-shaped 增量则由全绿的 run 30271575856 验收。
Linux static native entry snapshot 由全绿的 run 30275966482 验收。

**2026-07-26 P1-10 完成**：对 Critical / Durable / Advisory 状态逐项复核，
并移除关键路径的“锁失败后无锁继续”。既有 `ApprovalAuthorityStore` 已具备锁内
CAS revision、临时文件 fsync/rename 和损坏拒绝；side-effect ledger、turn binding
与 JSONL session append 已默认 fail-closed。Agenda/Event Runtime 的 lease/fence
保持不变，legacy Cowork cron 新增持久 `deliveryId`、owner、lease、续租与 fence
结算，两个 scheduler 对同一 fire 只会有一个 owner，过期 owner 不能续租或覆盖后继
结果。Goal、config、feature flag 与 MTC batch 的读改写也不再在锁不可用时继续。

安全元数据统一采用锁内严格读取和同目录原子替换：plugin trust、capability consent、
plugin option secret-ref、project MCP trust、MCP OAuth token、sync credential vault
与 LAN pairing token 遇到锁失败、损坏文件或持久化失败都会保留旧状态并报错；项目
`.mcp.json` 的 trust service/首次 fingerprint 无法持久化时不再继续加载可执行配置。
VS Code 与 JetBrains 共享的 `ide/session-index.json` 改用完全相同的原子 `.lock`
目录协议，写入前严格解析，锁超时或损坏时均不覆盖；VS Code 8 个真实并发进程写入
回归无丢记录，JetBrains 定向测试通过。本轮 CLI 关键状态/Plugin 组合回归
37 文件 775/775，VS Code 3/3，JetBrains `IdeSessionIndexTest` 通过。

**2026-07-26 P1-11 完成**：结构化输出从自研 Draft 2020-12 子集切换到直接依赖的
`Ajv2020` 与 `ajv-formats`，完整 meta-schema、动态作用域 `$dynamicRef`、嵌套 `$id`、
`unevaluatedProperties`/`unevaluatedItems` 及跨 applicator evaluated-location 语义由标准
引擎统一执行。适配层继续输出既有的 `code`/`keyword`/RFC 6901 `instancePath`/
`schemaPath`，并保持 key-order-independent `sha256:` digest 与终态
`structured_result` 协议；digest 同时绑定已解析外部文档内容，远端契约变化不会继续
冒用旧摘要。无效 schema 或未解析引用会在任何模型调用前编译失败。

`--json-schema` 的文本、单轮 `stream-json` 和输入流三条真实入口现共用预解析 loader。
相对本地引用只允许落在根 schema 目录（含 realpath 检查）；自动远程引用只允许无凭证
公网 HTTPS，复用 DNS pinning/重绑定与 private/metadata SSRF 防护，并限制最多 32 个
文档、单文档 1 MB、总计 4 MB 和 10 秒请求超时。远程文档不能反向跳转到本地文件，
HTTP、私网、凭证 URL、目录逃逸、损坏文档、预算超限与未闭合 graph 均 fail-closed。
复杂 `allOf + unevaluatedProperties`、重叠 properties/patternProperties、
prefixItems/unevaluatedItems、递归 dynamic ref、本地/递归 HTTPS ref、SSRF 与预算回归
已加入；本轮定向 3 文件 90/90 通过。

### Hooks v2 producer 验收结果（40 项事件 registry）

Hooks v2 当前注册 40 个生命周期事件、5 种公共 executor 和 trusted JS executor。运行时支持 programmatic
`registerHook`/`executeHooks`，默认并行执行、按 hook id 去重，并保留
`parallel: false` 的顺序兼容模式；JS handler、Broker `spawnSync`、IPC agent
注册状态和 Context Source Ledger 兼容适配均已纳入 M5 E2E。

2026-07-22 实测：`npm run runtime:test` 的 convergence 11/11、M5 E2E 22/22
全部通过；新增 Vitest 回归 3/3。该结果证明运行时兼容层和端到端链路可用，
不代表 40 个事件均已有真实 producer，也不代表跨平台强文件写沙箱已完成。

2026-07-26 producer 复核：此前 `PostToolUseFailure`/`FileChanged` 只有未调用 helper，
现已接入真实顺序与并行 tool loop；每批只发一次 `PostToolBatch`。`FileChanged`
支持 `glob`/`globs`/`paths`/`if` 的跨平台路径过滤。手动与自动压缩会发
`PostCompact`；Desktop/WS 与 headless MCP 通道会成对发
`Elicitation`/`ElicitationResult`（并保留 `MCPElicitation` 兼容事件）。
Setup 已接到 stream 与一次性 headless 启动门并 fail-closed；UserPromptExpansion
会在模型调用前合并唯一 prompt 更新与附加上下文，冲突时拒绝本轮。停止 hook 的执行错误、
畸形决策和断路器打开会发 `StopFailure`；团队调度器在成员从运行态真实回到空闲态时发
`TeammateIdle`，初始化空闲与重复空闲不会误报。

同日 managed policy 复核：Hooks v2 的 command、HTTP、MCP、prompt、agent 与 trusted JS
统一进入 executor policy gate；shell mode 默认拒绝，支持 command/workspace/MCP tool/
agent/skill managed allowlist，MCP tool 默认要求共享权限 authorizer，prompt/agent/MCP
delegated executor 受独立硬超时。Hooks v2、旧 settings Hook、CLI Hook Manager 与 Desktop
Hook 现在只继承 PATH/临时目录/系统定位等最小环境；额外变量必须同时出现在管理员 allowlist
和 Hook 自身请求中。平台级“不可写出工作区”要求 Broker 执行计划声明并实际强制 filesystem
边界；Windows Broker 已由零 capability AppContainer 和真实 CI 提供可证明的强
filesystem/network backend，Linux 通用 Hook backend 在该批次当时尚未完成，因此 P1-4 当时仍保持进行中。

- [x] Setup（启动前依赖检查）
- [x] UserPromptExpansion（输入预处理）
- [x] PostToolUseFailure（工具失败）
- [x] PostToolBatch（工具批量完成）
- [x] PermissionDenied（权限拒绝）
- [x] StopFailure（停止失败）
- [x] FileChanged（文件修改，支持 glob）
- [x] PostCompact（上下文压缩后）
- [x] TaskCreated / TaskCompleted（子任务生命周期）
- [x] Elicitation / ElicitationResult（问答交互）
- [x] TeammateIdle（多 agent 协作空闲）

### Parity 验收门子项（9项）

- [x] CLI contract/policy/unit 测试
- [x] CLI real envelope E2E 测试
- [x] Desktop hosted-tools integration
- [x] Desktop lifecycle integration
- [x] Desktop ↔ real CLI bridge
- [x] Renderer store 集成
- [x] SDK protocol fixtures
- [x] `docs:cli-reference:check`
- [x] `docs:protocol:check`

**统一运行入口**：仓库根目录执行 `npm run test:coding-agent:parity`。
2026-07-22 实测 10/10 steps passed（约 166 秒）；CLI runtime units 658 个、CLI envelope E2E 10 个、
Desktop coding-agent core 134 个、Desktop lifecycle 24 个、SDK protocol/agent-session 27 个等均通过。

---

## 🟢 P2 任务（差异化方向，按需执行）

| #     | 任务                     | 说明                                                  |
| ----- | ------------------------ | ----------------------------------------------------- |
| P2-14 | 全工具文件回滚           | Process Broker 捕获所有文件写入，支持 checkpoint 回滚 |
| P2-15 | Auto mode 安全分类器     | 危险操作自动识别评测集                                |
| P2-16 | 大规模 Agent Teams       | 多 agent 协作扩展                                     |
| P2-17 | 标准 OTel Collector 出口 | ✅ 完成（2026-07-29），兼容生态可观测性工具           |

### P2-17 状态：✅ 完成（2026-07-29）

- **标准协议**：真实 binary 支持 traces/metrics 的 OTLP/HTTP JSON、OTLP/HTTP protobuf、
  OTLP/gRPC，消费标准全局/分 signal endpoint、protocol、headers、timeout、compression、
  service/resource attributes 环境变量。
- **企业传输**：HTTPS/HTTP2 mTLS 支持 CA、client certificate/key；自定义 headers 不可覆盖
  content framing 或 gRPC pseudo headers。
- **可靠性**：有界 queue/batch、queue pressure、`Retry-After`/指数退避、最大尝试、
  dropped/permanent failure 计数、原子 crash spool 与死亡 owner 恢复闭环。
- **真实接线**：agent/eval/team recorder 进入 Collector，正常或失败退出均 final flush；
  team 输出 task/token/USD/failure/completed 聚合并保留 workflow 维度。
- **隐私与运维**：内容默认不进入 recorder，离机 string 继续脱敏；`cc status --json` 暴露
  protocol、endpoint、queue/retry/drop/recovery/spool 状态。
- **证据**：`otlp-collector-exporter.test.js`、`otlp-cli-entrypoint.test.js`、
  `headless-runner-otlp.test.js`、`status-observability.test.js`。

---

## ✅ 已完成（M0-M6 + P0/P1）

- [x] **P0-1 Broker async/sync/PTY 凭据边界 + macOS Seatbelt/Linux 执行计划**
- [x] **P0-1 Ubuntu/Windows/macOS strict native boundary 真实 CI 矩阵**
- [x] **P0-1 Windows AppContainer 强 filesystem/network backend 与真实 live CI**
- [x] **P0-2 CLI 当前 turn 提问/回答/继续核心链**
- [x] **P0-2 pending/settlement 持久 journal、断线重放与 worker 丢失 exactly-once 拒绝**
- [x] **P0-2 Desktop/VS Code/JetBrains/Web Panel/Remote Control/SDK authority/binding 收口**
- [x] **P0-2 Ubuntu/Windows/macOS 真实断线→重连→回答→同 turn 完成 E2E**
- [x] **P1-5 MCP Elicitation form/URL/defer、完成通知与 `-32042` exactly-once retry**
- [x] **P1-6 Event Runtime 真实 binary lifecycle、跨进程 host health 与崩溃恢复演练**
- [x] **P1-7 Context 双层 Skill cache、交互式快照与按需/命中/注入成本归因**
- [x] **P1-8 Headless/REPL 统一 turn binding、provider id 与 child/worktree/user-edit 归因**
- [x] **P1-9 policy-bearing Plugin bin/native 直接 Broker 身份绑定与审计**
- [x] **P1-9 Linux 直接、前台、同步 policy-bearing Plugin Node bin 的 bwrap empty-root、FD mounts、seccomp 强 filesystem/network live CI**
- [x] **P1-9 Linux 直接、前台、同步 policy-bearing 静态 ELF64 `ET_EXEC` 与窄型 static-PIE-shaped `ET_DYN` Plugin native 的格式验真、bwrap 强边界与 live CI**
- [x] **P1-9 Linux 窄型静态 Plugin native entry-executable snapshot、独立 OFD 与同 inode plan→spawn race live CI**
- [x] **P1-9 Linux 窄型 dynamic `ET_EXEC`/PIE `ET_DYN` 的 interpreter + direct-system-set 绑定、entry snapshot 与 live CI**
- [x] **P1-4/P1-9 Linux Hook/MCP/LSP/Monitor/Agenda generic workspace contract gate + primitive live**
- [x] **P1-9 `run_code`、slash/REPL bang 与 CLI/Desktop PTY 的 pinned policy/upfront denial**
- [x] **P1-9 `e7b9d86a00` 发布候选 Linux BackgroundTaskManager/Agent generic background 与 direct Plugin async/background 强路径**
- [x] **P1-9 `e7b9d86a00` 发布候选 Linux CLI generic PTY 与 Desktop DB-root PTY 专用 controlling terminal 强 backend**
- [x] **P1-9 raw PTY close/error/native failure 的立即失效、队列清理与 FD reuse 阻断**
- [x] **P1-9 attached background session 的 POSIX process-group / Windows brokered `taskkill /T` 整树停止**
- [x] **P1-4 `e7b9d86a00` 发布候选 Hooks v2 headless/stream/REPL/WS async-scoped trusted root 与 format-v3 generation-bound durable opaque host binding**
- [x] **P1-9 `e7b9d86a00` 发布候选全部实际 bind source 的 private-only mount propagation attestation，生产端保持 fail-closed**
- [x] **P1-4/P1-9 Hook stdin EPIPE 协议与 Hooks↔Broker 模块环/重复 Credential Worker 发布门阻塞修复**
- [x] **Desktop V8 本机 root attestation invariant、历史根 quarantine、NOCASE/exact-owner 排他创建/重绑**
- [x] **Desktop 远端 init/sync 执行根投毒阻断、外部 cache containment；远端 metadata 不能写入本机 `root_path`**
- [x] **P1-9 Windows 窄型 Plugin Node `.cjs` entry-source snapshot、可信环境、成对 identity 与 policy digest**
- [x] **Desktop Forge CLI runtime/vendor 闭包、DB project binding/session partition、Linux 强 PTY 与非 Linux strict PTY fail-closed**
- [x] **P1-10 Critical/Durable 状态 fail-closed、Cowork delivery fence 与跨 IDE session lock**
- [x] **P1-11 Draft 2020-12 标准引擎、启动期 graph 编译与受限 local/HTTPS refs**
- [x] **P1-12 TypeScript/Python SDK、共享 fixture、GitHub Actions 示例与 Python 0.1.0 基线 PyPI 发布**
- [x] **2026-07-21 历史主仓验证**：当时的 Code Quality、CI Tests、E2E Tests 与 Full Test Automation 通过；仅作历史证据
- [x] Notification Hook 事件（2026-07-20）
- [x] M0: `process-execution-broker` 单例 + spawn 审计清单
- [x] M0: parity 验证脚本 + `npm run runtime:convergence`
- [x] M1: Broker 支持所有 origin 类型
- [x] M1: 现有入口接入审计（hook-manager）
- [x] M2: `agent-ipc-bus` 后台 Agent 实时 IPC 总线
- [x] M3-1: Hooks v2 框架（40 个生命周期事件 + 5 种公共 executor + trusted JS）
- [x] M3-2: Event Runtime 常驻框架（emit/subscribe）
- [x] M4-1: Context Source Ledger 来源记账
- [x] M4-2: Turn binding schema 全透传
- [x] M5: `--jsii-runtime` + `--otlp-endpoint` 全局参数
- [x] M5: 端到端 parity 验证脚本
- [x] M6: 收敛设计文档 `docs/implementation-plans/CLI_RUNTIME_CONVERGENCE_ADR.md`
- [x] M6: 四层模块边界严格定义
- [x] **发布门：精确实现 SHA `e7b9d86a00ae93dd614b09e498253ae0d26b481f` 的 [CLI CI run 30378915792](https://github.com/chainlesschain/chainlesschain/actions/runs/30378915792) 与 [CLI Strict Sandbox run 30378915392](https://github.com/chainlesschain/chainlesschain/actions/runs/30378915392) Ubuntu/Windows/macOS 全矩阵通过**

---

## 近期里程碑

| 顺序             | 目标                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **实现完成**     | Linux generic/direct Plugin background、CLI/Desktop strong PTY、raw PTY FD 失效、attached-session tree stop、Hooks v2 format-v3 WS/durable binding、private mount attestation、Desktop V8 root invariant/排他创建/cache containment，以及 `d746beeb06`/`e7b9d86a00` 发布阻塞修复；聚焦回归、安全终审与生成清单已通过                                                                                                                                                        |
| **远端历史**     | workflow `head_sha` `9c01ee579a`：Linux generic workspace primitive 与 Hook/MCP/LSP/Monitor/Agenda contract gate、窄型 dynamic direct-system-set；run 30346500650 三平台 Strict 全绿，仅覆盖当时源码                                                                                                                                                                                                                                                                        |
| **失败候选历史** | `a5fbad16e9`：CLI CI run 30363400698 成功；CLI Strict Sandbox run 30363400214 的 macOS/Windows 成功、Ubuntu contract 全过但 live 3 项失败。后续候选修复不在该 SHA，不能借用其结果                                                                                                                                                                                                                                                                                           |
| **发布门完成**   | 精确实现提交 `e7b9d86a00ae93dd614b09e498253ae0d26b481f` 的 [CLI CI run 30378915792](https://github.com/chainlesschain/chainlesschain/actions/runs/30378915792) 与 [CLI Strict Sandbox run 30378915392](https://github.com/chainlesschain/chainlesschain/actions/runs/30378915392) 全绿；48 个测试分片、Linux pack dry-run、三平台 `verify-cli` 和 Strict 三平台均通过，并覆盖 `rprivate` topology、background/PTY、raw PTY、Hook EPIPE、单一 Credential Worker 与 FD 零增长 |
| **非阻塞后续**   | Dynamic transitive/`dlopen`/hwcaps assurance、tree/launch handle atomic、mount final-check→spawn 原子性、非 Linux strong PTY、packaged Linux Electron live/ABI、shared source host private-topology provisioning、Desktop per-client ACL                                                                                                                                                                                                                                    |

---

## 参考文档

- 差距分析：`docs/CLAUDE_CODE_CLI_CURRENT_GAPS_AND_OPTIMIZATIONS_2026-07-18.md`
- 架构收敛：`docs/implementation-plans/CLI_RUNTIME_CONVERGENCE_ADR.md`
- Parity 验证：`desktop-app-vue/scripts/verify-coding-agent-parity.js`
- P0-1 沙箱详细进度：`packages/cli/P0_CLI_SECURITY_PROGRESS.md`
