# 合并源码 Windows IDE 安装与恢复验收

日期：2026-11-08。承接10月27日差距评审4.3、4.4、4.9；源码为 `a3296d55fd38f4e186a712ef26c3bd3421bcbab4`，扩展候选版本0.37.181。本批尚未完成。

## 已完成准备

- agent-sdk与elicitation-schema vendor检查退出0。
- `npm run package -- --out chainlesschain-ide-gap-a3296d55f.vsix`退出0，186文件；SHA-256为 `75a59a257f46c5a971f9893baa4878549926a02ae2a0803ef3c2ada4d79e4af1`。本地候选不代表公开发行。
- 固定测试工具 `@vscode/test-electron@3.1.0`、`ws@8.21.2` 安装于 `.tmp/cli-ide-host-tools-a3296d55f`，未修改项目manifest、锁文件或扩展源码。

## 当前运行

执行入口为 `packages/vscode-extension/test/extension-host/run.cjs`，使用独立目录 `.tmp/ide-host-a3296d55f`，证据目录 `.tmp/ide-host-a3296d55f-evidence`。通过NODE_PATH引用上述隔离工具目录，传入候选VSIX及准确 `--release-commit`。运行句柄23711，初始PID26260；这两个值只供后续重新查询，不证明进程持续存活。

进度journal在 `.tmp/ide-host-a3296d55f-evidence.progress.jsonl`，已记录prepared与install_started。宿主解析为VS Code1.145.2，下载352.42MB官方Windows archive；本次轮询仍有存活进程和443连接，尚未得到安装或旅程终态。后续应回读同一运行，不因等待而启动重复旅程。

运行器覆盖安装包加载、多根、多窗口、真实DOM控制、初始与重启阶段。使用本地确定性CLI夹具，故即使全部通过，也不替代真实模型、真实CLI端到端执行、升级迁移、JetBrains、其他系统或真人可访问性验收。失败应保存原始阶段与诊断，再决定修复范围。

## 同时进行的Memory验收

[完整三系统运行42449764159](https://github.com/chainlesschain/chainlesschain/actions/runs/42449764159)绑定同一SHA、samples=100，12个job仍排队。本机Memory合同选择11文件141通过、1跳过的成绩独立记账。任何排队、下载或准备完成均不计为验收通过。

## 首轮终态与诊断

运行23711已退出1。官方VS Code1.145.2下载、VSIX安装、版本列举和实际扩展激活成功；多窗口阶段在生产MCP桥接连通性检查失败，尚未执行完整DOM及重启旅程。完整失败回执位于 `.tmp/ide-host-a3296d55f-evidence/journey-evidence.json`，其SHA-256为 `b7ebb0a8a260eb645f440aaebf46303ef5dc9414776c30109587a619310b12e8`；result为failed，evidenceComplete只表示失败证据齐备。

扩展05:20:07.690报告bridge up，07.961激活完成，08.267驱动的TCP连接返回 `ETIMEDOUT 127.0.0.1:59074`。桥接在listen回调成功后才发布锁；约303ms的系统错误不同于驱动3秒deadline。Astra只读复核确认失败早于companion启动，不涉及模型调用、token鉴权或DOM。根因未证实，不能直接通过放宽等待或跳过断言结案。

独立Node回环探针创建127.0.0.1监听、连接、读完并关闭，退出0，连接耗时3ms。本机普通Node可连接不证明Extension Host相同条件可连接。后续须在新的诊断运行中比较同一端口的宿主内外连通性，保留首轮失败及总期限。

## 宿主二进制隔离诊断

同一段3秒deadline的Node TCP自连代码，在普通Node24.12.0为2ms成功、已安装Code（Node20.18.1/Electron32.2.6）为4ms成功，下载Code1.145.2（Node24.22.1/Electron43.8.3）为306ms系统ETIMEDOUT。该测试不加载扩展或用户profile。下载宿主显式family:4、autoSelectFamily:false、localAddress:127.0.0.1均仍约306–309ms失败，不能用地址族参数修复。

交叉连接进一步区分方向：下载Code客户端→普通Node服务端成功；普通Node客户端→下载Code服务端ETIMEDOUT。由此可确认失败在该本机下载宿主的入站回环路径，不需要扩展参与即可复现；尚不能据此断言是Electron缺陷或特定安全软件。只读防火墙查询发现现有规则只匹配已安装Code路径，没有匹配下载Code的显式规则；本轮未更改防火墙、安全策略、产品代码或探针期限。

原始本机诊断分别保存在 `.tmp/ide-host-a3296d55f-loopback.json` 和 `.tmp/ide-host-a3296d55f-cross-loopback.json`。完整Windows stable旅程保留失败。三系统Memory运行42449764159仍经实际API回读为queued，不能重启或计为通过。

最小诊断已归档到[五份证据及摘要](../../cli/evidence/merged-host-2026-11-08/README.md)，完整原始旅程仍保留在原临时目录，不将失败摘要当作完整成功证据。
