# G11 远控与 IDE 安装渠道就绪诊断实施记录

> 实施日期：2026-09-13
> 范围：VS Code/VSCodium Remote Doctor 的本地安装渠道就绪证据；不执行商店发布或线上 listing 回读

## 1. 本次交付

现有 `ChainlessChain: Remote / WSL Doctor` 在 CLI、桥接端口、WSL/SSH 网络诊断之外，新增安装渠道就绪信息：

- 从当前已激活扩展读取扩展 ID、版本、推荐 CLI 版本、IDE 宿主和运行模式；
- 明确扩展是在本地还是 Remote/WSL 工作区执行主机上激活；
- Visual Studio Code 推荐 Visual Studio Marketplace，VSCodium 推荐 Open VSX，未知兼容宿主保持 `unresolved`；
- 输出稳定的 `chainlesschain.ide-installation-readiness/v1` 证据结构；
- 将本地激活、安装来源、商店回读和生产资格分开：本地诊断固定输出 `storeReadback:not-performed`、`productionQualified:false`。

用户可以从命令面板运行 `ChainlessChain: Remote / WSL Doctor`，在通知或输出面板中看到上述结果，并复制完整报告。

## 2. 安全与证据边界

VS Code 扩展 API 不公开当前安装包来自哪个商店，因此诊断只给出当前 IDE 的推荐渠道，不声称实际安装来源。诊断也不联网查询 Marketplace，不验证 listing 可见性、线上版本、签名审核或自动更新传播。

“extension activated”只证明当前本地包能在当前执行主机加载；它不能替代以下 G11 目标环境验收：

- 两台真实设备的连接、断网切换后重连和授权撤销；
- Visual Studio Marketplace、Open VSX 与 JetBrains Marketplace 对精确发布版本的线上回读；
- 新用户安装成功率和端到端耗时测量；
- 精确候选提交的签名产物及三平台真实 IDE 宿主矩阵。

## 3. 定向验证

```powershell
# 工作目录：packages/cli
..\..\node_modules\.bin\vitest.cmd run __tests__/unit/vscode-ext-remote-doctor.test.js
```

覆盖 Visual Studio Code、VSCodium、未知兼容宿主、远程执行主机、无效扩展元数据，以及 Remote Doctor 主入口接线。该验证不访问商店、不使用发布账号，也不产生远程控制会话。
