# Windows AppContainer pipe 与精确文件 stdio 诊断

这是诊断工程归档，**不是原始准入证据或正式评测样本**。所有派生回执显式保留 `admissionEligible:false`、`formalSample:false`、`capabilities:{}`。七项历史 capability 的标识、顺序及失败结果未被修改。

## 实际观察

| 对照                                                                | 结果                                  | 能证明的范围                                                                                                                              |
| ------------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-07，普通主机，六项 Win32 API                                | 全部成功                              | 对照程序及调用在普通令牌下成立                                                                                                            |
| 同版本 Node/libuv，零 capability AppContainer，普通 libuv pipe 名称 | 三次 Win32 `ERROR_ACCESS_DENIED`（5） | 普通命名空间拒绝；libuv 固定源码将此错误作为碰撞重试                                                                                      |
| `\\.\pipe\LOCAL\` / `\\?\pipe\LOCAL\`                               | 创建成功                              | 仅创建；未证明连接、双向通信、IPC 或隔离反例                                                                                              |
| `NUL` / Node `ignore` stdin                                         | Win32 5 / `EPERM`                     | `UV_IGNORE` 的 NUL 打开被拒绝                                                                                                             |
| 历史 inherited/file stdin，文件 stdout/stderr                       | 子进程退出 0                          | 文件输出本身并非必然拒绝；历史 fixture 未读 stdin 内容                                                                                    |
| 2026-10-08 新增 `file-file-file`                                    | 成功                                  | 子进程实际读取 97 字节随机二进制 stdin，摘要及字节数匹配；stdout/stderr 独立内容、child/parent PID、runtime 与 3 个已关闭文件描述符均核验 |

新 all-file 诊断使用既有 v1 evaluator，单次 10 秒原生 Job；回执确认零 capabilities、无 loopback exemption、目标退出 0 和 cleanup。首次 restricted-token 尝试在 `windows_appcontainer_readiness_cleanup_unverified` 拒绝，保留其失败回执及 `stageRetained:true`，随后经工具权限流程以真实用户令牌成功运行。保留失败目录，不把失败清理宣称为已确认。

实际环境为 Windows 10 `10.0.19045`、x64、官方 Node `v22.22.2`、libuv `1.51.0`。该环境不能替代冻结的 Windows 11 24H2；没有执行 provider、完整 review pack、locked setup 或正式 36+9。

## 溯源与脱敏

- `*.redacted.json` 是包裹原报告的派生格式；`original` 记录私有 `.work` 原文件路径、长度及 SHA-256。原始文件保留在工作目录。
- 用户目录、AppContainer SID、监督者 SID 摘要被替换。报告内部 stdout/manifest 摘要继续指向**原始字节**，不能据此验证脱敏字节或将脱敏报告送入准入器。
- `readback.json` 记录归档文件摘要、测试结果及范围。`snapshot/` 保存实际诊断源码快照；`upstream/` 保存固定 Node commit 的两份 libuv 源码及官方发行 checksum 响应。`historical-readback.json` 保留原始历史摘要链。
- libuv `pipe.c` 的 `uv__unique_pipe_name` 使用普通 `uv` 命名空间；`uv__create_server_pipe` 在 `ERROR_ACCESS_DENIED` 下重试。`process-stdio.c` 的 `UV_IGNORE` 调用 `uv__create_nul_handle` 打开 `NUL`。这些源码与实测一起支持根因结论。
- all-file 成功报告绑定实际诊断脚本摘要。其 native helper 是 v1，归档包含重建前事后读取的 helper 二进制摘要；该摘要并非执行时完整源码证明。并行开发的 v2 capsule 尚未由本归档验证。

## 验证

`node-tests.tap`：32 项通过，零跳过。其中新增 18 项验证真实二进制文件 stdin 对照及摘要、stderr、身份、runtime、fd 清理、超时、manifest、capability/loopback/cleanup 反例。

```powershell
node --test packages/cli/test-node/windows-all-file-stdio-diagnostic.node-test.mjs packages/cli/test-node/windows-appcontainer-pipe-diagnostic.node-test.mjs
node packages/cli/scripts/windows-all-file-stdio-diagnostic.mjs --confirm-native --output NEW_ABSOLUTE_DIRECTORY
```

`archive.mjs` 记录此次归档算法，核验历史输入摘要和新成功回执后复制、脱敏并运行合同测试。其输出使用 `wx`，已有归档不会被覆盖；源码变化后也不会悄悄重新绑定历史证据。
