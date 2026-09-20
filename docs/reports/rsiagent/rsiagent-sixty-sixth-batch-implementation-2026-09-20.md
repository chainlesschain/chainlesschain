# 第六十六次工程实施：Desktop 孤儿锁签名运维入口

日期：2026-09-20

## 本批结论

本批把上一批的 quarantine lock maintenance authority 接到 Desktop 主进程与固定 preload capability。renderer 只能提交 `inspect`/`release`、opaque `quarantine:` 引用、预期锁状态摘要、工单号和理由；当前 DID、tenant 角色、sender/frame、签名密钥及 authority capability 全部留在主进程。

主进程只允许 deployment tenant 的 organization owner 或 active admin。每次请求都会生成新的 request ID，以当前 DID 对绑定 operation、artifact 引用摘要、预期 `lockStateDigest`、sender/frame、角色、权限、工单和理由摘要的 payload 做 Ed25519 签名并立即自验；renderer 注入 DID、角色或签名字段会因输入形状不符而失败关闭。

## 主要实现

### 1. 专用 Desktop host

- 新增 opaque `desktopBrowserQuarantineLockMaintenanceHost`，只保存已捕获的 descriptor 与 `maintainLock` 端口，不暴露 custody、policy、audit writer 或签名 deployment。
- host 强制 authority 声明 `operator-signed`、`authenticated-durable-readback` 与 `orphan-lock-release`。
- 返回结果会重新校验 operation/status、artifact 引用摘要、owner 状态、两阶段 `lockStateDigest`、release receipt、operator digest、audit/durability digest 与最终 `resultDigest`；异常结果统一标记 uncertain。

### 2. DID、RBAC 与签名绑定

- 当前身份只从主进程 `didManager.getCurrentIdentity()` 取得；数据库按 deployment tenant 查询 organization owner 或 active owner/admin membership。
- 签名 payload 绑定 `browser.quarantine.lock.maintain` 权限、renderer sender ID、frame URL 摘要、inspect/release 操作、预期锁摘要、工单和理由摘要。
- 主进程用 DID signer 生成 Ed25519 签名并在调用 authority 前验证 DID/public key/signature 绑定；无身份、普通 member、数据库异常、伪 DID 或不可签名身份均在 authority 之前失败。

### 3. 固定 IPC 与部署接线

- 新增唯一 `browser:operator:maintain-quarantine-lock` IPC；inspect 的 `expectedLockStateDigest` 必须为 `null`，release 必须携带 digest。
- preload 仅暴露 `browser.operator.maintainQuarantineLock(request)`，并同步更新固定 renderer capability manifest；没有 generic IPC 或 custody 文件入口。
- Desktop deployment loader 会把签名模块返回的 lock maintenance authority 缩窄成上述 opaque host，phase-1 Browser IPC 将 host、DID manager 与数据库传给专用处理器。

## 验证结果

```text
CLI custody / authority / deployment governance:
  Test Files  8 passed (8)
  Tests      100 passed (100)

Desktop host / deployment / browser IPC / preload policy:
  Test Files  5 passed (5)
  Tests      93 passed (93)

ESLint:
  0 errors (4 pre-existing warnings)
```

真实跨层测试使用实际 DID Ed25519 key、真实 lock maintenance authority 与真实 filesystem custody：第一次调用取得 `owned-live` 的诊断摘要，第二次签名 release 精确绑定该摘要，最终锁目录消失而 `.part` 字节保持不变。另有负例覆盖 renderer actor claim 注入、未解锁 DID、非管理员角色、伪 DID 签名及异常 authority 结果。

## 仍未完成

- 尚无管理员 UI、工单系统联动、生产 policy/audit writer 配置和 operator 签发 deployment；preload capability 只是固定调用面，不代表普通用户已获授权。
- 单个 owner/admin 签名仍不能替代双人审批、硬件密钥或 break-glass 事后复核。
- maintenance claim 损坏、磁盘/权限故障、真实多实例 Electron 竞争、扫描/写入中强制释放和突然断电仍待目标环境故障注入。
