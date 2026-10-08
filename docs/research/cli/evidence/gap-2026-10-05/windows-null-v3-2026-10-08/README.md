# Windows 实验 Null v3 证据（2026-10-08）

本目录记录本地 Windows 10.0.19045 / Node 22.22.2 / x64 / ABI 127 的独立实验 profile。真实 Null 设备、受控 Node 子孙启动、精确句柄白名单和一次性 Job 清理通过；没有正式 review 准入、生产支持扩大、付费请求或发行。整包 `capabilities={}`，正式 36+9 仍 NOT_RUN。

## 最终证据

当前源码的最终执行见 [clean-readback.json](./clean-readback.json)、[build-final-clean.json](./build-final-clean.json)、[final-clean.json](./final-clean.json) 及其 journal/stdout/stderr。CPP/header 统一 LF 后已 fresh build/selftest，新二进制有自身真实运行与 staged/source 字节验证；前次 final-readback 摘要单独绑定，阶段材料继续保留。

| 材料                                                                                                                                           | 含义                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [final-readback.json](./final-readback.json)                                                                                                   | 最终独立回读，十项实际 source bytes、六个 staged 文件 bytes、前次 readback 摘要和测试计数                |
| [final-style.json](./final-style.json)                                                                                                         | 加 childErrors 门禁、格式整理后的新实际运行；六 PID、十二 installed/exit 回执、exit 0/空 stderr/清理确认 |
| [final-style-journal.jsonl](./final-style-journal.jsonl)                                                                                       | 父进程 fsync 顺序、两层后代、三个并发 child、三个拒绝反例、父 Event 保留到 child close                   |
| [node-final-regression.tap](./node-final-regression.tap)                                                                                       | 最终 Node 517/517，零失败/跳过；含新增五类 childErrors 负例                                              |
| [transport.json](./transport.json)、[transport-tampered.json](./transport-tampered.json)、[transport-unlisted.json](./transport-unlisted.json) | 当前 helper 实际运输与创建 target 前的两项拒绝，3/3                                                      |
| [vitest.json](./vitest.json)                                                                                                                   | 原 v1、七项能力合同、review pack 回归，52/52                                                             |

最终合计 **572 个不同测试**（517+3+52）。较早 [node-regression.tap](./node-regression.tap) 的 512 项、567 总计保留历史含义，不与最终结果相加。实际 native 诊断不另算测试个数。

## 真实运行范围

root、nested、grandchild 与三个并发 child 都核对同一 AppContainer SID、capabilityCount=0、Job、五个当前 node.exe IAT 项、真正的 `\Device\Null`、读 `0x120089`/写 `0x120196`/同步 mode `0x20`。五个后代读取 EOF、完整写入 97 字节；root Null fallback/maps 18/18、7 launch calls/4 launched/3 rejected。未知 CRT Event stdio、detached、缺 trusted preload 均被拒绝。

每次受控 Node launch 复制并重新验证 CRT stdio 与 Null，重建精确 HANDLE_LIST。parent 持有真实 inheritable named Event 直到所有 child close；child 使用一次 1 MiB 有界本进程句柄快照证明该数字不存在，或数字已复用但内核对象类型不同。同 Event 类型仍 unsupported，不推断对象身份或成功。证明仅针对已观察的受控 Node 启动，不声称所有 OS 后代都已覆盖。

**本次 v3 的 pipe/client/realpath counters 为 0**。这些分支的真实验证引用[独立 v1/v2 目录](../windows-runtime-adapter-2026-10-08/README.md)，不能用本次 Null 成功代替。

## 失败原件与阶段记录

| 材料                                                                       | 观察                                                                                               |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| prototype-02/03/04/final.json                                              | 独立 worktree 各阶段实际尝试；只适用各自源码摘要                                                   |
| strict-handle-failure.json                                                 | 查询 absent numeric handle 引发严格句柄异常，未覆盖成成功                                          |
| absence-only-snapshot.json                                                 | 最初仅证明数字不存在的原型                                                                         |
| numeric-reuse-failure.json 及 journal/stdout/stderr                        | root 的 fsync journal 改变 child 句柄数字布局，排除数字复用的旧断言真实失败                        |
| [type-proof.json](./type-proof.json)、[readback.json](./readback.json)     | 首次完整内核类型排除证明；六 PID/十二 phase；旧 preload 与旧 validator 摘要                        |
| [frozen-config-v2-failure.json](./frozen-config-v2-failure.json) 及 stderr | esbuild service 已启动并响应，报告祖先目录读取 Access is denied；config 未加载、worker pool 未观察 |

esbuild 的失败不归因为 NUL。v3 明确只接受 guarded Node executable，不接纳非 Node 的 esbuild，且 Node IAT 不覆盖 Go/esbuild 调用。未扩大祖先目录 ACL、修改冻结包或配置、切换 forks 为 threads、放宽 canonical 检查。冻结 config/default forks/full review 继续开放。

## 构建与字节对应

- 当前实际 addon SHA-256：`75e7a1629843e74347f35da17cb0a4c2ac571c25cf01d140c3b35cad9c24b62c`，对应 build-final-clean 和 final-clean 记录。
- 当前 LF CPP：`c9281636f70838f6eab2df5258f839a4b99bfddde46aa9ba91be18f1434879ae`；header：`42bfb27b14d7752a8fd84f8d603dade7553871338c17a01f96f0f538af9b6235`。
- 历史 CRLF CPP/header `5d71ba4b…/ed162f4b…` 与实际 addon `185a7de91942526c345618e051e96860964f8bb6fce096d543d3e783fc2beeb0` 保留在首次与格式整理阶段。换行归一化后重新构建、selftest 和实跑新二进制，不借用历史运行作为当前字节证据。
- helper source：`d1734f440aa747de167e7e609ad7a61b78a28205acb3595f3b253b04a292b170`；重建 DLL/EXE 的 source contract 和原运输回归通过。
- [build-type-snapshot.json](./build-type-snapshot.json) 对应最初 preload `13857ca15d8e9652ff29c6e3478c383bc71e1ecd92a01b295a56035f479421b9`。
- 最终 preload 仅做 Prettier 整理，摘要 `ac9cfb6d818d378f79127a93f3167161eb9e5f08b98f08fdcea186969b81c7ab`；新真实运行与 final-readback 单独核对，不覆盖历史 build record。

LLVM-MinGW 编译器闭包未声明 hermetic。PE 时间戳会导致重建 hash 不同，任何后续 binary 须自身执行验证。source identity records 证明本地完整性和内部字节绑定，不提供外部构建认证。

## 公开派生边界

所有 JSON/文本为公开派生材料，路径已做脱敏；完整 manifests/inventories 在诊断摘要中省略或改名，原件位置、bytes/digest 与派生 digest 独立记录。最终 manifestSummary 省略目录 identity 集合，不能重建准入票据。原件保持完整，公开材料 `derived=true/admissionEligible=false`。归档文件关闭 Git 换行归一化，不能对 JSON/TAP 再格式化而沿用旧摘要。

Windows 11 24H2、Node 22.12.0 与其他目标宿主、正式 36+9、官方账号/账单、独立人工签核、双 IDE 公开首次安装、真人辅助技术、8h/24h 与 SLO 未由这些实验完成。Windows/macOS durable authority、网络撤销和崩溃恢复仍开放。
