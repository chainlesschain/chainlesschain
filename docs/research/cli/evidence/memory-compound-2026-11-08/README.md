# Memory 组合查询功能预检

这是并行负载下的1K单样本功能预检，源码基线为 `06a5facd2eb8a2c4f028f70b91cedd77e0f16518` 加本批新基准文件。不能作为干净提交、100次采样、跨平台或性能目标通过的证明。

[原始JSON gzip](./raw/preflight-merged.json.gz)保留三个首次冷场景、独立全量参考、12组条件检查、3页74条完整分页、1482事件审计及实际Node/Kernel/Git/源码身份。`complete:true`只表示该限定功能预检及清理已完成；`sampleMatrixComplete:false`、`performanceAccepted:false`。详情见[实施记录](../../../cli-ide/implementation/cli-ide-memory-compound-progress-2026-11-08.md)。

[manifest.json](./manifest.json)列出压缩前后字节数和SHA-256；[离线校验器](./verify-evidence.mjs)检查原字节、源码绑定和预检边界，不运行基准或访问网络。

```powershell
node docs/research/cli/evidence/memory-compound-2026-11-08/verify-evidence.mjs
```
