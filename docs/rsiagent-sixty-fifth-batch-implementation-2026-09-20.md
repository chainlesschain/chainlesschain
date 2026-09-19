# 第六十五次工程实施：隔离 Custody 孤儿锁诊断与受审计释放

日期：2026-09-20

## 本批结论

本批为 quarantine custody 增加用途单一的 operator lock maintenance authority。签名 Desktop deployment 现在可组装“诊断”和“释放”两阶段能力：诊断只返回摘要化锁状态；释放必须绑定先前取得的精确 `lockStateDigest`、短期 operator 决策回执以及认证耐久 outcome。authority 不取得文件路径，也不能修改或删除 artifact 字节。

该能力主要处理自动 PID 判活无法安全裁决的 PID 重用、损坏 owner 或长期 ownerless lock。它不会把普通自动恢复改成按年龄抢占：常规 custody 仍只自动回收可证明 dead PID 的 owner；显式释放必须走 operator-signed maintenance 流程。

## 主要实现

### 1. 可复算锁诊断

- 诊断绑定 custody/tenant/handler、opaque artifact 引用摘要、lock directory 的设备/inode/birthtime 身份以及 owner 原始字节摘要。
- 状态区分 `absent`、`owned-live`、`owned-dead`、`owned-invalid`、`owner-initializing` 与 `owner-orphaned`；authority 对外只给 owner process digest，不暴露路径或原始 artifact 引用给 policy/audit writer。
- `lockStateDigest` 不含观察时间和瞬时 PID 存活结果，因此能稳定绑定同一个目录与 owner 证据；目录替换、owner 替换或临时文件变化都会导致释放失败。

### 2. 竞争安全的 maintenance claim

- 释放前在现有 lock directory 内以 `wx`/硬链接原子提交 `maintenance.json`，并同步文件与目录；普通 acquire、自动 dead-lock recovery 和 owner release 遇到 active claim 均失败关闭。
- claim 建立后再次校验 lock directory identity、owner evidence 和预期 `lockStateDigest`，避免诊断后原 owner 释放、另一个进程取得同名锁时误删新锁。
- 只有校验一致时才删除 owner/temp、maintenance claim 与 lock directory，并逐步 directory fsync/不存在回读；artifact part/blob/metadata/deletion evidence 均不在删除集合内。
- 同一 custody 实例由 `heldLocks` 追踪真实持锁，operator maintenance 不能释放本实例仍持有的锁。maintenance 进程崩溃后，dead claim 可由后续 acquire 恢复；活 claim 不抢占。

### 3. Operator authority 与签名 deployment

- 新 authority 强制 `operator-signed`、`authenticated-durable-readback`、`orphan-lock-release` descriptor。
- inspect/release 均先调用独立 policy；成功或失败结果都必须取得认证、耐久、精确回读的 audit acknowledgement。
- release request 必须携带上一阶段 `lockStateDigest`。执行失败会先记录失败 outcome，再返回明确失败；伪造 ack、descriptor/tenant/handler 替换及 module digest 替换均失败关闭。
- Desktop 命令的签名 deployment loader 已暴露并绑定该 factory 到已验签模块 digest；本批尚未开放 renderer/preload IPC。

## 验证结果

```text
Custody / lock maintenance / disposal / retention / operator revoke / scheduler / loader:
  Test Files  8 passed (8)
  Tests      100 passed (100)

ESLint:
  0 errors
```

新增真实文件系统用例模拟“owner PID 已被当前进程重用、但当前 custody 并未持锁”：先审计诊断，再以精确状态释放，确认锁目录消失而 partial bytes 原样保留。另有负例证明真实本实例 session 不能被 maintenance 释放、状态替换不能通过、拒绝决策不执行、失败 outcome 会耐久记录。

## 仍未完成

- 尚未接入 Desktop 主进程 DID/RBAC/Ed25519 管理入口、preload 固定 capability 和管理员 UI；因此普通 renderer 当前不能调用该 authority。
- 生产 policy 仍需定义 PID 重用、最长操作时长、工单/双人审批及值班响应规则；本批单签 operator capability 不替代双人或硬件签名。
- maintenance 进程自身发生 PID 重用、claim 文件损坏、磁盘/权限故障时仍会失败关闭，需要生产告警、离线取证与 break-glass 流程。
- 真实多实例 Electron、扫描/写入中强制维护、进程崩溃矩阵和突然断电恢复仍待目标环境验收。
