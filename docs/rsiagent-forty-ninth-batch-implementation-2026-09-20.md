# 第四十九次工程实施：流式隔离下载执行器

日期：2026-09-20

## 本批结论

第四十八批建立了下载授权与证据合同，但字节上限、内容摘要、隔离写入和扫描仍全部由单一 deployment provider 声明。本批将这些职责进一步拆分：新增由已验签 deployment module digest 约束的流式下载执行器，网络 egress、隔离 custody、独立 scanner 和完成回读仍是 operator 提供的端口，而实际字节计数与原始内容 SHA-256 由仓库内认证核心逐块计算。

执行器不接受保存路径、文件名、请求 headers 或普通文件写入口，也不向 renderer 暴露字节或隔离路径。

## 主要实现

### 1. 四端口职责分离

`createBrowserQuarantinedDownloadExecutor()` 要求签名 deployment 显式装配：

- `openNetworkResponse`：只允许 policy-egress 网络端口；
- `openQuarantine`：创建 exclusive、streaming、fsync 语义的隔离会话；
- `scanArtifact`：由独立恶意文件扫描 authority 对已提交工件裁决；
- `completeArtifact`：在扫描通过后持久化最终状态并精确回读。

executor descriptor 固定 `policy-egress`、`exclusive-stream-fsync` 和 `independent-malware-scan` 三种模式，并由 deployment loader 强制 `handlerArtifactDigest` 等于已验签模块摘要。替换 executor descriptor 无法通过工厂边界。

### 2. 核心亲自执行字节预算与 SHA-256

网络端口只能返回 HTTP 200、最终 URL、完整 redirect origins、精确 MIME、可选 Content-Length、网络回执摘要和 AsyncIterable 字节流。执行器在分配隔离会话前验证 URL/origin/MIME/声明长度，在每个 chunk 上执行：

- AbortSignal 与绝对 deadline 检查；
- Uint8Array/Buffer 类型检查；
- 在复制和隔离写入前检查剩余字节预算；
- 增量累计实际字节数；
- 对原始内容执行无域前缀 SHA-256；
- 串行等待 custody `writeChunk` 完成。

流结束后，声明 Content-Length 必须与实际字节数完全一致；空响应失败关闭。

### 3. 隔离、扫描与完成回读

只有 custody commit acknowledgement 同时满足 artifact ref、核心计算的 digest/size/MIME、authenticated、durable 与 readback-verified，才会进入扫描。扫描 acknowledgement 必须绑定同一 artifact，并声明 authenticated、independent；任何非 `clean` 结论都丢弃隔离工件。

最终 completion acknowledgement 再次绑定 artifact 与 scan evidence，并要求 authenticated、durable、readback-verified。deadline 在网络返回、每个 chunk、commit、scan、completion 前后重复检查。任一阶段失败都会调用用途单一的 `discardArtifact({ reason: "download-execution-failed" })`，不会把底层路径或内容带入失败证据。

## 负例覆盖

本批验证：

1. 实际两段字节流产生正确 SHA-256、字节数与顺序写入；
2. 未声明长度的流在超过预算前停止，不复制或写入越界 chunk，并丢弃部分隔离工件；
3. 错误 MIME、越界 redirect、HTTP 206 和过大 Content-Length 在隔离分配前拒绝；
4. 独立 scanner 的 rejected 结论会丢弃已提交工件，不能进入 completion；
5. custody digest 替换、非耐久确认或缺少精确回读均失败并丢弃；
6. 流处理中 deadline 到期会丢弃且不 commit；
7. executor 工厂不能使用与已验签 deployment module 不同的 handler digest。

## 验证结果

```text
CLI  Test Files  3 passed (3)   Tests 90 passed (90)
```

相关 JavaScript 文件通过 ESLint 和 Prettier（0 errors），`git diff --check` 通过。

## 仍未完成

- 仓库尚未内置 operator 生产网络 egress、隔离 custody、独立恶意文件扫描与完成回读端口；
- 仍需目标环境证明 DNS/代理/重定向不能绕过 egress policy，隔离目录不可被普通业务进程读取或执行，并完成真实扫描引擎故障演练；
- artifact 的受治理领取、取消、过期清理和撤销生命周期仍未实现；
- 当前回归使用合成端口，尚非真实 Electron/browser/download/scanner E2E，也未覆盖断电、磁盘写满或扫描服务崩溃。
