# Windows native canonical 路径检查实际切片

当前 `segmented-memory-port.js` 新增的逐层 native canonical 坐标检查，在一次真实零 capability AppContainer 中观察到：普通目录成功创建子目录；真实 junction 虽被固定 runtime 的 `lstat` 回报为普通目录，`realpathSync.native` 仍给出不同的目标坐标，因此新检查在 `mkdir` 前拒绝。此结果仅适用于保存的准确函数源码切片，**不是完整 module 或冻结 review 的通过结果**。

## 原件与绑定

- [manifest.json](./manifest.json)：**49** 份 gzip 原件、**616,262** 原始字节，每项保存原始与压缩字节 SHA-256。三个二进制留在本机 `.work`，准确摘要完整保存。
- [archive-validation.json](./archive-validation.json)：全量解压双摘要及原始字节核验；独立 **22** 项检查、**32** 个 source/binary/copy 输入绑定、**9** 个原 native/CJS 输入不变、**4** 个函数切片字节匹配。
- `a/`：构建、原始源码、冻结 donor、完整待审生产模块快照、提取清单、actor/driver/verifier、原始 host/actor 输出、实际结果与回执。
- `checks/`：准备、独立回读/变异和归档代码。

原生基线为 `53ad9df8c46269d725d2f3cde77185a5806e86da` 的九份输入，全部逐字节保持，重新编译 broker/addon/shim。没有启用 ACL 实验导出、reparse buffer 改写、新 namespace 映射或权限范围扩展；六个默认 slots 保持。compiler closure 非 hermetic。

actor 从本轮待审生产源码提取原字节 `directories`、`existsSync`、`ensureSafeDirectory` 及 `corruptStore` 四个函数；完整原模块、每个函数的字节长度/摘要与 actor 原件同时归档。依赖绑定使用真实 `fs.lstatSync`、`fs.realpathSync.native` 和 `path` API。`mkdirSync` 只增加调用计数，仍执行真实 `fs.mkdirSync`，没有模拟文件系统结果或改变函数正文。这不等于加载完整 SegmentedMemoryPort、锁、journal 或冻结测试。

## 实际结果

Windows 10 x64 / Node 22.22.2，UTC **2026-10-11 04:02:27.765 → 04:02:31.496**；host PID 18628、actor PID 26400。actor 自己在本轮 scratch 创建 plain、target 和 junction。

| 对象与操作 | 实际观察 |
| --- | --- |
| `plain` | lstat directory=true/symbolicLink=false；native canonical 与原 X 路径一致 |
| `ensureSafeDirectory(plain/nested)` | 成功；真实 mkdir 调用一次，nested 已存在 |
| `link` junction | lstat directory=true/symbolicLink=false，重现固定 libuv 假阴性 |
| 原生 reparse 读取 | attributes `0x410`，tag `0xA0000003`，FSCTL 成功，returnedBytes 340/dataLength 332 |
| 实际 substituteName | `\??\Global\C:\...\scratch\private-v4-junction-probe\target` |
| `realpathSync.native(link)` | 返回 `X:\scratch\private-v4-junction-probe\target`，与 link 坐标不同 |
| `ensureSafeDirectory(link/nested)` | `CONTEXT_MEMORY_STORE_CORRUPT` / `authority directory resolves elsewhere` |
| 拒绝前后 | junction 分支 mkdir 调用 **0**，target 前后均为空目录 |

没有依赖 PrintName 作为 authority，没有新增 Global C → X 转换；上表 canonical 来自既有六槽 adapter 中真实 `realpathSync.native` 调用。独立回读核对实际 substitute、tag、属性、长度、来源、准入字段、身份、mkdir 次数和目标未改变；变异必须被拒。

原 HANDLE wait 0/exit 0、同 Job/零 capability、Job 0、profile 删除、无 loopback exemption、host map 不变、installed/exit 回执完整。准确源、二进制和复制文件前后绑定，另独立只读重算。actor 仍只继承原九个句柄，无新增目标对象句柄。

## 不由此关闭的事项

`realpath` 坐标一致性是新增的保守拒绝检查，不能证明所有 reparse 类型都被排除，也不能证明 check/use 期间对象不可置换。这个固定 junction 的新源码切片已实际拒绝；原冻结完整 review 没有重新运行，仍 **NOT_ADMITTED**。

旧 **211=194/16/1**、mutants **6/4/4**、新 fixture **211=208/2/1** 不改写。owner-only ACL 与 LowBox 直接 I/O 的独立冲突见[ACL 合同实验](../acl-contract-2026-10-11/README.md)；受保护 journal、Windows/macOS durable 后端、自身恢复/WFP 仍未交付。正式 **36+9 / NOT_RUN / INSUFFICIENT_EVIDENCE**、$99、observations、官方账号账单、独立人工/辅助技术及 8h/24h/SLO 保持原状，无付费 provider 调用或发行。
