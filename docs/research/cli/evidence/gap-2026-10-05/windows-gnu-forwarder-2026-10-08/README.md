# Windows GNU Rollup 独立适配证据

冻结 GNU addon 4.62.2 / Node 22.22.2 / ABI 127 在真实零 capability AppContainer 中，通过独立 libnode.dll forwarder 完成 41 项函数地址核对、同步/异步解析、三个 hash、缺 DLL 和非法输入负例。PID 20840；退出 0、stderr 空、无 loopback exemption，Job 清理确认。

- [build.json](./build.json)：源码/编译器/headers/runtime/addon/output 摘要和 PE forwarding closure。
- [report.json](./report.json)：最终原始执行、manifest、源码身份、结果校验和清理回执。
- [journal.jsonl](./journal.jsonl)：七阶段 fsync journal。
- 本机最终二进制：`.work/gnu-forwarder-build-20261008-final/libnode.dll`；原件：`.work/gnu-forwarder-native-20261008-final`。
- 首次 PE reader ordinal import 拒绝的真实失败：`.work/gnu-forwarder-build-20261008-a/build.json`；后续各尝试仍在本机保留。

范围为 `NOT_ADMITTED / experimental:true / admissionEligible:false / formalSample:false`。冻结 addon 未修改；运行时和编译器闭包并非独立认证，不授予生产能力，也不关闭冻结 config/default forks/full review。纯合同 36 项已接 CLI CI；正式样本未写入。

```powershell
node --test packages/cli/test-node/windows-rollup-gnu-forwarder.node-test.mjs
# 实际重建必须显式提供当前脚本固定身份的 addon、compiler、headers 和新输出目录。
node packages/cli/scripts/windows-rollup-gnu-forwarder.mjs --mode build --compiler <absolute-compiler> --headers <absolute-headers> --addon <absolute-addon> --output <new-directory>
node packages/cli/scripts/windows-rollup-gnu-forwarder.mjs --mode diagnostic --confirm-native --build <absolute-build.json> --addon <absolute-addon> --output <new-directory>
```
