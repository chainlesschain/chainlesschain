# 两端 IDE 在线创建入口：完成情况

日期：2026-11-06。基线 `09843429a4`，分支 `feature/dmm-native-task-create-20261106` 的未提交组合工作树。在同日 CLI/桌面独立 v6 之上接通两端 IDE；各历史批次有重叠，测试数字不相加，原证据不改写。

| 交付项               | 当前完成情况           | 验证或剩余边界                                                                                                                             |
| -------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| VS Code 创建入口     | 本地完成               | 独立创建 access/发送/回执控件，原生连接/来源/任务类型/正文/引用选择；忽略 webview 路径和类型                                               |
| JetBrains 创建入口   | 编译与协议验证完成     | 三个原生按钮、来源分页和类型选择、后台捕获、generation 复核；真实 GUI 未运行                                                               |
| 结果与权限隔离       | 本地完成               | 创建专用 schema 与 `task.create`，v3 不互代；目标/存储/插件/版本/声明/grant/请求/路径绑定                                                  |
| 进程捕获             | 本地完成               | 成功退出、stdout 严格 UTF-8、有界输出和 30 秒期限；两端各 5 个真实子进程用例                                                               |
| 未知结果             | 本地完成               | 原引用只查回执，`not-found` 不自动发送；中断/迟到展示失效不意味着待审保存回滚                                                              |
| Node / CLI / VS Code | 14 文件、190 项通过    | [cli-tests.json](./cli-tests.json)，含原说明、创建文件、插件生命周期、v6、持久引用和原生控件 API 替身                                      |
| 桌面主进程           | 3 文件、37 项通过      | [desktop-tests.json](./desktop-tests.json)，真实 Windows ACL/HTTP/SQLite 返回值交给 IDE 解析器，随后预览/确认唯一创建                      |
| JetBrains JUnit      | 2 类、28 项通过        | [协议 23 项](./jetbrains-plugin-manager-tests.xml)、[真实子进程 5 项](./jetbrains-capture-tests.xml)；IntelliJ SDK 编译与 buildPlugin 通过 |
| 本批合计             | 19 文件/类、255 项通过 | 0 失败、0 跳过；不包括历史批次、中间复测、格式检查和制品检查                                                                               |
| 本地制品             | 独立记录               | [字节核对](./artifacts.json)、[静态检查](./checks.json)、[源码与命令](./summary.json)；不代表公开发行                                      |
| 尚未完成             | 计划未闭环             | 模型起草、Memory 输出授权 adapter、实际 IDE/Electron GUI、独立业务样本、准确提交全平台发行门、灰度与迁移回退                               |

匹配源码构建的两端插件管理器新增 **Export online creation access…**、**Submit pending creation…**、**Look up creation receipt…**。用户仍需已准入的 `goal-task-creator` 或组合助手 0.3.0，以及桌面单独原生同意的 v6 `goal.create-drafts`。旧 v3 说明 access 和回包不能替代创建授权。新增入口只保存 pending 创建提议，实际创建仍需当前桌面预览和逐次原生确认，不执行新任务或证明目标达成。

创建发送固定来源页的完整目标/插件/声明/grant 身份，并显式选择任务类型；CLI 在发送前持久化无正文、无凭据引用。未知结果或退出失败保留原引用，经回执入口显式选同一文件恢复。`not-found` 只表示查询时未找到，不自动重发或换身份。关闭、刷新、插件/工作区变化后丢弃迟到结果；已发 CLI 可能仍保存草稿，不宣称取消回滚，也不自动删除引用。

| 运行与验证边界 | 实际执行                                                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 环境           | Windows x64，Node 22.22.2 / npm 10.9.7 / Vitest 4.1.10；better-sqlite3 12.11.1 / Koffi 2.16.3                                                         |
| VS Code 捕获   | 创建操作每输出流 16 KiB；严格 stdout UTF-8；零退出才接受；旧通用捕获默认行为兼容                                                                      |
| JetBrains      | JBR 21.0.8、离线 Gradle 8.7、IntelliJ 2024.2 SDK；stdout 16 KiB / stderr 64 KiB；严格 stdout UTF-8、零退出、30 秒期限                                 |
| 实际进程       | 每端成功、有效 stdout 后非零退出、stdout 超限、无效编码、超时共 5 项；为合成子进程，未冒称真实 CLI 在线创建崩溃旅程                                   |
| 原生集成       | 两个真实声明包的插件准入→access→v6 HTTP→来源/回执→SQLite→当前预览/确认；VS Code parser 接受实际返回数据；旧说明/文件采纳/历史兼容同时回归             |
| 替身           | VS Code API 选择器/webview/CLI 结果、Electron 窗口/登录对象/确认结果，合成个人项目数据；Java UI 为编译与协议验证                                      |
| 权限环境       | 主进程真实 Windows ACL 和离线 Gradle 缓存测试获准在沙箱外运行，未放宽 ACL；其余 Node 回归在工作区沙箱                                                 |
| 发行           | 未提交、未发布、产品版本未提升；CLI 0.166.142 / Core 0.3.25 / VS Code 0.37.178 / JetBrains 0.4.195 仍是既有公开配对，版本号相同不代表公开包有本批源码 |

[verify-artifacts.py](./verify-artifacts.py)核对 VSIX 三个生产 JS 文件和 README 创建在线章节，以及 JetBrains ZIP 中当前生产类与内部类。[verify.cjs](./verify.cjs)核验语法、格式、生成元数据和 VSIX 元数据，从最终 JSON/XML 报告生成摘要、精确命令与 SHA-256 来源快照。以上制品及静态检查均不计入 255 项测试；发行仍需准确提交的三平台 Actions、OIDC 与子包→CLI→IDE→客户端顺序。
