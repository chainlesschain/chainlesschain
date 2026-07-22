# CLI Runtime 当前实现（0.162.175）

本文是当前 CLI 运行时的实现快照，适合部署、排障和集成方阅读。设计取舍详见[运行时设计核对](/design/cli-runtime-current)。

## 现在可以使用什么

- `cc agent --bg`：后台启动长任务，返回可持久化的会话 ID。
- `cc attach <id>`：通过本机控制通道继续提问、停止或查看后台 Agent；通道不可用时自动改为日志跟随。
- `cc logs <id>`、`cc daemon status|view|resume|stop`：查看和管理后台会话。
- `Setup` / `Notification` hooks：在命令开始前注入环境并发送会话通知。
- 跨平台 sandbox 与 credential agent：通过统一的执行 broker 控制 shell 和凭据边界。

## 兼容性说明

- 当前 CLI 包版本：`0.162.175`；顶层命令数仍为 **175**。
- TCP transport 是 IPC 不可用时的本地控制通道后备，不等于开放公网远程控制；集成方必须保留会话凭据握手。
- sandbox 引擎不可用时，严格模式会拒绝启动；请先安装并验证 Docker 或 bubblewrap，再启用 `failIfUnavailable`。

## 相关文档

- [后台 Agent](./cli-background-agents)
- [安全沙箱](./cli-sandbox)
- [Hooks 系统](./hooks)
- [运行时设计核对](/design/cli-runtime-current)

