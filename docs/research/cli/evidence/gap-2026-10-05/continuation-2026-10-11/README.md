# 2026-10-11 ACL 启动诊断与 Memory 目录坐标检查

本目录记录未发行的八文件工程增量，基线为 `53ad9df8c4`，分支为 `feature/cli-ide-gap-20261011`。[manifest.json](./manifest.json) 保存八份源码/测试、四份实际 JSON reporter、lint/格式输出与 source diff，共 15 份无损 gzip 原件及压缩/解压双摘要。源码在本地执行后捕获，不能替代准确提交的 GitHub Actions 门。

Windows ACL 单路径和批处理的 spawn/timeout 失败统一保留固定 operation、failureStage、progressStage、code、errno、syscall。仅接收封闭枚举和有界整数，不复制异常 message/path/argv 或任意 stderr；同步 throw 同样转换为失败，错误优先于部分成功 stdout。批处理新增固定阶段标记。execution-location 的两条失败分支保留这些结构化字段，同时兼容旧 `windows-acl` 标记。未知字段仍为 UNKNOWN/null/unknown，没有重试或权限放宽。这一保证仅覆盖启动错误，旧 PowerShell 业务异常和其他输出错误的处理未在本轮重写。

Segmented Memory 在 Windows 的原 lstat 检查后逐组件增加 `realpathSync.native` 坐标一致性检查。真实解析拒绝和指向另一规范路径均在 mkdir/锁操作前归类为 `CONTEXT_MEMORY_STORE_CORRUPT`。保留原 symlink 检查；不翻译 Global C 为 X，不接受 junction。坐标相等不证明所有 reparse 标签均不存在，也不排除 check/use 竞态，不能作为受保护 authority 的准入证明。

| 实际环境                      | ACL/位置诊断三文件                 | Memory 两文件                     |
| ----------------------------- | ---------------------------------- | --------------------------------- |
| Windows 10 x64 / Node 22.22.2 | 151 pass / 0 fail / 0 skip         | 32 pass / 0 fail / 1 POSIX skip   |
| WSL Linux x64 / Node 22.12.0  | 146 pass / 0 fail / 5 Windows skip | 30 pass / 0 fail / 3 Windows skip |

两组共 184 个不同用例；两个系统重复执行不累加为不同用例。新 Windows 专项证明普通 lstat + 不同原生坐标、EPERM/EACCES 时拒绝且零目录写入。已有实际 Windows Unicode/ACL 修复、幂等、缓存替换，以及真实 junction 负例同组通过。lint、Prettier 和 `git diff --check` 通过。

首轮本地结果为 149 pass / 1 fail：旧超时用例要求原始 `PowerShell timed out` message。本轮明确停止透传该 message，故将断言改为固定 timeout 标记；没有删除不创建目录、单次调用和完整预算断言。添加同步 throw 回归后最终 151/151。WSL 初次启动缺少 Windows 安装树中的 Linux Rollup optional 包，未执行测试；在独立 `.work/linux-test-native-20261011` 安装准确 Rollup 4.62.2 / esbuild 0.28.1 Linux 包，以 NODE_PATH 提供后执行成功，没有删除或改动项目 lockfile。

可重复的 Windows 命令（工作目录 `packages/cli`）：

```powershell
..\..\node_modules\.bin\vitest.cmd run __tests__/unit/config-security.test.js __tests__/unit/execution-location-failure-site.test.js __tests__/unit/execution-location-target.test.js --reporter=dot
..\..\node_modules\.bin\vitest.cmd run __tests__/unit/segmented-memory-port.test.js __tests__/unit/memory-query-index.test.js --reporter=dot
```

AppContainer ACL 的独立实际权限实验见[契约实验](../acl-contract-2026-10-11/README.md)，当前 Memory 目录切片的实际原生观察见[原生坐标实验](../canonical-path-2026-10-11/README.md)。这些实验与本地回归不改写冻结 Windows `211=194/16/1、6/4/4`、新 fixture `211=208/2/1` 或正式 `36+9 / NOT_RUN`，完整 native review 仍 `NOT_ADMITTED`。

Windows/macOS durable 服务、受保护 journal、服务自身恢复/网络撤销、完整原生 review 和冻结平台冲突仍有工程工作；官方账号/usage/账单、正式目标宿主、独立人工/辅助技术与 8h/24h/SLO 仍有外部验收条件。没有付费 provider 调用或新发行。
