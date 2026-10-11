# Linux 公开 CLI 火山实测与工具白名单修复（2026-10-11）

用户明确授权火山引擎测试。本轮在 Ubuntu 24.04.3 x64 / WSL 1、Node 22.12.0 的独立安装目录运行公开 CLI **0.166.97**，来源为 `22ef588c1bb8f71c45feaa115df1d75d5ca505c5`。这是文件工具诊断，`formalSample:false`；未导入正式 36 项任务或 9 项 firstRun，冻结计划、$99 和 observations 保留。随后实际编码题目的 Actions 诊断另行归档。

## 实际结果与限制

- registry 精确版本安装成功，独立 cache/profile/workspace，无开发软链接；使用 `--ignore-scripts --omit=dev`，未验收 SQLite native 或安装 lifecycle。lock 的 resolved/integrity 与五份实际 CLI 文件对 release Git blob 的字节比较见 [public-install.json](./public-install.json)，不声称整个包所有文件都已验证。
- 首轮因为 exact mutation scope 要求目标文件已存在，stderr 为 `Error: mutation scope target must already exist: probe.txt`，stdout 为空；首轮费用与 usage 未知，保持 null。根目录保留原件。
- 第二轮新建独立 profile/workspace，预置不同占位内容，不放宽权限。真实模型完成 `write_file → successful tool_result → read_file → successful tool_result → success`；两 ID 唯一、关联与顺序正确，均指向同一工作区内的 probe.txt。写入参数、完整读回和独立产物一致：27 字节 `PUBLIC_LINUX_VOLCENGINE_OK\n`，SHA256 `74ce6345545df783b25057046f80c3efc97c011687de5c64e35c3068dc430f97`。
- 14 条 NDJSON，3 次真实模型调用，input/output 分别 1722/169、2128/176、2646/12；合计 **6496/357**。provider=`volcengine`，model=`deepseek-v4-flash-ga-260731`，内置 Ark endpoint；无 fallback、signal、timeout，exit 0。CLI 估算 **$0.0010094**，实际账单 null。自动重试 0，最多 4 turns；$0.05 只是返回 usage 后停止后续调用的估算阈值，未验证 provider 硬额度。
- 凭据经内存 WSLENV 注入，不写 argv 或归档。`hermetic` 在此是文件工具执行边界，不是操作系统网络隔离；init 的 loaded_sources 仍记录 project-memory/memory-recall/plugins，不能仅凭标签声称实际加载或完全隔离。Astra 独立回读实际 stdout/产物，没有追加 API 调用。

## 从实测得到的改进

公开 .97 接受 `--allowed-tools write_file,read_file`，但 init 与 context plan 的实际模型工具 schema 仍为六项文件工具。实际仅执行 write/read，**两工具暴露上限验收失败**。根因是 formal hermetic 分支直接选择六项，跳过 allowlist 与 plan 只读交集。

未发行的源码修复先解析显式/宏 allowlist 与 permission mode，再与固定六工具上限取交集，保留显式空数组、plan 只读、默认六工具及非 formal 路径的既有行为。五项回归通过真实 agentLoop 和 chatWithTools，在 mock fetch 边界检查实际请求 body.tools，同时核对 init 与零 bootstrap；测试不调用付费 API。

| 回归                         | 真实结果           | 证明范围                                           |
| ---------------------------- | ------------------ | -------------------------------------------------- |
| 修复前，最终正确夹具         | 5 fail / 87 未选中 | 显式两工具、空数组、外部工具、两种 plan 均复现扩权 |
| 修复后定向                   | 5 pass / 87 未选中 | init 与请求 schemas 满足收窄合同                   |
| Windows Node 22.22.2，四文件 | 113/113 pass       | headless、执行时能力围栏、plan、disallowed-tools   |
| Linux Node 22.12.0，同四文件 | 113/113 pass       | 同一合同与 Linux 路径                              |

Prettier 无变更，定向 ESLint 零 error；四个既有 `_err` unused warning 保留。Astra 只读审查未发现阻塞。初始夹具错误也归档：未指定 cwd、误把 chatFn options 当工具 schemas、未绑定 provider/baseUrl 导致 Ollama 路径或 fallback；这些失败不能作为生产缺陷证据，以 `before-final` 与最终两端 reporter 为准。源码与 driver 为本地最终快照，不冒充发行或 CI 来源。

下一步优化依据：准确工具集合必须贯穿 init、模型 schema 与执行时检查；正式入口应在调用前提供可操作的 mutation scope 前置错误；费用报告必须分开估算与账单，未知不补零；实际编码任务须看独立断言与反例检出，标记文件诊断不能代表编码成功率。

[manifest.json](./manifest.json)保存原始字节与 gzip 双摘要，包含全部失败、成功、driver 与源码。正式运行还需 Linux Docker 与独立人工预审；Windows 11/macOS 目标宿主、官方账单和完整 24h 观察未完成。GitHub Actions 的新准确提交矩阵另验，不能由本地测试代替。
