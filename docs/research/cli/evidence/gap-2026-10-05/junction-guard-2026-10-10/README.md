# Junction 共享句柄方案的真实拒绝证据

本机 Windows 10 x64 / Node 22.22.2 独立实验，产品基线 `7ded47b376a028e669d2f7a3cad5aa47d5e798ab`。[清单](./manifest.json)保留 **119** 份 source/build/self-test/report、最终尝试/HEAD 原件和规范的无损 gzip，原字节与存储字节摘要均复核。尝试实现已撤回，五个运行源恢复为准确 HEAD blob，新测试保留后移除；没有向产品增加七槽兼容 profile。

[最终复核](./final-validation.json)重新校验本轮及 CI/source 回读的 **145** 份压缩原件，并逐字节核对五个产品源与 HEAD、实际 11 次 guard open 和两次失败运行的清理；未宣称兼容或完整 review 准入。

固定 libuv 对真实 mount point 的 `\??\Global\C:\...` substitute 拒绝，原完整 Windows review 因而仍漏认 junction。本次尝试仅在原 FSCTL_GET 成功后转换路径表示，不改 tag、磁盘或 errno，也不信任 PrintName；但所要求的源/祖先/目标防置换证明未成立，不能交付为已完成修复。

| 轮次 | 实际结果                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------- |
| a    | 四项编译成功；既有综合 self-test 在 private-realpath 返回 98，尚未进入新增 parser；未运行 AppContainer  |
| b    | 三项编译成功；parser self-test 因 unused function / `-Werror` 编译失败；未运行 AppContainer             |
| c    | 四项编译及独立 parser self-test 成功；未运行 AppContainer                                               |
| d    | 编译/parser 成功；真实 positive 在共享断言失败，尚未转换；零访问 held handle 不足，原具体权限数组未保存 |
| e    | 改用 FILE_READ_DATA held handle，编译/parser 成功；未运行 AppContainer                                  |
| f    | 编译/parser 成功；真实 positive 保存全部权限 open 结果后失败，尚未转换                                  |

f 的真实 Win32 error 如下，**0 表示成功打开**：

| 对象     | WRITE_DATA 2 | WRITE_ATTRIBUTES 256 | GENERIC_WRITE 1073741824 |              DELETE 65536 |
| -------- | -----------: | -------------------: | -----------------------: | ------------------------: |
| ancestor |           32 |                    0 |                       32 |                        32 |
| target   |           32 |                    0 |                       32 |                        32 |
| junction |           32 |                    0 |                       32 | 未探测，设计上共享 DELETE |

[Microsoft MS-FSA 合同](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-fsa/4aeefef8-92c3-4abc-af7a-a610caf8a165)的 granted-access 条件接受 WRITE_DATA **或** WRITE_ATTRIBUTES，因此此共享方案没有证明排除 reparse 修改。未用成功的属性句柄在 guard 持有期间尝试 SET，不能称为实际置换或漏洞复现；fixture 的真实 junction 由常规 Node API 创建，不能笼统说整个实验没有调用 SET。

d/f 均为 broker status 2、root exit 1；Job active 0、profile deleted、loopback absent、host map unchanged 及 cleanup true 均有记录。七槽安装成功，但 calls/candidates/mapped/untranslated 均 0；报告的 `reparseInspection.verified:true` 只核对零计数回执形状，不是兼容成功。outside/replaced、sync/async lstat/readlink/stat、unlink/rm、worker/esbuild 子进程及完整 frozen review 均未执行，不将计划中的断言记为通过。

采集 D 胶囊 control 时曾 EPERM，升级读取被用户中止且未重试；该错误只有工具记录，没有独立日志。actor/control 原文件未独立归档，仅保存已经取得的工作区报告及其中捕获的内容，不声称完整采集。编译二进制仍在本机，compiler closure 非 hermetic。

更窄的路径坐标等价方案有条件成立：相同根对象和 suffix 不要求返回后目标稳定；但现有材料未证明实际 Global C alias、卷至 rootDos 父路径以及 X 映射的相关不可重绑定条件。已有 root FileId/NT 和一次 LowBox map 拒绝不足以代替该证明，不能用于 authority fencing。兼容确认继续拒绝；owner-only ACL、skip、durable 后端与正式 36+9、账单/人工/长时验收保持开放，旧矩阵和 $99 不变，无付费调用或发布。
