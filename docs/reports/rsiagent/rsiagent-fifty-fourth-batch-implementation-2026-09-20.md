# 第五十四次工程实施：可重开的文件系统隔离 Custody

日期：2026-09-20

## 本批结论

本批把下载 executor 的抽象 `openQuarantine`/`completeArtifact` 端口落成仓库内可运行的文件系统隔离 custody。该实现由签名 desktop deployment 的内建 factory 创建，descriptor 中的 handler artifact digest 必须等于已认证 deployment 模块摘要；不能由部署模块替换为未绑定实现。

真实临时目录测试证明：字节采用独占 `.part` 流式写入，提交前执行文件 fsync，重命名后由 custody 独立重算 SHA-256 和长度，再原子写入并 fsync 元数据。只有字节与元数据均回读一致时才返回 authenticated、durable、readback-verified quarantine acknowledgement。

## 主要实现

### 1. 独占流式隔离写入

- state root 必须是绝对路径，根目录和内部目录不得是符号链接或逃逸根目录；
- artifact ID 只能使用有限字符，所有文件名由 custody 内部派生；
- `.part` 使用 exclusive-create 和私有权限打开，同一 artifact 不能并发复用；
- 每个 chunk 在写入前再次执行类型、非空和剩余字节预算检查；
- partial、commit 或上层扫描失败可通过 session `discardArtifact` 删除 part/blob/metadata 并回读不存在状态。

### 2. 独立字节与元数据回读

- executor 继续在认证核心中计算原始 SHA-256；custody 在最终 blob 上独立重算 SHA-256 与长度；
- metadata 绑定 custody/tenant、artifact digest、MIME、网络回执、源 action receipt、提交时间和 retention expiry；
- quarantine receipt digest 覆盖上述边界，不包含宿主路径；
- 元数据使用同目录临时文件、文件 fsync 与 rename 提交，随后重新打开、fsync、解析并校验；
- 进程内重新创建 custody 后可从同一 state root 回读 ready artifact 证据。

### 3. 扫描与完成端口

- `openArtifactForScan` 先验证 metadata、文件长度和实际 SHA-256；
- scanner 只获得不含 `path` 属性的 async iterable，底层宿主路径保留在 custody 闭包内；
- `completeArtifact` 精确核对 artifact、network/quarantine receipt、clean scan evidence 和时间边界；
- 完成元数据再次原子持久化并回读，之后才签发 authenticated、durable、readback-verified completion acknowledgement。

### 4. 签名 Deployment 工厂

`createBrowserFilesystemQuarantineCustody` 已进入 desktop deployment 的内建 factories 和统一 module-digest guard。替换 `handlerArtifactDigest` 的负例会在创建任何目录前失败关闭。

## 验证结果

```text
Filesystem custody / streaming executor / signed deployment loader:
  Test Files  3 passed (3)
  Tests      82 passed (82)

ESLint:
  0 errors
```

覆盖真实文件写入与重开、部分流丢弃、持久字节篡改、路径穿越、tenant 替换、完成证据替换，以及 executor → custody → scanner → completion 的完整本地链路。

## 仍未完成

- 该实现是签名 deployment 可选的仓库内 custody，尚未由 operator 在生产配置中选择并完成多进程/断电验收；
- metadata 已记录 expiry，但自动扫描与过期删除调度器尚未实现；
- 崩溃遗留 `.part`/临时元数据的重启恢复、跨进程锁和磁盘耗尽演练仍待完成；
- 独立恶意文件 scanner、生产 policy egress、受治理领取/导入/导出与 disposal authority 的生产装配仍待完成；
- 文件 fsync 与应用层回读已验证，但不据此宣称已经通过断电后目录项持久性测试。
