# Windows esbuild 私有映射真实运行（2026-10-08）

独立诊断，状态 **NOT_ADMITTED**。Windows 10.0.19045、Node 22.22.2、ABI127、冻结esbuild0.28.1原字节；完整service/config/default forks/review未接入。

- [report.json](./report.json)：最终v2成功原件，SHA256 `3dbdd99d742a6e610b87af88644ee8cb210b23a10548b4a4415c3559284c4d2b`。
- [trace.jsonl](./trace.jsonl)：20条真实记录，SHA256 `ea1a13493d843d9ce5d218b2795341243bcaf81c2e2d07632cbbe605d8d0707d`。
- [bundle.js](./bundle.js)：真实esbuild输出，SHA256 `a665166e9ad45f6b74dfc00bf116547d14b374b345ba0474cfcdb5c366006c07`。
- [readback.json](./readback.json)：CPP/driver/二进制/staged原件匹配。
- [unassigned-cleanup-probe.json](./unassigned-cleanup-probe.json)：真实创建后未入Job负例。
- [contracts.tap](./contracts.tap) / [floor-contracts.tap](./floor-contracts.tap)：Node22.22.2、22.12.0同61项合同，两次不重复累计。
- [lowbox-self-setter-rejection.json](./lowbox-self-setter-rejection.json) / [host-control.json](./host-control.json)：LowBox自设置ACCESS_DENIED与同用户非管理员宿主自设置成功。
- [attempt-catalog.json](./attempt-catalog.json)：早期编译/字节守卫/缺LOCALAPPDATA失败和首次成功，原件留在.work；15项源码原件摘要一致。
- [namespace-analysis.json](./namespace-analysis.json)：上游源码字节/行号、API输入及剩余接线，明确不是authority票据。

最终非管理员宿主root404直接创建child21860，使用原始CREATE_SUSPENDED进程HANDLE安装未命名NT目录中的X:映射；原始NT根和FileId由监督器held handle取得。子进程零capability、leaf、精确5继承句柄；实际X根枚举、entry读、bundle写均成功，宿主C根读拒绝、workspace写拒绝和路径遍历受限。父映射三次均明确absent/error2，Job空、child退出、profile删除、无loopback exemption均成立。

复核发现并修正空Job误代替未入Job child退出，以及两次unknown错误误证明父映射未变。最后同一supervisor二进制真实创建child23712后停止在入Job前：原始HANDLE兜底终止成功、Wait0、exit125、Job0，cleanup和profile删除成立。该负例completed=false，不改写成成功bundle样本。

编译器及邻近DLL字节有记录，compiler closure仍非hermetic。没有全用户/全局盘符、祖先ACL扩大、API结果翻译、冻结源码改写、生产准入或正式observations。

最终候选去掉 shim 文件末尾多余空行后重新编译并真实运行，最新字节绑定见 [final-v3/report.json](./final-v3/report.json)（SHA256 `e0e346fa05b7df5fc90a87e538188afa2d11a0c27361c0097f88b3bf860e6a02`）及 [final-v3/readback.json](./final-v3/readback.json)。root19628 / child23440 / exit0，20条真实 trace、父映射明确 absent、原始进程 HANDLE 与空 Job 清理成立；同一新二进制的未入 Job 负例 child25900 / exit125 清理成立。61项合同再次通过。v2 原件保留为历史，当前源码/driver/二进制/staged 以 v3 回读为准，仍 **NOT_ADMITTED**。
