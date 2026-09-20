# 第五十二次工程实施：隔离下载执行中的协作式取消

日期：2026-09-20

## 本批结论

本批为受治理隔离下载补齐执行中的协作式取消链路。调用方可以为下载指定有限格式的 operation ID，并从同一 renderer 请求取消；取消只能命中该 operation ID 对应的一次性执行 grant。原下载调用不会因“已请求取消”直接报告清理完成，而是在 provider 响应 abort、隔离执行器丢弃部分工件并完成失败 outcome 的认证耐久回读后，返回 `download-cancelled`。

## 主要实现

### 1. Authority 绑定的执行取消

- 下载 authority 只接受同时匹配 action receipt digest 与 request digest 的活动执行；
- 取消原因限制为 `user-request`、`renderer-destroyed` 或 `operator-request`，未知值失败关闭；
- authority 持有内部 AbortController，不把可伪造的 signal 或 controller 暴露给调用方；
- grant 尚未执行、已经完成、digest 被替换或重复取消时均拒绝；
- provider 即使在收到 abort 后同步返回成功工件，authority 仍输出 `download-cancelled`，不能把取消竞态翻转为成功。

### 2. Desktop 与 IPC 所有权隔离

- Desktop host 仅允许处于 `executing` 状态的同一 grant 发起取消；
- `browser:action:download-url` 可携带 operation ID，并在授权开始前占用同 renderer 命名空间，阻断并发重复 ID；
- `browser:action:cancel-download` 以 `sender.id + operationId` 查找执行，其他 renderer 无法取消；
- cancel IPC 只返回 `cancel-requested`，明确不代表字节已清理或 outcome 已耐久；
- 原 download IPC 在收到 `download-cancelled` 后仍调用 outcome writer，认证、耐久且回读验证成功后才返回最终失败证据。

### 3. 隔离工件失败关闭

流式隔离执行器现在区分 deadline 与 signal cancellation。取消在流处理中被观察后：

- 不再写入后续 chunk；
- 不提交、不扫描、不完成该工件；
- 调用 exclusive custody 的 `discardArtifact` 清理部分字节；
- cleanup 失败仍提升为 quarantine cleanup failure，不把未知状态报告为取消完成。

### 4. Preload 能力清单可重生成

补充 scoped preload 方法 `downloadUrl`、`cancelDownload` 与 `discardDownloadArtifact`。同时把动态组合的受治理浏览器通道写入清单生成器的保留源，避免重新生成时静默删除此前手工加入的 navigation、keyboard、tab-open、download 与 disposal 通道。

## 验证结果

```text
Download authority / executor / Desktop host / IPC / deployment:
  Test Files  5 passed (5)   Tests 101 passed (101)

Preload capability policy:
  Test Files  1 passed (1)   Tests   5 passed (5)

合计:
  Test Files  6 passed (6)   Tests 106 passed (106)

Fixed renderer IPC manifest:
  1225 exact channels; 156 unregistered renderer channels denied
```

## 仍未完成

- 当前为协作式取消；生产 network/custody/scanner/completion provider 必须响应 AbortSignal，尚无进程级硬终止与卡死 provider 故障验收；
- operator revoke 尚未通过独立签名、耐久撤销 authority 接入活动执行；
- 自动过期清理、受治理领取/导入/导出仍未完成；
- 完整 Electron renderer/preload/signed deployment 与真实生产 provider E2E 仍待目标环境验证。
