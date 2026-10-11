# 固定 canary 的宿主只读 RPC 原型（2026-10-11）

本实验在 Windows 10 x64 / Node 22.22.2 的**普通非管理员、未受限宿主**运行一次，退出 0。在独立 `.work/owner-canary-rpc-20261011-a` 副本实现新的固定 canary 只读协议；冻结 native 基线为 `53ad9df8c46269d725d2f3cde77185a5806e86da`。生产代码及发行候选 `821c63eff2698c8625a7be596f935d658ce095cf` 未改，原 owner-only 合同、冻结 review、Node 二进制和六个 IAT slots 未放宽。

## 真实结果

- **9 次真实请求：1 success / 8 refused**。拒绝错 session、错 generation、错注册身份、未知操作、超过 64 字节上限、错 sequence、重放和第二次读取。
- 合法响应是宿主对固定 owner-only 文件执行真实 ReadFile 得到的 **16 字节 `owner-only-probe`**，不是编译常量回包。固定请求帧 152 字节、响应 96 字节，载荷最多 64 字节；拒绝响应载荷为空，拒绝分支未进行 RPC 文件读取。ACL/身份/摘要证明会进行额外宿主只读检查，不计作 RPC 读取次数。
- 每次请求从 actor 专用 pipe 进入，核验宿主持有的原 root process HANDLE、存活状态、同 Job/零 capability token、注册身份及 session/generation/sequence。PID 只用于观察，不作为可复用授权依据。
- actor 仍自行进行原六项直接路径操作，**6/6 均 Win32 5**。设置 ACL 的宿主句柄在 actor 创建前已关闭；新目标只读 HANDLE 由宿主持有且验证不可继承，actor 精确继承列表仍是原 **9** 项，未得到目标对象 HANDLE。
- 固定新目录与文件保留 C 轮精确 protected/唯一当前用户 FullControl ACE；目录 OI|CI，文件无继承。设置后、合法读取前后及 actor 退出后，原始 ACL、owner、FileId/卷/NT 路径与既有文件摘要一致。
- 原 root HANDLE **wait 0 / exit 0**，Job activeProcesses 0，profile 删除，无 loopback exemption，host map 未改变。父进程多余 pipe endpoint、服务端 pipe 和目标 HANDLE 均实际关闭。root 退出后记录的是**真实 channel closed**，没有伪造“退出后 server 拒绝”的请求或响应。

本轮仅对新胶囊内固定实验叶子设置 C 轮 ACL，未改 TEMP/home/仓库/旧实验对象 ACL。胶囊 `C:\Users\longfa\AppData\Local\Temp\cc-owner-canary-rpc-PFSYh6` 和全部证据保留，**没有递归删除**。构建 3 项均通过；本原型实际运行仅一次，没有早期原生失败被覆盖。此前 A/B/C 的拒绝仍独立保留在 [ACL 合同实验](../acl-contract-2026-10-11/README.md)。

## 独立回读与边界

独立静态回读 **25/25**：4 项原件/合同检查和 **21** 项有意义的篡改拒绝，核验 **51** 项源码、冻结 Git blob、二进制与运行复制绑定。负例包括伪造字节、错误 generation/sequence/replay、原 HANDLE/Job 不匹配、ACL 放宽、目标 HANDLE 被继承、WRITE_DAC 未关闭、读取中 FileId/ACL/hash 改变、root/Job/profile/通道未结算和虚报 durable。回读没有运行 native binary 或修改 ACL。这 25 项是静态原件与篡改回读检查，不是 25 次真实 RPC 或新的原生实跑；真实 RPC 仅为上述一次实跑中的 9 次请求。

每请求身份/存活检查及对象读取前后快照只提供对应检查时点的观测，未证明连续 authority，也未证明任意时刻终止或对象置换的 atomic fencing。前后快照一致不等于检查与读取之间所有时刻的连续稳定性。

该结果只证明一个新增的、固定对象的宿主读代理原型。它**不是 actor 原生文件能力、durable 后端、受保护 journal、完整 native review 准入或正式样本**；authority/连续稳定性未证明。写入/CAS、flush/replace、崩溃恢复/防回滚/撤销、服务自身保护和长期运行仍未完成。状态保持 **NOT_ADMITTED / durable=false**。正式 **36 tasks + 9 firstRuns / NOT_RUN / observed=0 / $99** 及冻结计划窗口不变，付费 provider 调用为 0。本机也不替代正式 Windows 11 24H2 / Node 22.12.0 宿主。

## 独立核验入口

在保留本机原件的工作区，仅只读回读（owner 权限读取胶囊文件；不会执行实验 binary）：

`node .work/verify-owner-canary-rpc-20261011.mjs .work/owner-canary-rpc-20261011-a`

归档完整性核验脚本及参数在 `archive-validation.json` 记录。`run.mjs build/run` 是构建/实际实验入口，**不是只读核验命令**；旧实验目录不得重跑或覆盖。

[manifest.json](./manifest.json) 保存 66 份 gzip 原件的压缩/解压 SHA-256、字节数与本机路径，覆盖 source/frozen/diff、actor/driver/verifier、构建 stdout/stderr、host/actor 原始输出、9 请求和完整结算。三个较大实验二进制不入 Git，记录准确 hash 和本机路径；Node/esbuild 运行复制亦有摘要绑定。编译器可执行文件与命令有绑定，但头文件/库/工具链闭包不宣称 hermetic。所有归档文件使用排他创建。
