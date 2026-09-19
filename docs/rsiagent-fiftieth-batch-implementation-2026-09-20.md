# 第五十次工程实施：隔离下载工件的不可逆丢弃

日期：2026-09-20

## 本批结论

本批为 G03 下载链补充首个成功后生命周期动作：`browser:action:discard-download-artifact`。renderer 只能提交第四十八批返回的 opaque `quarantine:` 引用、内容 SHA-256 和源下载授权回执摘要；签名 disposal authority 在交互审批后签发一次性 grant，custody 必须证明字节已不可用、确认已认证且耐久回读成功，IPC 才能报告丢弃完成。

该动作不可读取、导出或指定工件路径，也不能用普通字符串冒充隔离引用。

## 主要实现

### 1. 独立不可逆 disposal authority

新增 `browser-download-artifact-disposal-authority` v1。请求精确绑定：

- renderer sender 与 frame digest；
- 操作固定为 `discard-download-artifact`；
- `quarantine:` 命名空间的 opaque artifact ref；
- 原内容 SHA-256；
- 产生该工件的 source action receipt digest；
- `user-discard`、`expired`、`revoked` 或 `delivery-failed` 原因；
- 交互审批材料摘要和完整 input digest。

authority descriptor 固定 `interactive`、`authenticated-durable-readback` 与 `irreversible-byte-disposal`。工厂由 deployment loader 强制绑定已验签 module digest。

授权回执将 artifact ref 转为域分离摘要；原始引用只传给签名 custody disposal port。grant 在调用 port 前即标记 consumed，替换或重放失败关闭。

### 2. 删除完成即耐久审计

custody deletion acknowledgement 必须精确回显 authority/tenant/handler、action receipt、request、artifact ref/digest 与 source download receipt，并同时满足：

- `authenticated: true`；
- `durable: true`；
- `readbackVerified: true`；
- `bytesUnavailable: true`；
- `qualifiesForPromotion: false`。

Desktop 重新计算脱敏 result digest。若 disposal port 抛错或返回值不完整，因删除可能已经发生而统一抛出 `CC_AGENT_ACTION_AUDIT_UNCERTAIN`，不会自动重试不可逆动作。

### 3. Opaque Desktop Host 与唯一 IPC

Desktop loader 将签名 authority 收窄为无字段 Host。IPC 不访问 BrowserEngine，也不接受 savePath、文件名或其他额外 options；成功结果只包含 artifact ref digest、原内容 digest、源下载回执摘要、原因、删除时间、deletion receipt digest 和 result digest，原始 custody reference 不返回。

下载、流式隔离 executor、disposal authority 与 Desktop Host 现统一要求 `quarantine:[A-Za-z0-9._-]+` 引用，路径分隔符、`..` 路径穿越和任意非隔离 ID 无法进入 custody。

## 负例覆盖

本批覆盖：

1. 非隔离引用、未知原因、伪造 digest、额外路径字段和 input digest 替换在 authority 前拒绝；
2. artifact ref、artifact digest、source receipt 或 reason 替换导致 grant 不匹配；
3. execution grant 只能消费一次；
4. policy deny 不调用 custody；
5. 缺少签名 Host 时 IPC 失败关闭；
6. IPC 成功结果不包含原始 artifact ref，且整个 disposal 流程不访问 BrowserEngine；
7. disposal authority 工厂不能替换已验签 handler module digest。

## 验证结果

```text
CLI      Test Files  4 passed (4)   Tests 100 passed (100)
Desktop  Test Files  4 passed (4)   Tests  72 passed (72)
合计     Test Files  8 passed (8)   Tests 172 passed (172)
```

相关 JavaScript 文件通过 ESLint 和 Prettier（0 errors；仅保留既有 warning），`git diff --check` 通过。

## 仍未完成

- 尚未提供 in-flight cancel、自动 expiry cleanup、operator revoke 与批量垃圾回收合同；
- artifact 的受治理领取/导入/导出仍未实现，不能把隔离引用解释为文件路径；
- operator 仍需配置真实 custody disposal port，并证明删除回执来自独立耐久回读而非进程内自报；
- 断电、磁盘故障、扫描服务崩溃、删除中断与真实 Electron/browser/provider/custody E2E 仍待目标环境完成。
