# CLI 0.166.133 公开发行回读

准确源码：`2eb0c5b1e048509362f9d980f94acee55c2ffa9f`。CLI 先发布并核验，随后才触发两个 IDE 标签；PR #511 在三个公开包核验完成前保持未合并。

- `gates.json`：准确提交的 Linux、Windows、macOS CLI CI 与 CLI Strict Sandbox 门禁。
- `cli.json`：独立 Actions 回读，公开 tarball 与正式不可变制品逐字节一致。
- `provenance.json`：npm 签名来源，绑定准确源码、标签及 OIDC 发布运行。
- `children.json`：正式发布运行的公开子依赖安装与版本对齐回执。
- `vscode.json`：Open VSX 已公开、列为最新版本，公开 VSIX 与官方制品逐字节一致，推荐 CLI `.133`。
- `jetbrains.json`：已批准、列出并公开下载，ZIP 中的两份原始文件均与 CI 制品逐字节一致。公开 ZIP 归档摘要与 CI ZIP 不同，两者摘要均保留在回执中。

[CLI 发布 41073612529](https://github.com/chainlesschain/chainlesschain/actions/runs/41073612529)、[独立回读 41075409835](https://github.com/chainlesschain/chainlesschain/actions/runs/41075409835)、[Open VSX 发布 41075702976](https://github.com/chainlesschain/chainlesschain/actions/runs/41075702976)及 [JetBrains 发布 41075702892](https://github.com/chainlesschain/chainlesschain/actions/runs/41075702892)均通过。三个包的公开制品核验已完成；两个 IDE 均推荐 CLI `.133`。

这些是发行证据，不增加 36+9 任务成功数，不声明新的正式付费或原生生产准入。
