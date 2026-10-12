# Windows IntelliJ 宿主：Gradle 下载失败与独立准备修复

准确合并源码 `fd284e442d073e7c4fcd256cc868efdbe992fe96` 的 Host Diagnostics run `38154422714`、Windows job `114514461559` 在启动实际 IDE 前失败。原 artifact `11707424844` 保存了 **5 个文件**，包括完整 `prepare.log`；最初只列出 JSON/文本文件会漏掉被忽略的 `.log`。

`prepare.log` 明确记录：wrapper 已启动 JVM，开始下载固定 `https://services.gradle.org/distributions/gradle-8.7-bin.zip`，随后 TLS handshake 写入出现 `java.net.SocketException: An established connection was aborted by the software in your host machine`。这支持 Gradle 分发包下载阶段网络失败的定位，不能据此归因为 Windows batch 启动、日志丢失、TEMP 别名或某个具体防火墙。

修复仅在 Host Diagnostics 的实际 IntelliJ 旅程前增加独立 `wrapper --version` 准备。沿用项目固定 Gradle **8.7**、官方分发地址和既有 wrapper 缓存；只有日志同时显示该精确分发包正在下载及明确 socket 网络异常、进程自然非零退出时，才最多尝试 **3 次**，每次 **90 秒**有界，间隔 **3 秒**。各次完整日志、退出状态、时间和摘要独立保存并由原 always-upload 步骤归档。非网络失败、校验/证书错误、错误 Gradle 版本、超时或清理未确认均不据网络文字重试。原 buildPlugin、compileUiTestJava 和实际 IDE 旅程不重试，原期限与断言不变。

Windows 最终合同 **6/6** 通过，覆盖真实子进程网络失败后的成功、三次耗尽、非网络失败、版本不符、证据目录拒绝覆盖及含网络文字的挂起进程超时清理。WSL 首次尝试因默认 PATH 缺少 Node 返回 **127**，保留原 stdout/stderr；后续显式 Linux Node **22.22.2** 与 **22.12.0** 分别 **6/6** 通过，见 [22.12 回执](./linux-node22.12-summary.json)及[补充运行时回执](./linux-runtime-summary.json)，两次不同运行时不相加。定向 Prettier 和 actionlint（不启用 shellcheck/pyflakes）通过。

[manifest.json](./manifest.json) 保存 **15 份**原失败、三份当前源码和各平台命令原始输出的压缩前后摘要；[summary.json](./summary.json) 保留初轮实际命令和状态，后续显式 Node 回执独立追加。当前工作区增量还需自身准确提交的 Actions 验证；本次未重新下载 Gradle、启动真实 IDE、发布或调用模型，正式 **36+9 / NOT_RUN / observed=0 / $99** 不变。
