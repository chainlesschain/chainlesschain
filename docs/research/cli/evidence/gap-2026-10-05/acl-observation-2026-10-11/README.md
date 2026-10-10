# LowBox scratch ACL 只读兼容观察（2026-10-11）

一次实际 Windows 10 x64 / Node 22.22.2 运行：普通非管理员、未受限 host 启动零 capability LowBox。actor 在自己胶囊的 scratch 中创建固定目录，实验 adapter 无参数入口只通过当前线程持有的本地 HANDLE 调用 `GetSecurityInfo`；不接受任意路径、不使用宿主代开或 `WRITE_DAC`，不修改 namespace，不访问 D 盘。

读取成功（Win32 error 0），owner 为当前用户；DACL present、非 null、未 protected。三个 ALLOW ACE 均为 flags `0x13`（OI / CI / INHERITED）：用户 `0x1f01ff`、SYSTEM `0x1f01ff`、当前 AppContainer `0x1301bf`。原 owner-only 合同结果 **FAIL**，整体 **NOT_ADMITTED**；诊断执行 exit 0 表示完整记录负观察，没有将权限合同标为通过。

前后线程/PID、有效 primary token、无 impersonation、capability 0、FileId/卷号/NT name 观察一致。原 root HANDLE wait 0 / exit 0、Job 0、profile 删除，host map 未变；只启动 root，launchRequests 0。14 份 source、3 个本机 binary、7 对运行副本前后绑定并独立重新核验。未再次实际运行；没有尝试 PowerShell，旧 `windows-acl:spawn` 拒绝原因仍未定位，也没有执行完整冻结 journal/review。

源码来自冻结 `22ef588c1bb8f71c45feaa115df1d75d5ca505c5` 的独立副本。实验 adapter 仅接入 `aclapi.h`、新只读 header 和无参数 export；其余八份原 native/CJS 源逐字节相同。实验没有进入已发布 CLI 或 IDE 的工程源码。编译器闭包非 hermetic；二进制留在 `.work`，提交其摘要绑定和必要源/原件，不声称完全可重建。

[46 份无损 gzip 原件索引](./manifest.json)保存 source、driver、actor、verifier、构建输出、原始报告及完整 ACE 字节；[独立回读](./archive-validation.json)核验压缩/解压双摘要、原件逐字节相同，并按原始 ACL 重新解析 owner-only FAIL。新目录默认继承的 ACL 不满足合同；本次没有设置 ACL，因此不推断设置后结果或将其视为 owner-only 语义无法实现的证明。

正式 36 tasks + 9 firstRuns、$99、observations、旧 Windows 211=194/16/1、mutants 6/4/4、新 fixture 211=208/2/1、junction 与完整 review 的 NOT_ADMITTED 均未改写。受保护存储/持久 authority、官方账单、独立人工/辅助技术和长时验收仍开放，无付费 provider 调用。
