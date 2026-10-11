# Windows owner-only ACL 合同与 LowBox 直接 I/O

在本机 Windows 10 x64 / Node 22.22.2 的独立实验中，当前 owner-only 合同与零 capability AppContainer 的直接文件访问发生冲突。LowBox 自己申请 `WRITE_DAC` 返回 Win32 5；另一次由普通宿主预先收窄固定实验对象后，LowBox 的六项实际路径操作全部返回 Win32 5。两项实验各自证明不同事实，不能把第一项写成 LowBox 已成功设置 ACL。

所有实验仍为 **NOT_ADMITTED**。没有修改正式包、冻结计划、原始完整 review、默认 adapter 权限范围或生产 owner-only 合同，没有给 actor 增加 AppContainer ACE、capability、目标文件句柄、宿主文件代理或 PowerShell 执行权限。Windows/macOS durable 后端和受保护 journal 仍是未交付工程，不只是等待外部验收条件。

## 原件与范围

- [manifest.json](./manifest.json)：**140** 份 gzip 原件，共 **1,725,982** 原始字节，逐项保存原始及压缩后 SHA-256 和字节数。9 个实验二进制保留本机 `.work`，附准确摘要；不将本机 compiler closure 宣称为 hermetic。
- [archive-validation.json](./archive-validation.json)：全量解压、双摘要和原始字节匹配；独立诊断回读 **39** 项通过，包含 **64** 个源、二进制和复制产物绑定检查。
- `a/`：受限宿主拒绝；`b/`：LowBox 自己申请 ACL 设置权限；`c/`：宿主预设 owner-only 后的 LowBox 原生 I/O。
- 每轮保存 actor、driver、verifier、原始构建输出、准确源码、原冻结源码、diff、输入清单、原始 host/actor 输出、installed/exit 回执和完整 report。`checks/` 保留准备、归档、独立回读和变异检查代码。

三轮源基线均为 `53ad9df8c46269d725d2f3cde77185a5806e86da`。`b` 只在独立 adapter 副本增加固定无参数、一次性 ACL 探针；`c` 另在独立 broker 增加固定对象预设与终态只读回读。生产 native 源码没有因此改变。默认六个 IAT slots 保持；没有修改 reparse buffer、errno 或 DOS namespace。

## A：受限宿主没有启动 actor

UTC **2026-10-11 03:52:43.093 → 03:52:43.275**。broker PID 21444 在 `host-token` 阶段拒绝，status 2、rootPid 0，无 actor/ACL 结果。runner 随后因预期 actor 输出不存在记录 ENOENT；这不是 ACL 行为结果。没有 profile 或实际 Job 的成功清理证明，不能套用后两轮的结算。

## B：LowBox 不能取得 WRITE_DAC

UTC **03:53:49.145 → 03:53:56.112**，host PID 9508、root PID 11848、probe thread 28228。actor 自己新建固定 `X:\scratch\private-v4-owner-acl-probe` 和 `existing.txt`，以原有 `READ_CONTROL|FILE_READ_ATTRIBUTES` 句柄核对目录无 reparse、FileId、卷及 NT 坐标。

对同一固定目录申请 `WRITE_DAC|READ_CONTROL|FILE_READ_ATTRIBUTES`（`0x60080`）返回 **Win32 5 / ACCESS_DENIED**。没有取得设置句柄，`setAttempted:false`，`SetSecurityInfo` 未调用；原生字段 `setError:6` 是未调用分支的 `ERROR_INVALID_HANDLE` 初值，**不是 SET 的返回值**。设置后的重开/读写/创建/删除序列未执行，`operations:[]`。

原句柄前后真实 ACL 相同：owner 为当前用户；DACL 未 protected，用户与 SYSTEM FullControl、当前 AppContainer `0x1301bf` 三条继承 ALLOW ACE。精确 owner-only 合同仍失败。诊断 exit 0 表示完整记录了负结果。

## C：宿主预设 owner-only 后的六项真实拒绝

UTC **03:57:15.993 → 03:57:19.924**，host PID 21316、root PID 11348、probe thread 20192。普通非管理员、非受限宿主只新建本轮固定目录及文件，然后通过真实 HANDLE 收窄 DACL：

- 目录：protected DACL，唯一当前用户 FullControl ALLOW ACE，flags `OI|CI`。
- 文件：protected DACL，唯一当前用户 FullControl ALLOW ACE，flags 0。

宿主保存原始 ACL、owner/control、FileId/卷/NT 路径、设置后原句柄回读以及关闭设置句柄后的重新打开证明。`existing.txt` 的真实字节为 `owner-only-probe`，SHA-256 绑定。设置句柄在 actor 创建前全部关闭；仅宿主持有不可继承的 `READ_CONTROL|FILE_READ_ATTRIBUTES` 元数据句柄，share 为 read/write/delete。actor 精确继承列表仍为原 **9** 项，未加入目标对象句柄。

当前线程无 impersonation、零 capability 的 actor 自己调用原生 Windows API，得到：

| 实际操作 | 结果 |
| --- | --- |
| 重开目录（LIST_DIRECTORY/READ_CONTROL/READ_ATTRIBUTES） | Win32 5 |
| 打开并读取已有文件 | Win32 5，未进入 ReadFile |
| 打开并写入已有文件 | Win32 5，未进入 WriteFile |
| CREATE_NEW 新文件 | Win32 5 |
| CreateDirectoryW 子目录 | Win32 5 |
| DeleteFileW 已有文件 | Win32 5 |

actor 退出后，宿主重新读取对象身份、ACL 和已有文件摘要，均与预设后相同。没有把宿主读取当作 actor 的成功文件访问。

## 结算与验证限制

B/C 均有原 HANDLE wait 0/exit 0、root token 与同 Job 证明、Job activeProcesses 0、profile 删除、无 loopback exemption、host map 未改变、各一组 installed/exit 回执。源、二进制及复制产物在运行前后绑定，另由独立回读重算。进程/线程身份前后相同是观察，不代表连续 authority 或防置换证明。

独立回读最初在受限宿主读取 capsule 文件时 EPERM；批准普通宿主只读回读后，验证器曾误读 receipt 顶层而非 `receipt.adapter` 字段失败，修正后通过。两次早期工具失败没有伪造为实际 native 运行；最终 **39** 项包含真实报告、原始拒绝和身份/权限/操作/ACL/文件摘要的篡改拒绝。此处没有重新执行完整冻结 journal/review。

工程含义：放行 PowerShell 不能解决这个 ACL/I/O 冲突；附加 AppContainer ACE 会改变精确合同。保持现合同需要真正受限的宿主存储协议与受保护后端，或另行版本化调整存储合同和运行边界。这些后续工程尚未实现。旧 **211=194/16/1**、mutants **6/4/4**、新 fixture **211=208/2/1**、正式 **36+9 / NOT_RUN / INSUFFICIENT_EVIDENCE**、$99、observations、账号账单/独立人工/辅助技术/8h/24h/SLO 保持原状。
