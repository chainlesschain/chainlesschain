# Windows esbuild 原生启动取证（2026-10-08）

修复提交 `fd713e0e72`；Windows 10.0.19045 / Node 22.22.2 / ABI 127。root18140/child27164，同AppContainer SID、零capabilities、固定映像、四句柄、leaf policy、无loopback exemption、空Job清理均成立。

- [report.json](./report.json)：原件，SHA256 `acd7a7c6052f525442af455a9cd6e9dc4b4264f2843c45ca7d8539426ea425e6`。
- [trace.jsonl](./trace.jsonl)：11条API原件，SHA256 `cdc0cd572acb019e7d9323637be6f8e534da8ca92765b415e74ade04142c0658`。
- [readback.json](./readback.json)：当前CPP/driver与实际构建产物摘要一致。
- [contracts.tap](./contracts.tap)：34项纯合同，不计原生任务样本。

DETACHED_PROCESS+主线程APC完成真正shim加载；仅APC以及无注入、保留旧console flags的对照仍DLL_INIT_FAILED。这不证明Windows内部loader根因。

外层exit0、esbuild exit1，仍NOT_ADMITTED。CreateFileW请求 `C:\Users`（access0，两次）和 `C:\`（GENERIC_READ）均Win32 5。requestedPath是API输入，不是canonical证明；私有workspace成功handle的NT路径来自实际GetFinalPathNameByHandleW。

原件保留本地路径。冻结包/config、API结果、祖先ACL、forks、生产allowlist与正式observations未改；完整配置/review、独立compiler closure与正式目标宿主仍待验证。
