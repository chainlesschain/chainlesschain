# Windows esbuild leaf/API trace 失败证据

最终运行与当前 CPP/driver 字节逐项绑定；root 22736 / child 20368 通过实际 SID、零 capability、Job、固定 image 与精确 handle/leaf 配置核对。早期 LoadLibrary 初始化退出 0xC0000142，没有 installed/API 日志。

- [report.json](./report.json)：最终原始构建、manifest、运行、明确失败及清理回执。
- [trace.jsonl](./trace.jsonl)：真实空文件，零字节。
- [contracts.tap](./contracts.tap)：30 项纯校验器回归，包含错误/缺失/篡改证据反例。
- 本机完整原件与两份实际 binary：`.work/esbuild-api-trace-20261008-complete-source/`。
- 早期尝试 `.work/esbuild-api-trace-20261008-a/b/c/d/e/final/final-clean` 均保留。

`completed=false / NOT_ADMITTED / resultTranslation=false`，root exit 2，cleanupConfirmed=true，无 loopback exemption。当前没有具体祖先 API/路径实证；没有错误码翻译、包修改或祖先 ACL 扩张；不会计作冻结 config/default forks/full review 的通过。

```powershell
node --test packages/cli/test-node/windows-esbuild-api-trace.node-test.mjs
```
