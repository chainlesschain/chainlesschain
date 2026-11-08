# DMM-02：CLI 目标显式移交与签名回退

本批于 2026-11-06 开始，2026-11-07 完成本地实现与验证。源码基线为
`d2070ce914`，当前分支为 `feature/dmm-goal-transfer-20261107`；实现已进入
`7b5376091a`，最终报告和文档另行跟进。新移交能力尚未提升版本或发行。CLI/IDE .143 的公开发行证据继续见
[发行记录](../../../cli/evidence/release143-public/README.md)，不替代新源码的门禁。

本批接通原生项目凭据 → CLI 严格锁/原字节备份/冻结 → 原生确认与 SQLite
目标/映射/备份同事务提交 → 原生作废/签名回执 → CLI 原字节恢复。
导入的新目标保持暂停，不继承旧目标的监控、动作、记忆或完成权限。
回退拒绝覆盖修订后的目标或任何目标关联数据，保留其他项目业务写入。

## 操作与恢复

这些入口要求匹配当前源码构建的 CLI、Session Core 和桌面宿主，公开 .143
未包含本批移交能力。

1. 在个人项目的“CLI 目标移交”中导出导入凭据。原生对话框核对当前项目；
   凭据绑定 store、归属、项目版本和 24 小时有效期，不包含私钥。
2. 停止源目标的既有 CLI 运行，核对 `goal show <id> --json` 中的 revision，
   再显式冻结并导出。冻结期间不得让不理解移交日记的旧 CLI 使用该源目录。
3. 在相同项目选择移交文件，核对原生对话框显示的来源与完整原始内容。
   导入在一个原生事务内保存新目标、原 store/ID/revision/digest 映射和原始备份。
   后续监控与受控动作仍需独立启用或确认。
4. 导出失败/中断时，沿同一目标 ID、revision、项目凭据重试导出，可选新的空输出
   路径；已有文件不覆盖。导入回包不确定时重选同一移交文件，回读原映射，不新建目标。
5. 需要回退时，在项目中作废同一移交记录并导出签名回执。仅未修订且无关联数据的
   导入目标可移除；来源已冻结但尚未导入的凭据也可作废。回执保存失败后刷新记录，
   重新导出同一回执。CLI 只凭绑定原项目公钥与凭据的签名恢复来源，超时不自动恢复。

```powershell
# 使用匹配源码构建的 CLI；revision 使用实际值。
node packages/cli/bin/chainlesschain.js goal transfer-to-project <id> `
  --target C:\selected\goal-import-target.json `
  --output C:\selected\goal-transfer.json `
  --revision 1 --confirm-transfer --json

# 原生项目已持久作废且导出回执后才执行。
node packages/cli/bin/chainlesschain.js goal restore-transfer <id> `
  --cancellation C:\selected\goal-transfer-cancellation.json --json
```

## 验证与证据

最终 **49 个不重叠文件、790 项通过，0 失败、0 跳过**。精确命令、依赖版本、源码 SHA-256 和报告摘要见
[summary.json](./summary.json)。汇总只统计下列完整最终范围，早期定向报告和中间失败
不累加。完整 suite 加载失败也算失败，不能仅凭 `numFailedTests: 0` 判断通过。

| 范围                      | 证据                                  | 验证内容                                                                                                     |
| ------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| CLI 10 文件、118 项       | [最终报告](./cli-all-tests.json)      | 移交/签名/备份/原文件适配、旧目标/REPL/绑定、既有草稿命令；真实 CLI binary 全程；4 个 SIGKILL 点与双进程导入 |
| Desktop 19 文件、383 项   | [最终报告](./desktop-all-tests.json)  | 新原生选择与确认、身份/导航/frame/window/database 失效；旧目标、监控、动作、记忆、通知、草稿、事件与历史边界 |
| Renderer 19 文件、287 项  | [最终报告](./renderer-all-tests.json) | 新移交面板、分页/迟到结果/身份切换、旧目标/任务/通知及认证界面回归                                           |
| npm 隔离打包 1 文件、2 项 | [TAP](./packed-host.tap)              | 实际 npm pack；三条新公共子入口在无 CLI 依赖宿主的 CJS/ESM 加载                                              |
| 静态检查                  | [汇总](./summary.json)                | 1380 个准确 IPC 通道；命令 manifest/help/completions/reference 与 diff 检查                                  |

五个真实进程用例中，父进程通过独立文件/SQLite 句柄核对提交，再终止仍存活的
子进程：冻结日记已提交而源尚未重命名；新目标已提交而未回包；作废已提交而未导出
回执；源字节已恢复而 restored 尚未发布；两个进程同时导入同一快照。
前四项恢复沿原身份推进，第五项只有一个目标及映射。真实 CLI binary 用例单列在
完整 CLI 范围内，不再额外计数。

初次完整主进程回归在沙箱内有 33 项失败，原因是私有 Windows ACL 校验被环境
拒绝，见 [原报告](./desktop-sandbox-tests.json)。在沙箱外对隔离临时数据库和本机
HTTP 重跑相同完整配置后 383 项通过，未降低 ACL 要求。Renderer 初次有四个 suite
因本地空的 `@vue/devtools-api` 目录无法加载，见
[原报告](./renderer-missing-dependency-tests.json)。仅补齐根锁文件固定的 6.6.4
包，下载内容的 SHA-512 与 lock integrity 完全一致；未修改 manifest 或 lock。
首次解包调用遇到 Git tar 的 Windows 路径解析问题，随后使用系统 tar 完成解包。

在当前宿主重跑报告中的精确命令后，可生成绑定当前工作树的汇总：

```powershell
node docs/research/agents/evidence/dmm-goal-transfer-2026-11-06/verify-evidence.mjs
```

此工具只校验已有报告范围并重新执行静态检查，不能代替测试、真实产品旅程或发行
门禁。`.143` 已发行版本与本批源码分别记录，不把旧提交的绿灯算给新源码。

## 尚未验收

本批真实部分为文件系统、严格跨进程锁、原生 SQLite、Ed25519、CLI binary、强制
子进程退出和实际 npm 打包；Electron 窗口/对话框/登录对象与 Vue IPC 为替身。
完整 Electron/IDE GUI、Linux/macOS、真实业务样本、灰度/默认关闭、断电与备份数据库
回滚、新源码准确提交 CI 和发行均未验证。不能恢复覆盖已有新业务写入的整个数据库；
这里的回退只移除未使用的导入目标，原始备份及作废历史始终保留。原计划和条件型
第二阶段任务继续保留，整体目标仍进行中。
