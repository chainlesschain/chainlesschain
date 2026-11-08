# Windows VS Code合并源码验收失败证据

本目录保存 `a3296d55fd38f4e186a712ef26c3bd3421bcbab4`、VSIX0.37.181在VS Code1.145.2上的首轮失败诊断。包SHA-256及文件摘要见manifest.json。安装、版本列举与真实扩展激活已成功；多窗口前的MCP桥接TCP检查失败，完整DOM/会话重启未执行，不计通过。

bridge-trace记录驱动已发现并激活安装包、验证命令；bridge-failure记录ETIMEDOUT；host-progress记录安装和失败证据阶段。完整原始旅程仍在 `.tmp/ide-host-a3296d55f-evidence`，manifest仅保存其摘要，没有声称本目录包含全部诊断。

loopback-comparison为原探针JSON的结构化摘录，将可执行路径替换为宿主角色；其余四份诊断保留原字节。普通Node与已安装旧Code自连成功，下载Code（不加载扩展）自连失败；cross-loopback显示下载Code能连Node监听，但Node连下载Code监听失败。这定位了本机下载宿主的入站回环问题，不能据此断言具体防火墙或Electron根因。未修改安全策略；任何后续放行或复验需另存新证据。

详细边界和复验入口见[宿主验收记录](../../../cli-ide/validation/cli-ide-merged-host-progress-2026-11-08.md)。本目录不包含模型会话、凭据或原始用户内容。

补查（2026-11-08 05:49 UTC）：ipv6-loopback.json记录同一下载宿主对127.0.0.1和::1自连均ETIMEDOUT，系统Node两者均成功；未发现可用于完整旅程的IPv6替代路径。探针进程退出0表示诊断采集结束，connected=false仍表示连接失败。未修改防火墙或宿主配置。
